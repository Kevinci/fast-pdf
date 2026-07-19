# fast-pdf

**Fast, dependency-free, direct-to-PDF generation** — for Node.js, Bun, Deno, browsers and
edge/serverless runtimes. Think *esbuild for PDFs*: no Chromium, no native binaries,
no runtime dependencies, ~13 KB min+gzip.

**📄 Demo & Feature-Guide (deutsch): <https://kevinci.github.io/fast-pdf/>**

```ts
import { PDFDocument } from "fast-pdf";

const pdf = new PDFDocument();

pdf.text("Hallo Welt", { size: 24, bold: true });

pdf.table([
  ["Produkt", "Preis"],
  ["Laptop", "999 €"],
]);

await pdf.save("document.pdf");
```

## Why

| | fast-pdf | HTML → Chromium (Puppeteer) | classic JS PDF libs |
|---|---|---|---|
| Generates PDF | directly | via a ~300 MB browser | directly |
| Runtime deps | **0** | Chromium + system libs | several |
| Serverless/edge | ✅ | ⚠️ heavyweight | varies |
| Browser | ✅ | ❌ | varies |
| Typical doc | **~1 ms** | ~1000 ms+ | ~10–100 ms |

Measured on this repo's benchmark (`npm run bench`, Apple Silicon, Node 22):
a 3-page text document renders in **~1.3 ms**, a 170-page / 5000-row table document
in **~209 ms**, including Flate compression.

## Install

```sh
npm install fast-pdf                    # bun add / pnpm add / deno add also work
npm install github:Kevinci/fast-pdf     # or straight from GitHub (auto-builds on install)
```

Requirements: any runtime with Web APIs (`Uint8Array`, `CompressionStream`) —
Node ≥ 18, Bun, Deno, modern browsers, Cloudflare Workers, Vercel/Netlify Edge.

### Download-on-click in the browser

Fetch your data, build the PDF, hand the user a download — all client-side:

```ts
import { PDFDocument } from "fast-pdf";

async function downloadOrdersPdf() {
  const orders = await fetch("/api/orders").then((r) => r.json());

  const pdf = new PDFDocument({ metadata: { title: "Orders" } });
  pdf.text("Order overview", { size: 20, bold: true, spacingAfter: 12 });
  pdf.objectTable(orders, {
    columns: [
      { key: "id",       header: "No.",    align: "right", width: 60 },
      { key: "customer", header: "Customer" },
      { key: "total",    header: "Amount", align: "right", format: (v) => `${v} €` },
    ],
  });

  await pdf.save("orders.pdf");   // triggers the browser download directly
}

document.querySelector("#pdf-btn")!.addEventListener("click", downloadOrdersPdf);
```

`save()` triggers a download in the browser and writes a file on Node/Bun/Deno —
same call, no branching. Prefer a Blob URL (e.g. to preview in an `<iframe>`)?
Use `await pdf.toBlob()` and `URL.createObjectURL(blob)`.

## Output — pick what fits your platform

```ts
const bytes = await pdf.render();      // Uint8Array — works everywhere
await pdf.save("invoice.pdf");         // Node/Bun/Deno: writes file · browser: download
const buffer = await pdf.toBuffer();   // Node Buffer (Uint8Array elsewhere)
const blob = await pdf.toBlob();       // Blob for FormData, object URLs, …
const stream = pdf.toStream();         // ReadableStream<Uint8Array>, 64 KiB chunks

// Edge / API route:
return new Response(pdf.toStream(), {
  headers: { "Content-Type": "application/pdf" },
});
```

## API

### Document & pages

```ts
const pdf = new PDFDocument({
  format: "A4",              // A3 | A4 | A5 | Letter | Legal | { width, height } (pt)
  landscape: false,
  margins: 50,               // number or { top, right, bottom, left }
  font: "helvetica",         // helvetica | times | courier (standard-14, nothing embedded)
  fontSize: 11,
  lineHeight: 1.25,
  compress: true,            // FlateDecode content streams
  metadata: { title: "Invoice", author: "ACME", creationDate: new Date(0) },
});

pdf.addPage();                       // same defaults, cursor at top
pdf.addPage({ landscape: true });    // per-page overrides
pdf.pageBreak();                     // explicit page break in the flow
pdf.pageBreak({ y: 200 });           // …and decide where the new page starts
pdf.moveDown(2);                     // advance flow cursor
pdf.y = 300;                         // or set it directly
```

