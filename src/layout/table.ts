import { wrapText } from "./text";
import type { Font } from "../fonts/font";
import type { ColorInput, TextAlign } from "../types/index";
import { FastPDFError } from "../errors";

/**
 * Table layout: pure measurement. Painting and page breaking are the
 * document layer's job — this module computes column widths, resolves
 * colSpan/rowSpan into positioned cells, wraps cell text and derives row
 * heights, so the caller can decide where pages break and re-run the header.
 */

export type CellValue = string | number | TableCell;

export interface TableCell {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: ColorInput;
  fill?: ColorInput;
  align?: TextAlign;
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
  lineHeight?: number;
}

export interface MeasuredCell {
  cell: TableCell;
  lines: string[];
  align: TextAlign;
  /** X offset from the table's left edge. */
  x: number;
  /** Total width in points, including spanned columns. */
  width: number;
  rowSpan: number;
  /** Painted height: this row's height, or the sum of all spanned rows. */
  height: number;
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
    throw new FastPDFError(`Table has ${columns} columns but "widths" has ${requested.length} entries`, "INVALID_ARGUMENT");
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
      cells.push({
        cell,
        lines: wrapText(cell.text, font, opts.fontSize, innerWidth),
        align: cell.align ?? opts.aligns?.[col] ?? "left",
        x: xOf[col]!,
        width,
        rowSpan,
        height: 0,
      });
      if (rowSpan > 1) {
        for (let c = col; c < col + colSpan; c++) occupancy[c] = rowSpan;
      }
      col += colSpan;
    }
    // Height from cells that end in this row; spanning cells are handled below.
    const ownLines = cells.filter((c) => c.rowSpan === 1).map((c) => c.lines.length);
    const maxLines = Math.max(1, ...ownLines);
    for (let c = 0; c < columns; c++) if (occupancy[c]! > 0) occupancy[c]!--;
    measured.push({
      cells,
      height: maxLines * opts.fontSize * opts.lineHeight + 2 * opts.padding,
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
      const need = cell.lines.length * opts.fontSize * opts.lineHeight + 2 * opts.padding;
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
