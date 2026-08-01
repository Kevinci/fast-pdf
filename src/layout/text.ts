import type { Font } from "../fonts/font";

/**
 * Text layout: greedy word wrap against real font metrics.
 * Pure functions — no document or page state.
 *
 * This is the ONLY line-breaking implementation in fast-pdf: drawing
 * (`text()`) and measuring (`measureText()`) both go through `wrapLines`,
 * so a measured block can never disagree with the drawn one.
 */

/** A wrapped line plus whether it ends its paragraph (relevant for justify). */
export interface WrappedLine {
  text: string;
  /** True when this line is the last line of its source paragraph. */
  paragraphEnd: boolean;
}

const SOFT_HYPHEN = "­";

/**
 * Characters after which a line may break without inserting anything
 * (UAX #14 classes HY and BA): hyphen-minus, non-breaking-safe dashes and
 * the solidus. "Full-Stack-Entwickler" therefore breaks at its hyphens
 * instead of overflowing a narrow column.
 */
const BREAK_AFTER = new Set(["-", "‐", "–", "—", "/"]);

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

/**
 * Split a whitespace-delimited word into the atoms a line may break
 * between. The break character stays with the preceding atom (that is what
 * makes "Full-" / "Stack-" / "Entwickler" read correctly).
 *
 * Two exceptions follow UAX #14 so ordinary text is not mangled:
 * a leading break character never starts an atom ("-5" stays whole), and a
 * break between two digits is suppressed ("2026-08-01", "3/4").
 */
export function breakAtoms(word: string): string[] {
  const chars = [...word];
  const atoms: string[] = [];
  let current = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    current += ch;
    if (!BREAK_AFTER.has(ch)) continue;
    if (i === chars.length - 1) continue; // trailing break char: nothing follows
    const before = chars[i - 1];
    if (before === undefined || BREAK_AFTER.has(before)) continue; // "--", leading "-"
    if (isDigit(before) && isDigit(chars[i + 1])) continue; // 2026-08-01, 3/4
    atoms.push(current);
    current = "";
  }
  if (current !== "") atoms.push(current);
  return atoms.length > 0 ? atoms : [word];
}

/**
 * Wrap text to fit `maxWidth` points. Explicit "\n" forces breaks; soft
 * hyphens (U+00AD) mark preferred break points inside words and render as
 * "-" only when broken there; hyphens and slashes are break opportunities
 * that render unchanged. Words wider than the line are broken at the last
 * fitting character, so pathological input can never overflow the box.
 * @param letterSpacing extra advance per character in points
 */
export function wrapLines(
  text: string,
  font: Font,
  size: number,
  maxWidth: number,
  letterSpacing = 0,
): WrappedLine[] {
  const measure = (s: string): number => measureLine(s, font, size, letterSpacing);
  const lines: WrappedLine[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push({ text: "", paragraphEnd: true });
      continue;
    }
    const push = (t: string): void => {
      lines.push({ text: t, paragraphEnd: false });
    };
    const spaceWidth = measure(" ") + letterSpacing;
    let current = "";
    let currentWidth = 0;

    /** Emit all but the last piece of an over-wide atom; return the remainder. */
    const spill = (atom: string): string => {
      const pieces = breakLongWord(atom, measure, maxWidth);
      for (let i = 0; i < pieces.length - 1; i++) push(pieces[i]!);
      return pieces[pieces.length - 1]!;
    };

    for (const word of paragraph.split(" ")) {
      let firstAtom = true;
      for (const atom of breakAtoms(word)) {
        // Only the first atom of a word is preceded by a space; the rest
        // continue the word directly (that is where hyphen breaks happen).
        const glue = firstAtom && current !== "" ? " " : "";
        firstAtom = false;
        const plain = atom.replaceAll(SOFT_HYPHEN, "");
        const atomWidth = measure(plain);
        const glueWidth = glue === "" ? 0 : spaceWidth;
        const needed = current === "" ? atomWidth : currentWidth + glueWidth + atomWidth;

        if (needed <= maxWidth) {
          current = current + glue + plain;
          currentWidth = needed;
          continue;
        }
        if (current === "") {
          current = spill(atom);
          currentWidth = measure(current);
          continue;
        }
        // The atom does not fit: try a soft hyphen that still fits this line.
        const broken = trySoftHyphenBreak(atom, measure, maxWidth - currentWidth - glueWidth);
        if (broken) {
          push(current + glue + broken.head);
          const tail = broken.tail.replaceAll(SOFT_HYPHEN, "");
          current = measure(tail) > maxWidth ? spill(broken.tail) : tail;
        } else {
          push(current);
          current = atomWidth > maxWidth ? spill(atom) : plain;
        }
        currentWidth = measure(current);
      }
    }
    lines.push({ text: current, paragraphEnd: true });
  }
  return lines;
}

/**
 * Advance width of one already-wrapped line, in points.
 *
 * Letter spacing is counted between glyphs only. The `Tc` operator also
 * adds it after the final glyph, but that trailing gap is empty space, so
 * excluding it is what makes centred and right-aligned letterspaced text
 * sit flush with the box. Drawing and measuring use this same function.
 */
export function measureLine(text: string, font: Font, size: number, letterSpacing = 0): number {
  const chars = [...text].length;
  return font.widthOf(text, size) + (chars > 1 ? (chars - 1) * letterSpacing : 0);
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
