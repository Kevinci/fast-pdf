import { describe, expect, it } from "vitest";
import { FastPDFError, PDFDocument } from "../src/index";
import { pdfA } from "../src/pdfa/index";
import { buildXmp, escapeXml } from "../src/pdfa/xmp";
import { srgbProfile } from "../src/pdfa/icc";
import { facturX, type FacturXProfile } from "../src/zugferd/index";
import { latin1String } from "../src/pdf/objects";
import { makeJpeg, makeRawPdf, makeSigner, makeTTF } from "./helpers";

/**
 * The synthetic test font has exactly three glyphs — A, B and C — so every
 * conforming document below is written with those letters only. Anything
 * else (a space included) is a missing glyph, which is itself a test case.
 */
const FONT = makeTTF();

function archivable(options: ConstructorParameters<typeof PDFDocument>[0] = {}): PDFDocument {
  const doc = new PDFDocument({ font: "test", compress: false, ...options });
  doc.registerFont(FONT, { family: "test" });
  return doc;
}

const render = async (doc: PDFDocument): Promise<string> => latin1String(await doc.render());

/** The XMP packet, decoded as the UTF-8 it must be. */
async function xmpOf(doc: PDFDocument): Promise<string> {
  const bytes = await doc.render();
  const text = latin1String(bytes);
  const start = text.indexOf("<?xpacket begin");
  const end = text.indexOf("<?xpacket end");
  expect(start).toBeGreaterThan(-1);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end + 19));
}

async function violation(doc: PDFDocument): Promise<FastPDFError> {
  const error = await doc.render().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FastPDFError);
  expect((error as FastPDFError).code).toBe("PDFA_VIOLATION");
  return error as FastPDFError;
}

