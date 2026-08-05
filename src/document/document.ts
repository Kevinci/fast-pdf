import { Name, PDFString, latin1Bytes, textString, type PDFValue, type Ref } from "../pdf/objects";
import { PDFWriter } from "../pdf/writer";
import { PDFReader, type PDFDict, type SourcePage } from "../pdf/reader";
import {
  ObjectCopier,
  concatMatrix,
  displayMatrix,
  importAnnots,
  importAsForm,
  importPageDict,
  overlayMatrix,
  resourcesWithOverlay,
  transformRect,
  type Matrix,
} from "../pdf/import";
import { createSecurityHandler, supportsEncryption, type EncryptionOptions } from "../pdf/encrypt";
import { signaturePlaceholder, embedSignature, type SigningOptions } from "../pdf/sign";
import { ContentStream } from "../pdf/content";
import { deflate } from "../pdf/compress";
import { isStandardFamily, resolveFont, styleIndex, type Font } from "../fonts/font";
import { EmbeddedFont } from "../fonts/embedded";
import { wrapLines, alignOffset, measureLine, type WrappedLine } from "../layout/text";
import { columnWidths, countColumns, measureTable, type CellValue, type TableOptions, type MeasuredRow } from "../layout/table";
import { detectFormat, toBytes, type ParsedImage } from "../images/image";
import { parseJpeg } from "../images/jpeg";
import { parsePng, pngSize } from "../images/png";
import { gifSize, parseGif } from "../images/gif";
import { parseWebp, webpSize } from "../images/webp";
import { parseXml } from "../svg/parse";
import { renderSvg, viewport, type Mat, type SvgContext } from "../svg/render";
import { parseMarkdown, type MdBlock, type MdRun } from "../markdown/parse";
import { Page, type ImageEntry, type PendingLink } from "./page";
import { saveFile } from "../adapters/save";
import { FastPDFError } from "../errors";
import { assertFinite, assertNonNegative, blockedUriScheme } from "../validate";
import {
  BLACK,
  PAGE_FORMATS,
  normalizeMargins,
  parseColor,
  type ColorInput,
  type DocumentMetadata,
  type FontFamily,
  type Margins,
  type PageFormatName,
  type PageSize,
  type RGB,
  type TextAlign,
  type TextStyle,
} from "../types/index";

export interface PageOptions {
  /** Named format or explicit size in points. Default: "A4". */
  format?: PageFormatName | PageSize;
  landscape?: boolean;
  /** Margins in points (uniform or per side). Default: 50. */
  margins?: number | Partial<Margins>;
}

export interface PageBreakOptions extends PageOptions {
  /** Vertical start position on the new page (top-based, in points). Default: top margin. */
  y?: number;
}

/** How `append()` places the pages of an existing PDF. */
export interface AppendOptions extends PageOptions {
  /**
   * Which pages to take, as 1-based numbers in the order given.
   * Default: every page of the source.
   */
  pages?: number | number[];
  /**
   * `"keep"` (default) — appended pages keep their original size and are
   * copied unchanged, including their own rotation and annotations. This is
   * the faithful option: a scan stays exactly as it was scanned.
   *
   * `"page"` — pages are scaled to fit this document's page format, so a
   * Letter-sized certificate lines up with an A4 document.
   */
  fit?: "keep" | "page";
  /**
   * Allow drawing on the appended pages — `header()`, `footer()`,
   * `pageNumbers()`, `watermark()`, `onPage()` and anything drawn after the
   * `append()` call itself. The imported content stays untouched underneath.
   *
   * Default: `false` with `fit: "keep"` (nothing is drawn over a document
   * someone else signed unless asked), always on with `fit: "page"`.
   */
  overlay?: boolean;
  /** With `fit: "page"`: inset from the page edge, in points. Default: 0. */
  padding?: number;
  /**
   * With `fit: "page"`: give the target page the orientation of the source
   * page, so a landscape certificate is not shrunk into a portrait frame.
   * Default: true.
   */
  autoRotate?: boolean;
}

/** State shared by all pages appended from one file, so objects are copied once. */
interface ImportGroup {
  reader: PDFReader;
  /** Object numbers of the source pages that made it into this document. */
  imported: Set<number>;
}

/** A page whose content comes from an appended PDF. */
interface ImportedPage {
  group: ImportGroup;
  source: SourcePage;
  /** `keep` copies the source page dictionary; `form` draws it as an XObject. */
  mode: "keep" | "form";
  overlay: boolean;
  /** `form` only: where the scaled page lands on ours. */
  placement?: Matrix;
}

/** What the import contributes to one page at render time. */
interface ImportedParts {
  /** `keep`: the copied page dictionary, minus /Parent and /Annots. */
  pageDict?: PDFDict;
  /** `form`: the imported page as a form XObject, plus its resource name. */
  form?: { res: string; ref: Ref };
  /** `form`: a content stream that draws `form`, to run before our own. */
  contentPrefix?: Ref;
  /** Annotations carried over from the source page. */
  annots: Ref[];
  /**
   * `keep`: maps our top-left drawing space onto the source page's coordinates.
   * Link and signature rectangles have to go through it — the copied page keeps
   * the source's /Rotate and box offset, which annotations are subject to.
   */
  annotTransform?: Matrix;
}

export interface PDFDocumentOptions extends PageOptions {
  /** Default font family (standard or registered via registerFont()). Default: "helvetica". */
  font?: FontFamily | (string & {});
  /** Default font size in points. Default: 11. */
  fontSize?: number;
  /** Default line height as a multiple of the font size. Default: 1.25. */
  lineHeight?: number;
  /** Compress content streams (FlateDecode). Default: true. */
  compress?: boolean;
  /**
   * Produce byte-identical output for identical input. When `true`, the
   * document embeds no wall-clock timestamp (unless `metadata.creationDate`
   * is set explicitly), so the same content always renders to the same bytes
   * — ideal for reproducible builds, hashing, archiving and signatures.
   * Default: false (a real creation/modification date is embedded).
   */
  deterministic?: boolean;
  /**
   * Encrypt the document with the AES-256 (revision 6) standard security
   * handler. Provide a user and/or owner password and optional permission
   * restrictions. Encrypted output is inherently non-deterministic (random
   * salts and IVs). Requires the Web Crypto API.
   */
  encrypt?: EncryptionOptions;
  /**
   * Natural language of the document as a BCP 47 tag ("de", "en-GB"),
   * written to the catalog's `/Lang`. Screen readers use it to pick the
   * right pronunciation, and it is a baseline requirement of PDF/UA.
   */
  language?: string;
  metadata?: DocumentMetadata;
}

/** Fill/stroke transparency shared by every drawing call. */
export interface OpacityOption {
  /** Constant alpha from 0 (invisible) to 1 (opaque). Default: 1. */
  opacity?: number;
}

export interface TextOptions extends OpacityOption {
  /** Standard family ("helvetica" | "times" | "courier") or a family registered via registerFont(). */
  font?: FontFamily | (string & {});
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: ColorInput;
  align?: TextAlign;
  underline?: boolean;
  strikethrough?: boolean;
  /** Extra spacing between characters in points. */
  letterSpacing?: number;
  /** Make the text clickable: a URL or an anchor reference ("#name"). */
  link?: string;
  /** Line height as a multiple of the font size. */
  lineHeight?: number;
  /** Absolute x position in points. In flow mode: left offset within the content area. */
  x?: number;
  /**
   * Absolute y position (top-based). Providing `y` switches to absolute
   * positioning: the cursor does not move and no page breaks occur.
   */
  y?: number;
  /** Max text width in points. Default: remaining content width. */
  width?: number;
  /** Extra vertical space after the text block, in points (flow mode). */
  spacingAfter?: number;
  /**
   * Extra vertical space *before* the block, in points (flow mode).
   * Collapses to zero at the top of a page, column or region — which is
   * what makes it usable for "space above a heading" in flowing documents,
   * where `spacingAfter` alone leaves a gap in the wrong place.
   */
  spacingBefore?: number;
  /**
   * Keep the block together with what follows: reserve room for this block
   * plus `n` further lines (default 2) before drawing, so a heading never
   * ends up alone at the bottom of a page. Flow mode only.
   */
  keepWithNext?: boolean | number;
  /**
   * Rotate the whole block clockwise by this many degrees around its
   * top-left anchor. A rotated block never breaks across pages.
   */
  rotate?: number;
}

/** What `measureText()` reports — the exact result of the drawing engine. */
export interface TextMeasurement {
  /** The lines as they would actually be drawn. */
  lines: string[];
  /** Width of the widest line, in points. */
  width: number;
  /** Total block height: `lines.length * lineHeight`, in points. */
  height: number;
  /** Distance between two baselines, in points. */
  lineHeight: number;
  /** Baseline offset of the first line from the block top, in points. */
  baseline: number;
}

/** What `measureBlock()` reports. */
export interface BlockMeasurement {
  /** Height the block consumes in the flow, in points. */
  height: number;
  /** Flow width the block was measured against, in points. */
  width: number;
}

/** Vertical font metrics at a concrete size, in points. */
export interface FontMetricsInfo {
  /** The size the values are scaled to. */
  size: number;
  /** Top of the block to the baseline — where `text()` puts the first baseline. */
  baseline: number;
  ascent: number;
  /** Negative: how far descenders reach below the baseline. */
  descent: number;
  /** Height of a flat capital ("H") above the baseline. */
  capHeight: number;
  /** Extra leading the font recommends (0 for the standard 14). */
  lineGap: number;
  /** Distance between two baselines at the active line height. */
  lineHeight: number;
}

export interface ImageOptions extends OpacityOption {
  /** Target width/height in points. Aspect ratio is preserved if only one is given. */
  width?: number;
  height?: number;
  x?: number;
  /** Providing `y` switches to absolute positioning (no cursor movement). */
  y?: number;
  /**
   * How the image fills a fixed width×height box:
   * "fill" stretches (default), "contain" letterboxes, "cover" fills and
   * clips the overflow. Only meaningful when width and height are both set.
   */
  fit?: "fill" | "contain" | "cover";
  /** Crop region in source pixels, shown scaled into the target box. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Rotation in degrees, clockwise, around the box center. */
  rotate?: number;
  /**
   * Round the image's corners by this radius in points, clipping whatever
   * falls outside. `radius: height / 2` on a square box yields a circle —
   * or use `shape: "circle"`. Works in every runtime; no Canvas needed.
   */
  radius?: number;
  /**
   * Clip the image to a shape. "circle" is shorthand for a radius of half
   * the shorter box side. Default: "rect" (no rounding).
   */
  shape?: "rect" | "circle";
  /** Horizontal alignment within the flow area (flow mode). Default: "left". */
  align?: "left" | "center" | "right";
  spacingAfter?: number;
  /** Extra vertical space before the image (flow mode), collapsed at the top. */
  spacingBefore?: number;
}

export interface SvgOptions extends OpacityOption {
  /** Target width/height in points. Aspect ratio is preserved if only one is given. */
  width?: number;
  height?: number;
  x?: number;
  /** Providing `y` switches to absolute positioning (no cursor movement). */
  y?: number;
  /**
   * How the drawing fills a fixed width×height box:
   * "contain" fits it inside (default), "fill" stretches, "cover" fills and
   * clips the overflow.
   */
  fit?: "contain" | "fill" | "cover";
  /** Horizontal alignment within the flow area (flow mode). Default: "left". */
  align?: "left" | "center" | "right";
  /** Colour substituted for `currentColor` in the SVG. Default: black. */
  color?: ColorInput;
  spacingAfter?: number;
  /** Extra vertical space before the drawing (flow mode), collapsed at the top. */
  spacingBefore?: number;
}

export interface MarkdownOptions {
  /**
   * Resolve an image reference from `![alt](src)` to raw bytes. Without a
   * resolver, images render as their alt text (fast-pdf's core does no I/O).
   */
  resolveImage?: (src: string) => Uint8Array | ArrayBuffer | undefined;
}

export interface LineOptions extends OpacityOption {
  color?: ColorInput;
  width?: number;
}

export interface RectOptions extends OpacityOption {
  fill?: ColorInput;
  stroke?: ColorInput;
  lineWidth?: number;
  /** Corner radius in points for rounded rectangles. */
  radius?: number;
}

/** A rectangular area in top-left page coordinates, optionally rounded. */
export interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius in points. `radius: height / 2` on a square gives a circle. */
  radius?: number;
}

export interface RegionOptions extends ClipRect {
  /** Clip content to the region's bounds. Default: false. */
  clip?: boolean;
}

/** What `region()` reports back about the content it laid out. */
export interface RegionResult {
  /** Height the content actually consumed, in points. */
  usedHeight: number;
  /** Unused height left in the region (negative when it overflowed). */
  remaining: number;
  /** True when the content did not fit — no silent clipping surprises. */
  overflow: boolean;
}

/** Fill/stroke options for closed shapes (circles, ellipses). */
export type ShapeOptions = Omit<RectOptions, "radius">;

/** A size in points, or a percentage of the available width ("50%"). */
export type SizeInput = number | string;

export interface ContainerOptions extends OpacityOption {
  /** Outer width — points or percentage of the available width. Default: full width. */
  width?: SizeInput;
  /** Inner padding in points (uniform or per side). Default: 0. */
  padding?: number | Partial<Margins>;
  /** Outer margin in points (uniform or per side). Default: 0. */
  margin?: number | Partial<Margins>;
  background?: ColorInput;
  border?: { color?: ColorInput; width?: number };
  /** Corner radius for background/border. */
  radius?: number;
  /** Horizontal placement within the available width. Default: "left". */
  align?: "left" | "center" | "right";
  /** Minimum outer height in points. */
  minHeight?: number;
}

export interface ColumnsOptions {
  /** Column widths — points or percentages of the available width. Default: equal. */
  widths?: SizeInput[];
  /** Gap between columns in points. Default: 12. */
  gap?: number;
}

export interface GridOptions {
  /** Number of columns. */
  columns: number;
  /** Gap between columns in points. Default: 12. */
  gap?: number;
  /** Gap between rows in points. Default: same as `gap`. */
  rowGap?: number;
}

/**
 * One item in a `flowColumns()` sequence. A bare function is shorthand for
 * `{ render }`; the object form adds the spacing and keep rules that make
 * newspaper-style flow readable.
 */
export type FlowItem =
  | ((doc: PDFDocument) => void)
  | {
      render: (doc: PDFDocument) => void;
      /** Space above the item, collapsed at the top of a column. */
      spacingBefore?: number;
      /** Space below the item. */
      spacingAfter?: number;
      /** Never end a column directly after this item (e.g. a category heading). */
      keepWithNext?: boolean;
    };

export interface FlowColumnsOptions {
  /** Number of columns. Default: 2. */
  columns?: number;
  /** Column widths — points or percentages. Default: equal. */
  widths?: SizeInput[];
  /** Gap between columns in points. Default: 18. */
  gap?: number;
  /**
   * Even out the columns on the last page instead of filling the first one
   * to the bottom — what makes a two-column list look typeset rather than
   * merely correct. Default: false.
   */
  balance?: boolean;
  /** Bottom limit in points (top-based). Default: the page's content bottom. */
  bottom?: number;
}

/** What `flowColumns()` reports back. */
export interface FlowColumnsResult {
  /** Number of pages the flow occupied (1 = it fit on the current page). */
  pages: number;
  /** Items that could not be placed at all (each was taller than a column). */
  dropped: number;
}

/** One column of an objectTable(): which property to show, and how. */
export interface ObjectTableColumn<T> {
  /** Property to read from each record. */
  key: keyof T & string;
  /** Header label. Default: the key itself. */
  header?: string;
  /** Column width in points. Unspecified columns share the leftover space. */
  width?: number;
  align?: TextAlign;
  /** Convert the raw value to cell text. Default: String(value), "" for null/undefined. */
  format?: (value: unknown, record: T) => string;
}

export interface ObjectTableOptions<T> extends Omit<TableOptions, "widths" | "aligns" | "header"> {
  /** Columns to show (keys or full specs). Default: all keys of the first record. */
  columns?: (ObjectTableColumn<T> | (keyof T & string))[];
}

