/**
 * Regressions for the issues reported from the CV-builder field report
 * (fast-pdf 0.5.0). Each test names the symptom it locks down.
 */
import { describe, expect, it } from "vitest";
import { FastPDFError, PDFDocument, supportsEncryption } from "../src/index";
import { breakAtoms, wrapLines } from "../src/layout/text";
import { parsePath } from "../src/svg/path";
import { resolveFont } from "../src/fonts/font";
import { latin1String } from "../src/pdf/objects";

const raw = () => new PDFDocument({ compress: false });

async function rendered(pdf: PDFDocument): Promise<string> {
  return latin1String(await pdf.render());
}

describe("line breaking at hyphens and slashes", () => {
  it('breaks "Full-Stack-Entwickler" in a narrow column instead of overflowing', () => {
    const font = resolveFont("helvetica", false, false);
    const lines = wrapLines("Full-Stack-Entwickler", font, 9, 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(font.widthOf(line.text, 9)).toBeLessThanOrEqual(60);
    // The hyphen stays on the first line — no extra hyphen is invented.
    expect(lines[0]!.text.endsWith("-")).toBe(true);
    expect(lines.map((l) => l.text).join("")).toBe("Full-Stack-Entwickler");
  });

  it("breaks after a slash", () => {
    const font = resolveFont("helvetica", false, false);
    const lines = wrapLines("Frontend/Backend/Fullstack", font, 9, 50);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.text).join("")).toBe("Frontend/Backend/Fullstack");
  });

  it("keeps dates and fractions together (no break between digits)", () => {
    expect(breakAtoms("2026-08-01")).toEqual(["2026-08-01"]);
    expect(breakAtoms("3/4")).toEqual(["3/4"]);
  });

  it("does not break at a leading or trailing hyphen", () => {
    expect(breakAtoms("-5")).toEqual(["-5"]);
    expect(breakAtoms("Test-")).toEqual(["Test-"]);
    expect(breakAtoms("--x")).toEqual(["--x"]);
  });

  it("splits en and em dashes too", () => {
    expect(breakAtoms("Berlin–Hamburg")).toEqual(["Berlin–", "Hamburg"]);
  });

  it("leaves ordinary text untouched", () => {
    const font = resolveFont("helvetica", false, false);
    const lines = wrapLines("ein ganz normaler Satz", font, 11, 500);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("ein ganz normaler Satz");
  });

  it("still respects soft hyphens, adding a visible hyphen when it breaks there", () => {
    const font = resolveFont("helvetica", false, false);
    const lines = wrapLines("Silben­trennung", font, 11, 40);
    expect(lines[0]!.text).toContain("-");
  });

  it("drawn lines match measured lines for hyphenated content", () => {
    const pdf = raw();
    const content = "Senior Full-Stack-Entwickler und Cloud/DevOps-Spezialist";
    const m = pdf.measureText(content, { width: 104, size: 9 });
    const before = pdf.y;
    pdf.text(content, { width: 104, size: 9 });
    expect(pdf.y - before).toBeCloseTo(m.height, 6);
  });
});

