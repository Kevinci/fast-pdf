/**
 * `fast-pdf/zugferd` — ZUGFeRD / Factur-X hybrid invoices.
 *
 * A ZUGFeRD invoice is a PDF/A-3 file that a person can read, with the same
 * invoice embedded as machine-readable XML (UN/CEFACT CII). This entry point
 * builds the **container**: it turns the document into PDF/A-3, embeds the
 * XML you pass under the name the standard prescribes, registers it as an
 * associated file and writes the Factur-X XMP properties.
 *
 * It does **not** create or validate the invoice XML. That is tax logic —
 * rounding rules, VAT categories, code lists — and belongs to a library made
 * for it. Bring the XML; fast-pdf wraps it.
 *
 * ```ts
 * import { PDFDocument } from "fast-pdf";
 * import { facturX } from "fast-pdf/zugferd";
 *
 * const doc = new PDFDocument({ font: "inter", metadata: { title: "Invoice 2026-041" } });
 * doc.registerFont(interRegular, { family: "inter" });
 * facturX(doc, invoiceXml, { profile: "EN 16931" });
 * doc.text("Invoice 2026-041");
 * await doc.save("invoice.pdf");
 * ```
 */
import type { PDFDocument } from "../document/document";
import { FastPDFError } from "../errors";
import {
  addXmpExtension,
  enablePdfA,
  type PdfAConformance,
  type PdfAHandle,
  type PdfAOutputProfile,
  type PdfARelationship,
} from "../pdfa/mode";

/**
 * The Factur-X / ZUGFeRD profile of the invoice XML.
 *
 * `MINIMUM` and `BASIC WL` carry no invoice lines. They are valid Factur-X,
 * but **not an e-invoice under German law** (UStAE 14.1 (14)): use `BASIC`,
 * `EN 16931`, `EXTENDED` or `XRECHNUNG` for invoices between German
 * businesses.
 */
export type FacturXProfile =
  "MINIMUM" | "BASIC WL" | "BASIC" | "EN 16931" | "EXTENDED" | "XRECHNUNG";

export interface FacturXOptions {
  /** The profile the XML conforms to. Written to the XMP metadata. */
  profile: FacturXProfile;
  /**
   * `/AFRelationship` of the XML. Defaults to what the specification's
   * profile matrix gives for Germany: `"Data"` for `MINIMUM` and `BASIC WL`,
   * `"Alternative"` for every other profile.
   */
  relationship?: PdfARelationship;
  /** Description shown in the viewer's attachment list. */
  description?: string;
  /** Modification date recorded with the XML. Defaults to the document's creation date. */
  modDate?: Date;
  /** PDF/A-3 conformance level. Default `"B"`. */
  conformance?: PdfAConformance;
  /** Replace the bundled sRGB output profile. */
  outputProfile?: PdfAOutputProfile;
  /**
   * Skip the plausibility check of the XML (root element and guideline ID
   * against `profile`). Default `true` — the check runs.
   */
  checkXml?: boolean;
}

const NAMESPACE = "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#";

/** Lower-cased guideline ID → does it identify this profile? */
const GUIDELINE: Record<FacturXProfile, (id: string) => boolean> = {
  MINIMUM: (id) => id.endsWith(":minimum"),
  "BASIC WL": (id) => id.endsWith(":basicwl"),
  BASIC: (id) => id.endsWith(":basic"),
  "EN 16931": (id) => id === "urn:cen.eu:en16931:2017",
  EXTENDED: (id) => id.endsWith(":extended"),
  XRECHNUNG: (id) => id.includes("xrechnung"),
};

const invalid = (message: string): FastPDFError =>
  new FastPDFError(`Factur-X: ${message}`, "INVALID_ARGUMENT");

/**
 * A plausibility check, not a validation: is this a CII invoice, and does it
 * say it follows the profile the caller named? It catches the two mistakes
 * that are cheap to make and expensive to ship — the wrong file, and a
 * profile that contradicts the XML (BR-HYBRID-15). Schema and business-rule
 * validation is the job of an EN 16931 validator.
 */