/** Info passed to page decorators (header/footer/watermark callbacks). */
export interface PageInfo {
  /** 1-based page number in final page order. */
  pageNumber: number;
  pageCount: number;
  size: PageSize;
  margins: Margins;
}

/**
 * Draws on one page at render time (headers, footers, watermarks).
 * Use absolute positioning (`y` option) — flow state is not available.
 */
export type PageDecorator = (doc: PDFDocument, info: PageInfo) => void;

export interface HeaderFooterOptions {
  font?: FontFamily | (string & {});
  size?: number;
  color?: ColorInput;
  align?: "left" | "center" | "right";
}

export interface PageNumberOptions extends HeaderFooterOptions {
  /** Build the label. Default: `${pageNumber} / ${pageCount}`. */
  format?: (pageNumber: number, pageCount: number) => string;
  position?: "top" | "bottom";
  /** First page that gets a number (1-based). Default: 1. */
  startAt?: number;
}

export interface WatermarkOptions {
  color?: ColorInput;
  /** Constant alpha 0–1. Default: 0.12. */
  opacity?: number;
  /** Rotation in degrees, clockwise. Default: along the page diagonal. */
  angle?: number;
  /** Font size in points. Default: sized to span ~60% of the page diagonal. */
  size?: number;
  font?: FontFamily | (string & {});
  bold?: boolean;
}

export interface SignatureOptions {
  /**
   * AcroForm field name — unique within the document, no periods.
   * Default: "Signature1", "Signature2", …
   */
  name?: string;
  /** Small label under the signature line (e.g. "Auftraggeber"). */
  label?: string;
  /** Field width in points. Default: 220. */
  width?: number;
  /** Field height in points. Default: 60. */
  height?: number;
  x?: number;
  /** Providing `y` switches to absolute positioning (no cursor movement). */
  y?: number;
  /** Draw a signature line at the bottom of the field. Default: true. */
  line?: boolean;
  /** Horizontal alignment within the flow area (flow mode). Default: "left". */
  align?: "left" | "center" | "right";
  spacingAfter?: number;
  /**
   * Cryptographically sign the document through this field, producing a
   * detached PAdES-B (CAdES) signature. At most one signed field per document.
   */
  sign?: SigningOptions;
}

export interface ButtonOptions {
  /** Where the button leads: a URL or an anchor reference ("#name"). */
  link: string;
  /** Background colour. Default: the document's text colour. */
  fill?: ColorInput;
  /** Border colour. Default: no border. */
  borderColor?: ColorInput;
  /** Border width in points. Default: 1 when `borderColor` is set, else 0. */
  borderWidth?: number;
  /** Label colour. Default: "#ffffff". */
  color?: ColorInput;
  /** Outer width — points or a percentage of the available width. Default: label plus padding. */
  width?: SizeInput;
  /** Outer height in points. Default: label line height plus padding. */
  height?: number;
  /** Corner radius in points. Default: 4. */
  radius?: number;
  /** Horizontal padding around the label. Default: 16. */
  paddingX?: number;
  /** Vertical padding around the label. Default: 8. */
  paddingY?: number;
  /** Label font family. Default: the document default. */
  font?: FontFamily | (string & {});
  /** Label size in points. Default: the document default. */
  size?: number;
  /** Bold label. Default: true. */
  bold?: boolean;
  letterSpacing?: number;
  /** Label placement inside the button. Default: "center". */
  textAlign?: "left" | "center" | "right";
  /** Button placement within the flow area (flow mode). Default: "left". */
  align?: "left" | "center" | "right";
  /** Constant alpha for background and border, from 0 to 1. Default: 1. */
  opacity?: number;
  /** Absolute x position, or a left offset within the flow area. */
  x?: number;
  /** Providing `y` switches to absolute positioning (no cursor movement). */
  y?: number;
  spacingBefore?: number;
  spacingAfter?: number;
}

export interface OutlineOptions {
  /** Nesting depth, 0 = top level. Default: 0. */
  level?: number;
}

export interface TOCOptions {
  /** Heading above the entries. Default: "Contents". */
  title?: string;
  /** Deepest outline level to include. Default: 1. */
  maxLevel?: number;
  /** Page index (0-based) the TOC pages are moved to. Default: 0 (front). */
  insertAt?: number;
}

const DEFAULT_MARGIN = 50;

/** Bézier circle approximation constant: 4/3 · (√2 − 1). */
const KAPPA = 0.5522847498;

/** Markdown rendering palette and relative heading sizes. */
const MD_HEADING_SCALE = [1.9, 1.55, 1.3, 1.15, 1.0, 0.9];
const MD_LINK_COLOR: RGB = { r: 0.13, g: 0.4, b: 0.85 };
const MD_CODE_COLOR: RGB = { r: 0.72, g: 0.11, b: 0.15 };
const MD_CODE_BG: RGB = { r: 0.96, g: 0.96, b: 0.97 };
const MD_QUOTE_BAR: RGB = { r: 0.8, g: 0.82, b: 0.86 };
const MD_QUOTE_TEXT: RGB = { r: 0.35, g: 0.38, b: 0.44 };
const MD_RULE_COLOR: RGB = { r: 0.85, g: 0.87, b: 0.9 };

/**
 * PDFDocument — the public API.
 *
 * High-level calls (`text`, `table`, `image`) flow top-to-bottom with an
 * internal cursor and break pages automatically. Low-level calls
 * (`line`, `rect`, absolute text/images) draw anywhere on the current page.
 * All coordinates are top-left based, in PDF points (1 pt = 1/72").
 */
export class PDFDocument {
  private readonly pages: Page[] = [];
  private readonly defaults: TextStyle;
  private readonly pageDefaults: Required<PageOptions>;
  private readonly compress: boolean;
  private readonly deterministic: boolean;
  private readonly encryption?: EncryptionOptions;
  private readonly language?: string;
  private readonly metadata: DocumentMetadata;
  private readonly images = new Map<Uint8Array, ImageEntry>();
  /** family → [regular, bold, italic, boldItalic] embedded fonts. */
  private readonly customFonts = new Map<string, (EmbeddedFont | undefined)[]>();
  private cursorY: number;
  /** Active layout frame (container/column); null = full content area. */
  private frame: { x: number; width: number } | null = null;
  /**
   * Top of the active flow area — the page's top margin, or where the
   * current container/column/region starts. `spacingBefore` collapses here.
   */
  private frameTop = 0;
  /** > 0 while inside container()/columns(): automatic page breaks are off. */
  private suppressBreaks = 0;
  /** Height the last flow block consumed, excluding its spacingAfter. */
  private lastBlock = 0;
  /** > 0 while measuring: drawing goes to a throwaway page. */
  private measuring = 0;
  /** Page decorators, applied to every page at render time. */
  private readonly decorators: PageDecorator[] = [];
  private decorated = false;
  /** Bookmark entries in document order. */
  private readonly outlines: { title: string; level: number; page: Page; y: number }[] = [];
  /** Named link targets. */
  private readonly anchors = new Map<string, { page: Page; y: number }>();
  /** Signature field names already taken (must be unique per document). */
  private readonly sigFieldNames = new Set<string>();
  /** Non-null while decorators run: overrides the "current page". */
  private activePage: Page | null = null;
  /** Pages whose content comes from an appended PDF, resolved at render time. */
  private readonly imported = new Map<Page, ImportedPage>();

  constructor(options: PDFDocumentOptions = {}) {
    this.pageDefaults = {
      format: options.format ?? "A4",
      landscape: options.landscape ?? false,
      margins: options.margins ?? DEFAULT_MARGIN,
    };
    this.defaults = {
      font: options.font ?? "helvetica",
      size: options.fontSize ?? 11,
      bold: false,
      italic: false,
      color: BLACK,
      lineHeight: options.lineHeight ?? 1.25,
      align: "left",
      underline: false,
      strikethrough: false,
      letterSpacing: 0,
    };
    this.compress = options.compress ?? true;
    this.deterministic = options.deterministic ?? false;
    this.encryption = options.encrypt;
    this.language = options.language;
    this.metadata = options.metadata ?? {};
    this.cursorY = 0;
    this.addPage();
  }

  // ── Pages ────────────────────────────────────────────────────────────

  /** Start a new page and move the cursor to its top margin. */
  addPage(options: PageOptions = {}): this {
    const merged = { ...this.pageDefaults, ...options };
    const base: PageSize =
      typeof merged.format === "string" ? PAGE_FORMATS[merged.format] : merged.format;
    if (!base) throw new FastPDFError(`Unknown page format: ${String(merged.format)}`, "UNKNOWN_PAGE_FORMAT");
    const size = merged.landscape
      ? { width: base.height, height: base.width }
      : { width: base.width, height: base.height };
    const page = new Page(size, normalizeMargins(merged.margins, DEFAULT_MARGIN));
    this.pages.push(page);
    this.cursorY = page.margins.top;
    this.frameTop = page.margins.top;
    return this;
  }

  /**
   * Force a page break: end the current page and continue the flow on a
   * fresh one — the explicit counterpart to the automatic breaks.
   * `y` controls where content on the new page starts (top-based, in
   * points); all addPage() options (format, landscape, margins) work too.
   *
   * Not allowed inside container()/columns()/grid() — those blocks are
   * guaranteed to stay on one page.
   */
  pageBreak(options: PageBreakOptions = {}): this {
    if (this.suppressBreaks > 0) {
      throw new FastPDFError(
        "pageBreak() is not allowed inside container()/columns()/grid() — these blocks stay on one page",
        "INVALID_ARGUMENT",
      );
    }
    const { y, ...pageOptions } = options;
    this.addPage(pageOptions);
    if (y !== undefined) this.cursorY = y;
    return this;
  }

