/**
 * HTML table → PDF.
 *
 * Reads a `<table>` that is already on the page — its structure *and* its
 * computed appearance — and renders it through the normal table engine. The
 * point is that the PDF looks like what the reader is looking at: the same
 * colors, borders, font sizes, paddings and column proportions, because all
 * of them are taken from the browser's own layout rather than guessed.
 *
 * What cannot come along: web font *files*. CSS gives a font's name, never
 * its bytes, so a family the document does not carry is mapped onto the
 * closest built-in one. Register the font with `registerFont()` and pass it
 * as `table.font` to get the real thing.
 */

import { PDFDocument } from "../document/document";
import type { HeaderFooterOptions, PageDecorator, PageNumberOptions } from "../document/document";
import type { CellBorders, CellBorderSide, TableCell, TableOptions } from "../layout/table";
import { FastPDFError } from "../errors";
import { resolveFont } from "../fonts/font";
import { parseCssColor } from "../types/css-color";
import type {
  ColorInput,
  DocumentMetadata,
  Margins,
  PageFormatName,
  PageSize,
  TextAlign,
} from "../types/index";

/** A table element, or a CSS selector that finds one. */
export type TableSource = string | HTMLTableElement | HTMLElement;

/** The subset of `CSSStyleDeclaration` this module reads. */
export type StyleReader = (element: Element) => Partial<CSSStyleDeclaration>;

export interface TablePDFOptions {
  /** Page format. Default: "A4". */
  format?: PageFormatName | PageSize;
  /**
   * `"auto"` (default) turns the page when the table is wider than the
   * portrait text column, `"portrait"` and `"landscape"` force it.
   */
  orientation?: "auto" | "portrait" | "landscape";
  /** Page margins in points. Default: 40. */
  margins?: number | Partial<Margins>;
  /** Heading printed above the table; also used as the PDF title. */
  title?: string;
  /** Running header on every page — a string, or draw it yourself. */
  header?: string | PageDecorator;
  headerOptions?: HeaderFooterOptions;
  /** Running footer on every page. */
  footer?: string | PageDecorator;
  footerOptions?: HeaderFooterOptions;
  /** Page numbers. `true` uses the defaults, or pass the options. */
  pageNumbers?: boolean | PageNumberOptions;
  metadata?: DocumentMetadata;
  /** Passed to `table()`; anything set here wins over the CSS reading. */
  table?: TableOptions;
  /** CSS selector for rows and cells to leave out (a "no-print" class). */
  skip?: string;
  /** Include rows hidden by CSS. Default: false. */
  includeHidden?: boolean;
  /**
   * Take colors, borders, font sizes and padding from the page's CSS.
   * Default: true. With `false` only the structure is read and the table is
   * styled by fast-pdf's own defaults.
   */
  styles?: boolean;
  /**
   * The page's background.
   *
   * `"auto"` (default) takes the first real colour behind the table — its
   * own, or the card, panel or page it sits on. This is what makes a table
   * from a dark interface readable: in the browser a row without its own
   * background lets that surface show through, and on white paper it would
   * instead be light text on white. A colour forces one, `false` keeps the
   * paper white.
   */
  background?: ColorInput | "auto" | false;
  /**
   * CSS pixels per PDF point. Default: 0.75 — the ratio between a 96 dpi
   * screen and PDF's 72 dpi, so 16 px of text becomes 12 pt.
   */
  scale?: number;
  /** Override the style source. Defaults to `getComputedStyle`. */
  computedStyle?: StyleReader;
}

const DEFAULT_SCALE = 0.75;

/* ---------------------------------------------------------------- reading */

function resolveTable(source: TableSource, where: string): HTMLTableElement {
  let element: Element | null;
  if (typeof source === "string") {
    if (typeof document === "undefined") {
      throw new FastPDFError(
        `${where} needs a DOM to resolve the selector "${source}"`,
        "NO_TABLE",
      );
    }
    element = document.querySelector(source);
    if (!element) throw new FastPDFError(`No element matches "${source}"`, "NO_TABLE");
  } else {
    element = source ?? null;
    if (!element) throw new FastPDFError(`${where} was given no element`, "NO_TABLE");
  }
  if (element.tagName === "TABLE") return element as HTMLTableElement;
  const inner = element.querySelector?.("table");
  if (inner) return inner as HTMLTableElement;
  throw new FastPDFError(
    `${where} expects a <table> (or an element containing one), got <${element.tagName.toLowerCase()}>`,
    "NO_TABLE",
  );
}

