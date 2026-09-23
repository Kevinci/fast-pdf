import { describe, expect, it, vi } from "vitest";
import {
  attachTablePdfButton,
  tableToPDF,
  tableToRows,
  type PageFormatName,
  type StyleReader,
  type TableCell,
} from "../src/index";
import { FastPDFError } from "../src/errors";

/* ---------------------------------------------------------- a small fake DOM
 *
 * The reader only ever touches a handful of DOM properties, so the tests
 * build those by hand instead of pulling in a headless browser: fast, and
 * every attribute under test is visible right here. The real thing is
 * exercised in a browser against docs/demo.html.
 */

interface CellSpec {
  text?: string;
  tag?: "td" | "th";
  colSpan?: number;
  rowSpan?: number;
  width?: number;
  style?: Record<string, string>;
  className?: string;
  nodes?: unknown[];
}

type RowSpec =
  | (CellSpec | string)[]
  | { cells: (CellSpec | string)[]; style?: Record<string, string>; className?: string };

const stylesMap = new Map<unknown, Record<string, string>>();

function textNode(value: string): unknown {
  return { nodeType: 3, nodeValue: value };
}

function element(tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: [],
    children: [],
    hidden: false,
    className: "",
    matches(selector: string) {
      const className = (this as { className: string }).className;
      return selector.startsWith(".") && className.split(" ").includes(selector.slice(1));
    },
    getBoundingClientRect: () => ({ width: 0 }),
    ...extra,
  };
  return node;
}

function makeCell(spec: CellSpec | string): Record<string, unknown> {
  const s: CellSpec = typeof spec === "string" ? { text: spec } : spec;
  const cell = element(s.tag ?? "td", {
    colSpan: s.colSpan ?? 1,
    rowSpan: s.rowSpan ?? 1,
    className: s.className ?? "",
    childNodes: s.nodes ?? [textNode(s.text ?? "")],
    getBoundingClientRect: () => ({ width: s.width ?? 0 }),
  });
  if (s.style) stylesMap.set(cell, s.style);
  return cell;
}

function makeRow(spec: RowSpec): Record<string, unknown> {
  const list = Array.isArray(spec) ? spec : spec.cells;
  const row = element("tr", {
    cells: list.map(makeCell),
    className: (Array.isArray(spec) ? undefined : spec.className) ?? "",
  });
  if (!Array.isArray(spec) && spec.style) stylesMap.set(row, spec.style);
  return row;
}

function section(tag: string, rows: RowSpec[]): Record<string, unknown> {
  return element(tag, { rows: rows.map(makeRow) });
}

function fakeTable(spec: {
  head?: RowSpec[];
  body?: RowSpec[];
  foot?: RowSpec[];
  id?: string;
  width?: number;
}): HTMLTableElement {
  const table = element("table", {
    id: spec.id ?? "",
    tHead: spec.head ? section("thead", spec.head) : null,
    tBodies: spec.body ? [section("tbody", spec.body)] : [],
    tFoot: spec.foot ? section("tfoot", spec.foot) : null,
    getBoundingClientRect: () => ({ width: spec.width ?? 0 }),
  });
  return table as unknown as HTMLTableElement;
}

/** Computed styles for the fake nodes; anything unset reads as empty. */
const readStyles: StyleReader = (element) =>
  (stylesMap.get(element) ?? {}) as Partial<CSSStyleDeclaration>;

const text = (cell: TableCell | undefined): string | undefined => cell?.text;

/* ------------------------------------------------------------------- tests */

