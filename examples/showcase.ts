/**
 * Showcase: exercises the v0.2 feature set — layout engine, typography,
 * tables with spans, shapes, watermark, header/footer, outlines, links
 * and a generated table of contents.
 *
 * Run: npx tsx examples/showcase.ts
 */
import { mkdir } from "node:fs/promises";
import { PDFDocument } from "../src/index";

const pdf = new PDFDocument({
  metadata: {
    title: "fast-pdf Showcase",
    author: "fast-pdf",
    subject: "Feature demo",
    keywords: "pdf, typescript, demo",
  },
});

pdf
  .header("fast-pdf — Feature Showcase", { align: "right", color: "#888888" })
  .footer("© 2026 Example Software", { align: "left", color: "#888888" })
  .pageNumbers({ format: (n, t) => `Seite ${n} von ${t}`, startAt: 2 })
  .watermark("ENTWURF");

// ── Typography ─────────────────────────────────────────────────────────
pdf.outline("Typografie");
pdf.anchor("typo");
pdf.text("Typografie", { size: 22, bold: true, spacingAfter: 8 });
pdf.text("Unterstrichen", { underline: true });
pdf.text("Durchgestrichen", { strikethrough: true });
pdf.text("Gesperrter Text mit Letter-Spacing", { letterSpacing: 2 });
pdf.text(
  "Blocksatz: Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod " +
    "tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et " +
    "accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est.",
  { align: "justify", spacingAfter: 12 },
);

// ── Layout engine ──────────────────────────────────────────────────────
pdf.outline("Layout");
pdf.text("Layout: Container, Spalten, Grid", { size: 16, bold: true, spacingAfter: 6 });
pdf.container(
  { background: "#eef4ff", border: { color: "#4a7dff", width: 1 }, radius: 8, padding: 12, width: "80%", align: "center" },
  (d) => {
    d.text("Ein Container mit Hintergrund, Rahmen, Radius und 80% Breite.", { align: "center" });
  },
);
pdf.moveDown(0.5);
pdf.columns(
  [
    (d) => d.text("Linke Spalte: kurzer Text."),
    (d) =>
      d.text(
        "Rechte Spalte: deutlich längerer Text, der über mehrere Zeilen läuft und zeigt, " +
          "dass der Cursor anschließend unter der höchsten Spalte weitermacht.",
      ),
  ],
  { widths: ["35%", "65%"], gap: 16 },
);
pdf.moveDown(0.5);
pdf.grid(
  ["A", "B", "C", "D"].map((label) => (d: PDFDocument) => {
    d.container({ background: "#f4f4f6", padding: 8, radius: 4 }, (dd) => dd.text(`Karte ${label}`, { align: "center" }));
  }),
  { columns: 2, gap: 10 },
);
pdf.moveDown();

// ── Shapes ─────────────────────────────────────────────────────────────
pdf.outline("Formen");
pdf.text("Formen", { size: 16, bold: true, spacingAfter: 6 });
const y0 = pdf.y;
pdf.circle(90, y0 + 30, 25, { fill: "#ffd166", stroke: "#c79000" });
pdf.ellipse(190, y0 + 30, 45, 22, { fill: "#8ecae6" });
pdf.rect(270, y0 + 8, 90, 45, { fill: "#e0fbe2", stroke: "#3a7d44", radius: 10 });
pdf.line(60, y0 + 70, 380, y0 + 70, { color: "#999999", width: 0.75 });
pdf.y = y0 + 85;

// ── Tables ─────────────────────────────────────────────────────────────
pdf.pageBreak();
pdf.outline("Tabellen");
pdf.text("Tabellen: Spans, Footer, Zebra", { size: 16, bold: true, spacingAfter: 6 });
pdf.table(
  [
    [{ text: "Rechnung Q3", colSpan: 3, align: "center" }],
    ["Position", "Menge", "Preis"],
    [{ text: "Beratung", rowSpan: 2 }, "8 h", "960,00 €"],
    ["4 h", "480,00 €"],
    ["Lizenz", "1", "199,00 €"],
    [{ text: "Summe", colSpan: 2, bold: true }, { text: "1.639,00 €", bold: true }],
  ],
  { footer: true, zebraFill: "#fafafa", aligns: ["left", "right", "right"] },
);
pdf.moveDown();

// ── Links ──────────────────────────────────────────────────────────────
pdf.outline("Links");
pdf.text("Interner Link zurück zur Typografie", { link: "#typo", color: "#1a55cc", underline: true });
pdf.text("Externer Link: anthropic.com", { link: "https://anthropic.com", color: "#1a55cc", underline: true });

// ── TOC (last: entries must exist) ─────────────────────────────────────
pdf.toc({ title: "Inhalt" });

await mkdir("examples/output", { recursive: true });
await pdf.save("examples/output/showcase.pdf");
console.log("→ examples/output/showcase.pdf");