  /**
   * Append the pages of an existing PDF — a certificate, a reference letter, a
   * scan the user uploaded — to this document.
   *
   * ```ts
   * const pdf = new PDFDocument();
   * pdf.text("Curriculum Vitae", { size: 24 });
   * await pdf.append(certificateBytes);                  // as it was
   * await pdf.append(letterBytes, { fit: "page" });      // scaled to A4
   * await pdf.append(scanBytes, { pages: [1, 2] });      // a selection
   * await pdf.save("application.pdf");
   * ```
   *
   * Pages are copied, not re-rendered: their content streams, fonts and images
   * move over byte-for-byte, so an appended page looks exactly like the
   * original and stays as small as it was. Objects shared by several pages of
   * one file are written once.
   *
   * The flow cursor continues *after* the appended pages: unless `overlay` is
   * set, the next `text()` starts on a fresh page rather than on top of
   * someone else's document. Use `pdfInfo()` to check a file's page count
   * before appending it.
   *
   * Not supported: encrypted source files (`ENCRYPTED_PDF` — remove the
   * protection first). Form fields, bookmarks and the tagged-content structure
   * of the source are not carried over. Annotations are, but only markup ones
   * (links, notes, highlights, shapes) and only with a plain web link or a jump
   * inside the imported pages — the source is an upload, and it must not be
   * able to smuggle a file attachment or a `/JavaScript` action into the output.
   */
  async append(source: Uint8Array | ArrayBuffer, options: AppendOptions = {}): Promise<this> {
    const reader = await PDFReader.open(toBytes(source));
    const selected = selectSourcePages(await reader.pages(), options.pages);
    if (selected.length === 0) return this;

    const fit = options.fit ?? "keep";
    // Scaled pages are ours to lay out, so drawing on them is always allowed;
    // a 1:1 copy is left alone unless the caller asks for an overlay.
    const overlay = fit === "page" ? true : (options.overlay ?? false);
    const padding = assertNonNegative(options.padding ?? 0, "append padding");
    const group: ImportGroup = {
      reader,
      imported: new Set(selected.map((page) => page.ref.num)),
    };

    for (const sourcePage of selected) {
      if (fit === "keep") {
        const target = new Page(
          { ...sourcePage.size },
          normalizeMargins(options.margins ?? this.pageDefaults.margins, DEFAULT_MARGIN),
        );
        this.pages.push(target);
        this.imported.set(target, { group, source: sourcePage, mode: "keep", overlay });
        continue;
      }
      const pageOptions: PageOptions = {
        landscape: (options.autoRotate ?? true)
          ? sourcePage.size.width > sourcePage.size.height
          : (options.landscape ?? this.pageDefaults.landscape),
      };
      if (options.format !== undefined) pageOptions.format = options.format;
      if (options.margins !== undefined) pageOptions.margins = options.margins;
      this.addPage(pageOptions);
      const target = this.pages[this.pages.length - 1]!;
      this.imported.set(target, {
        group,
        source: sourcePage,
        mode: "form",
        overlay: true,
        placement: containMatrix(sourcePage.size, target.size, padding),
      });
    }

    const last = this.pages[this.pages.length - 1]!;
    this.frameTop = last.margins.top;
    // Without an overlay the cursor is parked below the content area, so the
    // next flow block breaks to a new page instead of landing on top of the
    // imported one.
    this.cursorY = overlay ? last.margins.top : last.contentBottom + 1;
    return this;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get pageSize(): PageSize {
    return { ...this.page.size };
  }

  /** Current vertical cursor position (top-based), settable for manual flow control. */
  get y(): number {
    return this.cursorY;
  }

  set y(value: number) {
    this.cursorY = value;
  }

  /**
   * Absolute left edge of the active flow area — the page's left margin, or
   * the current container/column/region. Read-only.
   *
   * This is the bridge between the two coordinate modes: `text({ x })`
   * without `y` is an offset *from* this value, while `text({ x, y })` and
   * `rect(x, …)` take absolute page coordinates. `doc.x + offset` converts
   * the first into the second.
   */
  get x(): number {
    return this.flowX;
  }

  /** Width of the active flow area (page content width, container or column). */
  get width(): number {
    return this.flowWidth;
  }

  private get page(): Page {
    return this.activePage ?? this.pages[this.pages.length - 1]!;
  }

  /** Advance the cursor by `lines` default line heights. */
  moveDown(lines = 1): this {
    this.cursorY += lines * this.defaults.size * this.defaults.lineHeight;
    return this;
  }

  /**
   * Height the last flow block consumed (text, image, svg, table,
   * container, columns, markdown, signature), excluding its `spacingAfter`.
   *
   * This is the cheap answer to "how tall was that?" — including for
   * absolutely positioned blocks, where the cursor does not move at all.
   */
  get lastBlockHeight(): number {
    return this.lastBlock;
  }

  /** Space left between the cursor and the bottom of the content area, in points. */
  get remainingHeight(): number {
    return this.page.contentBottom - this.cursorY;
  }

  /**
   * Break to a new page unless `needed` points still fit below the cursor.
   * Returns true when a break happened. Inside container()/columns()/grid()
   * — where breaks are forbidden — it never breaks and returns false.
   *
   * This is the supported replacement for hand-rolled `reserve()` helpers
   * around absolutely positioned blocks, which never break by themselves.
   */
  ensureSpace(needed: number): boolean {
    assertFinite(needed, "ensureSpace needed");
    if (this.suppressBreaks > 0) return false;
    if (this.cursorY + needed > this.page.contentBottom && this.cursorY > this.page.margins.top) {
      this.addPage();
      return true;
    }
    return false;
  }

  /**
   * Draw a block that must not be split across pages: it is measured first
   * and moved to the next page whole if it does not fit below the cursor.
   *
   * The callback runs twice (once to measure, once to draw), so it must be
   * free of side effects outside the document.
   */
  keepTogether(content: (doc: this) => void): this {
    const { height } = this.measureBlock(content);
    this.ensureSpace(height);
    content(this);
    return this;
  }

  // ── Measurement ──────────────────────────────────────────────────────

  /**
   * Wrap and measure text **without drawing it**, through the very same
   * engine `text()` uses — so a pre-computed block height can never drift
   * away from what actually lands on the page.
   *
   * ```ts
   * const m = pdf.measureText(summary, { width: 180, size: 9 });
   * pdf.rect(x, y, 180, m.height + 16, { fill: "#f4f5f7" });
   * pdf.text(summary, { x, y: y + 8, width: 180, size: 9 });
   * ```
   */
  measureText(content: string, options: TextOptions = {}): TextMeasurement {
    const size = options.size ?? this.defaults.size;
    const lineHeight = options.lineHeight ?? this.defaults.lineHeight;
    const letterSpacing = options.letterSpacing ?? this.defaults.letterSpacing;
    assertFinite(size, "text size");
    assertFinite(lineHeight, "text lineHeight");
    const font = this.resolveFontStyle(
      options.font ?? this.defaults.font,
      options.bold ?? this.defaults.bold,
      options.italic ?? this.defaults.italic,
    );
    const width = this.textWidthFor(options);
    const lines = wrapLines(content, font, size, width, letterSpacing).map((l) => l.text);
    const step = size * lineHeight;
    let widest = 0;
    for (const line of lines) {
      widest = Math.max(widest, measureLine(line, font, size, letterSpacing));
    }
    return {
      lines,
      width: widest,
      height: lines.length * step,
      lineHeight: step,
      baseline: (font.ascent * size) / 1000,
    };
  }

  /**
   * Measure arbitrary flow content by laying it out on a throwaway page —
   * the double-pass every "I need the height before I can draw the frame"
   * problem asks for.
   *
   * ```ts
   * const { height } = pdf.measureBlock((d) => {
   *   d.text("Profil", { bold: true, spacingAfter: 4 });
   *   d.text(profile);
   * }, { width: 260 });
   * ```
   *
   * The callback runs against a discarded page: nothing is drawn, and
   * anchors, bookmarks, links and images it creates are rolled back.
   * Automatic page breaks are off while measuring, so the reported height
   * is the block's unbroken height.
   */
  measureBlock(content: (doc: this) => void, options: { width?: number } = {}): BlockMeasurement {
    if (options.width !== undefined) assertFinite(options.width, "measureBlock width");
    const model = this.page;
    const scratch = new Page({ ...model.size }, { ...model.margins });
    const saved = {
      activePage: this.activePage,
      cursorY: this.cursorY,
      frame: this.frame,
      frameTop: this.frameTop,
      lastBlock: this.lastBlock,
    };
    // Everything a dry run could leak into the real document.
    const imageKeys = new Set(this.images.keys());
    const outlineCount = this.outlines.length;
    const anchorKeys = new Set(this.anchors.keys());
    const sigNames = new Set(this.sigFieldNames);

    const startY = model.margins.top;
    const width = options.width ?? this.flowWidth;
    this.activePage = scratch;
    this.frame = { x: this.flowX, width };
    this.cursorY = startY;
    this.frameTop = startY;
    this.suppressBreaks++;
    this.measuring++;
    let endY = startY;
    try {
      content(this);
      endY = this.cursorY;
    } finally {
      this.measuring--;
      this.suppressBreaks--;
      this.activePage = saved.activePage;
      this.cursorY = saved.cursorY;
      this.frame = saved.frame;
      this.frameTop = saved.frameTop;
      this.lastBlock = saved.lastBlock;
      for (const key of this.images.keys()) if (!imageKeys.has(key)) this.images.delete(key);
      this.outlines.length = outlineCount;
      for (const key of [...this.anchors.keys()]) if (!anchorKeys.has(key)) this.anchors.delete(key);
      for (const name of [...this.sigFieldNames]) if (!sigNames.has(name)) this.sigFieldNames.delete(name);
    }
    return { height: endY - startY, width };
  }

  /**
   * Vertical metrics of a font at a concrete size, in points — so callers
   * can align to the baseline or cap height instead of reverse-engineering
   * how fast-pdf places text.
   *
   * ```ts
   * const m = pdf.fontMetrics({ size: 9 });
   * pdf.circle(x, y + m.baseline - m.capHeight / 2, 2, { fill: accent }); // optically centred
   * ```
   */
  fontMetrics(
    options: Pick<TextOptions, "font" | "size" | "bold" | "italic" | "lineHeight"> = {},
  ): FontMetricsInfo {
    const size = options.size ?? this.defaults.size;
    assertFinite(size, "text size");
    const lineHeight = options.lineHeight ?? this.defaults.lineHeight;
    const font = this.resolveFontStyle(
      options.font ?? this.defaults.font,
      options.bold ?? this.defaults.bold,
      options.italic ?? this.defaults.italic,
    );
    const per = size / 1000;
    return {
      size,
      baseline: font.ascent * per,
      ascent: font.ascent * per,
      descent: font.descent * per,
      capHeight: font.capHeight * per,
      lineGap: font.lineGap * per,
      lineHeight: size * lineHeight,
    };
  }

  // ── Regions ──────────────────────────────────────────────────────────

  /**
   * Lay out flow content inside an arbitrary rectangle, with its own cursor
   * — including inside `onPage()` decorators, where there is no document
   * flow at all. Reports honestly whether the content fit.
   *
   * ```ts
   * pdf.onPage((doc, info) => {
   *   doc.rect(0, 0, 160, info.size.height, { fill: "#101828" });
   *   const { overflow } = doc.region({ x: 24, y: 56, width: 112, height: 700 }, (d) => {
   *     d.text("KONTAKT", { color: "#fff", size: 8, letterSpacing: 1.5, spacingAfter: 6 });
   *     d.text(contact, { color: "#cbd5e1", size: 9 });
   *   });
   *   if (overflow) console.warn("sidebar content truncated");
   * });
   * ```
   *
   * The region does not move the surrounding flow cursor; page breaks are
   * off inside it (a region is a fixed box by definition).
   */
  region(rect: RegionOptions, content: (doc: this) => void): RegionResult {
    assertFinite(rect.x, "region x");
    assertFinite(rect.y, "region y");
    assertFinite(rect.width, "region width");
    assertFinite(rect.height, "region height");
    const saved = {
      cursorY: this.cursorY,
      frame: this.frame,
      frameTop: this.frameTop,
      lastBlock: this.lastBlock,
    };
    const clip = rect.clip ?? false;
    const page = this.page;
    if (clip) {
      page.content.save();
      buildRectPath(page.content, rect.x, page.ty(rect.y), rect.width, rect.height, clipRadius(rect));
      page.content.clip();
    }
    this.frame = { x: rect.x, width: rect.width };
    this.cursorY = rect.y;
    this.frameTop = rect.y;
    this.suppressBreaks++;
    let usedHeight = 0;
    try {
      content(this);
      usedHeight = this.cursorY - rect.y;
    } finally {
      this.suppressBreaks--;
      if (clip) page.content.restore();
      this.cursorY = saved.cursorY;
      this.frame = saved.frame;
      this.frameTop = saved.frameTop;
      this.lastBlock = saved.lastBlock;
    }
    this.lastBlock = usedHeight;
    return {
      usedHeight,
      remaining: rect.height - usedHeight,
      overflow: usedHeight > rect.height + 0.01,
    };
  }

  /**
   * Clip everything the callback draws to a rectangle — rounded, or a full
   * circle with `radius: height / 2`. The renderer already clipped
   * internally for `container()` and `image({ fit: "cover" })`; this makes
   * it available directly, so a shape no longer has to be constructed to
   * fit its frame by hand.
   */
  clip(rect: ClipRect, content: (doc: this) => void): this {
    assertFinite(rect.x, "clip x");
    assertFinite(rect.y, "clip y");
    assertFinite(rect.width, "clip width");
    assertFinite(rect.height, "clip height");
    const page = this.page;
    page.content.save();
    buildRectPath(page.content, rect.x, page.ty(rect.y), rect.width, rect.height, clipRadius(rect));
    page.content.clip();
    try {
      content(this);
    } finally {
      page.content.restore();
    }
    return this;
  }

  /** Run `fn` with a constant alpha applied to fills and strokes. */
  private withAlpha<T>(opacity: number | undefined, fn: () => T): T {
    if (opacity === undefined || opacity >= 1) return fn();
    const content = this.page.content;
    content.save().setGState(this.page.gsRes(clampAlpha(opacity)));
    try {
      return fn();
    } finally {
      content.restore();
    }
  }

  /** Apply a collapsing `spacingBefore` in flow mode. */
  private applySpacingBefore(spacing: number | undefined): void {
    if (spacing === undefined || spacing === 0) return;
    assertFinite(spacing, "spacingBefore");
    if (this.cursorY > this.frameTop + 0.01) this.cursorY += spacing;
  }

  private breakPageIfNeeded(blockHeight: number): void {
    if (this.suppressBreaks > 0) return;
    if (this.cursorY + blockHeight > this.page.contentBottom && this.cursorY > this.page.margins.top) {
      this.addPage();
    }
  }

  /** Left edge of the active flow area (frame or page margin). */
  private get flowX(): number {
    return this.frame?.x ?? this.page.margins.left;
  }

  /** Width of the active flow area (frame or page content width). */
  private get flowWidth(): number {
    return this.frame?.width ?? this.page.contentWidth;
  }

  // ── Layout ───────────────────────────────────────────────────────────

  /**
   * A block with its own width, padding, margin, background and border.
   * The callback draws flow content (text/table/image/nested containers)
   * inside the box; the box height follows the content. Containers do not
   * break across pages — keep them shorter than one page.
   */
  container(options: ContainerOptions, content: (doc: this) => void): this {
    const margin = normalizeMargins(options.margin ?? 0, 0);
    const padding = normalizeMargins(options.padding ?? 0, 0);
    const available = this.flowWidth - margin.left - margin.right;
    const outerWidth = options.width !== undefined ? resolveSize(options.width, available) : available;
    const innerWidth = outerWidth - padding.left - padding.right;
    if (innerWidth <= 0) {
      throw new FastPDFError(`Container inner width is ${innerWidth}pt — width too small for its padding`, "INVALID_ARGUMENT");
    }
    const free = available - outerWidth;
    const shift = options.align === "center" ? free / 2 : options.align === "right" ? free : 0;
    const outerX = this.flowX + margin.left + shift;

    this.breakPageIfNeeded(
      padding.top + padding.bottom + (options.minHeight ?? this.defaults.size * this.defaults.lineHeight),
    );

    const startY = this.cursorY + margin.top;
    const page = this.page;
    const mark = page.content.mark();
    const prevFrame = this.frame;
    const prevFrameTop = this.frameTop;
    this.frame = { x: outerX + padding.left, width: innerWidth };
    this.cursorY = startY + padding.top;
    this.frameTop = this.cursorY;
    this.suppressBreaks++;
    try {
      content(this);
    } finally {
      this.suppressBreaks--;
      this.frame = prevFrame;
      this.frameTop = prevFrameTop;
    }

    let height = this.cursorY + padding.bottom - startY;
    if (options.minHeight !== undefined) height = Math.max(height, options.minHeight);

    if (options.background !== undefined || options.border !== undefined) {
      // Painted onto a detached stream, then inserted *before* the content:
      // the height was unknown when the content started drawing.
      const bg = new ContentStream();
      const alpha = options.opacity !== undefined && options.opacity < 1;
      if (alpha) bg.save().setGState(page.gsRes(clampAlpha(options.opacity!)));
      const radius = Math.min(options.radius ?? 0, outerWidth / 2, height / 2);
      buildRectPath(bg, outerX, page.ty(startY), outerWidth, height, radius);
      const fill = options.background !== undefined ? parseColor(options.background) : undefined;
      const stroke = options.border !== undefined ? parseColor(options.border.color ?? "#000000") : undefined;
      if (fill) bg.fillColor(fill);
      if (stroke) bg.strokeColor(stroke).lineWidth(options.border?.width ?? 1);
      if (fill && stroke) bg.fillAndStroke();
      else if (fill) bg.fill();
      else if (stroke) bg.stroke();
      if (alpha) bg.restore();
      page.content.insertAt(mark, bg);
    }

    this.cursorY = startY + height + margin.bottom;
    this.lastBlock = height + margin.top + margin.bottom;
    return this;
  }

  /**
   * Side-by-side columns. Each builder draws flow content into its column;
   * afterwards the cursor sits below the tallest column. Columns do not
   * break across pages.
   */
  columns(builders: ((doc: this) => void)[], options: ColumnsOptions = {}): this {
    if (builders.length === 0) return this;
    const gap = options.gap ?? 12;
    const total = this.flowWidth - gap * (builders.length - 1);
    let widths: number[];
    if (options.widths) {
      if (options.widths.length !== builders.length) {
        throw new FastPDFError(
          `columns() got ${builders.length} builders but ${options.widths.length} widths`,
          "INVALID_ARGUMENT",
        );
      }
      widths = options.widths.map((w) => resolveSize(w, total));
      const sum = widths.reduce((a, b) => a + b, 0);
      if (sum > total) widths = widths.map((w) => (w * total) / sum);
    } else {
      widths = new Array<number>(builders.length).fill(total / builders.length);
    }

    this.breakPageIfNeeded(this.defaults.size * this.defaults.lineHeight);
    const startY = this.cursorY;
    const prevFrame = this.frame;
    const prevFrameTop = this.frameTop;
    let x = this.flowX;
    let endY = startY;
    this.suppressBreaks++;
    try {
      for (let i = 0; i < builders.length; i++) {
        this.frame = { x, width: widths[i]! };
        this.cursorY = startY;
        this.frameTop = startY;
        builders[i]!(this);
        endY = Math.max(endY, this.cursorY);
        x += widths[i]! + gap;
      }
    } finally {
      this.suppressBreaks--;
      this.frame = prevFrame;
      this.frameTop = prevFrameTop;
    }
    this.cursorY = endY;
    this.lastBlock = endY - startY;
    return this;
  }

  /**
   * Lay out cells in a grid with `columns` per row. Rows are placed one
   * after another (page breaks may occur between rows, not inside them).
   */
  grid(cells: ((doc: this) => void)[], options: GridOptions): this {
    const cols = options.columns;
    if (!Number.isInteger(cols) || cols < 1) {
      throw new FastPDFError(`grid() needs a positive integer "columns" (got ${cols})`, "INVALID_ARGUMENT");
    }
    const rowGap = options.rowGap ?? options.gap ?? 12;
    for (let i = 0; i < cells.length; i += cols) {
      const row = cells.slice(i, i + cols);
      while (row.length < cols) row.push(() => {});
      this.columns(row, { gap: options.gap });
      if (i + cols < cells.length) this.cursorY += rowGap;
    }
    return this;
  }

  /**
   * Newspaper-style flow: a sequence of items is poured into N columns,
   * continuing into the next column when one is full and onto the next page
   * when the last column is full — the piece `columns()` (side-by-side,
   * single page) and `grid()` (row-wise) cannot do.
   *
   * ```ts
   * pdf.flowColumns(categories.map((c) => ({
   *   render: (d) => { d.text(c.name, { bold: true, spacingAfter: 3 }); d.text(c.skills.join(" · ")); },
   *   spacingBefore: 10,
   *   keepWithNext: true,
   * })), { columns: 2, gap: 24, balance: true });
   * ```
   *
   * Each item is measured at column width first (via `measureBlock()`), so
   * items are never split; an item taller than a whole column is reported
   * in `dropped` rather than silently overflowing. With `balance: true` the
   * items on the final page are spread evenly instead of packing the left
   * column to the bottom.
   */
  flowColumns(items: FlowItem[], options: FlowColumnsOptions = {}): FlowColumnsResult {
    const count = options.columns ?? options.widths?.length ?? 2;
    if (!Number.isInteger(count) || count < 1) {
      throw new FastPDFError(`flowColumns() needs a positive integer "columns" (got ${count})`, "INVALID_ARGUMENT");
    }
    if (this.suppressBreaks > 0) {
      throw new FastPDFError(
        "flowColumns() spans pages and cannot run inside container()/columns()/grid()/region()",
        "INVALID_ARGUMENT",
      );
    }
    if (items.length === 0) return { pages: 1, dropped: 0 };

    const gap = options.gap ?? 18;
    const total = this.flowWidth - gap * (count - 1);
    let widths: number[];
    if (options.widths) {
      if (options.widths.length !== count) {
        throw new FastPDFError(
          `flowColumns() got ${count} columns but ${options.widths.length} widths`,
          "INVALID_ARGUMENT",
        );
      }
      widths = options.widths.map((w) => resolveSize(w, total));
      const sum = widths.reduce((a, b) => a + b, 0);
      if (sum > total) widths = widths.map((w) => (w * total) / sum);
    } else {
      widths = new Array<number>(count).fill(total / count);
    }
    const narrowest = Math.min(...widths);

    // Measure once, at the narrowest column width so an item fits wherever
    // it lands. Measuring is the whole point: nothing is drawn twice blind.
    const measured = items.map((item) => {
      const spec = typeof item === "function" ? { render: item } : item;
      const { height } = this.measureBlock((d) => spec.render(d as PDFDocument), { width: narrowest });
      return {
        render: spec.render,
        height,
        spacingBefore: spec.spacingBefore ?? 0,
        spacingAfter: spec.spacingAfter ?? 0,
        keepWithNext: spec.keepWithNext ?? false,
      };
    });

    const bottom = options.bottom ?? this.page.contentBottom;
    const startX = this.flowX;
    const columnTop = this.cursorY;
    let limit = bottom;
    let pages = 1;
    let dropped = 0;

    /** Greedily pack items into `count` columns of at most `limit` height. */
    const pack = (from: number, top: number, height: number): { columns: number[][]; next: number } => {
      const columns: number[][] = [];
      let i = from;
      for (let c = 0; c < count; c++) {
        const bucket: number[] = [];
        let y = top;
        while (i < measured.length) {
          const item = measured[i]!;
          const lead = bucket.length === 0 ? 0 : item.spacingBefore;
          const needed = lead + item.height + item.spacingAfter;
          // Keep a flagged item with its successor: both must fit, or neither.
          const partner = item.keepWithNext ? measured[i + 1] : undefined;
          const withPartner = partner ? needed + partner.spacingBefore + partner.height : needed;
          if (bucket.length > 0 && y - top + withPartner > height + 0.01) break;
          if (bucket.length === 0 && item.height > height + 0.01) {
            dropped++; // taller than a whole column: it can never be placed
            i++;
            continue;
          }
          bucket.push(i);
          y += needed;
          i++;
        }
        columns.push(bucket);
        if (i >= measured.length) break;
      }
      return { columns, next: i };
    };

    const draw = (columns: number[][], top: number): void => {
      let x = startX;
      columns.forEach((bucket, c) => {
        let y = top;
        bucket.forEach((index, position) => {
          const item = measured[index]!;
          if (position > 0) y += item.spacingBefore;
          this.region({ x, y, width: widths[c]!, height: item.height }, (d) =>
            item.render(d as PDFDocument),
          );
          y += item.height + item.spacingAfter;
        });
        x += widths[c]! + gap;
      });
    };

    let index = 0;
    let top = columnTop;
    for (;;) {
      let height = limit - top;
      let { columns, next } = pack(index, top, height);
      const lastPage = next >= measured.length;

      if (lastPage && options.balance) {
        // Shrink the column height until the remainder no longer fits in
        // fewer columns — the classic binary search for even columns.
        const rest = measured.slice(index);
        const contentHeight = rest.reduce((a, it, i) => a + it.height + it.spacingAfter + (i > 0 ? it.spacingBefore : 0), 0);
        let lo = Math.max(...rest.map((it) => it.height));
        let hi = height;
        let best = height;
        for (let step = 0; step < 24 && lo <= hi; step++) {
          const mid = (lo + hi) / 2;
          const trial = pack(index, top, mid);
          if (trial.next >= measured.length) {
            best = mid;
            hi = mid - 0.5;
          } else {
            lo = mid + 0.5;
          }
        }
        // Never balance below the average — that would only add whitespace.
        height = Math.max(best, contentHeight / count);
        ({ columns, next } = pack(index, top, height));
      }

      draw(columns, top);
      index = next;
      if (index >= measured.length) {
        const used = Math.max(
          ...columns.map((bucket) =>
            bucket.reduce((y, i, position) => {
              const item = measured[i]!;
              return y + (position > 0 ? item.spacingBefore : 0) + item.height + item.spacingAfter;
            }, 0),
          ),
          0,
        );
        this.cursorY = top + used;
        this.lastBlock = used;
        break;
      }
      if (columns.every((bucket) => bucket.length === 0)) break; // nothing placeable
      this.addPage();
      pages++;
      top = this.cursorY;
      limit = options.bottom ?? this.page.contentBottom;
    }
    return { pages, dropped };
  }

  // ── Fonts ────────────────────────────────────────────────────────────

  /**
   * Register a TrueType font (.ttf, or .otf with TrueType outlines) under a
   * family name. Register bold/italic variants separately; missing variants
   * fall back to the regular cut. Only the glyphs actually used are embedded
   * (subsetting), with full Unicode coverage of the font via Identity-H.
   */
  registerFont(
    data: Uint8Array | ArrayBuffer,
    options: { family: string; bold?: boolean; italic?: boolean },
  ): this {
    const family = options.family.toLowerCase();
    if (isStandardFamily(family)) {
      throw new FastPDFError(`"${family}" is a built-in family name — pick a different one`, "INVALID_ARGUMENT");
    }
    const slot = styleIndex(options.bold ?? false, options.italic ?? false);
    let variants = this.customFonts.get(family);
    if (!variants) {
      variants = [undefined, undefined, undefined, undefined];
      this.customFonts.set(family, variants);
    }
    try {
      variants[slot] = new EmbeddedFont(`emb:${family}:${slot}`, toBytes(data));
    } catch (e) {
      if (e instanceof FastPDFError) throw e;
      // Out-of-bounds reads on corrupt files surface as RangeError etc. —
      // normalize them so callers get a stable error code.
      const msg = e instanceof Error ? e.message : String(e);
      throw new FastPDFError(`Invalid font file: ${msg}`, "INVALID_FONT_FILE");
    }
    return this;
  }

  private resolveFontStyle(family: string, bold: boolean, italic: boolean): Font {
    const key = family.toLowerCase();
    const variants = this.customFonts.get(key);
    if (variants) {
      const font = variants[styleIndex(bold, italic)] ?? variants[0];
      if (!font) {
        throw new FastPDFError(`Font family "${family}" has no regular variant registered`, "UNKNOWN_FONT");
      }
      return font;
    }
    if (isStandardFamily(key)) return resolveFont(key, bold, italic);
    throw new FastPDFError(
      `Unknown font family: "${family}" — use helvetica/times/courier or registerFont() first`,
      "UNKNOWN_FONT",
    );
  }

  // ── Text ─────────────────────────────────────────────────────────────

  text(content: string, options: TextOptions = {}): this {
    const style: TextStyle = {
      font: options.font ?? this.defaults.font,
      size: options.size ?? this.defaults.size,
      bold: options.bold ?? this.defaults.bold,
      italic: options.italic ?? this.defaults.italic,
      color: options.color !== undefined ? parseColor(options.color) : this.defaults.color,
      lineHeight: options.lineHeight ?? this.defaults.lineHeight,
      align: options.align ?? this.defaults.align,
      underline: options.underline ?? this.defaults.underline,
      strikethrough: options.strikethrough ?? this.defaults.strikethrough,
      letterSpacing: options.letterSpacing ?? this.defaults.letterSpacing,
      opacity: options.opacity,
    };
    assertFinite(style.size, "text size");
    assertFinite(style.lineHeight, "text lineHeight");
    assertFinite(style.letterSpacing, "text letterSpacing");
    if (options.x !== undefined) assertFinite(options.x, "text x");
    if (options.y !== undefined) assertFinite(options.y, "text y");
    if (options.width !== undefined) assertFinite(options.width, "text width");
    if (options.spacingAfter !== undefined) assertFinite(options.spacingAfter, "text spacingAfter");
    if (options.rotate !== undefined) assertFinite(options.rotate, "text rotate");

    const font = this.resolveFontStyle(style.font, style.bold, style.italic);
    style.skew = this.syntheticItalic(style.font, style.bold, style.italic);
    const lineStep = style.size * style.lineHeight;
    const rotate = options.rotate ?? 0;

    if (options.link !== undefined) checkLinkTarget(options.link);

    if (options.y !== undefined) {
      // Absolute positioning: draw where told, leave the flow cursor alone.
      const x = options.x ?? this.page.margins.left;
      const width = options.width ?? this.page.size.width - this.page.margins.right - x;
      const lines = wrapLines(content, font, style.size, width, style.letterSpacing);
      this.paintRotated(rotate, x, options.y, () => {
        let y = options.y!;
        for (const line of lines) {
          const drawn = this.drawTextLine(line, font, style, x, y, width);
          // A rotated block's link rectangle would no longer cover the glyphs.
          if (drawn && options.link !== undefined && rotate === 0) {
            this.page.links.push({ x: drawn.x, y, width: drawn.width, height: lineStep, target: options.link });
          }
          y += lineStep;
        }
      });
      this.lastBlock = lines.length * lineStep;
      return this;
    }

    this.applySpacingBefore(options.spacingBefore);
    const x = this.flowX + (options.x ?? 0);
    const width = options.width ?? this.flowX + this.flowWidth - x;
    const lines = wrapLines(content, font, style.size, width, style.letterSpacing);
    const blockHeight = lines.length * lineStep;

    if (rotate !== 0) {
      // Rotated blocks are atomic: they cannot be split across pages.
      this.breakPageIfNeeded(blockHeight);
      const top = this.cursorY;
      this.paintRotated(rotate, x, top, () => {
        let y = top;
        for (const line of lines) {
          this.drawTextLine(line, font, style, x, y, width);
          y += lineStep;
        }
      });
      this.cursorY = top + blockHeight + (options.spacingAfter ?? 0);
      this.lastBlock = blockHeight;
      return this;
    }

    if (options.keepWithNext !== undefined && options.keepWithNext !== false) {
      const extra = typeof options.keepWithNext === "number" ? options.keepWithNext : 2;
      this.breakPageIfNeeded(blockHeight + extra * lineStep);
    }

    const startY = this.cursorY;
    let pageBreaks = 0;
    for (const line of lines) {
      const before = this.cursorY;
      this.breakPageIfNeeded(lineStep);
      if (this.cursorY < before) pageBreaks++;
      const drawn = this.drawTextLine(line, font, style, x, this.cursorY, width);
      if (drawn && options.link !== undefined) {
        this.page.links.push({ x: drawn.x, y: this.cursorY, width: drawn.width, height: lineStep, target: options.link });
      }
      this.cursorY += lineStep;
    }
    this.lastBlock = pageBreaks > 0 ? blockHeight : this.cursorY - startY;
    this.cursorY += options.spacingAfter ?? 0;
    return this;
  }

  /**
   * Measure text width in points with the current (or given) style.
   * For a wrapped block use `measureText()`, which also reports the height.
   */
  widthOfText(
    content: string,
    options: Pick<TextOptions, "font" | "size" | "bold" | "italic" | "letterSpacing"> = {},
  ): number {
    const font = this.resolveFontStyle(
      options.font ?? this.defaults.font,
      options.bold ?? this.defaults.bold,
      options.italic ?? this.defaults.italic,
    );
    return measureLine(
      content,
      font,
      options.size ?? this.defaults.size,
      options.letterSpacing ?? this.defaults.letterSpacing,
    );
  }

  /** Width a `text()` call would wrap against, given the same options. */
  private textWidthFor(options: TextOptions): number {
    if (options.width !== undefined) return options.width;
    if (options.y !== undefined) {
      const x = options.x ?? this.page.margins.left;
      return this.page.size.width - this.page.margins.right - x;
    }
    return this.flowWidth - (options.x ?? 0);
  }

  /** Rotate the drawing in `paint` clockwise around a top-left anchor. */
  private paintRotated(degrees: number, x: number, yTop: number, paint: () => void): void {
    if (degrees === 0) {
      paint();
      return;
    }
    const rad = (-degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const py = this.page.ty(yTop);
    const content = this.page.content;
    content.save().transform(cos, sin, -sin, cos, x - cos * x + sin * py, py - sin * x - cos * py);
    try {
      paint();
    } finally {
      content.restore();
    }
  }

  /**
   * True when italic was asked for but the family has no italic cut, so the
   * glyphs must be slanted synthetically. Without this, italic text in a
   * family registered with only a regular file renders silently upright.
   */
  private syntheticItalic(family: string, bold: boolean, italic: boolean): boolean {
    if (!italic) return false;
    const variants = this.customFonts.get(family.toLowerCase());
    return variants !== undefined && variants[styleIndex(bold, true)] === undefined;
  }

  private drawTextLine(
    line: WrappedLine,
    font: Font,
    style: TextStyle,
    x: number,
    yTop: number,
    boxWidth: number,
  ): { x: number; width: number } | null {
    if (line.text === "") return null;
    const size = style.size;
    const spacing = style.letterSpacing;
    const naturalWidth = measureLine(line.text, font, size, spacing);
    const justify = style.align === "justify" && !line.paragraphEnd && line.text.includes(" ");
    const offset = justify ? 0 : alignOffset(naturalWidth, boxWidth, style.align);
    const baselineTop = yTop + (font.ascent * size) / 1000;
    const baseline = this.page.ty(baselineTop);
    const fontRes = this.page.fontRes(font);
    // Missing italic cuts are slanted by the standard 12° oblique shear.
    const skew = style.skew ? Math.tan((12 * Math.PI) / 180) : 0;

    let drawnWidth = naturalWidth;
    this.withAlpha(style.opacity, () => {
      const content = this.page.content.fillColor(style.color);
      if (justify) {
        // Distribute the leftover width over the gaps via TJ adjustments
        // (works for WinAnsi and Identity-H alike, unlike the Tw operator).
        const words = line.text.split(" ");
        const gaps = words.length - 1;
        const extra = (boxWidth - naturalWidth) / gaps;
        const adj = -(extra * 1000) / size;
        const parts: (string | number)[] = [];
        words.forEach((word, i) => {
          parts.push(font.encode(i < gaps ? word + " " : word));
          if (i < gaps) parts.push(adj);
        });
        content.textTJ(parts, x, baseline, fontRes, size, spacing, skew);
        drawnWidth = boxWidth;
      } else {
        content.text(font.encode(line.text), x + offset, baseline, fontRes, size, spacing, skew);
      }

      if (style.underline || style.strikethrough) {
        const thickness = Math.max(0.5, size * 0.05);
        content.strokeColor(style.color).lineWidth(thickness);
        if (style.underline) {
          const uy = this.page.ty(baselineTop + size * 0.1);
          content.moveTo(x + offset, uy).lineTo(x + offset + drawnWidth, uy).stroke();
        }
        if (style.strikethrough) {
          const sy = this.page.ty(baselineTop - size * 0.25);
          content.moveTo(x + offset, sy).lineTo(x + offset + drawnWidth, sy).stroke();
        }
      }
    });
    return { x: x + offset, width: drawnWidth };
  }

  // ── Tables ───────────────────────────────────────────────────────────

  table(rows: CellValue[][], options: TableOptions = {}): this {
    if (rows.length === 0) return this;
    const columns = countColumns(rows);
    const fontSize = options.fontSize ?? this.defaults.size;
    const padding = options.padding ?? 6;
    const lineHeight = options.lineHeight ?? 1.2;
    const hasHeader = options.header ?? true;
    const hasFooter = options.footer ?? false;
    const family = this.defaults.font;
    const widths = columnWidths(this.flowWidth, columns, options.widths);
    const resolve = (bold: boolean, italic: boolean): Font => this.resolveFontStyle(family, bold, italic);

    const borderWidth = options.borderWidth ?? 0.5;
    const borderColor = parseColor(options.borderColor ?? "#c8ccd4");
    const headerFill = parseColor(options.headerFill ?? "#eef0f4");
    const headerColor = options.headerColor !== undefined ? parseColor(options.headerColor) : this.defaults.color;
    const footerFill = options.footerFill !== undefined ? parseColor(options.footerFill) : headerFill;
    const zebraFill = options.zebraFill !== undefined ? parseColor(options.zebraFill) : undefined;

    const measured = measureTable(rows, widths, {
      hasHeader,
      hasFooter,
      fontSize,
      padding,
      lineHeight,
      resolveFont: resolve,
      aligns: options.aligns,
      valign: options.valign,
      // Custom cells are measured with the same double pass as measureBlock().
      // The probe box starts at the dry run's own cursor, so a callback that
      // reports its height by advancing `doc.y` measures correctly.
      measureRender: (cell, innerWidth) =>
        Math.max(
          0,
          this.measureBlock(
            (d) => cell.render!(d, { x: d.x, y: d.y, width: innerWidth, height: 0 }),
            { width: innerWidth },
          ).height,
        ),
    });
    const header = hasHeader ? measured[0]! : null;
    const tableX = this.flowX;

    const drawRow = (row: MeasuredRow, zebra: boolean): void => {
      const yTop = this.cursorY;
      const rowFill = row.isHeader ? headerFill : row.isFooter ? footerFill : zebra ? zebraFill : undefined;
      for (const mc of row.cells) {
        const x = tableX + mc.x;
        const fill = mc.cell.fill !== undefined ? parseColor(mc.cell.fill) : rowFill;
        if (fill) {
          this.page.content.fillColor(fill).rect(x, this.page.ty(yTop + mc.height), mc.width, mc.height).fill();
        }
        if (borderWidth > 0) {
          this.page.content
            .strokeColor(borderColor)
            .lineWidth(borderWidth)
            .rect(x, this.page.ty(yTop + mc.height), mc.width, mc.height)
            .stroke();
        }
        const font = resolve(mc.cell.bold ?? (row.isHeader || row.isFooter), mc.cell.italic ?? false);
        const color = mc.cell.color !== undefined
          ? parseColor(mc.cell.color)
          : row.isHeader ? headerColor : this.defaults.color;
        const innerWidth = mc.width - 2 * padding;
        // Vertical placement inside the (possibly taller) cell box.
        const slack = Math.max(0, mc.height - 2 * padding - mc.contentHeight);
        const vShift = mc.valign === "middle" ? slack / 2 : mc.valign === "bottom" ? slack : 0;
        if (mc.cell.render) {
          const box = {
            x: x + padding,
            y: yTop + padding + vShift,
            width: innerWidth,
            height: mc.contentHeight,
          };
          // Run through region(): the callback gets its own cursor and frame,
          // so moving `doc.y` inside a cell cannot shift the rows below it.
          this.region(box, () => mc.cell.render!(this, box));
          continue;
        }
        let lineY = yTop + padding + vShift;
        for (const line of mc.lines) {
          if (line !== "") {
            const offset = alignOffset(font.widthOf(line, fontSize), innerWidth, mc.align);
            const baseline = this.page.ty(lineY + (font.ascent * fontSize) / 1000);
            this.page.content
              .fillColor(color)
              .text(font.encode(line), x + padding + offset, baseline, this.page.fontRes(font), fontSize);
          }
          lineY += fontSize * lineHeight;
        }
      }
      this.cursorY += row.height;
    };

    const ensureSpace = (blockHeight: number): void => {
      const headerHeight = header ? header.height : 0;
      if (
        this.suppressBreaks === 0 &&
        this.cursorY + blockHeight > this.page.contentBottom &&
        this.cursorY > this.page.margins.top + headerHeight
      ) {
        this.addPage();
        if (header) drawRow(header, false);
      }
    };

    // Group rows chained by rowSpans so a span never straddles a page break.
    const body = hasHeader ? measured.slice(1) : measured;
    const tableTop = this.cursorY;
    if (header) {
      ensureSpace(header.height + (body[0]?.height ?? 0));
      drawRow(header, false);
    }
    let zebraIndex = 0;
    for (let i = 0; i < body.length; ) {
      let end = i;
      while (end < body.length - 1 && body[end]!.keepWithNext) end++;
      const groupHeight = body.slice(i, end + 1).reduce((a, r) => a + r.height, 0);
      ensureSpace(groupHeight);
      for (let r = i; r <= end; r++) {
        drawRow(body[r]!, !body[r]!.isFooter && zebraIndex % 2 === 1);
        zebraIndex++;
      }
      i = end + 1;
    }
    this.lastBlock = this.cursorY - tableTop;
    return this;
  }

  /**
   * Render an array of records (e.g. a JSON REST response) as a table.
   * Columns default to the keys of the first record; pass `columns` to
   * pick order, headers, widths, alignment and formatting.
   *
   * ```ts
   * const orders = await fetch("/api/orders").then(r => r.json());
   * pdf.objectTable(orders, {
   *   columns: [
   *     { key: "id", header: "Nr.", align: "right", width: 50 },
   *     { key: "customer", header: "Kunde" },
   *     { key: "total", header: "Betrag", align: "right", format: (v) => `${v} €` },
   *   ],
   * });
   * ```
   */
  objectTable<T extends Record<string, unknown>>(
    records: T[],
    options: ObjectTableOptions<T> = {},
  ): this {
    if (records.length === 0) return this;
    const specs: ObjectTableColumn<T>[] = (options.columns ?? (Object.keys(records[0]!) as (keyof T & string)[]))
      .map((c) => (typeof c === "string" ? { key: c } : c));
    if (specs.length === 0) return this;

    // Mixed widths: explicit ones are kept, the rest share the leftover space.
    let widths: number[] | undefined;
    if (specs.some((s) => s.width !== undefined)) {
      const fixed = specs.reduce((a, s) => a + (s.width ?? 0), 0);
      const open = specs.filter((s) => s.width === undefined).length;
      const share = open > 0 ? Math.max(20, (this.flowWidth - fixed) / open) : 0;
      widths = specs.map((s) => s.width ?? share);
    }

    const { columns: _columns, ...tableOptions } = options;
    const rows: CellValue[][] = [
      specs.map((s) => s.header ?? s.key),
      ...records.map((record) =>
        specs.map((s) => {
          const value = record[s.key];
          if (s.format) return s.format(value, record);
          return value === null || value === undefined ? "" : String(value);
        }),
      ),
    ];
    return this.table(rows, {
      ...tableOptions,
      header: true,
      widths,
      aligns: specs.map((s) => s.align ?? "left"),
    });
  }

  // ── Images ───────────────────────────────────────────────────────────

  image(src: Uint8Array | ArrayBuffer, options: ImageOptions = {}): this {
    const entry = this.registerImage(toBytes(src));
    const natural = { width: entry.pxWidth, height: entry.pxHeight };
    // The box is sized against the visible source region (crop or full image).
    const srcRegion = options.crop ?? { x: 0, y: 0, width: natural.width, height: natural.height };
    if (srcRegion.width <= 0 || srcRegion.height <= 0) {
      throw new FastPDFError("Crop region must have positive width and height", "INVALID_ARGUMENT");
    }
    let { width, height } = options;
    if (width === undefined && height === undefined) {
      width = Math.min(srcRegion.width, this.flowWidth);
      height = (width / srcRegion.width) * srcRegion.height;
    } else if (width === undefined) {
      width = (height! / srcRegion.height) * srcRegion.width;
    } else if (height === undefined) {
      height = (width / srcRegion.width) * srcRegion.height;
    }
    const boxW = width!;
    const boxH = height!;

    // Placement of the full image inside the box (dx/dy relative to box top-left).
    let dw = boxW;
    let dh = boxH;
    let dx = 0;
    let dy = 0;
    let clip = false;
    if (options.crop) {
      const sx = boxW / srcRegion.width;
      const sy = boxH / srcRegion.height;
      dw = natural.width * sx;
      dh = natural.height * sy;
      dx = -srcRegion.x * sx;
      dy = -srcRegion.y * sy;
      clip = true;
    } else if (options.fit === "contain" || options.fit === "cover") {
      const scale =
        options.fit === "contain"
          ? Math.min(boxW / natural.width, boxH / natural.height)
          : Math.max(boxW / natural.width, boxH / natural.height);
      dw = natural.width * scale;
      dh = natural.height * scale;
      dx = (boxW - dw) / 2;
      dy = (boxH - dh) / 2;
      clip = options.fit === "cover";
    }

    // A radius (or shape: "circle") rounds the box and clips the overflow —
    // real vector clipping, so it works identically on a server and in a
    // browser, with no Canvas pre-processing.
    if (options.radius !== undefined) assertFinite(options.radius, "image radius");
    const requested =
      options.shape === "circle" ? Math.min(boxW, boxH) / 2 : options.radius ?? 0;
    const radius = Math.max(0, Math.min(requested, boxW / 2, boxH / 2));
    if (radius > 0) clip = true;

    const draw = (x: number, yTop: number): void => {
      this.withAlpha(options.opacity, () => {
        const c = this.page.content;
        const rotate = options.rotate ?? 0;
        const wrap = clip || rotate !== 0;
        if (wrap) {
          c.save();
          if (rotate !== 0) {
            // Rotate clockwise around the box center (PDF rotates CCW → negate).
            const rad = (-rotate * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const cx = x + boxW / 2;
            const cy = this.page.ty(yTop + boxH / 2);
            c.transform(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy);
          }
          if (clip) {
            buildRectPath(c, x, this.page.ty(yTop), boxW, boxH, radius);
            c.clip();
          }
        }
        c.image(this.page.imageRes(entry), x + dx, this.page.ty(yTop + dy + dh), dw, dh);
        if (wrap) c.restore();
      });
    };

    if (options.y !== undefined) {
      draw(options.x ?? this.page.margins.left, options.y);
      this.lastBlock = boxH;
      return this;
    }

    this.applySpacingBefore(options.spacingBefore);
    this.breakPageIfNeeded(boxH);
    const free = this.flowWidth - boxW;
    const shift = options.align === "center" ? free / 2 : options.align === "right" ? free : 0;
    draw(this.flowX + (options.x ?? 0) + shift, this.cursorY);
    this.cursorY += boxH + (options.spacingAfter ?? 0);
    this.lastBlock = boxH;
    return this;
  }

  /**
   * Draw an SVG (a subset: paths, rect/circle/ellipse/line/polygon/polyline,
   * groups, transforms, presentation attributes and basic `<text>`) as crisp
   * vector graphics scaled into a box. Great for logos and icons.
   *
   * Not supported: gradients, patterns, filters, clip-paths, masks and CSS
   * stylesheets — shapes using them fall back to a flat fill.
   */
  svg(source: string | Uint8Array, options: SvgOptions = {}): this {
    const text = typeof source === "string" ? source : new TextDecoder().decode(source);
    const svg = parseXml(text);
    const view = viewport(svg);
    const [vbX, vbY, vbW, vbH] = view.viewBox;
    if (vbW <= 0 || vbH <= 0) {
      throw new FastPDFError("SVG has a zero-sized viewBox/viewport", "INVALID_ARGUMENT");
    }
    const iw = view.width || vbW;
    const ih = view.height || vbH;

    if (options.width !== undefined) assertFinite(options.width, "svg width");
    if (options.height !== undefined) assertFinite(options.height, "svg height");

    let boxW = options.width ?? 0;
    let boxH = options.height ?? 0;
    if (!boxW && !boxH) {
      boxW = Math.min(iw, this.flowWidth);
      boxH = (boxW * ih) / iw;
    } else if (!boxW) {
      boxW = (boxH * iw) / ih;
    } else if (!boxH) {
      boxH = (boxW * ih) / iw;
    }

    const fit = options.fit ?? "contain";
    let sx = boxW / vbW;
    let sy = boxH / vbH;
    let ox = 0;
    let oy = 0;
    if (fit !== "fill") {
      const s = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
      sx = sy = s;
      ox = (boxW - vbW * s) / 2;
      oy = (boxH - vbH * s) / 2;
    }

    const currentColor = options.color !== undefined ? parseColor(options.color) : BLACK;

    const paint = (boxX: number, boxTop: number): void => {
      const pageH = this.page.size.height;
      const base: Mat = [
        sx, 0, 0, -sy,
        boxX + ox - vbX * sx,
        pageH - boxTop - oy + vbY * sy,
      ];
      const clip = fit === "cover";
      if (clip) this.page.content.save().rect(boxX, this.page.ty(boxTop + boxH), boxW, boxH).clip();
      const ctx: SvgContext = {
        content: this.page.content,
        gsRes: (alpha) => this.page.gsRes(alpha),
        currentColor,
        drawText: (str, px, py, size, fill, anchor) => {
          const font = this.resolveFontStyle(this.defaults.font, false, false);
          const w = font.widthOf(str, size);
          const shift = anchor === "middle" ? -w / 2 : anchor === "end" ? -w : 0;
          this.page.content.fillColor(fill).text(font.encode(str), px + shift, py, this.page.fontRes(font), size);
        },
      };
      renderSvg(svg, base, ctx);
      if (clip) this.page.content.restore();
    };
    const draw = (boxX: number, boxTop: number): void => {
      this.withAlpha(options.opacity, () => paint(boxX, boxTop));
    };

    if (options.y !== undefined) {
      draw(options.x ?? this.page.margins.left, options.y);
      this.lastBlock = boxH;
      return this;
    }
    this.applySpacingBefore(options.spacingBefore);
    this.breakPageIfNeeded(boxH);
    const free = this.flowWidth - boxW;
    const shift = options.align === "center" ? free / 2 : options.align === "right" ? free : 0;
    draw(this.flowX + (options.x ?? 0) + shift, this.cursorY);
    this.cursorY += boxH + (options.spacingAfter ?? 0);
    this.lastBlock = boxH;
    return this;
  }

  // ── Markdown ─────────────────────────────────────────────────────────

  /**
   * Render a Markdown document (a CommonMark/GFM subset) into the flow:
   * headings, paragraphs, ordered/unordered (nested) lists, blockquotes,
   * fenced code blocks, thematic breaks and pipe tables, plus inline
   * emphasis, strong, `code`, links and images.
   *
   * Images render as their alt text unless `resolveImage` is supplied, since
   * fast-pdf's core performs no I/O. Table cells render as plain text.
   */
  markdown(source: string, options: MarkdownOptions = {}): this {
    this.renderMarkdown(parseMarkdown(source), options);
    return this;
  }

  private renderMarkdown(blocks: MdBlock[], options: MarkdownOptions): void {
    const base = this.defaults.size;
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b]!;
      switch (block.type) {
        case "heading": {
          const size = base * (MD_HEADING_SCALE[block.level - 1] ?? 1);
          if (b > 0) this.cursorY += size * 0.5;
          this.mdInline(block.inline, { size, bold: true, lineHeight: 1.2 });
          this.cursorY += size * 0.35;
          break;
        }
        case "paragraph": {
          const only = block.inline.length === 1 ? block.inline[0]! : undefined;
          if (only?.image !== undefined && options.resolveImage) {
            const bytes = options.resolveImage(only.image);
            if (bytes) {
              this.image(bytes, { spacingAfter: base * 0.6 });
              break;
            }
          }
          this.mdInline(block.inline, { size: base });
          this.cursorY += base * 0.6;
          break;
        }
        case "hr": {
          this.cursorY += base * 0.3;
          this.breakPageIfNeeded(base);
          this.page.content
            .strokeColor(MD_RULE_COLOR)
            .lineWidth(0.75)
            .moveTo(this.flowX, this.page.ty(this.cursorY))
            .lineTo(this.flowX + this.flowWidth, this.page.ty(this.cursorY))
            .stroke();
          this.cursorY += base * 0.8;
          break;
        }
        case "code":
          this.mdCodeBlock(block.text, base);
          break;
        case "blockquote":
          this.mdBlockquote(block.blocks, options, base);
          break;
        case "list":
          this.mdList(block, options, base);
          break;
        case "table": {
          const flat = (runs: MdRun[]): string => runs.map((r) => r.text).join("");
          const rows: CellValue[][] = [block.headers.map(flat), ...block.rows.map((r) => r.map(flat))];
          this.table(rows, { header: true, aligns: block.aligns });
          this.cursorY += base * 0.4;
          break;
        }
      }
    }
  }

  private mdCodeBlock(text: string, base: number): void {
    const font = this.resolveFontStyle("courier", false, false);
    const size = base * 0.9;
    const step = size * 1.35;
    const pad = 8;
    const lines = text.split("\n");
    const height = lines.length * step + pad * 2;
    this.breakPageIfNeeded(Math.min(height, this.page.contentBottom - this.page.margins.top));
    const top = this.cursorY;
    this.page.content.fillColor(MD_CODE_BG).rect(this.flowX, this.page.ty(top + height), this.flowWidth, height).fill();
    let y = top + pad;
    for (const line of lines) {
      const baseline = this.page.ty(y + (font.ascent * size) / 1000);
      this.page.content.fillColor(MD_CODE_COLOR).text(font.encode(line), this.flowX + pad, baseline, this.page.fontRes(font), size);
      y += step;
    }
    this.cursorY = top + height + base * 0.5;
  }

  private mdBlockquote(blocks: MdBlock[], options: MarkdownOptions, base: number): void {
    const indent = base;
    const outerX = this.flowX;
    const startY = this.cursorY;
    const prevFrame = this.frame;
    const prevColor = this.defaults.color;
    this.frame = { x: outerX + indent, width: this.flowWidth - indent };
    this.defaults.color = MD_QUOTE_TEXT;
    try {
      this.renderMarkdown(blocks, options);
    } finally {
      this.frame = prevFrame;
      this.defaults.color = prevColor;
    }
    // A vertical bar spanning the quote (single-page quotes; long quotes clip).
    if (this.cursorY > startY) {
      this.page.content
        .fillColor(MD_QUOTE_BAR)
        .rect(outerX + indent * 0.25, this.page.ty(this.cursorY), 3, this.cursorY - startY)
        .fill();
    }
    this.cursorY += base * 0.3;
  }

  private mdList(block: Extract<MdBlock, { type: "list" }>, options: MarkdownOptions, base: number): void {
    const font = this.resolveFontStyle(this.defaults.font, false, false);
    const indent = base * 1.6;
    const prevFrame = this.frame;
    const outerX = this.flowX;
    let n = block.start;
    for (const item of block.items) {
      this.breakPageIfNeeded(base * this.defaults.lineHeight);
      const marker = block.ordered ? `${n}.` : "•";
      const baseline = this.page.ty(this.cursorY + (font.ascent * base) / 1000);
      this.page.content
        .fillColor(this.defaults.color)
        .text(font.encode(marker), outerX, baseline, this.page.fontRes(font), base);
      this.frame = { x: outerX + indent, width: prevFrame ? prevFrame.width - indent : this.page.contentWidth - (outerX - this.page.margins.left) - indent };
      try {
        this.renderMarkdown(item, options);
      } finally {
        this.frame = prevFrame;
      }
      this.cursorY += base * 0.15;
      n++;
    }
  }

  /**
   * Lay out styled inline runs with word wrapping across the flow width,
   * mixing fonts (bold/italic/monospace), colours, links and underlines on
   * one line. A "word" may span several runs (e.g. `super**cali**`), so
   * wrapping works on whitespace-separated chunks, not per run.
   */
  private mdInline(runs: MdRun[], opts: { size: number; bold?: boolean; lineHeight?: number }): void {
    interface Seg { text: string; font: Font; color: RGB; link?: string; underline: boolean }
    const size = opts.size;
    const lineHeight = opts.lineHeight ?? this.defaults.lineHeight;
    const step = size * lineHeight;
    const baseFont = this.resolveFontStyle(this.defaults.font, opts.bold ?? false, false);
    const spaceWidth = baseFont.widthOf(" ", size);

    // Build whitespace-separated chunks; each chunk keeps its styled segments.
    const chunks: { segs: Seg[]; width: number; spaceBefore: boolean }[] = [];
    let cur: Seg[] = [];
    let curSpaceBefore = false;
    let pendingSpace = false;
    const closeChunk = (): void => {
      if (cur.length > 0) {
        chunks.push({ segs: cur, width: cur.reduce((a, s) => a + s.font.widthOf(s.text, size), 0), spaceBefore: curSpaceBefore });
        cur = [];
      }
    };
    for (const run of runs) {
      const font = run.code
        ? this.resolveFontStyle("courier", false, false)
        : this.resolveFontStyle(this.defaults.font, (opts.bold ?? false) || !!run.bold, !!run.italic);
      const link = run.link !== undefined ? this.mdSafeLink(run.link) : undefined;
      const color = run.code ? MD_CODE_COLOR : link !== undefined ? MD_LINK_COLOR : this.defaults.color;
      for (const part of run.text.split(/(\s+)/)) {
        if (part === "") continue;
        if (/^\s+$/.test(part)) {
          closeChunk();
          pendingSpace = true;
          continue;
        }
        if (cur.length === 0) curSpaceBefore = pendingSpace;
        cur.push({ text: part, font, color, link, underline: link !== undefined });
        pendingSpace = false;
      }
    }
    closeChunk();

    const startX = this.flowX;
    const maxX = this.flowX + this.flowWidth;
    this.breakPageIfNeeded(step);
    let x = startX;
    let lineHasContent = false;
    for (const chunk of chunks) {
      const lead = chunk.spaceBefore && lineHasContent ? spaceWidth : 0;
      if (lineHasContent && x + lead + chunk.width > maxX + 0.01) {
        this.cursorY += step;
        this.breakPageIfNeeded(step);
        x = startX;
        lineHasContent = false;
      } else {
        x += lead;
      }
      for (const seg of chunk.segs) {
        const w = seg.font.widthOf(seg.text, size);
        const baseline = this.page.ty(this.cursorY + (seg.font.ascent * size) / 1000);
        this.page.content.fillColor(seg.color).text(seg.font.encode(seg.text), x, baseline, this.page.fontRes(seg.font), size);
        if (seg.underline) {
          const uy = this.page.ty(this.cursorY + (seg.font.ascent * size) / 1000 + size * 0.1);
          this.page.content.strokeColor(seg.color).lineWidth(Math.max(0.4, size * 0.04)).moveTo(x, uy).lineTo(x + w, uy).stroke();
        }
        if (seg.link !== undefined) {
          this.page.links.push({ x, y: this.cursorY, width: w, height: step, target: seg.link });
        }
        x += w;
      }
      lineHasContent = true;
    }
    this.cursorY += step;
  }

  /** Validate a Markdown link target, dropping unsafe ones (kept as plain text). */
  private mdSafeLink(target: string): string | undefined {
    try {
      checkLinkTarget(target);
      return target;
    } catch {
      return undefined;
    }
  }

  private registerImage(bytes: Uint8Array): ImageEntry {
    let entry = this.images.get(bytes);
    if (entry) return entry;
    const format = detectFormat(bytes);
    if (!format) {
      throw new FastPDFError("Unsupported image format (JPEG, PNG, GIF and WebP are supported)", "UNSUPPORTED_IMAGE");
    }
    const size =
      format === "jpeg" ? parseJpeg(bytes)
      : format === "png" ? pngSize(bytes)
      : format === "gif" ? gifSize(bytes)
      : webpSize(bytes);
    entry = {
      id: `img${this.images.size}`,
      bytes,
      format,
      pxWidth: size.width,
      pxHeight: size.height,
    };
    this.images.set(bytes, entry);
    return entry;
  }

  // ── Vector primitives (absolute coordinates, top-left based) ─────────

  line(x1: number, y1: number, x2: number, y2: number, options: LineOptions = {}): this {
    assertFinite(x1, "line x1");
    assertFinite(y1, "line y1");
    assertFinite(x2, "line x2");
    assertFinite(y2, "line y2");
    this.withAlpha(options.opacity, () => {
      this.page.content
        .strokeColor(options.color !== undefined ? parseColor(options.color) : BLACK)
        .lineWidth(options.width ?? 1)
        .moveTo(x1, this.page.ty(y1))
        .lineTo(x2, this.page.ty(y2))
        .stroke();
    });
    return this;
  }

  rect(x: number, y: number, width: number, height: number, options: RectOptions = {}): this {
    assertFinite(x, "rect x");
    assertFinite(y, "rect y");
    assertFinite(width, "rect width");
    assertFinite(height, "rect height");
    const r = Math.min(options.radius ?? 0, width / 2, height / 2);
    return this.paintShape(options, () =>
      buildRectPath(this.page.content, x, this.page.ty(y), width, height, r),
    );
  }

  /** Circle with center (cx, cy) and radius r (top-left coordinates). */
  circle(cx: number, cy: number, r: number, options: ShapeOptions = {}): this {
    return this.ellipse(cx, cy, r, r, options);
  }

  /** Ellipse with center (cx, cy) and radii rx/ry (top-left coordinates). */
  ellipse(cx: number, cy: number, rx: number, ry: number, options: ShapeOptions = {}): this {
    assertFinite(cx, "ellipse cx");
    assertFinite(cy, "ellipse cy");
    assertFinite(rx, "ellipse rx");
    assertFinite(ry, "ellipse ry");
    if (rx <= 0 || ry <= 0) {
      throw new FastPDFError(`Ellipse radii must be positive (got ${rx}, ${ry})`, "INVALID_ARGUMENT");
    }
    return this.paintShape(options, () => {
      const c = this.page.content;
      const y = this.page.ty(cy);
      const kx = KAPPA * rx;
      const ky = KAPPA * ry;
      c.moveTo(cx + rx, y)
        .curveTo(cx + rx, y + ky, cx + kx, y + ry, cx, y + ry)
        .curveTo(cx - kx, y + ry, cx - rx, y + ky, cx - rx, y)
        .curveTo(cx - rx, y - ky, cx - kx, y - ry, cx, y - ry)
        .curveTo(cx + kx, y - ry, cx + rx, y - ky, cx + rx, y)
        .closePath();
    });
  }

  /**
   * Build a path and paint it according to fill/stroke options.
   *
   * The alpha state is set *before* the path is constructed and undone with
   * `Q` after painting: PDF's graphics object model only allows path
   * construction and painting operators between the two, so a `gs` wedged
   * in front of the paint operator would be out of place.
   */
  private paintShape(options: ShapeOptions, buildPath: () => void): this {
    const alpha = options.opacity !== undefined && options.opacity < 1;
    const c = this.page.content;
    const fill = options.fill !== undefined ? parseColor(options.fill) : undefined;
    const stroke = options.stroke !== undefined ? parseColor(options.stroke) : undefined;
    if (alpha) c.save().setGState(this.page.gsRes(clampAlpha(options.opacity!)));
    // Colour and line width are graphics-state operators too: set them at
    // page-description level, before the path object begins.
    if (fill) c.fillColor(fill);
    if (stroke) c.strokeColor(stroke).lineWidth(options.lineWidth ?? 1);
    if (!fill && !stroke) c.strokeColor(BLACK).lineWidth(options.lineWidth ?? 1);
    buildPath();
    if (fill && stroke) c.fillAndStroke();
    else if (fill) c.fill();
    else c.stroke(); // stroke colour (explicit or the black default) is already set
    if (alpha) c.restore();
    return this;
  }

  // ── Document features ────────────────────────────────────────────────

  /**
   * Register a decorator that draws on every page at render time —
   * the general mechanism behind headers, footers and watermarks.
   */
  onPage(decorator: PageDecorator): this {
    this.decorators.push(decorator);
    return this;
  }

  /** Repeating page header: a text in the top margin, or a custom decorator. */
  header(content: string | PageDecorator, options: HeaderFooterOptions = {}): this {
    if (typeof content !== "string") return this.onPage(content);
    return this.onPage((doc, info) => {
      const size = options.size ?? this.defaults.size * 0.85;
      doc.text(content, {
        ...options,
        size,
        y: Math.max(4, info.margins.top - size * 2),
        x: info.margins.left,
        width: info.size.width - info.margins.left - info.margins.right,
      });
    });
  }

  /** Repeating page footer: a text in the bottom margin, or a custom decorator. */
  footer(content: string | PageDecorator, options: HeaderFooterOptions = {}): this {
    if (typeof content !== "string") return this.onPage(content);
    return this.onPage((doc, info) => {
      const size = options.size ?? this.defaults.size * 0.85;
      doc.text(content, {
        ...options,
        size,
        y: info.size.height - info.margins.bottom + size,
        x: info.margins.left,
        width: info.size.width - info.margins.left - info.margins.right,
      });
    });
  }

  /** Page numbers on every page (default: "1 / 5", bottom center). */
  pageNumbers(options: PageNumberOptions = {}): this {
    const format = options.format ?? ((n: number, total: number) => `${n} / ${total}`);
    const startAt = options.startAt ?? 1;
    return this.onPage((doc, info) => {
      if (info.pageNumber < startAt) return;
      const size = options.size ?? this.defaults.size * 0.85;
      const y =
        options.position === "top"
          ? Math.max(4, info.margins.top - size * 2)
          : info.size.height - info.margins.bottom + size;
      doc.text(format(info.pageNumber, info.pageCount), {
        font: options.font,
        color: options.color,
        align: options.align ?? "center",
        size,
        y,
        x: info.margins.left,
        width: info.size.width - info.margins.left - info.margins.right,
      });
    });
  }

  /** Diagonal translucent watermark text on every page. */
  watermark(text: string, options: WatermarkOptions = {}): this {
    return this.onPage((doc, info) => {
      const font = doc.resolveFontStyle(options.font ?? doc.defaults.font, options.bold ?? true, false);
      const diag = Math.hypot(info.size.width, info.size.height);
      const w100 = font.widthOf(text, 100);
      const size = options.size ?? (w100 > 0 ? (0.6 * diag * 100) / w100 : 48);
      const angleDeg = options.angle ?? (-Math.atan2(info.size.height, info.size.width) * 180) / Math.PI;
      const rad = (-angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const page = doc.page;
      const cx = info.size.width / 2;
      const cy = info.size.height / 2; // page center; ty(cy) == cy only for its own half — compute properly:
      const cyPdf = page.ty(cy);
      const width = font.widthOf(text, size);
      page.content
        .save()
        .setGState(page.gsRes(clampAlpha(options.opacity ?? 0.12)))
        .fillColor(options.color !== undefined ? parseColor(options.color) : { r: 0.5, g: 0.5, b: 0.55 })
        .transform(cos, sin, -sin, cos, cx - cos * cx + sin * cyPdf, cyPdf - sin * cx - cos * cyPdf)
        .text(font.encode(text), cx - width / 2, cyPdf - size * 0.35, page.fontRes(font), size)
        .restore();
    });
  }

  /** Add a bookmark (PDF outline entry) pointing at the current position. */
  outline(title: string, options: OutlineOptions = {}): this {
    this.outlines.push({
      title,
      level: Math.max(0, options.level ?? 0),
      page: this.page,
      y: this.cursorY,
    });
    return this;
  }

  /** Name the current position as a link target for `link: "#name"`. */
  anchor(name: string): this {
    this.anchors.set(name, { page: this.page, y: this.cursorY });
    return this;
  }

  /**
   * A clickable area (absolute top-left coordinates). `target` is a URL or
   * an anchor reference ("#name").
   */
  link(x: number, y: number, width: number, height: number, target: string): this {
    checkLinkTarget(target);
    this.page.links.push({ x, y, width, height, target });
    return this;
  }

  /**
   * A clickable button: a filled (optionally bordered) box with a centred
   * label, covered by a link annotation.
   *
   * ```ts
   * pdf.button("Zur Demo", {
   *   link: "https://kevinci.github.io/fast-pdf/",
   *   fill: "#4f46e5",
   *   borderColor: "#3730a3",
   *   width: 180,
   * });
   * ```
   *
   * Flows by default (and breaks the page when it no longer fits); passing
   * `y` switches to absolute positioning. A label wider than the box is
   * truncated with an ellipsis rather than allowed to spill out.
   *
   * This is a link annotation, not an AcroForm `/Btn` widget: it works in
   * every viewer, needs no form support and executes nothing — the only
   * thing it can do is follow its target.
   */
  button(label: string, options: ButtonOptions): this {
    const size = options.size ?? this.defaults.size;
    const paddingX = options.paddingX ?? 16;
    const paddingY = options.paddingY ?? 8;
    const letterSpacing = options.letterSpacing ?? 0;
    const bold = options.bold ?? true;
    assertFinite(size, "button size");
    assertNonNegative(paddingX, "button paddingX");
    assertNonNegative(paddingY, "button paddingY");
    assertFinite(letterSpacing, "button letterSpacing");
    if (options.x !== undefined) assertFinite(options.x, "button x");
    if (options.y !== undefined) assertFinite(options.y, "button y");
    if (options.height !== undefined) assertNonNegative(options.height, "button height");
    if (options.borderWidth !== undefined) assertNonNegative(options.borderWidth, "button borderWidth");
    checkLinkTarget(options.link);

    const font = this.resolveFontStyle(options.font ?? this.defaults.font, bold, false);
    const labelWidth = measureLine(label, font, size, letterSpacing);
    const lineStep = size * this.defaults.lineHeight;

    // The flow area is the reference for percentages, both modes alike.
    const available = this.flowWidth;
    const width =
      options.width !== undefined
        ? resolveSize(options.width, available)
        : labelWidth + 2 * paddingX;
    assertNonNegative(width, "button width");
    const height = options.height ?? lineStep + 2 * paddingY;
    const radius = options.radius ?? 4;

    const borderWidth = options.borderWidth ?? (options.borderColor !== undefined ? 1 : 0);
    const stroke = borderWidth > 0 ? (options.borderColor ?? "#000000") : undefined;

    const draw = (x: number, yTop: number): void => {
      this.rect(x, yTop, width, height, {
        fill: options.fill ?? this.defaults.color,
        stroke,
        lineWidth: borderWidth,
        radius,
        opacity: options.opacity,
      });
      const innerWidth = Math.max(0, width - 2 * paddingX);
      let text = label;
      if (measureLine(text, font, size, letterSpacing) > innerWidth) {
        while (text.length > 0 && measureLine(`${text}…`, font, size, letterSpacing) > innerWidth) {
          text = text.slice(0, -1);
        }
        text += "…";
      }
      // Optical centring: the cap height sits in the middle of the box, so
      // the label looks centred rather than mathematically centred.
      const capHeight = (font.capHeight * size) / 1000;
      const ascent = (font.ascent * size) / 1000;
      this.text(text, {
        x: x + paddingX,
        y: yTop + (height + capHeight) / 2 - ascent,
        width: innerWidth,
        align: options.textAlign ?? "center",
        font: options.font,
        size,
        bold,
        letterSpacing,
        color: options.color ?? "#ffffff",
      });
      this.link(x, yTop, width, height, options.link);
    };

    if (options.y !== undefined) {
      draw(options.x ?? this.page.margins.left, options.y);
      this.lastBlock = height;
      return this;
    }

    this.applySpacingBefore(options.spacingBefore);
    this.breakPageIfNeeded(height);
    const free = Math.max(0, available - width);
    const shift = options.align === "center" ? free / 2 : options.align === "right" ? free : 0;
    draw(this.flowX + (options.x ?? 0) + shift, this.cursorY);
    this.cursorY += height + (options.spacingAfter ?? 0);
    this.lastBlock = height;
    return this;
  }

  /**
   * An empty signature form field (AcroForm /Sig) — the area recipients
   * click to sign the document in their PDF viewer and send it back.
   * Draws a signature line (and optional label) unless disabled; the
   * clickable field covers the area above the line.
   *
   * Note: this creates a *field to be signed by the recipient*. The
   * document itself is not cryptographically signed by fast-pdf.
   */
  signature(options: SignatureOptions = {}): this {
    const width = options.width ?? 220;
    const height = options.height ?? 60;
    let name = options.name;
    if (name !== undefined) {
      if (name === "" || name.includes(".")) {
        throw new FastPDFError(
          `Invalid signature field name "${name}" — must be non-empty and must not contain periods`,
          "INVALID_ARGUMENT",
        );
      }
      if (this.sigFieldNames.has(name)) {
        throw new FastPDFError(`Signature field name "${name}" is already used`, "INVALID_ARGUMENT");
      }
    } else {
      let n = this.sigFieldNames.size + 1;
      while (this.sigFieldNames.has(`Signature${n}`)) n++;
      name = `Signature${n}`;
    }
    this.sigFieldNames.add(name);

    const labelSize = this.defaults.size * 0.8;
    const labelGap = 4;
    const extra = options.label !== undefined ? labelGap + labelSize * 1.2 : 0;

    const draw = (x: number, yTop: number): void => {
      const page = this.page;
      if (options.line ?? true) {
        page.content
          .strokeColor({ r: 0.25, g: 0.25, b: 0.3 })
          .lineWidth(0.75)
          .moveTo(x, page.ty(yTop + height))
          .lineTo(x + width, page.ty(yTop + height))
          .stroke();
      }
      if (options.label !== undefined) {
        const font = this.resolveFontStyle(this.defaults.font, false, false);
        const baseline = page.ty(yTop + height + labelGap + (font.ascent * labelSize) / 1000);
        page.content
          .fillColor({ r: 0.45, g: 0.45, b: 0.5 })
          .text(font.encode(options.label), x, baseline, page.fontRes(font), labelSize);
      }
      page.sigFields.push({ name: name!, x, y: yTop, width, height, sign: options.sign });
    };

    if (options.y !== undefined) {
      draw(options.x ?? this.page.margins.left, options.y);
      return this;
    }

    this.breakPageIfNeeded(height + extra);
    const free = this.flowWidth - width;
    const shift = options.align === "center" ? free / 2 : options.align === "right" ? free : 0;
    draw(this.flowX + (options.x ?? 0) + shift, this.cursorY);
    this.cursorY += height + extra + (options.spacingAfter ?? 0);
    return this;
  }

  /**
   * Insert a table of contents built from outline entries. Call this
   * after all content (and outline() calls) — the TOC pages are created
   * at the end and then moved to `insertAt` (default: the front).
   * Entries link to their targets.
   */
  toc(options: TOCOptions = {}): this {
    const maxLevel = options.maxLevel ?? 1;
    const entries = this.outlines.filter((o) => o.level <= maxLevel);
    if (entries.length === 0) return this;
    const insertAt = Math.max(0, Math.min(options.insertAt ?? 0, this.pages.length));
    const indexOf = new Map<Page, number>();
    this.pages.forEach((p, i) => indexOf.set(p, i));

    const entrySize = this.defaults.size;
    const titleSize = entrySize * 1.6;
    const rowStep = entrySize * this.defaults.lineHeight * 1.25;

    // Dry run against the default page geometry: how many TOC pages will
    // there be? Needed up front — displayed numbers shift by that amount.
    const base: PageSize =
      typeof this.pageDefaults.format === "string"
        ? PAGE_FORMATS[this.pageDefaults.format]
        : this.pageDefaults.format;
    const geom = this.pageDefaults.landscape ? { width: base.height, height: base.width } : base;
    const margins = normalizeMargins(this.pageDefaults.margins, DEFAULT_MARGIN);
    const contentBottom = geom.height - margins.bottom;
    let dryY = margins.top + titleSize * this.defaults.lineHeight + entrySize;
    let tocPageCount = 1;
    for (let i = 0; i < entries.length; i++) {
      if (dryY + rowStep > contentBottom) {
        tocPageCount++;
        dryY = margins.top;
      }
      dryY += rowStep;
    }

    const tocStart = this.pages.length;
    this.addPage();
    this.text(options.title ?? "Contents", { size: titleSize, bold: true, spacingAfter: entrySize });
    for (const entry of entries) {
      this.breakPageIfNeeded(rowStep);
      const original = indexOf.get(entry.page);
      const pageNumber =
        original === undefined ? 0 : original + (original >= insertAt ? tocPageCount : 0) + 1;
      const font = this.resolveFontStyle(this.defaults.font, entry.level === 0, false);
      const indent = entry.level * entrySize * 1.5;
      const x = this.flowX + indent;
      const num = String(pageNumber);
      const numWidth = font.widthOf(num, entrySize);
      const rightX = this.flowX + this.flowWidth - numWidth;
      const labelMax = rightX - x - entrySize;
      let label = entry.title;
      if (font.widthOf(label, entrySize) > labelMax) {
        while (label.length > 0 && font.widthOf(label + "…", entrySize) > labelMax) {
          label = label.slice(0, -1);
        }
        label += "…";
      }
      const yTop = this.cursorY;
      const baseline = this.page.ty(yTop + (font.ascent * entrySize) / 1000);
      this.page.content
        .fillColor(this.defaults.color)
        .text(font.encode(label), x, baseline, this.page.fontRes(font), entrySize)
        .text(font.encode(num), rightX, baseline, this.page.fontRes(font), entrySize);
      this.page.links.push({
        x: this.flowX,
        y: yTop,
        width: this.flowWidth,
        height: rowStep,
        target: { page: entry.page, y: entry.y },
      });
      this.cursorY += rowStep;
    }

    // Move the TOC pages into place.
    const tocPages = this.pages.splice(tocStart);
    this.pages.splice(insertAt, 0, ...tocPages);
    return this;
  }

  // ── Rendering & output ───────────────────────────────────────────────

  /** Render the document to PDF bytes. */
  async render(): Promise<Uint8Array> {
    this.applyDecorators();
    const writer = new PDFWriter();

    // Fonts: one object set per unique font across all pages. Each font
    // writes its own objects (Type1 dict, or Type0 + subsetted FontFile2).
    const fontRefs = new Map<string, Ref>();
    for (const page of this.pages) {
      for (const { font } of page.fontsUsed.values()) {
        if (!fontRefs.has(font.key)) {
          fontRefs.set(font.key, await font.embed(writer));
        }
      }
    }

    // Images: parse once per unique image, write XObject (+ SMask).
    const imageRefs = new Map<string, Ref>();
    for (const entry of this.images.values()) {
      const parsed: ParsedImage =
        entry.format === "jpeg" ? parseJpeg(entry.bytes)
        : entry.format === "png" ? await parsePng(entry.bytes)
        : entry.format === "gif" ? await parseGif(entry.bytes)
        : await parseWebp(entry.bytes);
      let smaskRef: Ref | undefined;
      if (parsed.smask) {
        smaskRef = writer.addStream(
          {
            Type: new Name("XObject"),
            Subtype: new Name("Image"),
            Width: parsed.width,
            Height: parsed.height,
            ColorSpace: new Name("DeviceGray"),
            BitsPerComponent: 8,
            Filter: parsed.smaskDeflated ? new Name("FlateDecode") : undefined,
          },
          parsed.smask,
        );
      }
      imageRefs.set(
        entry.id,
        writer.addStream(
          {
            Type: new Name("XObject"),
            Subtype: new Name("Image"),
            Width: parsed.width,
            Height: parsed.height,
            ...parsed.dict,
            SMask: smaskRef,
          },
          parsed.data,
        ),
      );
    }

    // ExtGStates (constant alpha), deduplicated across pages.
    const gsRefs = new Map<number, Ref>();
    for (const page of this.pages) {
      for (const [key, { alpha }] of page.extGStatesUsed) {
        if (!gsRefs.has(key)) {
          gsRefs.set(key, writer.add({ Type: new Name("ExtGState"), ca: alpha, CA: alpha }));
        }
      }
    }

    // Pages: reserve all refs first — link annotations and outlines may
    // point at any page (forward or backward).
    const pagesRef = writer.reserve();
    const pageRefs = this.pages.map(() => writer.reserve());
    const refOf = new Map<Page, Ref>();
    this.pages.forEach((page, i) => refOf.set(page, pageRefs[i]!));

    // Appended PDFs: clone their object graphs into this file. One pass before
    // the page loop, so a link inside an imported file can be pointed at the
    // page we are about to write rather than at a second copy of it.
    const imports = await this.buildImports(writer, refOf, fontRefs, imageRefs, gsRefs);

    // Signature field widgets, collected for the document-level /AcroForm.
    const acroFields: Ref[] = [];
    // Signing options of the (at most one) cryptographically signed field.
    let signState: SigningOptions | undefined;

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]!;
      const parts = imports.get(page);
      const annotTransform = parts?.annotTransform;

      const annots = page.links.map((link) =>
        writer.add(this.buildLinkAnnot(link, page, refOf, annotTransform)),
      );
      for (const field of page.sigFields) {
        // Widgets need an appearance stream (empty — viewers render their
        // own "sign here" affordance; the visible line is page content).
        const apRef = writer.addStream(
          {
            Type: new Name("XObject"),
            Subtype: new Name("Form"),
            BBox: [0, 0, field.width, field.height],
          },
          new Uint8Array(0),
        );
        let sigValueRef: Ref | undefined;
        if (field.sign !== undefined) {
          if (signState !== undefined) {
            throw new FastPDFError("at most one signed signature field per document", "INVALID_ARGUMENT");
          }
          if (this.encryption !== undefined) {
            throw new FastPDFError("signing an encrypted document is not supported", "INVALID_ARGUMENT");
          }
          // The signature dictionary is emitted as raw bytes so the /ByteRange
          // and /Contents placeholders keep their exact fixed widths.
          sigValueRef = writer.add(signaturePlaceholder(field.sign));
          signState = field.sign;
        }
        const box: [number, number, number, number] = [
          field.x,
          page.ty(field.y + field.height),
          field.x + field.width,
          page.ty(field.y),
        ];
        const widgetRef = writer.add({
          Type: new Name("Annot"),
          Subtype: new Name("Widget"),
          FT: new Name("Sig"),
          T: textString(field.name),
          V: sigValueRef,
          Rect: annotTransform !== undefined ? transformRect(annotTransform, box) : box,
          F: 4, // print
          P: pageRefs[i],
          AP: { N: apRef },
        });
        acroFields.push(widgetRef);
        annots.push(widgetRef);
      }
      if (parts !== undefined) annots.push(...parts.annots);

      // A page copied 1:1 brings its own dictionary; its content stream was
      // already folded into it (as an overlay) by buildImports().
      if (parts?.pageDict !== undefined) {
        writer.fill(pageRefs[i]!, {
          Type: new Name("Page"),
          Parent: pagesRef,
          ...parts.pageDict,
          Annots: annots.length > 0 ? annots : undefined,
        });
        continue;
      }

      const raw = page.content.toBytes();
      const compressed = this.compress ? await deflate(raw) : null;
      const contentRef = writer.addStream(
        { Filter: compressed ? new Name("FlateDecode") : undefined },
        compressed ?? raw,
      );

      writer.fill(pageRefs[i]!, {
        Type: new Name("Page"),
        Parent: pagesRef,
        MediaBox: [0, 0, page.size.width, page.size.height],
        Contents: parts?.contentPrefix !== undefined ? [parts.contentPrefix, contentRef] : contentRef,
        Annots: annots.length > 0 ? annots : undefined,
        Resources: this.pageResources(page, fontRefs, imageRefs, gsRefs, parts?.form),
      });
    }
    writer.fill(pagesRef, { Type: new Name("Pages"), Kids: pageRefs, Count: pageRefs.length });

    const outlinesRef = this.buildOutlines(writer, refOf);
    const catalogRef = writer.add({
      Type: new Name("Catalog"),
      Pages: pagesRef,
      Outlines: outlinesRef,
      PageMode: outlinesRef ? new Name("UseOutlines") : undefined,
      // Natural language, for screen readers and PDF/UA conformance.
      Lang: this.language !== undefined ? textString(this.language) : undefined,
      // With a title present, tell viewers to show it instead of the filename.
      ViewerPreferences:
        this.metadata.title !== undefined ? { DisplayDocTitle: true } : undefined,
      // SigFlags: bit 1 = SignaturesExist. A real signature also sets bit 2
      // (AppendOnly, value 3) so viewers preserve the signed bytes.
      AcroForm:
        acroFields.length > 0 ? { Fields: acroFields, SigFlags: signState !== undefined ? 3 : 1 } : undefined,
    });
    const infoRef = writer.add(this.buildInfo());

    if (this.encryption !== undefined && !supportsEncryption() && this.encryption.onUnsupported === "skip") {
      // Explicitly opted in to an unencrypted fallback (e.g. an insecure
      // browser context): render the document rather than failing the export.
      const plain = await writer.finalize(catalogRef, infoRef);
      return signState !== undefined ? embedSignature(plain, signState) : plain;
    }
    if (this.encryption !== undefined) {
      const handler = await createSecurityHandler(this.encryption);
      const encryptRef = writer.add(handler.dict);
      return writer.finalize(catalogRef, infoRef, {
        exemptObject: encryptRef.num,
        encrypt: handler.encrypt,
      });
    }
    const bytes = await writer.finalize(catalogRef, infoRef);
    return signState !== undefined ? embedSignature(bytes, signState) : bytes;
  }

