import { describe, expect, it } from "vitest";
import { detectFormat } from "../src/images/image";
import { parseJpeg } from "../src/images/jpeg";
import { parsePng, pngSize } from "../src/images/png";
import { deflate, inflate } from "../src/pdf/compress";
import { Name } from "../src/pdf/objects";

import { makeJpeg, makePng } from "./helpers";

describe("detectFormat", () => {
  it("throws on JPEGs without a SOF frame header", () => {
    expect(() => parseJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/no SOF/);
  });

  it("marks CMYK JPEGs with an inverted Decode array", () => {
    const parsed = parseJpeg(makeJpeg(4, 4, 4));
    expect(parsed.dict["ColorSpace"]).toEqual(new Name("DeviceCMYK"));
    expect(parsed.dict["Decode"]).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it("unfilters alpha PNGs with Sub/Up/Average/Paeth row filters", async () => {
    const png = await makePng(3, 4, 6, [10, 20, 30, 40], [1, 2, 3, 4]);
    const parsed = await parsePng(png);
    expect(parsed.smask).toBeDefined();
    expect(parsed.width).toBe(3);
  });

  it("rejects 16-bit PNGs with alpha", async () => {
    const png = await makePng(2, 2, 6, [1, 2, 3, 4]);
    png[24] = 16; // IHDR bit depth
    await expect(parsePng(png)).rejects.toThrow(/8-bit/);
  });

  it("detects JPEG and PNG signatures", async () => {
    expect(detectFormat(makeJpeg(2, 2))).toBe("jpeg");
    expect(detectFormat(await makePng(2, 2, 2, [255, 0, 0]))).toBe("png");
    expect(detectFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(null);
  });
});

describe("parseJpeg", () => {
  it("reads dimensions and color space from the SOF header", () => {
    const img = parseJpeg(makeJpeg(640, 480));
    expect(img.width).toBe(640);
    expect(img.height).toBe(480);
    expect((img.dict["ColorSpace"] as Name).value).toBe("DeviceRGB");
    expect((img.dict["Filter"] as Name).value).toBe("DCTDecode");
  });

  it("handles grayscale and CMYK", () => {
    expect((parseJpeg(makeJpeg(10, 10, 1)).dict["ColorSpace"] as Name).value).toBe("DeviceGray");
    const cmyk = parseJpeg(makeJpeg(10, 10, 4));
    expect((cmyk.dict["ColorSpace"] as Name).value).toBe("DeviceCMYK");
    expect(cmyk.dict["Decode"]).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it("rejects data without a frame header", () => {
    expect(() => parseJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/no SOF/);
  });
});

describe("parsePng", () => {
  it("probes dimensions synchronously", async () => {
    const png = await makePng(31, 17, 2, [1, 2, 3]);
    expect(pngSize(png)).toEqual({ width: 31, height: 17 });
  });

  it("embeds RGB PNGs via direct IDAT pass-through with PNG predictors", async () => {
    const png = await makePng(4, 3, 2, [10, 20, 30]);
    const img = await parsePng(png);
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
    expect((img.dict["Filter"] as Name).value).toBe("FlateDecode");
    expect(img.dict["DecodeParms"]).toMatchObject({ Predictor: 15, Colors: 3, Columns: 4 });
    expect(img.smask).toBeUndefined();
    // Data is the raw IDAT stream: inflating it yields filtered scanlines.
    const raw = await inflate(img.data);
    expect(raw.length).toBe(3 * (1 + 4 * 3));
  });

  it("splits alpha PNGs into color + SMask", async () => {
    const png = await makePng(2, 2, 6, [200, 100, 50, 128]);
    const img = await parsePng(png);
    expect((img.dict["ColorSpace"] as Name).value).toBe("DeviceRGB");
    expect(img.smask).toBeDefined();
    const color = await inflate(img.data);
    expect([...color]).toEqual([200, 100, 50, 200, 100, 50, 200, 100, 50, 200, 100, 50]);
    const alpha = await inflate(img.smask!);
    expect([...alpha]).toEqual([128, 128, 128, 128]);
  });
});