describe("SVG arc parsing", () => {
  it("reads compacted arc flags (a1 1 0 011 0 → large=0, sweep=1, x=1, y=0)", () => {
    const compact = parsePath("M0 0a5 5 0 0110 0");
    const spaced = parsePath("M0 0a5 5 0 0 1 10 0");
    expect(compact).toEqual(spaced);
    expect(compact.length).toBeGreaterThan(1);
  });

  it("renders a Lucide-style icon path without NaN coordinates", () => {
    // The globe icon: circle plus two arcs, exactly the shape the report
    // had to rebuild by hand from circle/ellipse/path.
    const d = "M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z";
    const segs = parsePath(d);
    expect(segs.length).toBeGreaterThan(6);
    for (const seg of segs) {
      for (const [key, value] of Object.entries(seg)) {
        if (key === "op") continue;
        expect(Number.isFinite(value as number)).toBe(true);
      }
    }
  });

  it("handles relative arcs the same as their absolute equivalent", () => {
    const rel = parsePath("M10 10 a5 5 0 0 1 10 0");
    const abs = parsePath("M10 10 A5 5 0 0 1 20 10");
    expect(rel).toEqual(abs);
  });

  it("honours large-arc and sweep combinations", () => {
    const seen = new Set<string>();
    for (const large of [0, 1]) {
      for (const sweep of [0, 1]) {
        const segs = parsePath(`M0 0A20 20 0 ${large} ${sweep} 20 20`);
        expect(segs.length).toBeGreaterThan(1);
        seen.add(JSON.stringify(segs));
      }
    }
    expect(seen.size).toBe(4); // all four render differently
  });

  it("drops a zero-length arc instead of emitting NaN (SVG F.6.2)", () => {
    const segs = parsePath("M10 10 A5 5 0 0 1 10 10");
    expect(segs).toEqual([{ op: "M", x: 10, y: 10 }]);
  });

  it("repeats implicit arc parameter sets", () => {
    const segs = parsePath("M0 0 a5 5 0 0 1 10 0 5 5 0 0 1 10 0");
    const curves = segs.filter((s) => s.op === "C");
    expect(curves.length).toBeGreaterThanOrEqual(4);
  });

  it("still parses the other commands", () => {
    expect(parsePath("M0 0 L10 0 H20 V20 Z")).toEqual([
      { op: "M", x: 0, y: 0 },
      { op: "L", x: 10, y: 0 },
      { op: "L", x: 20, y: 0 },
      { op: "L", x: 20, y: 20 },
      { op: "Z" },
    ]);
  });

  it("renders an arc-based icon through svg() without NaN in the stream", async () => {
    const pdf = raw();
    pdf.svg(
      '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z" fill="#333"/></svg>',
      { width: 24 },
    );
    const text = await rendered(pdf);
    expect(text).not.toContain("NaN");
    expect(text).toContain(" c\n");
  });
});

describe("encryption ergonomics", () => {
  it("accepts permissions without any password (no dummy owner password needed)", async () => {
    if (!supportsEncryption()) return;
    const pdf = new PDFDocument({
      encrypt: { permissions: { printing: false, copying: false } },
    });
    pdf.text("gesperrte Vorschau");
    const text = latin1String(await pdf.render());
    expect(text).toContain("/Encrypt");
    expect(text).toContain("/AESV3");
  });

  it("still rejects an encrypt block with neither passwords nor permissions", async () => {
    if (!supportsEncryption()) return;
    const pdf = new PDFDocument({ encrypt: {} });
    pdf.text("x");
    await expect(pdf.render()).rejects.toThrow(FastPDFError);
  });

  it("produces a different owner hash on each render (random owner password)", async () => {
    if (!supportsEncryption()) return;
    const build = async (): Promise<string> => {
      const pdf = new PDFDocument({ encrypt: { permissions: { printing: false } } });
      pdf.text("x");
      return latin1String(await pdf.render());
    };
    expect(await build()).not.toBe(await build());
  });

  it("onUnsupported: 'skip' falls back to an unencrypted document", async () => {
    const crypto = globalThis.crypto;
    // Simulate an insecure browser context: no Web Crypto at all.
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      const pdf = new PDFDocument({
        compress: false,
        encrypt: { userPassword: "geheim", onUnsupported: "skip" },
      });
      pdf.text("Vorschau");
      const text = latin1String(await pdf.render());
      expect(text).not.toContain("/Encrypt");
      expect(text).toContain("Vorschau");
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true });
    }
  });

  it("onUnsupported defaults to throwing", async () => {
    const crypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      const pdf = new PDFDocument({ encrypt: { userPassword: "geheim" } });
      pdf.text("x");
      await expect(pdf.render()).rejects.toThrow(/Web Crypto/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true });
    }
  });
});

describe("document language", () => {
  it("writes /Lang into the catalog", async () => {
    const pdf = new PDFDocument({ compress: false, language: "de-DE" });
    pdf.text("Lebenslauf");
    expect(await rendered(pdf)).toContain("/Lang");
  });

  it("omits /Lang when no language is set", async () => {
    const pdf = raw();
    pdf.text("x");
    expect(await rendered(pdf)).not.toContain("/Lang");
  });

  it("asks viewers to show the title instead of the filename", async () => {
    const pdf = new PDFDocument({ compress: false, metadata: { title: "Lebenslauf" } });
    pdf.text("x");
    const text = await rendered(pdf);
    expect(text).toContain("/ViewerPreferences");
    expect(text).toContain("/DisplayDocTitle true");
  });
});

