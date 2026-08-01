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

| | fast-pdf | Component-framework renderers | HTML → headless browser |
|---|---|---|---|
| Runtime deps | **0** | 10+, incl. a UI framework as peer dependency | a ~300 MB browser binary |
| Runs on | Node, Bun, Deno, browser, edge | Node + browser; edge runtimes are tricky | servers that can run a browser |
| 3-page document | **~1.6 ms** | element tree → flexbox layout → PDF lib | ~1000 ms+ (browser startup + render) |
| Tables | built-in: repeating headers, col/row spans, JSON → table | hand-built from flexbox views | HTML/CSS |
| Signature form fields | ✅ AcroForm | — | ❌ printed output has no form fields |
| TOC, outlines, watermark | ✅ built-in | partly | ❌ |
| Bundle | ~94 KB ESM, tree-shakeable | several 100 KB + the framework | n/a |

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

**No bundler configuration required.** fast-pdf ships a second build behind
the `browser` export condition, in which `save()` contains no reference to
`node:fs/promises` at all. Next.js/Turbopack, Vite and webpack pick it up
automatically for client bundles — no `resolveAlias`, no `fs` shim, no
"Module not found: fs" surprise on your first client build. Need it
explicitly? `import { PDFDocument } from "fast-pdf/browser"`.

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
  language: "de-DE",         // catalog /Lang — screen readers, ATS, PDF/UA
  metadata: { title: "Invoice", author: "ACME", creationDate: new Date(0) },
});

pdf.addPage();                       // same defaults, cursor at top
pdf.addPage({ landscape: true });    // per-page overrides
pdf.pageBreak();                     // explicit page break in the flow
pdf.pageBreak({ y: 200 });           // …and decide where the new page starts
pdf.moveDown(2);                     // advance flow cursor
pdf.y = 300;                         // or set it directly

pdf.x;                               // left edge of the active flow area (read-only)
pdf.width;                           // width of the active flow area
pdf.remainingHeight;                 // room left before the bottom margin
pdf.lastBlockHeight;                 // height the previous block consumed
pdf.ensureSpace(120);                // break now if 120pt no longer fit → boolean
pdf.keepTogether((d) => { … });      // measure first, move the whole block if needed
```

`x` bridges the two coordinate modes: `text({ x })` **without** `y` is an
offset *within* the flow area, while `text({ x, y })` and `rect(x, …)` take
absolute page coordinates — `pdf.x + offset` converts between them.

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
  opacity: 0.6,                      // constant alpha 0–1
  rotate: -90,                       // clockwise around the block's top-left anchor
  spacingAfter: 8,
  spacingBefore: 12,                 // collapses at the top of a page/column/region
  keepWithNext: true,                // reserve room for the next 2 lines as well
});

pdf.text("Header", { y: 20, align: "right" });   // absolute position: no flow, no page break
pdf.widthOfText("How wide is this?", { size: 12, letterSpacing: 1.5 });
```

Text flows top-to-bottom and **breaks pages automatically**. Break
opportunities are spaces, soft hyphens (U+00AD, rendered as "-" only when
broken there), and real hyphens, dashes and slashes — so
"Full-Stack-Entwickler" wraps in a narrow column instead of overflowing.
Digit groups stay whole (`2026-08-01`, `3/4`). Standard fonts use WinAnsi
(CP-1252): full Latin-1 incl. umlauts/ß plus €, curly quotes, dashes.

#### Measuring — one engine for drawing and measuring

Every layout that positions blocks absolutely needs the height *before* it
draws. `measureText()` and `measureBlock()` run the exact code path that
`text()` runs, so a pre-computed height can never drift from the drawn one.

```ts
const m = pdf.measureText(summary, { width: 180, size: 9 });
m.lines;        // the lines as they will actually be drawn
m.width;        // widest line, letterSpacing included
m.height;       // lines.length × lineHeight
m.baseline;     // first baseline's offset from the block top

// Dry-run arbitrary flow content on a throwaway page:
const { height } = pdf.measureBlock((d) => {
  d.text("Profil", { bold: true, spacingAfter: 4 });
  d.text(profile);
}, { width: 260 });

pdf.rect(x, y, 260, height + 16, { fill: "#f8fafc", radius: 6 });
```

`measureBlock()` draws nothing and rolls back any anchors, bookmarks and
images the callback created. Font metrics are available too, so optical
alignment no longer needs a reverse-engineered constant:

```ts
const f = pdf.fontMetrics({ size: 9 });   // { baseline, ascent, descent, capHeight, lineGap, lineHeight }
pdf.circle(x, y + f.baseline - f.capHeight / 2, 2, { fill: accent });  // centred on the x-height
```

### Custom fonts (TrueType, subsetted)

