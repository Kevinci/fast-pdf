import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/index";
import { latin1String } from "../src/pdf/objects";

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

describe("PDFDocument", () => {
  it("renders a valid single-page document", async () => {
    const pdf = new PDFDocument({ metadata: { title: "Test", creationDate: FIXED_DATE } });
    pdf.text("Hallo Welt");
    const bytes = await pdf.render();
    const text = latin1String(bytes);

    expect(text.startsWith("%PDF-1.7\n")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Count 1");
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("/Encoding /WinAnsiEncoding");
    expect(text).toContain("(Test)");
    expect(text).toContain("/FlateDecode");
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  it("is deterministic for a fixed creation date", async () => {
    const make = () => {
      const pdf = new PDFDocument({ metadata: { creationDate: FIXED_DATE } });
      pdf.text("Deterministic").table([["A", "B"], ["1", "2"]]);
      return pdf.render();
    };
    expect(await make()).toEqual(await make());
  });

  it("breaks pages automatically on overflowing text", async () => {
    const pdf = new PDFDocument();
    for (let i = 0; i < 120; i++) pdf.text(`Zeile ${i}`);
    expect(pdf.pageCount).toBeGreaterThan(1);
    const text = latin1String(await pdf.render());
    expect(text).toContain(`/Count ${pdf.pageCount}`);
  });

  it("writes WinAnsi bytes for umlauts into the content stream", async () => {
    const pdf = new PDFDocument({ compress: false });
    pdf.text("äöüß€");
    const text = latin1String(await pdf.render());
    expect(text).toContain("(\xe4\xf6\xfc\xdf\x80) Tj");
  });

  it("repeats table headers across page breaks", async () => {
    const pdf = new PDFDocument({ compress: false });
    const rows: string[][] = [["Produkt", "Preis"]];
    for (let i = 0; i < 100; i++) rows.push([`Artikel ${i}`, `${i} €`]);
    pdf.table(rows);
    expect(pdf.pageCount).toBeGreaterThan(1);
    const text = latin1String(await pdf.render());
    const headers = text.match(/\(Produkt\) Tj/g) ?? [];
    expect(headers.length).toBe(pdf.pageCount);
  });

  it("supports page formats, landscape and custom margins", () => {
    const pdf = new PDFDocument({ format: "Letter", landscape: true, margins: { top: 10 } });
    expect(pdf.pageSize).toEqual({ width: 792, height: 612 });
    expect(pdf.y).toBe(10);
  });

  it("uses one font object per unique font, shared across pages", async () => {
    const pdf = new PDFDocument();
    pdf.text("regular").text("bold", { bold: true }).addPage().text("regular again");
    const text = latin1String(await pdf.render());
    expect(text.match(/\/BaseFont \/Helvetica /g)?.length).toBe(1);
    expect(text.match(/\/BaseFont \/Helvetica-Bold /g)?.length).toBe(1);
  });

  it("draws vector primitives and absolute text without moving the cursor", async () => {
    const pdf = new PDFDocument({ compress: false });
    const before = pdf.y;
    pdf.text("Kopfzeile", { y: 20, align: "right" });
    pdf.line(50, 100, 300, 100, { color: "#ff0000", width: 2 });
    pdf.rect(50, 120, 100, 40, { fill: "#00ff00", stroke: { r: 0, g: 0, b: 255 } });
    expect(pdf.y).toBe(before);
    const text = latin1String(await pdf.render());
    expect(text).toContain("1 0 0 RG");
    expect(text).toContain("0 1 0 rg");
    expect(text).toContain(" re");
    expect(text).toContain("1 w\nB"); // fill + stroke

  });

  it("returns Buffer and Blob outputs", async () => {
    const pdf = new PDFDocument();
    pdf.text("Output");
    const buffer = await pdf.toBuffer();
    expect(buffer.length).toBeGreaterThan(0);
    const blob = await pdf.toBlob();
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(buffer.length);
  });

  it("stays within the requested text width", async () => {
    const pdf = new PDFDocument({ compress: false });
    pdf.text("The quick brown fox jumps over the lazy dog and keeps running", { width: 120 });
    expect(pdf.y).toBeGreaterThan(pdf.pageSize.height / 20); // wrapped into multiple lines
  });
});

describe("deterministic output", () => {
  const build = (opts: ConstructorParameters<typeof PDFDocument>[0]) => {
    const pdf = new PDFDocument(opts);
    pdf.text("Reproducible").table([["A", "B"], ["1", "2"]]);
    return pdf.render();
  };

  it("embeds no wall-clock timestamp in deterministic mode", async () => {
    const text = latin1String(await build({ deterministic: true }));
    expect(text).not.toContain("/CreationDate");
    expect(text).not.toContain("/ModDate");
  });

  it("renders byte-identical output across runs in deterministic mode", async () => {
    expect(await build({ deterministic: true })).toEqual(await build({ deterministic: true }));
  });

  it("still honours an explicit creationDate in deterministic mode", async () => {
    const text = latin1String(await build({ deterministic: true, metadata: { creationDate: FIXED_DATE } }));
    expect(text).toContain("/CreationDate (D:20260101000000Z)");
    expect(text).toContain("/ModDate (D:20260101000000Z)");
  });

  it("embeds a real timestamp by default (non-deterministic)", async () => {
    const text = latin1String(await build({}));
    expect(text).toContain("/CreationDate (D:");
  });

  it("writes a content-derived file /ID that is stable for stable input", async () => {
    const text = latin1String(await build({ deterministic: true }));
    const id = /\/ID \[<([0-9a-f]{32})> <([0-9a-f]{32})>\]/.exec(text);
    expect(id).not.toBeNull();
    expect(id![1]).toBe(id![2]); // both entries equal for a freshly created file
    const again = /\/ID \[<([0-9a-f]{32})>/.exec(latin1String(await build({ deterministic: true })));
    expect(again![1]).toBe(id![1]); // same content → same id
  });

  it("gives different documents different /IDs", async () => {
    const a = /\/ID \[<([0-9a-f]{32})>/.exec(latin1String(await build({ deterministic: true })))![1];
    const other = new PDFDocument({ deterministic: true });
    other.text("A completely different document");
    const b = /\/ID \[<([0-9a-f]{32})>/.exec(latin1String(await other.render()))![1];
    expect(a).not.toBe(b);
  });
});
