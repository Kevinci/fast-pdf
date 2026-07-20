import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/document/document";
import { FastPDFError } from "../src/errors";
import { fmtNumber, latin1String, Name, serialize } from "../src/pdf/objects";
import { assertFinite, assertNonNegative } from "../src/validate";
import { deflate, inflate } from "../src/pdf/compress";
import { parsePng, pngSize } from "../src/images/png";

import { makeJpeg, makePng, makeTTF } from "./helpers";

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof FastPDFError) return e.code;
    throw e;
  }
  throw new Error("expected a FastPDFError");
};

describe("link target validation", () => {
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "vbscript:x", "data:text/html,x", "file:///etc/passwd"])(
    "rejects %s",
    (target) => {
      const doc = new PDFDocument();
      expect(code(() => doc.link(0, 0, 10, 10, target))).toBe("UNSAFE_LINK");
      expect(code(() => doc.text("hi", { link: target }))).toBe("UNSAFE_LINK");
    },
  );

  it("rejects schemes disguised with control characters or spaces", () => {
    const doc = new PDFDocument();
    expect(code(() => doc.link(0, 0, 10, 10, "java\nscript:alert(1)"))).toBe("UNSAFE_LINK");
    expect(code(() => doc.link(0, 0, 10, 10, "  file:///x"))).toBe("UNSAFE_LINK");
  });

  it("allows http(s), mailto, custom app schemes and anchors", () => {
    const doc = new PDFDocument();
    doc.anchor("top");
    doc.link(0, 0, 10, 10, "https://example.com");
    doc.link(0, 20, 10, 10, "mailto:billing@example.com");
    doc.link(0, 40, 10, 10, "myapp://open");
    doc.link(0, 60, 10, 10, "#top");
    expect(doc.pageCount).toBe(1);
  });

  it("reports invalid URIs (lone surrogates) as FastPDFError at render", async () => {
    const doc = new PDFDocument();
    doc.link(0, 0, 10, 10, "https://example.com/\ud800");
    await expect(doc.render()).rejects.toThrow(FastPDFError);
  });
});

describe("text content injection", () => {
  it("escapes PDF string delimiters coming from user data", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.text(") Tj ET /Nasty << >> ( \\", { link: "https://example.com" });
    const pdf = latin1String(await doc.render());
    // Every delimiter of the user string must arrive escaped, in one literal.
    expect(pdf).toContain("(\\) Tj ET /Nasty << >> \\( \\\\)");
  });

  it("escapes delimiters in metadata strings", async () => {
    const doc = new PDFDocument({ compress: false, metadata: { title: "a(b)c\\d" } });
    const pdf = latin1String(await doc.render());
    expect(pdf).toContain("(a\\(b\\)c\\\\d)");
  });
});

describe("numeric input validation", () => {
  it.each([NaN, Infinity, -Infinity, 1e21, -1e21])(
    "rejects %s at the drawing entry points with INVALID_NUMBER",
    (bad) => {
      const doc = new PDFDocument();
      expect(code(() => doc.rect(bad, 0, 10, 10))).toBe("INVALID_NUMBER");
      expect(code(() => doc.line(0, bad, 10, 10))).toBe("INVALID_NUMBER");
      expect(code(() => doc.circle(0, 0, bad))).toBe("INVALID_NUMBER");
      expect(code(() => doc.ellipse(0, 0, 5, bad))).toBe("INVALID_NUMBER");
      expect(code(() => doc.text("hi", { size: bad }))).toBe("INVALID_NUMBER");
      expect(code(() => doc.text("hi", { x: bad }))).toBe("INVALID_NUMBER");
    },
  );

  it("fails fast at the call site, not later at render", () => {
    const doc = new PDFDocument();
    // The throw must happen synchronously on the bad call — not deferred to render().
    expect(() => doc.rect(NaN, 0, 10, 10)).toThrow(FastPDFError);
  });

  it("accepts the largest still-representable magnitude", () => {
    const doc = new PDFDocument();
    expect(() => doc.rect(0, 0, 1e20, 1e20)).not.toThrow();
  });

  it("assertFinite / assertNonNegative guard their contracts", () => {
    expect(assertFinite(3.5, "x")).toBe(3.5);
    expect(code(() => assertFinite(NaN, "x"))).toBe("INVALID_NUMBER");
    expect(code(() => assertFinite(Infinity, "x"))).toBe("INVALID_NUMBER");
    expect(assertNonNegative(0, "x")).toBe(0);
    expect(code(() => assertNonNegative(-1, "x"))).toBe("INVALID_NUMBER");
  });
});

