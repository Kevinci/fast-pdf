import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/document/document";
import { FastPDFError } from "../src/errors";
import { latin1String, textString, serialize } from "../src/pdf/objects";
import { supportsEncryption } from "../src/pdf/encrypt";
import { makeObjStmPdf } from "./helpers";

const render = async (doc: PDFDocument): Promise<string> => latin1String(await doc.render());

/** Every indirect object of an uncompressed, unencrypted file: number → body. */
function objects(pdf: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of pdf.matchAll(/(?:^|\n)(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) {
    out.set(Number(m[1]), m[2]!);
  }
  return out;
}

/** The single object whose body contains `needle`. */
function objectWith(pdf: string, needle: string): { num: number; body: string } {
  const hits = [...objects(pdf)].filter(([, body]) => body.includes(needle));
  expect(hits, `objects containing ${needle}`).toHaveLength(1);
  return { num: hits[0]![0], body: hits[0]![1] };
}

/** The body of object `num`. */
const body = (pdf: string, num: number): string => objects(pdf).get(num)!;

/** Object numbers referenced as `/Key n 0 R` inside a body. */
const ref = (text: string, key: string): number => {
  const m = new RegExp(`/${key} (\\d+) 0 R`).exec(text);
  expect(m, `/${key} reference`).not.toBeNull();
  return Number(m![1]);
};

/** The /Ff value of a field dictionary (0 when absent). */
const ff = (text: string): number => Number(/\/Ff (\d+)/.exec(text)?.[1] ?? 0);

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof FastPDFError ? e.code : "not a FastPDFError";
  }
  return undefined;
};

