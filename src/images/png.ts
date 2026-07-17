import { Name, PDFString, latin1String } from "../pdf/objects";
import { deflate, inflate, supportsDecompression } from "../pdf/compress";
import type { ParsedImage } from "./image";

interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  palette: Uint8Array | null;
  idat: Uint8Array;
}

function readPng(bytes: Uint8Array): PngInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8; // signature
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];

  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = latin1String(bytes.subarray(pos + 4, pos + 8));
    const dataStart = pos + 8;
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      interlace = bytes[dataStart + 12]!;
    } else if (type === "PLTE") {
      palette = bytes.subarray(dataStart, dataStart + length);
    } else if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    pos = dataStart + length + 4; // + CRC
  }
  if (width === 0 || height === 0) throw new Error("Invalid PNG: missing IHDR");

  let idatLength = 0;
  for (const c of idatChunks) idatLength += c.length;
  const idat = new Uint8Array(idatLength);
  let off = 0;
  for (const c of idatChunks) {
    idat.set(c, off);
    off += c.length;
  }
  return { width, height, bitDepth, colorType, interlace, palette, idat };
}

/** Sync dimension probe (for layout before the async full parse). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * PNG → PDF image XObject.
 *
 * Gray/RGB/indexed PNGs (color types 0/2/3) embed their IDAT zlib stream
 * unchanged: PDF's FlateDecode supports PNG row predictors natively
 * (/DecodeParms /Predictor 15). No decode, no re-encode — this is the
 * fast path.
 *
 * PNGs with an alpha channel (color types 4/6) have no PDF equivalent:
 * they are inflated, unfiltered, split into color + alpha (/SMask), and
 * both planes re-deflated.
 */
export async function parsePng(bytes: Uint8Array): Promise<ParsedImage> {
  const png = readPng(bytes);
  if (png.interlace !== 0) {
    throw new Error("Interlaced (Adam7) PNGs are not supported — re-export without interlacing");
  }
  const channels = CHANNELS[png.colorType];
  if (channels === undefined) throw new Error(`Invalid PNG color type: ${png.colorType}`);

  if (png.colorType === 0 || png.colorType === 2 || png.colorType === 3) {
    let colorSpace: Name | (Name | number | PDFString)[];
    if (png.colorType === 0) colorSpace = new Name("DeviceGray");
    else if (png.colorType === 2) colorSpace = new Name("DeviceRGB");
    else {
      if (!png.palette) throw new Error("Invalid PNG: indexed color without PLTE chunk");
      colorSpace = [
        new Name("Indexed"),
        new Name("DeviceRGB"),
        png.palette.length / 3 - 1,
        new PDFString(latin1String(png.palette)),
      ];
    }
    return {
      width: png.width,
      height: png.height,
      data: png.idat,
      dict: {
        Filter: new Name("FlateDecode"),
        ColorSpace: colorSpace,
        BitsPerComponent: png.bitDepth,
        DecodeParms: {
          Predictor: 15,
          Colors: png.colorType === 2 ? 3 : 1,
          BitsPerComponent: png.bitDepth,
          Columns: png.width,
        },
      },
    };
  }

  // Alpha path (color types 4 and 6).
  if (png.bitDepth !== 8) {
    throw new Error(`PNGs with alpha are supported at 8-bit depth only (got ${png.bitDepth}-bit)`);
  }
  if (!supportsDecompression()) {
    throw new Error("PNGs with alpha require DecompressionStream, which this runtime lacks");
  }
  const raw = unfilter(await inflate(png.idat), png.width, png.height, channels);
  const colorChannels = channels - 1;
  const pixels = png.width * png.height;
  const color = new Uint8Array(pixels * colorChannels);
  const alpha = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < colorChannels; c++) {
      color[i * colorChannels + c] = raw[i * channels + c]!;
    }
    alpha[i] = raw[i * channels + colorChannels]!;
  }

  const [colorDeflated, alphaDeflated] = await Promise.all([deflate(color), deflate(alpha)]);
  return {
    width: png.width,
    height: png.height,
    data: colorDeflated ?? color,
    dict: {
      Filter: colorDeflated ? new Name("FlateDecode") : undefined,
      ColorSpace: new Name(colorChannels === 1 ? "DeviceGray" : "DeviceRGB"),
      BitsPerComponent: 8,
    },
    smask: alphaDeflated ?? alpha,
    smaskDeflated: alphaDeflated !== null,
  };
}

/** Reverse PNG row filters (spec §9): None, Sub, Up, Average, Paeth. */
function unfilter(data: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const bpp = channels; // 8-bit only
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  let src = 0;
  for (let row = 0; row < height; row++) {
    const filter = data[src++]!;
    const rowStart = row * stride;
    const prevStart = rowStart - stride;
    for (let i = 0; i < stride; i++) {
      const x = data[src + i]!;
      const left = i >= bpp ? out[rowStart + i - bpp]! : 0;
      const up = row > 0 ? out[prevStart + i]! : 0;
      const upLeft = row > 0 && i >= bpp ? out[prevStart + i - bpp]! : 0;
      let value: number;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + left; break;
        case 2: value = x + up; break;
        case 3: value = x + ((left + up) >> 1); break;
        case 4: value = x + paeth(left, up, upLeft); break;
        default: throw new Error(`Invalid PNG filter type: ${filter}`);
      }
      out[rowStart + i] = value & 0xff;
    }
    src += stride;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
