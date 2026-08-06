# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.1] — 2026-08-05

### Changed

- **A `/Link` left without a destination by the annotation filter is now dropped**
  instead of being copied as an inert rectangle. Its behaviour had sat in `/AA`
  (mouse-enter JavaScript), which is never copied — so the action was already
  gone in 0.7.0 and clicking did nothing. But the link rectangle survived, and
  viewers still show a hand cursor over it, which reads as "the filter did not
  work". A link with no destination has no purpose, so it goes too. Purely a
  clarity fix: no security-relevant behaviour changed between 0.7.0 and 0.7.1.

### Added

- **`docs/APPEND-SECURITY.md`** — technical report on what `append()` reads,
  copies and discards, why it is a whitelist rather than a blocklist, and how to
  verify it independently. Includes the three observations that regularly look
  like a broken filter and are not: visible page text that spells out payload
  names (page content is copied verbatim by design), a deliberately harmless
  control link, and an in-document `/GoTo` jump that is retargeted rather than
  removed.
- **`scripts/audit-pdf.mjs`** (`npm run audit -- file.pdf …`) — lists the
  security-relevant structures of any PDF. Deliberately dependency-free and
  independent of fast-pdf, so it can be used as a second opinion. Strips stream
  payloads before scanning, so visible page text cannot produce false hits.

## [0.7.0] — 2026-08-05

Appending existing PDFs — the last thing that forced a second library into a
fast-pdf project — plus clickable buttons.

No breaking changes: existing documents render as before.

### Added

- **`append(pdfBytes, options)` — attach the pages of an existing PDF.** The
  most common reason to run fast-pdf next to a second library: a CV builder
  whose applicants upload a reference letter or a certificate and want it
  attached to the generated résumé.

  ```ts
  await pdf.append(certificateBytes); // original size, 1:1
  await pdf.append(letterBytes, { fit: "page" }); // scaled to A4
  await pdf.append(scanBytes, { pages: [1, 3] }); // a selection
  await pdf.append(refBytes, { overlay: true }); // and stamp it
  ```

  Pages are **copied, not re-rendered**: their content streams, fonts and
  images move into the output byte-for-byte with their filters intact, so an
  appended page looks exactly like the original, stays as small as it was, and
  no filter beyond `/FlateDecode` has to be understood. Objects shared by
  several pages of one file are written once.

  `fit: "keep"` (default) copies the page dictionary, so the page keeps its
  size, rotation and annotations; `fit: "page"` wraps it in a form XObject
  scaled onto this document's format (`padding`, `autoRotate`). `overlay` opens
  imported pages to `header()`, `footer()`, `pageNumbers()`, `watermark()`,
  `onPage()` and direct drawing — via a form XObject whose `/Matrix` undoes the
  source page's rotation and box offset, so a stamp lands upright even on a
  page scanned sideways. Without `overlay` the flow continues on a fresh page,
  and drawing on an appended page is a typed error rather than silently
  dropped content.

  Reading covers classic cross-reference tables, cross-reference streams and
  object streams (PDF 1.5+) with PNG/TIFF predictors, inherited page
  attributes, `/Rotate` and `/CropBox`. A file whose cross-reference table is
  damaged or stale — a truncated upload, a hand-edited file — is recovered by
  scanning it for objects. Encrypted sources are rejected with
  `ENCRYPTED_PDF`; source form fields, bookmarks and tagged structure are not
  carried over, and neither are annotations holding an action other than a
  plain web link or a jump inside the imported pages, so a `/Launch` or
  `/JavaScript` action cannot travel out of an upload and into the output.
  Decompression is bounded at 64 MB per stream.

- **`pdfInfo(pdfBytes)`** → `{ version, pageCount, pageSizes, encrypted }`.
  Inspect an upload — reject a 500-page file, show "3 pages", detect a
  password-protected file — without importing anything.
- New error codes: `INVALID_PDF_FILE`, `ENCRYPTED_PDF`, `UNSUPPORTED_PDF`,
  `DECOMPRESSION_UNSUPPORTED`.