```ts
const inter = await fetch("https://example.com/Inter.ttf").then((r) => r.arrayBuffer());
pdf.registerFont(inter, { family: "inter" });
pdf.registerFont(interBold, { family: "inter", bold: true });   // variants per style
pdf.text("Full Unicode — Ελληνικά, кириллица, 中文", { font: "inter" });
```

Embedded fonts are written as Type0/Identity-H with a ToUnicode CMap
(copy/paste keeps working) and **subsetted** — only glyphs you actually use
are embedded. A missing **bold** variant falls back to the regular cut; a
missing **italic** variant is slanted synthetically (12° oblique) so italic
text is never silently rendered upright.

**Format: `.ttf` only** (or `.otf` with TrueType outlines). WOFF/WOFF2 are
rejected with a clear error — decompressing WOFF2 needs Brotli, which would
cost fast-pdf its zero dependencies. Google Fonts serves WOFF2, so convert
once at build time:

```sh
npx ttf2woff2 --help                       # (the reverse direction)
fonttools ttLib.woff2 decompress Inter.woff2   # → Inter.ttf   (pip install fonttools brotli)
```

CFF-flavoured OpenType, `.ttc` collections, kerning, ligatures and complex-script
shaping (Arabic, Devanagari) are out of scope — see [Limitations](#limitations).

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

#### Multi-column flow

`columns()` places content *side by side* on one page. `flowColumns()` pours
a sequence of items **through** the columns — into the next column when one
fills up, onto the next page when the last one does:

```ts
const { pages, dropped } = pdf.flowColumns(
  categories.map((c) => ({
    render: (d) => {
      d.text(c.name, { bold: true, spacingAfter: 3 });
      d.text(c.skills.join(" · "));
    },
    spacingBefore: 12,
    keepWithNext: true,        // never leave this heading at the foot of a column
  })),
  { columns: 2, gap: 24, balance: true },
);
```

Each item is measured at column width first, so items are never split mid-way;
one taller than a whole column is counted in `dropped` instead of overflowing
silently. `balance: true` spreads the final page evenly (newspaper setting)
rather than filling column 1 to the bottom.

#### Regions — flow inside any rectangle

A region gives arbitrary flow content its own cursor inside a fixed box —
including inside `onPage()` decorators, where there is no document flow:

```ts
pdf.onPage((doc, info) => {
  doc.rect(0, 0, 170, info.size.height, { fill: "#101828" });

  const { overflow, usedHeight, remaining } = doc.region(
    { x: 28, y: 56, width: 114, height: info.size.height - 110 },
    (d) => {
      d.text("KONTAKT", { color: "#7aa2ff", size: 8, letterSpacing: 1.5, spacingAfter: 6 });
      d.text(contact, { color: "#e2e8f0", size: 9 });
    },
  );
  if (overflow) console.warn(`sidebar short by ${-remaining}pt`);
});
```

Regions never move the surrounding cursor and never break pages — and they
tell you when the content did not fit instead of clipping it quietly. Pass
`clip: true` to cut off the overflow as well.

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
    valign: "middle",                  // top | middle | bottom (per cell too)
  },
);
```

Cells wrap, row height adapts, and long tables break across pages with the
header re-drawn on every page. Rows chained by `rowSpan` never straddle a
page break.

A cell can also **draw itself** — a progress bar, a badge row, a logo —
instead of rendering text. The row is sized from the measured content (or
from an explicit `height`), and the callback gets its own cursor, so moving
`doc.y` inside a cell cannot shift the rows below it:

```ts
["TypeScript", {
  valign: "middle",
  render: (d, box) => {
    d.rect(box.x, box.y, box.width, 7, { fill: "#e2e8f0", radius: 3.5 });
    d.rect(box.x, box.y, box.width * 0.9, 7, { fill: "#2563eb", radius: 3.5 });
    d.y = box.y + 7;                   // report the height you used
  },
}]
```

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
pdf.image(avatar, { width: 120, height: 120, shape: "circle", fit: "cover" });
pdf.image(cover, { width: 200, height: 120, radius: 12, opacity: 0.85 });
```

- **JPEG**: embedded as-is (`DCTDecode`) — zero re-encoding, gray/RGB/CMYK.
- **PNG**: gray/RGB/indexed embedded without re-encoding; alpha channels become a
  proper `SMask`. (Interlaced PNGs are not supported.)
- Repeated images are embedded **once** and referenced from every page.
- `radius` / `shape: "circle"` clip with a real vector path, so round avatars
  work identically on a server, in an edge function and in the browser — no
  Canvas pre-processing.

### Shapes & vector primitives

