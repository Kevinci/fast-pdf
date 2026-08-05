import { describe, expect, it } from "vitest";
import { FastPDFError, PDFDocument } from "../src/index";
import { latin1String } from "../src/pdf/objects";
import type { PendingLink } from "../src/document/page";

const raw = () => new PDFDocument({ compress: false });

/**
 * Link annotations pending on the current page. `page` is private — the link
 * rectangle is not observable through the public API, and it is exactly what
 * these tests are about, so they read it through a cast.
 */
const linksOf = (pdf: PDFDocument): PendingLink[] =>
  (pdf as unknown as { page: { links: PendingLink[] } }).page.links;

async function rendered(pdf: PDFDocument): Promise<string> {
  return latin1String(await pdf.render());
}

describe("button()", () => {
  it("draws a filled box, a label and a link annotation", async () => {
    const pdf = raw();
    pdf.button("Zur Demo", {
      link: "https://kevinci.github.io/fast-pdf/",
      fill: "#4f46e5",
      color: "#ffffff",
      width: 180,
    });
    const text = await rendered(pdf);
    expect(text).toContain("/Subtype /Link");
    expect(text).toContain("/URI (https://kevinci.github.io/fast-pdf/)");
    expect(text).toContain("(Zur Demo) Tj");
    expect(text).toContain("0.3098 0.2745 0.898 rg"); // #4f46e5 background
  });

  it("strokes a border only when a border is asked for", async () => {
    const plain = raw();
    plain.button("A", { link: "https://example.com" });
    expect(await rendered(plain)).not.toContain(" RG");

    const bordered = raw();
    bordered.button("A", { link: "https://example.com", borderColor: "#ff0000", borderWidth: 2 });
    const text = await rendered(bordered);
    expect(text).toContain("1 0 0 RG");
    expect(text).toContain("2 w");
  });

  it("sizes itself to the label and honours percentage widths", () => {
    const pdf = raw();
    pdf.button("Kurz", { link: "#ziel", paddingX: 10 });
    const narrow = pdf.lastBlockHeight;
    expect(narrow).toBeGreaterThan(0);

    const half = raw();
    half.anchor("ziel");
    half.button("Halbe Breite", { link: "#ziel", width: "50%" });
    // The link rectangle is the button box: half the content width.
    expect(linksOf(half)[0]!.width).toBeCloseTo(half.width / 2, 5);
  });

  it("truncates a label that is wider than the box instead of spilling out", async () => {
    const pdf = raw();
    pdf.button("Ein sehr langer Beschriftungstext, der nicht passt", {
      link: "https://example.com",
      width: 90,
    });
    const text = await rendered(pdf);
    expect(text).toContain(String.fromCharCode(0x85)); // WinAnsi 0x85 = ellipsis
    expect(text).not.toContain("der nicht passt");
  });

  it("flows by default and stands still with an absolute y", () => {
    const flow = raw();
    const before = flow.y;
    flow.button("Fluss", { link: "https://example.com" });
    expect(flow.y).toBeGreaterThan(before);

    const absolute = raw();
    const y0 = absolute.y;
    absolute.button("Absolut", { link: "https://example.com", x: 40, y: 700 });
    expect(absolute.y).toBe(y0);
    expect(absolute.lastBlockHeight).toBeGreaterThan(0);
    expect(linksOf(absolute)[0]!.y).toBe(700);
  });

  it("breaks the page when the button no longer fits", () => {
    const pdf = raw();
    pdf.y = 800;
    pdf.button("Unten", { link: "https://example.com" });
    expect(pdf.pageCount).toBe(2);
  });

  it("places the button within the flow area", () => {
    const pdf = raw();
    pdf.button("Rechts", { link: "https://example.com", width: 100, align: "right" });
    const link = linksOf(pdf)[0]!;
    expect(link.x + link.width).toBeCloseTo(pdf.x + pdf.width, 5);
  });

  it("rejects unsafe link targets and invalid numbers", () => {
    const pdf = raw();
    expect(() => pdf.button("X", { link: "javascript:alert(1)" })).toThrowError(FastPDFError);
    try {
      pdf.button("X", { link: "https://example.com", height: -1 });
      expect.unreachable();
    } catch (e) {
      expect((e as FastPDFError).code).toBe("INVALID_NUMBER");
    }
  });
});
