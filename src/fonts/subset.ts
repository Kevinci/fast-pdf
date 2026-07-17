import type { TTFFont } from "./ttf";

/**
 * TrueType subsetter.
 *
 * Strategy: glyph IDs are preserved (so the PDF can use /CIDToGIDMap
 * /Identity) and the outlines of unused glyphs are dropped — glyf is by far
 * the largest table, so this captures nearly all of the size win without
 * any ID remapping. Tables not needed by PDF viewers (cmap, name, post,
 * OS/2) are omitted entirely.
 */

/** Expand a glyph set with .notdef and all composite components, recursively. */
export function closeGlyphSet(font: TTFFont, gids: Iterable<number>): Set<number> {
  const closed = new Set<number>([0]);
  const stack = [...gids];
  while (stack.length > 0) {
    const gid = stack.pop()!;
    if (closed.has(gid) || gid >= font.numGlyphs) continue;
    closed.add(gid);
    stack.push(...font.componentsOf(gid));
  }
  return closed;
}

export function subsetTTF(font: TTFFont, usedGids: Set<number>): Uint8Array {
  const used = closeGlyphSet(font, usedGids);

  // Rebuild glyf (used outlines only) and a matching long-format loca.
  const glyphs: Uint8Array[] = [];
  const loca = new Uint8Array((font.numGlyphs + 1) * 4);
  const locaView = new DataView(loca.buffer);
  let glyfLength = 0;
  for (let gid = 0; gid < font.numGlyphs; gid++) {
    locaView.setUint32(gid * 4, glyfLength);
    const data = used.has(gid) ? font.glyphData(gid) : new Uint8Array(0);
    glyphs.push(data);
    glyfLength += (data.length + 3) & ~3; // keep offsets 4-byte aligned
  }
  locaView.setUint32(font.numGlyphs * 4, glyfLength);
  const glyf = new Uint8Array(glyfLength);
  let pos = 0;
  for (const g of glyphs) {
    glyf.set(g, pos);
    pos += (g.length + 3) & ~3;
  }

  // head copy with long loca format and zeroed checksum adjustment.
  const headSrc = font.tables.get("head")!;
  const head = font.bytes.slice(headSrc.offset, headSrc.offset + headSrc.length);
  const headView = new DataView(head.buffer);
  headView.setUint32(8, 0); // checkSumAdjustment
  headView.setInt16(50, 1); // indexToLocFormat: long

  const copy = (tag: string): Uint8Array | null => {
    const t = font.tables.get(tag);
    return t ? font.bytes.subarray(t.offset, t.offset + t.length) : null;
  };

  const tables: [string, Uint8Array][] = [["head", head]];
  for (const tag of ["hhea", "maxp", "hmtx", "cvt ", "fpgm", "prep"]) {
    const data = copy(tag);
    if (data) tables.push([tag, data]);
  }
  tables.push(["loca", loca], ["glyf", glyf]);
  tables.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  return assembleSfnt(tables);
}

function assembleSfnt(tables: [string, Uint8Array][]): Uint8Array {
  const numTables = tables.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;

  const headerLength = 12 + numTables * 16;
  let total = headerLength;
  const offsets: number[] = [];
  for (const [, data] of tables) {
    offsets.push(total);
    total += (data.length + 3) & ~3;
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, searchRange === numTables * 16 ? 0 : numTables * 16 - searchRange);

  let headOffset = 0;
  tables.forEach(([tag, data], i) => {
    const p = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[p + j] = tag.charCodeAt(j);
    out.set(data, offsets[i]!);
    view.setUint32(p + 8, offsets[i]!);
    view.setUint32(p + 12, data.length);
    view.setUint32(p + 4, checksum(out, offsets[i]!, data.length));
    if (tag === "head") headOffset = offsets[i]!;
  });

  // head.checkSumAdjustment = 0xB1B0AFBA - checksum(entire font)
  const fontChecksum = checksum(out, 0, out.length);
  view.setUint32(headOffset + 8, (0xb1b0afba - fontChecksum) >>> 0);
  return out;
}

function checksum(bytes: Uint8Array, offset: number, length: number): number {
  let sum = 0;
  const end = offset + ((length + 3) & ~3);
  for (let i = offset; i < end; i += 4) {
    sum =
      (sum +
        (((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0))) >>>
      0;
  }
  return sum;
}
