import { deflate } from "../pdf/compress";
import { Name, type PDFValue } from "../pdf/objects";

/**
 * A parsed image, ready to be written as a PDF image XObject.
 * `dict` carries codec-specific entries (Filter, ColorSpace, DecodeParms…);
 * the writer adds Type/Subtype/Width/Height/Length.
 */
export interface ParsedImage {
  width: number;
  height: number;
  /** XObject dict entries (Filter, ColorSpace, BitsPerComponent, DecodeParms…). */
  dict: Record<string, PDFValue | undefined>;
  /** Image data exactly as it goes into the stream. */
  data: Uint8Array;
  /** Optional alpha channel to attach as /SMask (8-bit gray, deflated if `smaskDeflated`). */
  smask?: Uint8Array;
  smaskDeflated?: boolean;
}

/** Formats decoded to raw pixels here (JPEG/PNG embed their native streams). */
export type ImageFormat = "jpeg" | "png" | "gif" | "webp";

export function toBytes(src: Uint8Array | ArrayBuffer): Uint8Array {
  return src instanceof Uint8Array ? src : new Uint8Array(src);
}

export function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  // GIF: "GIF87a" or "GIF89a".
  if (
    bytes.length > 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return "gif";
  }
  // WebP: "RIFF" .... "WEBP".
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

/**
 * Build a PDF image XObject from raw RGBA pixels (row-major, 4 bytes/px).
 * Formats without a PDF-native filter (GIF, WebP) decode to RGBA and go
 * through here: the color plane becomes a DeviceRGB image and, when any
 * pixel is not fully opaque, the alpha plane becomes an 8-bit /SMask.
 * Both planes are deflated when the runtime supports compression.
 */
export async function rgbaToImage(rgba: Uint8Array, width: number, height: number): Promise<ParsedImage> {
  const pixels = width * height;
  let hasAlpha = false;
  for (let i = 0; i < pixels; i++) {
    if (rgba[i * 4 + 3] !== 255) {
      hasAlpha = true;
      break;
    }
  }
  const color = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    color[i * 3] = rgba[i * 4]!;
    color[i * 3 + 1] = rgba[i * 4 + 1]!;
    color[i * 3 + 2] = rgba[i * 4 + 2]!;
  }
  const colorDeflated = await deflate(color);
  const image: ParsedImage = {
    width,
    height,
    data: colorDeflated ?? color,
    dict: {
      Filter: colorDeflated ? new Name("FlateDecode") : undefined,
      ColorSpace: new Name("DeviceRGB"),
      BitsPerComponent: 8,
    },
  };
  if (hasAlpha) {
    const alpha = new Uint8Array(pixels);
    for (let i = 0; i < pixels; i++) alpha[i] = rgba[i * 4 + 3]!;
    const alphaDeflated = await deflate(alpha);
    image.smask = alphaDeflated ?? alpha;
    image.smaskDeflated = alphaDeflated !== null;
  }
  return image;
}