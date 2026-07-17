import { describe, expect, it } from "vitest";
import { resolveFont } from "../src/fonts/font";
import { encodeWinAnsi, winAnsiByte } from "../src/fonts/winansi";

describe("WinAnsi encoding", () => {
  it("passes ASCII through", () => {
    expect(encodeWinAnsi("Hello!")).toBe("Hello!");
  });

  it("maps Latin-1 (umlauts, ß) to their byte values", () => {
    const encoded = encodeWinAnsi("äöüß");
    expect([...encoded].map((c) => c.charCodeAt(0))).toEqual([0xe4, 0xf6, 0xfc, 0xdf]);
  });

  it("maps Windows extras (€, dashes, curly quotes)", () => {
    expect(winAnsiByte("€".codePointAt(0)!)).toBe(0x80);
    expect(winAnsiByte("–".codePointAt(0)!)).toBe(0x96);
    expect(winAnsiByte("“".codePointAt(0)!)).toBe(0x93);
  });

  it("replaces unmappable characters with '?'", () => {
    expect(encodeWinAnsi("日本")).toBe("??");
  });
});

describe("StandardFont", () => {
  it("resolves families and styles to the right base fonts", () => {
    expect(resolveFont("helvetica", false, false).baseFont).toBe("Helvetica");
    expect(resolveFont("helvetica", true, false).baseFont).toBe("Helvetica-Bold");
    expect(resolveFont("helvetica", false, true).baseFont).toBe("Helvetica-Oblique");
    expect(resolveFont("times", true, true).baseFont).toBe("Times-BoldItalic");
    expect(resolveFont("courier", true, false).baseFont).toBe("Courier-Bold");
  });

  it("measures with real AFM widths", () => {
    const helv = resolveFont("helvetica", false, false);
    // H=722 e=556 l=222 l=222 o=556 → 2278/1000 * 10pt
    expect(helv.widthOf("Hello", 10)).toBeCloseTo(22.78, 2);
    // Courier is monospaced at 600.
    const courier = resolveFont("courier", false, false);
    expect(courier.widthOf("abc", 10)).toBeCloseTo(18, 5);
  });

  it("measures accented characters like their base letters", () => {
    const helv = resolveFont("helvetica", false, false);
    expect(helv.widthOf("ä", 10)).toBeCloseTo(helv.widthOf("a", 10), 5);
    expect(helv.widthOf("É", 10)).toBeCloseTo(helv.widthOf("E", 10), 5);
  });

  it("bold is wider than regular", () => {
    const regular = resolveFont("helvetica", false, false);
    const bold = resolveFont("helvetica", true, false);
    expect(bold.widthOf("Invoice", 12)).toBeGreaterThan(regular.widthOf("Invoice", 12));
  });
});