```ts
pdf.line(50, 100, 545, 100, { color: "#e2e8f0", width: 0.5 });
pdf.rect(50, 120, 100, 40, { fill: "#3b82f6", radius: 8 });
pdf.circle(100, 300, 40, { fill: "#ffd166", stroke: "#c79000" });
pdf.ellipse(300, 300, 80, 40, { stroke: "#0f172a", lineWidth: 2 });

pdf.rect(50, 400, 495, 30, { fill: "#2563eb", opacity: 0.12 });   // any primitive
pdf.clip({ x: 50, y: 450, width: 120, height: 120, radius: 60 }, (d) => {
  d.image(photo, { x: 50, y: 450, width: 120, height: 120 });     // clipped to the circle
  d.rect(50, 540, 120, 30, { fill: "#000", opacity: 0.4 });       // …and so is this
});
```

`opacity` (0–1) is available on `line`, `rect`, `circle`, `ellipse`, `text`,
`image`, `svg` and `container` backgrounds. `clip()` confines everything a
callback draws to a rectangle — rounded, or a full circle with
`radius: height / 2`.

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

### Encryption & permissions

```ts
new PDFDocument({ encrypt: { userPassword: "geheim" } });          // open password
new PDFDocument({ encrypt: { permissions: { printing: false, copying: false } } });
new PDFDocument({ encrypt: { userPassword: "x", onUnsupported: "skip" } });
```

AES-256, revision 6 (AESV3, ISO 32000-2) via the Web Crypto API — no RC4/MD5,
no dependency. A **permissions-only** document needs no password at all: it
opens without a prompt, and fast-pdf generates a random owner password so the
restrictions cannot be lifted. Where Web Crypto is unavailable (an insecure
browser context, say), `onUnsupported: "skip"` renders the document
unencrypted instead of failing — so callers no longer have to branch on
`supportsEncryption()` themselves. The default stays `"throw"`.

Note that PDF permissions are advisory: conforming viewers honour them,
determined users can strip them. Use a `userPassword` for actual confidentiality.

### Error handling

All user-facing failures throw `FastPDFError` with a stable machine-readable
`code` (`"UNKNOWN_FONT"`, `"INVALID_COLOR"`, `"UNSUPPORTED_IMAGE"`, …).

## Limitations

fast-pdf generates documents; it deliberately does not do everything. What it
cannot do today, so you can decide before you start:

| Not supported | Notes |
|---|---|
| Reading, merging or appending existing PDFs | Generation only. Combining several files needs a second library. |
| Tagged PDF (`StructTreeRoot`), PDF/A, PDF/UA | `/Lang` and `DisplayDocTitle` are written; full structure tagging is not. |
| Form fields other than signatures | Text fields, checkboxes and dropdowns are not implemented. |
| WOFF/WOFF2 fonts | Needs Brotli. Convert to `.ttf` at build time (see above). |
| Kerning, ligatures, complex-script shaping | Latin sets well; Arabic/Devanagari are *not usable*, not merely suboptimal. |
| Gradients (`/Shading`), patterns | Flat fills and constant alpha only. |
| CFF-flavoured OpenType, `.ttc` | Rejected with an actionable error. |
| Lossy WebP, interlaced PNG | Rejected with `UNSUPPORTED_IMAGE`. |

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

## Templates — start from a working example

The fastest way to a good-looking document is not the API reference above —
it's copying the closest example from [`examples/`](examples) and adapting
it. Each one is a complete, designed document:

| Template | What you get | Run |
|---|---|---|
| [`invoice.ts`](examples/invoice.ts) | Invoice with letterhead, item table, totals block, footer | `npx tsx examples/invoice.ts` |
| [`report.ts`](examples/report.ts) | Design-forward report: full-bleed cover, KPI cards, vector bar chart | `npx tsx examples/report.ts` |
| [`cv.ts`](examples/cv.ts) | CV/résumé: sidebar via `region()`, circular portrait, measured panel, balanced two-column skill matrix, proficiency bars in table cells | `npx tsx examples/cv.ts` |
| [`signature.ts`](examples/signature.ts) | Contract with clause sections and clickable AcroForm signature fields | `npx tsx examples/signature.ts` |
| [`showcase.ts`](examples/showcase.ts) | Feature tour: TOC, outlines, watermark, cell spans, columns, links | `npx tsx examples/showcase.ts` |
| [`basic.ts`](examples/basic.ts) | Minimal text + table starting point | `npx tsx examples/basic.ts` |

The templates ship with the npm package (`node_modules/fast-pdf/examples/`).
In your own project, change the import from `"../src/index"` to `"fast-pdf"` —
everything else works as-is.

### AI skill for coding agents

**Using Claude Code (or another coding agent)?** fast-pdf ships with a
[design skill](.claude/skills/fast-pdf-designer/SKILL.md) — curated palettes,
layout recipes (letterhead, totals block, signature area) and a
render-preview-iterate loop. Install it into your project with one command:

```sh
npx fast-pdf-skill    # copies the skill to ./.claude/skills/fast-pdf-designer/
```

Then ask for "an invoice with fast-pdf" — the agent picks up the design rules
automatically.

## License

MIT
