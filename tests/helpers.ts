import { deflate } from "../src/pdf/compress";

/** Build a PNG programmatically (CRCs zeroed — the parser ignores them). */
export async function makePng(
  width: number,
  height: number,
  colorType: 0 | 2 | 6,
  pixel: number[],
  filters?: number[],
): Promise<Uint8Array> {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  const raw = new Uint8Array(height * (1 + width * channels));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * channels);
    raw[row] = filters?.[y] ?? 0; // per-row filter type
    for (let x = 0; x < width; x++) {
      raw.set(pixel, row + 1 + x * channels);
    }
  }
  const idat = (await deflate(raw))!;

  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out;
  };

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

/**
 * Build a synthetic minimal TrueType font: 4 glyphs (.notdef, "A", "B",
 * and "C" as a composite referencing "A"), cmap format 4, PostScript name
 * "TestFont", 1000 units/em, advance 600. Checksums are zeroed — the
 * parser ignores them.
 */
export function makeTTF(): Uint8Array {
  const concat = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  };

  const simpleGlyph = (): Uint8Array => {
    const b = new Uint8Array(34);
    const v = new DataView(b.buffer);
    v.setInt16(0, 1); // one contour
    v.setInt16(2, 0);
    v.setInt16(4, 0);
    v.setInt16(6, 500);
    v.setInt16(8, 500);
    v.setUint16(10, 3); // last point index
    v.setUint16(12, 0); // no instructions
    b.fill(0x01, 14, 18); // flags: 4 × on-curve, long coords
    const xs = [0, 500, 0, -500];
    const ys = [0, 0, 500, 0];
    xs.forEach((x, i) => v.setInt16(18 + i * 2, x));
    ys.forEach((y, i) => v.setInt16(26 + i * 2, y));
    return b;
  };

  const compositeGlyph = (component: number): Uint8Array => {
    const b = new Uint8Array(18);
    const v = new DataView(b.buffer);
    v.setInt16(0, -1);
    v.setInt16(2, 0);
    v.setInt16(4, 0);
    v.setInt16(6, 500);
    v.setInt16(8, 500);
    v.setUint16(10, 0x0003); // ARG_1_AND_2_ARE_WORDS | ARGS_ARE_XY_VALUES
    v.setUint16(12, component);
    v.setInt16(14, 0);
    v.setInt16(16, 0);
    return b;
  };

  const glyphs = [new Uint8Array(0), simpleGlyph(), simpleGlyph(), compositeGlyph(1)];
  const glyf = concat(glyphs);
  const loca = new Uint8Array((glyphs.length + 1) * 2);
  {
    const v = new DataView(loca.buffer);
    let off = 0;
    glyphs.forEach((g, i) => {
      v.setUint16(i * 2, off / 2);
      off += g.length;
    });
    v.setUint16(glyphs.length * 2, off / 2);
  }

  const head = new Uint8Array(54);
  {
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x00010000);
    v.setUint32(12, 0x5f0f3cf5); // magic
    v.setUint16(18, 1000); // unitsPerEm
    v.setInt16(36, 0); // xMin
    v.setInt16(38, -200); // yMin
    v.setInt16(40, 500); // xMax
    v.setInt16(42, 800); // yMax
    v.setInt16(50, 0); // indexToLocFormat: short
  }

  const hhea = new Uint8Array(36);
  {
    const v = new DataView(hhea.buffer);
    v.setUint32(0, 0x00010000);
    v.setInt16(4, 800); // ascender
    v.setInt16(6, -200); // descender
    v.setUint16(34, 4); // numberOfHMetrics
  }

  const maxp = new Uint8Array(32);
  {
    const v = new DataView(maxp.buffer);
    v.setUint32(0, 0x00010000);
    v.setUint16(4, 4); // numGlyphs
  }

  const hmtx = new Uint8Array(16);
  {
    const v = new DataView(hmtx.buffer);
    for (let i = 0; i < 4; i++) v.setUint16(i * 4, 600);
  }

  // cmap format 4: 'A'..'C' → gid 1..3, plus the required 0xFFFF segment.
  const cmap = new Uint8Array(12 + 32);
  {
    const v = new DataView(cmap.buffer);
    v.setUint16(2, 1); // one subtable
    v.setUint16(4, 3); // platform: Windows
    v.setUint16(6, 1); // encoding: Unicode BMP
    v.setUint32(8, 12); // subtable offset
    const s = 12;
    v.setUint16(s, 4); // format
    v.setUint16(s + 2, 32); // length
    v.setUint16(s + 6, 4); // segCountX2
    v.setUint16(s + 14, 0x43); // endCode[0]
    v.setUint16(s + 16, 0xffff); // endCode[1]
    v.setUint16(s + 20, 0x41); // startCode[0]
    v.setUint16(s + 22, 0xffff); // startCode[1]
    v.setUint16(s + 24, (1 - 0x41) & 0xffff); // idDelta[0]
    v.setUint16(s + 26, 1); // idDelta[1]
    // idRangeOffsets stay 0
  }

  const psName = "TestFont";
  const name = new Uint8Array(18 + psName.length * 2);
  {
    const v = new DataView(name.buffer);
    v.setUint16(2, 1); // one record
    v.setUint16(4, 18); // strings offset
    v.setUint16(6, 3); // platform: Windows
    v.setUint16(8, 1); // encoding
    v.setUint16(10, 0x409); // language
    v.setUint16(12, 6); // nameID: PostScript name
    v.setUint16(14, psName.length * 2);
    v.setUint16(16, 0);
    for (let i = 0; i < psName.length; i++) v.setUint16(18 + i * 2, psName.charCodeAt(i));
  }

  const post = new Uint8Array(32);
  new DataView(post.buffer).setUint32(0, 0x00030000);

  const tables: [string, Uint8Array][] = [
    ["cmap", cmap],
    ["glyf", glyf],
    ["head", head],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["loca", loca],
    ["maxp", maxp],
    ["name", name],
    ["post", post],
  ];
  const headerLength = 12 + tables.length * 16;
  let total = headerLength;
  const offsets = tables.map(([, data]) => {
    const at = total;
    total += (data.length + 3) & ~3;
    return at;
  });
  const font = new Uint8Array(total);
  const v = new DataView(font.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, tables.length);
  tables.forEach(([tag, data], i) => {
    const p = 12 + i * 16;
    for (let j = 0; j < 4; j++) font[p + j] = tag.charCodeAt(j);
    v.setUint32(p + 8, offsets[i]!);
    v.setUint32(p + 12, data.length);
    font.set(data, offsets[i]!);
  });
  return font;
}

/** Minimal JPEG: SOI + SOF0 + EOI. */
export function makeJpeg(width: number, height: number, components = 3): Uint8Array {
  const sofData = [8, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let c = 0; c < components; c++) sofData.push(c + 1, 0x11, 0);
  const length = sofData.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, length >> 8, length & 0xff, ...sofData, 0xff, 0xd9]);
}