describe("tableToRows — structure", () => {
  it("reads head, body and foot in order and flags them", () => {
    const table = fakeTable({
      head: [["Item", "Qty"]],
      body: [
        ["Beans", "3"],
        ["Filters", "12"],
      ],
      foot: [["Total", "15"]],
    });
    const { rows, options } = tableToRows(table, { styles: false });
    expect(rows.map((r) => r.map(text))).toEqual([
      ["Item", "Qty"],
      ["Beans", "3"],
      ["Filters", "12"],
      ["Total", "15"],
    ]);
    expect(options.header).toBe(true);
    expect(options.footer).toBe(true);
  });

  it("marks a table without <thead> as headerless", () => {
    const table = fakeTable({ body: [["a", "b"]] });
    expect(tableToRows(table, { styles: false }).options.header).toBe(false);
  });

  it("carries colSpan and rowSpan across", () => {
    const table = fakeTable({
      body: [
        [{ text: "Q1", colSpan: 2 }, "rest"],
        [{ text: "tall", rowSpan: 2 }, "x", "y"],
        ["x2", "y2"],
      ],
    });
    const { rows } = tableToRows(table, { styles: false });
    expect(rows[0]![0]!.colSpan).toBe(2);
    expect(rows[1]![0]!.rowSpan).toBe(2);
    // The third row's cells sit right of the still-occupied first column.
    expect(rows[2]!.map(text)).toEqual(["x2", "y2"]);
  });

  it("turns <br> and block children into line breaks and collapses whitespace", () => {
    const table = fakeTable({
      body: [
        [
          {
            nodes: [textNode("  Kevin   Imig "), element("br"), textNode("Berlin")],
          },
        ],
      ],
    });
    expect(text(tableToRows(table, { styles: false }).rows[0]![0])).toBe("Kevin Imig\nBerlin");
  });

  it("makes <th> bold", () => {
    const table = fakeTable({ head: [[{ text: "Item", tag: "th" }]] });
    expect(tableToRows(table, { styles: false }).rows[0]![0]!.bold).toBe(true);
  });

  it("throws NO_TABLE for an empty table", () => {
    const table = fakeTable({});
    try {
      tableToRows(table);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FastPDFError);
      expect((error as FastPDFError).code).toBe("NO_TABLE");
    }
  });

  it("throws NO_TABLE when the element is not a table", () => {
    const div = element("div", { querySelector: () => null }) as unknown as HTMLElement;
    expect(() => tableToRows(div)).toThrow(FastPDFError);
  });
});

describe("tableToRows — skipping", () => {
  it("leaves out rows and cells matching `skip`", () => {
    const table = fakeTable({
      body: [
        { cells: ["keep", "keep2"] },
        { cells: ["drop", "drop2"], className: "no-print" },
        [{ text: "a" }, { text: "b", className: "no-print" }],
      ],
    });
    const { rows } = tableToRows(table, { styles: false, skip: ".no-print" });
    expect(rows.map((r) => r.map(text))).toEqual([["keep", "keep2"], ["a"]]);
  });

  it("leaves out rows hidden by CSS, unless asked to include them", () => {
    const table = fakeTable({
      body: [{ cells: ["visible"] }, { cells: ["gone"], style: { display: "none" } }],
    });
    const hiddenSkipped = tableToRows(table, { computedStyle: readStyles });
    expect(hiddenSkipped.rows.map((r) => r.map(text))).toEqual([["visible"]]);

    const all = tableToRows(table, { computedStyle: readStyles, includeHidden: true });
    expect(all.rows.map((r) => r.map(text))).toEqual([["visible"], ["gone"]]);
  });
});