/** The catalog's /AcroForm dictionary, brackets balanced. */
function acroForm(pdf: string): string {
  const start = pdf.indexOf("/AcroForm <<");
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < pdf.length; i++) {
    if (pdf.startsWith("<<", i)) {
      depth++;
      i++;
    } else if (pdf.startsWith(">>", i)) {
      depth--;
      i++;
      if (depth === 0) return pdf.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced /AcroForm");
}

/** A field's literal /T as the serializer writes it. */
const t = (name: string): string => `/T ${serialize(textString(name))}`;

describe("textField()", () => {
  it("writes a merged /Tx field + widget with value, flags and a real appearance", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.textField({ name: "email", value: "max@example.com", required: true, maxLength: 80 });
    const pdf = await render(doc);
    const { body: field } = objectWith(pdf, "/FT /Tx");
    expect(field).toContain("/Type /Annot");
    expect(field).toContain("/Subtype /Widget");
    expect(field).toContain("/T (email)");
    expect(field).toContain("/V (max@example.com)");
    expect(field).toContain("/DV (max@example.com)");
    expect(field).toContain("/F 4");
    expect(field).toContain("/MaxLen 80");
    expect(field).toMatch(/\/DA \(\/Helv 10 Tf 0 g\)/);
    expect(field).toMatch(/\/P \d+ 0 R/);
    expect(ff(field)).toBe(2); // Required
    expect(field).not.toContain("/Q ");

    const ap = body(pdf, ref(field, "N"));
    expect(ap).toContain("/Subtype /Form");
    expect(ap).toMatch(/\/BBox \[0 0 200 22\]/);
    expect(ap).toMatch(/\/Resources << \/Font << \/Helv \d+ 0 R >> >>/);
    expect(ap).toContain("/Tx BMC");
    expect(ap).toContain("EMC");
    expect(ap).toContain("/Helv 10 Tf");
    expect(ap).toContain("(max@example.com) Tj");
    expect(ap).toContain(" re"); // border and background
  });

  it("sets the multiline, password, read-only and alignment bits", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.textField({ name: "notes", multiline: true, readOnly: true, align: "center" });
    doc.textField({ name: "pin", password: true, align: "right" });
    const pdf = await render(doc);
    const notes = objectWith(pdf, "/T (notes)").body;
    expect(ff(notes)).toBe(1 | (1 << 12));
    expect(notes).toContain("/Q 1");
    const pin = objectWith(pdf, "/T (pin)").body;
    expect(ff(pin)).toBe(1 << 13);
    expect(pin).toContain("/Q 2");
  });

  it("wraps a multiline value into several lines inside the appearance", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.textField({
      name: "notes",
      multiline: true,
      width: 120,
      height: 80,
      value: "one two three four five six seven eight nine ten eleven twelve",
    });
    const pdf = await render(doc);
    const ap = body(pdf, ref(objectWith(pdf, "/T (notes)").body, "N"));
    expect((ap.match(/ Tj/g) ?? []).length).toBeGreaterThan(2);
  });

  it("aligns single-line text right and centre", async () => {
    const left = new PDFDocument({ compress: false });
    left.textField({ name: "a", value: "X" });
    const right = new PDFDocument({ compress: false });
    right.textField({ name: "a", value: "X", align: "right" });
    const centre = new PDFDocument({ compress: false });
    centre.textField({ name: "a", value: "X", align: "center" });
    const xOf = async (doc: PDFDocument): Promise<number> => {
      const pdf = await render(doc);
      const ap = body(pdf, ref(objectWith(pdf, "/FT /Tx").body, "N"));
      return Number(/([\d.]+) [\d.]+ Td \(X\) Tj/.exec(ap)![1]);
    };
    const [l, c, r] = [await xOf(left), await xOf(centre), await xOf(right)];
    expect(l).toBeLessThan(c);
    expect(c).toBeLessThan(r);
    expect(r).toBeLessThan(200);
  });

  it("never writes a password field's value — neither /V nor the appearance", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.textField({ name: "secret", value: "hunter2-SECRET", password: true });
    const pdf = await render(doc);
    expect(pdf).not.toContain("hunter2");
    const field = objectWith(pdf, "/T (secret)").body;
    expect(field).not.toContain("/V ");
    expect(field).not.toContain("/DV ");
  });

  it("rejects a value longer than maxLength and bad numbers", () => {
    const doc = new PDFDocument();
    expect(code(() => doc.textField({ name: "a", value: "abcdef", maxLength: 3 }))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(code(() => doc.textField({ name: "b", maxLength: 1.5 }))).toBe("INVALID_NUMBER");
    expect(code(() => doc.textField({ name: "c", width: -1 }))).toBe("INVALID_NUMBER");
    expect(code(() => doc.textField({ name: "d", x: Number.NaN, y: 10 }))).toBe("INVALID_NUMBER");
    expect(code(() => doc.textField({ name: "e", fontSize: 0 }))).toBe("INVALID_NUMBER");
  });

  it("places the widget at an absolute position without moving the cursor", async () => {
    const doc = new PDFDocument({ compress: false });
    const before = doc.y;
    doc.textField({ name: "abs", x: 100, y: 700, width: 200, height: 50 });
    expect(doc.y).toBe(before);
    expect(doc.lastBlockHeight).toBe(50);
    const pdf = await render(doc);
    // A4 height 841.89: y=700 → PDF-space top 141.89, bottom 91.89.
    expect(objectWith(pdf, "/T (abs)").body).toContain("/Rect [100 91.89 300 141.89]");
  });

  it("draws the label above the field into the page content and flows below it", async () => {
    const doc = new PDFDocument({ compress: false });
    const before = doc.y;
    doc.textField({ name: "n", label: "Full name", spacingAfter: 5 });
    expect(doc.y).toBeGreaterThan(before + 22 + 5);
    const pdf = await render(doc);
    expect(pdf).toContain("(Full name) Tj");
  });
});

