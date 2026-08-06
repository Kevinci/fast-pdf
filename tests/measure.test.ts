import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/index";
import { latin1String } from "../src/pdf/objects";
import { makeTTF, makePng } from "./helpers";

const raw = () => new PDFDocument({ compress: false });

async function rendered(pdf: PDFDocument): Promise<string> {
  return latin1String(await pdf.render());
}

/** Count the text-showing operators in a content stream. */
function countTj(text: string): number {
  return (text.match(/ Tj/g) ?? []).length;
}

describe("measureText()", () => {
  it("returns the very lines text() draws", async () => {
    const pdf = raw();
    const content = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod";
    const m = pdf.measureText(content, { width: 120 });
    pdf.text(content, { width: 120 });
    const text = await rendered(pdf);
    expect(m.lines.length).toBeGreaterThan(1);
    expect(countTj(text)).toBe(m.lines.length);
    for (const line of m.lines) expect(text).toContain(line);
  });

  it("height matches the cursor advance of the equivalent text() call", () => {
    const pdf = raw();
    const content = "Ein etwas längerer Absatz, der über mehrere Zeilen umbrechen muss.";
    const m = pdf.measureText(content, { width: 140, size: 9, lineHeight: 1.4 });
    const before = pdf.y;
    pdf.text(content, { width: 140, size: 9, lineHeight: 1.4 });
    expect(pdf.y - before).toBeCloseTo(m.height, 6);
  });

  it("reports the widest line, honouring letterSpacing", () => {
    const pdf = raw();
    const plain = pdf.measureText("ABCDEF", { width: 500 });
    const spaced = pdf.measureText("ABCDEF", { width: 500, letterSpacing: 2 });
    // 6 glyphs → 5 gaps of 2pt.
    expect(spaced.width).toBeCloseTo(plain.width + 10, 6);
  });

  it("defaults to the flow width, and to the absolute width when y is given", () => {
    const pdf = new PDFDocument({ margins: 50 });
    // Flow: full content width (495pt). Absolute at x=300: only 245pt left.
    const flow = pdf.measureText("x".repeat(400));
    const absolute = pdf.measureText("x".repeat(400), { y: 100, x: 300 });
    expect(absolute.lines.length).toBeGreaterThan(flow.lines.length);
    expect(flow.width).toBeLessThanOrEqual(495);
    expect(absolute.width).toBeLessThanOrEqual(245);
  });

  it("reports the baseline offset text() actually uses", async () => {
    const pdf = raw();
    const m = pdf.measureText("Hg", { size: 20 });
    pdf.text("Hg", { size: 20, x: 0, y: 0 });
    const text = await rendered(pdf);
    // Baseline in PDF space = pageHeight - (0 + baseline).
    const expected = pdf.pageSize.height - m.baseline;
    expect(text).toMatch(new RegExp(`0 ${expected.toFixed(2).replace(/\.?0+$/, "")}`));
  });

  it("does not draw anything", async () => {
    const pdf = raw();
    pdf.measureText("invisible", { width: 200 });
    expect(await rendered(pdf)).not.toContain("invisible");
  });
});

describe("measureBlock()", () => {
  it("matches the height the same content consumes when drawn", () => {
    const build = (d: PDFDocument): void => {
      d.text("Überschrift", { bold: true, size: 14, spacingAfter: 6 });
      d.text("Ein Fließtext, der über mehrere Zeilen läuft und dabei umbricht.");
      d.text("Noch eine Zeile.", { spacingAfter: 4 });
    };
    const pdf = raw();
    const { height } = pdf.measureBlock(build, { width: 200 });
    const before = pdf.y;
    pdf.container({ width: 200 }, build);
    expect(pdf.y - before).toBeCloseTo(height, 6);
  });

  it("draws nothing and leaves the cursor untouched", async () => {
    const pdf = raw();
    const y = pdf.y;
    pdf.measureBlock((d) => d.text("ghost content"));
    expect(pdf.y).toBe(y);
    expect(await rendered(pdf)).not.toContain("ghost content");
  });

  it("rolls back anchors, bookmarks and images created while measuring", async () => {
    const png = await makePng(2, 2, 2, [255, 0, 0]);
    const pdf = raw();
    pdf.measureBlock((d) => {
      d.anchor("ghost");
      d.outline("Ghost heading");
      d.image(png, { width: 20 });
    });
    pdf.text("real");
    const text = await rendered(pdf);
    expect(text).not.toContain("Ghost heading");
    expect(text).not.toContain("/Outlines");
    expect(text).not.toContain("/XObject");
  });

  it("creates no extra pages even when the block is taller than one", () => {
    const pdf = raw();
    pdf.measureBlock((d) => {
      for (let i = 0; i < 200; i++) d.text(`line ${i}`);
    });
    expect(pdf.pageCount).toBe(1);
  });

  it("measures against the requested width", () => {
    const pdf = raw();
    const long = "Wort ".repeat(40);
    const narrow = pdf.measureBlock((d) => d.text(long), { width: 100 });
    const wide = pdf.measureBlock((d) => d.text(long), { width: 400 });
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(narrow.width).toBe(100);
  });
});

