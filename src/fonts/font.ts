import { Name, type Ref } from "../pdf/objects";
import type { PDFWriter } from "../pdf/writer";
import { metricsFor, widthOfByte, type StandardFontName } from "./metrics";
import { encodeWinAnsi } from "./winansi";
import type { FontFamily } from "../types/index";

/**
 * Font abstraction used by the layout engine and renderer.
 *
 * Implementations must (a) encode text to the byte string that goes into
 * the content stream, (b) measure that text, and (c) write their PDF font
 * objects at render time. StandardFont and EmbeddedFont both implement
 * this; future backends (CFF, WASM shaping) slot in the same way.
 */
export interface Font {
  /** Unique key for resource deduplication. */
  readonly key: string;
  /** PDF BaseFont name. */
  readonly baseFont: string;
  /** Ascent in 1/1000 em. */
  readonly ascent: number;
  /** Descent in 1/1000 em (negative). */
  readonly descent: number;
  /** Encode text for a content stream (latin1 string, one char = one byte). */
  encode(text: string): string;
  /** Width of the given text at the given size, in points. */
  widthOf(text: string, size: number): number;
  /** Write this font's PDF objects and return the font dictionary ref. */
  embed(writer: PDFWriter): Ref | Promise<Ref>;
}

/** One of the standard 14 fonts (no embedding — viewers provide the glyphs). */
export class StandardFont implements Font {
  readonly key: string;
  private readonly metrics;

  constructor(readonly baseFont: StandardFontName) {
    this.key = `std:${baseFont}`;
    this.metrics = metricsFor(baseFont);
  }

  get ascent(): number {
    return this.metrics.ascent;
  }

  get descent(): number {
    return this.metrics.descent;
  }

  encode(text: string): string {
    return encodeWinAnsi(text);
  }

  widthOf(text: string, size: number): number {
    const encoded = this.encode(text);
    let units = 0;
    for (let i = 0; i < encoded.length; i++) {
      units += widthOfByte(this.metrics, encoded.charCodeAt(i));
    }
    return (units * size) / 1000;
  }

  embed(writer: PDFWriter): Ref {
    return writer.add({
      Type: new Name("Font"),
      Subtype: new Name("Type1"),
      BaseFont: new Name(this.baseFont),
      Encoding: new Name("WinAnsiEncoding"),
    });
  }
}

const VARIANTS: Record<FontFamily, [string, string, string, string]> = {
  helvetica: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  courier: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
};

/** 0 = regular, 1 = bold, 2 = italic, 3 = bold italic. */
export function styleIndex(bold: boolean, italic: boolean): number {
  return (bold ? 1 : 0) + (italic ? 2 : 0);
}

export function isStandardFamily(family: string): family is FontFamily {
  return family in VARIANTS;
}

const cache = new Map<string, StandardFont>();

/** Resolve a standard family + style to its font, cached per base name. */
export function resolveFont(family: FontFamily, bold: boolean, italic: boolean): StandardFont {
  const variants = VARIANTS[family];
  if (!variants) throw new Error(`Unknown font family: "${family}"`);
  const name = variants[styleIndex(bold, italic)] as StandardFontName;
  let font = cache.get(name);
  if (!font) {
    font = new StandardFont(name);
    cache.set(name, font);
  }
  return font;
}