Text and tables break pages automatically; `pageBreak()` is the explicit
counterpart — break exactly where *you* decide, optionally with a custom
start position and per-page setup (`format`, `landscape`, `margins`).

All coordinates are **top-left based, in points** (1 pt = 1/72″).

### Text & typography

```ts
pdf.text("Wrapped automatically with real font metrics — äöüß € „quotes“ – dashes.", {
  size: 12, bold: true, italic: false,
  color: "#334155",                  // "#rgb" | "#rrggbb" | { r, g, b } (0–255)
  align: "justify",                  // left | center | right | justify
  width: 300,                        // wrap width (default: content width)
  lineHeight: 1.4,
  underline: true,                   // also: strikethrough
  letterSpacing: 0.5,                // pt between characters
  link: "https://example.com",       // or "#anchor" for internal links
  spacingAfter: 8,
});

pdf.text("Header", { y: 20, align: "right" });   // absolute position: no flow, no page break
pdf.widthOfText("How wide is this?", { size: 12 });
```

Text flows top-to-bottom and **breaks pages automatically**. Soft hyphens
(U+00AD) mark preferred break points inside long words and render as "-"
only when broken there. Standard fonts use WinAnsi (CP-1252): full Latin-1
incl. umlauts/ß plus €, curly quotes, dashes.

### Custom fonts (TrueType, subsetted)

```ts
const inter = await fetch("https://example.com/Inter.ttf").then((r) => r.arrayBuffer());
pdf.registerFont(inter, { family: "inter" });
pdf.registerFont(interBold, { family: "inter", bold: true });   // variants per style
pdf.text("Full Unicode — Ελληνικά, кириллица, 中文", { font: "inter" });
```

Embedded fonts are written as Type0/Identity-H with a ToUnicode CMap
(copy/paste keeps working) and **subsetted** — only glyphs you actually use
are embedded. Missing variants fall back to the regular cut.

### Layout engine

```ts
pdf.container(
  { width: "80%", align: "center", padding: 12, margin: { top: 8 },
    background: "#eef4ff", border: { color: "#4a7dff", width: 1 }, radius: 8, minHeight: 60 },
  (d) => d.text("A box that grows with its content."),
);

pdf.columns(
  [(d) => d.text("Left column"), (d) => d.text("Right column")],
  { widths: ["35%", "65%"], gap: 16 },      // pt or percentages; default: equal
);

pdf.grid(
  cards.map((c) => (d) => d.text(c.title)),
  { columns: 3, gap: 10 },                  // rows break across pages, cells don't
);
```

Containers and columns keep their content together (no page breaks inside);
the cursor continues below the tallest column afterwards.

### Tables

```ts
pdf.table(
  [
    [{ text: "Invoice Q3", colSpan: 3, align: "center" }],   // cells can span columns…
    ["Pos", "Item", "Price"],
    [{ text: "Consulting", rowSpan: 2 }, "8 h", "960,00 €"], // …and rows
    ["4 h", "480,00 €"],
    [{ text: "Total", colSpan: 2, bold: true }, "1.440,00 €"],
  ],
  {
    widths: [40, 300, 100],           // pt; scaled down proportionally if too wide
    aligns: ["right", "left", "right"],
    header: true,                      // first row repeats on every page
    footer: true,                      // last row styled like the header, drawn once
    headerFill: "#0f172a", headerColor: "#ffffff",
    zebraFill: "#f8fafc",
    padding: 6, borderWidth: 0.5, borderColor: "#c8ccd4",
  },
);
```

Cells wrap, row height adapts, and long tables break across pages with the
header re-drawn on every page. Rows chained by `rowSpan` never straddle a
page break.

**From a REST/JSON response** — `objectTable()` turns an array of records
straight into a table, no manual row mapping:

```ts
const orders = await fetch("/api/orders").then((r) => r.json());

pdf.objectTable(orders);            // columns = keys of the first record

pdf.objectTable(orders, {           // …or pick order, headers, widths, formatting
  columns: [
    { key: "id",       header: "No.",    align: "right", width: 60 },
    { key: "customer", header: "Customer" },
    { key: "total",    header: "Amount", align: "right",
      format: (v) => `${(v as number).toFixed(2)} €` },
  ],
  zebraFill: "#f8fafc",             // every option of table() works here too
});
```

