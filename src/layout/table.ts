import { wrapText } from "./text";
import type { Font } from "../fonts/font";
import type { PDFDocument } from "../document/document";
import type { ColorInput, TextAlign } from "../types/index";
import { FastPDFError } from "../errors";

/**
 * Table layout: pure measurement. Painting and page breaking are the
 * document layer's job — this module computes column widths, resolves
 * colSpan/rowSpan into positioned cells, wraps cell text and derives row
 * heights, so the caller can decide where pages break and re-run the header.
 */

export type CellValue = string | number | TableCell;

/** Vertical placement of a cell's content within its row. */
export type VerticalAlign = "top" | "middle" | "bottom";

/** The drawable area inside one cell, in top-left page coordinates. */
export interface CellBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TableCell {
  /** Cell text. Optional when `render` draws the cell instead. */
  text?: string;
  bold?: boolean;
  italic?: boolean;
  color?: ColorInput;
  fill?: ColorInput;
  align?: TextAlign;
  /** Vertical placement within the row. Default: the table's `valign`. */
  valign?: VerticalAlign;
  /**
   * Draw the cell's content yourself instead of rendering `text` — a
   * progress bar, a badge row, a logo. The callback receives the padded
   * inner box; use `doc.region(box, …)` for flow content inside it.
   * The row's height comes from `height` (or, without it, from the
   * measured content).
   */
  render?: (doc: PDFDocument, box: CellBox) => void;
  /** Fixed content height in points for a `render` cell (skips measuring). */
  height?: number;
  /** Number of grid columns this cell spans. Default: 1. */
  colSpan?: number;
  /** Number of rows this cell spans. Default: 1. */
  rowSpan?: number;
}

export interface TableOptions {
  /** Column widths in points; scaled proportionally if they exceed the available width. Default: equal. */
  widths?: number[];
  /** Treat the first row as a repeating, styled header. Default: true. */
  header?: boolean;
  /** Treat the last row as a styled footer (drawn once, never repeated). Default: false. */
  footer?: boolean;
  fontSize?: number;
  /** Cell padding in points. */
  padding?: number;
  borderWidth?: number;
  borderColor?: ColorInput;
  headerFill?: ColorInput;
  headerColor?: ColorInput;
  /** Fill for the footer row. Default: same as headerFill. */
  footerFill?: ColorInput;
  /** Fill for every other body row (zebra striping). */
  zebraFill?: ColorInput;
  /** Per-column text alignment. */
  aligns?: TextAlign[];
  /** Vertical placement of cell content within its row. Default: "top". */
  valign?: VerticalAlign;
  lineHeight?: number;
}

export interface MeasuredCell {
  cell: TableCell;
  lines: string[];
  align: TextAlign;
  valign: VerticalAlign;
  /** X offset from the table's left edge. */
  x: number;
  /** Total width in points, including spanned columns. */
  width: number;
  rowSpan: number;
  /** Painted height: this row's height, or the sum of all spanned rows. */
  height: number;
  /** Height of the cell's own content, excluding padding. */
  contentHeight: number;
}

export interface MeasuredRow {
  cells: MeasuredCell[];
  height: number;
  isHeader: boolean;
  isFooter: boolean;
  /** True when a rowSpan continues past this row — no page break after it. */
  keepWithNext: boolean;
}

export function normalizeCell(value: CellValue): TableCell {
  if (typeof value === "string") return { text: value };
  if (typeof value === "number") return { text: String(value) };
  return value;
}

/** Distribute the available width over columns. */
export function columnWidths(available: number, columns: number, requested?: number[]): number[] {
  if (!requested || requested.length === 0) {
    return new Array(columns).fill(available / columns);
  }
  if (requested.length !== columns) {
    throw new FastPDFError(
      `Table has ${columns} columns but "widths" has ${requested.length} entries`,
      "INVALID_ARGUMENT",
    );
  }
  const sum = requested.reduce((a, b) => a + b, 0);
  const scale = sum > available ? available / sum : 1;
  return requested.map((w) => w * scale);
}

/** Number of grid columns the table occupies, honoring colSpan. */
export function countColumns(rows: CellValue[][]): number {
  let max = 0;
  for (const row of rows) {
    let n = 0;
    for (const value of row) n += Math.max(1, normalizeCell(value).colSpan ?? 1);
    max = Math.max(max, n);
  }
  return max;
}

