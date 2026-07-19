/**
 * A modern contract with signature form fields — open the result in
 * Adobe Acrobat (Reader), click a field and sign it. fast-pdf creates
 * *empty* AcroForm /Sig fields; the recipient provides the signature.
 *
 * Shown here: flow-mode fields, absolute side-by-side placement,
 * custom field names, labels, and a per-page initials field.
 *
 * Run: npx tsx examples/signature.ts
 */
import { PDFDocument } from "../src/index";

// ── Palette ──────────────────────────────────────────────────────────────
const INK = "#101828"; // near-black headings
const ACCENT = "#4f46e5"; // indigo brand accent
const MUTED = "#667085";
const FAINT = "#e4e7ec";
const PANEL = "#f8f9fc";

const pdf = new PDFDocument({
  margins: { top: 70, right: 60, bottom: 80, left: 60 },
  metadata: {
    title: "Dienstleistungsvertrag DV-2026-017",
    author: "Awesome Software GmbH",
    subject: "Vertrag zur elektronischen Signatur",
  },
});

const page = pdf.pageSize;

// ── Letterhead ───────────────────────────────────────────────────────────
pdf.rect(0, 0, page.width, 6, { fill: ACCENT });
pdf.circle(page.width - 70, 70, 26, { stroke: ACCENT, lineWidth: 1.25 });
pdf.circle(page.width - 70, 70, 17, { stroke: FAINT, lineWidth: 1 });
pdf.text("AS", { x: page.width - 81, y: 63, size: 13, bold: true, color: ACCENT });

pdf.text("DIENSTLEISTUNGSVERTRAG", { y: 52, size: 11, bold: true, color: ACCENT, letterSpacing: 3 });
pdf.text("Vertrag Nr. DV-2026-017", { y: 72, size: 26, bold: true, color: INK });
pdf.text("Bereit zur elektronischen Signatur · erstellt am 19.07.2026", {
  y: 106, size: 9.5, color: MUTED,
});

// ── Parties ──────────────────────────────────────────────────────────────
pdf.y = 150;
pdf.table(
  [
    [
      { text: "AUFTRAGGEBER", bold: true, color: ACCENT },
      { text: "AUFTRAGNEHMER", bold: true, color: ACCENT },
    ],
    [
      "Beispiel AG\nFrau Erika Mustermann\nHauptstraße 1\n10115 Berlin",
      "Awesome Software GmbH\nHerr Kevin Imig\nMusterstraße 12\n50667 Köln",
    ],
  ],
  {
    header: false,
    widths: [237, 238],
    borderWidth: 0,
    fill: PANEL,
    fontSize: 10,
    cellPadding: 12,
  },
);

// ── Terms ────────────────────────────────────────────────────────────────
pdf.moveDown(1.5);
const sections: [string, string][] = [
  [
    "§ 1 Vertragsgegenstand",
    "Der Auftragnehmer entwickelt für den Auftraggeber eine PDF-Generierungs-Bibliothek " +
      "(„fast-pdf“) einschließlich Layout-Engine, Tabellen, Bildern und Formularfeldern.",
  ],
  [
    "§ 2 Vergütung",
    "Die Vergütung erfolgt nach Aufwand zu einem Stundensatz von 140,00 € zzgl. gesetzlicher " +
      "Umsatzsteuer. Abrechnung monatlich, Zahlungsziel 14 Tage netto.",
  ],
  [
    "§ 3 Laufzeit und Kündigung",
    "Der Vertrag beginnt am 01.08.2026 und läuft auf unbestimmte Zeit. Er kann von beiden " +
      "Parteien mit einer Frist von vier Wochen zum Monatsende gekündigt werden.",
  ],
  [
    "§ 4 Elektronische Signatur",
    "Beide Parteien vereinbaren, dass dieser Vertrag durch Ausfüllen der unten stehenden " +
      "digitalen Signaturfelder rechtsverbindlich geschlossen wird.",
  ],
];

for (const [title, body] of sections) {
  pdf.text(title, { size: 11.5, bold: true, color: INK, spacingAfter: 4 });
  pdf.text(body, { size: 10, color: "#344054", lineHeight: 1.5, spacingAfter: 14 });
}

// ── Signature area ───────────────────────────────────────────────────────
// Two fields side by side via absolute positioning; custom names make
// the fields addressable ("client" / "contractor") in signing tools.
pdf.moveDown(1);
const sigY = Math.max(pdf.y, 560);
const sigW = 210;
const left = 60;
const right = page.width - 60 - sigW;

pdf.rect(left - 14, sigY - 18, page.width - 2 * (left - 14), 128, { fill: PANEL });
pdf.text("UNTERSCHRIFTEN", { x: left, y: sigY - 6, size: 9, bold: true, color: ACCENT, letterSpacing: 2 });

pdf.signature({ name: "client", label: "Auftraggeber · Ort, Datum", x: left, y: sigY + 16, width: sigW, height: 56 });
pdf.signature({ name: "contractor", label: "Auftragnehmer · Ort, Datum", x: right, y: sigY + 16, width: sigW, height: 56 });

// A small initials field ("Paraphe") in the bottom corner — line disabled,
// the dashed look comes from the surrounding rect instead.
const initX = page.width - 60 - 90;
const initY = page.height - 120;
pdf.rect(initX, initY, 90, 36, { stroke: FAINT, lineWidth: 0.75 });
pdf.signature({ name: "initials-p1", x: initX + 2, y: initY + 2, width: 86, height: 32, line: false });
pdf.text("Paraphe", { x: initX, y: initY + 40, size: 7.5, color: MUTED });

// ── Footer ───────────────────────────────────────────────────────────────
const footerY = page.height - 46;
pdf.line(60, footerY - 10, page.width - 60, footerY - 10, { color: FAINT, width: 0.5 });
pdf.text("Awesome Software GmbH · Dieses Dokument enthält digitale Signaturfelder (AcroForm)", {
  y: footerY, size: 8, color: MUTED, align: "center",
});

await pdf.save("examples/output/signature.pdf");
console.log("→ examples/output/signature.pdf");
console.log("  In Acrobat öffnen → auf ein Signaturfeld klicken → signieren.");
