import { describe, expect, it } from "vitest";
import { FastPDFError, PDFDocument } from "../src/index";
import { latin1String } from "../src/pdf/objects";
import { makePng } from "./helpers";

const raw = () => new PDFDocument({ compress: false });

async function rendered(pdf: PDFDocument): Promise<string> {
  return latin1String(await pdf.render());
}

describe("shapes (M1)", () => {
  it("draws circles and ellipses as Bézier paths", async () => {
    const pdf = raw();
    pdf.circle(100, 100, 30, { fill: "#ff0000" });
    pdf.ellipse(200, 100, 40, 20, { stroke: "#0000ff", lineWidth: 2 });
    const text = await rendered(pdf);
    expect(text.match(/ c\n/g)!.length).toBeGreaterThanOrEqual(8); // 4 curves per shape
    expect(text).toContain("1 0 0 rg");
    expect(text).toContain("0 0 1 RG");
  });

  it("rejects non-positive ellipse radii with a typed error", () => {
    const pdf = raw();
    try {
      pdf.circle(10, 10, 0);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FastPDFError);
      expect((e as FastPDFError).code).toBe("INVALID_ARGUMENT");
    }
  });

  it("draws rounded rectangles when radius is set", async () => {
    const pdf = raw();
    pdf.rect(50, 50, 100, 60, { fill: "#eeeeee", radius: 8 });
    const text = await rendered(pdf);
    expect(text).toContain(" c\n");
    expect(text).not.toContain(" re\nf");
  });
});

describe("pageBreak()", () => {
  it("starts a new page and continues the flow at the top margin", () => {
    const pdf = raw();
    pdf.text("Seite 1");
    pdf.pageBreak();
    expect(pdf.pageCount).toBe(2);
    expect(pdf.y).toBe(50); // default top margin
  });

  it("starts the new page at a custom y position", () => {
    const pdf = raw();
    pdf.pageBreak({ y: 200 });
    expect(pdf.y).toBe(200);
  });

  it("accepts per-page options like landscape", () => {
    const pdf = raw();
    pdf.pageBreak({ landscape: true });
    expect(pdf.pageSize).toEqual({ width: 841.89, height: 595.28 });
  });

  it("is rejected inside containers and columns", () => {
    const pdf = raw();
    expect(() => pdf.container({}, (d) => d.pageBreak())).toThrow(/not allowed inside/);
    expect(() => pdf.columns([(d) => d.pageBreak()])).toThrow(/not allowed inside/);
  });
});

describe("stream output (M1)", () => {
  it("streams the same bytes as render()", async () => {
    const build = () => {
      const pdf = new PDFDocument({ metadata: { creationDate: new Date("2026-01-01T00:00:00Z") } });
      pdf.text("Streamed");
      return pdf;
    };
    const direct = await build().render();
    const reader = build().toStream().getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const streamed = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let pos = 0;
    for (const c of chunks) {
      streamed.set(c, pos);
      pos += c.length;
    }
    expect(streamed).toEqual(direct);
  });
});

describe("typography (M3)", () => {
  it("underlines and strikes through text with the text color", async () => {
    const pdf = raw();
    pdf.text("underlined", { underline: true, color: "#ff0000" });
    pdf.text("struck", { strikethrough: true });
    const text = await rendered(pdf);
    // decoration lines: moveTo/lineTo/stroke sequences after the Tj
    expect(text.match(/ m\n[\d.]+ [\d.]+ l\nS/g)!.length).toBe(2);
    expect(text).toContain("1 0 0 RG"); // underline uses the text color
  });

  it("applies letter spacing via the Tc operator and resets it in-block", async () => {
    const pdf = raw();
    pdf.text("spaced", { letterSpacing: 2 });
    pdf.text("normal");
    const text = await rendered(pdf);
    // Tc survives ET in the PDF graphics state — it must be reset before
    // the block ends, or later text inherits the spacing.
    expect(text).toContain("2 Tc");
    expect(text).toMatch(/Tj 0 Tc ET/);
  });

  it("justifies wrapped lines with TJ adjustments, except the last line", async () => {
    const pdf = raw();
    pdf.text(
      "The quick brown fox jumps over the lazy dog and keeps on running through the forest",
      { align: "justify", width: 200 },
    );
    const text = await rendered(pdf);
    expect(text).toContain("] TJ");
    // the paragraph's last line stays a plain Tj
    expect(text).toContain(") Tj");
  });

  it("breaks at soft hyphens and renders a visible dash", async () => {
    const pdf = raw();
    pdf.text("Donau­dampf­schiff­fahrts­gesellschaft", { width: 100 });
    const text = await rendered(pdf);
    expect(text).toMatch(/\(\w+-\) Tj/);
    expect(text).not.toContain("\xad"); // soft hyphen never reaches the output
  });

  it("uses a soft hyphen to fill the current line before wrapping", async () => {
    const pdf = raw();
    pdf.text("Die Donau­dampf­schiff­fahrts­gesellschaft", { width: 150 });
    const text = await rendered(pdf);
    expect(text).toMatch(/\(Die \w+-\) Tj/);
  });
});

