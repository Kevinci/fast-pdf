import type { PDFDocument } from "../document/document";
import { setHook, type CatalogContext, type RenderState } from "../document/hooks";
import { FastPDFError } from "../errors";
import { EmbeddedFont } from "../fonts/embedded";
import type { ParsedImage } from "../images/image";
import { Name, textString, type PDFString, type PDFValue, type Ref } from "../pdf/objects";
import type { PDFWriter } from "../pdf/writer";
import { SRGB_IDENTIFIER, srgbProfile } from "./icc";
import { buildXmp, type XmpExtensionSchema } from "./xmp";

/**
 * PDF/A-3 mode — the implementation behind `fast-pdf/pdfa`.
 *
 * PDF/A is not a feature that sits beside the others; it is a mode that
 * switches some of them off. Enabling it for a document does two things:
 *
 * - it ADDS what the standard requires and fast-pdf otherwise omits: an XMP
 *   metadata stream with the PDF/A identification, an output intent with an
 *   sRGB ICC profile, and — on request — embedded files with their
 *   relationship to the document;
 * - it REFUSES, at render time and with an error that says what to change,
 *   everything that cannot be conforming: the non-embedded standard fonts,
 *   text the font has no glyph for, encryption, CMYK JPEGs, appended
 *   third-party pages.
 *
 * Signing stays available: a PAdES-signed PDF/A-3b passes veraPDF ([6.4.3]).
 *
 * Clause numbers refer to ISO 19005-3:2012 as implemented by the veraPDF
 * profile PDFA-3B; see docs/research/pdfa3b-anforderungen.md.
 */

/** PDF/A-3 conformance level: `B` (visual reproduction) or `U` (B plus Unicode text). */
export type PdfAConformance = "B" | "U";

/**
 * How an embedded file relates to the document (`/AFRelationship`).
 * `Alternative` — another representation of the same content (e.g. the XML
 * of an invoice); `Source` — what the document was made from; `Data` — data
 * behind it; `Supplement` — additional material; `Unspecified` — none of
 * these.
 */
export type PdfARelationship = "Alternative" | "Data" | "Source" | "Supplement" | "Unspecified";

export interface PdfAOutputProfile {
  /** An ICC profile with colour space RGB and device class `mntr` or `prtr`. */
  data: Uint8Array;
  /** Name of the output condition, e.g. `"sRGB IEC61966-2.1"`. */
  identifier: string;
}

export interface PdfAOptions {
  /**
   * Conformance level to declare. Default `"B"`.
   *
   * `"U"` additionally promises that all text maps to Unicode. fast-pdf
   * always writes a ToUnicode map for embedded fonts, so the level costs
   * nothing extra — it is opt-in only because it is the stronger claim.
   */
  conformance?: PdfAConformance;
  /**
   * Replace the bundled sRGB output profile. Must be an RGB profile: the
   * document's colours are written in DeviceRGB, which PDF/A accepts only
   * against an RGB output intent.
   */
  outputProfile?: PdfAOutputProfile;
}

export interface PdfAAttachment {
  /** File name shown by viewers and used to extract the file. No path. */
  filename: string;
  /** The file's bytes; a string is stored as UTF-8. */
  data: Uint8Array | string;
  /** MIME type, e.g. `"text/xml"`. PDF/A requires one for every embedded file. */
  mimeType: string;
  /** Relationship to the document. Default `"Unspecified"`. */
  relationship?: PdfARelationship;
  /** Human-readable description shown in the viewer's attachment list. */
  description?: string;
  /**
   * Modification date recorded with the file. Defaults to the document's
   * creation date; omitted when the document is `deterministic` and has none.
   */
  modDate?: Date;
}

/** What `pdfA()` returns: the document's PDF/A-specific operations. */
export interface PdfAHandle {
  /** The conformance level this document declares. */
  readonly conformance: PdfAConformance;
  /**
   * Embed a file in the document. This is the only way fast-pdf ever writes
   * an embedded file, and it stores exactly the bytes you pass.
   */
  attach(file: PdfAAttachment): void;
}

interface Attachment {
  filename: string;
  data: Uint8Array;
  mimeType: string;
  relationship: PdfARelationship;
  description?: string;
  modDate?: Date;
}

interface State {
  conformance: PdfAConformance;
  profile: PdfAOutputProfile;
  attachments: Attachment[];
  extensions: XmpExtensionSchema[];
  handle: PdfAHandle;
}

const states = new WeakMap<PDFDocument, State>();

const RELATIONSHIPS: readonly PdfARelationship[] = [
  "Alternative",
  "Data",
  "Source",
  "Supplement",
  "Unspecified",
];

const violation = (message: string): FastPDFError =>
  new FastPDFError(`PDF/A: ${message}`, "PDFA_VIOLATION");

const invalid = (message: string): FastPDFError => new FastPDFError(message, "INVALID_ARGUMENT");

const tag = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));