describe("checkbox()", () => {
  it("writes a /Btn field with /Yes and /Off appearances drawn as vector paths", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.checkbox({ name: "terms", checked: true, label: "I agree", required: true });
    const pdf = await render(doc);
    const field = objectWith(pdf, "/T (terms)").body;
    expect(field).toContain("/FT /Btn");
    expect(field).toContain("/V /Yes");
    expect(field).toContain("/AS /Yes");
    expect(ff(field)).toBe(2);
    expect(field).not.toContain("ZapfDingbats");
    const on = body(pdf, ref(field, "Yes"));
    const off = body(pdf, ref(field, "Off"));
    expect(on).toContain("/Subtype /Form");
    expect(on).toMatch(/ l\n/); // the tick is a path
    expect(on).toContain("\nS");
    expect(off).not.toMatch(/ l\n/);
    expect(pdf).not.toContain("ZaDb");
    expect(pdf).toContain("(I agree) Tj");
    // No text fields → no /DR, no /DA on the form, no SigFlags.
    const acro = acroForm(pdf);
    expect(acro).not.toContain("/DR");
    expect(acro).not.toContain("/SigFlags");
  });

  it("is off by default", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.checkbox({ name: "news", readOnly: true });
    const field = objectWith(await render(doc), "/T (news)").body;
    expect(field).toContain("/V /Off");
    expect(field).toContain("/AS /Off");
    expect(ff(field)).toBe(1);
  });
});

describe("radioGroup()", () => {
  it("writes a parent with /Kids, /Opt and /V, and one widget per option", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.radioGroup({
      name: "shipping",
      options: ["standard", { value: "express", label: "Express (24 h)" }, "pickup"],
      value: "express",
      required: true,
    });
    const pdf = await render(doc);
    const parent = objectWith(pdf, "/T (shipping)");
    expect(parent.body).toContain("/FT /Btn");
    expect(ff(parent.body)).toBe((1 << 15) | (1 << 14) | 2);
    expect(parent.body).toContain("/V /1");
    expect(parent.body).toContain("/DV /1");
    expect(parent.body).toContain("/Opt [(standard) (express) (pickup)]");
    expect(parent.body).not.toContain("/Subtype");
    const kids = /\/Kids \[([^\]]*)\]/
      .exec(parent.body)![1]!
      .split(" R")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s.split(" ")[0]));
    expect(kids).toHaveLength(3);
    kids.forEach((num, i) => {
      const kid = body(pdf, num);
      expect(kid).toContain("/Subtype /Widget");
      expect(kid).toContain(`/Parent ${parent.num} 0 R`);
      expect(kid).toContain("/F 4");
      expect(kid).toContain(`/AS /${i === 1 ? i : "Off"}`);
      expect(kid).toMatch(new RegExp(`/AP << /N << /${i} \\d+ 0 R /Off \\d+ 0 R >> >>`));
      expect(kid).not.toContain("/T ");
    });
    // Only the parent is listed in /Fields; the kids are page annotations.
    const fields = /\/Fields \[([^\]]*)\]/.exec(pdf)![1]!;
    expect(fields.trim()).toBe(`${parent.num} 0 R`);
    const annots = /\/Annots \[([^\]]*)\]/.exec(pdf)![1]!;
    for (const num of kids) expect(annots).toContain(`${num} 0 R`);
    expect(pdf).toContain("(Express \\(24 h\\)) Tj");
  });

  it("uses index state names, so any export value works", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.radioGroup({ name: "g", options: ["Größe M", "a/b c", "x)y"], value: "a/b c" });
    const pdf = await render(doc);
    const parent = objectWith(pdf, "/T (g)").body;
    expect(parent).toContain("/V /1");
    expect(parent).toContain(serialize(textString("Größe M")));
    expect(parent).toContain("(x\\)y)");
    expect(pdf).not.toContain("/Größe");
  });

  it("lays options out horizontally on one row", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.radioGroup({ name: "h", options: ["a", "b"], direction: "horizontal", x: 50, y: 100 });
    const pdf = await render(doc);
    const rects = [...pdf.matchAll(/\/Parent \d+ 0 R[^\n]*?\/Rect \[([^\]]*)\]/g)].map((m) =>
      m[1]!.split(" ").map(Number),
    );
    const rectsAlt = [...pdf.matchAll(/\/Rect \[([^\]]*)\][^\n]*?\/Parent/g)].map((m) =>
      m[1]!.split(" ").map(Number),
    );
    const all = rects.length > 0 ? rects : rectsAlt;
    expect(all).toHaveLength(2);
    expect(all[0]![1]).toBe(all[1]![1]); // same row
    expect(all[1]![0]).toBeGreaterThan(all[0]![2]!);
  });

  it("starts with nothing selected when no value is given", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.radioGroup({ name: "g", options: ["a", "b"], readOnly: true });
    const pdf = await render(doc);
    const parent = objectWith(pdf, "/T (g)").body;
    expect(parent).toContain("/V /Off");
    expect(ff(parent)).toBe((1 << 15) | (1 << 14) | 1);
  });

  it("rejects unknown values, duplicate and missing options", () => {
    const doc = new PDFDocument();
    expect(code(() => doc.radioGroup({ name: "a", options: ["x"], value: "y" }))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(code(() => doc.radioGroup({ name: "b", options: ["x", "x"] }))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.radioGroup({ name: "c", options: [] }))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.radioGroup({ name: "d", options: ["x"], size: -2 }))).toBe(
      "INVALID_NUMBER",
    );
  });
});

