import { FastPDFError } from "../errors";
import { rgbaToImage, type ParsedImage } from "./image";

/**
 * WebP decoding — the lossless (VP8L) profile only.
 *
 * fast-pdf decodes lossless WebP (the "VP8L" bitstream, optionally inside a
 * "VP8X" extended container) to RGBA and embeds it like any other image.
 * Lossy WebP ("VP8 ", a DCT video keyframe) is intentionally not supported
 * — it would need a full VP8 decoder — and is rejected with a clear error.
 *
 * The VP8L decoder implements the complete lossless feature set: the four
 * inverse transforms (predictor, colour, subtract-green, colour indexing
 * with pixel bundling), the colour cache, meta-Huffman code groups and the
 * LZ77 backward references with 2-D distance mapping.
 */

/** ~100 MP guard on the decoded canvas. */
const MAX_WEBP_PIXELS = 100_000_000;

const VP8L_MAGIC = 0x2f;
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const NUM_LITERAL = 256;
const NUM_LENGTH = 24;
const NUM_DISTANCE = 40;

/** Maps the 120 shortest distance plane codes to (x,y) neighbour offsets. */
// prettier-ignore
const CODE_TO_PLANE = new Uint8Array([
  0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a,
  0x26, 0x2a, 0x38, 0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a,
  0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35, 0x3b,
  0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c, 0x03,
  0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c,
  0x55, 0x5b, 0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e,
  0x66, 0x6a, 0x22, 0x2e, 0x54, 0x5c, 0x43, 0x4d, 0x65, 0x6b,
  0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d, 0x11, 0x1f,
  0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b,
  0x31, 0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41,
  0x4f, 0x10, 0x20, 0x62, 0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f,
  0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71, 0x7f, 0x60, 0x70,
]);

function fourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

