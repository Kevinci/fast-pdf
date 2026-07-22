import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/document/document";
import { detectFormat } from "../src/images/image";
import { parseWebp, webpSize } from "../src/images/webp";
import { inflate } from "../src/pdf/compress";

/**
 * A 24×24 lossless WebP (VP8L) produced by `cwebp -lossless -exact`. It uses the
 * predictor and cross-color transforms plus deep Huffman codes, so it exercises
 * the whole decode path (the `CODE_LENGTH_ORDER`, `CODE_TO_PLANE`, predictor and
 * colour-transform maths were all validated bit-exact against libwebp). Pixels:
 * r = x*11, g = y*13, b = x*y, a = (x+y)%7 ? 255 : 128.
 */
const GRADIENT_WEBP = Uint8Array.from(
  atob(
    "UklGRpAAAABXRUJQVlA4TIMAAAAvF8AFELkyRPQ/FmLBZP7QXUHUP/ofcThqJMmRgkDxB7wu98x/" +
      "Fhi3kaQ4uF445hcDwSSNn48eH2rbtmFgaHVJviCkySH17DQGhxD+7DRUYKjAUIGhgoYKPqrAvxr" +
      "RikYUwFszoscuGjHjUY34fdaIGb9oRI9H/CMFuw//kRZvH/gjGwA=",
  ),
  (c) => c.charCodeAt(0),
);

/** Reconstruct flat RGBA from a parsed WebP for assertions. */
async function toRgba(bytes: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const img = await parseWebp(bytes);
  const color = img.dict["Filter"] ? await inflate(img.data) : img.data;
  const alpha = img.smask ? (img.smaskDeflated ? await inflate(img.smask) : img.smask) : null;
  const px = img.width * img.height;
  const rgba = new Uint8Array(px * 4);
  for (let i = 0; i < px; i++) {
    rgba[i * 4] = color[i * 3]!;
    rgba[i * 4 + 1] = color[i * 3 + 1]!;
    rgba[i * 4 + 2] = color[i * 3 + 2]!;
    rgba[i * 4 + 3] = alpha ? alpha[i]! : 255;
  }
  return { width: img.width, height: img.height, rgba };
}

/** Minimal lossy (VP8) container: valid RIFF/WEBP wrapper, one empty "VP8 " chunk. */
function makeLossyWebp(): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  new DataView(bytes.buffer).setUint32(4, 12, true); // file size - 8
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 " (lossy)
  return bytes;
}

describe("detectFormat", () => {
  it("recognises the RIFF/WEBP signature", () => {
    expect(detectFormat(GRADIENT_WEBP)).toBe("webp");
  });
});

describe("webpSize", () => {
  it("probes dimensions without decoding pixels", () => {
    expect(webpSize(GRADIENT_WEBP)).toEqual({ width: 24, height: 24 });
  });

  it("throws on a bad header", () => {
    expect(() => webpSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))).toThrow(
      /RIFF\/WEBP/,
    );
  });
});

describe("parseWebp (VP8L, cross-validated against libwebp)", () => {
  it("decodes predictor + cross-color + deep-code content exactly", async () => {
    const { width, height, rgba } = await toRgba(GRADIENT_WEBP);
    expect([width, height]).toEqual([24, 24]);
    // Full-image fidelity: reconstruct the source formula and compare every pixel.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        expect([rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]).toEqual([
          (x * 11) & 0xff,
          (y * 13) & 0xff,
          (x * y) & 0xff,
          (x + y) % 7 ? 255 : 128,
        ]);
      }
    }
  });

  it("attaches an /SMask when the image has transparency", async () => {
    const img = await parseWebp(GRADIENT_WEBP);
    expect(img.smask).toBeDefined();
  });

  it("rejects lossy WebP (VP8) with a clear message", async () => {
    await expect(parseWebp(makeLossyWebp())).rejects.toThrow(/Lossy WebP/);
  });
});

describe("PDFDocument.image with WebP", () => {
  it("embeds a lossless WebP like any other image", async () => {
    const doc = new PDFDocument();
    doc.image(GRADIENT_WEBP, { width: 120 });
    const bytes = await doc.render();
    expect(new TextDecoder("latin1").decode(bytes.subarray(0, 8))).toContain("%PDF-1.");
  });
});
