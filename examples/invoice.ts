import { PDFDocument } from "../src/index";

/** A realistic invoice: header block, address, item table, totals, footer. */
const pdf = new PDFDocument({
  margins: { top: 60, right: 50, bottom: 60, left: 50 },
  metadata: {
    title: "Rechnung R-2026-0042",
    author: "Awesome Software GmbH",
    subject: "Rechnung",
  },
});

const page = pdf.pageSize;

// Letterhead
pdf.rect(0, 0, page.width, 8, { fill: "#0f172a" });
pdf.text("Awesome Software GmbH", { y: 40, size: 20, bold: true, color: "#0f172a" });
pdf.text("Musterstraße 12 · 50667 Köln · hello@awesome-software.de", {
  y: 66, size: 9, color: "#64748b",
});
pdf.text("RECHNUNG", { y: 40, align: "right", size: 14, bold: true, color: "#64748b" });

// Address & meta
pdf.y = 110;
pdf.text("Beispiel AG\nFrau Erika Mustermann\nHauptstraße 1\n10115 Berlin", { lineHeight: 1.4 });
pdf.text("Rechnungsnr.: R-2026-0042\nDatum: 14.07.2026\nFällig bis: 28.07.2026", {
  y: 110, x: page.width - 250, width: 200, align: "right", lineHeight: 1.4, color: "#334155",
});

pdf.y = 220;
pdf.text("Rechnung R-2026-0042", { size: 14, bold: true, spacingAfter: 10 });

// Items
const items: [string, number, number][] = [
  ["Konzeption & Architektur der PDF-Engine", 16, 140],
  ["Implementierung Layout-Engine (Text, Tabellen, Bilder)", 32, 140],
  ["Cross-Runtime-Tests (Node, Bun, Deno, Browser)", 12, 120],
  ["Dokumentation & Beispiele", 6, 100],
];
const fmtEur = (n: number) =>
  n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

const net = items.reduce((sum, [, h, rate]) => sum + h * rate, 0);
const vat = net * 0.19;

pdf.table(
  [
    ["Pos.", "Leistung", "Stunden", "Satz", "Betrag"],
    ...items.map(([name, hours, rate], i) => [
      String(i + 1), name, String(hours), fmtEur(rate), fmtEur(hours * rate),
    ]),
  ],
  {
    widths: [40, 230, 60, 80, 85],
    aligns: ["left", "left", "right", "right", "right"],
    headerFill: "#0f172a",
    headerColor: "#ffffff",
    zebraFill: "#f8fafc",
  },
);

pdf.moveDown(0.5);
pdf.table(
  [
    ["Zwischensumme (netto)", fmtEur(net)],
    ["Umsatzsteuer 19 %", fmtEur(vat)],
    [{ text: "Gesamtbetrag", bold: true }, { text: fmtEur(net + vat), bold: true }],
  ],
  {
    header: false,
    widths: [405, 90],
    aligns: ["right", "right"],
    borderWidth: 0,
    fontSize: 11,
  },
);

pdf.moveDown(2);
pdf.text(
  "Bitte überweisen Sie den Gesamtbetrag innerhalb von 14 Tagen auf das unten genannte Konto. " +
    "Vielen Dank für die gute Zusammenarbeit!",
  { color: "#334155" },
);

// Footer
const footerY = page.height - 40;
pdf.line(50, footerY - 12, page.width - 50, footerY - 12, { color: "#e2e8f0", width: 0.5 });
pdf.text("Awesome Software GmbH · IBAN DE12 3456 7890 1234 5678 90 · USt-IdNr. DE123456789", {
  y: footerY, size: 8, color: "#94a3b8", align: "center",
});

await pdf.save("examples/output/invoice.pdf");
console.log("→ examples/output/invoice.pdf");
