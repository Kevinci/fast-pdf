import { Name, PDFString, type Ref } from "../pdf/objects";
import type { PDFWriter } from "../pdf/writer";
import { deflate } from "../pdf/compress";
import { TTFFont } from "./ttf";
import { subsetTTF, closeGlyphSet } from "./subset";
import type { Font } from "./font";

/** Typographic features of an embedded font; both are on by default. */
export interface FontFeatures {
  /** Apply the font's pair kerning (GPOS `kern`, or the legacy `kern` table). */
  kerning?: boolean;
  /** Form the font's standard ligatures (GSUB `liga`): fi, fl, ffi … */
  ligatures?: boolean;
}

interface Shaped {
  glyphs: number[];
  /** The source text each glyph stands for. */
  sources: string[];
  /** Kerning after each glyph but the last, in font units. */
  kerns: number[];
}

/**
 * An embedded TrueType font, written as a composite (Type0) font with
 * Identity-H encoding: content streams carry 2-byte glyph IDs, so the
 * full Unicode range of the font is available. Pair kerning and standard
 * ligatures are applied; there is no contextual shaping, so Arabic and Indic
 * scripts are not joined or reordered.
 *
 * The font tracks which glyphs the document actually uses; at render
 * time only those outlines are embedded (see subset.ts) plus a
 * ToUnicode CMap so text extraction and copy/paste keep working.
 */
export class EmbeddedFont implements Font {
  readonly ttf: TTFFont;
  /** glyph ID → the text it first stood for (one character, or a ligature's several). */
  private readonly usedGlyphs = new Map<number, string>();
  private readonly scale: number;
  private readonly kerning: boolean;
  private readonly ligatures: boolean;

  constructor(
    readonly key: string,
    data: Uint8Array,
    features: FontFeatures = {},
  ) {
    this.ttf = new TTFFont(data);
    this.scale = 1000 / this.ttf.unitsPerEm;
    this.kerning = features.kerning ?? true;
    this.ligatures = features.ligatures ?? true;
  }

  /**
   * The first code point drawn with this font that it has no glyph for, if
   * any. Such text is set with glyph 0 (`.notdef`, usually an empty box) —
   * harmless in an ordinary PDF, a violation in PDF/A.
   */
  get missingCodePoint(): number | undefined {
    return this.usedGlyphs.get(0)?.codePointAt(0);
  }

  get baseFont(): string {
    return `${this.subsetTag()}+${this.ttf.postScriptName}`;
  }

  get ascent(): number {
    return this.ttf.ascent * this.scale;
  }

  get descent(): number {
    return this.ttf.descent * this.scale;
  }

  get capHeight(): number {
    return this.ttf.capHeight * this.scale;
  }

  get lineGap(): number {
    return this.ttf.lineGap * this.scale;
  }

  /**
   * Turn text into the glyph run that is actually set: characters mapped to
   * glyphs, standard ligatures formed, and the kerning after each glyph
   * looked up. Drawing and measuring both go through here, which is what
   * keeps a measured line and a drawn line identical.
   */
  private shape(text: string, tracked: boolean): Shaped {
    const glyphs: number[] = [];
    const sources: string[] = [];
    for (const ch of text) {
      glyphs.push(this.ttf.glyphFor(ch.codePointAt(0)!));
      sources.push(ch);
    }

    const features = this.ttf.features;
    if (this.ligatures && !tracked && features.ligatures.size > 0) {
      for (let i = 0; i < glyphs.length; i++) {
        const candidates = features.ligatures.get(glyphs[i]!);
        if (candidates === undefined) continue;
        for (const { rest, glyph } of candidates) {
          if (i + rest.length >= glyphs.length) continue;
          if (rest.some((component, k) => glyphs[i + 1 + k] !== component)) continue;
          glyphs.splice(i, rest.length + 1, glyph);
          sources.splice(i, rest.length + 1, sources.slice(i, i + rest.length + 1).join(""));
          break;
        }
      }
    }

    const kerns: number[] = [];
    if (this.kerning) {
      for (let i = 0; i + 1 < glyphs.length; i++) {
        kerns.push(features.kern(glyphs[i]!, glyphs[i + 1]!));
      }
    }
    return { glyphs, sources, kerns };
  }

  private use(gid: number, source: string): string {
    if (!this.usedGlyphs.has(gid)) this.usedGlyphs.set(gid, source);
    return String.fromCharCode(gid >> 8) + String.fromCharCode(gid & 0xff);
  }

  /** One glyph per character, no ligatures, no kerning. */
  encode(text: string): string {
    let out = "";
    for (const ch of text) out += this.use(this.ttf.glyphFor(ch.codePointAt(0)!), ch);
    return out;
  }

  layout(text: string, tracked = false, afterSpace = 0): (string | number)[] {
    const { glyphs, sources, kerns } = this.shape(text, tracked);
    const parts: (string | number)[] = [];
    let run = "";
    for (let i = 0; i < glyphs.length; i++) {
      run += this.use(glyphs[i]!, sources[i]!);
      // TJ adjustments are subtracted from the pen position, so a kerning
      // value (negative = tighter) changes sign on its way into the array.
      let adjust = -(kerns[i] ?? 0) * this.scale;
      if (afterSpace !== 0 && sources[i] === " " && i < glyphs.length - 1) adjust += afterSpace;
      if (adjust !== 0) {
        parts.push(run, adjust);
        run = "";
      }
    }
    if (run !== "") parts.push(run);
    return parts;
  }

