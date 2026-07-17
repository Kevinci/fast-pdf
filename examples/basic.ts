import { PDFDocument } from "../src/index";

const pdf = new PDFDocument({
  metadata: { title: "fast-pdf Basic Example", author: "fast-pdf" },
});

pdf.text("Hallo Welt", { size: 24, bold: true });
pdf.moveDown();

pdf.text(
  "fast-pdf erzeugt PDFs direkt — ohne Chromium, ohne native Abhängigkeiten. " +
    "Dieser Absatz demonstriert automatischen Zeilenumbruch mit echten Font-Metriken, " +
    "Umlaute (äöüß), Sonderzeichen (€, „Anführungszeichen“, – Gedankenstrich) und Farben.",
  { color: "#334155", spacingAfter: 12 },
);

pdf.table([
  ["Produkt", "Preis"],
  ["Laptop", "999 €"],
  ["Maus", "29 €"],
]);

await pdf.save("examples/output/basic.pdf");
console.log("→ examples/output/basic.pdf");
