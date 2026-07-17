import type { PDFValue } from "../pdf/objects";

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

export function toBytes(src: Uint8Array | ArrayBuffer): Uint8Array {
  return src instanceof Uint8Array ? src : new Uint8Array(src);
}

export function detectFormat(bytes: Uint8Array): "jpeg" | "png" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  return null;
}