describe("layout engine (M2)", () => {
  it("paints container backgrounds behind the content", async () => {
    const pdf = raw();
    pdf.container({ background: "#00ff00", padding: 10, radius: 4 }, (d) => {
      d.text("inside");
    });
    const text = await rendered(pdf);
    const bg = text.indexOf("0 1 0 rg");
    const content = text.indexOf("(inside) Tj");
    expect(bg).toBeGreaterThan(-1);
    expect(content).toBeGreaterThan(bg);
  });

  it("respects container width, alignment and advances the cursor", () => {
    const pdf = raw();
    const before = pdf.y;
    pdf.container({ width: "50%", align: "center", padding: 5, minHeight: 100 }, (d) => {
      d.text("x");
    });
    expect(pdf.y).toBeGreaterThanOrEqual(before + 100);
  });

  it("throws when padding eats the whole container width", () => {
    const pdf = raw();
    expect(() => pdf.container({ width: 10, padding: 20 }, () => {})).toThrow(FastPDFError);
  });

  it("places columns side by side and continues below the tallest", () => {
    const pdf = raw();
    const start = pdf.y;
    let tallEnd = 0;
    pdf.columns([
      (d) => {
        d.text("short");
      },
      (d) => {
        for (let i = 0; i < 5; i++) d.text(`line ${i}`);
        tallEnd = d.y;
      },
    ]);
    expect(pdf.y).toBe(tallEnd);
    expect(pdf.y).toBeGreaterThan(start);
  });

  it("supports percentage column widths", async () => {
    const pdf = raw();
    pdf.columns(
      [(d) => d.text("left"), (d) => d.text("right")],
      { widths: ["30%", "70%"], gap: 10 },
    );
    expect(await rendered(pdf)).toContain("(left) Tj");
  });

  it("lays out grid cells in rows", () => {
    const pdf = raw();
    const start = pdf.y;
    pdf.grid(
      [1, 2, 3, 4, 5].map((n) => (d: PDFDocument) => d.text(`cell ${n}`)),
      { columns: 2, gap: 8 },
    );
    // 3 rows of one line each + 2 row gaps
    expect(pdf.y).toBeGreaterThan(start + 3 * 11);
  });

  it("rejects invalid percentage strings", () => {
    const pdf = raw();
    expect(() => pdf.container({ width: "half" }, () => {})).toThrow(/Invalid size/);
  });
});

describe("tables (M4)", () => {
  it("styles a footer row like a header and never repeats it", async () => {
    const pdf = raw();
    const rows: string[][] = [["Pos", "Betrag"]];
    for (let i = 0; i < 80; i++) rows.push([`Zeile ${i}`, `${i}`]);
    rows.push(["Summe", "3160"]);
    pdf.table(rows, { footer: true });
    expect(pdf.pageCount).toBeGreaterThan(1);
    const text = await rendered(pdf);
    expect(text.match(/\(Pos\) Tj/g)!.length).toBe(pdf.pageCount); // header repeats
    expect(text.match(/\(Summe\) Tj/g)!.length).toBe(1); // footer does not
  });

  it("renders colSpan cells across the full spanned width", async () => {
    const pdf = raw();
    pdf.table(
      [
        [{ text: "Spanning header", colSpan: 2 }],
        ["a", "b"],
      ],
      { header: true },
    );
    const text = await rendered(pdf);
    expect(text).toContain("(Spanning header) Tj");
  });

  it("rejects rows whose cells overflow the blocked grid", () => {
    const pdf = raw();
    expect(() =>
      pdf.table([
        [{ text: "tall", rowSpan: 2 }, "b"],
        ["x", "y"], // col 0 is blocked — "y" has no slot left
      ]),
    ).toThrow(/more cells/);
  });

  it("keeps rowSpan groups on one page", async () => {
    const pdf = raw();
    const rows: (string | { text: string; rowSpan: number })[][] = [["A", "B"]];
    for (let i = 0; i < 60; i++) rows.push([`a${i}`, `b${i}`]);
    rows.push([{ text: "group", rowSpan: 3 }, "x"]);
    rows.push(["y"]);
    rows.push(["z"]);
    pdf.table(rows);
    const text = await rendered(pdf);
    expect(text).toContain("(group) Tj");
    expect(text).toContain("(z) Tj");
  });
});

