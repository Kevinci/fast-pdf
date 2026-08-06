import { describe, expect, it } from "vitest";
import { FastPDFError, PDFDocument } from "../src/index";
import { latin1String } from "../src/pdf/objects";

const raw = () => new PDFDocument({ compress: false });

async function rendered(pdf: PDFDocument): Promise<string> {
  return latin1String(await pdf.render());
}

describe("ensureSpace() / remainingHeight", () => {
  it("reports the room left below the cursor", () => {
    const pdf = new PDFDocument({ margins: 50 });
    expect(pdf.remainingHeight).toBeCloseTo(pdf.pageSize.height - 100, 6);
    pdf.y = 700;
    expect(pdf.remainingHeight).toBeCloseTo(pdf.pageSize.height - 50 - 700, 6);
  });

  it("breaks only when the block no longer fits", () => {
    const pdf = raw();
    pdf.y = 300;
    expect(pdf.ensureSpace(100)).toBe(false);
    expect(pdf.pageCount).toBe(1);
    expect(pdf.ensureSpace(800)).toBe(true);
    expect(pdf.pageCount).toBe(2);
    expect(pdf.y).toBeCloseTo(50, 6);
  });

  it("never breaks at the very top of a page (an over-tall block has nowhere to go)", () => {
    const pdf = raw();
    expect(pdf.ensureSpace(5000)).toBe(false);
    expect(pdf.pageCount).toBe(1);
  });

  it("is a no-op inside container(), where breaks are forbidden", () => {
    const pdf = raw();
    let broke: boolean | undefined;
    pdf.container({ width: 200 }, (d) => {
      d.y = 700;
      broke = d.ensureSpace(500);
    });
    expect(broke).toBe(false);
    expect(pdf.pageCount).toBe(1);
  });
});

describe("keepTogether()", () => {
  it("moves a block that does not fit to the next page, whole", async () => {
    const pdf = raw();
    pdf.y = 700; // ~92pt left before the bottom margin
    pdf.keepTogether((d) => {
      d.text("Kopf der Gruppe", { bold: true });
      for (let i = 0; i < 8; i++) d.text(`Zeile ${i}`);
    });
    expect(pdf.pageCount).toBe(2);
    const text = await rendered(pdf);
    // All nine lines live on the second page: one content stream holds them.
    const streams = text.split("stream");
    const withHead = streams.filter((s) => s.includes("Kopf der Gruppe"));
    expect(withHead).toHaveLength(1);
    expect(withHead[0]).toContain("Zeile 7");
  });

  it("leaves a fitting block where it is", () => {
    const pdf = raw();
    pdf.keepTogether((d) => d.text("kurz"));
    expect(pdf.pageCount).toBe(1);
  });

  it("draws the content exactly once", async () => {
    const pdf = raw();
    pdf.keepTogether((d) => d.text("einmalig"));
    const text = await rendered(pdf);
    expect(text.split("einmalig")).toHaveLength(2); // one occurrence
  });
});

describe("spacingBefore", () => {
  it("adds space between blocks", () => {
    const pdf = raw();
    pdf.text("erste");
    const y = pdf.y;
    pdf.text("zweite", { spacingBefore: 20 });
    expect(pdf.y - y).toBeCloseTo(20 + pdf.lastBlockHeight, 6);
  });

  it("collapses at the top of a page", () => {
    const pdf = raw();
    const y = pdf.y;
    pdf.text("erste Zeile der Seite", { spacingBefore: 40 });
    expect(pdf.y - y).toBeCloseTo(pdf.lastBlockHeight, 6);
  });

  it("collapses at the top of a column, but not below it", () => {
    const pdf = raw();
    let first = 0;
    let second = 0;
    pdf.columns([
      (d) => {
        const start = d.y;
        d.text("Spaltenkopf", { spacingBefore: 30 });
        first = d.y - start;
        const mid = d.y;
        d.text("Zweiter Block", { spacingBefore: 30 });
        second = d.y - mid;
      },
      () => {},
    ]);
    const lineHeight = 11 * 1.25;
    expect(first).toBeCloseTo(lineHeight, 6); // the 30pt lead was dropped
    expect(second).toBeCloseTo(lineHeight + 30, 6); // and applied here
  });

  it("collapses at the top of a region", () => {
    const pdf = raw();
    const r = pdf.region({ x: 20, y: 100, width: 200, height: 400 }, (d) => {
      d.text("Regionenkopf", { spacingBefore: 25 });
    });
    expect(r.usedHeight).toBeLessThan(25);
  });
});

