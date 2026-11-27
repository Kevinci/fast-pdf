/**
 * `fast-pdf/pdfa` — PDF/A-3 output for long-term archiving.
 *
 * ```ts
 * import { PDFDocument } from "fast-pdf";
 * import { pdfA } from "fast-pdf/pdfa";
 *
 * const doc = new PDFDocument({ font: "inter", metadata: { title: "Report" } });
 * doc.registerFont(interRegular, { family: "inter" });
 * const archive = pdfA(doc);                    // PDF/A-3b from here on
 * archive.attach({ filename: "data.csv", data: csv, mimeType: "text/csv" });
 * doc.text("Hello");
 * await doc.save("report.pdf");
 * ```
 *
 * Opt-in by import: a document that never passes through `pdfA()` is written
 * exactly as before, and nothing reachable from the main entry point can
 * embed a file.
 */
import type { PDFDocument } from "../document/document";
import { enablePdfA, type PdfAHandle, type PdfAOptions } from "./mode";

export type {
  PdfAAttachment,
  PdfAConformance,
  PdfAHandle,
  PdfAOptions,
  PdfAOutputProfile,
  PdfARelationship,
} from "./mode";

/**
 * Make `document` a PDF/A-3 document.
 *
 * Adds the XMP metadata and the sRGB output intent the standard requires,
 * and from then on `render()`/`save()` throw a `FastPDFError` with code
 * `"PDFA_VIOLATION"` for anything that cannot be conforming:
 *
 * - text set in a built-in font (`helvetica`, `times`, `courier`) — PDF/A
 *   needs every font embedded, so register a TrueType font and use it for
 *   all text (for Markdown code: `markdown(source, { codeFont })`);
 * - a character the font has no glyph for;
 * - the `encrypt` option, `append()` and CMYK JPEGs.
 *
 * Signature fields and PAdES signing (`signature({ sign })`) keep working.
 *
 * Call it at any point before rendering; calling it again returns the same
 * handle. The checks run at render time, so the order of calls does not
 * matter.
 */
export function pdfA(document: PDFDocument, options?: PdfAOptions): PdfAHandle {
  return enablePdfA(document, options);
}
