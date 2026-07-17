import { PDFDocument } from "../src/index";

/**
 * Benchmark: end-to-end document generation (layout + render + compression).
 * Run with: npm run bench
 */

async function bench(name: string, iterations: number, fn: () => Promise<number>): Promise<void> {
  await fn(); // warm-up
  const start = performance.now();
  let bytes = 0;
  for (let i = 0; i < iterations; i++) bytes += await fn();
  const ms = performance.now() - start;
  const perDoc = ms / iterations;
  console.log(
    `${name.padEnd(42)} ${perDoc.toFixed(2).padStart(8)} ms/doc ` +
      `${(1000 / perDoc).toFixed(0).padStart(6)} docs/s ` +
      `${(bytes / iterations / 1024).toFixed(1).padStart(8)} KB/doc`,
  );
}

const LOREM =
  "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor " +
  "invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam.";

async function textDocument(pages: number): Promise<number> {
  const pdf = new PDFDocument();
  pdf.text("Benchmark Report", { size: 20, bold: true, spacingAfter: 8 });
  for (let i = 0; i < pages * 14; i++) {
    pdf.text(`${i + 1}. ${LOREM}`, { spacingAfter: 4 });
  }
  return (await pdf.render()).length;
}

async function tableDocument(rows: number): Promise<number> {
  const pdf = new PDFDocument();
  const data: string[][] = [["#", "Artikel", "Beschreibung", "Menge", "Preis"]];
  for (let i = 0; i < rows; i++) {
    data.push([String(i), `Artikel ${i}`, "Eine mittellange Beschreibung des Artikels", "3", "19,99 €"]);
  }
  pdf.table(data, { aligns: ["right", "left", "left", "right", "right"], zebraFill: "#f5f5f5" });
  return (await pdf.render()).length;
}

async function mixedDocument(): Promise<number> {
  const pdf = new PDFDocument();
  for (let section = 0; section < 5; section++) {
    pdf.text(`Abschnitt ${section + 1}`, { size: 16, bold: true, spacingAfter: 6 });
    pdf.text(LOREM + " " + LOREM, { spacingAfter: 8 });
    pdf.table([
      ["Kennzahl", "Wert"],
      ["Umsatz", "1.234.567 €"],
      ["Wachstum", "+12,5 %"],
    ]);
    pdf.moveDown();
    for (let i = 0; i < 20; i++) {
      pdf.rect(50 + i * 24, pdf.y, 20, 30 + (i % 7) * 8, { fill: "#3b82f6" });
    }
    pdf.moveDown(4);
  }
  return (await pdf.render()).length;
}

console.log(`fast-pdf benchmark — ${new Date().toISOString()}\n`);
await bench("text document (~3 pages)", 50, () => textDocument(3));
await bench("text document (~30 pages)", 10, () => textDocument(30));
await bench("table document (500 rows, ~17 pages)", 10, () => tableDocument(500));
await bench("table document (5000 rows, ~170 pages)", 3, () => tableDocument(5000));
await bench("mixed document (text/tables/vector)", 20, mixedDocument);