function u32le(bytes: Uint8Array, at: number): number {
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

/** Locate a RIFF chunk by its FourCC, returning its data slice. */
function findChunk(bytes: Uint8Array, id: string): Uint8Array | null {
  let pos = 12; // "RIFF" + size + "WEBP"
  while (pos + 8 <= bytes.length) {
    const cc = fourCC(bytes, pos);
    const size = u32le(bytes, pos + 4);
    const start = pos + 8;
    if (cc === id) return bytes.subarray(start, Math.min(start + size, bytes.length));
    pos = start + size + (size & 1); // chunks are padded to an even size
  }
  return null;
}

function rejectLossy(): never {
  throw new FastPDFError(
    "Lossy WebP (VP8) is not supported — only lossless (VP8L). Re-encode with `cwebp -lossless`.",
    "UNSUPPORTED_IMAGE",
  );
}

/** Sync dimension probe. */
export function webpSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 16 || fourCC(bytes, 0) !== "RIFF" || fourCC(bytes, 8) !== "WEBP") {
    throw new FastPDFError("Invalid WebP: missing RIFF/WEBP header", "INVALID_IMAGE_FILE");
  }
  const vp8l = findChunk(bytes, "VP8L");
  if (vp8l) {
    if (vp8l[0] !== VP8L_MAGIC) throw new FastPDFError("Invalid WebP: bad VP8L signature", "INVALID_IMAGE_FILE");
    const bits = (vp8l[1]! | (vp8l[2]! << 8) | (vp8l[3]! << 16) | (vp8l[4]! << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  const vp8x = findChunk(bytes, "VP8X");
  if (vp8x && vp8x.length >= 10) {
    const w = (vp8x[4]! | (vp8x[5]! << 8) | (vp8x[6]! << 16)) + 1;
    const h = (vp8x[7]! | (vp8x[8]! << 8) | (vp8x[9]! << 16)) + 1;
    return { width: w, height: h };
  }
  if (findChunk(bytes, "VP8 ")) rejectLossy();
  throw new FastPDFError("Invalid WebP: no VP8L image chunk", "INVALID_IMAGE_FILE");
}

export async function parseWebp(bytes: Uint8Array): Promise<ParsedImage> {
  if (bytes.length < 16 || fourCC(bytes, 0) !== "RIFF" || fourCC(bytes, 8) !== "WEBP") {
    throw new FastPDFError("Invalid WebP: missing RIFF/WEBP header", "INVALID_IMAGE_FILE");
  }
  const vp8l = findChunk(bytes, "VP8L");
  if (!vp8l) {
    if (findChunk(bytes, "VP8 ")) rejectLossy();
    throw new FastPDFError("Invalid WebP: no VP8L (lossless) image chunk", "INVALID_IMAGE_FILE");
  }
  const { rgba, width, height } = new VP8LDecoder(vp8l).decode();
  return rgbaToImage(rgba, width, height);
}

// ── bit reader (little-endian) ──────────────────────────────────────────

class BitReader {
  private buf = 0;
  private bits = 0;
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}

  readBit(): number {
    if (this.bits === 0) {
      this.buf = this.data[this.pos++] ?? 0;
      this.bits = 8;
    }
    const b = this.buf & 1;
    this.buf >>>= 1;
    this.bits--;
    return b;
  }

  readBits(n: number): number {
    let value = 0;
    let shift = 0;
    let need = n;
    while (need > 0) {
      if (this.bits === 0) {
        this.buf = this.data[this.pos++] ?? 0;
        this.bits = 8;
      }
      const take = Math.min(need, this.bits);
      value |= (this.buf & ((1 << take) - 1)) << shift;
      this.buf >>>= take;
      this.bits -= take;
      shift += take;
      need -= take;
    }
    return value >>> 0;
  }
}

// ── canonical Huffman ─────────────────────────────────────────────────────

interface Huffman {
  maxLength: number;
  /** lookup[len] maps a length-`len` code (read LSB-first from the stream) to its symbol. */
  lookup: Map<number, number>[];
  single: number; // ≥0 → a single-symbol code that consumes no bits
  simple2: [number, number] | null;
}

/** Reverse the low `len` bits of `code`. */
function reverseBits(code: number, len: number): number {
  let out = 0;
  for (let i = 0; i < len; i++) {
    out = (out << 1) | ((code >> i) & 1);
  }
  return out;
}

/**
 * Build a canonical Huffman decoder. Codes are assigned canonically
 * (MSB-first, by length then symbol index), but VP8L reads them LSB-first,
 * so each code is bit-reversed for lookup — matching libwebp's decoder.
 */
function buildHuffman(lengths: number[]): Huffman {
  let maxLength = 0;
  let nonZero = 0;
  let last = 0;
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i]!;
    if (l > 0) {
      nonZero++;
      last = i;
      if (l > maxLength) maxLength = l;
    }
  }
  const lookup: Map<number, number>[] = [];
  for (let i = 0; i <= maxLength; i++) lookup.push(new Map());
  const blCount = new Array<number>(maxLength + 1).fill(0);
  for (const l of lengths) if (l > 0) blCount[l]!++;
  const nextCode = new Array<number>(maxLength + 1).fill(0);
  let code = 0;
  for (let len = 1; len <= maxLength; len++) {
    code = (code + blCount[len - 1]!) << 1;
    nextCode[len] = code;
  }
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym]!;
    if (len > 0) {
      lookup[len]!.set(reverseBits(nextCode[len]!, len), sym);
      nextCode[len]!++;
    }
  }
  return { maxLength, lookup, single: nonZero === 1 ? last : -1, simple2: null };
}

function readSymbol(br: BitReader, h: Huffman): number {
  if (h.single >= 0) return h.single;
  if (h.simple2) return h.simple2[br.readBit()]!;
  let code = 0;
  for (let len = 1; len <= h.maxLength; len++) {
    code |= br.readBit() << (len - 1);
    const sym = h.lookup[len]!.get(code);
    if (sym !== undefined) return sym;
  }
  return 0;
}

function readHuffmanCode(br: BitReader, alphabetSize: number): Huffman {
  if (br.readBits(1)) {
    // Simple code: 1 or 2 symbols.
    const numSymbols = br.readBits(1) + 1;
    const s0 = br.readBits(br.readBits(1) ? 8 : 1);
    if (numSymbols === 1) {
      return { maxLength: 0, lookup: [], single: s0, simple2: null };
    }
    const s1 = br.readBits(8);
    return { maxLength: 1, lookup: [], single: -1, simple2: [s0, s1] };
  }
  // Normal code: read the code-length code, then the code lengths.
  const numCodeLengths = 4 + br.readBits(4);
  const clLengths = new Array<number>(19).fill(0);
  for (let i = 0; i < numCodeLengths; i++) clLengths[CODE_LENGTH_ORDER[i]!] = br.readBits(3);
  const clHuff = buildHuffman(clLengths);
  const lengths = readCodeLengths(br, clHuff, alphabetSize);
  return buildHuffman(lengths);
}

