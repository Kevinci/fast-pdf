/**
 * Glyph width tables for the standard 14 fonts (from the Adobe AFM files),
 * in 1/1000 of the font size.
 *
 * `ascii` covers characters 0x20–0x7E (index 0 = space). Widths for
 * WinAnsi bytes ≥ 0xA0 are resolved via `extras` (exact values for common
 * typographic characters) and, failing that, by stripping diacritics to a
 * base ASCII letter — accented glyphs share their base letter's advance
 * width in these fonts. Oblique/italic variants share the upright tables
 * except for Times-Italic/BoldItalic, which have their own.
 */

export interface FontMetrics {
  /** Widths for char codes 0x20–0x7E. */
  ascii: readonly number[];
  /** Exact widths for selected WinAnsi bytes (0x80–0xFF). */
  extras: Readonly<Record<number, number>>;
  /** Fallback width for unmapped bytes. */
  fallback: number;
  ascent: number;
  descent: number;
}

// prettier-ignore
const HELVETICA_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
] as const;

// prettier-ignore
const HELVETICA_BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
] as const;

// prettier-ignore
const TIMES_ASCII = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
  921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
  556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
  333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
  500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
] as const;

// prettier-ignore
const TIMES_BOLD_ASCII = [
  250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500,
  930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778,
  611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500,
  333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500,
  556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520,
] as const;

// prettier-ignore
const TIMES_ITALIC_ASCII = [
  250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500,
  920, 611, 611, 667, 722, 611, 611, 722, 722, 333, 444, 667, 556, 833, 667, 722,
  611, 722, 611, 500, 556, 722, 611, 833, 611, 556, 556, 389, 278, 389, 422, 500,
  333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444, 278, 722, 500, 500,
  500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389, 400, 275, 400, 541,
] as const;

// prettier-ignore
const TIMES_BOLD_ITALIC_ASCII = [
  250, 389, 555, 500, 500, 833, 778, 278, 333, 333, 500, 570, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500,
  832, 667, 667, 667, 722, 667, 667, 722, 778, 389, 500, 667, 611, 889, 722, 722,
  611, 722, 667, 556, 611, 722, 667, 889, 667, 611, 611, 333, 278, 333, 570, 500,
  333, 500, 500, 444, 500, 444, 333, 500, 556, 278, 278, 500, 278, 778, 556, 500,
  500, 500, 389, 389, 278, 556, 444, 667, 500, 444, 389, 348, 220, 348, 570,
] as const;

const COURIER_ASCII: readonly number[] = new Array(95).fill(600);

/**
 * Widths for common typographic WinAnsi bytes.
 * Keys are WinAnsi byte values.
 */
function typographicExtras(m: {
  euro: number; ellipsis: number; bullet: number; endash: number; emdash: number;
  quoteSingle: number; quoteDouble: number; quoteLow: number; quoteDblLow: number;
  trademark: number; guilSingle: number; guilDouble: number; degree: number;
  middot: number; germandbls: number; ae: number; AE: number; oe: number; OE: number;
}): Record<number, number> {
  return {
    0x80: m.euro,
    0x82: m.quoteLow, 0x84: m.quoteDblLow, 0x85: m.ellipsis,
    0x8b: m.guilSingle, 0x9b: m.guilSingle,
    0x8c: m.OE, 0x9c: m.oe,
    0x91: m.quoteSingle, 0x92: m.quoteSingle,
    0x93: m.quoteDouble, 0x94: m.quoteDouble,
    0x95: m.bullet, 0x96: m.endash, 0x97: m.emdash, 0x99: m.trademark,
    0xa0: 0, // set per font to space width below
    0xab: m.guilDouble, 0xbb: m.guilDouble,
    0xb0: m.degree, 0xb7: m.middot,
    0xc6: m.AE, 0xe6: m.ae,
    0xdf: m.germandbls,
  };
}

/**
 * Base-letter map for accented Latin-1 bytes (0xC0–0xFF): accented glyphs
 * have the same advance width as their base letter in the standard fonts.
 */
const LATIN1_BASE: Record<number, string> = {};
function mapRange(from: number, to: number, base: string) {
  for (let b = from; b <= to; b++) LATIN1_BASE[b] = base;
}
mapRange(0xc0, 0xc5, "A"); LATIN1_BASE[0xc7] = "C";
mapRange(0xc8, 0xcb, "E"); mapRange(0xcc, 0xcf, "I");
LATIN1_BASE[0xd0] = "D"; LATIN1_BASE[0xd1] = "N";
mapRange(0xd2, 0xd6, "O"); LATIN1_BASE[0xd7] = "+"; LATIN1_BASE[0xd8] = "O";
mapRange(0xd9, 0xdc, "U"); LATIN1_BASE[0xdd] = "Y"; LATIN1_BASE[0xde] = "P";
mapRange(0xe0, 0xe5, "a"); LATIN1_BASE[0xe7] = "c";
mapRange(0xe8, 0xeb, "e"); mapRange(0xec, 0xef, "i");
LATIN1_BASE[0xf0] = "o"; LATIN1_BASE[0xf1] = "n";
mapRange(0xf2, 0xf6, "o"); LATIN1_BASE[0xf7] = "+"; LATIN1_BASE[0xf8] = "o";
mapRange(0xf9, 0xfc, "u"); LATIN1_BASE[0xfd] = "y"; LATIN1_BASE[0xfe] = "p";
LATIN1_BASE[0xff] = "y"; LATIN1_BASE[0x9f] = "Y"; // Ÿ
LATIN1_BASE[0x8a] = "S"; LATIN1_BASE[0x9a] = "s"; // Š š
LATIN1_BASE[0x8e] = "Z"; LATIN1_BASE[0x9e] = "z"; // Ž ž
LATIN1_BASE[0xa1] = "!"; LATIN1_BASE[0xbf] = "?"; // ¡ ¿