const cii = (guideline: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
 <rsm:ExchangedDocumentContext>
  <ram:GuidelineSpecifiedDocumentContextParameter>
   <ram:ID>${guideline}</ram:ID>
  </ram:GuidelineSpecifiedDocumentContextParameter>
 </rsm:ExchangedDocumentContext>
</rsm:CrossIndustryInvoice>`;

const EN16931 = "urn:cen.eu:en16931:2017";

describe("pdfA(): what the mode adds", () => {
  it("leaves a document that never opted in exactly as it was", async () => {
    const pdf = await render(archivable().text("ABC"));
    for (const key of [
      "/Metadata",
      "/OutputIntents",
      "/EmbeddedFile",
      "/AF ",
      "/Names",
      "xpacket",
    ]) {
      expect(pdf).not.toContain(key);
    }
  });

  it("writes an unfiltered XMP metadata stream with the PDF/A identification", async () => {
    const doc = archivable();
    pdfA(doc);
    doc.text("ABC");
    const pdf = await render(doc);
    // [6.6.2.1-1] catalog /Metadata → stream with /Type /Metadata /Subtype /XML
    expect(pdf).toMatch(/\/Type \/Catalog[\s\S]*?\/Metadata \d+ 0 R/);
    expect(pdf).toMatch(/<<[^>]*\/Type \/Metadata[^>]*\/Subtype \/XML[^>]*>>\s*stream/);
    expect(pdf).not.toMatch(/\/Type \/Metadata[^>]*\/Filter/);
    const xmp = await xmpOf(doc);
    expect(xmp).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(xmp).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
    expect(xmp).toContain('xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"');
    // [6.6.2.1-2/-3] no bytes/encoding attribute in the packet header
    expect(
      xmp.startsWith(
        `<?xpacket begin="${String.fromCodePoint(0xfeff)}" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
      ),
    ).toBe(true);
    expect(xmp.endsWith('<?xpacket end="w"?>')).toBe(true);
  });

  it("declares level U when asked", async () => {
    const doc = archivable();
    expect(pdfA(doc, { conformance: "U" }).conformance).toBe("U");
    doc.text("ABC");
    expect(await xmpOf(doc)).toContain("<pdfaid:conformance>U</pdfaid:conformance>");
  });

  it("writes an output intent with the bundled sRGB profile", async () => {
    const doc = archivable();
    pdfA(doc);
    doc.text("ABC");
    const pdf = await render(doc);
    expect(pdf).toMatch(/\/OutputIntents \[\d+ 0 R\]/);
    expect(pdf).toMatch(/\/Type \/OutputIntent[^>]*\/S \/GTS_PDFA1/);
    expect(pdf).toContain("/OutputConditionIdentifier (sRGB IEC61966-2.1)");
    expect(pdf).toMatch(/<< \/N 3 \/Length 456 >>/);
  });

  it("bundles a profile that satisfies [6.2.3-1]", () => {
    const icc = srgbProfile();
    const tag = (at: number): string => String.fromCharCode(...icc.subarray(at, at + 4));
    expect(icc.length).toBe(456);
    // The profile's own size field must agree with what we ship.
    expect(new DataView(icc.buffer).getUint32(0)).toBe(456);
    expect(tag(36)).toBe("acsp");
    expect(tag(12)).toBe("mntr");
    expect(tag(16)).toBe("RGB ");
  });

  it("mirrors the document metadata into XMP, escaped and as UTF-8", async () => {
    const doc = archivable({
      metadata: {
        title: 'Größe & <Preis> "€"',
        author: "Jürgen Ü",
        subject: "Betreff",
        keywords: "a, b",
        creator: "billing",
        producer: "acme",
        creationDate: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
      },
    });
    pdfA(doc);
    doc.text("ABC");
    const xmp = await xmpOf(doc);
    expect(xmp).toContain(
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Größe &amp; &lt;Preis&gt; &quot;€&quot;</rdf:li></rdf:Alt></dc:title>',
    );
    expect(xmp).toContain("<dc:creator><rdf:Seq><rdf:li>Jürgen Ü</rdf:li></rdf:Seq></dc:creator>");
    expect(xmp).toContain('<rdf:li xml:lang="x-default">Betreff</rdf:li>');
    expect(xmp).toContain("<pdf:Keywords>a, b</pdf:Keywords>");
    expect(xmp).toContain("<pdf:Producer>acme</pdf:Producer>");
    expect(xmp).toContain("<xmp:CreatorTool>billing</xmp:CreatorTool>");
    expect(xmp).toContain("<xmp:CreateDate>2026-01-02T03:04:05Z</xmp:CreateDate>");
    expect(xmp).toContain("<xmp:ModifyDate>2026-01-02T03:04:05Z</xmp:ModifyDate>");
    // …and the Info dictionary says the same instant.
    expect(await render(doc)).toContain("/CreationDate (D:20260102030405Z)");
  });

  it("stays byte-identical in deterministic mode, with no timestamp anywhere", async () => {
    const build = (): PDFDocument => {
      const doc = archivable({ deterministic: true });
      pdfA(doc).attach({ filename: "a.txt", data: "x", mimeType: "text/plain" });
      doc.text("ABC");
      return doc;
    };
    const first = await render(build());
    expect(await render(build())).toBe(first);
    expect(first).not.toContain("xmp:CreateDate");
    expect(first).not.toContain("/ModDate");
  });

  it("returns the same handle when called twice, and rejects conflicting options", () => {
    const doc = archivable();
    const handle = pdfA(doc);
    expect(pdfA(doc)).toBe(handle);
    expect(pdfA(doc, { conformance: "B" })).toBe(handle);
    expect(() => pdfA(doc, { conformance: "U" })).toThrow(/already enabled/);
  });

  it("rejects level A and other unknown levels", () => {
    expect(() => pdfA(archivable(), { conformance: "A" as never })).toThrow(/tagged PDF/);
  });

  it("accepts a custom RGB profile and rejects anything else", async () => {
    const custom = srgbProfile();
    const doc = archivable();
    pdfA(doc, { outputProfile: { data: custom, identifier: "Custom RGB" } });
    doc.text("ABC");
    expect(await render(doc)).toContain("/OutputConditionIdentifier (Custom RGB)");

    const bad = (mutate: (icc: Uint8Array) => Uint8Array, identifier = "x"): (() => unknown) => {
      return () =>
        pdfA(archivable(), { outputProfile: { data: mutate(srgbProfile()), identifier } });
    };
    const put = (at: number, text: string) => (icc: Uint8Array) => {
      for (let i = 0; i < 4; i++) icc[at + i] = text.charCodeAt(i);
      return icc;
    };
    expect(bad(() => new Uint8Array(10))).toThrow(/not an ICC profile/);
    expect(bad(put(36, "nope"))).toThrow(/not an ICC profile/);
    expect(bad(put(12, "scnr"))).toThrow(/monitor or printer/);
    expect(bad(put(16, "CMYK"))).toThrow(/RGB profile/);
    expect(bad((icc) => icc, " ")).toThrow(/identifier/);
  });
});