function readCodeLengths(br: BitReader, clHuff: Huffman, alphabetSize: number): number[] {
  const lengths = new Array<number>(alphabetSize).fill(0);
  let maxSymbol: number;
  if (br.readBits(1)) {
    const lengthNBits = 2 + 2 * br.readBits(3);
    maxSymbol = 2 + br.readBits(lengthNBits);
  } else {
    maxSymbol = alphabetSize;
  }
  let symbol = 0;
  let prevLength = 8;
  while (symbol < alphabetSize) {
    if (maxSymbol-- === 0) break;
    const codeLen = readSymbol(br, clHuff);
    if (codeLen < 16) {
      lengths[symbol++] = codeLen;
      if (codeLen !== 0) prevLength = codeLen;
    } else {
      const usePrev = codeLen === 16;
      const extraBits = codeLen === 16 ? 2 : codeLen === 17 ? 3 : 7;
      const repeatOffset = codeLen === 16 ? 3 : codeLen === 17 ? 3 : 11;
      let repeat = br.readBits(extraBits) + repeatOffset;
      const value = usePrev ? prevLength : 0;
      while (repeat-- > 0 && symbol < alphabetSize) lengths[symbol++] = value;
    }
  }
  return lengths;
}

// ── prefix codes for length/distance ──────────────────────────────────────

function prefixValue(br: BitReader, prefix: number): number {
  if (prefix < 4) return prefix + 1;
  const extra = (prefix - 2) >> 1;
  const offset = (2 + (prefix & 1)) << extra;
  return offset + br.readBits(extra) + 1;
}

function planeToDistance(xsize: number, planeCode: number): number {
  if (planeCode > 120) return planeCode - 120;
  const code = CODE_TO_PLANE[planeCode - 1]!;
  const yOffset = code >> 4;
  const xOffset = 8 - (code & 0xf);
  const dist = yOffset * xsize + xOffset;
  return dist >= 1 ? dist : 1;
}

// ── pixel maths ────────────────────────────────────────────────────────────

function subSample(size: number, bits: number): number {
  return (size + (1 << bits) - 1) >> bits;
}

function addPixels(a: number, b: number): number {
  const alpha = ((a >>> 24) + (b >>> 24)) & 0xff;
  const red = (((a >> 16) & 0xff) + ((b >> 16) & 0xff)) & 0xff;
  const green = (((a >> 8) & 0xff) + ((b >> 8) & 0xff)) & 0xff;
  const blue = ((a & 0xff) + (b & 0xff)) & 0xff;
  return ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0;
}

function avg2(a: number, b: number): number {
  return (a + b) >> 1;
}

function clip255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

const A = (p: number): number => (p >>> 24) & 0xff;
const R = (p: number): number => (p >> 16) & 0xff;
const G = (p: number): number => (p >> 8) & 0xff;
const B = (p: number): number => p & 0xff;
const pack = (a: number, r: number, g: number, b: number): number => ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;

function average2(a: number, b: number): number {
  return pack(avg2(A(a), A(b)), avg2(R(a), R(b)), avg2(G(a), G(b)), avg2(B(a), B(b)));
}

function select(t: number, l: number, tl: number): number {
  // libwebp Select(top, left, topLeft): pick top when its gradient distance
  // to the top-left is no greater than the left's, else pick left.
  const pa = Math.abs(R(t) - R(tl)) - Math.abs(R(l) - R(tl))
    + Math.abs(G(t) - G(tl)) - Math.abs(G(l) - G(tl))
    + Math.abs(B(t) - B(tl)) - Math.abs(B(l) - B(tl))
    + Math.abs(A(t) - A(tl)) - Math.abs(A(l) - A(tl));
  return pa <= 0 ? t : l;
}