describe("tableToRows — CSS fidelity", () => {
  it("takes colors, weight, size and padding from the computed style", () => {
    const table = fakeTable({
      body: [
        [
          {
            text: "styled",
            style: {
              color: "rgb(255, 0, 0)",
              backgroundColor: "oklch(1 0 0)",
              fontWeight: "700",
              fontStyle: "italic",
              fontSize: "16px",
              paddingTop: "8px",
              paddingBottom: "8px",
              paddingLeft: "12px",
              paddingRight: "12px",
            },
          },
        ],
      ],
    });
    const cell = tableToRows(table, { computedStyle: readStyles }).rows[0]![0]!;
    expect(cell.color).toBe("#ff0000");
    expect(cell.fill).toBe("#ffffff");
    expect(cell.bold).toBe(true);
    expect(cell.italic).toBe(true);
    // 96 dpi CSS pixels → 72 dpi points.
    expect(cell.fontSize).toBe(12);
    expect(cell.padding).toEqual({ x: 9, y: 6 });
  });

  it("drops a fully transparent background instead of painting black", () => {
    const table = fakeTable({
      body: [[{ text: "x", style: { backgroundColor: "rgba(0, 0, 0, 0)" } }]],
    });
    expect(tableToRows(table, { computedStyle: readStyles }).rows[0]![0]!.fill).toBeUndefined();
  });

  it("reads per-side borders and keeps 'none' as no line", () => {
    const table = fakeTable({
      body: [
        [
          {
            text: "x",
            style: {
              borderTopStyle: "solid",
              borderTopWidth: "2px",
              borderTopColor: "#3366cc",
              borderBottomStyle: "none",
              borderLeftStyle: "solid",
              borderLeftWidth: "0px",
              borderLeftColor: "#000",
              borderRightStyle: "solid",
              borderRightWidth: "1px",
              borderRightColor: "transparent",
            },
          },
        ],
      ],
    });
    const borders = tableToRows(table, { computedStyle: readStyles }).rows[0]![0]!.borders!;
    expect(borders.top).toEqual({ width: 1.5, color: "#3366cc" });
    expect(borders.bottom).toBeNull();
    expect(borders.left).toBeNull(); // zero width
    expect(borders.right).toBeNull(); // transparent
  });

  it("switches off the table-wide border when CSS is in charge", () => {
    const table = fakeTable({ body: [["a"]] });
    expect(tableToRows(table, { computedStyle: readStyles }).options.borderWidth).toBe(0);
    expect(tableToRows(table, { styles: false }).options.borderWidth).toBeUndefined();
  });

  it("honors an explicit text-align and lets options.table win", () => {
    const table = fakeTable({
      body: [[{ text: "x", style: { textAlign: "center" } }]],
    });
    expect(tableToRows(table, { computedStyle: readStyles }).rows[0]![0]!.align).toBe("center");
    const forced = tableToRows(table, {
      computedStyle: readStyles,
      table: { aligns: ["right"] },
    });
    expect(forced.options.aligns).toEqual(["right"]);
  });
});

describe("tableToRows — the surface behind the table", () => {
  /** A table nested in a card, nested in a page — as on a real site. */
  function nested(styles: Record<string, Record<string, string>>): HTMLTableElement {
    const table = fakeTable({ body: [["a"]] }) as unknown as Record<string, unknown>;
    const card = element("div");
    const page = element("body");
    table.parentElement = card;
    card.parentElement = page;
    if (styles.table) stylesMap.set(table, styles.table);
    if (styles.card) stylesMap.set(card, styles.card);
    if (styles.page) stylesMap.set(page, styles.page);
    return table as unknown as HTMLTableElement;
  }

  it("takes the first real colour up the chain", () => {
    // The table itself is transparent, the card is not — so the card wins.
    const table = nested({
      table: { backgroundColor: "rgba(0, 0, 0, 0)" },
      card: { backgroundColor: "rgb(22, 27, 36)" },
      page: { backgroundColor: "rgb(15, 18, 24)" },
    });
    expect(tableToRows(table, { computedStyle: readStyles }).background).toBe("#161b24");
  });

  it("keeps looking past transparent ancestors", () => {
    const table = nested({
      table: { backgroundColor: "transparent" },
      card: { backgroundColor: "rgba(0, 0, 0, 0)" },
      page: { backgroundColor: "rgb(15, 18, 24)" },
    });
    expect(tableToRows(table, { computedStyle: readStyles }).background).toBe("#0f1218");
  });

  it("reports nothing when nothing up the chain has a colour", () => {
    const table = nested({});
    expect(tableToRows(table, { computedStyle: readStyles }).background).toBeUndefined();
  });

  it("stays out of it when the CSS reading is off", () => {
    const table = nested({ card: { backgroundColor: "rgb(22, 27, 36)" } });
    expect(tableToRows(table, { styles: false }).background).toBeUndefined();
  });

  it("reports the table's text colour for a heading above it", () => {
    const table = nested({ table: { color: "rgb(230, 233, 239)" } });
    expect(tableToRows(table, { computedStyle: readStyles }).inkColor).toBe("#e6e9ef");
  });
});

describe("tableToRows — numbers and widths", () => {
  it("right-aligns columns whose body cells all read as numbers", () => {
    const table = fakeTable({
      head: [["Item", "Qty", "Price"]],
      body: [
        ["Beans", "3", "24,00 €"],
        ["Filters", "12", "4.80"],
      ],
    });
    expect(tableToRows(table, { styles: false }).options.aligns).toEqual([
      "left",
      "right",
      "right",
    ]);
  });

  it("keeps a column left-aligned as soon as one cell is not a number", () => {
    const table = fakeTable({
      body: [
        ["a", "3"],
        ["b", "n/a"],
      ],
    });
    expect(tableToRows(table, { styles: false }).options.aligns).toEqual(["left", "left"]);
  });

  it("scales the browser's column proportions onto the given width", () => {
    const table = fakeTable({
      body: [
        [
          { text: "wide", width: 300 },
          { text: "narrow", width: 100 },
        ],
      ],
    });
    const { options } = tableToRows(table, { styles: false, width: 400 });
    expect(options.widths).toEqual([300, 100]);
  });

  it("omits widths when the table was never laid out", () => {
    const table = fakeTable({ body: [["a", "b"]] });
    expect(tableToRows(table, { styles: false, width: 400 }).options.widths).toBeUndefined();
  });
});

