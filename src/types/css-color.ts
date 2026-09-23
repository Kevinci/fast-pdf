/**
 * CSS color parsing — everything `getComputedStyle()` can hand back.
 *
 * Browsers do not normalize computed colors to one syntax: a background
 * authored as `oklch(0.7 0.15 250)` comes back as `oklch(…)`, a legacy
 * stylesheet yields `rgb(…)`, and `color(display-p3 …)` survives verbatim.
 * Reading a table's real appearance therefore means understanding all of
 * them, so the parser lives here rather than in the DOM reader — it is pure
 * string and matrix work with no platform API in sight.
 *
 * Everything lands in sRGB, clipped to gamut. Alpha is reported but never
 * baked into the color: PDF keeps opacity in the graphics state, so the
 * caller decides what a translucent cell means.
 */

import type { RGB } from "./index";

export interface ParsedCssColor {
  rgb: RGB;
  /** 0–1. A fully transparent color reports 0 and keeps its components. */
  alpha: number;
}

/** The 148 CSS named colors, plus `transparent`, as packed hex triplets. */
const NAMED: Record<string, string> = {
  aliceblue: "f0f8ff",
  antiquewhite: "faebd7",
  aqua: "00ffff",
  aquamarine: "7fffd4",
  azure: "f0ffff",
  beige: "f5f5dc",
  bisque: "ffe4c4",
  black: "000000",
  blanchedalmond: "ffebcd",
  blue: "0000ff",
  blueviolet: "8a2be2",
  brown: "a52a2a",
  burlywood: "deb887",
  cadetblue: "5f9ea0",
  chartreuse: "7fff00",
  chocolate: "d2691e",
  coral: "ff7f50",
  cornflowerblue: "6495ed",
  cornsilk: "fff8dc",
  crimson: "dc143c",
  cyan: "00ffff",
  darkblue: "00008b",
  darkcyan: "008b8b",
  darkgoldenrod: "b8860b",
  darkgray: "a9a9a9",
  darkgreen: "006400",
  darkgrey: "a9a9a9",
  darkkhaki: "bdb76b",
  darkmagenta: "8b008b",
  darkolivegreen: "556b2f",
  darkorange: "ff8c00",
  darkorchid: "9932cc",
  darkred: "8b0000",
  darksalmon: "e9967a",
  darkseagreen: "8fbc8f",
  darkslateblue: "483d8b",
  darkslategray: "2f4f4f",
  darkslategrey: "2f4f4f",
  darkturquoise: "00ced1",
  darkviolet: "9400d3",
  deeppink: "ff1493",
  deepskyblue: "00bfff",
  dimgray: "696969",
  dimgrey: "696969",
  dodgerblue: "1e90ff",
  firebrick: "b22222",
  floralwhite: "fffaf0",
  forestgreen: "228b22",
  fuchsia: "ff00ff",
  gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff",
  gold: "ffd700",
  goldenrod: "daa520",
  gray: "808080",
  green: "008000",
  greenyellow: "adff2f",
  grey: "808080",
  honeydew: "f0fff0",
  hotpink: "ff69b4",
  indianred: "cd5c5c",
  indigo: "4b0082",
  ivory: "fffff0",
  khaki: "f0e68c",
  lavender: "e6e6fa",
  lavenderblush: "fff0f5",
  lawngreen: "7cfc00",
  lemonchiffon: "fffacd",
  lightblue: "add8e6",
  lightcoral: "f08080",
  lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3",
  lightgreen: "90ee90",
  lightgrey: "d3d3d3",
  lightpink: "ffb6c1",
  lightsalmon: "ffa07a",
  lightseagreen: "20b2aa",
  lightskyblue: "87cefa",
  lightslategray: "778899",
  lightslategrey: "778899",
  lightsteelblue: "b0c4de",
  lightyellow: "ffffe0",
  lime: "00ff00",
  limegreen: "32cd32",
  linen: "faf0e6",
  magenta: "ff00ff",
  maroon: "800000",
  mediumaquamarine: "66cdaa",
  mediumblue: "0000cd",
  mediumorchid: "ba55d3",
  mediumpurple: "9370db",
  mediumseagreen: "3cb371",
  mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc",
  mediumvioletred: "c71585",
  midnightblue: "191970",
  mintcream: "f5fffa",
  mistyrose: "ffe4e1",
  moccasin: "ffe4b5",
  navajowhite: "ffdead",
  navy: "000080",
  oldlace: "fdf5e6",
  olive: "808000",
  olivedrab: "6b8e23",
  orange: "ffa500",
  orangered: "ff4500",
  orchid: "da70d6",
  palegoldenrod: "eee8aa",
  palegreen: "98fb98",
  paleturquoise: "afeeee",
  palevioletred: "db7093",
  papayawhip: "ffefd5",
  peachpuff: "ffdab9",
  peru: "cd853f",
  pink: "ffc0cb",
  plum: "dda0dd",
  powderblue: "b0e0e6",
  purple: "800080",
  rebeccapurple: "663399",
  red: "ff0000",
  rosybrown: "bc8f8f",
  royalblue: "4169e1",
  saddlebrown: "8b4513",
  salmon: "fa8072",
  sandybrown: "f4a460",
  seagreen: "2e8b57",
  seashell: "fff5ee",
  sienna: "a0522d",
  silver: "c0c0c0",
  skyblue: "87ceeb",
  slateblue: "6a5acd",
  slategray: "708090",
  slategrey: "708090",
  snow: "fffafa",
  springgreen: "00ff7f",
  steelblue: "4682b4",
  tan: "d2b48c",
  teal: "008080",
  thistle: "d8bfd8",
  tomato: "ff6347",
  turquoise: "40e0d0",
  violet: "ee82ee",
  wheat: "f5deb3",
  white: "ffffff",
  whitesmoke: "f5f5f5",
  yellow: "ffff00",
  yellowgreen: "9acd32",
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Split the inside of a functional color into its arguments. */
function args(body: string): string[] {
  return body
    .replace(/\//g, " / ")
    .split(/[\s,]+/)
    .filter((t) => t !== "");
}

/**
 * One numeric component. `ref` scales percentages (255 for rgb, 1 for most
 * modern syntaxes, 100 for Lab lightness) and `none` counts as zero, as CSS
 * requires when a missing component is carried into another space.
 */
function num(token: string | undefined, ref: number): number {
  if (token === undefined || token === "none") return 0;
  if (token.endsWith("%")) return (Number.parseFloat(token) / 100) * ref;
  return Number.parseFloat(token);
}

/**
 * Alpha from the token after the slash — or, for the legacy comma forms
 * `rgba(r, g, b, a)` and `hsla(h, s, l, a)`, from the fourth argument.
 */
function alphaOf(tokens: string[], legacyIndex = -1): number {
  const slash = tokens.indexOf("/");
  if (slash !== -1) {
    return tokens[slash + 1] === undefined ? 1 : clamp01(num(tokens[slash + 1], 1));
  }
  if (legacyIndex >= 0 && tokens[legacyIndex] !== undefined) {
    return clamp01(num(tokens[legacyIndex], 1));
  }
  return 1;
}

function positional(tokens: string[]): string[] {
  const slash = tokens.indexOf("/");
  return slash === -1 ? tokens : tokens.slice(0, slash);
}

/** Degrees from an angle token (deg, grad, rad, turn or bare number). */
function angle(token: string | undefined): number {
  if (token === undefined || token === "none") return 0;
  const value = Number.parseFloat(token);
  if (token.endsWith("grad")) return value * 0.9;
  if (token.endsWith("rad")) return (value * 180) / Math.PI;
  if (token.endsWith("turn")) return value * 360;
  return value;
}

const srgbFromLinear = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

function linearSrgbToRgb(r: number, g: number, b: number): RGB {
  return {
    r: clamp01(srgbFromLinear(r)),
    g: clamp01(srgbFromLinear(g)),
    b: clamp01(srgbFromLinear(b)),
  };
}

/** OKLab → linear sRGB (Björn Ottosson's matrices). */
function oklabToRgb(L: number, a: number, b: number): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return linearSrgbToRgb(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  );
}

/** CIE Lab (D50, as CSS specifies) → sRGB, Bradford-adapted to D65. */
function labToRgb(L: number, a: number, bb: number): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const e = 216 / 24389;
  const k = 24389 / 27;
  const f3 = (t: number): number => (t ** 3 > e ? t ** 3 : (116 * t - 16) / k);
  // D50 white point.
  const x = f3(fx) * 0.9642956764295677;
  const y = (L > k * e ? ((L + 16) / 116) ** 3 : L / k) * 1;
  const z = f3(fz) * 0.8251046025104602;
  // XYZ D50 → linear sRGB (Bradford adaptation folded into the matrix).
  return linearSrgbToRgb(
    3.1341359569958707 * x - 1.6173863321612538 * y - 0.4906619460083532 * z,
    -0.978795502912089 * x + 1.916254567259524 * y + 0.03344273116131949 * z,
    0.07195537988411677 * x - 0.2289768264158322 * y + 1.405386058324125 * z,
  );
}

