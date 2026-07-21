import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/document/document";
import { ContentStream } from "../src/pdf/content";
import { parseXml } from "../src/svg/parse";
import { parsePath } from "../src/svg/path";
import { parseTransform, renderSvg, viewport, type SvgContext } from "../src/svg/render";
import type { RGB } from "../src/types/index";

/** Render SVG source to a content-stream operator string, capturing text calls. */
function render(svg: string, currentColor: RGB = { r: 0, g: 0, b: 0 }): { ops: string; texts: unknown[][] } {
  const content = new ContentStream();
  const texts: unknown[][] = [];
  const ctx: SvgContext = {
    content,
    gsRes: () => "GS0",
    currentColor,
    drawText: (...args) => texts.push(args),
  };
  renderSvg(parseXml(svg), [1, 0, 0, 1, 0, 0], ctx);
  return { ops: new TextDecoder("latin1").decode(content.toBytes()), texts };
}

const wrap = (body: string, attrs = 'viewBox="0 0 100 100"'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

describe("parseXml", () => {
  it("parses nested elements and strips namespace prefixes", () => {
    const svg = parseXml('<svg:svg viewBox="0 0 1 1"><svg:g><svg:rect/></svg:g></svg:svg>');
    expect(svg.tag).toBe("svg");
    expect(svg.children[0]!.tag).toBe("g");
    expect(svg.children[0]!.children[0]!.tag).toBe("rect");
  });

  it("decodes entities and reads attributes with either quote style", () => {
    const svg = parseXml(`<svg viewBox='0 0 1 1'><text>a &amp; b &#65;</text></svg>`);
    expect(svg.children[0]!.text).toBe("a & b A");
  });

  it("skips comments, doctype and processing instructions", () => {
    const svg = parseXml('<?xml version="1.0"?><!-- hi --><svg viewBox="0 0 1 1"><rect/></svg>');
    expect(svg.children[0]!.tag).toBe("rect");
  });

  it("throws when there is no <svg> root", () => {
    expect(() => parseXml("<html><body/></html>")).toThrow(/no <svg>/);
  });
});

describe("parsePath", () => {
  it("handles absolute and relative move/line and H/V", () => {
    const segs = parsePath("M10 10 L20 20 H30 V40 l5 5 Z");
    expect(segs[0]).toEqual({ op: "M", x: 10, y: 10 });
    expect(segs[1]).toEqual({ op: "L", x: 20, y: 20 });
    expect(segs[2]).toEqual({ op: "L", x: 30, y: 20 });
    expect(segs[3]).toEqual({ op: "L", x: 30, y: 40 });
    expect(segs[4]).toEqual({ op: "L", x: 35, y: 45 });
    expect(segs[5]).toEqual({ op: "Z" });
  });

  it("treats extra coordinate pairs after M as implicit line-tos", () => {
    const segs = parsePath("M0 0 1 1 2 2");
    expect(segs.map((s) => s.op)).toEqual(["M", "L", "L"]);
  });

  it("elevates quadratic curves to cubic", () => {
    const seg = parsePath("M0 0 Q30 0 30 30")[1]!;
    expect(seg.op).toBe("C");
    if (seg.op === "C") {
      expect(seg.x1).toBeCloseTo(20);
      expect(seg.y1).toBeCloseTo(0);
      expect(seg.x).toBe(30);
      expect(seg.y).toBe(30);
    }
  });

  it("reflects the control point for smooth curves (S)", () => {
    const s = parsePath("M0 0 C0 10 10 10 10 0 S20 -10 20 0")[2]!;
    // Reflect the previous control (10,10) about the current point (10,0).
    if (s.op === "C") expect([s.x1, s.y1]).toEqual([10, -10]);
  });

  it("converts an arc into cubic Bézier segments", () => {
    const segs = parsePath("M0 0 A50 50 0 1 1 100 0");
    const curves = segs.filter((s) => s.op === "C");
    expect(curves.length).toBeGreaterThanOrEqual(2); // large arc → several segments
    expect(segs[0]).toEqual({ op: "M", x: 0, y: 0 });
  });

  it("collapses a zero-radius arc to a line", () => {
    const segs = parsePath("M0 0 A0 0 0 0 1 10 10");
    expect(segs[1]).toEqual({ op: "L", x: 10, y: 10 });
  });
});

describe("parseTransform", () => {
  it("builds a translate matrix", () => {
    expect(parseTransform("translate(10,20)")).toEqual([1, 0, 0, 1, 10, 20]);
  });

  it("builds a scale matrix", () => {
    expect(parseTransform("scale(2,3)")).toEqual([2, 0, 0, 3, 0, 0]);
  });

  it("composes multiple transforms left-to-right", () => {
    // translate then scale: point (1,1) → scale first (2,2) → translate (12,12)
    const m = parseTransform("translate(10,10) scale(2)");
    const x = m[0] * 1 + m[2] * 1 + m[4];
    const y = m[1] * 1 + m[3] * 1 + m[5];
    expect([x, y]).toEqual([12, 12]);
  });
});

describe("viewport", () => {
  it("reads the viewBox", () => {
    expect(viewport(parseXml(wrap("", 'viewBox="5 6 200 100"'))).viewBox).toEqual([5, 6, 200, 100]);
  });

  it("falls back to width/height when no viewBox is present", () => {
    const v = viewport(parseXml(wrap("", 'width="80" height="40"')));
    expect(v.viewBox).toEqual([0, 0, 80, 40]);
    expect([v.width, v.height]).toEqual([80, 40]);
  });
});

describe("renderSvg", () => {
  it("fills a rect with its colour and emits a fill operator", () => {
    const { ops } = render(wrap('<rect x="0" y="0" width="10" height="10" fill="#ff0000"/>'));
    expect(ops).toContain("1 0 0 rg"); // red fill colour
    expect(ops).toMatch(/\bf\b/); // fill operator
  });

  it("emits stroke operators with scaled line width for stroked shapes", () => {
    const { ops } = render(wrap('<circle cx="5" cy="5" r="4" fill="none" stroke="#00ff00" stroke-width="2"/>'));
    expect(ops).toContain("0 1 0 RG"); // green stroke
    expect(ops).toContain(" c\n"); // circle → Bézier curves
    expect(ops).toMatch(/\bS\b/);
  });

  it("discards a path with neither fill nor stroke (fill:none)", () => {
    const { ops } = render(wrap('<rect width="10" height="10" fill="none"/>'));
    expect(ops).toMatch(/\bn\b/);
    expect(ops).not.toMatch(/\bf\b/);
  });

  it("resolves named colours, rgb() and currentColor", () => {
    expect(render(wrap('<rect width="1" height="1" fill="rebeccapurple"/>')).ops).not.toContain("rg\n1 1 1"); // parsed, not white default
    expect(render(wrap('<rect width="1" height="1" fill="rgb(255,128,0)"/>')).ops).toContain("1 0.502 0 rg");
    const cur = render(wrap('<rect width="1" height="1" fill="currentColor"/>'), { r: 1, g: 0, b: 0 });
    expect(cur.ops).toContain("1 0 0 rg");
  });

  it("uses an ExtGState for fill-opacity", () => {
    const { ops } = render(wrap('<rect width="10" height="10" fill="#000000" fill-opacity="0.5"/>'));
    expect(ops).toContain("/GS0 gs");
  });

  it("passes text through to drawText with the resolved anchor", () => {
    const { texts } = render(wrap('<text x="50" y="20" text-anchor="middle" fill="#000">Hi</text>'));
    expect(texts).toHaveLength(1);
    expect(texts[0]![0]).toBe("Hi");
    expect(texts[0]![5]).toBe("middle");
  });

  it("draws ellipses, lines, polygons and polylines", () => {
    expect(render(wrap('<ellipse cx="5" cy="5" rx="4" ry="2" fill="#000"/>')).ops).toMatch(/\bc\b/);
    expect(render(wrap('<line x1="0" y1="0" x2="9" y2="9" stroke="#000"/>')).ops).toMatch(/\bS\b/);
    expect(render(wrap('<polygon points="0,0 9,0 9,9" fill="#000"/>')).ops).toMatch(/\bf\b/);
    expect(render(wrap('<polyline points="0,0 9,0 9,9" fill="none" stroke="#000"/>')).ops).toMatch(/\bS\b/);
  });

  it("skips elements with display:none", () => {
    const { ops } = render(wrap('<rect width="9" height="9" fill="#000" display="none"/>'));
    expect(ops.trim()).toBe("q\nQ"); // only the outer save/restore
  });

  it("descends into unknown wrapper elements", () => {
    const { ops } = render(wrap('<switch><rect width="9" height="9" fill="#000"/></switch>'));
    expect(ops).toMatch(/\bf\b/);
  });

  it("applies group transforms to child geometry", () => {
    const plain = render(wrap('<rect x="0" y="0" width="10" height="10" fill="#000"/>')).ops;
    const shifted = render(wrap('<g transform="translate(100,0)"><rect x="0" y="0" width="10" height="10" fill="#000"/></g>')).ops;
    expect(plain).not.toBe(shifted); // the translate moved the coordinates
    expect(shifted).toContain("100 ");
  });
});

describe("PDFDocument.svg", () => {
  const LOGO = '<svg viewBox="0 0 24 24"><path d="M4 4 L20 4 L12 20 Z" fill="#2563eb"/></svg>';

  it("renders a valid PDF and advances the cursor in flow mode", async () => {
    const doc = new PDFDocument();
    const before = doc.y;
    doc.svg(LOGO, { width: 120 });
    expect(doc.y).toBeGreaterThan(before);
    const bytes = await doc.render();
    expect(new TextDecoder("latin1").decode(bytes.subarray(0, 8))).toContain("%PDF-1.");
  });

  it("does not move the cursor in absolute mode", () => {
    const doc = new PDFDocument();
    const before = doc.y;
    doc.svg(LOGO, { width: 120, x: 40, y: 200 });
    expect(doc.y).toBe(before);
  });

  it("accepts a Uint8Array source", async () => {
    const doc = new PDFDocument();
    doc.svg(new TextEncoder().encode(LOGO), { width: 100 });
    expect((await doc.render()).length).toBeGreaterThan(0);
  });

  it("throws on a zero-sized viewBox", () => {
    const doc = new PDFDocument();
    expect(() => doc.svg('<svg viewBox="0 0 0 0"><rect/></svg>')).toThrow(/zero-sized/);
  });
});
