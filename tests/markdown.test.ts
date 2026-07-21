import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/document/document";
import { parseInline, parseMarkdown, type MdBlock } from "../src/markdown/parse";

import { makePng } from "./helpers";

function block<T extends MdBlock["type"]>(blocks: MdBlock[], i: number, type: T): Extract<MdBlock, { type: T }> {
  const b = blocks[i]!;
  expect(b.type).toBe(type);
  return b as Extract<MdBlock, { type: T }>;
}

describe("parseMarkdown blocks", () => {
  it("parses ATX and setext headings", () => {
    const b = parseMarkdown("# Title\n\n## Sub\n\nBig\n===\n\nSmall\n---");
    expect(block(b, 0, "heading").level).toBe(1);
    expect(block(b, 1, "heading").level).toBe(2);
    expect(block(b, 2, "heading").level).toBe(1);
    expect(block(b, 3, "heading").level).toBe(2);
    expect(block(b, 2, "heading").inline[0]!.text).toBe("Big");
  });

  it("parses paragraphs and merges wrapped lines", () => {
    const b = parseMarkdown("one\ntwo\n\nthree");
    expect(b).toHaveLength(2);
    expect(block(b, 0, "paragraph").inline.map((r) => r.text).join("")).toBe("one\ntwo");
  });

  it("parses unordered and ordered lists", () => {
    const ul = block(parseMarkdown("- a\n- b\n- c"), 0, "list");
    expect(ul.ordered).toBe(false);
    expect(ul.items).toHaveLength(3);
    const ol = block(parseMarkdown("3. x\n4. y"), 0, "list");
    expect(ol.ordered).toBe(true);
    expect(ol.start).toBe(3);
  });

  it("parses nested lists", () => {
    const list = block(parseMarkdown("- a\n  - a1\n  - a2\n- b"), 0, "list");
    expect(list.items).toHaveLength(2);
    const nested = block(list.items[0]!, 1, "list");
    expect(nested.items).toHaveLength(2);
  });

  it("parses blockquotes recursively", () => {
    const q = block(parseMarkdown("> quoted **text**\n> more"), 0, "blockquote");
    expect(q.blocks[0]!.type).toBe("paragraph");
  });

  it("parses fenced code with a language and preserves contents", () => {
    const c = block(parseMarkdown("```ts\nconst x = 1;\n// *not* markdown\n```"), 0, "code");
    expect(c.lang).toBe("ts");
    expect(c.text).toBe("const x = 1;\n// *not* markdown");
  });

  it("parses thematic breaks", () => {
    expect(block(parseMarkdown("---"), 0, "hr").type).toBe("hr");
    expect(block(parseMarkdown("***"), 0, "hr").type).toBe("hr");
  });

  it("parses GFM tables with column alignment", () => {
    const t = block(parseMarkdown("| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |"), 0, "table");
    expect(t.aligns).toEqual(["left", "center", "right"]);
    expect(t.headers.map((h) => h.map((r) => r.text).join(""))).toEqual(["A", "B", "C"]);
    expect(t.rows).toHaveLength(2);
  });
});

describe("parseInline", () => {
  it("parses bold, italic and nested emphasis", () => {
    expect(parseInline("**b**")).toEqual([{ text: "b", bold: true }]);
    expect(parseInline("_i_")).toEqual([{ text: "i", italic: true }]);
    const nested = parseInline("**bold _both_**");
    expect(nested).toContainEqual({ text: "both", bold: true, italic: true });
  });

  it("parses inline code verbatim", () => {
    expect(parseInline("a `x*y` b")).toContainEqual({ text: "x*y", code: true });
  });

  it("parses links and carries the destination onto the label runs", () => {
    const runs = parseInline("see [the **docs**](https://x.io)");
    const linked = runs.filter((r) => r.link === "https://x.io");
    expect(linked.map((r) => r.text).join("")).toBe("the docs");
    expect(linked.some((r) => r.bold)).toBe(true);
  });

  it("parses images with alt text and source", () => {
    expect(parseInline("![logo](a.png)")).toEqual([{ text: "logo", image: "a.png" }]);
  });

  it("honours backslash escapes", () => {
    expect(parseInline("\\*not italic\\*")).toEqual([{ text: "*not italic*" }]);
  });

  it("does not treat intraword underscores as emphasis", () => {
    expect(parseInline("a_b_c")).toEqual([{ text: "a_b_c" }]);
  });

  it("leaves an unterminated emphasis marker as literal text", () => {
    expect(parseInline("a * b")).toEqual([{ text: "a * b" }]);
  });
});

describe("PDFDocument.markdown", () => {
  const decode = (b: Uint8Array): string => new TextDecoder("latin1").decode(b);

  it("renders a full document to a valid PDF", async () => {
    const doc = new PDFDocument();
    doc.markdown("# H1\n\nText with **bold**, _italic_, `code` and a [link](https://x.io).\n\n- a\n- b\n\n> quote\n\n```\ncode\n```\n\n| x | y |\n|---|---|\n| 1 | 2 |");
    const bytes = await doc.render();
    expect(decode(bytes.subarray(0, 8))).toContain("%PDF-1.");
    expect(doc.y).toBeGreaterThan(0);
  });

  it("advances the cursor as content flows", () => {
    const doc = new PDFDocument();
    const before = doc.y;
    doc.markdown("# Heading\n\nA paragraph.");
    expect(doc.y).toBeGreaterThan(before);
  });

  it("emits a Link annotation for markdown links", async () => {
    const doc = new PDFDocument();
    doc.markdown("[docs](https://example.com)");
    const bytes = decode(await doc.render());
    expect(bytes).toContain("/Link");
    expect(bytes).toContain("https://example.com");
  });

  it("drops unsafe link schemes but keeps the text", async () => {
    const doc = new PDFDocument();
    doc.markdown("[click](javascript:alert(1))");
    const bytes = decode(await doc.render());
    expect(bytes).not.toContain("javascript");
  });

  it("uses resolveImage for a standalone image paragraph", async () => {
    const png = await makePng(4, 4, 2, [10, 20, 30]);
    let asked: string | undefined;
    const doc = new PDFDocument();
    doc.markdown("![logo](logo.png)", {
      resolveImage: (src) => {
        asked = src;
        return png;
      },
    });
    const bytes = decode(await doc.render());
    expect(asked).toBe("logo.png");
    expect(bytes).toContain("/Image");
  });

  it("falls back to alt text when no resolver is given", async () => {
    const doc = new PDFDocument();
    doc.markdown("![the alt text](logo.png)");
    const bytes = decode(await doc.render());
    // No image XObject, but the document still renders.
    expect(bytes).toContain("%PDF-1.");
    expect(bytes).not.toContain("/Subtype /Image");
  });
});
