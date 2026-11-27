import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/index";
import { EmbeddedFont } from "../src/fonts/embedded";
import { TTFFont } from "../src/fonts/ttf";
import { escapeString, latin1String } from "../src/pdf/objects";
import { makeTTF } from "./helpers";

/**
 * The synthetic font: glyph 1 = "A", 2 = "B", 3 = "C", every advance 600 at
 * 1000 units/em — so widths can be checked by hand. The layout tables below
 * are assembled word by word, which doubles as documentation of exactly
 * which OpenType structures the reader understands.
 */
const A = 1;
const B = 2;
const C = 3;

const u16 = (...values: number[]): Uint8Array => {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint16(i * 2, value & 0xffff));
  return out;
};
const tag = (text: string): number[] => [
  (text.charCodeAt(0) << 8) | text.charCodeAt(1),
  (text.charCodeAt(2) << 8) | text.charCodeAt(3),
];
const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** A GPOS/GSUB table with one script, one feature and one lookup holding `subtable`. */
function layoutTable(
  feature: string,
  lookupType: number,
  subtable: Uint8Array,
  options: { script?: string; extension?: number } = {},
): Uint8Array {
  let body = subtable;
  let type = lookupType;
  if (options.extension !== undefined) {
    // Extension subtable: format 1, the real type, a 32-bit offset to it.
    body = join(u16(1, lookupType, 0, 8), subtable);
    type = options.extension;
  }
  const scriptList = u16(
    ...[1, ...tag(options.script ?? "latn"), 8], // one script record
    ...[4, 0], // Script: default LangSys at 4, no others
    ...[0, 0xffff, 1, 0], // LangSys: no required feature, feature index 0
  );
  const featureList = u16(1, ...tag(feature), 8, 0, 1, 0);
  const lookupList = join(u16(1, 4, type, 0, 1, 8), body);
  const header = u16(1, 0, 10, 10 + scriptList.length, 10 + scriptList.length + featureList.length);
  return join(header, scriptList, featureList, lookupList);
}

/** PairPos format 1: the pair (A, B) → xAdvance `value` on the first glyph. */
const pairFormat1 = (value: number): Uint8Array =>
  join(
    u16(1, 18, 0x0004, 0, 1, 12), // coverage at 18, valueFormat1 = xAdvance, one pair set at 12
    u16(1, B, value), // PairSet: one record
    u16(1, 1, A), // Coverage format 1: [A]
  );

/** PairPos format 2: class of A × class of B → xAdvance `value`. */
const pairFormat2 = (value: number): Uint8Array =>
  join(
    u16(2, 24, 0x0004, 0, 34, 42, 2, 2), // coverage, formats, classDef1, classDef2, 2 × 2 classes
    u16(0, 0, 0, value), // records [0][0], [0][1], [1][0], [1][1]
    u16(2, 1, A, A, 0), // Coverage format 2: range A..A
    u16(1, A, 1, 1), // ClassDef format 1: A → class 1
    u16(2, 1, B, B, 1), // ClassDef format 2: B..B → class 1
  );

/** Ligature substitution: A followed by B becomes C. */
const ligatureAB = (): Uint8Array =>
  join(
    u16(1, 18, 1, 8), // coverage at 18, one ligature set at 8
    u16(1, 4, C, 2, B), // LigatureSet → Ligature: glyph C, 2 components, second is B
    u16(1, 1, A), // Coverage: [A]
  );

/** Legacy `kern` table, format 0: (A, B) → `value`. */
const legacyKern = (value: number): Uint8Array => u16(0, 1, 0, 20, 0x0001, 1, 0, 0, 0, A, B, value);

const gid = (id: number): string => String.fromCharCode(0, id);
/** A glyph run as it appears between the parentheses of a PDF string. */
const pdf = (...ids: number[]): string => escapeString(ids.map(gid).join(""));
const font = (tables: [string, Uint8Array][], features = {}): EmbeddedFont =>
  new EmbeddedFont("test", makeTTF(tables), features);