describe("PDF syntax hardening", () => {
  it("rejects numbers that would serialize in exponent notation", () => {
    expect(() => fmtNumber(1e21)).toThrow(/too large/);
    expect(() => fmtNumber(1e21)).toThrow(FastPDFError);
    expect(code(() => fmtNumber(NaN))).toBe("INVALID_NUMBER");
    expect(fmtNumber(1e20)).toBe("100000000000000000000");
  });

  it("escapes non-ASCII name characters as two-digit UTF-8 escapes", () => {
    expect(serialize(new Name("a→b"))).toBe("/a#E2#86#92b");
    expect(serialize(new Name("weiß"))).toBe("/wei#C3#9F");
  });
});

describe("image parser hardening", () => {
  it("rejects PNGs whose first chunk is not IHDR", () => {
    const junk = new Uint8Array(32);
    junk.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const doc = new PDFDocument();
    expect(code(() => doc.image(junk))).toBe("INVALID_IMAGE_FILE");
    expect(() => pngSize(junk.subarray(0, 20))).toThrow(FastPDFError);
  });

  it("rejects truncated PNG chunks", async () => {
    const png = await makePng(2, 2, 2, [255, 0, 0]);
    // Cut past IEND (12) and the IDAT CRC (4), one byte into the IDAT data.
    await expect(parsePng(png.subarray(0, png.length - 17))).rejects.toThrow(/truncated/);
  });

  it("caps the alpha decode path by pixel count", async () => {
    const png = await makePng(2, 2, 6, [1, 2, 3, 4]);
    const view = new DataView(png.buffer, png.byteOffset);
    view.setUint32(16, 20000); // IHDR width
    view.setUint32(20, 20000); // IHDR height
    await expect(parsePng(png)).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("rejects zlib bombs whose IDAT exceeds the declared dimensions", async () => {
    const png = await makePng(10, 10, 6, [1, 2, 3, 4]);
    const view = new DataView(png.buffer, png.byteOffset);
    view.setUint32(16, 1);
    view.setUint32(20, 1);
    await expect(parsePng(png)).rejects.toMatchObject({ code: "INVALID_IMAGE_FILE" });
  });

  it("rejects IDAT data shorter than the declared dimensions", async () => {
    const png = await makePng(4, 4, 6, [1, 2, 3, 4]);
    const view = new DataView(png.buffer, png.byteOffset);
    view.setUint32(16, 8);
    view.setUint32(20, 8);
    await expect(parsePng(png)).rejects.toThrow(/truncated/);
  });

  it("rejects JPEGs with zero dimensions", () => {
    const doc = new PDFDocument();
    expect(code(() => doc.image(makeJpeg(0, 10)))).toBe("INVALID_IMAGE_FILE");
  });
});

describe("decompression limit", () => {
  it("inflate() aborts once the output crosses maxBytes", async () => {
    const big = new Uint8Array(1 << 20); // 1 MiB of zeros compresses to ~1 KiB
    const packed = (await deflate(big))!;
    expect(packed.length).toBeLessThan(5000);
    await expect(inflate(packed, 1024)).rejects.toThrow(/limit/);
    expect((await inflate(packed, big.length)).length).toBe(big.length);
  });
});

describe("font input hardening", () => {
  it("normalizes parser crashes on corrupt fonts to INVALID_FONT_FILE", () => {
    const doc = new PDFDocument();
    const corrupt = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0xff, 0xff]);
    expect(code(() => doc.registerFont(corrupt, { family: "broken" }))).toBe("INVALID_FONT_FILE");
  });

  it("still accepts a valid TrueType font", () => {
    const doc = new PDFDocument();
    doc.registerFont(makeTTF(), { family: "testfont" });
    doc.text("ABC", { font: "testfont" });
    expect(doc.pageCount).toBe(1);
  });
});