describe("dropdown()", () => {
  it("writes a combo /Ch field with /Opt pairs, /V and an appearance showing the label", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.dropdown({
      name: "country",
      options: [{ value: "DE", label: "Deutschland" }, "AT", { value: "CH" }],
      value: "DE",
      label: "Country",
    });
    const pdf = await render(doc);
    const field = objectWith(pdf, "/T (country)").body;
    expect(field).toContain("/FT /Ch");
    expect(ff(field)).toBe(1 << 17);
    expect(field).toContain("/Opt [[(DE) (Deutschland)] (AT) (CH)]");
    expect(field).toContain("/V (DE)");
    expect(field).toMatch(/\/DA \(\/Helv 10 Tf 0 g\)/);
    const ap = body(pdf, ref(field, "N"));
    expect(ap).toContain("/Tx BMC");
    expect(ap).toContain("(Deutschland) Tj");
    expect(pdf).toContain("(Country) Tj");
  });

  it("accepts a free value only when editable", async () => {
    const doc = new PDFDocument({ compress: false });
    expect(code(() => doc.dropdown({ name: "a", options: ["x"], value: "free" }))).toBe(
      "INVALID_ARGUMENT",
    );
    doc.dropdown({ name: "b", options: ["x"], value: "free", editable: true, readOnly: true });
    const pdf = await render(doc);
    const field = objectWith(pdf, "/T (b)").body;
    expect(ff(field)).toBe((1 << 17) | (1 << 18) | 1);
    expect(field).toContain("/V (free)");
    expect(body(pdf, ref(field, "N"))).toContain("(free) Tj");
  });
});

describe("AcroForm dictionary", () => {
  it("lists every field, adds /DR and /DA for text fields and writes Helvetica once", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.text("Body text in Helvetica too");
    doc.textField({ name: "a" });
    doc.dropdown({ name: "b", options: ["x"] });
    doc.checkbox({ name: "c" });
    doc.radioGroup({ name: "d", options: ["x", "y"] });
    doc.signature({ name: "e" });
    const pdf = await render(doc);
    const acro = acroForm(pdf);
    expect(acro).toMatch(/\/Fields \[(\d+ 0 R ?){5}\]/);
    expect(acro).toMatch(/\/DR << \/Font << \/Helv \d+ 0 R >> >>/);
    expect(acro).toContain("/DA (/Helv 0 Tf 0 g)");
    expect(acro).toContain("/SigFlags 1");
    expect(acro).not.toContain("NeedAppearances");
    expect(pdf.match(/\/BaseFont \/Helvetica\b/g)).toHaveLength(1);
    // The /DR font is the very object the page content uses.
    const helv = ref(acro, "Helv");
    expect(body(pdf, helv)).toContain("/BaseFont /Helvetica");
  });

  it("keeps a signature-only form exactly as before (no /DR, no /DA)", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.signature();
    const acro = acroForm(await render(doc));
    expect(acro).not.toContain("/DR");
    expect(acro).not.toContain("/DA");
  });

  it("renders deterministically", async () => {
    const build = async (): Promise<Uint8Array> => {
      const doc = new PDFDocument({ deterministic: true });
      doc.textField({ name: "a", value: "x" });
      doc.checkbox({ name: "b", checked: true });
      doc.radioGroup({ name: "c", options: ["1", "2"], value: "2" });
      doc.dropdown({ name: "d", options: ["x", "y"], value: "y" });
      return doc.render();
    };
    expect(await build()).toEqual(await build());
  });
});

