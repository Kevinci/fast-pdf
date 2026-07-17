import { describe, expect, it } from "vitest";
import { TTFFont } from "../src/fonts/ttf";
import { EmbeddedFont } from "../src/fonts/embedded";
import { closeGlyphSet, subsetTTF } from "../src/fonts/subset";
import { PDFDocument } from "../src/index";
import { latin1String } from "../src/pdf/objects";
import { makeTTF } from "./helpers";

const ttfBytes = makeTTF();

describe("TTFFont parser", () => {
  const font = new TTFFont(ttfBytes);

  it("reads metrics and descriptor data", () => {
    expect(font.unitsPerEm).toBe(1000);
    expect(font.numGlyphs).toBe(4);
    expect(font.ascent).toBe(800);
    expect(font.descent).toBe(-200);
    expect(font.postScriptName).toBe("TestFont");
    expect(font.capHeight).toBe(800); // no OS/2 → falls back to ascent
  });

  it("maps code points through the format-4 cmap", () => {
    expect(font.glyphFor(0x41)).toBe(1);
    expect(font.glyphFor(0x42)).toBe(2);
    expect(font.glyphFor(0x43)).toBe(3);
    expect(font.glyphFor(0x44)).toBe(0); // unmapped → .notdef
    expect(font.glyphFor(0x1f600)).toBe(0); // beyond BMP in format 4
  });

  it("reads advances and composite components", () => {
    expect(font.advanceOf(1)).toBe(600);
    expect(font.componentsOf(1)).toEqual([]);
    expect(font.componentsOf(3)).toEqual([1]);
  });

  it("rejects unsupported container formats with actionable errors", () => {
    const withSig = (sig: number): Uint8Array => {
      const b = ttfBytes.slice();
      new DataView(b.buffer).setUint32(0, sig);
      return b;
    };
    expect(() => new TTFFont(withSig(0x4f54544f))).toThrow(/CFF/);
    expect(() => new TTFFont(withSig(0x74746366)).numGlyphs).toThrow(/collections/);
    expect(() => new TTFFont(withSig(0x774f4646))).toThrow(/WOFF/);
    expect(() => new TTFFont(withSig(0xdeadbeef))).toThrow(/sfnt/);
  });
});

describe("subsetting", () => {
  const font = new TTFFont(ttfBytes);

  it("closes glyph sets over composite components and .notdef", () => {
    const closed = closeGlyphSet(font, [3]);
    expect([...closed].sort()).toEqual([0, 1, 3]);
  });

  it("drops unused outlines from glyf", () => {
    const all = subsetTTF(font, new Set([1, 2, 3]));
    const some = subsetTTF(font, new Set([3]));
    expect(some.length).toBeLessThan(all.length);
    expect(new DataView(all.buffer).getUint32(0)).toBe(0x00010000);
  });
});

describe("embedded fonts end-to-end", () => {
  it("encodes 2-byte glyph IDs and measures via font units", () => {
    const font = new EmbeddedFont("emb:test:0", makeTTF());
    expect(font.encode("A")).toBe("\x00\x01");
    expect(font.widthOf("AB", 10)).toBeCloseTo(12, 5); // 2 × 600/1000 × 10
    expect(font.ascent).toBe(800);
  });

  it("embeds a subsetted Type0 font with ToUnicode CMap", async () => {
    const pdf = new PDFDocument({ compress: false });
    pdf.registerFont(makeTTF(), { family: "testfont" });
    pdf.text("ABC", { font: "testfont" });
    const text = latin1String(await pdf.render());
    expect(text).toContain("/Subtype /Type0");
    expect(text).toContain("/Encoding /Identity-H");
    expect(text).toContain("/Subtype /CIDFontType2");
    expect(text).toContain("/FontFile2");
    expect(text).toContain("/ToUnicode");
    expect(text).toContain("/CIDToGIDMap /Identity");
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+TestFont/);
    expect(text).toContain("beginbfchar");
  });

  it("falls back to the regular cut for missing variants", async () => {
    const pdf = new PDFDocument();
    pdf.registerFont(makeTTF(), { family: "testfont" });
    pdf.text("AB", { font: "testfont", bold: true });
    const text = latin1String(await pdf.render());
    expect(text).toContain("/Subtype /Type0");
  });

  it("refuses to shadow built-in family names", () => {
    const pdf = new PDFDocument();
    expect(() => pdf.registerFont(makeTTF(), { family: "helvetica" })).toThrow(/built-in/);
  });

  it("rejects text in unregistered families", () => {
    const pdf = new PDFDocument();
    expect(() => pdf.text("x", { font: "nope" })).toThrow(/Unknown font family/);
  });
});