  /** The /Resources dictionary of one page, from the resources it registered. */
  private pageResources(
    page: Page,
    fontRefs: Map<string, Ref>,
    imageRefs: Map<string, Ref>,
    gsRefs: Map<number, Ref>,
    extraForm?: { res: string; ref: Ref },
  ): PDFValue {
    const fontDict: Record<string, PDFValue> = {};
    for (const { font, res } of page.fontsUsed.values()) fontDict[res] = fontRefs.get(font.key)!;
    const xobjectDict: Record<string, PDFValue> = {};
    for (const { entry, res } of page.imagesUsed.values()) xobjectDict[res] = imageRefs.get(entry.id)!;
    if (extraForm !== undefined) xobjectDict[extraForm.res] = extraForm.ref;
    const gsDict: Record<string, PDFValue> = {};
    for (const [key, { res }] of page.extGStatesUsed) gsDict[res] = gsRefs.get(key)!;
    return {
      Font: page.fontsUsed.size > 0 ? fontDict : undefined,
      XObject: Object.keys(xobjectDict).length > 0 ? xobjectDict : undefined,
      ExtGState: page.extGStatesUsed.size > 0 ? gsDict : undefined,
    };
  }

  /**
   * Copy every appended PDF page into the writer.
   *
   * Runs once per render, before the page loop, and returns what each imported
   * page contributes to its page dictionary. One `ObjectCopier` per source file
   * means pages from the same file share their fonts and images; seeding the
   * copier with our page references first means links between imported pages
   * resolve to the pages being written rather than to fresh copies of them.
   */
  private async buildImports(
    writer: PDFWriter,
    refOf: Map<Page, Ref>,
    fontRefs: Map<string, Ref>,
    imageRefs: Map<string, Ref>,
    gsRefs: Map<number, Ref>,
  ): Promise<Map<Page, ImportedParts>> {
    const out = new Map<Page, ImportedParts>();
    if (this.imported.size === 0) return out;

    const copiers = new Map<ImportGroup, ObjectCopier>();
    for (const [page, info] of this.imported) {
      let copier = copiers.get(info.group);
      if (copier === undefined) {
        copier = new ObjectCopier(info.group.reader, writer);
        copiers.set(info.group, copier);
      }
      copier.seed(info.source.ref.num, refOf.get(page)!);
    }

    // Wrapping imported content in q/Q keeps an unbalanced source stream from
    // leaking its graphics state into the overlay drawn after it. Two tiny
    // streams, shared by every imported page in the document.
    let pushRef: Ref | undefined;
    let popRef: Ref | undefined;

    for (const [page, info] of this.imported) {
      const { reader } = info.group;
      const copier = copiers.get(info.group)!;
      const pageRef = refOf.get(page)!;

      if (info.mode === "form") {
        const placement = info.placement!;
        const formRef = await importAsForm(reader, copier, writer, info.source, this.compress);
        const draw = new ContentStream();
        draw
          .save()
          .transform(placement[0], placement[1], placement[2], placement[3], placement[4], placement[5])
          .raw(`/${IMPORT_RES} Do`)
          .restore();
        out.set(page, {
          form: { res: IMPORT_RES, ref: formRef },
          contentPrefix: writer.addStream({}, draw.toBytes()),
          annots: await importAnnots(reader, copier, writer, info.source, {
            imported: info.group.imported,
            pageRef,
            // The form's own /Matrix normalizes rotation; annotations are not
            // inside the form, so they need that step applied explicitly.
            transform: concatMatrix(displayMatrix(info.source), placement),
          }),
        });
        continue;
      }

      const pageDict = await importPageDict(copier, info.source);
      const annotTransform = overlayMatrix(info.source);
      if (!page.content.isEmpty) {
        if (!info.overlay) {
          throw new FastPDFError(
            "Drawing on an appended page needs append(…, { overlay: true }) — " +
              "without it the appended PDF is copied unchanged and the drawing would be dropped",
            "INVALID_ARGUMENT",
          );
        }
        const raw = page.content.toBytes();
        const compressed = this.compress ? await deflate(raw) : null;
        // The overlay is a form XObject so its resource names cannot collide
        // with the ones the imported page already uses, and so its /Matrix can
        // undo the source page's rotation and box offset.
        const overlayRef = writer.addStream(
          {
            Type: new Name("XObject"),
            Subtype: new Name("Form"),
            FormType: 1,
            BBox: [0, 0, page.size.width, page.size.height],
            Matrix: annotTransform,
            Resources: this.pageResources(page, fontRefs, imageRefs, gsRefs),
            Filter: compressed ? new Name("FlateDecode") : undefined,
          },
          compressed ?? raw,
        );
        pushRef ??= writer.addStream({}, latin1Bytes("q\n"));
        popRef ??= writer.addStream({}, latin1Bytes("Q\n"));
        const base = pageDict.Contents;
        pageDict.Contents = [
          pushRef,
          ...(Array.isArray(base) ? base : base !== undefined ? [base] : []),
          popRef,
          writer.addStream({}, latin1Bytes(`q /${OVERLAY_RES} Do Q\n`)),
        ];
        pageDict.Resources = await resourcesWithOverlay(reader, copier, info.source, OVERLAY_RES, overlayRef);
      }
      out.set(page, {
        pageDict,
        annotTransform,
        annots: await importAnnots(reader, copier, writer, info.source, {
          imported: info.group.imported,
          pageRef,
          transform: null, // a 1:1 copy keeps the source's own coordinates
        }),
      });
    }
    return out;
  }