export interface MeasureTableOptions {
  hasHeader: boolean;
  hasFooter: boolean;
  fontSize: number;
  padding: number;
  lineHeight: number;
  resolveFont: (bold: boolean, italic: boolean) => Font;
  aligns?: TextAlign[];
  valign?: VerticalAlign;
  /** Height of a `render` cell's content, measured by the document layer. */
  measureRender?: (cell: TableCell, innerWidth: number) => number;
}

/**
 * Measure a whole table: place cells on the column grid (skipping slots
 * blocked by active rowSpans), wrap text, derive row heights, and grow
 * spanned rows when a rowSpan cell needs more room than its rows provide.
 */
export function measureTable(
  rows: CellValue[][],
  widths: number[],
  opts: MeasureTableOptions,
): MeasuredRow[] {
  const columns = widths.length;
  const xOf: number[] = [0];
  for (const w of widths) xOf.push(xOf[xOf.length - 1]! + w);

  /** Per column: how many rows (including the current) an active rowSpan still covers. */
  const occupancy = new Array<number>(columns).fill(0);
  const measured: MeasuredRow[] = [];

  rows.forEach((row, rowIndex) => {
    const isHeader = opts.hasHeader && rowIndex === 0;
    const isFooter = opts.hasFooter && rowIndex === rows.length - 1;
    const cells: MeasuredCell[] = [];
    let col = 0;
    for (const value of row) {
      while (col < columns && occupancy[col]! > 0) col++;
      if (col >= columns) {
        throw new FastPDFError(
          `Table row ${rowIndex + 1} has more cells than available columns (${columns})`,
          "INVALID_ARGUMENT",
        );
      }
      const cell = normalizeCell(value);
      const colSpan = Math.max(1, Math.min(cell.colSpan ?? 1, columns - col));
      const rowSpan = Math.max(1, Math.min(cell.rowSpan ?? 1, rows.length - rowIndex));
      const width = xOf[col + colSpan]! - xOf[col]!;
      const font = opts.resolveFont(cell.bold ?? (isHeader || isFooter), cell.italic ?? false);
      const innerWidth = Math.max(1, width - 2 * opts.padding);
      const lines = cell.render ? [] : wrapText(cell.text ?? "", font, opts.fontSize, innerWidth);
      const contentHeight = cell.render
        ? (cell.height ?? opts.measureRender?.(cell, innerWidth) ?? 0)
        : lines.length * opts.fontSize * opts.lineHeight;
      cells.push({
        cell,
        lines,
        align: cell.align ?? opts.aligns?.[col] ?? "left",
        valign: cell.valign ?? opts.valign ?? "top",
        x: xOf[col]!,
        width,
        rowSpan,
        height: 0,
        contentHeight,
      });
      if (rowSpan > 1) {
        for (let c = col; c < col + colSpan; c++) occupancy[c] = rowSpan;
      }
      col += colSpan;
    }
    // Height from cells that end in this row; spanning cells are handled below.
    const own = cells.filter((c) => c.rowSpan === 1).map((c) => c.contentHeight);
    const minRow = opts.fontSize * opts.lineHeight; // never collapse below one line
    const maxContent = Math.max(minRow, ...own);
    for (let c = 0; c < columns; c++) if (occupancy[c]! > 0) occupancy[c]!--;
    measured.push({
      cells,
      height: maxContent + 2 * opts.padding,
      isHeader,
      isFooter,
      keepWithNext: occupancy.some((o) => o > 0),
    });
  });

  // Grow rows when a rowSpan cell needs more height than its rows provide,
  // then freeze each cell's painted height.
  measured.forEach((row, i) => {
    for (const cell of row.cells) {
      if (cell.rowSpan <= 1) continue;
      const need = cell.contentHeight + 2 * opts.padding;
      const spanned = measured.slice(i, i + cell.rowSpan);
      const sum = spanned.reduce((a, r) => a + r.height, 0);
      if (need > sum) spanned[spanned.length - 1]!.height += need - sum;
    }
  });
  measured.forEach((row, i) => {
    for (const cell of row.cells) {
      cell.height =
        cell.rowSpan <= 1
          ? row.height
          : measured.slice(i, i + cell.rowSpan).reduce((a, r) => a + r.height, 0);
    }
  });
  return measured;
}
