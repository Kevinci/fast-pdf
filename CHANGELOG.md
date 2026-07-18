# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-07-18

### Added

- `objectTable(records, { columns })` — render an array of records (e.g. a JSON
  REST response) straight into a table. Columns default to the keys of the first
  record, or you pick order, headers, widths, alignment and a per-column
  `format(value, record)` function.
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
