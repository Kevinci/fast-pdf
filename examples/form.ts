/**
 * A fillable registration form — open the result in any PDF viewer with
 * form support (Acrobat, Preview, Firefox, Chrome), fill it in and save.
 * Every field carries its own appearance, so the pre-filled values also show
 * in print and in viewers without form support.
 *
 * Shown here: text fields (single-line, multiline, right-aligned, with
 * maxLength), checkboxes, horizontal and vertical radio groups, a dropdown,
 * two-column rows with absolute placement and a signature field.
 *
 * Run: npx tsx examples/form.ts
 */
import { PDFDocument } from "../src/index";

// ── Palette ──────────────────────────────────────────────────────────────
const INK = "#101828";
const ACCENT = "#4f46e5";
const MUTED = "#667085";
const FAINT = "#e4e7ec";
const PANEL = "#f8f9fc";

const pdf = new PDFDocument({
  margins: { top: 70, right: 60, bottom: 70, left: 60 },
  language: "de-DE",
  metadata: {
    title: "Anmeldung · PDF Engineering Days 2026",
    author: "Example Software GmbH",
    subject: "Ausfüllbares Anmeldeformular",
  },
});

const page = pdf.pageSize;
const left = 60;
const full = page.width - 120;
const half = (full - 20) / 2;

// ── Letterhead ───────────────────────────────────────────────────────────
pdf.rect(0, 0, page.width, 6, { fill: ACCENT });
pdf.text("ANMELDUNG", { y: 52, size: 11, bold: true, color: ACCENT, letterSpacing: 3 });
pdf.text("PDF Engineering Days 2026", { y: 72, size: 26, bold: true, color: INK });
pdf.text("12.–13. März 2026 · Köln · Bitte bis 28. Februar ausgefüllt zurücksenden", {
  y: 106,
  size: 9.5,
  color: MUTED,
});

/** Section head: eyebrow label plus hairline. */
function section(title: string): void {
  pdf.ensureSpace(60);
  pdf.text(title.toUpperCase(), {
    size: 9,
    bold: true,
    color: ACCENT,
    letterSpacing: 2,
    spacingBefore: 18,
    spacingAfter: 4,
  });
  pdf.line(left, pdf.y, left + full, pdf.y, { color: FAINT, width: 0.5 });
  pdf.moveDown(0.8);
}

/** Two labelled fields side by side; the cursor moves below the taller one. */
function row(draw: (y: number) => number): void {
  const y = pdf.y;
  const height = draw(y);
  pdf.y = y + height + 10;
}

pdf.y = 118;

// ── Personal data ────────────────────────────────────────────────────────
section("Teilnehmer");
row((y) => {
  pdf.textField({ name: "firstName", label: "Vorname", x: left, y, width: half, value: "Erika" });
  pdf.textField({
    name: "lastName",
    label: "Nachname",
    x: left + half + 20,
    y,
    width: half,
    value: "Mustermann",
  });
  return pdf.lastBlockHeight;
});
row((y) => {
  pdf.textField({
    name: "email",
    label: "E-Mail",
    x: left,
    y,
    width: half,
    required: true,
    value: "erika@beispiel.de",
  });
  pdf.textField({ name: "phone", label: "Telefon", x: left + half + 20, y, width: half });
  return pdf.lastBlockHeight;
});
row((y) => {
  pdf.textField({ name: "company", label: "Firma", x: left, y, width: half, value: "Beispiel AG" });
  pdf.dropdown({
    name: "country",
    label: "Land",
    x: left + half + 20,
    y,
    width: half,
    options: [
      { value: "DE", label: "Deutschland" },
      { value: "AT", label: "Österreich" },
      { value: "CH", label: "Schweiz" },
      { value: "other", label: "Anderes Land" },
    ],
    value: "DE",
  });
  return pdf.lastBlockHeight;
});

// ── Ticket ───────────────────────────────────────────────────────────────
section("Ticket");
pdf.radioGroup({
  name: "ticket",
  options: [
    { value: "early", label: "Early Bird · 390 €" },
    { value: "regular", label: "Regulär · 490 €" },
    { value: "student", label: "Student · 190 €" },
  ],
  value: "early",
  direction: "horizontal",
  required: true,
  spacingAfter: 12,
});
row((y) => {
  // Left: invoice recipient (vertical radio group); right: VAT ID and voucher.
  pdf.text("Rechnung an", { x: left, y, size: 8.8, color: MUTED });
  pdf.radioGroup({
    name: "invoice",
    options: [
      { value: "company", label: "die Firma (mit USt-IdNr.)" },
      { value: "private", label: "mich privat" },
    ],
    value: "company",
    x: left,
    y: y + 17,
  });
  const radios = 17 + pdf.lastBlockHeight;
  const x = left + half + 20;
  pdf.textField({ name: "vatId", label: "USt-IdNr.", x, y, width: half, maxLength: 14 });
  const fields = pdf.lastBlockHeight + 10;
  pdf.textField({
    name: "voucher",
    label: "Gutscheincode",
    x,
    y: y + fields,
    width: half,
    align: "right",
  });
  return Math.max(radios, fields + pdf.lastBlockHeight);
});

// ── Workshops ────────────────────────────────────────────────────────────
section("Workshops (Mehrfachauswahl)");
const workshops: [string, string, boolean][] = [
  ["wsTables", "Tabellen über Seitengrenzen", true],
  ["wsForms", "Formularfelder und Signaturen", true],
  ["wsPdfa", "PDF/A-3 und ZUGFeRD", false],
];
row((y) => {
  // Left: one checkbox per workshop; right: free-text notes.
  let at = y;
  for (const [name, label, checked] of workshops) {
    pdf.checkbox({ name, label, checked, x: left, y: at });
    at += pdf.lastBlockHeight + 8;
  }
  pdf.textField({
    name: "notes",
    label: "Anmerkungen (Ernährung, Barrierefreiheit, Fragen)",
    x: left + half + 20,
    y,
    width: half,
    height: 58,
    multiline: true,
    value:
      "Vegetarisches Mittagessen, bitte. Besonders interessiert mich das Thema Appearance-Streams.",
  });
  return Math.max(at - 8 - y, pdf.lastBlockHeight);
});

// ── Consent & signature ──────────────────────────────────────────────────
pdf.ensureSpace(165);
section("Bestätigung");
pdf.checkbox({
  name: "terms",
  label: "Ich habe die Teilnahmebedingungen gelesen und akzeptiere sie.",
  required: true,
  spacingAfter: 5,
});
pdf.checkbox({
  name: "newsletter",
  label: "Ich möchte über künftige Veranstaltungen informiert werden.",
  spacingAfter: 12,
});
pdf.ensureSpace(70);
const sy = pdf.y;
pdf.rect(left - 14, sy - 8, full + 28, 78, { fill: PANEL, radius: 6 });
pdf.textField({ name: "place", label: "Ort, Datum", x: left, y: sy + 8, width: 200 });
pdf.signature({
  name: "signature",
  label: "Unterschrift Teilnehmer",
  x: left + full - 230,
  y: sy,
  width: 230,
  height: 48,
});

// ── Footer ───────────────────────────────────────────────────────────────
pdf.line(left, page.height - 50, left + full, page.height - 50, { color: FAINT, width: 0.5 });
pdf.text("Example Software GmbH · Musterstraße 12 · 50667 Köln · events@example.com", {
  y: page.height - 42,
  size: 8,
  color: MUTED,
  align: "center",
});

await pdf.save("examples/output/form.pdf");
console.log("→ examples/output/form.pdf");