  widthOf(text: string, size: number, tracked = false): number {
    const { glyphs, kerns } = this.shape(text, tracked);
    let units = 0;
    for (const gid of glyphs) units += this.ttf.advanceOf(gid);
    for (const kern of kerns) units += kern;
    return (units * this.scale * size) / 1000;
  }

  /** Deterministic 6-letter subset tag derived from font name + used glyphs. */
  private subsetTag(): string {
    let h = 0x811c9dc5;
    const mix = (n: number) => {
      h ^= n;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    for (let i = 0; i < this.ttf.postScriptName.length; i++)
      mix(this.ttf.postScriptName.charCodeAt(i));
    for (const gid of [...this.usedGlyphs.keys()].sort((a, b) => a - b)) mix(gid);
    let tag = "";
    for (let i = 0; i < 6; i++) {
      tag += String.fromCharCode(65 + (h % 26));
      h = Math.floor(h / 26);
    }
    return tag;
  }

  async embed(writer: PDFWriter): Promise<Ref> {
    const ttf = this.ttf;
    const subset = subsetTTF(ttf, closeGlyphSet(ttf, this.usedGlyphs.keys()));
    const compressed = await deflate(subset);
    const fontFileRef = writer.addStream(
      {
        Filter: compressed ? new Name("FlateDecode") : undefined,
        Length1: subset.length,
      },
      compressed ?? subset,
    );

    const s = (n: number) => Math.round(n * this.scale);
    const descriptorRef = writer.add({
      Type: new Name("FontDescriptor"),
      FontName: new Name(this.baseFont),
      Flags: 4, // symbolic
      FontBBox: [s(ttf.xMin), s(ttf.yMin), s(ttf.xMax), s(ttf.yMax)],
      ItalicAngle: ttf.italicAngle,
      Ascent: s(ttf.ascent),
      Descent: s(ttf.descent),
      CapHeight: s(ttf.capHeight),
      StemV: 80,
      FontFile2: fontFileRef,
    });

    const cidFontRef = writer.add({
      Type: new Name("Font"),
      Subtype: new Name("CIDFontType2"),
      BaseFont: new Name(this.baseFont),
      CIDSystemInfo: {
        Registry: new PDFString("Adobe"),
        Ordering: new PDFString("Identity"),
        Supplement: 0,
      },
      FontDescriptor: descriptorRef,
      DW: 1000,
      W: this.widthsArray(),
      CIDToGIDMap: new Name("Identity"),
    });

    const toUnicodeRef = writer.addStream({}, this.toUnicodeCMap());

    return writer.add({
      Type: new Name("Font"),
      Subtype: new Name("Type0"),
      BaseFont: new Name(this.baseFont),
      Encoding: new Name("Identity-H"),
      DescendantFonts: [cidFontRef],
      ToUnicode: toUnicodeRef,
    });
  }

  /** /W array: runs of consecutive glyph IDs share one `start [w…]` entry. */
  private widthsArray(): (number | number[])[] {
    const gids = [...this.usedGlyphs.keys()].sort((a, b) => a - b);
    const entries: (number | number[])[] = [];
    let run: number[] = [];
    let runStart = -2;
    for (const gid of gids) {
      const width = Math.round(this.ttf.advanceOf(gid) * this.scale);
      if (gid === runStart + run.length) {
        run.push(width);
      } else {
        if (run.length > 0) entries.push(runStart, run);
        runStart = gid;
        run = [width];
      }
    }
    if (run.length > 0) entries.push(runStart, run);
    return entries;
  }

  private toUnicodeCMap(): Uint8Array {
    const hex4 = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();
    const utf16 = (cp: number): string => {
      if (cp <= 0xffff) return hex4(cp);
      const v = cp - 0x10000;
      return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
    };
    const entries = [...this.usedGlyphs.entries()].sort((a, b) => a[0] - b[0]);
    let body = "";
    for (let i = 0; i < entries.length; i += 100) {
      const block = entries.slice(i, i + 100);
      body += `${block.length} beginbfchar\n`;
      for (const [gid, source] of block) {
        // A ligature maps to all the characters it replaced, so search and
        // copy still find "fi" where the page shows a single glyph.
        let text = "";
        for (const ch of source) text += utf16(ch.codePointAt(0)!);
        body += `<${hex4(gid)}> <${text}>\n`;
      }
      body += "endbfchar\n";
    }
    const cmap =
      "/CIDInit /ProcSet findresource begin\n" +
      "12 dict begin\n" +
      "begincmap\n" +
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
      "/CMapName /Adobe-Identity-UCS def\n" +
      "/CMapType 2 def\n" +
      "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" +
      body +
      "endcmap\n" +
      "CMapName currentdict /CMap defineresource pop\nend\nend\n";
    const bytes = new Uint8Array(cmap.length);
    for (let i = 0; i < cmap.length; i++) bytes[i] = cmap.charCodeAt(i) & 0xff;
    return bytes;
  }
}
