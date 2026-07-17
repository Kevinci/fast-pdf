/**
 * TrueType/OpenType (glyf-flavored) font parser.
 *
 * Reads exactly what embedding and layout need: metrics (head/hhea/hmtx),
 * the character map (cmap formats 4 and 12), glyph outlines (loca/glyf)
 * and descriptor data (post/OS-2/name). CFF-flavored OpenType, TrueType
 * collections and WOFF are rejected with actionable errors.
 */

export interface TableSlice {
  offset: number;
  length: number;
}

export class TTFFont {
  readonly tables = new Map<string, TableSlice>();
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  /** Font units. */
  readonly ascent: number;
  readonly descent: number;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
  readonly capHeight: number;
  readonly italicAngle: number;
  readonly postScriptName: string;
  readonly indexToLocFormat: number;

  private readonly view: DataView;
  private readonly numberOfHMetrics: number;
  private readonly cmapLookup: (codePoint: number) => number;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = this.view.getUint32(0);
    if (version === 0x4f54544f) {
      throw new Error("CFF-based OpenType fonts (.otf with CFF outlines) are not supported yet — use a TrueType (.ttf) build");
    }
    if (version === 0x74746366) {
      throw new Error("TrueType collections (.ttc) are not supported — extract a single font first");
    }
    if (version === 0x774f4646 || version === 0x774f4632) {
      throw new Error("WOFF/WOFF2 files are not supported — use the underlying .ttf");
    }
    if (version !== 0x00010000 && version !== 0x74727565) {
      throw new Error("Not a TrueType font (bad sfnt version)");
    }

