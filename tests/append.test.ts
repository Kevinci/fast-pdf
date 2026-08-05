import { describe, expect, it } from "vitest";
import { FastPDFError, PDFDocument, pdfInfo } from "../src/index";
import { PDFReader } from "../src/pdf/reader";
import { latin1String } from "../src/pdf/objects";
import { makeObjStmPdf } from "./helpers";

/** A source document written by fast-pdf itself (classic xref, plain objects). */
async function source(
  options: { pages?: number; format?: "A4" | "Letter"; landscape?: boolean } = {},
): Promise<Uint8Array> {
  const pdf = new PDFDocument({
    compress: false,
    format: options.format ?? "A4",
    landscape: options.landscape ?? false,
    deterministic: true,
  });
  for (let i = 0; i < (options.pages ?? 1); i++) {
    if (i > 0) pdf.addPage();
    pdf.text(`Certificate page ${i + 1}`, { size: 20 });
  }
  return pdf.toBuffer();
}

/** Page sizes of a finished document, read back through the reader. */
async function pageSizes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const reader = await PDFReader.open(bytes);
  return (await reader.pages()).map((page) => page.size);
}

describe("pdfInfo()", () => {
  it("reports page count, version and sizes without importing", async () => {
    const info = await pdfInfo(await source({ pages: 3 }));
    expect(info.pageCount).toBe(3);
    expect(info.version).toBe("1.7");
    expect(info.encrypted).toBe(false);
    expect(info.pageSizes[0]).toEqual({ width: 595.28, height: 841.89 });
  });

  it("flags an encrypted file instead of failing", async () => {
    const locked = await new PDFDocument({ encrypt: { userPassword: "secret" } }).toBuffer();
    const info = await pdfInfo(locked);
    expect(info.encrypted).toBe(true);
    expect(info.pageCount).toBe(0);
  });

  it("rejects something that is not a PDF", async () => {
    await expect(pdfInfo(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      code: "INVALID_PDF_FILE",
    });
  });
});

describe("append() — 1:1 copy", () => {
  it("appends every page of a PDF and keeps the result readable", async () => {
    const pdf = new PDFDocument({ compress: false });
    pdf.text("Curriculum Vitae", { size: 24 });
    await pdf.append(await source({ pages: 2 }));

    expect(pdf.pageCount).toBe(3);
    const sizes = await pageSizes(await pdf.render());
    expect(sizes).toHaveLength(3);
    expect(sizes[2]).toEqual({ width: 595.28, height: 841.89 });
  });

  it("carries the source content stream over unchanged", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await source());
    // The imported text operator survives byte-for-byte — nothing is re-drawn.
    expect(latin1String(await pdf.render())).toContain("(Certificate page 1) Tj");
  });

  it("keeps the original page size instead of the document format", async () => {
    const pdf = new PDFDocument({ format: "A4" });
    await pdf.append(await source({ format: "Letter", landscape: true }));
    const sizes = await pageSizes(await pdf.render());
    expect(sizes[1]).toEqual({ width: 792, height: 612 });
  });

  it("takes only the requested pages, in the order given", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await source({ pages: 3 }), { pages: [3, 1] });
    expect(pdf.pageCount).toBe(3); // the document's own first page plus two
    const text = latin1String(await pdf.render());
    expect(text.indexOf("(Certificate page 3)")).toBeLessThan(text.indexOf("(Certificate page 1)"));
    expect(text).not.toContain("(Certificate page 2)");
  });

  it("accepts a single page number", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await source({ pages: 3 }), { pages: 2 });
    expect(pdf.pageCount).toBe(2);
    expect(latin1String(await pdf.render())).toContain("(Certificate page 2)");
  });

  it("rejects a page number the file does not have", async () => {
    const pdf = new PDFDocument();
    await expect(pdf.append(await source({ pages: 2 }), { pages: [5] })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("shares objects between pages of the same file", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await source({ pages: 3 }));
    // All three source pages reference one font object; it is copied once.
    const text = latin1String(await pdf.render());
    expect(text.match(/\/BaseFont \/Helvetica/g)).toHaveLength(1);
  });

  it("continues the flow on a fresh page, so nothing is drawn on the import", async () => {
    const pdf = new PDFDocument({ compress: false });
    pdf.text("Curriculum Vitae");
    await pdf.append(await source());
    pdf.text("Appendix");
    expect(pdf.pageCount).toBe(3); // own page, imported page, new page
    const sizes = await pageSizes(await pdf.render());
    expect(sizes).toHaveLength(3);
  });
});