describe("pdfA(): what the mode refuses", () => {
  it("refuses the built-in fonts and says what to do instead", async () => {
    const doc = new PDFDocument();
    pdfA(doc);
    doc.text("Hello");
    const error = await violation(doc);
    expect(error.message).toContain('"Helvetica"');
    expect(error.message).toContain("registerFont()");
  });

  it("refuses a built-in font even when most text is embedded", async () => {
    const doc = archivable();
    pdfA(doc);
    doc.text("ABC");
    doc.text("ABC", { font: "courier" });
    expect((await violation(doc)).message).toContain('"Courier"');
  });

  it("refuses text the font has no glyph for (.notdef), naming the character", async () => {
    const doc = archivable();
    pdfA(doc);
    doc.text("ABCé");
    const error = await violation(doc);
    expect(error.message).toContain("U+00E9");
    expect(error.message).toContain("TestFont");
  });

  it("lets the same missing glyph through without PDF/A", async () => {
    await expect(archivable().text("ABCé").render()).resolves.toBeInstanceOf(Uint8Array);
  });

  it("refuses encryption", async () => {
    const doc = archivable({ encrypt: { userPassword: "x" } });
    pdfA(doc);
    doc.text("ABC");
    expect((await violation(doc)).message).toContain("encrypt");
  });

  it("refuses appended pages", async () => {
    const doc = archivable();
    pdfA(doc);
    doc.text("ABC");
    await doc.append(
      makeRawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
      ]),
    );
    expect((await violation(doc)).message).toContain("append()");
  });

  it("refuses CMYK JPEGs but accepts RGB ones", async () => {
    const cmyk = archivable();
    pdfA(cmyk);
    cmyk.image(makeJpeg(4, 4, 4), { width: 10 });
    expect((await violation(cmyk)).message).toContain("CMYK");

    const rgb = archivable();
    pdfA(rgb);
    rgb.image(makeJpeg(4, 4, 3), { width: 10 });
    await expect(rgb.render()).resolves.toBeInstanceOf(Uint8Array);
  });

  it("allows signature fields, signed or not", async () => {
    const unsigned = archivable();
    pdfA(unsigned);
    unsigned.text("ABC");
    unsigned.signature({ name: "sig", width: 100, height: 30 });
    await expect(unsigned.render()).resolves.toBeInstanceOf(Uint8Array);

    const signed = archivable();
    pdfA(signed);
    signed.text("ABC");
    signed.signature({ name: "sig", width: 100, height: 30, sign: await makeSigner() });
    const pdf = latin1String(await signed.render());
    expect(pdf).toContain("/SubFilter /ETSI.CAdES.detached");
    expect(pdf).toContain("<pdfaid:part>3</pdfaid:part>");
  });

  it("checks at render time, so the order of calls does not matter", async () => {
    const doc = new PDFDocument();
    doc.text("Hello");
    pdfA(doc); // enabled after the offending text was drawn
    await violation(doc);
  });
});