  /** Run page decorators exactly once, over the final page order. */
  private applyDecorators(): void {
    if (this.decorated || this.decorators.length === 0) return;
    this.decorated = true;
    const pageCount = this.pages.length;
    const savedY = this.cursorY;
    this.suppressBreaks++;
    try {
      this.pages.forEach((page, i) => {
        // Appended pages are left alone unless the caller opted into overlays:
        // a page number stamped over someone else's contract is a surprise.
        const imported = this.imported.get(page);
        if (imported !== undefined && !imported.overlay) return;
        this.activePage = page;
        const info: PageInfo = {
          pageNumber: i + 1,
          pageCount,
          size: { ...page.size },
          margins: { ...page.margins },
        };
        for (const decorator of this.decorators) decorator(this, info);
      });
    } finally {
      this.activePage = null;
      this.suppressBreaks--;
      this.cursorY = savedY;
    }
  }

  /**
   * Resolve a pending link into a PDF annotation dictionary.
   * `transform` is set on pages appended 1:1, whose annotation coordinates are
   * the source page's rather than our top-left drawing space.
   */
  private buildLinkAnnot(link: PendingLink, page: Page, refOf: Map<Page, Ref>, transform?: Matrix): PDFValue {
    const box: [number, number, number, number] = [
      link.x,
      page.ty(link.y + link.height),
      link.x + link.width,
      page.ty(link.y),
    ];
    const rect = transform !== undefined ? transformRect(transform, box) : box;
    const common = {
      Type: new Name("Annot"),
      Subtype: new Name("Link"),
      Rect: rect,
      Border: [0, 0, 0],
    };
    let target = link.target;
    if (typeof target === "string" && target.startsWith("#")) {
      const anchor = this.anchors.get(target.slice(1));
      if (!anchor) {
        throw new FastPDFError(`Unknown anchor "${target}" — call anchor("${target.slice(1)}") first`, "INVALID_ARGUMENT");
      }
      target = anchor;
    }
    if (typeof target === "string") {
      return { ...common, A: { S: new Name("URI"), URI: new PDFString(toAsciiUri(target)) } };
    }
    const pageRef = refOf.get(target.page);
    if (!pageRef) throw new FastPDFError("Link target page is not part of this document", "INTERNAL");
    return { ...common, Dest: [pageRef, new Name("XYZ"), null, target.page.ty(target.y), null] };
  }