- **`button(label, options)`** — a clickable button: a filled (optionally
  bordered) rounded box with an optically centred label, covered by a link
  annotation. `link`, `fill`, `borderColor`, `borderWidth`, `color`, `width`
  (points or `"60%"`), `height`, `radius`, `paddingX`/`paddingY`, `font`,
  `size`, `bold`, `letterSpacing`, `textAlign`, `align`, `opacity`,
  `x`/`y`, `spacingBefore`/`spacingAfter`.

  Flows by default and breaks the page when it no longer fits; `y` switches
  to absolute placement. Without `width` the box sizes itself to the label;
  a label wider than the box is truncated with an ellipsis rather than
  allowed to spill out. Deliberately a link annotation and not an AcroForm
  `/Btn` widget: it needs no form support, renders in every viewer and can
  do nothing but follow its target. Targets go through the same
  `UNSAFE_LINK` check as `link()`.

## [0.6.0] — 2026-08-01

Driven almost entirely by a field report from a production application that
builds six CV designs, a skill matrix, invoices and CLI documents with
fast-pdf — in the browser, on a Node server and in scripts. Every item below
removes something that project had to build or work around by hand.

No breaking changes: existing documents render as before.

### Added

- **Measurement — `measureText()`, `measureBlock()`, `lastBlockHeight`.**
  The single largest gap: `text()` returned `this`, and with `y` set the
  cursor did not move at all, so any absolutely positioned design had to
  predict its own line counts. Applications ended up reimplementing the line
  breaker — two greedy implementations that must agree exactly or blocks
  overlap.

  `measureText(content, options)` wraps through the _same_ engine `text()`
  draws with and returns `{ lines, width, height, lineHeight, baseline }`.
  `measureBlock(fn, { width })` lays arbitrary flow content out on a
  throwaway page and reports its height, rolling back anchors, bookmarks and
  images the dry run created. `lastBlockHeight` reports what the previous
  block consumed — including for absolute blocks, where the cursor stands
  still. Together they make a duplicate layout engine unnecessary.

- **`fontMetrics({ font, size, … })`** → `{ baseline, ascent, descent,
capHeight, lineGap, lineHeight }` in points. Optical alignment (centring a
  bullet against a text line) no longer needs a reverse-engineered constant.
- **Browser build behind the `browser` export condition.** `save()` used a
  dynamic `import("node:fs/promises")` guarded by a runtime check. Bundlers
  resolve imports statically, so Turbopack, Vite and webpack still pulled a
  Node resolution into client builds and broke them — every browser user paid
  for it with a resolve alias plus a stub module. `dist/index.browser.js`
  contains no `fs` reference at all and is selected automatically; also
  reachable as `fast-pdf/browser`.
- **Clipping in the public API — `clip()`, `image({ radius, shape })`.**
  The renderer clipped internally for `container()` and `image({fit:"cover"})`
  but exposed none of it, so a round avatar could only be produced by punching
  alpha through a `<canvas>` — impossible on a server or in an edge function.
  `image({ shape: "circle" })` and `image({ radius })` clip with a real vector
  path in every runtime; `clip({ x, y, width, height, radius }, fn)` does the
  same for arbitrary drawing.
- **`opacity` on every primitive** — `line`, `rect`, `circle`, `ellipse`,
  `text`, `image`, `svg` and `container` backgrounds. The `ExtGState` alpha
  machinery existed for watermarks and SVG but was unreachable, so a
  translucent overlay or a greyed-out preview could not be built.
- **Flow control for absolute layouts** — `ensureSpace(needed)`,
  `remainingHeight`, `keepTogether(fn)`, plus `spacingBefore` and
  `keepWithNext` on `text()`. Absolute blocks never break by themselves, which
  had every template hand-rolling its own `reserve()` helper with its own idea
  of the bottom edge. `spacingBefore` collapses at the top of a page, column
  or region — the behaviour `spacingAfter` cannot express in flowing documents.
- **`region({ x, y, width, height, clip }, fn)`** — flow content with its own
  cursor inside any rectangle, _including inside `onPage()` decorators_, where
  no flow cursor exists. Returns `{ usedHeight, remaining, overflow }`, so a
  sidebar that no longer fits says so instead of quietly dropping blocks.
- **`flowColumns(items, options)`** — newspaper-style multi-column flow.
  `columns()` places content side by side on one page and `grid()` works
  row-wise; neither can let content run from column 1 into column 2 and onto
  the next page. Items are measured at column width first (never split),
  support `spacingBefore`/`keepWithNext`, and `balance: true` evens out the
  final page. Items taller than a whole column are reported in `dropped`
  rather than overflowing silently.