`format(value, record)` also receives the whole record, so you can build
computed cells. All other `table()` options (header/footer, zebra, borders,
padding) pass through.

### Images

```ts
pdf.image(jpegOrPngBytes, { width: 200 });               // flows with the cursor, keeps aspect
pdf.image(logo, { x: 400, y: 30, width: 120 });          // absolute position
pdf.image(photo, { width: 200, height: 200, fit: "cover" });  // fill | contain | cover
pdf.image(photo, { width: 100, crop: { x: 50, y: 50, width: 400, height: 400 } });
pdf.image(stamp, { width: 80, rotate: -15, align: "center" });
```

- **JPEG**: embedded as-is (`DCTDecode`) — zero re-encoding, gray/RGB/CMYK.
- **PNG**: gray/RGB/indexed embedded without re-encoding; alpha channels become a
  proper `SMask`. (Interlaced PNGs are not supported.)
- Repeated images are embedded **once** and referenced from every page.

### Shapes & vector primitives

```ts
pdf.line(50, 100, 545, 100, { color: "#e2e8f0", width: 0.5 });
pdf.rect(50, 120, 100, 40, { fill: "#3b82f6", radius: 8 });
pdf.circle(100, 300, 40, { fill: "#ffd166", stroke: "#c79000" });
pdf.ellipse(300, 300, 80, 40, { stroke: "#0f172a", lineWidth: 2 });
```

### Document features

```ts
pdf.header("Annual Report", { align: "right" });          // repeats on every page
pdf.footer("© 2026 ACME");                                //   (or pass a callback)
pdf.pageNumbers({ format: (n, t) => `${n} / ${t}` });     // bottom center by default
pdf.watermark("DRAFT", { opacity: 0.1, angle: -45 });

pdf.outline("Chapter 1");                 // PDF bookmarks (nesting via { level })
pdf.anchor("details");                    // named target for link: "#details"
pdf.link(50, 50, 200, 20, "#details");    // clickable area (also: URLs)

pdf.toc({ title: "Contents" });           // call last: builds linked TOC pages
                                          // from outline entries, inserts at front
```

### Signature fields (contracts)

```ts
// An empty signature form field: recipients click it in their PDF viewer,
// sign (certificate or Fill & Sign) and send the document back.
pdf.signature({ label: "Ort, Datum, Unterschrift Auftraggeber" });

pdf.columns([                             // two signers side by side
  (d) => d.signature({ label: "Auftraggeber" }),
  (d) => d.signature({ label: "Auftragnehmer" }),
]);

pdf.signature({ name: "client", x: 50, y: 700, width: 220, height: 60 });
```

Draws a signature line (disable with `line: false`) with an optional small
`label` underneath; the clickable field sits above the line. Field names
default to `Signature1`, `Signature2`, … and must be unique. Note that the
field is *for the recipient to sign* — fast-pdf does not cryptographically
sign the document itself.

### Error handling

All user-facing failures throw `FastPDFError` with a stable machine-readable
`code` (`"UNKNOWN_FONT"`, `"INVALID_COLOR"`, `"UNSUPPORTED_IMAGE"`, …).

## Design

- **Direct PDF synthesis** — the engine writes PDF objects, content streams and
  cross-reference tables itself. No HTML, no browser.
- **Zero runtime dependencies** — compression uses the runtime-native
  `CompressionStream` (zlib) available on every modern platform.
- **Platform-pure core** — no `fs`/`path`/`process`/`Buffer` outside the
  feature-detected `save()` adapter; bundles cleanly for browser and edge targets.
- **Layered architecture** (API → layout → resources → PDF engine → output) with a
  documented WASM migration path.

## Security

Generated PDFs are passive: no JavaScript, no embedded files, no forms. All
strings are escaped before touching PDF syntax, so untrusted data in text,
tables or metadata cannot inject PDF operators. Dangerous link schemes
(`javascript:`, `file:`, `data:`, `vbscript:`) are rejected, and the image
parsers are hardened against malformed files and decompression bombs.
See [SECURITY.md](SECURITY.md) for the threat model and how to report
vulnerabilities.

## Development

```sh
npm test                # vitest unit + end-to-end structure tests
npm run test:coverage   # coverage (thresholds: >90% lines)
npm run typecheck       # strict TypeScript
npm run build           # tsup → dist/ (ESM + d.ts)
npm run example         # renders examples/output/invoice.pdf
npm run bench           # performance benchmark
```

## License

MIT