describe("table valign and custom cells", () => {
  it("centres a short cell against a tall neighbour", async () => {
    const rows = [
      ["Kopf A", "Kopf B"],
      [{ text: "kurz", valign: "middle" as const }, { text: "eine ziemlich lange Zelle, die über mehrere Zeilen umbricht und die Zeile hoch macht" }],
    ];
    const middle = raw();
    middle.table(rows, { widths: [80, 120] });
    const top = raw();
    top.table(
      [rows[0]!, [{ text: "kurz" }, rows[1]![1]!]],
      { widths: [80, 120] },
    );
    // The centred cell's baseline sits lower than the top-aligned one.
    const yOf = (text: string): number =>
      Number(/\(kurz\) Tj/.exec(text) ? /([\d.]+) ([\d.]+) Td \(kurz\)/.exec(text)![2] : NaN);
    expect(yOf(await rendered(middle))).toBeLessThan(yOf(await rendered(top)));
  });

  it("applies a table-wide valign", async () => {
    const pdf = raw();
    pdf.table(
      [["A", "B"], ["x", "eine Zelle, die umbricht und die Zeilenhöhe deutlich vergrößert"]],
      { widths: [60, 120], valign: "bottom" },
    );
    expect(await rendered(pdf)).toContain("(x) Tj");
  });

  it("lets a cell draw itself, sizing the row from the measured content", async () => {
    const pdf = raw();
    pdf.table(
      [
        ["Skill", "Niveau"],
        [
          "TypeScript",
          {
            render: (d, box) => {
              d.rect(box.x, box.y, box.width, 8, { fill: "#e5e7eb", radius: 4 });
              d.rect(box.x, box.y, box.width * 0.9, 8, { fill: "#2563eb", radius: 4 });
              d.y = box.y + 8;
            },
          },
        ],
      ],
      { widths: [120, 160] },
    );
    const text = await rendered(pdf);
    expect(text).toContain("0.1451 0.3882 0.9216 rg"); // the blue bar
    expect(text).not.toContain("NaN");
    // The row grew to fit the 8pt bar plus padding, not just one text line.
    expect(text).toContain("(TypeScript) Tj");
  });

  it("isolates the cell cursor: a render callback moving doc.y cannot shift later rows", () => {
    // Both tables declare 20pt cells, so both must advance identically —
    // the only difference is that one callback also stomps on doc.y.
    const build = (stomp: boolean) => {
      const pdf = raw();
      pdf.table(
        [
          ["Kopf"],
          ...["A", "B", "C"].map((label) => [
            {
              height: 20,
              render: (d: PDFDocument, box: { x: number; y: number }) => {
                d.text(label, { x: box.x, y: box.y });
                if (stomp) d.y = box.y + 500;
              },
            },
          ]),
        ],
        { widths: [200] },
      );
      return pdf.y;
    };
    expect(build(true)).toBeCloseTo(build(false), 6);
  });

  it("sizes a render row from the height the callback reports", () => {
    const pdf = raw();
    const short = raw();
    short.table([["A"], [{ render: (d, box) => { d.y = box.y + 6; } }]], { widths: [100] });
    pdf.table([["A"], [{ render: (d, box) => { d.y = box.y + 60; } }]], { widths: [100] });
    expect(pdf.y).toBeGreaterThan(short.y + 40);
  });

  it("honours an explicit render height", () => {
    const pdf = raw();
    const before = pdf.y;
    pdf.table([["A"], [{ render: (d, box) => d.rect(box.x, box.y, 10, 10), height: 60 }]], {
      widths: [100],
    });
    // Header row + a body row at least 60pt tall plus padding.
    expect(pdf.y - before).toBeGreaterThan(60);
  });

  it("keeps plain string tables byte-identical to 0.5.0 behaviour", async () => {
    const pdf = raw();
    pdf.table([["A", "B"], ["1", "2"]]);
    const text = await rendered(pdf);
    expect(text).toContain("(A) Tj");
    expect(text).toContain("(2) Tj");
  });
});