- **`pdf.x` and `pdf.width`** — the active flow area's left edge and width.
  `x` is the documented bridge between the two coordinate modes: `text({ x })`
  is a flow offset, `text({ x, y })` and `rect(x, …)` are absolute page
  coordinates, and `pdf.x + offset` converts between them.
- **Rotated text** — `text({ rotate })` for vertical marginalia, turned column
  heads and spine labels. Previously only `watermark()` could rotate.
- **Table `valign` and self-drawing cells.** Cells take `valign: "top" |
"middle" | "bottom"` (per cell or per table) and a `render: (doc, box) => …`
  callback for progress bars, badges or logos. The row is sized from the
  measured content or an explicit `height`, and the callback runs with its own
  cursor, so moving `doc.y` inside a cell cannot shift the rows below it.
- **`language` document option** → the catalog's `/Lang`, plus
  `ViewerPreferences /DisplayDocTitle` when a title is set. Screen readers,
  ATS parsers and PDF/UA baselines all want it; it is one line.
- **Synthetic italic.** A family registered without an italic cut used to
  render italic text silently upright. Missing italics are now slanted by the
  standard 12° oblique shear. Bold still falls back to the regular cut.
- **Permissions-only encryption.** `encrypt: { permissions: {…} }` no longer
  requires inventing a dummy owner password: the document opens without a
  prompt and fast-pdf generates a random owner password so the restrictions
  stay binding.
- **`encrypt.onUnsupported: "throw" | "skip"`.** Callers in runtimes without
  Web Crypto (insecure browser contexts) had to branch on
  `supportsEncryption()` themselves; `"skip"` now falls back to an unencrypted
  document. Default remains `"throw"`.

### Fixed

- **`widthOfText()` ignored `letterSpacing`.** The option pick was
  `font | size | bold | italic` while the wrapper measured with letter
  spacing internally, so every letterspaced heading had to be corrected by
  hand at the call site. It is now part of the signature and shares one
  measurement function with the renderer.
- **SVG arc flags were mis-parsed.** `large-arc-flag` and `sweep-flag` are
  single digits that minifiers run into the following number (`a5 5 0 0150 0`
  means `0, 1, 50, 0`). Reading them with the generic number rule corrupted
  practically every icon set that uses `a`/`A` — Lucide, Feather, Heroicons —
  which is why those icons had to be rebuilt from `circle`/`path` by hand.
  Arc parameters now have a dedicated flag reader.
- **Zero-length SVG arcs emitted `NaN`.** An arc whose endpoints coincide
  divided by zero in the centre parameterisation and poisoned the rest of the
  path. Such arcs are now dropped, per SVG 1.1 F.6.2.
- **Line breaking only considered spaces and soft hyphens.** Real hyphens,
  dashes and slashes are break opportunities now (UAX #14 classes HY/BA), so
  "Full-Stack-Entwickler" wraps inside a 104pt column instead of running over
  the edge. Digit groups are protected: `2026-08-01` and `3/4` stay whole.
- Table row heights are derived from measured content height rather than line
  count, so rows containing rendered cells size correctly.

### Changed

- `wrapLines()` is documented and enforced as the single line-breaking
  implementation: drawing and measuring cannot diverge by construction.
- `Font` implementations expose `capHeight` and `lineGap`; real cap heights
  are recorded for the standard 14 fonts and read from `OS/2` / `hhea` for
  embedded ones.
- Shapes emit their colour and line-width operators _before_ the path is
  constructed, matching PDF's graphics object model (only construction and
  painting operators belong between `re`/`m` and `f`/`S`/`B`). Rendered
  output is visually identical, but the operator order inside content
  streams changed — if you hash `deterministic: true` output, expect new
  digests for documents containing `rect()`, `circle()` or `ellipse()`.
- `npm run build` clears `dist/` itself — tsup runs the two build configs
  concurrently, so its own `clean` would race them.

### Documentation

- README: measurement, regions, multi-column flow, clipping, opacity,
  self-drawing table cells, the browser condition, and a new **Limitations**
  table stating plainly what fast-pdf does not do (reading/merging PDFs,
  tagged PDF, non-signature form fields, WOFF2, shaping, gradients).
- Encryption is documented for the first time, including the advisory nature
  of PDF permissions.
- The font section now names `.ttf` as the required format and gives a
  one-line WOFF2 conversion command.

## [0.5.0] — 2026-07-23

### Added