function clampAddSubtractFull(l: number, t: number, tl: number): number {
  return pack(
    clip255(A(l) + A(t) - A(tl)),
    clip255(R(l) + R(t) - R(tl)),
    clip255(G(l) + G(t) - G(tl)),
    clip255(B(l) + B(t) - B(tl)),
  );
}

function clampAddSubtractHalf(c0: number, c1: number): number {
  // Matches libwebp's AddSubtractComponentHalf: the halving uses C integer
  // division (truncation toward zero), not an arithmetic shift, so negative
  // differences round differently.
  const half = (a: number, b: number): number => clip255(a + ((a - b) / 2 | 0));
  return pack(half(A(c0), A(c1)), half(R(c0), R(c1)), half(G(c0), G(c1)), half(B(c0), B(c1)));
}

function predict(mode: number, argb: Uint32Array, i: number, width: number): number {
  const l = argb[i - 1]!;
  const t = argb[i - width]!;
  const tl = argb[i - width - 1]!;
  const tr = argb[i - width + 1]!;
  switch (mode) {
    case 0: return 0xff000000;
    case 1: return l;
    case 2: return t;
    case 3: return tr;
    case 4: return tl;
    case 5: return average2(average2(l, tr), t);
    case 6: return average2(l, tl);
    case 7: return average2(l, t);
    case 8: return average2(tl, t);
    case 9: return average2(t, tr);
    case 10: return average2(average2(l, tl), average2(t, tr));
    case 11: return select(t, l, tl);
    case 12: return clampAddSubtractFull(l, t, tl);
    case 13: return clampAddSubtractHalf(average2(l, t), tl);
    default: return 0xff000000;
  }
}

function colorTransformDelta(mult: number, color: number): number {
  // Both operands are signed 8-bit; the shift is arithmetic.
  return (((mult << 24) >> 24) * ((color << 24) >> 24)) >> 5;
}

// ── VP8L decoder ────────────────────────────────────────────────────────

interface Transform {
  type: number;
  bits: number;
  data: Uint32Array;
  palette: Uint32Array | null;
  paletteBits: number;
  fullWidth: number;
}

const PREDICTOR = 0;
const COLOR = 1;
const SUBTRACT_GREEN = 2;
const COLOR_INDEXING = 3;

class VP8LDecoder {
  private readonly br: BitReader;
  width = 0;
  height = 0;
  private alphaUsed = false;

  constructor(data: Uint8Array) {
    this.br = new BitReader(data);
  }

  decode(): { rgba: Uint8Array; width: number; height: number } {
    if (this.br.readBits(8) !== VP8L_MAGIC) {
      throw new FastPDFError("Invalid WebP: bad VP8L signature", "INVALID_IMAGE_FILE");
    }
    this.width = this.br.readBits(14) + 1;
    this.height = this.br.readBits(14) + 1;
    this.alphaUsed = this.br.readBits(1) === 1;
    this.br.readBits(3); // version
    if (this.width * this.height > MAX_WEBP_PIXELS) {
      throw new FastPDFError(
        `WebP is too large to decode: ${this.width}×${this.height} px exceeds the pixel limit`,
        "IMAGE_TOO_LARGE",
      );
    }
    const argb = this.decodeImageStream(this.width, this.height, true);
    return { rgba: this.toRgba(argb), width: this.width, height: this.height };
  }