describe("keepWithNext", () => {
  it("pushes a heading to the next page rather than orphaning it", () => {
    const pdf = new PDFDocument({ compress: false, margins: 50 });
    // Leave room for exactly one line, so the heading alone would fit.
    pdf.y = pdf.pageSize.height - 50 - 14;
    pdf.text("Überschrift", { size: 11, lineHeight: 1.2, keepWithNext: true });
    expect(pdf.pageCount).toBe(2);
  });

  it("stays put when the heading and its lines both fit", () => {
    const pdf = raw();
    pdf.text("Überschrift", { keepWithNext: true });
    expect(pdf.pageCount).toBe(1);
  });

  it("accepts an explicit number of lines to reserve", () => {
    const pdf = new PDFDocument({ compress: false, margins: 50 });
    pdf.y = pdf.pageSize.height - 50 - 100;
    pdf.text("Überschrift", { size: 10, lineHeight: 1.2, keepWithNext: 2 });
    expect(pdf.pageCount).toBe(1); // 2 lines × 12pt still fits in 100pt
    pdf.y = pdf.pageSize.height - 50 - 100;
    pdf.text("Überschrift", { size: 10, lineHeight: 1.2, keepWithNext: 20 });
    expect(pdf.pageCount).toBe(2); // 20 lines × 12pt does not
  });
});