- WebP images (lossless): `image()` now accepts lossless WebP (the VP8L
  profile), decoded in-house to a DeviceRGB image plus, when the picture has
  transparency, an 8-bit `/SMask`. The decoder implements the complete VP8L
  feature set — the four inverse transforms (predictor, cross-color,
  subtract-green, colour-indexing with pixel bundling), the colour cache,
  meta-Huffman code groups and LZ77 with 2-D distance mapping — with no
  dependency, and is validated bit-exact against libwebp. Lossy WebP (VP8) is
  intentionally not decoded and is rejected with the `UNSUPPORTED_IMAGE` error
  code.
- GIF images: `image()` accepts GIF and renders the first frame, compositing it
  onto the logical screen; the palette is decoded to DeviceRGB and a transparent
  colour index becomes an `/SMask`. Dependency-free LZW decoder.
- SVG rendering: a new `svg()` method renders a practical SVG subset as native
  PDF vector graphics — `rect`, `circle`, `ellipse`, `line`, `polyline`,
  `polygon`, `path`, `text`, groups (`g`) with fills, strokes and opacity, and
  the full transform list (`translate`, `rotate`, `scale`, `skewX/Y`, `matrix`).
- Markdown rendering: a new `markdown()` method renders a CommonMark subset —
  headings, paragraphs, ordered/unordered lists, tables, code blocks,
  blockquotes, horizontal rules, and inline emphasis, links and images.