  private decodeImageStream(width: number, height: number, isLevel0: boolean): Uint32Array {
    const transforms: Transform[] = [];
    let xsize = width;
    if (isLevel0) {
      while (this.br.readBits(1)) {
        const t = this.readTransform(xsize, height);
        transforms.push(t);
        if (t.type === COLOR_INDEXING) xsize = subSample(width, t.bits);
      }
    }

    // Colour cache.
    let cacheBits = 0;
    if (this.br.readBits(1)) {
      cacheBits = this.br.readBits(4);
    }

    // Meta-Huffman code groups (only for the main level-0 image).
    let huffmanImage: Uint32Array | null = null;
    let huffmanBits = 0;
    let huffmanXSize = 0;
    let numGroups = 1;
    if (isLevel0 && this.br.readBits(1)) {
      huffmanBits = this.br.readBits(3) + 2;
      huffmanXSize = subSample(xsize, huffmanBits);
      const raw = this.decodeImageStream(huffmanXSize, subSample(height, huffmanBits), false);
      huffmanImage = raw;
      let maxGroup = 0;
      for (let i = 0; i < raw.length; i++) {
        const group = (raw[i]! >> 8) & 0xffff;
        raw[i] = group;
        if (group > maxGroup) maxGroup = group;
      }
      numGroups = maxGroup + 1;
    }

    const cacheSize = cacheBits > 0 ? 1 << cacheBits : 0;
    const greenAlphabet = NUM_LITERAL + NUM_LENGTH + cacheSize;
    const groups: Huffman[][] = [];
    for (let g = 0; g < numGroups; g++) {
      groups.push([
        readHuffmanCode(this.br, greenAlphabet),
        readHuffmanCode(this.br, NUM_LITERAL),
        readHuffmanCode(this.br, NUM_LITERAL),
        readHuffmanCode(this.br, NUM_LITERAL),
        readHuffmanCode(this.br, NUM_DISTANCE),
      ]);
    }

    let argb = this.decodePixels(xsize, height, groups, huffmanImage, huffmanBits, huffmanXSize, cacheBits);

    // Inverse transforms, applied in reverse order of reading.
    let curWidth = xsize;
    for (let i = transforms.length - 1; i >= 0; i--) {
      argb = this.inverseTransform(transforms[i]!, argb, curWidth, height);
      if (transforms[i]!.type === COLOR_INDEXING) curWidth = transforms[i]!.fullWidth;
    }
    return argb;
  }

  private readTransform(xsize: number, ysize: number): Transform {
    const type = this.br.readBits(2);
    const t: Transform = { type, bits: 0, data: new Uint32Array(0), palette: null, paletteBits: 0, fullWidth: xsize };
    if (type === PREDICTOR || type === COLOR) {
      t.bits = this.br.readBits(3) + 2;
      t.data = this.decodeImageStream(subSample(xsize, t.bits), subSample(ysize, t.bits), false);
    } else if (type === COLOR_INDEXING) {
      const numColors = this.br.readBits(8) + 1;
      t.bits = numColors > 16 ? 0 : numColors > 4 ? 1 : numColors > 2 ? 2 : 3;
      t.paletteBits = t.bits;
      const raw = this.decodeImageStream(numColors, 1, false);
      // The palette is delta-coded per channel; take the prefix sum.
      const finalColors = 1 << (8 >> t.bits);
      const palette = new Uint32Array(finalColors);
      for (let i = 0; i < numColors; i++) palette[i] = i === 0 ? raw[0]! : addPixels(raw[i]!, palette[i - 1]!);
      t.palette = palette;
    } else if (type !== SUBTRACT_GREEN) {
      throw new FastPDFError(`Invalid WebP: unknown transform ${type}`, "INVALID_IMAGE_FILE");
    }
    return t;
  }

  private decodePixels(
    width: number,
    height: number,
    groups: Huffman[][],
    huffmanImage: Uint32Array | null,
    huffmanBits: number,
    huffmanXSize: number,
    cacheBits: number,
  ): Uint32Array {
    const total = width * height;
    const argb = new Uint32Array(total);
    const useCache = cacheBits > 0;
    const cache = useCache ? new Uint32Array(1 << cacheBits) : null;
    const cacheShift = 32 - cacheBits;
    let lastCached = 0;
    const flushCache = (upTo: number): void => {
      if (!cache) return;
      while (lastCached < upTo) {
        const v = argb[lastCached++]!;
        cache[(Math.imul(0x1e35a7bd, v) >>> cacheShift)] = v;
      }
    };

    let x = 0;
    let y = 0;
    let pos = 0;
    while (pos < total) {
      const group =
        huffmanImage === null
          ? groups[0]!
          : groups[huffmanImage[(y >> huffmanBits) * huffmanXSize + (x >> huffmanBits)]!]!;
      const code = readSymbol(this.br, group[0]!);
      if (code < NUM_LITERAL) {
        const red = readSymbol(this.br, group[1]!);
        const blue = readSymbol(this.br, group[2]!);
        const alpha = readSymbol(this.br, group[3]!);
        argb[pos++] = pack(alpha, red, code, blue);
        if (++x === width) { x = 0; y++; }
      } else if (code < NUM_LITERAL + NUM_LENGTH) {
        const length = prefixValue(this.br, code - NUM_LITERAL);
        const distSymbol = readSymbol(this.br, group[4]!);
        const planeCode = prefixValue(this.br, distSymbol);
        const dist = planeToDistance(width, planeCode);
        let src = pos - dist;
        if (src < 0) throw new FastPDFError("Invalid WebP: backward reference out of range", "INVALID_IMAGE_FILE");
        for (let i = 0; i < length && pos < total; i++) argb[pos++] = argb[src++]!;
        x += length;
        while (x >= width) { x -= width; y++; }
      } else {
        // Colour-cache reference.
        flushCache(pos);
        argb[pos++] = cache![code - NUM_LITERAL - NUM_LENGTH]!;
        if (++x === width) { x = 0; y++; }
      }
      flushCache(pos);
    }
    return argb;
  }