describe("kerning", () => {
  it.each([
    ["GPOS pair adjustment, format 1", layoutTable("kern", 2, pairFormat1(-100))],
    ["GPOS pair adjustment, format 2 (classes)", layoutTable("kern", 2, pairFormat2(-100))],
    [
      "GPOS through an extension lookup",
      layoutTable("kern", 2, pairFormat1(-100), { extension: 9 }),
    ],
    ["GPOS under the DFLT script", layoutTable("kern", 2, pairFormat1(-100), { script: "DFLT" })],
    [
      "GPOS under some other script only",
      layoutTable("kern", 2, pairFormat1(-100), { script: "cyrl" }),
    ],
  ])("reads %s", (_, table) => {
    const kerned = font([["GPOS", table]]);
    expect(kerned.ttf.features.kern(A, B)).toBe(-100);
    expect(kerned.ttf.features.kern(B, A)).toBe(0);
    expect(kerned.ttf.features.kern(A, C)).toBe(0);
  });

  it("reads the legacy kern table when there is no GPOS kerning", () => {
    expect(font([["kern", legacyKern(-80)]]).ttf.features.kern(A, B)).toBe(-80);
  });

  it("prefers GPOS over the legacy table", () => {
    const both = font([
      ["GPOS", layoutTable("kern", 2, pairFormat1(-100))],
      ["kern", legacyKern(-80)],
    ]);
    expect(both.ttf.features.kern(A, B)).toBe(-100);
  });

  it("measures and draws the same kerned line", () => {
    const kerned = font([["GPOS", layoutTable("kern", 2, pairFormat1(-100))]]);
    // 600 + 600 − 100 font units at 10 pt.
    expect(kerned.widthOf("AB", 10)).toBeCloseTo(11);
    expect(kerned.widthOf("BA", 10)).toBeCloseTo(12);
    // TJ subtracts its numbers, so tightening by 100 is written as +100.
    expect(kerned.layout("AB")).toEqual([gid(A), 100, gid(B)]);
    expect(kerned.layout("BA")).toEqual([gid(B) + gid(A)]);
    expect(kerned.layout("ABAB")).toEqual([gid(A), 100, gid(B) + gid(A), 100, gid(B)]);
  });

  it("can be switched off per font", () => {
    const plain = font([["GPOS", layoutTable("kern", 2, pairFormat1(-100))]], { kerning: false });
    expect(plain.widthOf("AB", 10)).toBeCloseTo(12);
    expect(plain.layout("AB")).toEqual([gid(A) + gid(B)]);
  });

  it("keeps kerning when the text is letter-spaced", () => {
    const kerned = font([["GPOS", layoutTable("kern", 2, pairFormat1(-100))]]);
    expect(kerned.widthOf("AB", 10, true)).toBeCloseTo(11);
  });

  it("leaves encode() untouched: one glyph per character, no adjustments", () => {
    const kerned = font([["GPOS", layoutTable("kern", 2, pairFormat1(-100))]]);
    expect(kerned.encode("AB")).toBe(gid(A) + gid(B));
  });
});

