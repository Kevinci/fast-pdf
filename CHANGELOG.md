# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