  private inverseTransform(t: Transform, argb: Uint32Array, width: number, height: number): Uint32Array {
    switch (t.type) {
      case SUBTRACT_GREEN:
        for (let i = 0; i < argb.length; i++) {
          const v = argb[i]!;
          const g = G(v);
          argb[i] = pack(A(v), (R(v) + g) & 0xff, g, (B(v) + g) & 0xff);
        }
        return argb;
      case PREDICTOR:
        return this.inversePredictor(t, argb, width, height);
      case COLOR:
        return this.inverseColor(t, argb, width, height);
      case COLOR_INDEXING:
        return this.inverseColorIndexing(t, argb, width, height);
      default:
        return argb;
    }
  }

  private inversePredictor(t: Transform, argb: Uint32Array, width: number, height: number): Uint32Array {
    const tileW = subSample(width, t.bits);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        let pred: number;
        if (x === 0 && y === 0) pred = 0xff000000;
        else if (y === 0) pred = argb[i - 1]!;
        else if (x === 0) pred = argb[i - width]!;
        else {
          const mode = (t.data[(y >> t.bits) * tileW + (x >> t.bits)]! >> 8) & 0xf;
          pred = predict(mode, argb, i, width);
        }
        argb[i] = addPixels(argb[i]!, pred);
      }
    }
    return argb;
  }

  private inverseColor(t: Transform, argb: Uint32Array, width: number, height: number): Uint32Array {
    const tileW = subSample(width, t.bits);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const code = t.data[(y >> t.bits) * tileW + (x >> t.bits)]!;
        const greenToRed = code & 0xff;
        const greenToBlue = (code >> 8) & 0xff;
        const redToBlue = (code >> 16) & 0xff;
        const v = argb[i]!;
        const green = G(v);
        let red = R(v);
        let blue = B(v);
        red = (red + colorTransformDelta(greenToRed, green)) & 0xff;
        blue = (blue + colorTransformDelta(greenToBlue, green)) & 0xff;
        blue = (blue + colorTransformDelta(redToBlue, red)) & 0xff;
        argb[i] = pack(A(v), red, green, blue);
      }
    }
    return argb;
  }

  private inverseColorIndexing(t: Transform, argb: Uint32Array, bundledWidth: number, height: number): Uint32Array {
    const palette = t.palette!;
    const fullWidth = t.fullWidth;
    const perSample = 1 << t.paletteBits;
    const bitsPerPixel = 8 >> t.paletteBits;
    const mask = (1 << bitsPerPixel) - 1;
    const out = new Uint32Array(fullWidth * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < fullWidth; x++) {
        const packed = G(argb[y * bundledWidth + (x >> t.paletteBits)]!);
        const index = (packed >> ((x & (perSample - 1)) * bitsPerPixel)) & mask;
        out[y * fullWidth + x] = palette[index] ?? 0;
      }
    }
    return out;
  }

  private toRgba(argb: Uint32Array): Uint8Array {
    const rgba = new Uint8Array(argb.length * 4);
    for (let i = 0; i < argb.length; i++) {
      const v = argb[i]!;
      rgba[i * 4] = R(v);
      rgba[i * 4 + 1] = G(v);
      rgba[i * 4 + 2] = B(v);
      rgba[i * 4 + 3] = this.alphaUsed ? A(v) : 255;
    }
    return rgba;
  }
}
