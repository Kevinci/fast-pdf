import { describe, expect, it } from "vitest";
import * as core from "../src/index";
import * as dom from "../src/dom/index";
import * as internal from "../src/internal";
import * as pdfa from "../src/pdfa/index";
import * as zugferd from "../src/zugferd/index";

/**
 * The public surface, written down.
 *
 * `src/index.ts` is what 1.0.0 freezes, so a new export there is a decision,
 * not an accident — this file is where that decision becomes visible in a
 * diff. The two subpaths are pinned the same way, and the third block checks
 * what the 0.9.0 cut was for: that the names which moved are *gone* from the
 * main entry rather than quietly re-exported.
 *
 * Only runtime values can be listed here; type-only exports disappear at
 * runtime, so `tsc` is what guards those (and this file imports a few of them
 * below to make sure they are reachable from the entry they belong to).
 */

/** Everything `fast-pdf` exports as a value. */
const CORE = [
  "FastPDFError",
  "PAGE_FORMATS",
  "PDFDocument",
  "parseColor",
  "parseCssColor",
  "pdfInfo",
  "supportsCompression",
  "supportsEncryption",
];

/** Everything `fast-pdf/dom` exports as a value. */
const DOM = ["attachTablePdfButton", "downloadTablePDF", "tableToPDF", "tableToRows"];

/** Everything `fast-pdf/internal` exports as a value. */
const INTERNAL = [
  "ContentStream",
  "EmbeddedFont",
  "Name",
  "PDFString",
  "PDFWriter",
  "Ref",
  "TTFFont",
  "createSecurityHandler",
  "deflate",
  "inflate",
  "serialize",
];

const names = (module_: object): string[] => Object.keys(module_).sort();

describe("entry points", () => {
  it("fast-pdf exports the document API and nothing else", () => {
    expect(names(core)).toEqual(CORE);
    expect(typeof core.PDFDocument).toBe("function");
  });

  it("fast-pdf/dom exports the HTML-table reader", () => {
    expect(names(dom)).toEqual(DOM);
    expect(typeof dom.tableToPDF).toBe("function");
  });

  it("fast-pdf/internal exports the engine", () => {
    expect(names(internal)).toEqual(INTERNAL);
    expect(typeof internal.PDFWriter).toBe("function");
  });

  it("fast-pdf/pdfa and fast-pdf/zugferd each export one function", () => {
    expect(names(pdfa)).toEqual(["pdfA"]);
    expect(names(zugferd)).toEqual(["facturX"]);
  });

  it("nothing that can embed a file is reachable from the main entry", () => {
    // The security promise: an embedded file needs an explicit opt-in import.
    expect(names(core)).not.toContain("pdfA");
    expect(names(core)).not.toContain("facturX");
    expect(Object.getOwnPropertyNames(core.PDFDocument.prototype)).not.toContain("attach");
  });

  it("the main entry no longer carries what moved to a subpath", () => {
    // The point of the 0.9.0 cut: a clean break, not a deprecated alias.
    for (const moved of [...DOM, ...INTERNAL]) {
      expect(names(core)).not.toContain(moved);
    }
  });

  it("keeps the feature-detection pair together in the main entry", () => {
    // Both answer "will this platform run it?", so both are the caller's
    // business — unlike deflate/inflate, which are engine parts.
    expect(typeof core.supportsCompression()).toBe("boolean");
    expect(typeof core.supportsEncryption()).toBe("boolean");
  });
});

describe("entry point types", () => {
  it("exposes the types each entry is responsible for", () => {
    // Compile-time assertions; `tsc --noEmit` is what actually checks them.
    const document_: core.PDFDocumentOptions = { compress: false };
    const signing: core.SigningOptions | undefined = undefined;
    const info: core.PDFInfo | undefined = undefined;
    const cell: core.TableCell = { text: "x" };
    const reader: dom.StyleReader | undefined = undefined;
    const value: internal.PDFValue = null;

    expect([document_, signing, info, cell, reader, value]).toHaveLength(6);
  });
});