  /** Build the outline (bookmark) tree; returns undefined without entries. */
  private buildOutlines(writer: PDFWriter, refOf: Map<Page, Ref>): Ref | undefined {
    if (this.outlines.length === 0) return undefined;
    interface Node {
      entry: { title: string; level: number; page: Page; y: number };
      ref: Ref;
      children: Node[];
    }
    const roots: Node[] = [];
    const stack: { level: number; node: Node }[] = [];
    for (const entry of this.outlines) {
      const node: Node = { entry, ref: writer.reserve(), children: [] };
      while (stack.length > 0 && stack[stack.length - 1]!.level >= entry.level) stack.pop();
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1]!.node.children.push(node);
      stack.push({ level: entry.level, node });
    }
    const rootRef = writer.reserve();
    const countAll = (nodes: Node[]): number =>
      nodes.reduce((a, n) => a + 1 + countAll(n.children), 0);
    const fillLevel = (nodes: Node[], parent: Ref): void => {
      nodes.forEach((node, i) => {
        const pageRef = refOf.get(node.entry.page);
        writer.fill(node.ref, {
          Title: textString(node.entry.title),
          Parent: parent,
          Prev: i > 0 ? nodes[i - 1]!.ref : undefined,
          Next: i < nodes.length - 1 ? nodes[i + 1]!.ref : undefined,
          First: node.children.length > 0 ? node.children[0]!.ref : undefined,
          Last: node.children.length > 0 ? node.children[node.children.length - 1]!.ref : undefined,
          Count: node.children.length > 0 ? countAll(node.children) : undefined,
          Dest: pageRef
            ? [pageRef, new Name("XYZ"), null, node.entry.page.ty(node.entry.y), null]
            : undefined,
        });
        fillLevel(node.children, node.ref);
      });
    };
    fillLevel(roots, rootRef);
    writer.fill(rootRef, {
      Type: new Name("Outlines"),
      First: roots[0]!.ref,
      Last: roots[roots.length - 1]!.ref,
      Count: countAll(roots),
    });
    return rootRef;
  }

  private buildInfo(): Record<string, PDFValue | undefined> {
    const m = this.metadata;
    // An explicit creationDate is always honoured. Otherwise a wall-clock date
    // is embedded — unless the document is deterministic, in which case the
    // timestamp is omitted so identical content renders to identical bytes.
    const date = m.creationDate ?? (this.deterministic ? undefined : new Date());
    const stamp = date !== undefined ? textString(formatDate(date)) : undefined;
    return {
      Title: m.title !== undefined ? textString(m.title) : undefined,
      Author: m.author !== undefined ? textString(m.author) : undefined,
      Subject: m.subject !== undefined ? textString(m.subject) : undefined,
      Keywords: m.keywords !== undefined ? textString(m.keywords) : undefined,
      Creator: m.creator !== undefined ? textString(m.creator) : undefined,
      Producer: textString(m.producer ?? "fast-pdf"),
      CreationDate: stamp,
      ModDate: stamp,
    };
  }

  /** Render and return a Node/Bun Buffer where available, else a Uint8Array. */
  async toBuffer(): Promise<Uint8Array> {
    const bytes = await this.render();
    const B = (globalThis as Record<string, unknown>)["Buffer"] as
      | { from(b: Uint8Array): Uint8Array }
      | undefined;
    return B ? B.from(bytes) : bytes;
  }

  /** Render and return a Blob (for browser downloads, FormData, Response bodies). */
  async toBlob(): Promise<Blob> {
    const bytes = await this.render();
    return new Blob([bytes as BlobPart], { type: "application/pdf" });
  }

  /**
   * Render and return the PDF as a ReadableStream (64 KiB chunks) — usable
   * as an HTTP response body on Node 18+, Bun, Deno, browsers and edge runtimes.
   */
  toStream(): ReadableStream<Uint8Array> {
    const render = (): Promise<Uint8Array> => this.render();
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const bytes = await render();
        const CHUNK = 65536;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          controller.enqueue(bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
        }
        controller.close();
      },
    });
  }

  /**
   * Render and save: writes to disk on Node/Bun/Deno, triggers a download
   * in browsers (where `path` is the file name).
   */
  async save(path: string): Promise<void> {
    await saveFile(path, await this.render());
  }
}