describe("tableToPDF", () => {
  const table = fakeTable({
    head: [["Item", "Qty"]],
    body: [["Beans", "3"]],
  });

  it("renders a document with the title, header and footer applied", async () => {
    const pdf = tableToPDF(table, {
      styles: false,
      title: "Revenue 2026",
      header: "Acme GmbH",
      footer: "Confidential",
      pageNumbers: true,
    });
    const bytes = await pdf.render();
    expect(bytes.length).toBeGreaterThan(500);
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.7");
    expect(pdf.pageCount).toBe(1);
  });

  // The decision rests on how narrow the table *could* be, not on how wide
  // the page happened to render it: a wide container is no reason to turn
  // the paper, a column of unbreakable words is.
  const unbreakable = (columns: number) =>
    fakeTable({
      body: [new Array(columns).fill("Donaudampfschifffahrtsgesellschaft")],
      width: 300,
    });

  it("keeps portrait while the content still fits", () => {
    const narrow = tableToPDF(unbreakable(2), { styles: false });
    expect(narrow.pageSize.width).toBeLessThan(narrow.pageSize.height);
  });

  it("turns the page when the columns cannot be squeezed in", () => {
    const wide = tableToPDF(unbreakable(4), { styles: false });
    expect(wide.pageSize.width).toBeGreaterThan(wide.pageSize.height);
  });

  it("does not turn the page just because the layout is wide", () => {
    const roomy = tableToPDF(fakeTable({ body: [["a", "b"]], width: 1200 }), { styles: false });
    expect(roomy.pageSize.width).toBeLessThan(roomy.pageSize.height);
  });

  it("obeys an explicit orientation", () => {
    const forced = tableToPDF(unbreakable(6), {
      styles: false,
      orientation: "portrait",
    });
    expect(forced.pageSize.width).toBeLessThan(forced.pageSize.height);

    const turned = tableToPDF(unbreakable(1), { styles: false, orientation: "landscape" });
    expect(turned.pageSize.width).toBeGreaterThan(turned.pageSize.height);
  });
});