function defaultStyleReader(): StyleReader | undefined {
  if (typeof globalThis.getComputedStyle !== "function") return undefined;
  return (element) => globalThis.getComputedStyle(element as Element);
}

/** Cell text, with `<br>` and block children turned into line breaks. */
function cellText(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3 /* text */) {
      out += (child.nodeValue ?? "").replace(/\s+/g, " ");
      continue;
    }
    if (child.nodeType !== 1 /* element */) continue;
    const tag = (child as Element).tagName;
    if (tag === "BR") {
      out += "\n";
      continue;
    }
    out += cellText(child);
    if (tag === "P" || tag === "DIV" || tag === "LI") out += "\n";
  }
  return out;
}

function normalizeText(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

function px(value: string | undefined, scale: number): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n * scale : 0;
}

/** A CSS color, or undefined when it is absent or fully transparent. */
function paint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = parseCssColor(value);
  if (!parsed || parsed.alpha === 0) return undefined;
  const to255 = (c: number): number => Math.round(c * 255);
  return `#${[parsed.rgb.r, parsed.rgb.g, parsed.rgb.b]
    .map((c) => to255(c).toString(16).padStart(2, "0"))
    .join("")}`;
}

function side(
  style: Partial<CSSStyleDeclaration>,
  edge: "Top" | "Right" | "Bottom" | "Left",
  scale: number,
): CellBorderSide | null {
  const lineStyle = style[`border${edge}Style` as keyof CSSStyleDeclaration] as string | undefined;
  if (!lineStyle || lineStyle === "none" || lineStyle === "hidden") return null;
  const width = px(
    style[`border${edge}Width` as keyof CSSStyleDeclaration] as string | undefined,
    scale,
  );
  if (width <= 0) return null;
  const color = paint(
    style[`border${edge}Color` as keyof CSSStyleDeclaration] as string | undefined,
  );
  if (!color) return null;
  return { width, color };
}

function alignOf(value: string | undefined): TextAlign | undefined {
  switch (value) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "center":
      return "center";
    case "justify":
      return "justify";
    default:
      // "start"/"end" mean "nobody chose", so the number heuristic may run.
      return undefined;
  }
}

