/**
 * `fast-pdf/dom` — the browser-only entry point.
 *
 * Reading an HTML `<table>` needs a DOM and `getComputedStyle`, so none of
 * this works on a server. It lives behind its own subpath rather than in the
 * main entry so that a Node or edge bundle never carries the DOM reader it
 * cannot use.
 *
 * ```ts
 * import { tableToPDF } from "fast-pdf/dom";
 * ```
 *
 * Covered by SemVer like the main entry.
 */

export {
  tableToPDF,
  tableToRows,
  downloadTablePDF,
  attachTablePdfButton,
  type TableSource,
  type TablePDFOptions,
  type TablePdfButtonOptions,
  type TablePdfButtonHandle,
  type StyleReader,
} from "./table";