describe("field names", () => {
  it("are unique across all field kinds, signatures included", () => {
    const doc = new PDFDocument();
    doc.signature({ name: "s" });
    doc.textField({ name: "a" });
    expect(code(() => doc.checkbox({ name: "a" }))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.radioGroup({ name: "s", options: ["x"] }))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.dropdown({ name: "a", options: ["x"] }))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.signature({ name: "a" }))).toBe("INVALID_ARGUMENT");
  });

  it("must be non-empty strings without periods", () => {
    const doc = new PDFDocument();
    expect(code(() => doc.textField({ name: "" }))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.textField({ name: "a.b" }))).toBe("INVALID_ARGUMENT");
    expect(code(() => doc.textField({ name: 3 as unknown as string }))).toBe("INVALID_ARGUMENT");
  });

  it("are released again by measureBlock()", () => {
    const doc = new PDFDocument();
    doc.measureBlock((d) => d.textField({ name: "m" }));
    expect(() => doc.textField({ name: "m" })).not.toThrow();
  });
});

describe("escaping", () => {
  const hostile = "x) Tj /Evil (\\ \nET";

  it("escapes names, values and options in dictionaries and appearance streams", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.textField({ name: "t) >> /Evil <<", value: hostile, multiline: true });
    doc.dropdown({ name: "d", options: [hostile, "ok"], value: hostile });
    doc.radioGroup({ name: "r", options: [hostile, "/Name"] });
    const pdf = await render(doc);
    expect(pdf).toContain(t("t) >> /Evil <<"));
    expect(pdf).toContain("/T (t\\) >> /Evil <<)");
    expect(pdf).toContain(`/V ${serialize(textString(hostile))}`);
    // No unescaped closing parenthesis followed by an injected operator.
    expect(pdf).not.toMatch(/[^\\]\) Tj \/Evil/);
    expect(pdf).toContain("(/Name)");
  });

  it("writes non-ASCII values as UTF-16 text strings", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.textField({ name: "Straße", value: "Grüße — 你好" });
    const pdf = await render(doc);
    expect(pdf).toContain(t("Straße"));
    expect(pdf).toContain(`/V ${serialize(textString("Grüße — 你好"))}`);
  });

  it("collapses line breaks in a single-line appearance", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.textField({ name: "a", value: "one\ntwo" });
    const pdf = await render(doc);
    const ap = body(pdf, ref(objectWith(pdf, "/T (a)").body, "N"));
    expect(ap).toContain("(one two) Tj");
  });
});