describe("ligatures", () => {
  const liga = (): EmbeddedFont => font([["GSUB", layoutTable("liga", 4, ligatureAB())]]);

  it("forms a ligature and counts its width once", () => {
    const f = liga();
    expect(f.layout("AB")).toEqual([gid(C)]);
    expect(f.widthOf("AB", 10)).toBeCloseTo(6);
    expect(f.layout("BAB")).toEqual([gid(B) + gid(C)]);
    expect(f.layout("BA")).toEqual([gid(B) + gid(A)]);
  });

  it("reads ligatures through an extension lookup", () => {
    const f = font([["GSUB", layoutTable("liga", 4, ligatureAB(), { extension: 7 })]]);
    expect(f.layout("AB")).toEqual([gid(C)]);
  });

  it("ignores other substitution features", () => {
    const f = font([["GSUB", layoutTable("dlig", 4, ligatureAB())]]);
    expect(f.layout("AB")).toEqual([gid(A) + gid(B)]);
  });

  it("does not form ligatures in letter-spaced text or when switched off", () => {
    expect(liga().layout("AB", true)).toEqual([gid(A) + gid(B)]);
    expect(liga().widthOf("AB", 10, true)).toBeCloseTo(12);
    const off = font([["GSUB", layoutTable("liga", 4, ligatureAB())]], { ligatures: false });
    expect(off.layout("AB")).toEqual([gid(A) + gid(B)]);
  });

  it("kerns against the ligature glyph, not the letters it replaced", () => {
    // Pair (A, B) is kerned, but A+B becomes C before kerning is looked up.
    const f = font([
      ["GSUB", layoutTable("liga", 4, ligatureAB())],
      ["GPOS", layoutTable("kern", 2, pairFormat1(-100))],
    ]);
    expect(f.layout("AB")).toEqual([gid(C)]);
    expect(f.widthOf("AB", 10)).toBeCloseTo(6);
  });

  it("maps the ligature glyph back to every character in ToUnicode", async () => {
    const doc = new PDFDocument({ font: "t", compress: false });
    doc.registerFont(makeTTF([["GSUB", layoutTable("liga", 4, ligatureAB())]]), { family: "t" });
    doc.text("AB");
    const out = latin1String(await doc.render());
    // Glyph C stands for "AB": search and copy must still find both letters.
    expect(out).toContain("<0003> <00410042>");
    expect(out).toContain(`(${pdf(C)}) Tj`);
  });
});

describe("justification with a shaped font", () => {
  it("adds the gap adjustment after each space", () => {
    const f = font([["GPOS", layoutTable("kern", 2, pairFormat1(-100))]]);
    const space = String.fromCharCode(0, 0); // the test font has no space glyph
    expect(f.layout("AB AB", false, -250)).toEqual([
      gid(A),
      100,
      gid(B) + space,
      -250,
      gid(A),
      100,
      gid(B),
    ]);
  });
});

