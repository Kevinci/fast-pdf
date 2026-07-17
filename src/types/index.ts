/** Shared public types. Pure data — no platform APIs. */

import { FastPDFError } from "../errors";

/** A color: hex string ("#rgb", "#rrggbb"), or RGB components 0–255. */
export type ColorInput = string | { r: number; g: number; b: number };

/** Normalized color with components in 0–1 (PDF color space). */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type FontFamily = "helvetica" | "times" | "courier";

export type TextAlign = "left" | "center" | "right" | "justify";

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Page size in PDF points (1 pt = 1/72 inch). */
export interface PageSize {
  width: number;
  height: number;
}

export type PageFormatName = "A3" | "A4" | "A5" | "Letter" | "Legal";

export const PAGE_FORMATS: Record<PageFormatName, PageSize> = {
  A3: { width: 841.89, height: 1190.55 },
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
};

export interface TextStyle {
  /** Standard family or a family name registered via registerFont(). */
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: RGB;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  align: TextAlign;
  underline: boolean;
  strikethrough: boolean;
  /** Extra spacing between characters in points. */
  letterSpacing: number;
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  /** Fixed creation date — set explicitly for reproducible output. */
  creationDate?: Date;
}

export function normalizeMargins(m: number | Partial<Margins> | undefined, fallback: number): Margins {
  if (typeof m === "number") return { top: m, right: m, bottom: m, left: m };
  return {
    top: m?.top ?? fallback,
    right: m?.right ?? fallback,
    bottom: m?.bottom ?? fallback,
    left: m?.left ?? fallback,
  };
}

/** Parse a user-facing color into normalized 0–1 RGB. */
export function parseColor(input: ColorInput): RGB {
  if (typeof input === "object") {
    return { r: clamp01(input.r / 255), g: clamp01(input.g / 255), b: clamp01(input.b / 255) };
  }
  let hex = input.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new FastPDFError(`Invalid color: "${input}" (expected "#rgb", "#rrggbb" or {r,g,b})`, "INVALID_COLOR");
  }
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
  };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export const BLACK: RGB = { r: 0, g: 0, b: 0 };
