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

fast-pdf generates PDFs. It never _executes_ anything, and the generated output
is **passive by design**: no JavaScript actions, no embedded files, no forms, no
launch actions and no external content — only text, vector graphics, images,
links, bookmarks and metadata.

Since 0.7.0 there is one place where the library reads a file it did not write:
`append()` and `pdfInfo()` parse an existing PDF, which in a typical application
is a user upload. See **Importing PDFs** below for what that parser does and
does not let through.

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

### Importing PDFs (`append()`, `pdfInfo()`)

An imported page's content streams are copied **verbatim**, without being
decoded or executed — a content stream is drawing instructions, and fast-pdf
does not interpret them. What could turn a copied page into something active is
the _structure_ around it, so the import is filtered rather than cloned
wholesale:

- **The page dictionary is whitelisted**, not blocklisted. Only geometry,
  resources, contents and the transparency group come over. Page-level actions
  (`/AA`), tagged-structure links and application-private data are left behind.
- **Annotations are restricted to markup subtypes** — links, notes, highlights,
  shapes. Dropped outright: `/Widget` (form fields), and `/FileAttachment`,
  `/Sound`, `/Movie`, `/RichMedia` and `/3D`, which carry payloads.
- **Actions must be a plain web link or a jump inside the imported pages.**
  `/Launch`, `/JavaScript`, `/SubmitForm` and friends are dropped, `/AA` is
  never copied, and a surviving `/URI` goes through the same scheme check as
  `link()`.
- **Parsing is bounded.** Decompression is capped at 64 MB per stream and object
  nesting at 128 levels, so neither a compression bomb nor a deeply nested
  object can exhaust memory. Reference cycles — a page pointing at its parent
  pointing back — terminate rather than recurse.
- **Encrypted files are rejected** (`ENCRYPTED_PDF`) instead of being guessed at.
- A damaged cross-reference table is recovered by scanning the file. This is a
  robustness feature for real-world uploads, not a security boundary: it only
  changes _which_ objects are found, never what they are allowed to contain.

Still yours to decide: **apply an upload size and page-count limit.** `pdfInfo()`
exists for exactly that — check `pageCount` before calling `append()`. A 5,000-page
upload is a resource problem no library-side default can solve for you.

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
  _different_ PDF that imitates yours. Authenticity requires digital
  signatures (PAdES) and/or structured e-invoicing formats (ZUGFeRD/Factur-X,
  XRechnung) — currently outside the scope of this library.

## Supply chain

- Zero runtime dependencies — the published package contains only its own
  compiled output (`dist/`), README and LICENSE.
- No install scripts run for consumers installing from the npm registry.