describe("append() — fit: \"page\"", () => {
  it("scales a foreign page size onto the document format", async () => {
    const pdf = new PDFDocument({ format: "A4" });
    await pdf.append(await source({ format: "Letter" }), { fit: "page" });
    const sizes = await pageSizes(await pdf.render());
    expect(sizes[1]).toEqual({ width: 595.28, height: 841.89 });
  });

  it("draws the imported page as a form XObject, scaled and centred", async () => {
    const pdf = new PDFDocument({ compress: false, format: "A4" });
    await pdf.append(await source({ format: "Letter" }), { fit: "page" });
    const text = latin1String(await pdf.render());
    expect(text).toContain("/FpImport Do");
    expect(text).toContain("/Subtype /Form");
    // A4 is narrower than Letter, so the page is scaled down, not up.
    const scale = Number(/q\n([\d.]+) 0 0 /.exec(text)![1]);
    expect(scale).toBeGreaterThan(0.9);
    expect(scale).toBeLessThan(1);
  });

  it("turns the target page landscape for a landscape source", async () => {
    const pdf = new PDFDocument({ format: "A4" });
    await pdf.append(await source({ landscape: true }), { fit: "page" });
    const sizes = await pageSizes(await pdf.render());
    expect(sizes[1]).toEqual({ width: 841.89, height: 595.28 });
  });

  it("honours autoRotate: false", async () => {
    const pdf = new PDFDocument({ format: "A4" });
    await pdf.append(await source({ landscape: true }), { fit: "page", autoRotate: false });
    const sizes = await pageSizes(await pdf.render());
    expect(sizes[1]).toEqual({ width: 595.28, height: 841.89 });
  });

  it("insets the page by padding", async () => {
    const pdf = new PDFDocument({ compress: false, format: "A4" });
    await pdf.append(await source(), { fit: "page", padding: 40 });
    const text = latin1String(await pdf.render());
    const scale = Number(/q\n([\d.]+) 0 0 /.exec(text)![1]);
    expect(scale).toBeCloseTo((595.28 - 80) / 595.28, 3);
  });
});

describe("append() — overlays", () => {
  it("refuses to silently drop content drawn on a 1:1 copy", async () => {
    const pdf = new PDFDocument();
    await pdf.append(await source());
    pdf.text("stamped", { y: 100 }); // absolute: lands on the imported page
    await expect(pdf.render()).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("draws over an imported page when asked", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await source(), { overlay: true });
    pdf.text("Anlage 1", { y: 40 });
    const text = latin1String(await pdf.render());
    expect(text).toContain("/FpOverlay Do");
    expect(text).toContain("(Anlage 1) Tj");
    // The imported content is still there, wrapped so its state cannot leak.
    expect(text).toContain("(Certificate page 1) Tj");
    expect(text).toMatch(/\/Contents \[\d+ 0 R \d+ 0 R \d+ 0 R \d+ 0 R\]/);
  });

  it("keeps page decorators off imported pages by default", async () => {
    const pdf = new PDFDocument({ compress: false });
    pdf.pageNumbers({ format: (page, total) => `${page}/${total}` });
    await pdf.append(await source());
    const text = latin1String(await pdf.render());
    expect(text).toContain("(1/2) Tj");
    expect(text).not.toContain("(2/2) Tj");
  });

  it("runs page decorators on imported pages with overlay: true", async () => {
    const pdf = new PDFDocument({ compress: false });
    pdf.pageNumbers({ format: (page, total) => `${page}/${total}` });
    await pdf.append(await source(), { overlay: true });
    const text = latin1String(await pdf.render());
    expect(text).toContain("(1/2) Tj");
    expect(text).toContain("(2/2) Tj");
  });

  it("counts imported pages in the page numbering either way", async () => {
    const pdf = new PDFDocument({ compress: false });
    pdf.pageNumbers({ format: (page, total) => `${page} of ${total}` });
    await pdf.append(await source({ pages: 4 }));
    expect(latin1String(await pdf.render())).toContain("(1 of 5) Tj");
  });
});

