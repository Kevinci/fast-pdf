import { FastPDFError } from "../errors";

/** A parsed XML/SVG element. `tag` is the local name, lower-cased. */
export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
  /** Concatenated text content (for <text>/<tspan>). */
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

/** Strip a namespace prefix ("svg:rect" → "rect"). */
function localName(name: string): string {
  const i = name.indexOf(":");
  return (i >= 0 ? name.slice(i + 1) : name).toLowerCase();
}

/**
 * A small, forgiving XML parser sufficient for SVG: elements, attributes
 * (single or double quoted), self-closing tags, text content, comments,
 * CDATA, processing instructions and the doctype. Not a validating parser.
 */
export function parseXml(source: string): SvgNode {
  const root: SvgNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: SvgNode[] = [root];
  let i = 0;
  const len = source.length;

  const skip = (from: number, marker: string): number => {
    const end = source.indexOf(marker, from);
    return end === -1 ? len : end + marker.length;
  };

  while (i < len) {
    if (source[i] === "<") {
      if (source.startsWith("<!--", i)) {
        i = skip(i + 4, "-->");
        continue;
      }
      if (source.startsWith("<![CDATA[", i)) {
        const end = source.indexOf("]]>", i + 9);
        const data = source.slice(i + 9, end === -1 ? len : end);
        stack[stack.length - 1]!.text += data;
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (source.startsWith("<!", i) || source.startsWith("<?", i)) {
        i = skip(i + 2, ">");
        continue;
      }
      if (source[i + 1] === "/") {
        // Closing tag.
        const end = source.indexOf(">", i);
        if (end === -1) break;
        if (stack.length > 1) stack.pop();
        i = end + 1;
        continue;
      }
      // Opening tag.
      const end = source.indexOf(">", i);
      if (end === -1) throw new FastPDFError("Invalid SVG: unterminated tag", "INVALID_ARGUMENT");
      let inner = source.slice(i + 1, end);
      const selfClose = inner.endsWith("/");
      if (selfClose) inner = inner.slice(0, -1);
      const node = parseTag(inner);
      stack[stack.length - 1]!.children.push(node);
      if (!selfClose) stack.push(node);
      i = end + 1;
    } else {
      const next = source.indexOf("<", i);
      const chunk = source.slice(i, next === -1 ? len : next);
      if (chunk.trim() !== "") stack[stack.length - 1]!.text += decodeEntities(chunk);
      i = next === -1 ? len : next;
    }
  }

  const svg = root.children.find((c) => c.tag === "svg");
  if (!svg) throw new FastPDFError("Invalid SVG: no <svg> root element", "INVALID_ARGUMENT");
  return svg;
}

const ATTR_RE = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseTag(inner: string): SvgNode {
  const spaceAt = inner.search(/\s/);
  const tag = localName(spaceAt === -1 ? inner : inner.slice(0, spaceAt));
  const attrs: Record<string, string> = {};
  if (spaceAt !== -1) {
    const rest = inner.slice(spaceAt);
    let m: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(rest)) !== null) {
      attrs[localName(m[1]!)] = decodeEntities(m[3] ?? m[4] ?? "");
    }
  }
  return { tag, attrs, children: [], text: "" };
}