function clampAlpha(a: number): number {
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/**
 * Resource names for imported content. Distinct prefixes keep them clear of
 * both our own generated names (F0, Im0, GS0) and the source page's, which the
 * overlay's resources are merged with.
 */
const IMPORT_RES = "FpImport";
const OVERLAY_RES = "FpOverlay";

/** Pick the requested pages of a source document, 1-based and in order. */
function selectSourcePages(available: SourcePage[], pages: AppendOptions["pages"]): SourcePage[] {
  if (pages === undefined) return available;
  const wanted = typeof pages === "number" ? [pages] : pages;
  return wanted.map((number) => {
    if (!Number.isInteger(number) || number < 1 || number > available.length) {
      throw new FastPDFError(
        `append(): page ${number} does not exist — the file has ${available.length} page(s)`,
        "INVALID_ARGUMENT",
      );
    }
    return available[number - 1]!;
  });
}

/** Scale a source page to fit a target page, centred, keeping its aspect ratio. */
function containMatrix(source: PageSize, target: PageSize, padding: number): Matrix {
  const boxWidth = Math.max(1, target.width - 2 * padding);
  const boxHeight = Math.max(1, target.height - 2 * padding);
  const scale = Math.min(boxWidth / source.width, boxHeight / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  // PDF space, so centring needs no vertical flip — it is symmetric.
  return [scale, 0, 0, scale, (target.width - width) / 2, (target.height - height) / 2];
}

/** Corner radius of a clip rectangle, capped at half its shorter side. */
function clipRadius(rect: ClipRect): number {
  return Math.max(0, Math.min(rect.radius ?? 0, rect.width / 2, rect.height / 2));
}

/** Validate an external link target ("#anchor" refs are resolved elsewhere). */
function checkLinkTarget(target: string): void {
  if (target.startsWith("#")) return;
  const scheme = blockedUriScheme(target);
  if (scheme !== null) {
    throw new FastPDFError(`Link target scheme "${scheme}:" is not allowed`, "UNSAFE_LINK");
  }
}

/** Percent-encode a URI so it fits into an ASCII PDF string. */
function toAsciiUri(uri: string): string {
  let out = "";
  let encoded: string;
  try {
    encoded = encodeURI(uri);
  } catch {
    throw new FastPDFError(`Link target is not a valid URI: "${uri}"`, "INVALID_ARGUMENT");
  }
  for (const ch of encoded) {
    const c = ch.codePointAt(0)!;
    out += c > 0x7e ? encodeURIComponent(ch) : ch;
  }
  return out;
}

/** Resolve a size in points or a percentage of `available`. */
function resolveSize(value: SizeInput, available: number): number {
  if (typeof value === "number") return value;
  const m = /^(\d+(?:\.\d+)?)\s*%$/.exec(value.trim());
  if (!m) {
    throw new FastPDFError(`Invalid size "${value}" — use points (number) or a percentage like "50%"`, "INVALID_ARGUMENT");
  }
  return (parseFloat(m[1]!) / 100) * available;
}

/** Build a (rounded) rectangle path in PDF space; `yTop` is the top edge. */
function buildRectPath(c: ContentStream, x: number, yTop: number, width: number, height: number, r: number): void {
  const yBot = yTop - height;
  if (r <= 0) {
    c.rect(x, yBot, width, height);
    return;
  }
  const k = KAPPA * r;
  const x2 = x + width;
  c.moveTo(x + r, yTop)
    .lineTo(x2 - r, yTop)
    .curveTo(x2 - r + k, yTop, x2, yTop - r + k, x2, yTop - r)
    .lineTo(x2, yBot + r)
    .curveTo(x2, yBot + r - k, x2 - r + k, yBot, x2 - r, yBot)
    .lineTo(x + r, yBot)
    .curveTo(x + r - k, yBot, x, yBot + r - k, x, yBot + r)
    .lineTo(x, yTop - r)
    .curveTo(x, yTop - r + k, x + r - k, yTop, x + r, yTop)
    .closePath();
}

function formatDate(date: Date): string {
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}