/** Display-P3 → sRGB, both gamma-encoded. */
function p3ToRgb(r: number, g: number, b: number): RGB {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  return linearSrgbToRgb(
    1.2249401762805756 * lr - 0.2249401762805757 * lg + 0 * lb,
    -0.04205697777617369 * lr + 1.0420569777761737 * lg + 0 * lb,
    -0.01963755459033437 * lr - 0.0786360133269892 * lg + 1.0982735679173237 * lb,
  );
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg]!;
  return { r: clamp01(rgb[0]! + m), g: clamp01(rgb[1]! + m), b: clamp01(rgb[2]! + m) };
}

function hex(value: string): ParsedCssColor | null {
  let h = value;
  if (h.length === 3 || h.length === 4) {
    h = [...h].map((c) => c + c).join("");
  }
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
  return {
    rgb: {
      r: Number.parseInt(h.slice(0, 2), 16) / 255,
      g: Number.parseInt(h.slice(2, 4), 16) / 255,
      b: Number.parseInt(h.slice(4, 6), 16) / 255,
    },
    alpha: h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

/**
 * Parse any CSS color into sRGB plus alpha, or `null` when the string is
 * not a color this build understands. `transparent` parses successfully
 * with `alpha: 0` — the caller needs that distinction to decide whether a
 * cell has a background at all.
 */
export function parseCssColor(input: string): ParsedCssColor | null {
  const value = input.trim().toLowerCase();
  if (value === "") return null;
  if (value === "transparent") return { rgb: { r: 0, g: 0, b: 0 }, alpha: 0 };
  if (value.startsWith("#")) return hex(value.slice(1));

  const named = NAMED[value];
  if (named !== undefined) return hex(named);

  const fn = /^([a-z-]+)\((.*)\)$/s.exec(value);
  if (!fn) return hex(value); // bare "ff0000", as HTML attributes still carry
  const name = fn[1]!;
  const tokens = args(fn[2]!);
  // rgba()/hsla() may carry alpha as a fourth positional argument.
  const alpha = alphaOf(tokens, name === "rgba" || name === "hsla" ? 3 : -1);
  const p = positional(tokens);

  switch (name) {
    case "rgb":
    case "rgba": {
      const scale = (t: string | undefined): number => clamp01(num(t, 255) / 255);
      return { rgb: { r: scale(p[0]), g: scale(p[1]), b: scale(p[2]) }, alpha };
    }
    case "hsl":
    case "hsla":
      return {
        rgb: hslToRgb(angle(p[0]), clamp01(num(p[1], 1)), clamp01(num(p[2], 1))),
        alpha,
      };
    case "hwb": {
      const w = clamp01(num(p[1], 1));
      const b = clamp01(num(p[2], 1));
      if (w + b >= 1) {
        const grey = w / (w + b);
        return { rgb: { r: grey, g: grey, b: grey }, alpha };
      }
      const base = hslToRgb(angle(p[0]), 1, 0.5);
      const mix = (c: number): number => c * (1 - w - b) + w;
      return { rgb: { r: mix(base.r), g: mix(base.g), b: mix(base.b) }, alpha };
    }
    case "oklab":
      return { rgb: oklabToRgb(num(p[0], 1), num(p[1], 0.4), num(p[2], 0.4)), alpha };
    case "oklch": {
      const h = (angle(p[2]) * Math.PI) / 180;
      const c = num(p[1], 0.4);
      return { rgb: oklabToRgb(num(p[0], 1), c * Math.cos(h), c * Math.sin(h)), alpha };
    }
    case "lab":
      return { rgb: labToRgb(num(p[0], 100), num(p[1], 125), num(p[2], 125)), alpha };
    case "lch": {
      const h = (angle(p[2]) * Math.PI) / 180;
      const c = num(p[1], 150);
      return { rgb: labToRgb(num(p[0], 100), c * Math.cos(h), c * Math.sin(h)), alpha };
    }
    case "color": {
      const space = p[0];
      const c = [num(p[1], 1), num(p[2], 1), num(p[3], 1)] as const;
      if (space === "display-p3") return { rgb: p3ToRgb(c[0], c[1], c[2]), alpha };
      if (space === "srgb")
        return { rgb: { r: clamp01(c[0]), g: clamp01(c[1]), b: clamp01(c[2]) }, alpha };
      if (space === "srgb-linear") return { rgb: linearSrgbToRgb(c[0], c[1], c[2]), alpha };
      return null;
    }
    default:
      return null;
  }
}
