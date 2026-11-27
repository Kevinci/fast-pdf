/**
 * PDF/A fixtures for the veraPDF gate.
 *
 * `examples/zugferd.ts` is a realistic invoice, which makes it a narrow test:
 * text, one table, one rectangle. veraPDF only judges what a file contains,
 * so a feature that never appears in a validated file has not been validated.
 * This script renders the documents that close that gap:
 *
 *   pdfa-full-3u.pdf    every feature PDF/A mode allows, at level U
 *   pdfa-signed-3b.pdf  a PAdES-signed PDF/A-3b ([6.4.3])
 *
 * Usage: tsx .github/scripts/pdfa-fixtures.ts <output-dir>
 * Font:  FAST_PDF_FONT / FAST_PDF_FONT_BOLD, else DejaVu Sans or Arial.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "../../src/index";
import { pdfA } from "../../src/pdfa/index";
import { makeGif, makePng, makeSigner } from "../../tests/helpers";

const out = process.argv[2];
if (out === undefined) throw new Error("usage: pdfa-fixtures.ts <output-dir>");
mkdirSync(out, { recursive: true });

const CANDIDATES: [string, string][] = [
  [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ],
  [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ],
];
const env = process.env["FAST_PDF_FONT"];
const fonts: [string, string] | undefined =
  env !== undefined
    ? [env, process.env["FAST_PDF_FONT_BOLD"] ?? env]
    : CANDIDATES.find(([regular, bold]) => existsSync(regular) && existsSync(bold));
if (fonts === undefined) throw new Error("no TrueType font found — set FAST_PDF_FONT");
const regular = readFileSync(fonts[0]);
const bold = readFileSync(fonts[1]);

function document(title: string): PDFDocument {
  const doc = new PDFDocument({
    font: "body",
    language: "de-DE",
    metadata: {
      title,
      author: "fast-pdf CI — Jürgen Größe",
      subject: 'Prüfdokument <PDF/A> & "Sonderzeichen"',
      keywords: "pdfa, verapdf, prüfung",
      creator: "pdfa-fixtures.ts",
    },
  });
  doc.registerFont(regular, { family: "body" });
  doc.registerFont(bold, { family: "body", bold: true });
  return doc;
}

const LOREM =
  "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor " +
  "invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam " +
  "et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est.";

// ── 1. Everything PDF/A mode allows, at level U ─────────────────────────
{
  const doc = document("PDF/A-3u — vollständiges Prüfdokument");
  const archive = pdfA(doc, { conformance: "U" });
  archive.attach({
    filename: "daten.csv",
    data: "a;b\n1;2\n",
    mimeType: "text/csv",
    relationship: "Source",
    description: "Rohdaten – Größe & Gewicht",
  });
  archive.attach({
    filename: "notiz.txt",
    data: new TextEncoder().encode("Anhang zwei"),
    mimeType: "text/plain",
    modDate: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
  });

  doc
    .header("fast-pdf — PDF/A-Prüfdokument", { align: "right", color: "#888888" })
    .footer("© 2026 — nur für die Validierung", { align: "left", color: "#888888" })
    .pageNumbers({ format: (n, t) => `Seite ${n} von ${t}` })
    .watermark("PRÜFUNG");
  doc.pageBackground("#fcfcfd");

  doc.outline("Typografie");
  doc.anchor("typo");
  doc.text("Typografie", { size: 22, bold: true, spacingAfter: 8 });
  doc.text("Unterstrichen", { underline: true });
  doc.text("Durchgestrichen", { strikethrough: true });
  doc.text("Gesperrt mit Letter-Spacing", { letterSpacing: 2 });
  doc.text("Umlaute und Zeichen: ÄÖÜäöüß € „Zitat“ – — … ©");
  doc.text(LOREM, { align: "justify", spacingAfter: 8 });
  doc.text("Gedreht", { rotate: 8, color: "#b91c1c" });
  doc.text("Halbtransparent", { opacity: 0.4, spacingAfter: 8 });

  doc.outline("Layout");
  doc.text("Layout", { size: 16, bold: true, spacingAfter: 6 });
  doc.container(
    { background: "#eef4ff", border: { color: "#4a7dff", width: 1 }, radius: 8, padding: 12 },
    (d) => {
      d.text("Container mit Hintergrund, Rahmen und Radius.", { align: "center" });
    },
  );
  doc.moveDown(0.5);
  doc.columns([(d) => d.text("Linke Spalte."), (d) => d.text(LOREM)], {
    widths: ["35%", "65%"],
    gap: 16,
  });
  doc.moveDown(0.5);

  doc.outline("Formen");
  doc.text("Formen und Transparenz", { size: 16, bold: true, spacingAfter: 6 });
  const y0 = doc.y;
  doc.circle(90, y0 + 30, 25, { fill: "#ffd166", stroke: "#c79000" });
  doc.ellipse(190, y0 + 30, 45, 22, { fill: "#8ecae6", opacity: 0.6 });
  doc.rect(250, y0 + 8, 90, 45, { fill: "#e0fbe2", stroke: "#3a7d44", radius: 10, opacity: 0.5 });
  doc.rect(300, y0 + 20, 90, 45, { fill: "rgba(37, 99, 235, 0.35)" });
  doc.line(60, y0 + 75, 400, y0 + 75, { color: "#999999", width: 0.75 });
  doc.clip({ x: 430, y: y0, width: 60, height: 60, radius: 30 }, (d) => {
    d.rect(430, y0, 60, 60, { fill: "#7c3aed" });
  });
  doc.y = y0 + 90;

  doc.pageBreak();
  doc.outline("Bilder");
  doc.text("Bilder", { size: 16, bold: true, spacingAfter: 6 });
  // A real photo-like PNG (RGB, deflated IDAT passed through with a predictor).
  doc.image(readFileSync("docs/assets/demo-quickstart.png"), { width: 220 });
  // RGBA → image plus soft mask.
  doc.image(await makePng(8, 8, 6, [220, 38, 38, 128]), { width: 60, opacity: 0.8 });
  // Grayscale.
  doc.image(await makePng(8, 8, 0, [90]), { width: 60, radius: 8 });
  // GIF, with and without a transparent index.
  doc.image(makeGif(2, 2, [255, 0, 0, 0, 0, 255], [0, 1, 1, 0]), { width: 60 });
  doc.image(makeGif(2, 2, [255, 0, 0, 0, 0, 255], [0, 1, 1, 0], { transparentIndex: 0 }), {
    width: 60,
    rotate: 10,
  });

  doc.outline("Vektor");
  doc.text("SVG", { size: 16, bold: true, spacingAfter: 6 });
  doc.svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">
       <rect x="5" y="5" width="190" height="70" rx="10" fill="#0f172a"/>
       <circle cx="45" cy="40" r="22" fill="#38bdf8" fill-opacity="0.7"/>
       <path d="M80 60 L110 20 L140 60 Z" fill="#f59e0b" stroke="#fff" stroke-width="2" opacity="0.9"/>
       <ellipse cx="170" cy="40" rx="14" ry="24" fill="none" stroke="#a78bfa" stroke-width="3"/>
     </svg>`,
    { width: 240 },
  );

  doc.pageBreak();
  doc.outline("Tabellen");
  doc.text("Tabellen", { size: 16, bold: true, spacingAfter: 6 });
  doc.table(
    [
      [{ text: "Rechnung Q3", colSpan: 3, align: "center" }],
      ["Position", "Menge", "Preis"],
      [{ text: "Beratung", rowSpan: 2 }, "8 h", "960,00 €"],
      ["4 h", "480,00 €"],
      [
        { text: "Summe", colSpan: 2, bold: true },
        { text: "1.440,00 €", bold: true },
      ],
    ],
    { footer: true, zebraFill: "#fafafa", aligns: ["left", "right", "right"] },
  );
  doc.moveDown();

  doc.outline("Markdown");
  doc.markdown(
    [
      "## Markdown",
      "",
      "Ein Absatz mit **fett**, *kursiv*, `Code` und einem [Link](https://example.com).",
      "",
      "- Punkt eins",
      "- Punkt zwei",
      "",
      "> Ein Zitat.",
      "",
      "```",
      "const x = 1;",
      "```",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n"),
    { codeFont: "body" },
  );
  doc.moveDown();

  doc.outline("Links");
  doc.text("Links, Schaltflächen, Signaturfeld", { size: 16, bold: true, spacingAfter: 6 });
  doc.text("Interner Link zur Typografie", { link: "#typo", color: "#1a55cc", underline: true });
  doc.text("Externer Link", { link: "https://example.com", color: "#1a55cc", underline: true });
  doc.button("Zur Website", { link: "https://example.com" });
  doc.moveDown();
  doc.signature({ label: "Unterschrift (leeres Feld)" });

  doc.toc({ title: "Inhalt" });

  writeFileSync(join(out, "pdfa-full-3u.pdf"), await doc.render());
  console.log("→ pdfa-full-3u.pdf");
}

// ── 2. PAdES-signed PDF/A-3b ────────────────────────────────────────────
{
  const doc = document("PDF/A-3b — signiert");
  pdfA(doc);
  doc.text("Signiertes Archivdokument", { size: 18, bold: true, spacingAfter: 8 });
  doc.text(LOREM);
  doc.moveDown();
  doc.signature({
    label: "Signatur",
    sign: { ...(await makeSigner()), reason: "Freigabe", location: "Köln" },
  });
  writeFileSync(join(out, "pdfa-signed-3b.pdf"), await doc.render());
  console.log("→ pdfa-signed-3b.pdf");
}