function checkXml(xml: string, profile: FacturXProfile): void {
  if (!/<(?:[\w.-]+:)?CrossIndustryInvoice[\s>]/.test(xml)) {
    throw invalid(
      "the XML has no <CrossIndustryInvoice> root element — Factur-X embeds a UN/CEFACT CII " +
        "invoice (UBL is not accepted in a hybrid PDF).",
    );
  }
  const context =
    /<(?:[\w.-]+:)?GuidelineSpecifiedDocumentContextParameter[\s>][\s\S]*?<(?:[\w.-]+:)?ID[^>]*>\s*([^<]*?)\s*</.exec(
      xml,
    );
  if (context === null) {
    throw invalid(
      "the XML has no GuidelineSpecifiedDocumentContextParameter/ID, so its profile cannot be checked.",
    );
  }
  const id = context[1]!;
  if (!GUIDELINE[profile](id.toLowerCase())) {
    throw invalid(
      `the XML declares the guideline "${id}", which does not match the profile "${profile}". ` +
        "Pass the profile the XML was generated for, or set checkXml: false.",
    );
  }
}

/**
 * Make `document` a ZUGFeRD / Factur-X invoice carrying `xml`.
 *
 * Turns the document into PDF/A-3 (see `pdfA()` in `fast-pdf/pdfa` for what
 * that requires of the content — above all: an embedded font for all text),
 * embeds the XML as `factur-x.xml` (`xrechnung.xml` for the XRECHNUNG
 * profile) with MIME type `text/xml`, and writes the Factur-X XMP properties
 * together with their PDF/A extension schema.
 *
 * Returns the PDF/A handle, so further files can be attached.
 */
export function facturX(
  document: PDFDocument,
  xml: Uint8Array | string,
  options: FacturXOptions,
): PdfAHandle {
  const profile = options?.profile;
  if (!(profile in GUIDELINE)) {
    throw invalid(
      `profile must be one of ${Object.keys(GUIDELINE).join(", ")} — got ${JSON.stringify(profile)}`,
    );
  }
  let bytes: Uint8Array;
  if (typeof xml === "string") bytes = new TextEncoder().encode(xml);
  else if (xml instanceof Uint8Array) bytes = xml;
  else throw invalid("xml must be a Uint8Array or a string");
  if (bytes.length === 0) throw invalid("xml is empty");
  if (options.checkXml !== false) {
    checkXml(typeof xml === "string" ? xml : new TextDecoder().decode(bytes), profile);
  }

  // BR-HYBRID-13: the file name is fixed by the specification.
  const filename = profile === "XRECHNUNG" ? "xrechnung.xml" : "factur-x.xml";
  const handle = enablePdfA(document, {
    conformance: options.conformance,
    outputProfile: options.outputProfile,
  });
  handle.attach({
    filename,
    data: bytes,
    mimeType: "text/xml",
    relationship:
      options.relationship ??
      (profile === "MINIMUM" || profile === "BASIC WL" ? "Data" : "Alternative"),
    description: options.description ?? "Factur-X/ZUGFeRD invoice (structured data)",
    modDate: options.modDate,
  });
  // BR-HYBRID-03…-09. `Version` is "1.0" for every Factur-X release; the
  // specification version lives in the XML, not here.
  addXmpExtension(document, {
    schema: "Factur-X PDFA Extension Schema",
    namespaceURI: NAMESPACE,
    prefix: "fx",
    properties: [
      {
        name: "DocumentFileName",
        value: filename,
        description: "The name of the embedded XML document",
      },
      {
        name: "DocumentType",
        value: "INVOICE",
        description: "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER",
      },
      {
        name: "Version",
        value: "1.0",
        description: "The actual version of the standard applying to the embedded XML document",
      },
      {
        name: "ConformanceLevel",
        value: profile,
        description: "The conformance level of the embedded XML document",
      },
    ],
  });
  return handle;
}

export type {
  PdfAConformance,
  PdfAHandle,
  PdfAOutputProfile,
  PdfARelationship,
} from "../pdfa/mode";