describe("fontMetrics()", () => {
  it("exposes the baseline text() places glyphs on", () => {
    const pdf = raw();
    const m = pdf.fontMetrics({ size: 10 });
    // Helvetica ascent is 718/1000 em.
    expect(m.baseline).toBeCloseTo(7.18, 6);
    expect(m.ascent).toBeCloseTo(7.18, 6);
    expect(m.descent).toBeCloseTo(-2.07, 6);
    expect(m.capHeight).toBeCloseTo(7.18, 6);
    expect(m.lineGap).toBe(0);
    expect(m.lineHeight).toBeCloseTo(12.5, 6);
  });

  it("differs per family and scales with size", () => {
    const pdf = raw();
    const helvetica = pdf.fontMetrics({ size: 100 });
    const times = pdf.fontMetrics({ size: 100, font: "times" });
    expect(times.capHeight).toBeCloseTo(66.2, 6);
    expect(helvetica.capHeight).not.toBeCloseTo(times.capHeight, 3);
  });

  it("reads real metrics from an embedded font", () => {
    const pdf = raw();
    pdf.registerFont(makeTTF(), { family: "test" });
    const m = pdf.fontMetrics({ font: "test", size: 100 });
    expect(m.ascent).toBeCloseTo(80, 6); // 800/1000 em
    expect(m.descent).toBeCloseTo(-20, 6);
  });
});

describe("lastBlockHeight", () => {
  it("reports the height of a flow text block", () => {
    const pdf = raw();
    pdf.text("Zwei Zeilen Text, die hier sicher umbrechen werden.", {
      width: 100,
      size: 10,
      lineHeight: 1.2,
    });
    expect(pdf.lastBlockHeight).toBeCloseTo(
      pdf.measureText("Zwei Zeilen Text, die hier sicher umbrechen werden.", {
        width: 100,
        size: 10,
        lineHeight: 1.2,
      }).height,
      6,
    );
  });

  it("reports the height of an ABSOLUTE block, where the cursor never moves", () => {
    const pdf = raw();
    const y = pdf.y;
    pdf.text("Ein absolut positionierter Block über mehrere Zeilen hinweg.", {
      x: 40,
      y: 200,
      width: 110,
      size: 9,
    });
    expect(pdf.y).toBe(y); // cursor untouched, as documented
    expect(pdf.lastBlockHeight).toBeGreaterThan(9 * 1.25); // more than one line
    const m = pdf.measureText("Ein absolut positionierter Block über mehrere Zeilen hinweg.", {
      x: 40,
      y: 200,
      width: 110,
      size: 9,
    });
    expect(pdf.lastBlockHeight).toBeCloseTo(m.height, 6);
  });

  it("excludes spacingAfter", () => {
    const pdf = raw();
    pdf.text("Eine Zeile", { size: 10, lineHeight: 1.2, spacingAfter: 30 });
    expect(pdf.lastBlockHeight).toBeCloseTo(12, 6);
  });

  it("reports image and table heights", async () => {
    const png = await makePng(4, 4, 2, [0, 0, 255]);
    const pdf = raw();
    pdf.image(png, { width: 60, height: 40, spacingAfter: 20 });
    expect(pdf.lastBlockHeight).toBeCloseTo(40, 6);
    const before = pdf.y;
    pdf.table([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(pdf.lastBlockHeight).toBeCloseTo(pdf.y - before, 6);
  });
});

describe("widthOfText()", () => {
  it("now accounts for letterSpacing (0.5.0 ignored it)", () => {
    const pdf = raw();
    const plain = pdf.widthOfText("VERSALIEN");
    const spaced = pdf.widthOfText("VERSALIEN", { letterSpacing: 1.5 });
    expect(spaced).toBeCloseTo(plain + 8 * 1.5, 6); // 9 glyphs → 8 gaps
  });

  it("agrees with what the renderer lays out", () => {
    const pdf = raw();
    const m = pdf.measureText("KONTAKT", { width: 500, letterSpacing: 2, size: 8 });
    expect(pdf.widthOfText("KONTAKT", { letterSpacing: 2, size: 8 })).toBeCloseTo(m.width, 6);
  });
});
