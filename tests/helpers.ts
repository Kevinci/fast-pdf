import { deflate } from "../src/pdf/compress";
import { latin1Bytes } from "../src/pdf/objects";

/**
 * Build a PDF the modern way: objects packed into an object stream, indexed by
 * a cross-reference stream with a PNG predictor. This is what Word, Chrome and
 * most scanners emit, and it shares no code path with fast-pdf's own writer
 * (classic table, plain objects) — so importing it exercises the reader's
 * /ObjStm, /XRef and predictor handling.
 */
export async function makeObjStmPdf(
  options: {
    content?: string;
    mediaBox?: [number, number, number, number];
    rotate?: number;
    /** Put /MediaBox and /Rotate on the page *tree node*, to be inherited. */
    inherit?: boolean;
    /** Filler bytes inside the object stream — used to test the inflate cap. */
    objStmPadding?: number;
    /** Claim a different /Filter on the object stream (to test rejection). */
    objStmFilter?: string;
    /** Row filter for the cross-reference stream's PNG predictor (0–4). */
    rowFilter?: 0 | 1 | 2 | 3 | 4;
    /** Use the TIFF predictor (2) rather than the PNG one (12). */
    tiffPredictor?: boolean;
  } = {},
): Promise<Uint8Array> {
  const content = options.content ?? "0 0 1 rg 20 20 120 60 re f";
  const mediaBox = options.mediaBox ?? [0, 0, 300, 400];
  const rotate = options.rotate ?? 0;
  const geometry =
    `/MediaBox [${mediaBox.join(" ")}] ` + (rotate !== 0 ? `/Rotate ${rotate} ` : "");

  // Objects 3–5 go into the object stream; 1 (content) and 6 (xref) stay loose.
  const members = [
    { num: 3, text: "<< /Type /Catalog /Pages 4 0 R >>" },
    {
      num: 4,
      text: `<< /Type /Pages /Kids [5 0 R] /Count 1 ${options.inherit ? geometry : ""}>>`,
    },
    {
      num: 5,
      text:
        "<< /Type /Page /Parent 4 0 R " +
        (options.inherit ? "" : geometry) +
        "/Contents 1 0 R /Resources << >> >>",
    },
  ];
  let index = "";
  let payload = "";
  for (const member of members) {
    index += `${member.num} ${payload.length} `;
    payload += `${member.text}\n`;
  }
  const head = latin1Bytes(index + payload);
  // Padding inflates the decoded size without changing the member offsets, so
  // a bomb-sized stream still looks structurally ordinary.
  const padding = options.objStmPadding ?? 0;
  const objStmPlain = new Uint8Array(head.length + padding);
  objStmPlain.set(head, 0);
  objStmPlain.fill(0x20, head.length);
  const objStm = (await deflate(objStmPlain))!;

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (text: string | Uint8Array): void => {
    const bytes = typeof text === "string" ? latin1Bytes(text) : text;
    chunks.push(bytes);
    offset += bytes.length;
  };
  const offsets: Record<number, number> = {};

  push("%PDF-1.5\n%\xe2\xe3\xcf\xd3\n");

  offsets[1] = offset;
  push(`1 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

  offsets[2] = offset;
  push(
    `2 0 obj\n<< /Type /ObjStm /N ${members.length} /First ${index.length} ` +
      `/Filter ${options.objStmFilter ?? "/FlateDecode"} /Length ${objStm.length} >>\nstream\n`,
  );
  push(objStm);
  push("\nendstream\nendobj\n");

  offsets[6] = offset;
  // W [1 2 2]: one type byte, a two-byte field 2, a two-byte field 3.
  const rows: number[][] = [
    [0, 0, 0, 255, 255], // object 0, the free-list head
    [1, offsets[1]! >> 8, offsets[1]! & 0xff, 0, 0],
    [1, offsets[2]! >> 8, offsets[2]! & 0xff, 0, 0],
    [2, 0, 2, 0, 0], // object 3: member 0 of stream 2
    [2, 0, 2, 0, 1],
    [2, 0, 2, 0, 2],
    [1, offsets[6]! >> 8, offsets[6]! & 0xff, 0, 0],
  ];
  const encoded = options.tiffPredictor
    ? encodeTiffRows(rows)
    : encodePngRows(rows, options.rowFilter ?? 2);
  const xref = (await deflate(new Uint8Array(encoded)))!;
  const predictor = options.tiffPredictor ? 2 : 12;
  push(
    `6 0 obj\n<< /Type /XRef /Size ${rows.length} /W [1 2 2] /Root 3 0 R /Filter /FlateDecode ` +
      `/DecodeParms << /Predictor ${predictor} /Columns 5 >> /Length ${xref.length} >>\nstream\n`,
  );
  push(xref);
  push("\nendstream\nendobj\n");
  push(`startxref\n${offsets[6]}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// Cross-reference stream rows are five bytes wide (/W [1 2 2]) with one
// 8-bit colour, so the predictor's bytes-per-pixel is 1.
const XREF_ROW_LEN = 5;
const XREF_BPP = 1;

/** Apply one PNG row filter (0–4) to every row, as a /Predictor 12 stream. */
function encodePngRows(rows: number[][], type: 0 | 1 | 2 | 3 | 4): number[] {
  const out: number[] = [];
  let prev = new Array<number>(XREF_ROW_LEN).fill(0);
  for (const row of rows) {
    out.push(type);
    for (let i = 0; i < XREF_ROW_LEN; i++) {
      const raw = row[i]!;
      const left = i >= XREF_BPP ? row[i - XREF_BPP]! : 0;
      const up = prev[i]!;
      const upLeft = i >= XREF_BPP ? prev[i - XREF_BPP]! : 0;
      let value: number;
      switch (type) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw - left;
          break;
        case 2:
          value = raw - up;
          break;
        case 3:
          value = raw - ((left + up) >> 1);
          break;
        default: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = raw - (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
        }
      }
      out.push(value & 0xff);
    }
    prev = row;
  }
  return out;
}

/** Apply the TIFF predictor (/Predictor 2): each byte minus the one before it. */
function encodeTiffRows(rows: number[][]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    for (let i = 0; i < XREF_ROW_LEN; i++) {
      out.push((row[i]! - (i >= XREF_BPP ? row[i - XREF_BPP]! : 0)) & 0xff);
    }
  }
  return out;
}