function makeMetrics(
  ascii: readonly number[],
  extras: Record<number, number>,
  ascent: number,
  descent: number,
): FontMetrics {
  extras[0xa0] = ascii[0]!; // nbsp = space
  return { ascii, extras, fallback: ascii[0]!, ascent, descent };
}

/** Width in 1/1000 em for one WinAnsi byte. */
export function widthOfByte(metrics: FontMetrics, byte: number): number {
  if (byte >= 0x20 && byte <= 0x7e) return metrics.ascii[byte - 0x20]!;
  const exact = metrics.extras[byte];
  if (exact !== undefined) return exact;
  const base = LATIN1_BASE[byte];
  if (base !== undefined) {
    const code = base.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) return metrics.ascii[code - 0x20]!;
  }
  return metrics.fallback;
}

export const METRICS = {
  Helvetica: makeMetrics(HELVETICA_ASCII, typographicExtras({
    euro: 556, ellipsis: 1000, bullet: 350, endash: 556, emdash: 1000,
    quoteSingle: 222, quoteDouble: 333, quoteLow: 222, quoteDblLow: 333,
    trademark: 1000, guilSingle: 333, guilDouble: 556, degree: 400,
    middot: 278, germandbls: 611, ae: 889, AE: 1000, oe: 944, OE: 1000,
  }), 718, -207),
  "Helvetica-Bold": makeMetrics(HELVETICA_BOLD_ASCII, typographicExtras({
    euro: 556, ellipsis: 1000, bullet: 350, endash: 556, emdash: 1000,
    quoteSingle: 278, quoteDouble: 500, quoteLow: 278, quoteDblLow: 500,
    trademark: 1000, guilSingle: 333, guilDouble: 556, degree: 400,
    middot: 278, germandbls: 611, ae: 889, AE: 1000, oe: 944, OE: 1000,
  }), 718, -207),
  "Times-Roman": makeMetrics(TIMES_ASCII, typographicExtras({
    euro: 500, ellipsis: 1000, bullet: 350, endash: 500, emdash: 1000,
    quoteSingle: 333, quoteDouble: 444, quoteLow: 333, quoteDblLow: 444,
    trademark: 980, guilSingle: 333, guilDouble: 500, degree: 400,
    middot: 250, germandbls: 500, ae: 667, AE: 889, oe: 722, OE: 889,
  }), 683, -217),
  "Times-Bold": makeMetrics(TIMES_BOLD_ASCII, typographicExtras({
    euro: 500, ellipsis: 1000, bullet: 350, endash: 500, emdash: 1000,
    quoteSingle: 333, quoteDouble: 500, quoteLow: 333, quoteDblLow: 500,
    trademark: 1000, guilSingle: 333, guilDouble: 500, degree: 400,
    middot: 250, germandbls: 556, ae: 722, AE: 1000, oe: 722, OE: 1000,
  }), 683, -217),
  "Times-Italic": makeMetrics(TIMES_ITALIC_ASCII, typographicExtras({
    euro: 500, ellipsis: 889, bullet: 350, endash: 500, emdash: 889,
    quoteSingle: 333, quoteDouble: 556, quoteLow: 333, quoteDblLow: 556,
    trademark: 980, guilSingle: 333, guilDouble: 500, degree: 400,
    middot: 250, germandbls: 500, ae: 667, AE: 889, oe: 667, OE: 944,
  }), 683, -217),
  "Times-BoldItalic": makeMetrics(TIMES_BOLD_ITALIC_ASCII, typographicExtras({
    euro: 500, ellipsis: 1000, bullet: 350, endash: 500, emdash: 1000,
    quoteSingle: 333, quoteDouble: 500, quoteLow: 333, quoteDblLow: 500,
    trademark: 1000, guilSingle: 333, guilDouble: 500, degree: 400,
    middot: 250, germandbls: 500, ae: 722, AE: 944, oe: 722, OE: 944,
  }), 683, -217),
  Courier: makeMetrics(COURIER_ASCII, typographicExtras({
    euro: 600, ellipsis: 600, bullet: 600, endash: 600, emdash: 600,
    quoteSingle: 600, quoteDouble: 600, quoteLow: 600, quoteDblLow: 600,
    trademark: 600, guilSingle: 600, guilDouble: 600, degree: 600,
    middot: 600, germandbls: 600, ae: 600, AE: 600, oe: 600, OE: 600,
  }), 629, -157),
} as const;

export type StandardFontName =
  | keyof typeof METRICS
  | "Helvetica-Oblique"
  | "Helvetica-BoldOblique"
  | "Courier-Bold"
  | "Courier-Oblique"
  | "Courier-BoldOblique";

/** Oblique and Courier variants share their upright/regular metrics. */
export function metricsFor(name: StandardFontName): FontMetrics {
  switch (name) {
    case "Helvetica-Oblique":
      return METRICS.Helvetica;
    case "Helvetica-BoldOblique":
      return METRICS["Helvetica-Bold"];
    case "Courier-Bold":
    case "Courier-Oblique":
    case "Courier-BoldOblique":
      return METRICS.Courier;
    default:
      return METRICS[name];
  }
}
