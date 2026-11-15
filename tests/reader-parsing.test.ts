import { describe, expect, it } from "vitest";
import { PDFDocument, pdfInfo } from "../src/index";
import { PDFReader, PDFStream, asArray, asDict, isName } from "../src/pdf/reader";
import { HexString, Name, PDFString, Ref, latin1String } from "../src/pdf/objects";
import { makeObjStmPdf, makeRawPdf, type RawObject } from "./helpers";

/**
 * The reader is the only part of fast-pdf that consumes bytes it did not
 * write. Its input is a user upload — a scan, a bank statement, something a
 * broken generator produced, or a file built to trip it up — so the tests here
 * are about what it does with syntax it cannot trust: the full literal-string
 * escape set, damaged cross-reference tables, and the bounds that keep a
 * crafted file from exhausting memory or the stack.
 */

/** Wrap object bodies in a minimal, valid one-page document. */
function doc(extra: Record<number, RawObject>, options = {}): Uint8Array {
  return makeRawPdf(
    {
      1: "<< /Type /Catalog /Pages 2 0 R >>",
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>",
      4: { stream: "0 0 1 rg 10 10 50 50 re f" },
      ...extra,
    },
    options,
  );
}

// ── Tokenizer ─────────────────────────────────────────────────────────

describe("PDF tokenizer", () => {
  it("decodes the whole literal-string escape set", async () => {
    const body =
      "<< /Esc (nl:\\n cr:\\r tab:\\t bs:\\b ff:\\f oct:\\101 short:\\7 " +
      "esc-paren:\\( backslash:\\\\ unknown:\\q nested:(deep) )" +
      " /Cont (one\\\ntwo) /ContCRLF (three\\\r\nfour) >>";
    const reader = await PDFReader.open(doc({ 9: body }));
    const dict = asDict(await reader.object(9))!;

    const esc = dict.Esc as PDFString;
    expect(esc).toBeInstanceOf(PDFString);
    expect(esc.value).toBe(
      "nl:\n cr:\r tab:\t bs:\b ff:\f oct:A short:\u0007 " +
        "esc-paren:( backslash:\\ unknown:q nested:(deep) ",
    );
    // A backslash before a line break is a continuation: it joins the lines
    // without contributing a character, in both LF and CRLF files.
    expect((dict.Cont as PDFString).value).toBe("onetwo");
    expect((dict.ContCRLF as PDFString).value).toBe("threefour");
  });

  it("reads hex strings, padding an odd digit count", async () => {
    const reader = await PDFReader.open(
      doc({ 9: "<< /A <48656C6C6F> /Odd <4A4> /Spaced <48 65\n6C> /Empty <> >>" }),
    );
    const dict = asDict(await reader.object(9))!;
    expect((dict.A as HexString).value).toBe("48656C6C6F");
    // An odd trailing digit means the low nibble is zero, not that the string
    // is malformed — "4A4" is the byte pair 4A 40.
    expect((dict.Odd as HexString).value).toBe("4A40");
    expect((dict.Spaced as HexString).value).toBe("48656C");
    expect((dict.Empty as HexString).value).toBe("");
  });

  it("decodes #XX escapes in names, as UTF-8 where that is valid", async () => {
    const reader = await PDFReader.open(
      doc({ 9: "<< /A#20B 1 /caf#c3#a9 2 /raw#ff 3 /Plain 4 >>" }),
    );
    const dict = asDict(await reader.object(9))!;
    // Names are UTF-8 on the wire; decoding keeps a round-trip lossless.
    expect(Object.keys(dict).sort()).toEqual(["A B", "Plain", "café", "rawÿ"].sort());
  });

  it("accepts the number forms PDF allows but JSON does not", async () => {
    const reader = await PDFReader.open(doc({ 9: "<< /N [4. -.002 +3 0.5 17] >>" }));
    const dict = asDict(await reader.object(9))!;
    expect(dict.N).toEqual([4, -0.002, 3, 0.5, 17]);
  });

  it("reads keywords and skips comments", async () => {
    const reader = await PDFReader.open(
      doc({ 9: "<< /T true /F false /N null\n% a comment, ignored\n/After 7 >>" }),
    );
    const dict = asDict(await reader.object(9))!;
    expect(dict.T).toBe(true);
    expect(dict.F).toBe(false);
    expect(dict.N).toBe(null);
    expect(dict.After).toBe(7);
  });

  it("tells an indirect reference from three consecutive numbers", async () => {
    // "12 0 R" is only distinguishable by two tokens of lookahead; an array of
    // plain numbers must not collapse into references.
    const reader = await PDFReader.open(doc({ 9: "<< /A [1 0 R 2 0 3 0 R] /B 4 0 R >>" }));
    const dict = asDict(await reader.object(9))!;
    const a = dict.A as unknown[];
    expect(a[0]).toBeInstanceOf(Ref);
    expect((a[0] as Ref).num).toBe(1);
    expect(a[1]).toBe(2);
    expect(a[2]).toBe(0);
    expect(a[3]).toBeInstanceOf(Ref);
    expect((dict.B as Ref).num).toBe(4);
  });

  it("rejects malformed syntax with a typed error instead of hanging", async () => {
    const cases: Record<string, string> = {
      "unterminated string": "<< /A (abc >>",
      "unterminated dictionary": "<< /A 1",
      "unterminated array": "<< /A [1 2 >>",
      "unexpected keyword": "<< /A maybe >>",
      "non-name dictionary key": "<< 42 /A >>",
      "lone sign": "<< /A - >>",
    };
    for (const [label, body] of Object.entries(cases)) {
      const reader = await PDFReader.open(doc({ 9: body }));
      await expect(reader.object(9), label).rejects.toMatchObject({
        code: "INVALID_PDF_FILE",
      });
    }
  });

  it("bounds object nesting instead of overflowing the stack", async () => {
    // SECURITY.md promises a 128-level cap. 200 levels is a file a hostile
    // uploader can write in one line; without the cap it is a crash.
    const deep = "[".repeat(200) + "]".repeat(200);
    const reader = await PDFReader.open(doc({ 9: `<< /Deep ${deep} >>` }));
    await expect(reader.object(9)).rejects.toMatchObject({ code: "INVALID_PDF_FILE" });

    // 120 levels is below the cap and must still parse.
    const shallow = "[".repeat(120) + "]".repeat(120);
    const ok = await PDFReader.open(doc({ 9: `<< /Deep ${shallow} >>` }));
    expect(asDict(await ok.object(9))).toBeDefined();
  });

  it("refuses a deeply nested page dictionary end to end", async () => {
    const deep = "[".repeat(200) + "]".repeat(200);
    const bytes = makeRawPdf({
      1: "<< /Type /Catalog /Pages 2 0 R >>",
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /X ${deep} >>`,
      4: { stream: " " },
    });
    await expect(new PDFDocument().append(bytes)).rejects.toMatchObject({
      code: "INVALID_PDF_FILE",
    });
  });
});

// ── Streams ───────────────────────────────────────────────────────────

describe("stream parsing", () => {
  it("trusts a correct /Length and recovers from a wrong one", async () => {
    const payload = "0 0 1 rg 10 10 50 50 re f";
    // A /Length that overshoots the file, and one that stops mid-stream: both
    // are common in the wild, and both have to fall back to finding
    // "endstream" rather than truncating the content.
    for (const length of [payload.length, 2, 99999]) {
      const reader = await PDFReader.open(
        doc({ 9: `<< /Length ${length} >>\nstream\n${payload}\nendstream` }),
      );
      const stream = await reader.object(9);
      expect(stream).toBeInstanceOf(PDFStream);
      expect(latin1String((stream as PDFStream).raw)).toBe(payload);
    }
  });

  it("resolves a /Length held in another object", async () => {
    const payload = "0 0 1 rg 10 10 50 50 re f";
    const reader = await PDFReader.open(
      doc({ 8: String(payload.length), 9: `<< /Length 8 0 R >>\nstream\n${payload}\nendstream` }),
    );
    expect(latin1String(((await reader.object(9)) as PDFStream).raw)).toBe(payload);
  });

  it("reports a stream that never ends", async () => {
    const reader = await PDFReader.open(doc({ 9: "<< /Length 5 >>\nstream\nabcde" }));
    await expect(reader.object(9)).rejects.toMatchObject({ code: "INVALID_PDF_FILE" });
  });

  it("rejects a filter it cannot decode on a structural stream", async () => {
    // Content streams are copied verbatim, but an object stream has to be
    // read — so an exotic filter there is a hard stop, not a copy.
    await expect(
      new PDFDocument().append(await makeObjStmPdf({ objStmFilter: "/LZWDecode" })),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_PDF" });
  });

  it("caps decompression so a zlib bomb cannot exhaust memory", async () => {
    // SECURITY.md promises 64 MB per stream. The object stream below is a few
    // kilobytes on disk and 65 MB inflated — the shape of a compression bomb.
    const bomb = await makeObjStmPdf({ objStmPadding: 65 * 1024 * 1024 });
    expect(bomb.length).toBeLessThan(200_000);
    await expect(new PDFDocument().append(bomb)).rejects.toMatchObject({
      code: "INVALID_PDF_FILE",
      // Pinned to the limit so this cannot pass on an unrelated parse error.
      message: expect.stringContaining(`${64 * 1024 * 1024}-byte limit`),
    });

    // The control: the same structure just under the cap imports normally, so
    // the rejection is the bound doing its job and not the shape of the file.
    const ok = new PDFDocument({ compress: false });
    await ok.append(await makeObjStmPdf({ objStmPadding: 1024 }));
    expect(latin1String(await ok.render())).toContain("20 20 120 60 re f");
  }, 30_000);
});

// ── Cross-reference tables ────────────────────────────────────────────

describe("cross-reference recovery", () => {
  const readBack = async (bytes: Uint8Array): Promise<string> => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(bytes);
    return latin1String(await pdf.render());
  };

  it("scans the file when startxref points nowhere", async () => {
    expect(await readBack(doc({}, { xref: "broken" }))).toContain("10 10 50 50 re f");
  });

  it("scans the file when every offset in the table is stale", async () => {
    // What an editor that rewrote the file without updating the table leaves
    // behind. The table parses fine; it is the offsets that lie.
    expect(await readBack(doc({}, { offsetSkew: 9 }))).toContain("10 10 50 50 re f");
  });

  it("scans the file when there is no table at all", async () => {
    expect(await readBack(doc({}, { xref: "none" }))).toContain("10 10 50 50 re f");
  });

  it("finds the catalog by scanning when the trailer is gone too", async () => {
    const bytes = doc({}, { xref: "none", trailer: false });
    expect(latin1String(bytes)).not.toContain("trailer");
    expect(await readBack(bytes)).toContain("10 10 50 50 re f");
  });

  it("ignores an object definition that starts mid-number", async () => {
    // Rebuilding scans for "N G obj"; "912 0 obj" must not register as
    // object 12 and shadow the real one.
    const bytes = doc(
      { 12: "<< /Type /Nothing >>", 912: "<< /Type /Decoy /Marker (DECOY) >>" },
      { xref: "none" },
    );
    const reader = await PDFReader.open(bytes);
    expect(isName(asDict(await reader.object(12))!.Type, "Nothing")).toBe(true);
  });

  it("scans the file when the table itself is malformed", async () => {
    // Each of these is a table that parses far enough to look real and then
    // breaks. SECURITY.md calls the rescan a robustness feature, not a
    // security boundary — so what matters is that the objects still arrive.
    const base = latin1String(doc({}));
    const damaged: Record<string, string> = {
      "subsection header that is not a number": base.replace("xref\n0 ", "xref\nQQ "),
      "more entries promised than written": base.replace(/xref\n0 \d+\n/, "xref\n0 9999\n"),
      "entry with an unknown type letter": base.replace(" 00000 n \n", " 00000 x \n"),
    };
    for (const [label, text] of Object.entries(damaged)) {
      expect(text, label).not.toBe(base); // the edit really landed
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
      expect(await readBack(bytes), label).toContain("10 10 50 50 re f");
    }
  });

  it("reports an unreadable cross-reference stream with a typed error", async () => {
    // Here the damage is not recoverable: the catalog and the page live inside
    // an object stream that only this table can point at. The contract is then
    // a FastPDFError, never an untyped crash.
    const base = latin1String(await makeObjStmPdf());
    for (const [label, text] of Object.entries({
      "no /W": base.replace("/W [1 2 2] ", ""),
      "zero-width rows": base.replace("/W [1 2 2]", "/W [0 0 0]"),
      "non-numeric /W entry": base.replace("/W [1 2 2]", "/W [1 2 /x]"),
    })) {
      expect(text, label).not.toBe(base);
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
      await expect(new PDFDocument().append(bytes), label).rejects.toMatchObject({
        code: "INVALID_PDF_FILE",
      });
    }
  });

  it("keeps a classic table usable when a hybrid /XRefStm is broken", async () => {
    // Hybrid files point classic readers at a stream they may ignore; a
    // damaged one must not invalidate the table that was already read.
    const bytes = doc({}, { trailerExtra: " /XRefStm 9999999" });
    expect(await readBack(bytes)).toContain("10 10 50 50 re f");
  });

  it("follows a /Prev chain, with the newest section winning", async () => {
    // An incremental update: object 4 is redefined and a second table points
    // back at the first. The newer content stream is the one that must render.
    const base = doc({});
    const baseText = latin1String(base);
    const firstXref = baseText.lastIndexOf("xref\n0 ");
    const updated = "0 1 0 rg 99 99 20 20 re f";
    const appendStart = base.length;
    const addition = `4 0 obj\n<< /Length ${updated.length} >>\nstream\n${updated}\nendstream\nendobj\n`;
    const secondXrefAt = appendStart + addition.length;
    const tail =
      `xref\n0 1\n0000000000 65535 f \n4 1\n${String(appendStart).padStart(10, "0")} 00000 n \n` +
      `trailer\n<< /Size 5 /Root 1 0 R /Prev ${firstXref} >>\nstartxref\n${secondXrefAt}\n%%EOF\n`;

    const out = new Uint8Array(base.length + addition.length + tail.length);
    out.set(base, 0);
    out.set(new TextEncoder().encode(addition), base.length);
    out.set(new TextEncoder().encode(tail), base.length + addition.length);

    const text = await readBack(out);
    expect(text).toContain("99 99 20 20 re f");
    expect(text).not.toContain("10 10 50 50 re f");
  });

  it("finds pages by scanning when the page tree is broken", async () => {
    // The catalog points at an object that is not there. Rather than report an
    // empty file, every /Type /Page object is collected.
    const bytes = makeRawPdf({
      1: "<< /Type /Catalog /Pages 99 0 R >>",
      3: "<< /Type /Page /MediaBox [0 0 300 400] /Contents 4 0 R >>",
      4: { stream: "0 0 1 rg 10 10 50 50 re f" },
    });
    const info = await pdfInfo(bytes);
    expect(info.pageCount).toBe(1);
    expect(info.pageSizes[0]).toEqual({ width: 300, height: 400 });
  });

  it("reports a file with no pages instead of producing an empty document", async () => {
    const bytes = makeRawPdf({ 1: "<< /Type /Catalog /Pages 2 0 R >>", 2: "<< /Type /Pages >>" });
    await expect(pdfInfo(bytes)).rejects.toMatchObject({ code: "INVALID_PDF_FILE" });
  });

  it("terminates on a page tree that points back at itself", async () => {
    const bytes = makeRawPdf({
      1: "<< /Type /Catalog /Pages 2 0 R >>",
      2: "<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>",
      3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>",
      4: { stream: "0 0 1 rg 10 10 50 50 re f" },
    });
    const info = await pdfInfo(bytes);
    expect(info.pageCount).toBe(1);
  });

  it("terminates on a reference that resolves to itself", async () => {
    const reader = await PDFReader.open(doc({ 9: "10 0 R", 10: "9 0 R" }));
    expect(await reader.resolve(new Ref(9))).toBeUndefined();
  });

  it("reads a missing object as null rather than failing", async () => {
    const reader = await PDFReader.open(doc({}));
    expect(await reader.object(404)).toBe(null);
  });
});

// ── Cross-reference streams and object streams ────────────────────────

describe("cross-reference streams", () => {
  it("decodes every PNG row filter to the same table", async () => {
    // Which filter a generator picks per row is its own business; all five
    // must reconstruct the same cross-reference rows, or objects land at the
    // wrong offsets.
    for (const rowFilter of [0, 1, 2, 3, 4] as const) {
      const pdf = new PDFDocument({ compress: false });
      await pdf.append(await makeObjStmPdf({ rowFilter }));
      expect(latin1String(await pdf.render()), `row filter ${rowFilter}`).toContain(
        "20 20 120 60 re f",
      );
    }
  });

  it("decodes the TIFF predictor as well as the PNG one", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(await makeObjStmPdf({ tiffPredictor: true }));
    expect(latin1String(await pdf.render())).toContain("20 20 120 60 re f");
  });

  it("recovers an object stream member whose index is wrong", async () => {
    const reader = await PDFReader.open(await makeObjStmPdf());
    // Object 5 is the page; it lives inside the object stream. Fetching it by
    // number has to work even where the index in the table disagrees.
    const page = asDict(await reader.object(5))!;
    expect(isName(page.Type, "Page")).toBe(true);
  });
});

// ── Small shared helpers ──────────────────────────────────────────────

describe("value narrowing helpers", () => {
  it("treats only plain dictionaries as dictionaries", () => {
    expect(asDict({ A: 1 })).toEqual({ A: 1 });
    for (const value of [
      null,
      undefined,
      42,
      true,
      [1, 2],
      new Ref(1),
      new Name("X"),
      new PDFString("x"),
      new HexString("4a"),
      new PDFStream({}, new Uint8Array(0)),
    ]) {
      expect(asDict(value as never)).toBeUndefined();
    }
  });

  it("accepts a single value wherever PDF allows an array", () => {
    // /Filter is one name or a list of them; both have to read the same way.
    expect(asArray(new Name("FlateDecode"))).toHaveLength(1);
    expect(asArray([new Name("A"), new Name("B")])).toHaveLength(2);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });

  it("matches a name only by its exact value", () => {
    expect(isName(new Name("Page"), "Page")).toBe(true);
    expect(isName(new Name("Pages"), "Page")).toBe(false);
    expect(isName(new PDFString("Page"), "Page")).toBe(false);
    expect(isName(undefined, "Page")).toBe(false);
  });
});

// ── File-level robustness ─────────────────────────────────────────────

describe("file framing", () => {
  it("drops junk before the header so offsets stay relative to it", async () => {
    const base = doc({});
    const prefixed = new Uint8Array(base.length + 6);
    prefixed.set(new TextEncoder().encode("JUNK!\n"), 0);
    prefixed.set(base, 6);
    const info = await pdfInfo(prefixed);
    expect(info.pageCount).toBe(1);
    expect(info.version).toBe("1.7");
  });

  it("falls back to 1.7 when the header carries no usable version", async () => {
    const info = await pdfInfo(doc({}, { header: "%PDF-\n" }));
    expect(info.version).toBe("1.7");
  });

  it("reads the version the header declares", async () => {
    expect((await pdfInfo(doc({}, { header: "%PDF-1.4\n" }))).version).toBe("1.4");
  });

  it("refuses a file with no header at all", async () => {
    await expect(pdfInfo(new TextEncoder().encode("hello world"))).rejects.toMatchObject({
      code: "INVALID_PDF_FILE",
    });
  });
});
