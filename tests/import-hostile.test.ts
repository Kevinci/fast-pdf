import { describe, expect, it } from "vitest";
import { FastPDFError, PDFDocument } from "../src/index";
import { latin1String } from "../src/pdf/objects";
import { makeObjStmPdf, makeRawPdf, type RawObject } from "./helpers";

/**
 * The guarantees SECURITY.md makes about `append()` under "Importing PDFs",
 * exercised against files built to break them.
 *
 * An imported page is an untrusted upload: its content stream is copied
 * verbatim by design (it is drawing instructions, not behaviour), but the
 * *structure* around it is filtered by whitelist. These tests pin that
 * whitelist from both sides — every construct that must be dropped, and the
 * benign markup next to it that must survive, because a filter that drops
 * everything would pass a one-sided test while being useless.
 *
 * Everything that must not come through carries a "DROP-" marker, so a leak
 * shows up as a string in the output rather than only as a missing assertion.
 */

/** A one-page document whose page carries the given annotation objects. */
function pdfWithAnnots(
  annots: string[],
  options: { pageExtra?: string; extra?: Record<number, RawObject> } = {},
): Uint8Array {
  const refs = annots.map((_, i) => `${10 + i} 0 R`);
  const objects: Record<number, RawObject> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3:
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R /Resources << >> ` +
      (refs.length > 0 ? `/Annots [${refs.join(" ")}] ` : "") +
      `${options.pageExtra ?? ""}>>`,
    4: { stream: "0 0 1 rg 10 10 120 60 re f" },
    ...options.extra,
  };
  annots.forEach((body, i) => {
    objects[10 + i] = body;
  });
  return makeRawPdf(objects);
}

/** A two-page document with one annotation on page 1 (page 2 is object 5). */
function twoPagePdf(annot: string, extra: Record<number, RawObject> = {}): Uint8Array {
  return makeRawPdf({
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    3:
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R " +
      "/Resources << >> /Annots [10 0 R] >>",
    4: { stream: "0 0 1 rg 10 10 120 60 re f" },
    5: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 6 0 R /Resources << >> >>",
    6: { stream: "1 0 0 rg 10 10 120 60 re f" },
    10: annot,
    ...extra,
  });
}

/** Append a file 1:1 and return the rendered output as latin-1 text. */
async function appended(
  source: Uint8Array,
  options?: Parameters<PDFDocument["append"]>[1],
): Promise<string> {
  const pdf = new PDFDocument({ compress: false });
  await pdf.append(source, options);
  return latin1String(await pdf.render());
}

// ── The annotation subtype whitelist ──────────────────────────────────

/** Markup: draws and does nothing else. SECURITY.md promises these survive. */
const MARKUP_SUBTYPES = [
  "Text",
  "FreeText",
  "Highlight",
  "Underline",
  "StrikeOut",
  "Squiggly",
  "Square",
  "Circle",
  "Line",
  "Polygon",
  "PolyLine",
  "Stamp",
  "Ink",
  "Caret",
];

/** Form fields and payload carriers. SECURITY.md promises these are dropped. */
const PAYLOAD_SUBTYPES = [
  "Widget",
  "FileAttachment",
  "Sound",
  "Movie",
  "RichMedia",
  "3D",
  "Screen",
  "Popup",
  "PrinterMark",
  "Projection",
];

describe("append() — annotation subtype whitelist", () => {
  it("keeps every markup subtype and drops every payload-bearing one", async () => {
    const text = await appended(
      pdfWithAnnots([
        ...MARKUP_SUBTYPES.map(
          (s) => `<< /Type /Annot /Subtype /${s} /Rect [10 10 50 50] /Contents (keep-${s}) >>`,
        ),
        ...PAYLOAD_SUBTYPES.map(
          (s) => `<< /Type /Annot /Subtype /${s} /Rect [60 10 90 50] /Contents (DROP-${s}) >>`,
        ),
      ]),
    );
    for (const s of MARKUP_SUBTYPES) {
      expect(text).toContain(`/Subtype /${s}`);
      expect(text).toContain(`keep-${s}`);
    }
    for (const s of PAYLOAD_SUBTYPES) {
      expect(text).not.toContain(`/Subtype /${s}`);
      expect(text).not.toContain(`DROP-${s}`);
    }
  });

  it("drops an annotation with no /Subtype at all, rather than guessing", async () => {
    const text = await appended(
      pdfWithAnnots([
        "<< /Type /Annot /Rect [10 10 50 50] /Contents (DROP-untyped) >>",
        "<< /Type /Annot /Subtype (Square) /Rect [10 10 50 50] /Contents (DROP-stringsubtype) >>",
      ]),
    );
    expect(text).not.toContain("DROP-untyped");
    expect(text).not.toContain("DROP-stringsubtype");
  });

  it("skips an /Annots entry that is not a dictionary", async () => {
    // A surviving sibling proves the array was walked, not abandoned.
    const text = await appended(
      makeRawPdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3:
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R " +
          "/Resources << >> /Annots [null 42 (text) 10 0 R] >>",
        4: { stream: "0 0 1 rg 10 10 120 60 re f" },
        10: "<< /Type /Annot /Subtype /Square /Rect [10 10 50 50] /Contents (keep-me) >>",
      }),
    );
    expect(text).toContain("keep-me");
    expect(text).toContain("/Subtype /Square");
  });

  it("ignores an /Annots value that is not an array", async () => {
    const text = await appended(pdfWithAnnots([], { pageExtra: "/Annots 42 " }));
    expect(text).not.toContain("/Subtype /Annot");
  });
});

// ── Actions ───────────────────────────────────────────────────────────

describe("append() — action filtering", () => {
  const HOSTILE = [
    "/A << /S /Launch /F (DROP-launch.exe) /NewWindow true >>",
    "/A << /S /JavaScript /JS (DROP-js) >>",
    "/A << /S /SubmitForm /F << /FS /URL /F (https://evil.example/DROP-submit) >> >>",
    "/A << /S /GoToR /F (DROP-remote.pdf) /D [0 /Fit] >>",
    "/A << /S /GoToE /F (DROP-embedded.pdf) >>",
    "/A << /S /Named /N /DROP-named >>",
    "/A << /S /Rendition /JS (DROP-rendition) >>",
    "/A << /S /ImportData /F (DROP-data.fdf) >>",
    "/A << /S /URI /URI (javascript:alert\\('DROP-urijs'\\)) >>",
    "/A << /S /URI /URI (file:///etc/DROP-passwd) >>",
    "/A << /S /URI /URI (data:text/html,DROP-datauri) >>",
    "/A << /S /URI /URI (vbscript:DROP-vbs) >>",
    "/A << /S /URI /URI (java\\nscript:DROP-obfuscated) >>",
    "/A << /S /URI /URI /DROP-nameinsteadofstring >>",
    "/A << /S /URI >>",
    "/A 42",
    "/A null",
  ];

  it("drops every action that is not a safe web link or an in-document jump", async () => {
    const annots = [
      ...HOSTILE.map(
        (a, i) =>
          `<< /Type /Annot /Subtype /Link /Rect [10 ${10 + i * 12} 300 ${20 + i * 12}] ` +
          `/Border [0 0 0] ${a} >>`,
      ),
      // The control: a plain https link, which must come through.
      "<< /Type /Annot /Subtype /Link /Rect [10 350 300 364] /Border [0 0 0] " +
        "/A << /S /URI /URI (https://example.com/keep-me) >> >>",
    ];
    const text = await appended(pdfWithAnnots(annots));

    expect(text).toContain("https://example.com/keep-me");
    // Exactly one link survived — the control, and nothing else.
    expect(text.match(/\/Subtype \/Link/g)).toHaveLength(1);
    for (const marker of text.match(/DROP-[A-Za-z.]+/g) ?? []) {
      throw new Error(`hostile action leaked into the output: ${marker}`);
    }
    expect(text).not.toContain("/JavaScript");
    expect(text).not.toContain("/Launch");
    expect(text).not.toContain("/SubmitForm");
  });

  it("applies the same scheme check a link() call gets", async () => {
    // Custom and mailto schemes are allowed for links written by the library,
    // so an imported one must not be held to a stricter rule.
    const text = await appended(
      pdfWithAnnots([
        "<< /Type /Annot /Subtype /Link /Rect [10 10 50 50] " +
          "/A << /S /URI /URI (mailto:clerk@example.com) >> >>",
        "<< /Type /Annot /Subtype /Link /Rect [10 60 50 90] " +
          "/A << /S /URI /URI (myapp://open/invoice) >> >>",
      ]),
    );
    expect(text).toContain("mailto:clerk@example.com");
    expect(text).toContain("myapp://open/invoice");
  });

  it("never copies /AA, where a cursor-triggered script would hide", async () => {
    const text = await appended(
      pdfWithAnnots(
        [
          "<< /Type /Annot /Subtype /Square /Rect [10 10 50 50] /Contents (keep-me) " +
            "/AA << /E << /S /JavaScript /JS (DROP-mouseover) >> >> >>",
        ],
        {
          pageExtra:
            "/AA << /O << /S /JavaScript /JS (DROP-pageopen) >> >> /StructParents 3 /B [9 0 R] ",
        },
      ),
    );
    expect(text).toContain("keep-me"); // the annotation itself survived
    expect(text).not.toContain("DROP-mouseover");
    expect(text).not.toContain("DROP-pageopen");
    expect(text).not.toContain("/AA");
    expect(text).not.toContain("/JavaScript");
    // Page-level keys outside the whitelist are left behind too.
    expect(text).not.toContain("/StructParents");
  });
});

// ── Destinations ──────────────────────────────────────────────────────

describe("append() — destinations", () => {
  it("keeps a /GoTo into a page that came along", async () => {
    const text = await appended(
      twoPagePdf(
        "<< /Type /Annot /Subtype /Link " +
          "/Rect [10 10 50 50] /A << /S /GoTo /D [5 0 R /Fit] >> >>",
      ),
    );
    expect(text).toContain("/Subtype /Link");
    expect(text).toContain("/S /GoTo");
  });

  it("drops a /GoTo whose target page was left behind", async () => {
    const text = await appended(
      twoPagePdf(
        "<< /Type /Annot /Subtype /Link /Rect [10 10 50 50] " +
          "/A << /S /GoTo /D [5 0 R /Fit] >> >>",
      ),
      { pages: [1] },
    );
    expect(text).not.toContain("/Subtype /Link");
    expect(text).not.toContain("/S /GoTo");
  });

  it("resolves a /Dest held behind an indirect reference", async () => {
    const text = await appended(
      twoPagePdf("<< /Type /Annot /Subtype /Link /Rect [10 10 50 50] /Dest 11 0 R >>", {
        11: "[5 0 R /Fit]",
      }),
    );
    expect(text).toContain("/Subtype /Link");
    expect(text).toContain("/Dest");
  });

  it("drops a named destination, whose name tree is not imported", async () => {
    // Keeping it would leave a link resolving against nothing.
    const text = await appended(
      twoPagePdf("<< /Type /Annot /Subtype /Link /Rect [10 10 50 50] /Dest (DROP-secret) >>"),
    );
    expect(text).not.toContain("/Subtype /Link");
    expect(text).not.toContain("DROP-secret");
  });

  it("drops a destination that is empty or points outside the import", async () => {
    for (const dest of ["[]", "[99 0 R /Fit]", "/DROP-nameobject"]) {
      const text = await appended(
        twoPagePdf(`<< /Type /Annot /Subtype /Link /Rect [10 10 50 50] /Dest ${dest} >>`),
      );
      expect(text).not.toContain("/Subtype /Link");
    }
  });

  it("drops a /GoTo that carries no destination at all", async () => {
    const text = await appended(
      twoPagePdf("<< /Type /Annot /Subtype /Link /Rect [10 10 50 50] /A << /S /GoTo >> >>"),
    );
    expect(text).not.toContain("/Subtype /Link");
    expect(text).not.toContain("/S /GoTo");
  });

  it("drops a /Link that would survive as a dead rectangle", async () => {
    const text = await appended(
      pdfWithAnnots(["<< /Type /Annot /Subtype /Link /Rect [10 10 50 50] /Border [0 0 0] >>"]),
    );
    expect(text).not.toContain("/Subtype /Link");
  });
});

// ── Geometry carried with an annotation ───────────────────────────────

describe("append() — annotation geometry", () => {
  it("falls back to an empty rectangle when /Rect is unusable", async () => {
    for (const rect of ["[1 2 (x) 4]", "[1 2 3]", "(not an array)", ""]) {
      const text = await appended(
        pdfWithAnnots([
          `<< /Type /Annot /Subtype /Square ${rect === "" ? "" : `/Rect ${rect}`} ` +
            `/Contents (keep-me) >>`,
        ]),
      );
      expect(text).toContain("/Rect [0 0 0 0]");
    }
  });

  it("resolves a /Rect written as indirect references", async () => {
    const text = await appended(
      pdfWithAnnots(["<< /Type /Annot /Subtype /Square /Rect [20 0 R 21 0 R 22 0 R 23 0 R] >>"], {
        extra: { 20: "11", 21: "22", 22: "33", 23: "44" },
      }),
    );
    expect(text).toContain("/Rect [11 22 33 44]");
  });

  it("keeps /QuadPoints in pairs and drops an unusable one", async () => {
    // An odd trailing value is truncated away rather than shifting every point.
    const odd = await appended(
      pdfWithAnnots([
        "<< /Type /Annot /Subtype /Highlight /Rect [10 10 90 50] " +
          "/QuadPoints [1 2 3 4 5 6 7 8 9] >>",
      ]),
    );
    expect(odd).toContain("/QuadPoints [1 2 3 4 5 6 7 8]");

    for (const quads of ["(nope)", "[1 2 3 (x)]"]) {
      const text = await appended(
        pdfWithAnnots([
          `<< /Type /Annot /Subtype /Highlight /Rect [10 10 90 50] /QuadPoints ${quads} >>`,
        ]),
      );
      expect(text).not.toContain("/QuadPoints");
    }
  });

  it("maps /Rect and /QuadPoints through the placement when a page is scaled", async () => {
    // With fit: "page" the imported page becomes a form XObject, so an
    // annotation's coordinates have to be transformed explicitly — left alone
    // they would land somewhere else entirely on the target page.
    const source = pdfWithAnnots([
      "<< /Type /Annot /Subtype /Highlight /Rect [100 100 200 150] " +
        "/QuadPoints [100 150 200 150 100 100 200 100] >>",
    ]);
    const pdf = new PDFDocument({ compress: false, format: "A4" });
    await pdf.append(source, { fit: "page" });
    const text = latin1String(await pdf.render());

    const quads = /\/QuadPoints \[([^\]]*)\]/.exec(text)![1]!.trim().split(/\s+/).map(Number);
    expect(quads).toHaveLength(8);
    // The source page is 400pt square and A4 is 595.28 wide, so everything is
    // scaled up by ~1.49 and the rectangle must have moved off its old numbers.
    expect(quads).not.toEqual([100, 150, 200, 150, 100, 100, 200, 100]);
    const rect = /\/Rect \[([^\]]*)\]/.exec(text)![1]!.trim().split(/\s+/).map(Number);
    expect(rect[2]! - rect[0]!).toBeCloseTo((200 - 100) * (595.28 / 400), 1);
    // Still lower-left first after the mapping.
    expect(rect[0]!).toBeLessThan(rect[2]!);
    expect(rect[1]!).toBeLessThan(rect[3]!);
  });

  it("terminates on an annotation that references itself", async () => {
    // The copier reserves a reference before fetching its target; without that
    // this file would recurse forever.
    const text = await appended(
      pdfWithAnnots([
        "<< /Type /Annot /Subtype /Square /Rect [10 10 50 50] /Contents (keep-me) /IRT 10 0 R >>",
      ]),
    );
    expect(text).toContain("keep-me");
    expect(text).toContain("/Subtype /Square");
  });
});

// ── Page geometry and resources ───────────────────────────────────────

describe("append() — page dictionary", () => {
  it("materializes /Resources inherited from the page tree", async () => {
    // The source page tree is not copied, so an inherited font that is not
    // written onto the page itself would leave the text unrenderable.
    const text = await appended(
      makeRawPdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2:
          "<< /Type /Pages /Kids [3 0 R] /Count 1 " +
          "/Resources << /Font << /F1 7 0 R >> >> /MediaBox [0 0 400 400] >>",
        3: "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
        4: { stream: "BT /F1 12 Tf 20 20 Td (hello) Tj ET" },
        7: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      }),
    );
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("/MediaBox [0 0 400 400]");
  });

  it("carries a /CropBox narrower than the media box onto the copy", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(pdfWithAnnots([], { pageExtra: "/CropBox [50 50 300 300] " }));
    const text = latin1String(await pdf.render());
    expect(text).toContain("/CropBox [50 50 300 300]");
    expect(pdf.pageSize).toEqual({ width: 250, height: 250 });
  });

  it("falls back to the media box when the crop box does not overlap it", async () => {
    const pdf = new PDFDocument();
    await pdf.append(pdfWithAnnots([], { pageExtra: "/CropBox [900 900 950 950] " }));
    expect(pdf.pageSize).toEqual({ width: 400, height: 400 });
  });

  it("normalizes a reversed and a non-numeric box", async () => {
    const reversed = new PDFDocument();
    await reversed.append(
      makeRawPdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: "<< /Type /Page /Parent 2 0 R /MediaBox [400 300 0 0] /Contents 4 0 R >>",
        4: { stream: " " },
      }),
    );
    expect(reversed.pageSize).toEqual({ width: 400, height: 300 });

    // A box that is not four numbers falls back to US Letter.
    const broken = new PDFDocument();
    await broken.append(
      makeRawPdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 (x) 400] /Contents 4 0 R >>",
        4: { stream: " " },
      }),
    );
    expect(broken.pageSize).toEqual({ width: 612, height: 792 });
  });

  it("rounds an odd /Rotate to a quarter turn and normalizes the sign", async () => {
    for (const [rotate, size] of [
      [-90, { width: 400, height: 300 }],
      [450, { width: 400, height: 300 }],
      [89, { width: 400, height: 300 }],
      [180, { width: 300, height: 400 }],
    ] as const) {
      const pdf = new PDFDocument();
      await pdf.append(await makeObjStmPdf({ rotate, mediaBox: [0, 0, 300, 400] }));
      expect(pdf.pageSize).toEqual(size);
    }
  });
});

// ── Rotation bridges ──────────────────────────────────────────────────

describe("append() — rotation", () => {
  it("writes the viewer's rotation into the form matrix for every quarter turn", async () => {
    // fit: "page" wraps the source in a form XObject, so the /Rotate flag the
    // viewer would have applied has to be baked into /Matrix instead.
    const expected: Record<number, string> = {
      0: "/Matrix [1 0 0 1 0 0]",
      90: "/Matrix [0 -1 1 0 0 300]",
      180: "/Matrix [-1 0 0 -1 300 400]",
      270: "/Matrix [0 1 -1 0 400 0]",
    };
    for (const rotate of [0, 90, 180, 270]) {
      const pdf = new PDFDocument({ compress: false, format: "A4" });
      await pdf.append(await makeObjStmPdf({ rotate, mediaBox: [0, 0, 300, 400] }), {
        fit: "page",
      });
      expect(latin1String(await pdf.render())).toContain(expected[rotate]!);
    }
  });

  it("counter-rotates an overlay so it reads upright on a turned page", async () => {
    const expected: Record<number, string> = {
      90: "/Matrix [0 1 -1 0 300 0]",
      180: "/Matrix [-1 0 0 -1 300 400]",
      270: "/Matrix [0 -1 1 0 0 400]",
    };
    for (const rotate of [90, 180, 270]) {
      const pdf = new PDFDocument({ compress: false });
      await pdf.append(await makeObjStmPdf({ rotate, mediaBox: [0, 0, 300, 400] }), {
        overlay: true,
      });
      pdf.text("Anlage", { y: 20 });
      expect(latin1String(await pdf.render())).toContain(expected[rotate]!);
    }
  });

  it("offsets the matrix by a media box that does not start at the origin", async () => {
    const pdf = new PDFDocument({ compress: false, format: "A4" });
    await pdf.append(await makeObjStmPdf({ mediaBox: [20, 30, 320, 430] }), { fit: "page" });
    expect(latin1String(await pdf.render())).toContain("/Matrix [1 0 0 1 -20 -30]");
  });
});

// ── Content streams ───────────────────────────────────────────────────

describe("append() — content streams", () => {
  const multiStream = (filter = ""): Uint8Array =>
    makeRawPdf({
      1: "<< /Type /Catalog /Pages 2 0 R >>",
      2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      3:
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents [4 0 R 7 0 R] " +
        "/Resources << >> >>",
      4: { stream: "0 0 1 rg 10 10 120 60 re f", dict: filter },
      7: { stream: "1 0 0 rg 200 200 50 50 re f", dict: filter },
    });

  it("concatenates a multi-stream page when it has to be wrapped in a form", async () => {
    const pdf = new PDFDocument({ compress: false, format: "A4" });
    await pdf.append(multiStream(), { fit: "page" });
    const text = latin1String(await pdf.render());
    // Both streams are in the form, in order, separated so the last operator
    // of one cannot run into the first of the next.
    expect(text).toContain("10 10 120 60 re f");
    expect(text).toContain("200 200 50 50 re f");
    expect(text.indexOf("10 10 120 60 re f")).toBeLessThan(text.indexOf("200 200 50 50 re f"));
  });

  it("re-compresses the concatenated stream when the document is compressed", async () => {
    const pdf = new PDFDocument({ compress: true, format: "A4" });
    await pdf.append(multiStream(), { fit: "page" });
    const text = latin1String(await pdf.render());
    expect(text).toContain("/Subtype /Form");
    // Decoded and joined, so it must be re-encoded rather than grow.
    expect(text).not.toContain("200 200 50 50 re f");
  });

  it("copies a single stream byte-for-byte, filters and all", async () => {
    // One stream needs no decoding, so an exotic filter is no obstacle.
    const pdf = new PDFDocument({ compress: false, format: "A4" });
    await pdf.append(
      makeRawPdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3:
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R " +
          "/Resources << >> >>",
        4: { stream: "LZW-ENCODED-BYTES", dict: "/Filter /LZWDecode" },
      }),
      { fit: "page" },
    );
    const text = latin1String(await pdf.render());
    expect(text).toContain("/Filter /LZWDecode");
    expect(text).toContain("LZW-ENCODED-BYTES");
  });

  it('points at fit: "keep" when a multi-stream page cannot be decoded', async () => {
    // Several streams must be joined, which needs decoding — and the error
    // has to name the way out instead of just failing.
    const pdf = new PDFDocument({ format: "A4" });
    await pdf.append(multiStream("/Filter /LZWDecode"), { fit: "page" });
    await expect(pdf.render()).rejects.toMatchObject({ code: "UNSUPPORTED_PDF" });
    await expect(pdf.render()).rejects.toThrow(/fit: "keep"/);

    // …and that way out really works, so the message is not an empty promise.
    const keep = new PDFDocument({ compress: false });
    await keep.append(multiStream("/Filter /LZWDecode"));
    expect(latin1String(await keep.render())).toContain("/Filter /LZWDecode");
  });

  it("surfaces a corrupt compressed stream as a parse error, not as bad advice", async () => {
    // Joining several streams means decoding them, and a stream that claims
    // /FlateDecode without being deflate data is simply broken. It must not be
    // reported as an unsupported filter — that would send the caller to
    // fit: "keep", which cannot rescue a corrupt file either.
    const pdf = new PDFDocument({ format: "A4" });
    await pdf.append(multiStream("/Filter /FlateDecode"), { fit: "page" });
    try {
      await pdf.render();
      expect.unreachable();
    } catch (error) {
      expect((error as FastPDFError).code).toBe("INVALID_PDF_FILE");
      expect((error as Error).message).not.toMatch(/fit: "keep"/);
    }
  });

  it("overlays a page that has no /Resources of its own", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(
      makeRawPdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R >>",
        4: { stream: "0 0 1 rg 10 10 120 60 re f" },
      }),
      { overlay: true },
    );
    pdf.text("Anlage 1", { y: 20 });
    const text = latin1String(await pdf.render());
    expect(text).toContain("/FpOverlay Do");
    expect(text).toContain("(Anlage 1) Tj");
  });

  it("wraps a page that has no /Resources into a form", async () => {
    const pdf = new PDFDocument({ compress: false, format: "A4" });
    await pdf.append(
      makeRawPdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R >>",
        4: { stream: "0 0 1 rg 10 10 120 60 re f" },
      }),
      { fit: "page" },
    );
    const text = latin1String(await pdf.render());
    // An empty /Resources still has to be written: a form XObject without one
    // inherits the target page's, which is not what the source drew against.
    expect(text).toContain("/Subtype /Form");
    expect(text).toContain("/FpImport Do");
    expect(text).toContain("10 10 120 60 re f");
  });

  it("keeps an existing /XObject entry when adding the overlay", async () => {
    const pdf = new PDFDocument({ compress: false });
    await pdf.append(
      makeRawPdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3:
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R " +
          "/Resources << /XObject << /Img0 7 0 R >> >> >>",
        4: { stream: "q 100 0 0 50 10 10 cm /Img0 Do Q" },
        7: {
          stream: "0 0 1 rg 0 0 1 1 re f",
          dict: "/Type /XObject /Subtype /Form /BBox [0 0 1 1]",
        },
      }),
      { overlay: true },
    );
    pdf.text("Anlage", { y: 20 });
    const text = latin1String(await pdf.render());
    // The source's own XObject must not be displaced by the overlay's.
    expect(text).toContain("/Img0");
    expect(text).toContain("/FpOverlay");
  });
});
