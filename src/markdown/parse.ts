/**
 * A small CommonMark/GFM subset parser.
 *
 * Supports: ATX (`#`) and setext headings, paragraphs, unordered/ordered
 * lists (nested), blockquotes, fenced code blocks, thematic breaks, GFM
 * pipe tables, and inline emphasis/strong/code/links/images. It is a
 * pragmatic subset, not a spec-complete parser.
 */

export interface MdRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Link destination (the run text is the label). */
  link?: string;
  /** Image source (the run text is the alt text). */
  image?: string;
}

export type MdAlign = "left" | "center" | "right";

export type MdBlock =
  | { type: "heading"; level: number; inline: MdRun[] }
  | { type: "paragraph"; inline: MdRun[] }
  | { type: "list"; ordered: boolean; start: number; items: MdBlock[][] }
  | { type: "blockquote"; blocks: MdBlock[] }
  | { type: "code"; lang: string; text: string }
  | { type: "hr" }
  | { type: "table"; headers: MdRun[][]; rows: MdRun[][][]; aligns: MdAlign[] };

const HR_RE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const ATX_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const FENCE_RE = /^ {0,3}(```+|~~~+)\s*([^`]*)$/;
const ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const BLOCKQUOTE_RE = /^ {0,3}> ?(.*)$/;

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  return parseBlocks(lines, 0, lines.length);
}

function parseBlocks(lines: string[], from: number, to: number): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = from;
  while (i < to) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1]![0]!;
      const body: string[] = [];
      i++;
      while (i < to && !new RegExp(`^ {0,3}${marker === "`" ? "```+" : "~~~+"}\\s*$`).test(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      i++; // consume closing fence
      blocks.push({ type: "code", lang: fence[2]!.trim(), text: body.join("\n") });
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const atx = ATX_RE.exec(line);
    if (atx) {
      blocks.push({ type: "heading", level: atx[1]!.length, inline: parseInline(atx[2] ?? "") });
      i++;
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < to && (BLOCKQUOTE_RE.test(lines[i]!) || (lines[i]!.trim() !== "" && inner.length > 0 && !isBlockStart(lines[i]!)))) {
        const m = BLOCKQUOTE_RE.exec(lines[i]!);
        inner.push(m ? m[1]! : lines[i]!);
        i++;
      }
      blocks.push({ type: "blockquote", blocks: parseBlocks(inner, 0, inner.length) });
      continue;
    }

    if (ITEM_RE.test(line)) {
      const list = parseList(lines, i, to);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    const table = tryTable(lines, i, to);
    if (table) {
      blocks.push(table.block);
      i = table.next;
      continue;
    }

    // Paragraph: gather until a blank line or a new block start.
    const para: string[] = [line];
    i++;
    while (i < to && lines[i]!.trim() !== "") {
      // A setext underline (= or -) directly under a paragraph makes it a
      // heading — this takes precedence over the thematic-break reading of "---".
      const setext = /^ {0,3}(=+|-+)\s*$/.exec(lines[i]!);
      if (setext) {
        blocks.push({ type: "heading", level: setext[1]![0] === "=" ? 1 : 2, inline: parseInline(para.join("\n").trim()) });
        i++;
        para.length = 0;
        break;
      }
      if (isBlockStart(lines[i]!)) break;
      para.push(lines[i]!);
      i++;
    }
    if (para.length > 0) {
      blocks.push({ type: "paragraph", inline: parseInline(para.join("\n").trim()) });
    }
  }
  return blocks;
}

/** Does this line begin a non-paragraph block (used to end paragraphs/quotes)? */
function isBlockStart(line: string): boolean {
  return (
    HR_RE.test(line) ||
    ATX_RE.test(line) ||
    FENCE_RE.test(line) ||
    ITEM_RE.test(line) ||
    BLOCKQUOTE_RE.test(line)
  );
}

