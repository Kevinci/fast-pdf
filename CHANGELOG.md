# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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

[0.3.0]: https://github.com/Kevinci/fast-pdf/releases/tag/v0.3.0
[0.2.0]: https://github.com/Kevinci/fast-pdf/releases/tag/v0.2.0
[0.1.0]: https://github.com/Kevinci/fast-pdf/releases/tag/v0.1.0