/** Does this look like a number to a reader? Handles 1.234,56 and 1,234.56. */
function looksNumeric(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  return /^[+-]?[€$£¥]?\s?\d{1,3}([.,\s']\d{3})*([.,]\d+)?\s?(%|€|\$|£|¥|[a-z]{1,3})?$/i.test(t);
}

interface ReadCell {
  cell: TableCell;
  column: number;
  colSpan: number;
  /** Rendered width in points, or 0 when the element is not laid out. */
  width: number;
  /** True when the CSS explicitly set a horizontal alignment. */
  explicitAlign: boolean;
}

interface ReadTable {
  rows: TableCell[][];
  columns: number;
  hasHeader: boolean;
  hasFooter: boolean;
  /** Per column, the rendered width in points (0 when unknown). */
  widths: number[];
  /** Total rendered width of the table in points (0 when unknown). */
  tableWidth: number;
  /**
   * The narrowest the table could be without breaking a word apart, in
   * points. Unlike the rendered width — which only says how wide the
   * surrounding container happens to be — this is what actually decides
   * whether a page has to be turned.
   */
  minWidth: number;
  /** Columns whose body cells all read as numbers and carry no CSS align. */
  numericColumns: boolean[];
  /** The first real colour behind the table, if the page has one. */
  background?: string;
  /** The table's own text colour — what a heading above it should use. */
  inkColor?: string;
}

function readTable(table: HTMLTableElement, options: TablePDFOptions): ReadTable {
  const scale = options.scale ?? DEFAULT_SCALE;
  const useStyles = options.styles !== false;
  const styleOf = useStyles ? (options.computedStyle ?? defaultStyleReader()) : undefined;
  const read = (element: Element): Partial<CSSStyleDeclaration> =>
    styleOf ? (styleOf(element) ?? {}) : {};

  const sections: { rows: HTMLTableRowElement[]; kind: "head" | "body" | "foot" }[] = [];
  const head = table.tHead ? Array.from(table.tHead.rows) : [];
  if (head.length > 0) sections.push({ rows: head, kind: "head" });
  const bodyRows: HTMLTableRowElement[] = [];
  for (const body of Array.from(table.tBodies ?? [])) bodyRows.push(...Array.from(body.rows));
  for (const child of Array.from(table.children)) {
    if (child.tagName === "TR") bodyRows.push(child as HTMLTableRowElement);
  }
  if (bodyRows.length > 0) sections.push({ rows: bodyRows, kind: "body" });
  const foot = table.tFoot ? Array.from(table.tFoot.rows) : [];
  if (foot.length > 0) sections.push({ rows: foot, kind: "foot" });

  const hidden = (element: Element, style: Partial<CSSStyleDeclaration>): boolean => {
    if (options.includeHidden) return false;
    if ((element as HTMLElement).hidden) return true;
    return style.display === "none" || style.visibility === "hidden";
  };
  const skipped = (element: Element): boolean =>
    options.skip !== undefined && typeof element.matches === "function"
      ? element.matches(options.skip)
      : false;

  const rows: TableCell[][] = [];
  const readRows: ReadCell[][] = [];
  const kinds: ("head" | "body" | "foot")[] = [];
  // Columns still covered by a rowSpan from an earlier row.
  const occupancy: number[] = [];

  for (const section of sections) {
    for (const row of section.rows) {
      const rowStyle = read(row);
      if (skipped(row) || hidden(row, rowStyle)) continue;
      const cells: TableCell[] = [];
      const meta: ReadCell[] = [];
      let column = 0;
      for (const element of Array.from(row.cells ?? [])) {
        const style = read(element);
        if (skipped(element) || hidden(element, style)) continue;
        while ((occupancy[column] ?? 0) > 0) column++;

        const colSpan = Math.max(1, element.colSpan || 1);
        const rowSpan = Math.max(1, element.rowSpan || 1);
        const isHeadCell = element.tagName === "TH";
        const cell: TableCell = { text: normalizeText(cellText(element)) };
        if (colSpan > 1) cell.colSpan = colSpan;
        if (rowSpan > 1) cell.rowSpan = rowSpan;

        let explicitAlign = false;
        if (useStyles) {
          const weight = Number.parseInt(style.fontWeight ?? "", 10);
          const bold = style.fontWeight === "bold" || (Number.isFinite(weight) && weight >= 600);
          if (bold || isHeadCell) cell.bold = bold || isHeadCell;
          if (style.fontStyle === "italic" || style.fontStyle === "oblique") cell.italic = true;

          const color = paint(style.color);
          if (color) cell.color = color;
          const fill = paint(style.backgroundColor);
          if (fill) cell.fill = fill;

          const size = px(style.fontSize, scale);
          if (size > 0) cell.fontSize = size;

          const padX = (px(style.paddingLeft, scale) + px(style.paddingRight, scale)) / 2;
          const padY = (px(style.paddingTop, scale) + px(style.paddingBottom, scale)) / 2;
          if (padX > 0 || padY > 0) cell.padding = { x: padX, y: padY };

          const borders: CellBorders = {
            top: side(style, "Top", scale),
            right: side(style, "Right", scale),
            bottom: side(style, "Bottom", scale),
            left: side(style, "Left", scale),
          };
          if (borders.top || borders.right || borders.bottom || borders.left) {
            cell.borders = borders;
          } else if (styleOf) {
            // An explicit "no borders anywhere" must survive too, otherwise
            // the table-wide default would draw lines CSS removed.
            cell.borders = {};
          }

          const align = alignOf(style.textAlign);
          if (align) {
            cell.align = align;
            explicitAlign = true;
          } else if (isHeadCell) {
            cell.align = "center";
            explicitAlign = true;
          }
          const valign = style.verticalAlign;
          if (valign === "top" || valign === "middle" || valign === "bottom") cell.valign = valign;
        } else if (isHeadCell) {
          cell.bold = true;
        }

        const rect = (element as HTMLElement).getBoundingClientRect?.();
        const width = rect && rect.width > 0 ? rect.width * scale : 0;
        meta.push({ cell, column, colSpan, width, explicitAlign });
        cells.push(cell);

        if (rowSpan > 1) {
          for (let c = column; c < column + colSpan; c++) occupancy[c] = rowSpan;
        }
        column += colSpan;
      }
      for (let c = 0; c < occupancy.length; c++) {
        if ((occupancy[c] ?? 0) > 0) occupancy[c]!--;
      }
      if (cells.length === 0) continue;
      rows.push(cells);
      readRows.push(meta);
      kinds.push(section.kind);
    }
  }

  if (rows.length === 0) {
    throw new FastPDFError("The table has no rows to render", "NO_TABLE");
  }

  const columns = readRows.reduce(
    (max, row) =>
      Math.max(
        max,
        row.reduce((n, c) => n + c.colSpan, 0),
      ),
    0,
  );

  // Column widths: the browser already solved this layout, so take its
  // answer. Only single-column cells are evidence; a spanning cell says
  // nothing about where the split between its columns belongs.
  const widths = new Array<number>(columns).fill(0);
  for (const row of readRows) {
    for (const cell of row) {
      if (cell.colSpan === 1 && cell.column < columns) {
        widths[cell.column] = Math.max(widths[cell.column]!, cell.width);
      }
    }
  }
  // Minimum width: per column, the widest unbreakable word plus its padding.
  // Measured with Helvetica, which is close enough for the yes/no decision
  // about page orientation.
  const minPerColumn = new Array<number>(columns).fill(0);
  for (const row of readRows) {
    for (const entry of row) {
      if (entry.colSpan !== 1 || entry.column >= columns) continue;
      const cell = entry.cell;
      const size = cell.fontSize ?? 11;
      const pad = cell.padding;
      const padX = pad === undefined ? 6 : typeof pad === "number" ? pad : pad.x;
      const font = resolveFont("helvetica", cell.bold ?? false, cell.italic ?? false);
      let widest = 0;
      for (const word of (cell.text ?? "").split(/\s+/)) {
        if (word !== "") widest = Math.max(widest, font.widthOf(word, size));
      }
      minPerColumn[entry.column] = Math.max(minPerColumn[entry.column]!, widest + 2 * padX);
    }
  }
  const minWidth = minPerColumn.reduce((a, b) => a + b, 0);

  // What is behind the table? A cell without its own background shows this
  // through in the browser, so the PDF page has to carry it or the same cell
  // would end up on white paper.
  let background: string | undefined;
  let inkColor: string | undefined;
  if (useStyles && styleOf) {
    let current: Element | null = table;
    while (current && background === undefined) {
      background = paint(read(current).backgroundColor);
      current = current.parentElement;
    }
    inkColor = paint(read(table).color);
  }

  const tableRect = (table as HTMLElement).getBoundingClientRect?.();
  const tableWidth =
    tableRect && tableRect.width > 0 ? tableRect.width * (options.scale ?? DEFAULT_SCALE) : 0;

  // Numeric columns: right-aligned unless the CSS already said otherwise.
  const numericColumns = new Array<boolean>(columns).fill(true);
  let bodySeen = false;
  readRows.forEach((row, index) => {
    if (kinds[index] !== "body") return;
    bodySeen = true;
    for (const cell of row) {
      if (cell.colSpan !== 1 || cell.column >= columns) continue;
      if (cell.explicitAlign || !looksNumeric(cell.cell.text ?? "")) {
        numericColumns[cell.column] = false;
      }
    }
  });

  return {
    rows,
    columns,
    hasHeader: kinds[0] === "head",
    hasFooter: kinds[kinds.length - 1] === "foot",
    widths,
    tableWidth,
    minWidth,
    numericColumns: bodySeen ? numericColumns : new Array<boolean>(columns).fill(false),
    background,
    inkColor,
  };
}

/* --------------------------------------------------------------- building */

/** The text column width of a page with these settings, in points. */
function contentWidth(
  format: PageFormatName | PageSize,
  landscape: boolean,
  margins: Margins,
): number {
  return new PDFDocument({ format, landscape, margins }).width;
}

function resolveMargins(input: number | Partial<Margins> | undefined): Margins {
  if (typeof input === "number") return { top: input, right: input, bottom: input, left: input };
  return {
    top: input?.top ?? 40,
    right: input?.right ?? 40,
    bottom: input?.bottom ?? 40,
    left: input?.left ?? 40,
  };
}

/** Turn the reading into the options `table()` expects. */
function buildTableOptions(
  read: ReadTable,
  options: TablePDFOptions,
  available?: number,
): TableOptions {
  const sum = read.widths.reduce((a, b) => a + b, 0);
  const widths =
    available !== undefined && available > 0 && sum > 0
      ? read.widths.map((w) => (w / sum) * available)
      : undefined;
  const aligns: TextAlign[] = read.numericColumns.map((numeric) => (numeric ? "right" : "left"));
  return {
    header: read.hasHeader,
    footer: read.hasFooter,
    aligns,
    ...(widths ? { widths } : {}),
    // Cells carry their own CSS borders; the table-wide rectangle would
    // double every line that CSS already drew.
    ...(options.styles === false ? {} : { borderWidth: 0 }),
    ...options.table,
  };
}

/**
 * Read a table off the page without rendering it — the rows and the
 * matching `table()` options, ready to drop into a document you are
 * already building.
 *
 * ```ts
 * const { rows, options, background } = tableToRows("#revenue", { width: pdf.width });
 * if (background) pdf.pageBackground(background);
 * pdf.text("Revenue", { bold: true });
 * pdf.table(rows, options);
 * ```
 *
 * `background` is the surface the table sits on and `inkColor` its text
 * colour — both undefined when the CSS reading is off or the page has
 * neither.
 */
export function tableToRows(
  source: TableSource,
  options: TablePDFOptions & { width?: number } = {},
): {
  rows: TableCell[][];
  options: TableOptions;
  background?: string;
  inkColor?: string;
} {
  const table = resolveTable(source, "tableToRows()");
  const read = readTable(table, options);
  return {
    rows: read.rows,
    options: buildTableOptions(read, options, options.width),
    ...(read.background !== undefined ? { background: read.background } : {}),
    ...(read.inkColor !== undefined ? { inkColor: read.inkColor } : {}),
  };
}

/**
 * Render an HTML table into a PDF document.
 *
 * ```ts
 * const pdf = tableToPDF("#revenue", {
 *   title: "Revenue 2026",
 *   header: "Acme GmbH",
 *   footer: "Confidential",
 *   pageNumbers: true,
 * });
 * await pdf.save("revenue.pdf");
 * ```
 *
 * The returned document is a normal `PDFDocument` — keep drawing on it,
 * append pages, encrypt or sign it before saving.
 */
export function tableToPDF(source: TableSource, options: TablePDFOptions = {}): PDFDocument {
  const table = resolveTable(source, "tableToPDF()");
  const read = readTable(table, options);
  const margins = resolveMargins(options.margins);
  const format = options.format ?? "A4";

  // Orientation: turn the page only when the table cannot be squeezed into
  // the portrait text column without breaking words apart. The rendered CSS
  // width is no guide here — it says how wide the container is, not how wide
  // the content needs to be, so a 900 px layout table would turn every page.
  let landscape = options.orientation === "landscape";
  if (options.orientation === undefined || options.orientation === "auto") {
    landscape = read.minWidth > contentWidth(format, false, margins);
  }

  const pdf = new PDFDocument({
    format,
    landscape,
    margins,
    metadata: { title: options.title, ...options.metadata },
  });

  // The surface the table sits on, before anything is drawn over it.
  const background =
    options.background === false
      ? undefined
      : options.background === undefined || options.background === "auto"
        ? // White paper is already white; painting it again only adds bytes.
          read.background === "#ffffff"
          ? undefined
          : read.background
        : options.background;
  if (background !== undefined) pdf.pageBackground(background);

  if (options.header !== undefined) pdf.header(options.header, options.headerOptions);
  if (options.footer !== undefined) pdf.footer(options.footer, options.footerOptions);
  if (options.pageNumbers) {
    pdf.pageNumbers(options.pageNumbers === true ? {} : options.pageNumbers);
  }
  if (options.title !== undefined) {
    // The heading follows the table's own text colour, so it stays readable
    // on a dark page instead of being black on near-black.
    pdf.text(options.title, {
      size: 16,
      bold: true,
      spacingAfter: 10,
      ...(read.inkColor !== undefined ? { color: read.inkColor } : {}),
    });
  }
  // Widths keep the browser's proportions and fill the text column.
  pdf.table(read.rows, buildTableOptions(read, options, pdf.width));
  return pdf;
}

/* -------------------------------------------------------------- downloading */

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "table" : slug;
}

function filenameFor(table: HTMLTableElement, options: TablePdfButtonOptions): string {
  if (options.filename) return options.filename;
  if (options.title) return `${slugify(options.title)}.pdf`;
  if (table.id) return `${slugify(table.id)}.pdf`;
  return "table.pdf";
}

/**
 * Render the table and hand the browser the file — the whole feature in
 * one call, for a button you wired yourself.
 */
export async function downloadTablePDF(
  source: TableSource,
  options: TablePdfButtonOptions = {},
): Promise<void> {
  const table = resolveTable(source, "downloadTablePDF()");
  const pdf = tableToPDF(table, options);
  await pdf.save(filenameFor(table, options));
}

export interface TablePdfButtonOptions extends TablePDFOptions {
  /** Wire this element instead of creating a button. */
  button?: HTMLElement;
  /**
   * Visible caption. Default: "Download PDF" — unless `icon` is set, which
   * makes the button icon-only.
   */
  label?: string;
  /**
   * Show an icon: `true` for the built-in download glyph, or your own markup
   * (an inline `<svg>`, a `<span>` carrying an icon font). Combined with
   * `label` the icon sits in front of the text; on its own the button is
   * icon-only and takes its accessible name from `ariaLabel`.
   *
   * The markup is inserted as given — pass your own icon, never a string
   * that came from a user.
   */
  icon?: boolean | string;
  /** Accessible name for an icon-only button. Default: "Download PDF". */
  ariaLabel?: string;
  /** Output file name. Default: from `title`, the table's id, or "table.pdf". */
  filename?: string;
  /**
   * Where the created button goes — an element or a CSS selector. Default:
   * the table itself, so the button lands right next to it.
   */
  mount?: string | HTMLElement;
  /**
   * How the button is placed relative to `mount`: as its sibling
   * (`"after"`, `"before"`), inside it (`"append"`, `"prepend"`), or in one
   * of its four corners.
   *
   * A corner puts the button in a flex row — `<div class=
   * "fast-pdf-download-row">` — that sits above or below the table and
   * pushes the button to the left or right edge. That row is the one place
   * this helper writes inline CSS, because aligning is the whole point of
   * the option; everything else stays a class for your stylesheet.
   *
   * Default: `"after"` next to the table, `"append"` into a `mount` you named.
   */
  position?:
    | "after"
    | "before"
    | "append"
    | "prepend"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";
  /** Class on the created button. Default: "fast-pdf-download". */
  className?: string;
  /** Called when rendering fails. Default: `console.error`. */
  onError?: (error: unknown) => void;
}

/** The built-in glyph: a sheet with a download arrow, drawn in currentColor. */
const DOWNLOAD_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M8 1.75v7.5" /><path d="M4.75 6.5 8 9.75 11.25 6.5" />' +
  '<path d="M2.75 11.25v1.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5" />' +
  "</svg>";

/** Corner → which side of the anchor, and which edge to push the button to. */
const CORNERS: Record<string, { side: "before" | "after"; justify: string }> = {
  "top-left": { side: "before", justify: "flex-start" },
  "top-right": { side: "before", justify: "flex-end" },
  "bottom-left": { side: "after", justify: "flex-start" },
  "bottom-right": { side: "after", justify: "flex-end" },
};

/** Place a node as a sibling of, or inside, the anchor. */
function place(node: Element, anchor: Element, how: string): void {
  if (how === "append") {
    anchor.append(node);
    return;
  }
  if (how === "prepend") {
    anchor.prepend(node);
    return;
  }
  const parent = anchor.parentElement;
  if (!parent) {
    // Nothing to be a sibling of — inside is the only place left.
    anchor.append(node);
    return;
  }
  parent.insertBefore(node, how === "before" ? anchor : anchor.nextSibling);
}

/**
 * Resolve where a created button is placed, put it there, and return the
 * outermost node that was added — what `destroy()` has to take away again.
 */
function mountButton(
  element: HTMLElement,
  table: HTMLTableElement,
  options: TablePdfButtonOptions,
): HTMLElement {
  let target: Element = table;
  if (options.mount !== undefined) {
    const found =
      typeof options.mount === "string" ? document.querySelector(options.mount) : options.mount;
    if (!found) {
      throw new FastPDFError(
        `attachTablePdfButton(): no element matches mount "${String(options.mount)}"`,
        "INVALID_ARGUMENT",
      );
    }
    target = found;
  }

  const position = options.position ?? (options.mount === undefined ? "after" : "append");
  const corner = CORNERS[position];
  if (!corner) {
    place(element, target, position);
    return element;
  }

  const row = document.createElement("div");
  row.className = "fast-pdf-download-row";
  row.style.display = "flex";
  row.style.justifyContent = corner.justify;
  row.append(element);
  // Above/below the table when it is the anchor; inside a container the
  // caller named, since "top" of a toolbar means its start, not above it.
  place(
    row,
    target,
    options.mount === undefined ? corner.side : corner.side === "before" ? "prepend" : "append",
  );
  return row;
}

export interface TablePdfButtonHandle {
  /** The wired element — the one passed in, or the one created. */
  button: HTMLElement;
  /** Remove the listener, and the button itself if this call created it. */
  destroy(): void;
}

/**
 * Put a working "Download PDF" button next to a table.
 *
 * ```ts
 * attachTablePdfButton("#revenue", {
 *   label: "Download PDF",
 *   title: "Revenue 2026",
 *   header: "Acme GmbH",
 *   pageNumbers: true,
 * });
 * ```
 *
 * The created button carries no inline styles — only the class, so the
 * page's own CSS dresses it. `mount` and `position` decide where it lands
 * (a toolbar, a card header, anywhere), `icon` makes it icon-only, and
 * `button` wires an element you built entirely yourself:
 *
 * ```ts
 * attachTablePdfButton("#revenue", {
 *   mount: "#toolbar", // into your toolbar instead of next to the table
 *   icon: true, // the built-in glyph, no caption
 *   ariaLabel: "Download revenue as PDF",
 * });
 * ```
 */
export function attachTablePdfButton(
  source: TableSource,
  options: TablePdfButtonOptions = {},
): TablePdfButtonHandle {
  const table = resolveTable(source, "attachTablePdfButton()");
  let created: HTMLElement | undefined;
  let button = options.button;

  if (!button) {
    if (typeof document === "undefined") {
      throw new FastPDFError(
        "attachTablePdfButton() needs a DOM to create a button — pass `button` instead",
        "NO_TABLE",
      );
    }
    const element = document.createElement("button");
    element.type = "button";
    element.className = options.className ?? "fast-pdf-download";

    if (options.icon) {
      element.innerHTML = options.icon === true ? DOWNLOAD_ICON : options.icon;
      // The glyph carries no meaning of its own — the button's name does.
      const glyph = element.firstElementChild;
      if (glyph) {
        glyph.setAttribute("aria-hidden", "true");
        glyph.setAttribute("focusable", "false");
      }
      if (options.label !== undefined) {
        const text = document.createElement("span");
        text.className = "fast-pdf-download-label";
        text.textContent = options.label;
        element.append(text);
      } else {
        // An icon-only button is invisible to a screen reader without this.
        element.setAttribute("aria-label", options.ariaLabel ?? "Download PDF");
        element.title = options.ariaLabel ?? "Download PDF";
      }
    } else {
      element.textContent = options.label ?? "Download PDF";
    }

    created = mountButton(element, table, options);
    button = element;
  }

  const onClick = (): void => {
    const target = button as HTMLButtonElement;
    const wasDisabled = target.disabled === true;
    target.disabled = true;
    target.setAttribute("aria-busy", "true");
    void downloadTablePDF(table, options)
      .catch((error: unknown) => {
        // Without an onError the failure would vanish silently — a dead
        // button with no explanation is the worst outcome here.
        // eslint-disable-next-line no-console
        (options.onError ?? ((e: unknown) => console.error(e)))(error);
      })
      .finally(() => {
        target.disabled = wasDisabled;
        target.removeAttribute("aria-busy");
      });
  };

  button.addEventListener("click", onClick);

  return {
    button,
    destroy(): void {
      button!.removeEventListener("click", onClick);
      created?.remove();
    },
  };
}