    const numTables = this.view.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const p = 12 + i * 16;
      const tag = String.fromCharCode(bytes[p]!, bytes[p + 1]!, bytes[p + 2]!, bytes[p + 3]!);
      this.tables.set(tag, { offset: this.view.getUint32(p + 8), length: this.view.getUint32(p + 12) });
    }

    const head = this.require("head");
    this.unitsPerEm = this.view.getUint16(head.offset + 18);
    this.xMin = this.view.getInt16(head.offset + 36);
    this.yMin = this.view.getInt16(head.offset + 38);
    this.xMax = this.view.getInt16(head.offset + 40);
    this.yMax = this.view.getInt16(head.offset + 42);
    this.indexToLocFormat = this.view.getInt16(head.offset + 50);

    const hhea = this.require("hhea");
    this.ascent = this.view.getInt16(hhea.offset + 4);
    this.descent = this.view.getInt16(hhea.offset + 6);
    this.numberOfHMetrics = this.view.getUint16(hhea.offset + 34);

    this.numGlyphs = this.view.getUint16(this.require("maxp").offset + 4);
    this.require("glyf");
    this.require("loca");
    this.require("hmtx");

    const post = this.tables.get("post");
    this.italicAngle = post ? this.view.getInt32(post.offset + 4) / 65536 : 0;

    const os2 = this.tables.get("OS/2");
    this.capHeight =
      os2 && os2.length >= 90 && this.view.getUint16(os2.offset) >= 2
        ? this.view.getInt16(os2.offset + 88)
        : this.ascent;

    this.postScriptName = this.readPostScriptName() ?? "Embedded";
    this.cmapLookup = this.buildCmapLookup();
  }

  private require(tag: string): TableSlice {
    const t = this.tables.get(tag);
    if (!t) throw new Error(`Font is missing required table "${tag}"`);
    return t;
  }

  /** Advance width for a glyph, in font units. */
  advanceOf(gid: number): number {
    const hmtx = this.tables.get("hmtx")!;
    const index = Math.min(gid, this.numberOfHMetrics - 1);
    return this.view.getUint16(hmtx.offset + index * 4);
  }

  /** Glyph ID for a Unicode code point (0 = .notdef). */
  glyphFor(codePoint: number): number {
    return this.cmapLookup(codePoint);
  }

  /** Raw outline bytes for a glyph (empty for glyphs without contours). */
  glyphData(gid: number): Uint8Array {
    const loca = this.tables.get("loca")!;
    const glyf = this.tables.get("glyf")!;
    let start: number;
    let end: number;
    if (this.indexToLocFormat === 0) {
      start = this.view.getUint16(loca.offset + gid * 2) * 2;
      end = this.view.getUint16(loca.offset + gid * 2 + 2) * 2;
    } else {
      start = this.view.getUint32(loca.offset + gid * 4);
      end = this.view.getUint32(loca.offset + gid * 4 + 4);
    }
    return this.bytes.subarray(glyf.offset + start, glyf.offset + end);
  }

  /** Direct component glyph IDs of a composite glyph (empty for simple glyphs). */
  componentsOf(gid: number): number[] {
    const data = this.glyphData(gid);
    if (data.length === 0) return [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getInt16(0) >= 0) return []; // simple glyph
    const components: number[] = [];
    let pos = 10;
    for (;;) {
      const flags = view.getUint16(pos);
      components.push(view.getUint16(pos + 2));
      pos += 4;
      pos += flags & 0x0001 ? 4 : 2; // ARG_1_AND_2_ARE_WORDS
      if (flags & 0x0008) pos += 2; // WE_HAVE_A_SCALE
      else if (flags & 0x0040) pos += 4; // X_AND_Y_SCALE
      else if (flags & 0x0080) pos += 8; // TWO_BY_TWO
      if (!(flags & 0x0020)) break; // MORE_COMPONENTS
    }
    return components;
  }

  private buildCmapLookup(): (codePoint: number) => number {
    const cmap = this.tables.get("cmap");
    if (!cmap) throw new Error('Font is missing required table "cmap"');
    const v = this.view;
    const base = cmap.offset;
    const numSubtables = v.getUint16(base + 2);

    let best: { offset: number; format: number } | null = null;
    for (let i = 0; i < numSubtables; i++) {
      const p = base + 4 + i * 8;
      const platform = v.getUint16(p);
      const encoding = v.getUint16(p + 2);
      const offset = base + v.getUint32(p + 4);
      const format = v.getUint16(offset);
      const unicode =
        (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0;
      if (!unicode || (format !== 4 && format !== 12)) continue;
      if (!best || format > best.format) best = { offset, format };
    }
    if (!best) throw new Error("Font has no usable Unicode cmap (format 4 or 12)");

    if (best.format === 12) {
      const groups = v.getUint32(best.offset + 12);
      const start = best.offset + 16;
      return (cp) => {
        let lo = 0;
        let hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const g = start + mid * 12;
          if (cp < v.getUint32(g)) hi = mid - 1;
          else if (cp > v.getUint32(g + 4)) lo = mid + 1;
          else return v.getUint32(g + 8) + (cp - v.getUint32(g));
        }
        return 0;
      };
    }

    const segCount = v.getUint16(best.offset + 6) / 2;
    const endCodes = best.offset + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const idDeltas = startCodes + segCount * 2;
    const idRangeOffsets = idDeltas + segCount * 2;
    return (cp) => {
      if (cp > 0xffff) return 0;
      let lo = 0;
      let hi = segCount - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cp > v.getUint16(endCodes + mid * 2)) {
          lo = mid + 1;
          continue;
        }
        if (cp < v.getUint16(startCodes + mid * 2)) {
          hi = mid - 1;
          continue;
        }
        const rangeOffset = v.getUint16(idRangeOffsets + mid * 2);
        if (rangeOffset === 0) {
          return (cp + v.getInt16(idDeltas + mid * 2)) & 0xffff;
        }
        const glyphAddr =
          idRangeOffsets + mid * 2 + rangeOffset + (cp - v.getUint16(startCodes + mid * 2)) * 2;
        const gid = v.getUint16(glyphAddr);
        return gid === 0 ? 0 : (gid + v.getInt16(idDeltas + mid * 2)) & 0xffff;
      }
      return 0;
    };
  }

  private readPostScriptName(): string | null {
    const name = this.tables.get("name");
    if (!name) return null;
    const v = this.view;
    const count = v.getUint16(name.offset + 2);
    const stringsBase = name.offset + v.getUint16(name.offset + 4);
    for (let i = 0; i < count; i++) {
      const p = name.offset + 6 + i * 12;
      if (v.getUint16(p + 6) !== 6) continue; // nameID 6 = PostScript name
      const platform = v.getUint16(p);
      const length = v.getUint16(p + 8);
      const offset = stringsBase + v.getUint16(p + 10);
      let out = "";
      if (platform === 3 || (platform === 0 && length % 2 === 0)) {
        for (let j = 0; j < length; j += 2) out += String.fromCharCode(v.getUint16(offset + j));
      } else {
        for (let j = 0; j < length; j++) out += String.fromCharCode(this.bytes[offset + j]!);
      }
      const clean = out.replace(/[^\x21-\x7e]/g, "");
      if (clean) return clean;
    }
    return null;
  }
}