/** [6.2.3-1]: device class `mntr` or `prtr`; here additionally colour space RGB. */
function checkProfile(profile: PdfAOutputProfile): void {
  const { data, identifier } = profile;
  if (!(data instanceof Uint8Array) || data.length < 128 || tag(data, 36) !== "acsp") {
    throw invalid("outputProfile.data is not an ICC profile");
  }
  const deviceClass = tag(data, 12);
  if (deviceClass !== "mntr" && deviceClass !== "prtr") {
    throw invalid(
      `outputProfile must be a monitor or printer profile (device class "mntr" or "prtr"), got "${deviceClass}"`,
    );
  }
  const space = tag(data, 16);
  if (space !== "RGB ") {
    throw invalid(
      `outputProfile must be an RGB profile — fast-pdf writes its colours in DeviceRGB — got "${space.trim()}"`,
    );
  }
  if (typeof identifier !== "string" || identifier.trim() === "") {
    throw invalid("outputProfile.identifier must be a non-empty string");
  }
}

function pdfDate(date: Date): string {
  const p = (n: number, length = 2): string => String(n).padStart(length, "0");
  return (
    `D:${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

function begin(state: RenderState): void {
  // [6.1.3-2] The keyword Encrypt shall not be used in the trailer dictionary.
  if (state.encrypted) {
    throw violation(
      "an encrypted document cannot be PDF/A — remove the `encrypt` option. " +
        "Archival formats must stay readable without a key.",
    );
  }
  // [6.2.2-1] and the font/colour rules: an appended page brings fonts, colour
  // spaces and operators fast-pdf did not write and cannot vouch for.
  if (state.imported) {
    throw violation(
      "append() cannot be combined with PDF/A — pages copied from another PDF " +
        "bring fonts and colour spaces whose conformance fast-pdf cannot guarantee.",
    );
  }
  // [6.2.11.4.1-1] again: field values are set in the non-embedded Helvetica,
  // in the appearance streams and in whatever a viewer regenerates from /DA.
  if (state.forms) {
    throw violation(
      "form fields are not supported in PDF/A mode yet — their text is set in the " +
        "non-embedded Helvetica. Remove textField(), checkbox(), radioGroup() and dropdown(); " +
        "signature fields are fine.",
    );
  }
  for (const font of state.fonts) {
    // [6.2.11.4.1-1] The font programs for all fonts used for rendering shall
    // be embedded. The standard 14 are referenced by name only.
    if (!(font instanceof EmbeddedFont)) {
      throw violation(
        `the built-in font "${font.baseFont}" is not embedded. Register a TrueType font ` +
          'with registerFont() and use it for all text — e.g. new PDFDocument({ font: "myfont" }). ' +
          "For Markdown code, pass markdown(source, { codeFont }).",
      );
    }
    // [6.2.11.8-1] A document shall not contain a reference to the .notdef glyph.
    const missing = font.missingCodePoint;
    if (missing !== undefined) {
      const hex = missing.toString(16).toUpperCase().padStart(4, "0");
      throw violation(
        `the font "${font.ttf.postScriptName}" has no glyph for U+${hex} ` +
          `(${JSON.stringify(String.fromCodePoint(missing))}), which the document uses. ` +
          "Remove the character or register a font that contains it.",
      );
    }
  }
}

function image(parsed: ParsedImage): void {
  // [6.2.4.3-3] DeviceCMYK needs a CMYK output intent; this document's is RGB,
  // and a document has only one.
  const space = parsed.dict["ColorSpace"];
  if (space instanceof Name && space.value === "DeviceCMYK") {
    throw violation(
      "CMYK JPEGs are not supported — the document's output intent is RGB. " +
        "Convert the image to RGB first.",
    );
  }
}

function catalog(
  state: State,
  writer: PDFWriter,
  context: CatalogContext,
): Record<string, PDFValue | undefined> {
  // ── XMP metadata ([6.6.2.1], [6.6.4]) ──
  // UTF-8 by rule ([6.6.2.1-5]), and left unfiltered so that tools which read
  // metadata without parsing the PDF can still find the packet.
  const xmp = buildXmp({
    part: 3,
    conformance: state.conformance,
    metadata: context.metadata,
    producer: context.metadata.producer ?? "fast-pdf",
    date: context.date,
    extensions: state.extensions,
  });
  const metadataRef = writer.addStream(
    { Type: new Name("Metadata"), Subtype: new Name("XML") },
    new TextEncoder().encode(xmp),
  );

  // ── Output intent ([6.2.3], [6.2.4.3]) ──
  // /GTS_PDFA1 is the subtype in every part of PDF/A; it was never renamed.
  const profileRef = writer.addStream({ N: 3 }, state.profile.data);
  const intentRef = writer.add({
    Type: new Name("OutputIntent"),
    S: new Name("GTS_PDFA1"),
    OutputConditionIdentifier: textString(state.profile.identifier),
    Info: textString(state.profile.identifier),
    DestOutputProfile: profileRef,
  });

  // ── Embedded files ([6.8]) ──
  const specs: { name: PDFString; ref: Ref }[] = [];
  for (const file of state.attachments) {
    const modDate = file.modDate ?? context.date;
    const fileRef = writer.addStream(
      {
        Type: new Name("EmbeddedFile"),
        // [6.8-1] The MIME type goes in /Subtype, as a name ("text/xml" is
        // written /text#2Fxml).
        Subtype: new Name(file.mimeType),
        Params: {
          Size: file.data.length,
          ModDate: modDate !== undefined ? textString(pdfDate(modDate)) : undefined,
        },
      },
      file.data,
    );
    const name = textString(file.filename);
    const specRef = writer.add({
      Type: new Name("Filespec"),
      // [6.8-2] both /F and /UF; [6.8-3] /AFRelationship.
      F: name,
      UF: name,
      AFRelationship: new Name(file.relationship),
      Desc: file.description !== undefined ? textString(file.description) : undefined,
      EF: { F: fileRef, UF: fileRef },
    });
    specs.push({ name, ref: specRef });
  }
  // A name tree's keys must be in ascending byte order.
  specs.sort((a, b) => (a.name.value < b.name.value ? -1 : a.name.value > b.name.value ? 1 : 0));
  const names: PDFValue[] = [];
  for (const spec of specs) names.push(spec.name, spec.ref);

  return {
    Metadata: metadataRef,
    OutputIntents: [intentRef],
    Names: specs.length > 0 ? { EmbeddedFiles: { Names: names } } : undefined,
    // Associated files at document level; viewers and validators look here.
    AF: specs.length > 0 ? specs.map((spec) => spec.ref) : undefined,
  };
}

function attach(state: State, file: PdfAAttachment): void {
  const { filename, mimeType } = file;
  if (typeof filename !== "string" || filename === "" || filename.length > 255) {
    throw invalid("attachment filename must be a non-empty string of at most 255 characters");
  }
  if (/[/\\\u0000-\u001f\u007f]/.test(filename) || filename === "." || filename === "..") {
    throw invalid(
      `attachment filename ${JSON.stringify(filename)} must be a plain file name without a path`,
    );
  }
  if (state.attachments.some((existing) => existing.filename === filename)) {
    throw invalid(`an attachment named ${JSON.stringify(filename)} already exists`);
  }
  if (typeof mimeType !== "string" || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) {
    throw invalid(
      `attachment mimeType ${JSON.stringify(mimeType)} is not a MIME type (expected e.g. "text/xml")`,
    );
  }
  const relationship = file.relationship ?? "Unspecified";
  if (!RELATIONSHIPS.includes(relationship)) {
    throw invalid(
      `attachment relationship must be one of ${RELATIONSHIPS.join(", ")} — got ${JSON.stringify(relationship)}`,
    );
  }
  let data: Uint8Array;
  if (typeof file.data === "string") data = new TextEncoder().encode(file.data);
  else if (file.data instanceof Uint8Array) data = file.data;
  else throw invalid("attachment data must be a Uint8Array or a string");
  state.attachments.push({
    filename,
    data,
    mimeType,
    relationship,
    description: file.description,
    modDate: file.modDate,
  });
}

/** Turn PDF/A-3 mode on for a document, or return the handle if it already is. */
export function enablePdfA(document: PDFDocument, options: PdfAOptions = {}): PdfAHandle {
  const existing = states.get(document);
  if (existing !== undefined) {
    if (
      (options.conformance !== undefined && options.conformance !== existing.conformance) ||
      options.outputProfile !== undefined
    ) {
      throw invalid("PDF/A is already enabled for this document with different options");
    }
    return existing.handle;
  }

  const conformance = options.conformance ?? "B";
  if (conformance !== "B" && conformance !== "U") {
    throw invalid(
      `PDF/A conformance must be "B" or "U" — got ${JSON.stringify(conformance)}. ` +
        'Level "A" needs tagged PDF, which fast-pdf does not write.',
    );
  }
  const profile = options.outputProfile ?? { data: srgbProfile(), identifier: SRGB_IDENTIFIER };
  if (options.outputProfile !== undefined) checkProfile(profile);

  const state: State = {
    conformance,
    profile,
    attachments: [],
    extensions: [],
    handle: {
      conformance,
      attach: (file) => attach(state, file),
    },
  };
  states.set(document, state);
  setHook(document, {
    begin,
    image,
    catalog: (writer, context) => catalog(state, writer, context),
  });
  return state.handle;
}

/**
 * Declare custom XMP properties through a PDF/A extension schema. Internal:
 * used by `fast-pdf/zugferd` for the Factur-X properties.
 */
export function addXmpExtension(document: PDFDocument, schema: XmpExtensionSchema): void {
  const state = states.get(document);
  if (state === undefined) throw new FastPDFError("PDF/A is not enabled", "INTERNAL");
  state.extensions.push(schema);
}