describe("flow behaviour", () => {
  it("breaks to a new page when the field no longer fits", async () => {
    const doc = new PDFDocument({ compress: false });
    doc.y = 800;
    doc.textField({ name: "late" });
    expect(doc.pageCount).toBe(2);
    doc.y = 800;
    doc.radioGroup({ name: "r", options: ["a", "b", "c"] });
    expect(doc.pageCount).toBe(3);
    const pdf = await render(doc);
    // Each page carries its own widgets.
    expect(pdf.match(/\/Annots \[/g)).toHaveLength(2);
  });

  it("stacks checkbox rows and advances the cursor", () => {
    const doc = new PDFDocument();
    const before = doc.y;
    doc.checkbox({ name: "a", label: "First" });
    const mid = doc.y;
    doc.checkbox({ name: "b", label: "Second" });
    expect(mid).toBeGreaterThan(before);
    expect(doc.y - mid).toBeCloseTo(mid - before, 5);
  });

  it("places fields on an appended page through the page transform", async () => {
    const inner = new PDFDocument({ compress: false, format: { width: 300, height: 400 } });
    inner.text("x");
    const doc = new PDFDocument({ compress: false });
    await doc.append(await inner.toBuffer(), { overlay: true });
    doc.textField({ name: "onImport", x: 10, y: 10, width: 100, height: 20 });
    const pdf = await render(doc);
    const field = objectWith(pdf, "/T (onImport)").body;
    expect(field).toContain("/Rect [10 370 110 390]");
    expect(pdf).toContain("/AcroForm");
  });
});

describe("fields on a rotated appended page", () => {
  it("turn the rectangle and the appearance with the page", async () => {
    const doc = new PDFDocument({ compress: false });
    // A 300×400 page with /Rotate 90 displays as 400×300.
    await doc.append(await makeObjStmPdf({ rotate: 90 }));
    doc.textField({ name: "r", x: 10, y: 10, width: 100, height: 20, value: "v" });
    doc.checkbox({ name: "c", x: 10, y: 50 });
    const pdf = await render(doc);
    const field = objectWith(pdf, "/T (r)").body;
    // overlayMatrix for /Rotate 90: [0 1 -1 0 300 0]. Display (10..110, 270..290)
    // → source x = 300 − y, y = x.
    expect(field).toContain("/Rect [10 10 30 110]");
    expect(field).toMatch(/\/MK << [^>]*\/R 90 >>/);
    expect(body(pdf, ref(field, "N"))).toContain("/Matrix [0 1 -1 0 0 0]");
    const check = objectWith(pdf, "/T (c)").body;
    expect(body(pdf, ref(check, "Yes"))).toContain("/Matrix [0 1 -1 0 0 0]");
  });
});

describe("encryption", () => {
  it.skipIf(!supportsEncryption())(
    "encrypts field values and appearance streams like any other string",
    async () => {
      const doc = new PDFDocument({ compress: false, encrypt: { userPassword: "pw" } });
      doc.textField({ name: "f", value: "PLAINTEXT-VALUE" });
      doc.dropdown({ name: "d", options: ["OPTION-LABEL"], value: "OPTION-LABEL" });
      const pdf = await render(doc);
      expect(pdf).toContain("/Encrypt");
      expect(pdf).toContain("/AcroForm");
      expect(pdf).not.toContain("PLAINTEXT-VALUE");
      expect(pdf).not.toContain("OPTION-LABEL");
    },
  );
});

interface Field {
  fullname: string;
  fieldtype: string;
  value: unknown;
  ischeckbox: boolean;
  isradiobutton: boolean;
  choices: string[];
  annotation: { appearancestate: string };
}

describe("independent check (qpdf)", () => {
  const hasQpdf = (() => {
    try {
      execFileSync("qpdf", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasQpdf)("qpdf sees every field with its type and value", async () => {
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const doc = new PDFDocument();
    doc.textField({ name: "name", value: "Ada" });
    doc.checkbox({ name: "ok", checked: true });
    doc.radioGroup({ name: "r", options: ["a", "b"], value: "b" });
    doc.dropdown({ name: "d", options: ["x", "y"], value: "x" });
    const file = join(mkdtempSync(join(tmpdir(), "fast-pdf-forms-")), "f.pdf");
    writeFileSync(file, await doc.render());
    execFileSync("qpdf", ["--check", file]);
    const json = JSON.parse(
      execFileSync("qpdf", ["--json", "--json-key=acroform", file], {
        encoding: "utf8",
      }),
    ) as {
      acroform: {
        hasacroform: boolean;
        needappearances: boolean;
        fields: Field[];
      };
    };
    expect(json.acroform.hasacroform).toBe(true);
    expect(json.acroform.needappearances).toBe(false);
    const byName = new Map<string, Field[]>();
    for (const f of json.acroform.fields) {
      byName.set(f.fullname, [...(byName.get(f.fullname) ?? []), f]);
    }
    expect(byName.get("name")![0]!.fieldtype).toBe("/Tx");
    expect(byName.get("name")![0]!.value).toBe("u:Ada");
    expect(byName.get("ok")![0]!.value).toBe("/Yes");
    expect(byName.get("ok")![0]!.ischeckbox).toBe(true);
    const radio = byName.get("r")!;
    expect(radio.map((f) => f.annotation.appearancestate)).toEqual(["/Off", "/1"]);
    expect(radio.every((f) => f.isradiobutton && f.value === "/1")).toBe(true);
    expect(byName.get("d")![0]!.choices).toEqual(["x", "y"]);
    expect(byName.get("d")![0]!.fieldtype).toBe("/Ch");
  });
});