describe("region()", () => {
  it("flows content with its own cursor and reports the height used", () => {
    const pdf = raw();
    const before = pdf.y;
    const r = pdf.region({ x: 30, y: 200, width: 150, height: 300 }, (d) => {
      d.text("Kontakt", { bold: true, spacingAfter: 4 });
      d.text("mail@example.com");
    });
    expect(r.usedHeight).toBeGreaterThan(0);
    expect(r.overflow).toBe(false);
    expect(r.remaining).toBeCloseTo(300 - r.usedHeight, 6);
    expect(pdf.y).toBe(before); // the outer flow is untouched
  });

  it("reports overflow instead of silently dropping content", () => {
    const pdf = raw();
    const r = pdf.region({ x: 0, y: 0, width: 200, height: 30 }, (d) => {
      for (let i = 0; i < 10; i++) d.text(`Zeile ${i}`);
    });
    expect(r.overflow).toBe(true);
    expect(r.remaining).toBeLessThan(0);
  });

  it("draws at the region's x, not the page margin", async () => {
    const pdf = raw();
    pdf.region({ x: 137, y: 200, width: 150, height: 100 }, (d) => d.text("verschoben"));
    expect(await rendered(pdf)).toContain("137 ");
  });

  it("never breaks pages, even when the content is long", () => {
    const pdf = raw();
    pdf.region({ x: 0, y: 0, width: 200, height: 50 }, (d) => {
      for (let i = 0; i < 100; i++) d.text(`Zeile ${i}`);
    });
    expect(pdf.pageCount).toBe(1);
  });

  it("clips on request", async () => {
    const plain = raw();
    plain.region({ x: 10, y: 10, width: 100, height: 40 }, (d) => d.text("x"));
    const clipped = raw();
    clipped.region({ x: 10, y: 10, width: 100, height: 40, clip: true }, (d) => d.text("x"));
    expect(await rendered(plain)).not.toContain("W n");
    expect(await rendered(clipped)).toContain("W n");
  });

  it("works inside an onPage() decorator, where there is no flow cursor", async () => {
    const pdf = raw();
    let result: { overflow: boolean } | undefined;
    pdf.onPage((doc, info) => {
      result = doc.region({ x: 20, y: 60, width: 110, height: info.size.height - 120 }, (d) => {
        d.text("SIDEBAR", { size: 8, letterSpacing: 1.5, spacingAfter: 6 });
        d.text("Ein Text in der Seitenleiste, der ganz normal umbricht.", { size: 9 });
      });
    });
    pdf.text("Hauptinhalt");
    const text = await rendered(pdf);
    expect(text).toContain("SIDEBAR");
    expect(result!.overflow).toBe(false);
  });

  it("restores the outer frame even when the callback throws", () => {
    const pdf = raw();
    const y = pdf.y;
    expect(() =>
      pdf.region({ x: 0, y: 0, width: 100, height: 100 }, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(pdf.y).toBe(y);
    pdf.text("danach"); // must still land in the normal flow
    expect(pdf.y).toBeGreaterThan(y);
  });
});

describe("flowColumns()", () => {
  const items = (n: number, lines = 3) =>
    Array.from({ length: n }, (_, i) => (d: PDFDocument) => {
      d.text(`Kategorie ${i}`, { bold: true, size: 9 });
      for (let l = 0; l < lines; l++) d.text(`Eintrag ${i}.${l}`, { size: 9 });
    });

  it("fills column 1, then column 2, on one page", async () => {
    const pdf = raw();
    const result = pdf.flowColumns(items(6), { columns: 2 });
    expect(result.pages).toBe(1);
    expect(result.dropped).toBe(0);
    const text = await rendered(pdf);
    for (let i = 0; i < 6; i++) expect(text).toContain(`Kategorie ${i}`);
  });

  it("continues onto the next page when the columns are full", async () => {
    const pdf = raw();
    const result = pdf.flowColumns(items(60), { columns: 2 });
    expect(result.pages).toBeGreaterThan(1);
    expect(pdf.pageCount).toBe(result.pages);
    const text = await rendered(pdf);
    expect(text).toContain("Kategorie 59");
  });

  it("balances the last page instead of packing column 1 to the bottom", () => {
    const unbalanced = raw();
    unbalanced.flowColumns(items(4), { columns: 2 });
    const balanced = raw();
    balanced.flowColumns(items(4), { columns: 2, balance: true });
    // Balanced flow is shorter: the items are spread over both columns.
    expect(balanced.y).toBeLessThan(unbalanced.y);
  });

  it("keeps a flagged item with its successor in the same column", () => {
    // Column 1 has room for exactly three single-line items. Without the
    // keep rule the heading would be the third and its body the fourth,
    // i.e. stranded at the foot of column 1.
    const line = (label: string) => (d: PDFDocument) =>
      d.text(label, { size: 10, lineHeight: 1.2 });
    const bottom = 50 + 3 * 12 + 6;

    const loose = raw();
    loose.flowColumns([line("a"), line("b"), line("Überschrift"), line("Rumpf")], {
      columns: 2,
      bottom,
    });

    const kept = raw();
    kept.flowColumns(
      [
        line("a"),
        line("b"),
        { render: line("Überschrift"), keepWithNext: true },
        { render: line("Rumpf") },
      ],
      { columns: 2, bottom },
    );

    // Without the rule column 1 holds three items; with it, only two.
    expect(kept.y).toBeLessThan(loose.y);
  });

  it("reports items too tall for a column instead of overflowing", () => {
    const pdf = raw();
    const result = pdf.flowColumns(
      [
        (d) => {
          for (let i = 0; i < 200; i++) d.text(`x${i}`);
        },
        (d) => d.text("passt"),
      ],
      { columns: 2 },
    );
    expect(result.dropped).toBe(1);
  });

  it("moves the cursor below the tallest column", () => {
    const pdf = raw();
    const before = pdf.y;
    pdf.flowColumns(items(4), { columns: 2 });
    expect(pdf.y).toBeGreaterThan(before);
    expect(pdf.lastBlockHeight).toBeCloseTo(pdf.y - before, 6);
  });

  it("honours explicit widths and gap", async () => {
    const pdf = raw();
    pdf.flowColumns([(d) => d.text("links"), (d) => d.text("rechts")], {
      widths: ["70%", "30%"],
      gap: 20,
    });
    const text = await rendered(pdf);
    expect(text).toContain("links");
    expect(text).toContain("rechts");
  });

  it("refuses to run inside a single-page block", () => {
    const pdf = raw();
    expect(() =>
      pdf.container({ width: 300 }, (d) => {
        d.flowColumns(items(2));
      }),
    ).toThrow(FastPDFError);
  });

  it("accepts an empty list", () => {
    const pdf = raw();
    expect(pdf.flowColumns([])).toEqual({ pages: 1, dropped: 0 });
  });
});