/** One object body: a literal dictionary/value, or a stream with its extra keys. */
export type RawObject = string | { stream: string | Uint8Array; dict?: string };

/**
 * Assemble a PDF byte-for-byte from object bodies with a classic cross-
 * reference table.
 *
 * Unlike `makeObjStmPdf` this makes no assumptions about the structure, so a
 * test can hand the reader a deliberately hostile or damaged file — which is
 * exactly what an upload is. `xref` and `trailer` control the two things real
 * broken files get wrong.
 */
export function makeRawPdf(
  objects: Record<number, RawObject>,
  options: {
    /** Object number of the catalog (default 1). */
    root?: number;
    header?: string;
    /** Extra trailer keys, e.g. " /Encrypt 9 0 R". */
    trailerExtra?: string;
    /** "classic" writes a table, "none" omits it, "broken" points past EOF. */
    xref?: "classic" | "none" | "broken";
    /** Shift every xref offset by this many bytes, to make them stale. */
    offsetSkew?: number;
    /** Omit the trailer dictionary entirely. */
    trailer?: boolean;
  } = {},
): Uint8Array {
  const nums = Object.keys(objects)
    .map(Number)
    .sort((a, b) => a - b);
  const max = nums[nums.length - 1] ?? 0;
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (data: string | Uint8Array): void => {
    const b = typeof data === "string" ? latin1Bytes(data) : data;
    chunks.push(b);
    offset += b.length;
  };

  push(options.header ?? "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
  const offsets: Record<number, number> = {};
  for (const num of nums) {
    const body = objects[num]!;
    offsets[num] = offset;
    if (typeof body === "string") {
      push(`${num} 0 obj\n${body}\nendobj\n`);
    } else {
      const data = typeof body.stream === "string" ? latin1Bytes(body.stream) : body.stream;
      push(`${num} 0 obj\n<< ${body.dict ?? ""} /Length ${data.length} >>\nstream\n`);
      push(data);
      push("\nendstream\nendobj\n");
    }
  }

  const xrefAt = offset;
  if (options.xref !== "none") {
    const skew = options.offsetSkew ?? 0;
    let table = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= max; i++) {
      const at = offsets[i];
      table +=
        at === undefined
          ? "0000000000 65535 f \n"
          : `${String(at + skew).padStart(10, "0")} 00000 n \n`;
    }
    push(table);
  }
  if (options.trailer !== false) {
    push(
      `trailer\n<< /Size ${max + 1} /Root ${options.root ?? 1} 0 R` +
        `${options.trailerExtra ?? ""} >>\n`,
    );
  }
  push(`startxref\n${options.xref === "broken" ? 9_999_999 : xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

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
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
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
 * parser ignores them. `extraTables` adds layout tables (GPOS, GSUB, kern).
 */
export function makeTTF(extraTables: [string, Uint8Array][] = []): Uint8Array {
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
    ...extraTables,
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

/**
 * Build a GIF (89a) with a global colour table and a single image frame,
 * LZW-compressing the palette indices. `palette` is a flat RGB array.
 */
export function makeGif(
  width: number,
  height: number,
  palette: number[],
  indices: number[],
  options: { transparentIndex?: number; interlaced?: boolean } = {},
): Uint8Array {
  const colors = palette.length / 3;
  let tableBits = 1;
  while (1 << tableBits < colors) tableBits++; // 2^tableBits entries
  const tableEntries = 1 << tableBits;
  const minCodeSize = Math.max(2, tableBits);

  const out: number[] = [];
  for (const c of "GIF89a") out.push(c.charCodeAt(0));
  out.push(width & 0xff, width >> 8, height & 0xff, height >> 8);
  out.push(0x80 | ((tableBits - 1) & 7)); // global colour table, size
  out.push(0, 0); // background index, aspect ratio
  for (let i = 0; i < tableEntries * 3; i++) out.push(palette[i] ?? 0);

  if (options.transparentIndex !== undefined) {
    out.push(0x21, 0xf9, 4, 0x01, 0, 0, options.transparentIndex, 0);
  }

  out.push(0x2c); // image descriptor
  out.push(0, 0, 0, 0); // left, top
  out.push(width & 0xff, width >> 8, height & 0xff, height >> 8);
  out.push(options.interlaced ? 0x40 : 0x00);
  out.push(minCodeSize);

  // Interlaced GIFs store rows in 4-pass order; reorder before encoding.
  let stored = indices;
  if (options.interlaced) {
    const passes = [
      { start: 0, step: 8 },
      { start: 4, step: 8 },
      { start: 2, step: 4 },
      { start: 1, step: 2 },
    ];
    stored = [];
    for (const { start, step } of passes) {
      for (let y = start; y < height; y += step) {
        for (let x = 0; x < width; x++) stored.push(indices[y * width + x]!);
      }
    }
  }

  const lzw = lzwEncode(stored, minCodeSize);
  for (let i = 0; i < lzw.length; i += 255) {
    const chunk = lzw.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0); // block terminator
  out.push(0x3b); // trailer
  return new Uint8Array(out);
}

function lzwEncode(indices: number[], minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const bytes: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;
  const emit = (code: number, size: number): void => {
    bitBuf |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  let dict = new Map<string, number>();
  let next = eoiCode + 1;
  let codeSize = minCodeSize + 1;
  const reset = (): void => {
    dict = new Map();
    for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
    next = eoiCode + 1;
    codeSize = minCodeSize + 1;
  };

  reset();
  emit(clearCode, codeSize);
  let w = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const wk = w + "," + k;
    if (dict.has(wk)) {
      w = wk;
    } else {
      emit(dict.get(w)!, codeSize);
      dict.set(wk, next++);
      // The decoder bumps code size one entry later, so bump when `next`
      // has just exceeded the current width's capacity.
      if (next - 1 === 1 << codeSize && codeSize < 12) codeSize++;
      w = String(k);
    }
  }
  emit(dict.get(w)!, codeSize);
  emit(eoiCode, codeSize);
  if (bitCount > 0) bytes.push(bitBuf & 0xff);
  return bytes;
}

/** Minimal JPEG: SOI + SOF0 + EOI. */
export function makeJpeg(width: number, height: number, components = 3): Uint8Array {
  const sofData = [8, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let c = 0; c < components; c++) sofData.push(c + 1, 0x11, 0);
  const length = sofData.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    length >> 8,
    length & 0xff,
    ...sofData,
    0xff,
    0xd9,
  ]);
}

/**
 * A throwaway RSA key and self-signed certificate, generated fresh on every
 * call — so no private key is ever committed. Built with the same ASN.1
 * primitives as `src/pdf/sign.ts`.
 */
export async function makeSigner(): Promise<{ privateKeyPem: string; certificatePem: string }> {
  const { seq, set, tlv, oid, integer, contextConstructed, nullValue, utcTime } =
    await import("../src/pdf/asn1");
  const bs = (u: Uint8Array) => u as unknown as BufferSource;
  const kp = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const utf8 = (s: string) => tlv(0x0c, new Uint8Array([...s].map((c) => c.charCodeAt(0))));
  const name = seq(set(seq(oid("2.5.4.3"), utf8("fast-pdf Test Signer"))));
  const sigAlg = seq(oid("1.2.840.113549.1.1.11"), nullValue()); // sha256WithRSAEncryption
  const validity = seq(
    utcTime(new Date("2020-01-01T00:00:00Z")),
    utcTime(new Date("2040-01-01T00:00:00Z")),
  );
  const tbs = seq(
    contextConstructed(0, integer(2)),
    integer(1),
    sigAlg,
    name,
    validity,
    name,
    spki,
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, kp.privateKey, bs(tbs)),
  );
  const bitString = new Uint8Array(sig.length + 1);
  bitString.set(sig, 1);
  const cert = seq(tbs, sigAlg, tlv(0x03, bitString));
  const pem = (u: Uint8Array, label: string) =>
    `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...u)).replace(/(.{64})/g, "$1\n")}\n-----END ${label}-----\n`;
  return { privateKeyPem: pem(pkcs8, "PRIVATE KEY"), certificatePem: pem(cert, "CERTIFICATE") };
}
