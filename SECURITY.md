# Security Policy

## Supported versions

Security fixes land on the latest minor release. Please stay on the newest
version — there are no long-term support branches.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/Kevinci/fast-pdf/security/advisories/new)
or by email to <kevinci.coding@gmail.com>. Do not open a public issue for
security reports. You will get a response within a few days.

## Threat model

fast-pdf generates PDFs; it never parses or executes untrusted PDF files.
The generated output is **passive by design**: no JavaScript actions, no
embedded files, no forms, no launch actions and no external content — only
text, vector graphics, images, links, bookmarks and metadata.

What the library guarantees:

- **Text and metadata are injection-safe.** Every string (text content, table
  cells, headers/footers, metadata, bookmark titles) is escaped before it
  reaches PDF syntax. User data cannot break out of a string literal into
  PDF operators or objects.
- **Link targets are validated.** `javascript:`, `vbscript:`, `data:` and
  `file:` URI schemes are rejected (`UNSAFE_LINK` error), including variants
  disguised with control characters. `http(s):`, `mailto:` and custom app
  schemes are allowed.
- **Image parsing is bounded.** PNG and JPEG headers are bounds-checked and
  reject truncated or dimension-less files with typed errors. The PNG alpha
  decode path (the only path that decompresses data) caps decompressed size
  against the declared dimensions — a crafted "zlib bomb" fails fast instead
  of exhausting memory — and caps total pixels at 2²⁷ (~134 MP).

Trust boundaries you are responsible for:

- **Fonts are trusted input.** `registerFont()` is designed for font files
  you ship with your application. Corrupt files fail with
  `INVALID_FONT_FILE`, but the parser is not hardened against adversarial
  fonts — do not feed it end-user uploads.
- **Escape hatches bypass escaping.** `ContentStream.raw()` and the
  low-level `PDFWriter`/`serialize` APIs write PDF syntax verbatim. Never
  pass untrusted data into them.
- **User-uploaded images** (e.g. invoice logos) are handled defensively, but
  applying your own upload size limit before calling `image()` is still good
  practice.
- **What a PDF says is not authenticated.** If you generate invoices,
  encryption or careful escaping cannot prevent someone from crafting a
  *different* PDF that imitates yours. Authenticity requires digital
  signatures (PAdES) and/or structured e-invoicing formats (ZUGFeRD/Factur-X,
  XRechnung) — currently outside the scope of this library.

## Supply chain

- Zero runtime dependencies — the published package contains only its own
  compiled output (`dist/`), README and LICENSE.
- No install scripts run for consumers installing from the npm registry.