describe("append() — reading real-world structures", () => {
  it("reads object streams and cross-reference streams with a predictor", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await makeObjStmPdf());
    expect(pdf.pageCount).toBe(2);
    const rendered = await pdf.render();
    expect(latin1String(rendered)).toContain("20 20 120 60 re f");
    expect((await pageSizes(rendered))[1]).toEqual({ width: 300, height: 400 });
  });

  it("reports a rotated page at its displayed size", async () => {
    const pdf = new PDFDocument();
    await pdf.append(await makeObjStmPdf({ rotate: 90, mediaBox: [0, 0, 300, 400] }));
    // /Rotate 90 swaps the visible extent, and the copy keeps the flag.
    expect(pdf.pageSize).toEqual({ width: 400, height: 300 });
    expect((await pageSizes(await pdf.render()))[1]).toEqual({ width: 400, height: 300 });
  });

  it("places an overlay upright on a rotated page", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await makeObjStmPdf({ rotate: 90 }), { overlay: true });
    pdf.text("Anlage", { y: 20 });
    const text = latin1String(await pdf.render());
    // The overlay form counter-rotates so its content reads with the page.
    expect(text).toContain("/Matrix [0 1 -1 0 300 0]");
    expect(text).toContain("/BBox [0 0 400 300]");
  });

  it("materializes page attributes inherited from the page tree", async () => {
    // /MediaBox and /Rotate sit on the /Pages node here. The source tree is not
    // copied, so both have to be written onto the imported page itself or it
    // would come out Letter-sized and upright.
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await makeObjStmPdf({ rotate: 90, inherit: true }));
    expect(pdf.pageSize).toEqual({ width: 400, height: 300 });
    const rendered = await pdf.render();
    expect(latin1String(rendered)).toContain("/Rotate 90");
    expect((await pageSizes(rendered))[1]).toEqual({ width: 400, height: 300 });
  });

  it("recovers from a damaged cross-reference table", async () => {
    const bytes = await source({ pages: 2 });
    const text = latin1String(bytes);
    // Point startxref at nothing, the way a truncated upload or a careless
    // editor does; the reader has to find the objects by scanning.
    const at = text.lastIndexOf("startxref");
    const broken = new Uint8Array(bytes);
    broken.set(new Uint8Array([0x39, 0x39, 0x39, 0x39, 0x39]), at + 10);

    const pdf = new PDFDocument({ compress: false });
    await pdf.append(broken);
    expect(pdf.pageCount).toBe(3);
    expect(latin1String(await pdf.render())).toContain("(Certificate page 2) Tj");
  });

  it("tolerates junk before the %PDF header", async () => {
    const bytes = await source();
    const prefixed = new Uint8Array(bytes.length + 4);
    prefixed.set([0x0a, 0x0a, 0x0a, 0x0a]);
    prefixed.set(bytes, 4);
    const info = await pdfInfo(prefixed);
    expect(info.pageCount).toBe(1);
  });

  it("refuses an encrypted source with a typed error", async () => {
    const locked = await new PDFDocument({ encrypt: { userPassword: "secret" } }).toBuffer();
    const pdf = new PDFDocument();
    await expect(pdf.append(locked)).rejects.toMatchObject({ code: "ENCRYPTED_PDF" });
  });

  it("refuses a file that is not a PDF", async () => {
    const pdf = new PDFDocument();
    try {
      await pdf.append(new TextEncoder().encode("just some text"));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FastPDFError);
      expect((error as FastPDFError).code).toBe("INVALID_PDF_FILE");
    }
  });
});

