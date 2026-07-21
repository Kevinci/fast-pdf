import { FastPDFError } from "../errors";
import { rgbaToImage, type ParsedImage } from "./image";

/**
 * GIF decoding — the first (or only) frame.
 *
 * fast-pdf renders the first frame of a GIF, composited onto the logical
 * screen: pixels outside the frame, and any pixel matching the transparent
 * colour index, are transparent. Animation frames after the first are
 * ignored. The palette and LZW image data are decoded to RGBA and embedded
 * like any other image (DeviceRGB + optional /SMask).
 */

/** ~67 MP: an 8000×8000 sticker sheet. Caps decode allocations. */
const MAX_GIF_PIXELS = 1 << 26;

function readU16(bytes: Uint8Array, pos: number): number {
  return bytes[pos]! | (bytes[pos + 1]! << 8);
}

/** Sync dimension probe from the logical screen descriptor. */
export function gifSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 10 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) {
    throw new FastPDFError("Invalid GIF: missing GIF87a/GIF89a header", "INVALID_IMAGE_FILE");
  }
  const width = readU16(bytes, 6);
  const height = readU16(bytes, 8);
  if (width === 0 || height === 0) {
    throw new FastPDFError("Invalid GIF: zero width or height", "INVALID_IMAGE_FILE");
  }
  return { width, height };
}

export async function parseGif(bytes: Uint8Array): Promise<ParsedImage> {
  const { width, height } = gifSize(bytes);
  if (width * height > MAX_GIF_PIXELS) {
    throw new FastPDFError(
      `GIF is too large to decode: ${width}×${height} px exceeds the ${MAX_GIF_PIXELS}-pixel limit`,
      "IMAGE_TOO_LARGE",
    );
  }

  let pos = 10;
  const packed = bytes[pos]!;
  pos += 3; // packed + background colour index + pixel aspect ratio
  let globalTable: Uint8Array | null = null;
  if (packed & 0x80) {
    const size = 2 << (packed & 7);
    globalTable = bytes.subarray(pos, pos + size * 3);
    pos += size * 3;
  }

  let transparentIndex = -1;
  for (;;) {
    const block = bytes[pos++];
    if (block === undefined) {
      throw new FastPDFError("Invalid GIF: no image data found before end of file", "INVALID_IMAGE_FILE");
    }
    if (block === 0x3b) {
      throw new FastPDFError("Invalid GIF: trailer reached with no image frame", "INVALID_IMAGE_FILE");
    }
    if (block === 0x21) {
      // Extension block: label + sub-blocks.
      const label = bytes[pos++];
      if (label === 0xf9) {
        // Graphic Control Extension — carries the transparency flag/index.
        const blockSize = bytes[pos++]!;
        const flags = bytes[pos]!;
        if (flags & 1) transparentIndex = bytes[pos + 3]!;
        pos += blockSize;
        pos = skipSubBlocks(bytes, pos);
      } else {
        pos = skipSubBlocks(bytes, pos);
      }
      continue;
    }
    if (block !== 0x2c) {
      throw new FastPDFError(`Invalid GIF: unexpected block 0x${block.toString(16)}`, "INVALID_IMAGE_FILE");
    }

    // Image descriptor.
    const left = readU16(bytes, pos);
    const top = readU16(bytes, pos + 2);
    const frameWidth = readU16(bytes, pos + 4);
    const frameHeight = readU16(bytes, pos + 6);
    const imgPacked = bytes[pos + 8]!;
    pos += 9;
    let table = globalTable;
    if (imgPacked & 0x80) {
      const size = 2 << (imgPacked & 7);
      table = bytes.subarray(pos, pos + size * 3);
      pos += size * 3;
    }
    if (!table) {
      throw new FastPDFError("Invalid GIF: image has no colour table", "INVALID_IMAGE_FILE");
    }
    const interlaced = (imgPacked & 0x40) !== 0;
    const minCodeSize = bytes[pos++]!;
    const data = collectSubBlocks(bytes, pos);
    const indices = lzwDecode(data.bytes, minCodeSize, frameWidth * frameHeight);

    // Composite the frame onto a transparent logical screen.
    const rgba = new Uint8Array(width * height * 4);
    const rows = interlacedRowOrder(frameHeight, interlaced);
    const colors = table.length / 3;
    for (let r = 0; r < frameHeight; r++) {
      const srcRow = rows[r]!;
      const y = top + srcRow;
      if (y < 0 || y >= height) continue;
      for (let x = 0; x < frameWidth; x++) {
        const px = left + x;
        if (px < 0 || px >= width) continue;
        const index = indices[r * frameWidth + x]!;
        if (index === transparentIndex || index >= colors) continue;
        const out = (y * width + px) * 4;
        rgba[out] = table[index * 3]!;
        rgba[out + 1] = table[index * 3 + 1]!;
        rgba[out + 2] = table[index * 3 + 2]!;
        rgba[out + 3] = 255;
      }
    }
    return rgbaToImage(rgba, width, height);
  }
}