describe("pdfA().attach()", () => {
  it("embeds a file with everything [6.8] asks for", async () => {
    const doc = archivable({ metadata: { creationDate: new Date(Date.UTC(2026, 4, 6, 7, 8, 9)) } });
    pdfA(doc).attach({
      filename: "data.csv",
      data: "a;b\n",
      mimeType: "text/csv",
      relationship: "Source",
      description: "Rohdaten",
    });
    doc.text("ABC");
    const pdf = await render(doc);
    // [6.8-1] MIME type as /Subtype — a name, so the slash is escaped.
    expect(pdf).toMatch(/\/Type \/EmbeddedFile \/Subtype \/text#2Fcsv/);
    expect(pdf).toContain("/Params << /Size 4 /ModDate (D:20260506070809Z) >>");
    // [6.8-2] /F and /UF, [6.8-3] /AFRelationship.
    expect(pdf).toMatch(
      /\/Type \/Filespec \/F \(data\.csv\) \/UF \(data\.csv\) \/AFRelationship \/Source \/Desc \(Rohdaten\) \/EF << \/F (\d+) 0 R \/UF \1 0 R >>/,
    );
    // Reachable through the name tree and registered as an associated file.
    expect(pdf).toMatch(/\/Names << \/EmbeddedFiles << \/Names \[\(data\.csv\) (\d+) 0 R\] >> >>/);
    expect(pdf).toMatch(/\/AF \[\d+ 0 R\]/);
    expect(pdf).toContain("stream\na;b\n\nendstream");
  });

  it("stores exactly the bytes it was given", async () => {
    const payload = Uint8Array.from({ length: 256 }, (_, i) => i);
    const doc = archivable();
    pdfA(doc).attach({ filename: "bin.dat", data: payload, mimeType: "application/octet-stream" });
    doc.text("ABC");
    const pdf = await render(doc);
    expect(pdf).toContain(`stream\n${latin1String(payload)}\nendstream`);
    expect(pdf).toContain("/AFRelationship /Unspecified");
  });

  it("keeps the name tree sorted whatever the attach order", async () => {
    const doc = archivable();
    const archive = pdfA(doc);
    for (const name of ["zeta.txt", "alpha.txt", "Mid.txt"]) {
      archive.attach({ filename: name, data: name, mimeType: "text/plain" });
    }
    doc.text("ABC");
    const names = /\/EmbeddedFiles << \/Names \[([^\]]*)\]/.exec(await render(doc))![1]!;
    expect([...names.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])).toEqual([
      "Mid.txt",
      "alpha.txt",
      "zeta.txt",
    ]);
  });

  it.each([
    [{ filename: "" }, /filename/],
    [{ filename: "a/b.txt" }, /without a path/],
    [{ filename: "..\\b.txt" }, /without a path/],
    [{ filename: ".." }, /without a path/],
    [{ filename: "a\u0000.txt" }, /without a path/],
    [{ filename: "x".repeat(256) }, /255/],
    [{ mimeType: "xml" }, /MIME type/],
    [{ mimeType: "text/xml; charset=utf-8" }, /MIME type/],
    [{ relationship: "Other" as never }, /relationship/],
    [{ data: 42 as never }, /Uint8Array or a string/],
  ])("rejects an invalid attachment %#", (override, message) => {
    const archive = pdfA(archivable());
    expect(() =>
      archive.attach({ filename: "ok.txt", data: "x", mimeType: "text/plain", ...override }),
    ).toThrow(message);
  });

  it("rejects a duplicate file name", () => {
    const archive = pdfA(archivable());
    archive.attach({ filename: "a.txt", data: "1", mimeType: "text/plain" });
    expect(() => archive.attach({ filename: "a.txt", data: "2", mimeType: "text/plain" })).toThrow(
      /already exists/,
    );
  });
});

