import { Name, PDFString, textString, type PDFValue, type Ref } from "../pdf/objects";
import { PDFWriter } from "../pdf/writer";
import { ContentStream } from "../pdf/content";
import { deflate } from "../pdf/compress";
import { isStandardFamily, resolveFont, styleIndex, type Font } from "../fonts/font";
import { EmbeddedFont } from "../fonts/embedded";
import { wrapLines, alignOffset, type WrappedLine } from "../layout/text";
import { columnWidths, countColumns, measureTable, type CellValue, type TableOptions, type MeasuredRow } from "../layout/table";
import { detectFormat, toBytes, type ParsedImage } from "../images/image";
import { parseJpeg } from "../images/jpeg";
import { parsePng, pngSize } from "../images/png";
import { Page, type ImageEntry, type PendingLink } from "./page";
import { saveFile } from "../adapters/save";
import { FastPDFError } from "../errors";
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

export interface PDFDocumentOptions extends PageOptions {
  /** Default font family (standard or registered via registerFont()). Default: "helvetica". */
  font?: FontFamily | (string & {});
  /** Default font size in points. Default: 11. */
  fontSize?: number;
  /** Default line height as a multiple of the font size. Default: 1.25. */
  lineHeight?: number;
  /** Compress content streams (FlateDecode). Default: true. */
  compress?: boolean;
  metadata?: DocumentMetadata;
}

export interface TextOptions {
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
}

export interface ImageOptions {
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
  /** Horizontal alignment within the flow area (flow mode). Default: "left". */
  align?: "left" | "center" | "right";
  spacingAfter?: number;
}

export interface LineOptions {
  color?: ColorInput;
  width?: number;
}

export interface RectOptions {
  fill?: ColorInput;
  stroke?: ColorInput;
  lineWidth?: number;
  /** Corner radius in points for rounded rectangles. */
  radius?: number;
}

/** Fill/stroke options for closed shapes (circles, ellipses). */
export type ShapeOptions = Omit<RectOptions, "radius">;

/** A size in points, or a percentage of the available width ("50%"). */
export type SizeInput = number | string;

export interface ContainerOptions {
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
  private readonly metadata: DocumentMetadata;
  private readonly images = new Map<Uint8Array, ImageEntry>();
  /** family → [regular, bold, italic, boldItalic] embedded fonts. */
  private readonly customFonts = new Map<string, (EmbeddedFont | undefined)[]>();
  private cursorY: number;
  /** Active layout frame (container/column); null = full content area. */
  private frame: { x: number; width: number } | null = null;
  /** > 0 while inside container()/columns(): automatic page breaks are off. */
  private suppressBreaks = 0;
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

  private get page(): Page {
    return this.activePage ?? this.pages[this.pages.length - 1]!;
  }

  /** Advance the cursor by `lines` default line heights. */
  moveDown(lines = 1): this {
    this.cursorY += lines * this.defaults.size * this.defaults.lineHeight;
    return this;
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
    this.frame = { x: outerX + padding.left, width: innerWidth };
    this.cursorY = startY + padding.top;
    this.suppressBreaks++;
    try {
      content(this);
    } finally {
      this.suppressBreaks--;
      this.frame = prevFrame;
    }

    let height = this.cursorY + padding.bottom - startY;
    if (options.minHeight !== undefined) height = Math.max(height, options.minHeight);

    if (options.background !== undefined || options.border !== undefined) {
      // Painted onto a detached stream, then inserted *before* the content:
      // the height was unknown when the content started drawing.
      const bg = new ContentStream();
      const radius = Math.min(options.radius ?? 0, outerWidth / 2, height / 2);
      buildRectPath(bg, outerX, page.ty(startY), outerWidth, height, radius);
      const fill = options.background !== undefined ? parseColor(options.background) : undefined;
      const stroke = options.border !== undefined ? parseColor(options.border.color ?? "#000000") : undefined;
      if (fill) bg.fillColor(fill);
      if (stroke) bg.strokeColor(stroke).lineWidth(options.border?.width ?? 1);
      if (fill && stroke) bg.fillAndStroke();
      else if (fill) bg.fill();
      else if (stroke) bg.stroke();
      page.content.insertAt(mark, bg);
    }

    this.cursorY = startY + height + margin.bottom;
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
    let x = this.flowX;
    let endY = startY;
    this.suppressBreaks++;
    try {
      for (let i = 0; i < builders.length; i++) {
        this.frame = { x, width: widths[i]! };
        this.cursorY = startY;
        builders[i]!(this);
        endY = Math.max(endY, this.cursorY);
        x += widths[i]! + gap;
      }
    } finally {
      this.suppressBreaks--;
      this.frame = prevFrame;
    }
    this.cursorY = endY;
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
    };
    const font = this.resolveFontStyle(style.font, style.bold, style.italic);
    const lineStep = style.size * style.lineHeight;

    if (options.link !== undefined) checkLinkTarget(options.link);

