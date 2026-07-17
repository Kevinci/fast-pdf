import type { Font } from "../fonts/font";

/**
 * Text layout: greedy word wrap against real font metrics.
 * Pure functions — no document or page state.
 */

/** A wrapped line plus whether it ends its paragraph (relevant for justify). */
export interface WrappedLine {
  text: string;
  /** True when this line is the last line of its source paragraph. */
  paragraphEnd: boolean;
}

const SOFT_HYPHEN = "­";

/**
 * Wrap text to fit `maxWidth` points. Explicit "\n" forces breaks; soft
 * hyphens (U+00AD) mark preferred break points inside words and render as
 * "-" only when broken there. Words wider than the line are broken at the
 * last fitting character, so pathological input can never overflow the box.
 * @param letterSpacing extra advance per character in points
 */
export function wrapLines(
  text: string,
  font: Font,
  size: number,
  maxWidth: number,
  letterSpacing = 0,
): WrappedLine[] {
  const measure = (s: string): number => {
    const chars = [...s].length;
    return font.widthOf(s, size) + (chars > 1 ? (chars - 1) * letterSpacing : 0);
  };
  const lines: WrappedLine[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push({ text: "", paragraphEnd: true });
      continue;
    }
    const flush: string[] = [];
    let current = "";
    const spaceWidth = measure(" ") + letterSpacing;
    let currentWidth = 0;
    for (const word of paragraph.split(" ")) {
      const plain = word.replaceAll(SOFT_HYPHEN, "");
      const wordWidth = measure(plain);
      const needed = current === "" ? wordWidth : currentWidth + spaceWidth + wordWidth;
      if (needed <= maxWidth || current === "") {
        if (current === "" && wordWidth > maxWidth) {
          // Try soft-hyphen break points first, then hard-break by characters.
          const pieces = breakLongWord(word, measure, maxWidth);
          for (let i = 0; i < pieces.length - 1; i++) flush.push(pieces[i]!);
          current = pieces[pieces.length - 1]!;
          currentWidth = measure(current);
        } else {
          current = current === "" ? plain : current + " " + plain;
          currentWidth = needed;
        }
      } else {
        // Word does not fit: try breaking it at a soft hyphen that fits.
        const broken = trySoftHyphenBreak(word, measure, maxWidth - currentWidth - spaceWidth);
        if (broken && current !== "") {
          flush.push(current + " " + broken.head);
          current = broken.tail.replaceAll(SOFT_HYPHEN, "");
          currentWidth = measure(current);
        } else {
          flush.push(current);
          current = plain;
          currentWidth = wordWidth;
        }
      }
      for (const f of flush) lines.push({ text: f, paragraphEnd: false });
      flush.length = 0;
    }
    lines.push({ text: current, paragraphEnd: true });
  }
  return lines;
}

/** Break at the last soft hyphen whose "head-" still fits `available`. */
function trySoftHyphenBreak(
  word: string,
  measure: (s: string) => number,
  available: number,
): { head: string; tail: string } | null {
  if (!word.includes(SOFT_HYPHEN)) return null;
  const parts = word.split(SOFT_HYPHEN);
  for (let i = parts.length - 1; i >= 1; i--) {
    const head = parts.slice(0, i).join("") + "-";
    if (measure(head) <= available) {
      return { head, tail: parts.slice(i).join(SOFT_HYPHEN) };
    }
  }
  return null;
}

/**
 * Split a word wider than the box into fitting pieces: soft-hyphen break
 * points first (rendered with a visible "-"), hard character breaks as
 * the last resort.
 */
function breakLongWord(word: string, measure: (s: string) => number, maxWidth: number): string[] {
  const out: string[] = [];
  let rest = word;
  for (;;) {
    const plain = rest.replaceAll(SOFT_HYPHEN, "");
    if (measure(plain) <= maxWidth) {
      out.push(plain);
      return out;
    }
    const broken = trySoftHyphenBreak(rest, measure, maxWidth);
    if (broken) {
      out.push(broken.head);
      rest = broken.tail;
      continue;
    }
    // No fitting soft-hyphen point: break characters off the front.
    let piece = "";
    for (const ch of plain) {
      if (measure(piece + ch) > maxWidth && piece !== "") break;
      piece += ch;
    }
    out.push(piece);
    rest = plain.slice(piece.length);
  }
}

/**
 * Wrap text and return plain line strings (paragraph structure discarded).
 * Kept for callers that do not justify (tables, measurement).
 */
export function wrapText(text: string, font: Font, size: number, maxWidth: number): string[] {
  return wrapLines(text, font, size, maxWidth).map((l) => l.text);
}

/** X offset for a line within a box of `boxWidth`, honoring alignment. */
export function alignOffset(
  lineWidth: number,
  boxWidth: number,
  align: "left" | "center" | "right" | "justify",
): number {
  if (align === "center") return (boxWidth - lineWidth) / 2;
  if (align === "right") return boxWidth - lineWidth;
  return 0;
}