describe("attachTablePdfButton", () => {
  function fakeButton(): HTMLElement & { clicks: (() => void)[]; disabled: boolean } {
    const listeners: (() => void)[] = [];
    return {
      clicks: listeners,
      disabled: false,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: (_: string, fn: () => void) => {
        const index = listeners.indexOf(fn);
        if (index >= 0) listeners.splice(index, 1);
      },
      setAttribute: () => {},
      removeAttribute: () => {},
      remove: () => {},
    } as unknown as HTMLElement & { clicks: (() => void)[]; disabled: boolean };
  }

  it("wires an existing button and reports failures through onError", async () => {
    const table = fakeTable({ body: [["a"]] });
    const button = fakeButton();
    const onError = vi.fn();
    const handle = attachTablePdfButton(table, {
      button,
      styles: false,
      onError,
      // An unknown page format fails inside the click handler, which keeps
      // the test off the filesystem — save() would really write a file here.
      format: "A9" as PageFormatName,
    });

    expect(handle.button).toBe(button);
    expect(button.clicks).toHaveLength(1);

    // The click must surface the failure through onError, never throw.
    button.clicks[0]!();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(button.disabled).toBe(false);
  });

  it("stops listening after destroy()", () => {
    const table = fakeTable({ body: [["a"]] });
    const button = fakeButton();
    attachTablePdfButton(table, { button, styles: false }).destroy();
    expect(button.clicks).toHaveLength(0);
  });

  // Placement and appearance of a *created* button need real DOM plumbing
  // (createElement, append, insertBefore), so these run against a minimal
  // stand-in document rather than the structural fakes above.
  describe("creating the button", () => {
    interface FakeNode {
      tagName: string;
      className: string;
      children: FakeNode[];
      parentElement: FakeNode | null;
      innerHTML: string;
      textContent: string;
      attributes: Record<string, string>;
      title: string;
      style: Record<string, string>;
      firstElementChild: FakeNode | null;
    }

    function node(tag: string): FakeNode {
      const self: FakeNode = {
        tagName: tag.toUpperCase(),
        className: "",
        children: [],
        parentElement: null,
        innerHTML: "",
        textContent: "",
        attributes: {},
        title: "",
        style: {} as Record<string, string>,
        firstElementChild: null,
      };
      const api = self as unknown as Record<string, unknown>;
      api.setAttribute = (name: string, value: string) => {
        self.attributes[name] = value;
      };
      api.removeAttribute = (name: string) => {
        delete self.attributes[name];
      };
      api.addEventListener = () => {};
      api.removeEventListener = () => {};
      api.remove = () => {
        const siblings = self.parentElement?.children;
        if (!siblings) return;
        const at = siblings.indexOf(self);
        if (at >= 0) siblings.splice(at, 1);
        self.parentElement = null;
      };
      api.append = (child: FakeNode) => {
        child.parentElement = self;
        self.children.push(child);
        if (!self.firstElementChild) self.firstElementChild = child;
      };
      api.prepend = (child: FakeNode) => {
        child.parentElement = self;
        self.children.unshift(child);
        self.firstElementChild = child;
      };
      api.insertBefore = (child: FakeNode, before: FakeNode | null) => {
        child.parentElement = self;
        const at = before ? self.children.indexOf(before) : -1;
        if (at === -1) self.children.push(child);
        else self.children.splice(at, 0, child);
      };
      Object.defineProperty(self, "nextSibling", {
        get() {
          const siblings = self.parentElement?.children ?? [];
          return siblings[siblings.indexOf(self) + 1] ?? null;
        },
      });
      return self;
    }

    /** Install a document stub for the duration of one test. */
    function withDocument(run: (root: FakeNode, byId: Record<string, FakeNode>) => void): void {
      const root = node("div");
      const byId: Record<string, FakeNode> = {};
      const stub = {
        createElement: (tag: string) => {
          const created = node(tag);
          // innerHTML assignment has to produce a first child, since the
          // icon path reaches for it to mark the glyph decorative.
          Object.defineProperty(created, "innerHTML", {
            get: () => (created as unknown as { _html?: string })._html ?? "",
            set: (html: string) => {
              (created as unknown as { _html?: string })._html = html;
              const glyph = node("svg");
              created.firstElementChild = glyph;
            },
          });
          return created;
        },
        querySelector: (selector: string) => byId[selector] ?? null,
      };
      const previous = (globalThis as { document?: unknown }).document;
      (globalThis as { document?: unknown }).document = stub;
      try {
        run(root, byId);
      } finally {
        (globalThis as { document?: unknown }).document = previous;
      }
    }

    function tableIn(root: FakeNode): HTMLTableElement {
      const table = fakeTable({ body: [["a"]] }) as unknown as FakeNode;
      (table as unknown as Record<string, unknown>).parentElement = root;
      root.children.push(table);
      Object.defineProperty(table, "nextSibling", {
        get() {
          const at = root.children.indexOf(table);
          return root.children[at + 1] ?? null;
        },
      });
      return table as unknown as HTMLTableElement;
    }

    it("puts the button right after the table by default", () => {
      withDocument((root) => {
        const table = tableIn(root);
        const { button } = attachTablePdfButton(table, { styles: false });
        expect(root.children.indexOf(button as unknown as FakeNode)).toBe(1);
        expect((button as unknown as FakeNode).textContent).toBe("Download PDF");
      });
    });

    it("places it before the table on request", () => {
      withDocument((root) => {
        const table = tableIn(root);
        const { button } = attachTablePdfButton(table, { styles: false, position: "before" });
        expect(root.children.indexOf(button as unknown as FakeNode)).toBe(0);
      });
    });

    it("mounts it into any container you name", () => {
      withDocument((root, byId) => {
        const table = tableIn(root);
        const toolbar = node("div");
        byId["#toolbar"] = toolbar;

        const { button } = attachTablePdfButton(table, { styles: false, mount: "#toolbar" });
        expect(toolbar.children).toContain(button as unknown as FakeNode);
        expect(root.children).not.toContain(button as unknown as FakeNode);
      });
    });

    it("can prepend into that container, or sit beside it", () => {
      withDocument((root, byId) => {
        const table = tableIn(root);
        const toolbar = node("div");
        const first = node("span");
        toolbar.children.push(first);
        toolbar.parentElement = root;
        root.children.push(toolbar);
        byId["#toolbar"] = toolbar;

        const prepended = attachTablePdfButton(table, {
          styles: false,
          mount: toolbar as unknown as HTMLElement,
          position: "prepend",
        }).button as unknown as FakeNode;
        expect(toolbar.children[0]).toBe(prepended);

        const beside = attachTablePdfButton(table, {
          styles: false,
          mount: toolbar as unknown as HTMLElement,
          position: "before",
        }).button as unknown as FakeNode;
        expect(root.children.indexOf(beside)).toBe(root.children.indexOf(toolbar) - 1);
      });
    });

    it("puts the button in any of the four corners", () => {
      withDocument((root) => {
        const table = tableIn(root);
        // Each case cleans up after itself, so the table is back at index 0
        // every round: a top row lands before it, a bottom row after it.
        const cases = [
          ["top-left", 0, "flex-start"],
          ["top-right", 0, "flex-end"],
          ["bottom-left", 1, "flex-start"],
          ["bottom-right", 1, "flex-end"],
        ] as const;

        for (const [position, expectedIndex, justify] of cases) {
          const handle = attachTablePdfButton(table, { styles: false, position });
          const row = (handle.button as unknown as FakeNode).parentElement!;
          expect(row.className).toBe("fast-pdf-download-row");
          expect(row.style.display).toBe("flex");
          expect(row.style.justifyContent).toBe(justify);
          // The row — not the bare button — is what sits beside the table.
          expect(root.children.indexOf(row)).toBe(expectedIndex);
          handle.destroy();
          // destroy() takes the wrapper with it, not just the button.
          expect(root.children).not.toContain(row);
        }
      });
    });

    it("puts a corner button inside a container that was named", () => {
      withDocument((root, byId) => {
        const table = tableIn(root);
        const toolbar = node("div");
        const existing = node("span");
        toolbar.children.push(existing);
        byId["#toolbar"] = toolbar;

        const handle = attachTablePdfButton(table, {
          styles: false,
          mount: "#toolbar",
          position: "top-right",
        });
        const row = (handle.button as unknown as FakeNode).parentElement!;
        // "top" of a container means its start, not the space above it.
        expect(toolbar.children[0]).toBe(row);
        expect(row.style.justifyContent).toBe("flex-end");
      });
    });

    it("reports a mount selector that matches nothing", () => {
      withDocument((root) => {
        const table = tableIn(root);
        expect(() => attachTablePdfButton(table, { styles: false, mount: "#nowhere" })).toThrow(
          FastPDFError,
        );
      });
    });

    it("builds an icon-only button that still has an accessible name", () => {
      withDocument((root) => {
        const table = tableIn(root);
        const button = attachTablePdfButton(table, {
          styles: false,
          icon: true,
          ariaLabel: "Download revenue as PDF",
        }).button as unknown as FakeNode;

        expect(button.innerHTML).toContain("<svg");
        expect(button.textContent).toBe("");
        expect(button.attributes["aria-label"]).toBe("Download revenue as PDF");
        expect(button.title).toBe("Download revenue as PDF");
        expect(button.firstElementChild?.attributes["aria-hidden"]).toBe("true");
      });
    });

    it("takes custom icon markup and pairs it with a label", () => {
      withDocument((root) => {
        const table = tableIn(root);
        const button = attachTablePdfButton(table, {
          styles: false,
          icon: "<span class='my-icon'></span>",
          label: "Export",
        }).button as unknown as FakeNode;

        expect(button.innerHTML).toBe("<span class='my-icon'></span>");
        expect(button.children.at(-1)?.textContent).toBe("Export");
        // With visible text there is no need for an aria-label.
        expect(button.attributes["aria-label"]).toBeUndefined();
      });
    });
  });

  it("refuses a source that holds no table", () => {
    const div = element("div", { querySelector: () => null }) as unknown as HTMLElement;
    expect(() => attachTablePdfButton(div)).toThrow(FastPDFError);
  });
});