/** Advance past a chain of length-prefixed sub-blocks (ending with a 0 length). */
function skipSubBlocks(bytes: Uint8Array, pos: number): number {
  for (;;) {
    const len = bytes[pos++];
    if (len === undefined) throw new FastPDFError("Invalid GIF: truncated sub-block", "INVALID_IMAGE_FILE");
    if (len === 0) return pos;
    pos += len;
  }
}

/** Concatenate the length-prefixed image-data sub-blocks into one buffer. */
function collectSubBlocks(bytes: Uint8Array, pos: number): { bytes: Uint8Array; next: number } {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const len = bytes[pos++];
    if (len === undefined) throw new FastPDFError("Invalid GIF: truncated image data", "INVALID_IMAGE_FILE");
    if (len === 0) break;
    chunks.push(bytes.subarray(pos, pos + len));
    total += len;
    pos += len;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return { bytes: out, next: pos };
}

/** Map output row r → source row, honouring GIF's 4-pass interlacing. */
function interlacedRowOrder(height: number, interlaced: boolean): number[] {
  const order = new Array<number>(height);
  if (!interlaced) {
    for (let y = 0; y < height; y++) order[y] = y;
    return order;
  }
  const passes = [
    { start: 0, step: 8 },
    { start: 4, step: 8 },
    { start: 2, step: 4 },
    { start: 1, step: 2 },
  ];
  let out = 0;
  for (const { start, step } of passes) {
    for (let y = start; y < height; y += step) order[out++] = y;
  }
  return order;
}

/** GIF variable-width LZW decode → one palette index per pixel. */
function lzwDecode(data: Uint8Array, minCodeSize: number, expected: number): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 8) {
    throw new FastPDFError(`Invalid GIF: LZW minimum code size ${minCodeSize}`, "INVALID_IMAGE_FILE");
  }
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const out = new Uint8Array(expected);
  let outPos = 0;

  let bitPos = 0;
  const readCode = (size: number): number => {
    let code = 0;
    for (let i = 0; i < size; i++) {
      const byte = data[bitPos >> 3] ?? 0;
      code |= ((byte >> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return code;
  };

  let dict: number[][] = [];
  let codeSize = minCodeSize + 1;
  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push([], []); // clear + EOI placeholders keep the indices aligned
    codeSize = minCodeSize + 1;
  };
  reset();

  let prev: number[] | null = null;
  const totalBits = data.length * 8;
  while (bitPos + codeSize <= totalBits) {
    const code = readCode(codeSize);
    if (code === clearCode) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoiCode) break;

    let entry: number[];
    if (code < dict.length) {
      entry = dict[code]!;
    } else if (code === dict.length && prev) {
      entry = [...prev, prev[0]!];
    } else {
      break; // corrupt stream — stop with what we have
    }
    for (const v of entry) {
      if (outPos < expected) out[outPos++] = v;
    }
    if (prev) {
      dict.push([...prev, entry[0]!]);
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
    if (outPos >= expected) break;
  }
  return out;
}