function parseList(lines: string[], from: number, to: number): { block: MdBlock; next: number } {
  const first = ITEM_RE.exec(lines[from]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const start = ordered ? parseInt(first[2]!, 10) : 1;
  const items: MdBlock[][] = [];
  let i = from;

  while (i < to) {
    const m = ITEM_RE.exec(lines[i]!);
    if (!m || m[1]!.length !== baseIndent || /\d/.test(m[2]!) !== ordered) break;
    const contentIndent = m[1]!.length + m[2]!.length + m[3]!.length;
    const itemLines: string[] = [m[4]!];
    i++;
    // Continuation and nested lines: blank lines, or lines indented into the item.
    while (i < to) {
      const l = lines[i]!;
      if (l.trim() === "") {
        // A blank line continues the item only if the next line is still indented.
        const next = lines[i + 1];
        if (next !== undefined && next.trim() !== "" && leadingSpaces(next) >= contentIndent) {
          itemLines.push("");
          i++;
          continue;
        }
        break;
      }
      if (ITEM_RE.test(l) && leadingSpaces(l) === baseIndent) break; // sibling item
      if (leadingSpaces(l) < contentIndent && !isLazyContinuation(l)) break;
      itemLines.push(l.slice(Math.min(contentIndent, leadingSpaces(l))));
      i++;
    }
    items.push(parseBlocks(itemLines, 0, itemLines.length));
  }

  return { block: { type: "list", ordered, start, items }, next: i };
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (line[n] === " ") n++;
  return n;
}

/** A plain text line under a list item continues its paragraph (lazy). */
function isLazyContinuation(line: string): boolean {
  return line.trim() !== "" && !isBlockStart(line);
}

function tryTable(lines: string[], from: number, to: number): { block: MdBlock; next: number } | null {
  if (from + 1 >= to) return null;
  const header = lines[from]!;
  const delim = lines[from + 1]!;
  if (!header.includes("|")) return null;
  if (!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(delim)) return null;

  const aligns: MdAlign[] = splitRow(delim).map((cell) => {
    const l = cell.startsWith(":");
    const r = cell.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : "left";
  });
  const headers = splitRow(header).map((c) => parseInline(c));
  const rows: MdRun[][][] = [];
  let i = from + 2;
  while (i < to && lines[i]!.trim() !== "" && lines[i]!.includes("|")) {
    rows.push(splitRow(lines[i]!).map((c) => parseInline(c)));
    i++;
  }
  return { block: { type: "table", headers, rows, aligns }, next: i };
}

function splitRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  // Split on unescaped pipes.
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

// ── inline ───────────────────────────────────────────────────────────────

export function parseInline(text: string, base: Omit<MdRun, "text"> = {}): MdRun[] {
  const runs: MdRun[] = [];
  let buf = "";
  let i = 0;
  const flush = (): void => {
    if (buf !== "") {
      runs.push({ ...base, text: buf });
      buf = "";
    }
  };

  while (i < text.length) {
    const c = text[i]!;

    if (c === "\\" && i + 1 < text.length && /[!-/:-@[-`{-~]/.test(text[i + 1]!)) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    if (c === "`") {
      let n = 1;
      while (text[i + n] === "`") n++;
      const ticks = "`".repeat(n);
      const close = text.indexOf(ticks, i + n);
      if (close !== -1) {
        flush();
        runs.push({ ...base, text: text.slice(i + n, close).replace(/\s+/g, " ").trim(), code: true });
        i = close + n;
        continue;
      }
    }

    if (c === "!" && text[i + 1] === "[") {
      const link = parseLink(text, i + 1);
      if (link) {
        flush();
        runs.push({ ...base, text: link.label, image: link.dest });
        i = link.end;
        continue;
      }
    }

    if (c === "[") {
      const link = parseLink(text, i);
      if (link) {
        flush();
        for (const r of parseInline(link.label, { ...base, link: link.dest })) runs.push(r);
        i = link.end;
        continue;
      }
    }

    if (c === "*" || c === "_") {
      const double = text[i + 1] === c;
      const marker = double ? c + c : c;
      const end = findEmphasisClose(text, i + marker.length, marker, c);
      if (end !== -1) {
        flush();
        const inner = parseInline(text.slice(i + marker.length, end), {
          ...base,
          ...(double ? { bold: true } : { italic: true }),
        });
        for (const r of inner) runs.push(r);
        i = end + marker.length;
        continue;
      }
    }

    buf += c;
    i++;
  }
  flush();
  return runs;
}

function findEmphasisClose(text: string, from: number, marker: string, ch: string): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text.startsWith(marker, i)) {
      // The character after a two-char marker must not extend it (avoid `***`).
      if (text[i + marker.length] === ch) continue;
      // Underscores only close at a word boundary (no intraword emphasis).
      if (ch === "_" && /\w/.test(text[i + marker.length] ?? "")) continue;
      if (i === from) continue; // empty emphasis
      return i;
    }
  }
  return -1;
}

function parseLink(text: string, start: number): { label: string; dest: string; end: number } | null {
  // text[start] === "["
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "[") depth++;
    else if (text[i] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || text[i + 1] !== "(") return null;
  const label = text.slice(start + 1, i);
  const close = text.indexOf(")", i + 2);
  if (close === -1) return null;
  let dest = text.slice(i + 2, close).trim();
  // Strip an optional "title".
  const sp = dest.search(/\s/);
  if (sp !== -1) dest = dest.slice(0, sp);
  if (dest.startsWith("<") && dest.endsWith(">")) dest = dest.slice(1, -1);
  return { label, dest, end: close + 1 };
}
