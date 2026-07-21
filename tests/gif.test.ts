import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/document/document";
import { detectFormat } from "../src/images/image";
import { gifSize, parseGif } from "../src/images/gif";
import { inflate } from "../src/pdf/compress";

import { makeGif } from "./helpers";

/** Decode a parsed GIF back to flat RGBA for assertions. */
async function toRgba(bytes: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const img = await parseGif(bytes);
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

const RGB = [255, 0, 0, 0, 255, 0, 0, 0, 255]; // palette: red, green, blue

describe("detectFormat", () => {
  it("recognises GIF87a and GIF89a signatures", () => {
    expect(detectFormat(makeGif(2, 1, RGB, [0, 1]))).toBe("gif");
    const gif87 = makeGif(2, 1, RGB, [0, 1]);
    gif87[4] = 0x37; // '7'
    expect(detectFormat(gif87)).toBe("gif");
  });
});

describe("gifSize", () => {
  it("probes dimensions from the logical screen descriptor", () => {
    expect(gifSize(makeGif(37, 19, RGB, new Array(37 * 19).fill(0)))).toEqual({ width: 37, height: 19 });
  });

  it("throws on a bad header", () => {
    expect(() => gifSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toThrow(/GIF87a\/GIF89a/);
  });
});

describe("parseGif", () => {
  it("decodes palette indices to DeviceRGB pixels", async () => {
    const { width, height, rgba } = await toRgba(makeGif(3, 2, RGB, [0, 1, 2, 2, 1, 0]));
    expect([width, height]).toEqual([3, 2]);
    // Row 0: red, green, blue (each with alpha 255).
    expect([...rgba.subarray(0, 12)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    // Row 1: blue, green, red.
    expect([...rgba.subarray(12, 24)]).toEqual([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255]);
  });

  it("produces an /SMask when a transparent index is set", async () => {
    const gif = makeGif(2, 2, RGB, [0, 1, 1, 0], { transparentIndex: 1 });
    const img = await parseGif(gif);
    expect(img.smask).toBeDefined();
    const { rgba } = await toRgba(gif);
    expect(rgba[3]).toBe(255); // index 0: opaque
    expect(rgba[7]).toBe(0); // index 1: transparent
  });

  it("leaves images without transparency fully opaque (no SMask)", async () => {
    const img = await parseGif(makeGif(2, 2, RGB, [0, 1, 2, 0]));
    expect(img.smask).toBeUndefined();
  });

  it("de-interlaces the 4-pass row order", async () => {
    // 8 rows, row value = row index in palette; interlaced storage order is
    // 0,8..(none),4,2,6,1,3,5,7 → the decoder must place them back in order.
    const pal: number[] = [];
    for (let i = 0; i < 8; i++) pal.push(i * 10, i * 10, i * 10);
    const idx: number[] = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 2; x++) idx.push(y);
    const { rgba } = await toRgba(makeGif(2, 8, pal, idx, { interlaced: true }));
    for (let y = 0; y < 8; y++) {
      expect(rgba[y * 2 * 4]).toBe(y * 10);
    }
  });

  it("decodes a large varied image that forces multiple LZW code-size increases", async () => {
    const pal: number[] = [];
    for (let i = 0; i < 256; i++) pal.push(i, (i * 7) % 256, (i * 13) % 256);
    const idx: number[] = [];
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) idx.push((x * y + x + y) % 256);
    const { rgba } = await toRgba(makeGif(48, 48, pal, idx));
    let bad = 0;
    for (let i = 0; i < 48 * 48; i++) {
      const c = idx[i]!;
      if (rgba[i * 4] !== c || rgba[i * 4 + 1] !== (c * 7) % 256 || rgba[i * 4 + 2] !== (c * 13) % 256) bad++;
    }
    expect(bad).toBe(0);
  });

  it("rejects a truncated file with no image frame", async () => {
    const trailerOnly = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b]);
    await expect(parseGif(trailerOnly)).rejects.toThrow(/no image frame|no image data/);
  });

  it("rejects oversized dimensions", async () => {
    const gif = makeGif(2, 2, RGB, [0, 0, 0, 0]);
    // Rewrite the logical screen size to 20000×20000 (> 67 MP cap).
    gif[6] = 0x20; gif[7] = 0x4e; gif[8] = 0x20; gif[9] = 0x4e;
    await expect(parseGif(gif)).rejects.toThrow(/too large/);
  });
});

describe("PDFDocument.image with GIF", () => {
  it("embeds a GIF like any other image", async () => {
    const doc = new PDFDocument();
    doc.image(makeGif(4, 4, RGB, new Array(16).fill(1)), { width: 100 });
    const bytes = await doc.render();
    expect(bytes.length).toBeGreaterThan(0);
    const header = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
    expect(header).toContain("%PDF-1.");
  });
});
