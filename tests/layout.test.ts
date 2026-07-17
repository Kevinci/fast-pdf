import { describe, expect, it } from "vitest";
import { alignOffset, wrapText } from "../src/layout/text";
import { columnWidths, measureTable } from "../src/layout/table";
import { resolveFont } from "../src/fonts/font";

const helv = resolveFont("helvetica", false, false);

describe("wrapText", () => {
  it("keeps short text on one line", () => {
    expect(wrapText("Hello world", helv, 12, 500)).toEqual(["Hello world"]);
  });

  it("wraps at word boundaries and never exceeds the box", () => {
    const lines = wrapText("aaa bbb ccc ddd eee fff", helv, 12, 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(helv.widthOf(line, 12)).toBeLessThanOrEqual(60);
    }
    expect(lines.join(" ")).toBe("aaa bbb ccc ddd eee fff");
  });

  it("honors explicit newlines, including empty lines", () => {
    expect(wrapText("a\n\nb", helv, 12, 500)).toEqual(["a", "", "b"]);
  });

  it("hard-breaks single words wider than the box", () => {
    const lines = wrapText("Donaudampfschifffahrtsgesellschaft", helv, 12, 50);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(helv.widthOf(line, 12)).toBeLessThanOrEqual(50);
    }
    expect(lines.join("")).toBe("Donaudampfschifffahrtsgesellschaft");
  });
});

describe("alignOffset", () => {
  it("computes offsets per alignment", () => {
    expect(alignOffset(40, 100, "left")).toBe(0);
    expect(alignOffset(40, 100, "center")).toBe(30);
    expect(alignOffset(40, 100, "right")).toBe(60);
  });
});

describe("table layout", () => {
  it("splits columns equally by default", () => {
    expect(columnWidths(300, 3)).toEqual([100, 100, 100]);
  });

  it("scales down requested widths that exceed the available space", () => {
    expect(columnWidths(300, 2, [400, 200])).toEqual([200, 100]);
  });

  it("keeps requested widths that fit", () => {
    expect(columnWidths(300, 2, [100, 150])).toEqual([100, 150]);
  });

  it("rejects mismatched width counts", () => {
    expect(() => columnWidths(300, 3, [100, 100])).toThrow(/3 columns/);
  });

  const measureOpts = {
    hasHeader: false,
    hasFooter: false,
    fontSize: 10,
    padding: 5,
    lineHeight: 1.2,
    resolveFont: (bold: boolean, italic: boolean) => resolveFont("helvetica", bold, italic),
  };

  it("derives row height from the tallest wrapped cell", () => {
    const [short] = measureTable([["a", "b"]], [200, 200], measureOpts);
    expect(short!.height).toBeCloseTo(10 * 1.2 + 10, 5);

    const [tall] = measureTable(
      [["a", "a much longer text that will definitely wrap into several lines here"]],
      [200, 60],
      measureOpts,
    );
    expect(tall!.height).toBeGreaterThan(short!.height);
    expect(tall!.cells[1]!.lines.length).toBeGreaterThan(1);
  });

  it("marks header rows", () => {
    const [header] = measureTable([["Product"]], [80], { ...measureOpts, hasHeader: true });
    expect(header!.isHeader).toBe(true);
  });

  it("positions colSpan cells across the grid", () => {
    const rows = [[{ text: "wide", colSpan: 2 }, "c"], ["a", "b", "c"]];
    const [first, second] = measureTable(rows, [100, 100, 100], measureOpts);
    expect(first!.cells[0]!.width).toBe(200);
    expect(first!.cells[1]!.x).toBe(200);
    expect(second!.cells.map((c) => c.x)).toEqual([0, 100, 200]);
  });

  it("blocks grid slots under rowSpan cells and keeps rows together", () => {
    const rows = [[{ text: "tall", rowSpan: 2 }, "b1"], ["b2"]];
    const [first, second] = measureTable(rows, [100, 100], measureOpts);
    expect(first!.keepWithNext).toBe(true);
    expect(first!.cells[0]!.height).toBe(first!.height + second!.height);
    // The second row's only cell lands in column 2 — column 1 is blocked.
    expect(second!.cells[0]!.x).toBe(100);
    expect(second!.keepWithNext).toBe(false);
  });

  it("grows spanned rows when a rowSpan cell needs more height", () => {
    const rows = [
      [{ text: "line1\nline2\nline3\nline4", rowSpan: 2 }, "b1"],
      ["b2"],
    ];
    const [first, second] = measureTable(rows, [100, 100], measureOpts);
    const need = 4 * 10 * 1.2 + 10;
    expect(first!.height + second!.height).toBeCloseTo(need, 5);
  });
});