describe("facturX()", () => {
  it("builds the container: PDF/A-3, factur-x.xml, AF, and the fx: XMP properties", async () => {
    const doc = archivable();
    const xml = cii(EN16931);
    facturX(doc, xml, { profile: "EN 16931" });
    doc.text("ABC");
    const pdf = await render(doc);
    expect(pdf).toMatch(/\/Type \/EmbeddedFile \/Subtype \/text#2Fxml/);
    expect(pdf).toMatch(
      /\/Type \/Filespec \/F \(factur-x\.xml\) \/UF \(factur-x\.xml\) \/AFRelationship \/Alternative/,
    );
    expect(pdf).toMatch(/\/Names \[\(factur-x\.xml\) \d+ 0 R\]/);
    expect(pdf).toMatch(/\/AF \[\d+ 0 R\]/);
    expect(pdf).toContain(`stream\n${xml}\nendstream`);

    const xmp = await xmpOf(doc);
    expect(xmp).toContain('xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"');
    expect(xmp).toContain("<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>");
    expect(xmp).toContain("<fx:DocumentType>INVOICE</fx:DocumentType>");
    expect(xmp).toContain("<fx:Version>1.0</fx:Version>");
    expect(xmp).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
    expect(xmp).toContain("<pdfaid:part>3</pdfaid:part>");
  });

  it("declares every fx: property it uses in a PDF/A extension schema", async () => {
    const doc = archivable();
    facturX(doc, cii(EN16931), { profile: "EN 16931" });
    doc.text("ABC");
    const xmp = await xmpOf(doc);
    expect(xmp).toContain(
      "<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>",
    );
    expect(xmp).toContain("<pdfaSchema:prefix>fx</pdfaSchema:prefix>");
    const used = [...xmp.matchAll(/<fx:(\w+)>/g)].map((m) => m[1]).sort();
    const declared = [...xmp.matchAll(/<pdfaProperty:name>(\w+)<\/pdfaProperty:name>/g)]
      .map((m) => m[1])
      .sort();
    expect(used).toEqual(["ConformanceLevel", "DocumentFileName", "DocumentType", "Version"]);
    expect(declared).toEqual(used);
    expect(xmp.match(/<pdfaProperty:valueType>Text<\/pdfaProperty:valueType>/g)).toHaveLength(4);
    expect(xmp.match(/<pdfaProperty:category>external<\/pdfaProperty:category>/g)).toHaveLength(4);
  });

  it.each<[FacturXProfile, string, string, string]>([
    ["MINIMUM", "urn:factur-x.eu:1p0:minimum", "factur-x.xml", "Data"],
    ["BASIC WL", "urn:factur-x.eu:1p0:basicwl", "factur-x.xml", "Data"],
    [
      "BASIC",
      "urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic",
      "factur-x.xml",
      "Alternative",
    ],
    ["EN 16931", EN16931, "factur-x.xml", "Alternative"],
    [
      "EXTENDED",
      "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended",
      "factur-x.xml",
      "Alternative",
    ],
    [
      "XRECHNUNG",
      "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
      "xrechnung.xml",
      "Alternative",
    ],
  ])(
    "profile %s → file name and relationship",
    async (profile, guideline, filename, relationship) => {
      const doc = archivable();
      facturX(doc, cii(guideline), { profile });
      doc.text("ABC");
      const pdf = await render(doc);
      expect(pdf).toContain(`/F (${filename})`);
      expect(pdf).toContain(`/AFRelationship /${relationship}`);
      const xmp = await xmpOf(doc);
      expect(xmp).toContain(`<fx:ConformanceLevel>${profile}</fx:ConformanceLevel>`);
      expect(xmp).toContain(`<fx:DocumentFileName>${filename}</fx:DocumentFileName>`);
    },
  );

  it("accepts the XML as bytes and lets the relationship be overridden", async () => {
    const doc = archivable();
    facturX(doc, new TextEncoder().encode(cii(EN16931)), {
      profile: "EN 16931",
      relationship: "Source",
      description: "E-Rechnung",
    });
    doc.text("ABC");
    const pdf = await render(doc);
    expect(pdf).toContain("/AFRelationship /Source");
    expect(pdf).toContain("/Desc (E-Rechnung)");
  });

  it("returns the PDF/A handle so further files can be attached", async () => {
    const doc = archivable();
    facturX(doc, cii(EN16931), { profile: "EN 16931" }).attach({
      filename: "zeiten.csv",
      data: "x",
      mimeType: "text/csv",
      relationship: "Supplement",
    });
    doc.text("ABC");
    const pdf = await render(doc);
    expect(pdf).toMatch(/\/Names \[\(factur-x\.xml\) \d+ 0 R \(zeiten\.csv\) \d+ 0 R\]/);
    expect(pdf).toMatch(/\/AF \[\d+ 0 R \d+ 0 R\]/);
  });

  it("refuses an XML whose guideline contradicts the profile", () => {
    expect(() => facturX(archivable(), cii(EN16931), { profile: "BASIC" })).toThrow(
      /does not match the profile "BASIC"/,
    );
    expect(() =>
      facturX(archivable(), cii("urn:factur-x.eu:1p0:minimum"), { profile: "EN 16931" }),
    ).toThrow(/does not match/);
  });

  it("refuses what is not a CII invoice", () => {
    expect(() => facturX(archivable(), "<Invoice/>", { profile: "EN 16931" })).toThrow(
      /CrossIndustryInvoice/,
    );
    expect(() =>
      facturX(archivable(), "<rsm:CrossIndustryInvoice></rsm:CrossIndustryInvoice>", {
        profile: "EN 16931",
      }),
    ).toThrow(/GuidelineSpecifiedDocumentContextParameter/);
    expect(() => facturX(archivable(), "", { profile: "EN 16931" })).toThrow(/empty/);
    expect(() => facturX(archivable(), 1 as never, { profile: "EN 16931" })).toThrow(/Uint8Array/);
  });

  it("skips the plausibility check on request", () => {
    expect(() =>
      facturX(archivable(), "<anything/>", { profile: "EN 16931", checkXml: false }),
    ).not.toThrow();
  });

  it("refuses an unknown profile", () => {
    expect(() => facturX(archivable(), cii(EN16931), { profile: "COMFORT" as never })).toThrow(
      /profile must be one of/,
    );
    expect(() => facturX(archivable(), cii(EN16931), undefined as never)).toThrow(/profile/);
  });

  it("still enforces PDF/A on the page content", async () => {
    const doc = new PDFDocument();
    facturX(doc, cii(EN16931), { profile: "EN 16931" });
    doc.text("Rechnung");
    await violation(doc);
  });
});

describe("markdown codeFont", () => {
  it("lets Markdown code be set in an embedded font, which PDF/A needs", async () => {
    const withDefault = archivable();
    pdfA(withDefault);
    withDefault.markdown("ABC `AB`");
    expect((await violation(withDefault)).message).toContain("codeFont");

    const withFont = archivable();
    pdfA(withFont);
    withFont.markdown("ABC `AB`\n\n```\nABC\n```", { codeFont: "test" });
    await expect(withFont.render()).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("XMP writer", () => {
  it("escapes markup and drops characters XML 1.0 cannot carry", () => {
    expect(escapeXml(`a<b>&"c"`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
    expect(escapeXml("a\u0000b\u0008c\u000Bd\tE\nF")).toBe("abcd\tE\nF");
    expect(escapeXml("x￾y￿z")).toBe("xyz");
    expect(escapeXml("😀")).toBe("😀");
  });

  it("omits what the document does not say", () => {
    const xmp = buildXmp({
      part: 3,
      conformance: "B",
      metadata: {},
      producer: "fast-pdf",
      extensions: [],
    });
    for (const absent of [
      "dc:title",
      "dc:creator",
      "xmlns:xmp=",
      "pdfaExtension",
      "pdf:Keywords",
    ]) {
      expect(xmp).not.toContain(absent);
    }
    expect(xmp).toContain("<dc:format>application/pdf</dc:format>");
    expect(xmp).toContain("<pdf:Producer>fast-pdf</pdf:Producer>");
  });
});