describe("hostile and broken layout tables", () => {
  it.each([
    ["an empty table", new Uint8Array(0)],
    ["a truncated header", u16(1, 0, 10)],
    ["offsets pointing past the end", u16(1, 0, 0xfff0, 0xfff0, 0xfff0)],
    ["a table cut off mid-lookup", layoutTable("kern", 2, pairFormat1(-100)).slice(0, 40)],
  ])("treats %s as a font without features", (_, table) => {
    for (const name of ["GPOS", "GSUB", "kern"]) {
      const broken = font([[name, table]]);
      expect(broken.widthOf("AB", 10)).toBeCloseTo(12);
      expect(broken.layout("AB")).toEqual([gid(A) + gid(B)]);
    }
  });

  it("survives a subtable that lies about its contents", () => {
    // A pair set whose count claims 65,535 records in a 6-byte table.
    const lying = join(u16(1, 18, 0x0004, 0, 1, 12), u16(0xffff, B, -100), u16(1, 1, A));
    const f = font([["GPOS", layoutTable("kern", 2, lying)]]);
    expect(() => f.widthOf("ABAB", 10)).not.toThrow();
  });

  it("stops expanding a ligature table that points at itself", () => {
    // 65,535 ligature sets, every offset 0: each "set" is the subtable again.
    const bomb = join(u16(1, 8, 0xffff, 0), u16(2, 1, 0, 0xffff, 0));
    const started = Date.now();
    const parsed = new TTFFont(makeTTF([["GSUB", layoutTable("liga", 4, bomb)]]));
    expect(() => parsed.features).not.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("kerning in a document", () => {
  const kernTable: [string, Uint8Array][] = [["GPOS", layoutTable("kern", 2, pairFormat1(-100))]];

  it("draws kerned text as a TJ array and unkerned text as a plain string", async () => {
    const doc = new PDFDocument({ font: "t", compress: false });
    doc.registerFont(makeTTF(kernTable), { family: "t" });
    doc.registerFont(makeTTF(kernTable), { family: "plain", kerning: false });
    doc.text("AB");
    doc.text("AB", { font: "plain" });
    const out = latin1String(await doc.render());
    expect(out).toContain(`[(${pdf(A)}) 100 (${pdf(B)})] TJ`);
    expect(out).toContain(`(${pdf(A, B)}) Tj`);
  });

  it("uses the kerned width for measuring and alignment", () => {
    const doc = new PDFDocument({ font: "t", fontSize: 10 });
    doc.registerFont(makeTTF(kernTable), { family: "t" });
    doc.registerFont(makeTTF(kernTable), { family: "plain", kerning: false });
    expect(doc.widthOfText("AB")).toBeCloseTo(11);
    expect(doc.widthOfText("AB", { font: "plain" })).toBeCloseTo(12);
    // A B A B: the pair (A, B) occurs twice → 2400 − 200 units.
    expect(doc.measureText("ABAB").width).toBeCloseTo(22);
  });

  it("kerns table cells too", async () => {
    const doc = new PDFDocument({ font: "t", compress: false });
    doc.registerFont(makeTTF(kernTable), { family: "t" });
    doc.table([["AB"]], { header: false });
    expect(latin1String(await doc.render())).toContain(`[(${pdf(A)}) 100 (${pdf(B)})] TJ`);
  });
});

describe("hyphenate", () => {
  const syllables: Record<string, string[]> = {
    Silbentrennung: ["Sil", "ben", "tren", "nung"],
    Donaudampfschiff: ["Do", "nau", "dampf", "schiff"],
  };
  const hyphenate = (word: string): string[] => syllables[word] ?? [word];

  it("breaks a word at a syllable, with a hyphen, when the line is full", () => {
    const plain = new PDFDocument();
    const hyphenated = new PDFDocument({ hyphenate });
    const text = "Eine Silbentrennung";
    const width = plain.widthOfText("Eine Silbentr");
    // Without the callback the word moves to the next line whole.
    expect(plain.measureText(text, { width }).lines).toEqual(["Eine", "Silbentrennu", "ng"]);
    // …with it, the line is filled up to the last syllable that fits.
    expect(hyphenated.measureText(text, { width }).lines).toEqual(["Eine Silben-", "trennung"]);
  });

  it("draws the hyphen only where the break happens", async () => {
    const doc = new PDFDocument({ hyphenate, compress: false });
    const width = doc.widthOfText("Eine Silbentr");
    doc.text("Eine Silbentrennung", { width });
    doc.text("Silbentrennung");
    const pdf = latin1String(await doc.render());
    expect(pdf).toContain("(Eine Silben-) Tj");
    expect(pdf).toContain("(trennung) Tj");
    expect(pdf).toContain("(Silbentrennung) Tj");
  });

  it("hyphenates table cells", async () => {
    const doc = new PDFDocument({ hyphenate, compress: false });
    doc.table([["Donaudampfschiff"]], { header: false, widths: [70] });
    const pdf = latin1String(await doc.render());
    expect(pdf).toMatch(/\((Do|Donau|Donaudampf)-\) Tj/);
  });

  it("is only asked about words of five letters or more", () => {
    const seen: string[] = [];
    const doc = new PDFDocument({
      hyphenate: (word) => {
        seen.push(word);
        return [word];
      },
    });
    doc.text("Ein sehr langes Wörterbuch, 12345 und R2-D2.");
    expect(seen).toEqual(["langes", "Wörterbuch"]);
  });

  it("ignores a callback result that would change the text", async () => {
    for (const bad of [
      () => ["Sil", "ben"], // not the whole word
      () => ["X", "Y"], // different letters
      () => "Sil-ben" as unknown as string[], // not an array
      () => [] as string[],
    ]) {
      const doc = new PDFDocument({ hyphenate: bad, compress: false });
      doc.text("Silbentrennung", { width: 40 });
      const pdf = latin1String(await doc.render());
      expect(pdf).not.toContain("-) Tj");
    }
  });

  it("leaves documents without the option exactly as they were", async () => {
    const render = async (options: object): Promise<string> => {
      const doc = new PDFDocument({ deterministic: true, ...options });
      doc.text("Eine Silbentrennung findet nicht statt.", { width: 80 });
      return latin1String(await doc.render());
    };
    expect(await render({ hyphenate: (word: string) => [word] })).toBe(await render({}));
  });
});
