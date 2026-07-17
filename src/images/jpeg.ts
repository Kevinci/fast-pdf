import { Name } from "../pdf/objects";
import type { ParsedImage } from "./image";

/**
 * JPEG: PDF supports DCT-encoded data natively, so the file bytes are
 * embedded unchanged (/DCTDecode). Only the header is scanned for
 * dimensions and the number of color components.
 */
export function parseJpeg(bytes: Uint8Array): ParsedImage {
  let pos = 2; // skip SOI
  while (pos + 9 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = bytes[pos + 1]!;
    // Standalone markers without a length field.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      pos += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    // SOF0–SOF15 excluding DHT (C4), JPG (C8), DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const bitsPerComponent = bytes[pos + 4]!;
      const height = (bytes[pos + 5]! << 8) | bytes[pos + 6]!;
      const width = (bytes[pos + 7]! << 8) | bytes[pos + 8]!;
      const components = bytes[pos + 9]!;
      const colorSpace =
        components === 1 ? "DeviceGray" : components === 4 ? "DeviceCMYK" : "DeviceRGB";
      return {
        width,
        height,
        data: bytes,
        dict: {
          Filter: new Name("DCTDecode"),
          ColorSpace: new Name(colorSpace),
          BitsPerComponent: bitsPerComponent,
          // Adobe CMYK JPEGs store inverted values.
          Decode: components === 4 ? [1, 0, 1, 0, 1, 0, 1, 0] : undefined,
        },
      };
    }
    pos += 2 + length;
  }
  throw new Error("Invalid JPEG: no SOF frame header found");
}
