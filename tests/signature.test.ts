import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/document/document";
import { FastPDFError } from "../src/errors";
import { latin1String } from "../src/pdf/objects";

const render = async (doc: PDFDocument): Promise<string> => latin1String(await doc.render());

describe("signature()", () => {
  it("emits an AcroForm with an empty /Sig widget", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.signature();
    const pdf = await render(doc);
    expect(pdf).toContain("/AcroForm");
    expect(pdf).toContain("/SigFlags 1");
    expect(pdf).toContain("/FT /Sig");
    expect(pdf).toContain("/T (Signature1)");
    expect(pdf).toContain("/Subtype /Widget");
  });

  it("auto-numbers multiple fields and lists them all in /Fields", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.signature({ label: "Auftraggeber" });
    doc.signature({ label: "Auftragnehmer" });
    const pdf = await render(doc);
    expect(pdf).toContain("/T (Signature1)");
    expect(pdf).toContain("/T (Signature2)");
    expect(pdf).toMatch(/\/Fields \[\d+ 0 R \d+ 0 R\]/);
  });

  it("supports custom names and rejects duplicates and periods", () => {
    const doc = new PDFDocument();
    doc.signature({ name: "client" });
    expect(() => doc.signature({ name: "client" })).toThrow(FastPDFError);
    expect(() => doc.signature({ name: "a.b" })).toThrow(/periods/);
    expect(() => doc.signature({ name: "" })).toThrow(FastPDFError);
  });

  it("places the widget rect at the requested absolute position", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.signature({ x: 100, y: 700, width: 200, height: 50 });
    const pdf = await render(doc);
    // A4 height 841.89: y=700 → PDF-space top 141.89, bottom 91.89.
    expect(pdf).toContain("/Rect [100 91.89 300 141.89]");
  });

  it("draws the signature line and label into the page content", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.signature({ label: "Unterschrift Kunde" });
    const pdf = await render(doc);
    expect(pdf).toContain("(Unterschrift Kunde) Tj");
    expect(pdf).toMatch(/0\.75 w/); // signature line stroke width
  });

  it("skips the line when disabled", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.signature({ line: false });
    const pdf = await render(doc);
    expect(pdf).not.toMatch(/0\.75 w/);
  });

  it("advances the flow cursor and breaks pages when needed", () => {
    const doc = new PDFDocument();
    const before = doc.y;
    doc.signature({ spacingAfter: 10 });
    expect(doc.y).toBeGreaterThan(before);

    doc.y = 800; // near the bottom of an A4 page
    doc.signature();
    expect(doc.pageCount).toBe(2);
  });

  it("escapes hostile field names and labels", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.signature({ name: "x) >> /Evil (", label: "a(b)c" });
    const pdf = await render(doc);
    expect(pdf).toContain("/T (x\\) >> /Evil \\()");
    expect(pdf).toContain("(a\\(b\\)c) Tj");
  });
});
