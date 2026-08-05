/**
 * Appending uploaded PDFs to a generated document.
 *
 * The scenario: a CV builder generates a résumé, and the applicant attaches
 * documents someone else produced — a reference letter, a certificate, a scan.
 * Those files are copied into the output unchanged; only the pages that need a
 * frame get one.
 *
 * The two attachments are generated at the top of this file so the example runs
 * without any input files. In a real application they are the uploads.
 *
 * Run: npx tsx examples/append.ts
 */
import { PDFDocument, pdfInfo } from "../src/index";

const INK = "#101828";
const ACCENT = "#4f46e5";
const MUTED = "#667085";
const FAINT = "#e4e7ec";

// ── Stand-ins for the uploaded files ─────────────────────────────────────

/** A two-page reference letter, A4 — as if exported from a word processor. */
async function referenceLetter(): Promise<Uint8Array> {
  const doc = new PDFDocument({ margins: 64 });
  for (const page of [1, 2]) {
    if (page > 1) doc.addPage();
    doc.text("Muster & Partner GmbH", { size: 10, color: MUTED, spacingAfter: 26 });
    doc.text(`Arbeitszeugnis (Seite ${page} von 2)`, { size: 18, bold: true, spacingAfter: 14 });
    doc.text(
      "Frau Mustermann war vom 01.03.2021 bis zum 30.06.2026 als Senior Frontend " +
        "Engineer in unserem Haus tätig. Zu ihren Aufgaben gehörten die Architektur " +
        "unserer Design-System-Bibliothek, die Betreuung von zwei Werkstudierenden " +
        "sowie die Migration der Anwendung auf ein neues Rendering-Modell.",
      { align: "justify", spacingAfter: 12 },
    );
    doc.text(
      "Ihre Arbeitsergebnisse waren stets von sehr hoher Qualität. Sie erledigte " +
        "die ihr übertragenen Aufgaben immer selbstständig und zu unserer vollsten " +
        "Zufriedenheit.",
      { align: "justify" },
    );
  }
  return doc.toBuffer();
}

/** A certificate in US Letter, landscape — a foreign page size to fit in. */
async function certificate(): Promise<Uint8Array> {
  const doc = new PDFDocument({ format: "Letter", landscape: true, margins: 56 });
  const page = doc.pageSize;
  doc.rect(20, 20, page.width - 40, page.height - 40, { stroke: ACCENT, lineWidth: 2 });
  doc.text("CERTIFICATE OF COMPLETION", {
    y: 120, size: 24, bold: true, align: "center", color: ACCENT, letterSpacing: 2,
  });
  doc.text("Erika Mustermann", { y: 190, size: 34, bold: true, align: "center" });
  doc.text("Advanced TypeScript Architecture · 40 hours", {
    y: 250, size: 13, align: "center", color: MUTED,
  });
  doc.text("Berlin, 14.05.2026", { y: 330, size: 11, align: "center", color: MUTED });
  return doc.toBuffer();
}

const letter = await referenceLetter();
const cert = await certificate();

// Inspect an upload before doing anything with it: page count, sizes, whether
// it is encrypted (an encrypted file cannot be appended).
for (const [name, bytes] of [["letter", letter], ["certificate", cert]] as const) {
  const info = await pdfInfo(bytes);
  const first = info.pageSizes[0]!;
  console.log(
    `${name}: PDF ${info.version}, ${info.pageCount} page(s), ` +
      `${Math.round(first.width)}×${Math.round(first.height)} pt` +
      (info.encrypted ? " — encrypted" : ""),
  );
}

// ── The generated document ───────────────────────────────────────────────

const pdf = new PDFDocument({
  margins: { top: 64, right: 60, bottom: 72, left: 60 },
  language: "de-DE",
  metadata: { title: "Bewerbung Erika Mustermann", author: "Erika Mustermann" },
});
const page = pdf.pageSize;

pdf.rect(0, 0, page.width, 6, { fill: ACCENT });
pdf.text("Erika Mustermann", { size: 28, bold: true, color: INK });
pdf.text("Senior Frontend Engineer · Berlin", { size: 12, color: MUTED, spacingAfter: 26 });

pdf.text("Profil", { size: 13, bold: true, color: ACCENT, spacingAfter: 8 });
pdf.text(
  "Fünf Jahre Erfahrung in Design-Systemen und Rendering-Pipelines. " +
    "Schwerpunkte: TypeScript, Barrierefreiheit, Dokumentgenerierung.",
  { align: "justify", spacingAfter: 22 },
);

pdf.text("Anlagen", { size: 13, bold: true, color: ACCENT, spacingAfter: 8 });
pdf.text("1. Arbeitszeugnis Muster & Partner GmbH (2 Seiten, unverändert)", { spacingAfter: 4 });
pdf.text("2. Zertifikat Advanced TypeScript Architecture (auf A4 eingepasst)");

// Page numbers over the whole application, appended pages included.
pdf.pageNumbers({ format: (n, total) => `Seite ${n} von ${total}`, size: 9, color: MUTED });

// 1:1 — the letter keeps its own layout untouched. `overlay` lets the page
// numbering reach it; without it the appended pages are left completely alone.
await pdf.append(letter, { overlay: true });

// Scaled — the landscape Letter certificate is fitted onto a landscape A4 page
// with a small inset, and gets a caption of its own.
await pdf.append(cert, { fit: "page", padding: 24 });
pdf.text("Anlage 2 — Zertifikat", { y: 30, x: 40, size: 9, color: MUTED });
pdf.line(40, 44, 260, 44, { color: FAINT, width: 0.5 });

await pdf.save("examples/output/append.pdf");
console.log(`→ examples/output/append.pdf (${pdf.pageCount} Seiten)`);