describe("objectTable() — REST/JSON binding", () => {
  const orders = [
    { id: 1, customer: "Alice", total: 120, paid: true },
    { id: 2, customer: "Bob", total: 80, paid: false },
  ];

  it("renders headers from the keys of the first record by default", async () => {
    const pdf = raw();
    pdf.objectTable(orders);
    const text = await rendered(pdf);
    expect(text).toContain("(id) Tj");
    expect(text).toContain("(customer) Tj");
    expect(text).toContain("(Alice) Tj");
    expect(text).toContain("(Bob) Tj");
  });

  it("stringifies values and renders empty cells for null/undefined", async () => {
    const pdf = raw();
    pdf.objectTable([{ a: 1, b: null }, { a: 2, b: undefined as unknown as number }]);
    const text = await rendered(pdf);
    expect(text).toContain("(1) Tj");
    expect(text).toContain("(2) Tj");
  });

  it("honors column order, custom headers and per-column formatting", async () => {
    const pdf = raw();
    pdf.objectTable(orders, {
      columns: [
        { key: "customer", header: "Kunde" },
        { key: "total", header: "Betrag", align: "right", format: (v) => `${v},00 EUR` },
      ],
    });
    const text = await rendered(pdf);
    expect(text).toContain("(Kunde) Tj");
    expect(text).toContain("(Betrag) Tj");
    expect(text).toContain("(120,00 EUR) Tj");
    expect(text).not.toContain("(id) Tj"); // id column omitted
  });

  it("accepts bare key strings as columns", async () => {
    const pdf = raw();
    pdf.objectTable(orders, { columns: ["customer", "id"] });
    const text = await rendered(pdf);
    expect(text).toContain("(customer) Tj");
    expect(text).not.toContain("(total) Tj");
  });

  it("passes the whole record to format() (e.g. for computed cells)", async () => {
    const pdf = raw();
    pdf.objectTable(orders, {
      columns: [{ key: "paid", header: "Status", format: (_v, r) => (r.paid ? "OK" : `offen: ${r.total}`) }],
    });
    const text = await rendered(pdf);
    expect(text).toContain("(OK) Tj");
    expect(text).toContain("(offen: 80) Tj");
  });

  it("mixes fixed and auto column widths", async () => {
    const pdf = raw();
    pdf.objectTable(orders, {
      columns: [
        { key: "id", width: 40 },
        { key: "customer" },
        { key: "total", width: 60 },
      ],
    });
    // Just needs to render without throwing; widths add up within content width.
    expect((await rendered(pdf)).includes("(Alice) Tj")).toBe(true);
  });

  it("is a no-op for an empty array", () => {
    const pdf = raw();
    const before = pdf.y;
    pdf.objectTable([]);
    expect(pdf.y).toBe(before);
  });
});

describe("images (M5)", () => {
  // 2×1 opaque RGB PNG
  const pngPromise = makePng(2, 1, 2, [255, 0, 0]);

  it("clips images in cover mode", async () => {
    const png = await pngPromise;
    const pdf = raw();
    pdf.image(png, { width: 50, height: 50, fit: "cover" });
    const text = await rendered(pdf);
    expect(text).toContain("W n");
  });

  it("letterboxes images in contain mode without clipping", async () => {
    const png = await pngPromise;
    const pdf = raw();
    pdf.image(png, { width: 50, height: 50, fit: "contain" });
    const text = await rendered(pdf);
    expect(text).not.toContain("W n");
    expect(text).toMatch(/50 0 0 25 [\d.]+ [\d.]+ cm/); // 2:1 image in a 50×50 box
  });

  it("rotates images around the box center", async () => {
    const png = await pngPromise;
    const pdf = raw();
    pdf.image(png, { width: 40, rotate: 90 });
    const text = await rendered(pdf);
    expect(text).toMatch(/0 -1 1 0 [\d.-]+ [\d.-]+ cm/); // 90° clockwise
  });

  it("crops to a source region", async () => {
    const png = await pngPromise;
    const pdf = raw();
    pdf.image(png, { width: 30, crop: { x: 1, y: 0, width: 1, height: 1 } });
    const text = await rendered(pdf);
    expect(text).toContain("W n");
  });

  it("centers images in flow mode", async () => {
    const png = await pngPromise;
    const pdf = raw();
    pdf.image(png, { width: 100, align: "center" });
    const contentWidth = pdf.pageSize.width - 100; // margins 50 + 50
    const expectedX = 50 + (contentWidth - 100) / 2;
    const text = await rendered(pdf);
    expect(text).toContain(`100 0 0 50 ${expectedX}`);
  });
});