describe("append() — annotations", () => {
  it("carries a web link over", async () => {
    const inner = new PDFDocument({ compress: false });
    inner.text("fast-pdf", { link: "https://example.com/cv" });
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await inner.toBuffer());
    const text = latin1String(await pdf.render());
    expect(text).toContain("/Subtype /Link");
    expect(text).toContain("https://example.com/cv");
  });

  it("drops annotations that carry a payload or an action", async () => {
    // A file-attachment annotation with a JavaScript action in /AA — neither the
    // embedded file nor the action may travel out of an upload.
    const inner = latin1String(await new PDFDocument({ compress: false }).toBuffer());
    // Anchored on /Parent so this cannot land on the /Pages node instead.
    const hostile = inner.replace(
      "/Type /Page /Parent",
      "/Annots [<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 20 20] " +
        "/FS << /Type /Filespec /F (payload.exe) >> " +
        "/AA << /E << /S /JavaScript /JS (app.alert\\(1\\)) >> >> >> " +
        "<< /Type /Annot /Subtype /Square /Rect [30 30 60 60] /C [1 0 0] >>] /Type /Page /Parent",
    );
    const bytes = new Uint8Array(hostile.length);
    for (let i = 0; i < hostile.length; i++) bytes[i] = hostile.charCodeAt(i) & 0xff;

    const pdf = new PDFDocument({ compress: false });
    const text = latin1String(await (await pdf.append(bytes)).render());
    expect(text).not.toContain("FileAttachment");
    expect(text).not.toContain("payload.exe");
    expect(text).not.toContain("JavaScript");
    // …while the harmless markup annotation next to it is carried over, so the
    // filter is doing the work and not just failing to read the array.
    expect(text).toContain("/Subtype /Square");
  });

  it("drops form-field widgets, which have no /AcroForm here", async () => {
    const inner = new PDFDocument({ compress: false });
    inner.signature({ name: "sig1" });
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await inner.toBuffer());
    const text = latin1String(await pdf.render());
    expect(text).not.toContain("/Subtype /Widget");
    expect(text).not.toContain("/AcroForm");
  });

  it("keeps a link between two imported pages pointing at the imported page", async () => {
    const inner = new PDFDocument({ compress: false });
    inner.anchor("appendix");
    inner.text("see appendix", { link: "#appendix" });
    inner.addPage();
    inner.text("appendix");

    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await inner.toBuffer());
    const rendered = await pdf.render();
    const text = latin1String(rendered);
    expect(text).toContain("/Subtype /Link");
    expect(text).toContain("/Dest");
    // Exactly three pages: the internal jump must not have duplicated one.
    expect(await pageSizes(rendered)).toHaveLength(3);
  });

  it("drops a jump whose target page was left behind", async () => {
    const inner = new PDFDocument({ compress: false });
    inner.text("see appendix", { link: "#appendix" });
    inner.addPage();
    inner.anchor("appendix");
    inner.text("appendix");

    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await inner.toBuffer(), { pages: [1] });
    const rendered = await pdf.render();
    expect(latin1String(rendered)).not.toContain("/Dest");
    expect(await pageSizes(rendered)).toHaveLength(2);
  });
});

describe("append() — interaction with the rest of the document", () => {
  it("survives being rendered twice", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await source(), { fit: "page" });
    const first = latin1String(await pdf.render());
    const second = latin1String(await pdf.render());
    // The imported page is drawn exactly once per render, not accumulated.
    expect(second.match(/\/FpImport Do/g)).toHaveLength(1);
    expect(first.match(/\/FpImport Do/g)).toHaveLength(1);
  });

  it("works inside an encrypted document", async () => {
    const pdf = new PDFDocument({ encrypt: { userPassword: "pw" } });
    await pdf.append(await source());
    const bytes = await pdf.render();
    expect(latin1String(bytes)).toContain("/Encrypt");
    // The copied content stream is encrypted along with everything else.
    expect(latin1String(bytes)).not.toContain("(Certificate page 1) Tj");
  });

  it("appends from more than one file", async () => {
    const pdf = new PDFDocument({ compress: false });
    pdf.text("Curriculum Vitae");
    await pdf.append(await source({ pages: 2 }));
    await pdf.append(await makeObjStmPdf(), { fit: "page" });
    expect(pdf.pageCount).toBe(4);
    const sizes = await pageSizes(await pdf.render());
    expect(sizes).toHaveLength(4);
    expect(sizes[3]).toEqual({ width: 595.28, height: 841.89 });
  });

  it("ignores an empty page selection", async () => {
    const pdf = new PDFDocument();
    await pdf.append(await source(), { pages: [] });
    expect(pdf.pageCount).toBe(1);
  });
});