- Digital signatures (Enterprise Roadmap Phase 5): `signature({ sign: … })`
  now cryptographically signs the document with a detached **PAdES-B (CAdES)**
  signature — SubFilter `ETSI.CAdES.detached`, RSA + SHA-256, with the ESS
  signing-certificate-v2 attribute. The signer key and certificate are passed
  as PEM (PKCS#8 + X.509); the CMS SignedData is built in-house and the digest
  is signed via the Web Crypto API (no dependency). Validated end-to-end
  against `openssl cms -verify` and macOS Quartz. One signed field per
  document; signing an encrypted document is rejected.
- Document encryption (Enterprise Roadmap Phase 5): a new `encrypt` document
  option protects the file with the AES-256 standard security handler
  (revision 6 / AESV3, ISO 32000-2). Supports a user password (open password),
  an owner password (full rights) and granular permissions (printing, copying,
  modifying, annotating, form filling, assembling, accessibility). Only the
  modern R6 handler is implemented — all cryptography runs through the Web
  Crypto API (SHA-256/384/512 + AES-256), with no RC4/MD5 and no dependency.
  Both strings and streams are encrypted. New `ENCRYPTION_UNSUPPORTED` error
  code for runtimes without Web Crypto.
- Deterministic output (Enterprise Roadmap Phase 4): a new `deterministic`
  document option produces byte-identical PDFs for identical input. In that
  mode no wall-clock timestamp is embedded (unless `metadata.creationDate` is
  set explicitly), making output reproducible for hashing, archiving and
  signatures. An explicit `creationDate` is always honoured.
- Every document now carries a file `/ID` in the trailer, derived from a
  128-bit digest of the file body — stable for stable input, distinct for
  distinct documents. `ModDate` is now written alongside `CreationDate`.

### Security

- Numeric input hardening (Enterprise Roadmap Phase 3): the public drawing and
  text entry points (`line()`, `rect()`, `circle()`, `ellipse()`, `text()`)
  now reject `NaN`, `±Infinity` and out-of-range magnitudes (≥ 1e21) at the
  call site with a new stable `INVALID_NUMBER` error code, instead of letting a
  bad value leak into the serializer.
- `fmtNumber()` now throws a typed `FastPDFError` (`INVALID_NUMBER`) as a
  last-line-of-defence guard, rather than a generic `Error`, so no code path
  can emit a corrupt PDF number.

## [0.4.0] — 2026-07-19

### Added

- The `fast-pdf-designer` Claude Code skill ships with the package: palettes,
  layout recipes and a visual validation loop for building designed documents
  with AI coding agents. Install into a project with `npx fast-pdf-skill`.
- The example templates (`examples/*.ts`) are now part of the npm package
  (`node_modules/fast-pdf/examples/`), and the README links them as
  copy-and-adapt starting points.

- `signature()` — empty AcroForm signature fields (`/FT /Sig`) for contracts:
  the recipient clicks the field in their PDF viewer, signs and sends the
  document back. Draws a signature line and optional label, participates in
  the flow layout (or absolute via `x`/`y`), auto-names fields
  `Signature1`, `Signature2`, … with uniqueness enforced.

### Security

- Link targets (`link()`, `text({ link })`) now reject `javascript:`,
  `vbscript:`, `data:` and `file:` URI schemes — including variants disguised
  with control characters — with a new `UNSAFE_LINK` error code.
- The PNG alpha decode path is hardened against decompression bombs: the
  decompressed IDAT size is capped at the size implied by the declared
  dimensions, and the pixel count is capped at 2²⁷ (~134 MP).
  `inflate()` gained an optional `maxBytes` limit.
- Truncated or malformed PNG/JPEG files now fail with typed
  `FastPDFError`s (`INVALID_IMAGE_FILE`, `IMAGE_TOO_LARGE`) instead of
  crashing with `RangeError`s deep in the parser; the same normalization
  applies to corrupt fonts in `registerFont()` (`INVALID_FONT_FILE`).
- Numbers ≥ 1e21 are rejected instead of silently serializing in exponent
  notation (invalid PDF syntax); PDF names with characters beyond U+00FF are
  now escaped as UTF-8 byte sequences per ISO 32000-1.
- Added `SECURITY.md` (threat model, reporting) and a README security section.

## [0.3.0] — 2026-07-18

### Added

- `objectTable(records, { columns })` — render an array of records (e.g. a JSON
  REST response) straight into a table. Columns default to the keys of the first
  record, or you pick order, headers, widths, alignment and a per-column
  `format(value, record)` function.
- `examples/report.ts` — a design-forward two-page report (full-bleed color,
  a vector bar chart, big type) showing fast-pdf beyond invoices.

### Fixed

- Stroke-only shapes (`circle`/`ellipse`/`rect` with `stroke` but no `fill`)
  were always drawn in black — the requested stroke color was reset to black
  right before stroking. They now use the color you pass.
- `pageBreak({ y?, format?, landscape?, margins? })` — explicit page break with a
  controllable start position and per-page setup. Throws inside
  `container()`/`columns()`/`grid()`, which keep their content on one page.
- Trilingual demo page (English/German/Chinese) at
  <https://kevinci.github.io/fast-pdf/> with a language selector.
- The package builds itself on install from GitHub (`prepare` script), so
  `npm install github:Kevinci/fast-pdf` works without a published release.

## [0.2.0] — 2026-07-17

### Added

- **Shapes**: `circle()`, `ellipse()`, rounded rectangles (`rect(..., { radius })`),
  plus Bézier/clip/transform operators in the content stream.
- **Layout engine**: `container()` (padding, margin, background, border, radius,
  minHeight), `columns()`, `grid()`, relative sizes (`"50%"`), block alignment.
- **Typography**: underline, strikethrough, letter spacing, justified text, and
  soft-hyphen (U+00AD) hyphenation.
- **Tables**: footer rows, `colSpan`/`rowSpan` (span groups never straddle page
  breaks).
- **Images**: `fit: contain | cover`, `crop`, `rotate`, `align`.
- **Document features**: `header()`, `footer()`, `pageNumbers()`, `watermark()`,
  `outline()` bookmarks, link annotations (URLs + `#anchor`), and a linked
  table of contents via `toc()`.
- `toStream()` output (ReadableStream), and `FastPDFError` with stable codes.

## [0.1.0] — 2026-07-14

### Added

- Initial engine: `PDFDocument`/`Page`, multi-page documents, page formats
  (A3–A5, Letter, Legal), landscape, margins.
- Standard-14 fonts with real AFM metrics, WinAnsi encoding, TrueType embedding
  with subsetting.
- Text with word wrap, alignment and colors; automatic page breaks; tables with
  header repetition and zebra rows; JPEG/PNG images; vector primitives.
- Output as `Uint8Array`, `toBuffer()`, `toBlob()`, `save()` across
  Node/Bun/Deno/browser.

[0.5.0]: https://github.com/Kevinci/fast-pdf/releases/tag/v0.5.0
[0.4.0]: https://github.com/Kevinci/fast-pdf/releases/tag/v0.4.0
[0.3.0]: https://github.com/Kevinci/fast-pdf/releases/tag/v0.3.0
[0.2.0]: https://github.com/Kevinci/fast-pdf/releases/tag/v0.2.0
[0.1.0]: https://github.com/Kevinci/fast-pdf/releases/tag/v0.1.0