describe("document features (M8)", () => {
  it("draws headers, footers and page numbers on every page", async () => {
    const pdf = raw();
    pdf.header("Bericht 2026").footer("© Awesome Software").pageNumbers();
    pdf.text("Seite 1").addPage().text("Seite 2");
    const text = await rendered(pdf);
    expect(text.match(/\(Bericht 2026\) Tj/g)!.length).toBe(2);
    expect(text.match(/\(© Awesome Software\) Tj/g)!.length).toBe(2);
    expect(text).toContain("(1 / 2) Tj");
    expect(text).toContain("(2 / 2) Tj");
  });

  it("supports custom page-number formats and startAt", async () => {
    const pdf = raw();
    pdf.pageNumbers({ format: (n, total) => `Seite ${n} von ${total}`, startAt: 2 });
    pdf.text("eins").addPage().text("zwei");
    const text = await rendered(pdf);
    expect(text).not.toContain("(Seite 1 von 2)");
    expect(text).toContain("(Seite 2 von 2) Tj");
  });

  it("draws watermarks with transparency on every page", async () => {
    const pdf = raw();
    pdf.watermark("ENTWURF");
    pdf.text("a").addPage().text("b");
    const text = await rendered(pdf);
    expect(text.match(/\(ENTWURF\) Tj/g)!.length).toBe(2);
    expect(text).toContain("/Type /ExtGState");
    expect(text).toContain("/ca 0.12");
    expect(text.match(/\/GS0 gs/g)!.length).toBe(2);
  });

  it("builds a nested outline tree", async () => {
    const pdf = raw();
    pdf.outline("Kapitel 1").text("Inhalt 1");
    pdf.outline("Abschnitt 1.1", { level: 1 }).text("Inhalt 1.1");
    pdf.addPage().outline("Kapitel 2").text("Inhalt 2");
    const text = await rendered(pdf);
    expect(text).toContain("/Type /Outlines");
    expect(text).toContain("/Count 3");
    expect(text).toContain("(Kapitel 1)");
    expect(text).toContain("/PageMode /UseOutlines");
    expect(text).toContain("/First");
    expect(text).toContain("/XYZ");
  });

  it("creates URI link annotations for linked text", async () => {
    const pdf = raw();
    pdf.text("Website", { link: "https://example.com/ä" });
    const text = await rendered(pdf);
    expect(text).toContain("/Subtype /Link");
    expect(text).toContain("/URI (https://example.com/%C3%A4)");
  });

  it("resolves anchors to internal GoTo destinations", async () => {
    const pdf = raw();
    pdf.text("Springe zu Details", { link: "#details" });
    pdf.addPage().anchor("details").text("Details");
    const text = await rendered(pdf);
    expect(text).toContain("/Dest [");
    expect(text).toContain("/XYZ");
  });

  it("throws a typed error for unknown anchors", async () => {
    const pdf = raw();
    pdf.text("kaputt", { link: "#fehlt" });
    await expect(pdf.render()).rejects.toThrow(/Unknown anchor/);
  });

  it("inserts a linked table of contents at the front with shifted numbers", async () => {
    const pdf = raw();
    pdf.outline("Einleitung").text("Text 1");
    pdf.addPage().outline("Hauptteil").text("Text 2");
    const contentPages = pdf.pageCount;
    pdf.toc({ title: "Inhalt" });
    expect(pdf.pageCount).toBe(contentPages + 1);
    const text = await rendered(pdf);
    expect(text).toContain("(Inhalt) Tj");
    expect(text).toContain("(Einleitung) Tj");
    // page numbers shifted by the TOC page: 2 and 3
    expect(text).toContain("(2) Tj");
    expect(text).toContain("(3) Tj");
    expect(text).toContain("/Dest [");
  });

  it("truncates overlong TOC labels with an ellipsis", async () => {
    const pdf = raw();
    pdf.outline("Ein extrem langer Kapiteltitel, der niemals in eine einzelne Zeile eines Inhaltsverzeichnisses passen wird, weil er einfach immer weiterläuft und kein Ende findet");
    pdf.text("Inhalt");
    pdf.toc();
    const text = await rendered(pdf);
    expect(text).toContain("\x85) Tj"); // WinAnsi "…"
  });

  it("keeps decorators idempotent across multiple renders", async () => {
    const pdf = raw();
    pdf.pageNumbers();
    pdf.text("once");
    const first = latin1String(await pdf.render());
    const second = latin1String(await pdf.render());
    expect(second.match(/\(1 \/ 1\) Tj/g)!.length).toBe(first.match(/\(1 \/ 1\) Tj/g)!.length);
  });
});