    if (options.y !== undefined) {
      // Absolute positioning: draw where told, leave the flow cursor alone.
      const x = options.x ?? this.page.margins.left;
      const width = options.width ?? this.page.size.width - this.page.margins.right - x;
      let y = options.y;
      for (const line of wrapLines(content, font, style.size, width, style.letterSpacing)) {
        const drawn = this.drawTextLine(line, font, style, x, y, width);
        if (drawn && options.link !== undefined) {
          this.page.links.push({ x: drawn.x, y, width: drawn.width, height: lineStep, target: options.link });
        }
        y += lineStep;
      }
      return this;
    }

    const x = this.flowX + (options.x ?? 0);
    const width = options.width ?? this.flowX + this.flowWidth - x;
    for (const line of wrapLines(content, font, style.size, width, style.letterSpacing)) {
      this.breakPageIfNeeded(lineStep);
      const drawn = this.drawTextLine(line, font, style, x, this.cursorY, width);
      if (drawn && options.link !== undefined) {
        this.page.links.push({ x: drawn.x, y: this.cursorY, width: drawn.width, height: lineStep, target: options.link });
      }
      this.cursorY += lineStep;
    }
    this.cursorY += options.spacingAfter ?? 0;
    return this;
  }

  /** Measure text width in points with the current (or given) style. */
  widthOfText(content: string, options: Pick<TextOptions, "font" | "size" | "bold" | "italic"> = {}): number {
    const font = this.resolveFontStyle(
      options.font ?? this.defaults.font,
      options.bold ?? this.defaults.bold,
      options.italic ?? this.defaults.italic,
    );
    return font.widthOf(content, options.size ?? this.defaults.size);
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
    const chars = [...line.text].length;
    const naturalWidth = font.widthOf(line.text, size) + (chars > 1 ? (chars - 1) * spacing : 0);
    const justify = style.align === "justify" && !line.paragraphEnd && line.text.includes(" ");
    const offset = justify ? 0 : alignOffset(naturalWidth, boxWidth, style.align);
    const baselineTop = yTop + (font.ascent * size) / 1000;
    const baseline = this.page.ty(baselineTop);
    const fontRes = this.page.fontRes(font);
    const content = this.page.content.fillColor(style.color);

    let drawnWidth = naturalWidth;
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
      content.textTJ(parts, x, baseline, fontRes, size, spacing);
      drawnWidth = boxWidth;
    } else {
      content.text(font.encode(line.text), x + offset, baseline, fontRes, size, spacing);
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
        let lineY = yTop + padding;
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

    const draw = (x: number, yTop: number): void => {
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
          c.rect(x, this.page.ty(yTop + boxH), boxW, boxH).clip();
        }
      }
      c.image(this.page.imageRes(entry), x + dx, this.page.ty(yTop + dy + dh), dw, dh);
      if (wrap) c.restore();
    };

    if (options.y !== undefined) {
      draw(options.x ?? this.page.margins.left, options.y);
      return this;
    }

    this.breakPageIfNeeded(boxH);
    const free = this.flowWidth - boxW;
    const shift = options.align === "center" ? free / 2 : options.align === "right" ? free : 0;
    draw(this.flowX + (options.x ?? 0) + shift, this.cursorY);
    this.cursorY += boxH + (options.spacingAfter ?? 0);
    return this;
  }

  private registerImage(bytes: Uint8Array): ImageEntry {
    let entry = this.images.get(bytes);
    if (entry) return entry;
    const format = detectFormat(bytes);
    if (!format) throw new FastPDFError("Unsupported image format (JPEG and PNG are supported)", "UNSUPPORTED_IMAGE");
    const size = format === "jpeg" ? parseJpeg(bytes) : pngSize(bytes);
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
    this.page.content
      .strokeColor(options.color !== undefined ? parseColor(options.color) : BLACK)
      .lineWidth(options.width ?? 1)
      .moveTo(x1, this.page.ty(y1))
      .lineTo(x2, this.page.ty(y2))
      .stroke();
    return this;
  }

  rect(x: number, y: number, width: number, height: number, options: RectOptions = {}): this {
    const r = Math.min(options.radius ?? 0, width / 2, height / 2);
    buildRectPath(this.page.content, x, this.page.ty(y), width, height, r);
    return this.paintPath(options);
  }

  /** Circle with center (cx, cy) and radius r (top-left coordinates). */
  circle(cx: number, cy: number, r: number, options: ShapeOptions = {}): this {
    return this.ellipse(cx, cy, r, r, options);
  }

  /** Ellipse with center (cx, cy) and radii rx/ry (top-left coordinates). */
  ellipse(cx: number, cy: number, rx: number, ry: number, options: ShapeOptions = {}): this {
    if (rx <= 0 || ry <= 0) {
      throw new FastPDFError(`Ellipse radii must be positive (got ${rx}, ${ry})`, "INVALID_ARGUMENT");
    }
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
    return this.paintPath(options);
  }

  /** Paint the current path according to fill/stroke options. */
  private paintPath(options: ShapeOptions): this {
    const c = this.page.content;
    const fill = options.fill !== undefined ? parseColor(options.fill) : undefined;
    const stroke = options.stroke !== undefined ? parseColor(options.stroke) : undefined;
    if (fill) c.fillColor(fill);
    if (stroke) c.strokeColor(stroke).lineWidth(options.lineWidth ?? 1);
    if (fill && stroke) c.fillAndStroke();
    else if (fill) c.fill();
    else if (stroke) c.stroke(); // stroke color already set above — don't reset it
    else c.strokeColor(BLACK).lineWidth(options.lineWidth ?? 1).stroke();
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
      page.sigFields.push({ name: name!, x, y: yTop, width, height });
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
        entry.format === "jpeg" ? parseJpeg(entry.bytes) : await parsePng(entry.bytes);
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

    // Signature field widgets, collected for the document-level /AcroForm.
    const acroFields: Ref[] = [];

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]!;
      const raw = page.content.toBytes();
      const compressed = this.compress ? await deflate(raw) : null;
      const contentRef = writer.addStream(
        { Filter: compressed ? new Name("FlateDecode") : undefined },
        compressed ?? raw,
      );

      const fontDict: Record<string, PDFValue> = {};
      for (const { font, res } of page.fontsUsed.values()) fontDict[res] = fontRefs.get(font.key)!;
      const xobjectDict: Record<string, PDFValue> = {};
      for (const { entry, res } of page.imagesUsed.values()) xobjectDict[res] = imageRefs.get(entry.id)!;
      const gsDict: Record<string, PDFValue> = {};
      for (const [key, { res }] of page.extGStatesUsed) gsDict[res] = gsRefs.get(key)!;

      const annots = page.links.map((link) => writer.add(this.buildLinkAnnot(link, page, refOf)));
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
        const widgetRef = writer.add({
          Type: new Name("Annot"),
          Subtype: new Name("Widget"),
          FT: new Name("Sig"),
          T: textString(field.name),
          Rect: [field.x, page.ty(field.y + field.height), field.x + field.width, page.ty(field.y)],
          F: 4, // print
          P: pageRefs[i],
          AP: { N: apRef },
        });
        acroFields.push(widgetRef);
        annots.push(widgetRef);
      }

      writer.fill(pageRefs[i]!, {
        Type: new Name("Page"),
        Parent: pagesRef,
        MediaBox: [0, 0, page.size.width, page.size.height],
        Contents: contentRef,
        Annots: annots.length > 0 ? annots : undefined,
        Resources: {
          Font: page.fontsUsed.size > 0 ? fontDict : undefined,
          XObject: page.imagesUsed.size > 0 ? xobjectDict : undefined,
          ExtGState: page.extGStatesUsed.size > 0 ? gsDict : undefined,
        },
      });
    }
    writer.fill(pagesRef, { Type: new Name("Pages"), Kids: pageRefs, Count: pageRefs.length });

    const outlinesRef = this.buildOutlines(writer, refOf);
    const catalogRef = writer.add({
      Type: new Name("Catalog"),
      Pages: pagesRef,
      Outlines: outlinesRef,
      PageMode: outlinesRef ? new Name("UseOutlines") : undefined,
      // SigFlags 1 = SignaturesExist: the document contains signature
      // field(s), so viewers enable their signing UI.
      AcroForm: acroFields.length > 0 ? { Fields: acroFields, SigFlags: 1 } : undefined,
    });
    const infoRef = writer.add(this.buildInfo());
    return writer.finalize(catalogRef, infoRef);
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

  /** Resolve a pending link into a PDF annotation dictionary. */
  private buildLinkAnnot(link: PendingLink, page: Page, refOf: Map<Page, Ref>): PDFValue {
    const rect = [link.x, page.ty(link.y + link.height), link.x + link.width, page.ty(link.y)];
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
    return {
      Title: m.title !== undefined ? textString(m.title) : undefined,
      Author: m.author !== undefined ? textString(m.author) : undefined,
      Subject: m.subject !== undefined ? textString(m.subject) : undefined,
      Keywords: m.keywords !== undefined ? textString(m.keywords) : undefined,
      Creator: m.creator !== undefined ? textString(m.creator) : undefined,
      Producer: textString(m.producer ?? "fast-pdf"),
      CreationDate: textString(formatDate(m.creationDate ?? new Date())),
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
 * URI schemes that PDF viewers may hand straight to the OS or script engine.
 * Rejected so untrusted data flowing into a link target cannot turn an
 * invoice into a script/local-file launcher.
 */
const BLOCKED_URI_SCHEMES = new Set(["javascript", "vbscript", "data", "file"]);

/** Validate an external link target ("#anchor" refs are resolved elsewhere). */
function checkLinkTarget(target: string): void {
  if (target.startsWith("#")) return;
  // Strip control chars and spaces before matching — they must not be able
  // to disguise the scheme ("java\nscript:" and friends).
  const compact = target.replace(/[\x00-\x20\x7f]/g, "");
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact)?.[1]?.toLowerCase();
  if (scheme !== undefined && BLOCKED_URI_SCHEMES.has(scheme)) {
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
