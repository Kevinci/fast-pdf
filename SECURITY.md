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

fast-pdf generates PDFs. It never _executes_ anything, and what it produces is
**passive by design**. Stated precisely, because this is the promise the
library is built around:

> fast-pdf never embeds a file unless the caller explicitly asks it to. A
> document created with `new PDFDocument()` contains no embedded files, no
> JavaScript actions, no launch actions, no auto-actions (`/AA`) and no
> external content — only text, vector graphics, images, links, bookmarks,
> metadata and, where you call `signature()`, signature form fields. An
> imported third-party PDF never contributes an attachment either: `append()`
> drops `/FileAttachment` unchanged (see **Importing PDFs** below).

That is a property of the document, not a claim that the code could not do
otherwise. Since 1.1.0 two opt-in entry points embed files: `fast-pdf/pdfa`
(`pdfA(doc).attach(...)`) and `fast-pdf/zugferd` (`facturX(doc, xml, ...)`).
What holds for them:

- **Nothing reachable from the main entry point embeds a file.** It takes an
  explicit `import … from "fast-pdf/pdfa"` or `"fast-pdf/zugferd"` and an
  explicit call per document. `tests/entry-points.test.ts` pins this.
- **They store exactly the bytes the caller passes**, under the name and MIME
  type the caller passes (for Factur-X: the fixed name `factur-x.xml` /
  `xrechnung.xml` and `text/xml`). fast-pdf never reads a file from disk or
  the network to embed it, and never embeds anything on its own initiative.
- **File names are restricted** to a plain name: no path separators, no
  control characters, at most 255 characters, unique per document.
- **The payload is not interpreted.** An embedded file is data for the
  recipient's software. fast-pdf does not validate it and cannot make it
  safe: if you embed untrusted content, the recipient receives untrusted
  content. The Factur-X XML check is a plausibility check against shipping
  the wrong file, not a security control.
- **Everything else stays passive.** PDF/A mode adds an XMP metadata stream
  and an ICC output profile; it adds no actions, no scripts and no external
  references — PDF/A forbids them anyway. Text you pass as metadata is
  XML-escaped before it enters the XMP packet.
- **The import filter is untouched.** `append()` still drops every
  attachment of a third-party PDF, and `append()` cannot be combined with
  PDF/A mode at all.

The one interactive structure the library writes is an `/AcroForm` containing
signature fields, and only when you call `signature()`. Those fields may also
be cryptographically signed — see **Signatures and authenticity** below.

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
  low-level `PDFWriter`/`serialize` APIs — exported from `fast-pdf/internal`
  since 0.9.0, and not covered by SemVer — write PDF syntax verbatim. The
  escaping layer sits above them, not inside them, so never pass untrusted
  data into them.
- **User-uploaded images** (e.g. invoice logos) are handled defensively, but
  applying your own upload size limit before calling `image()` is still good
  practice.
- **What a PDF says is not authenticated unless you sign it.** Encryption and
  careful escaping cannot prevent someone from crafting a _different_ PDF that
  imitates yours. Authenticity comes from a digital signature — see below.

### Signatures and authenticity

fast-pdf **can** sign the document itself: `signature({ sign })` produces a
detached **PAdES-B (CAdES)** signature over the whole file, built as CMS
SignedData and signed with RSASSA-PKCS1-v1_5 + SHA-256 through the Web Crypto
API. The signer certificate is embedded and bound to the signature via the ESS
`signing-certificate-v2` attribute.

Its limits are part of the threat model, so take them into account before you
rely on it:

- **One signed field per document**; a second one is rejected.
- **No trusted timestamp.** There is no RFC 3161 token — the time is the
  `signingTime` attribute, taken from the signer's own clock, and a signer can
  set it to anything.
- **No PAdES-LT/LTA**: no embedded revocation data, so long-term validation
  depends on the verifier fetching CRL/OCSP itself.
- **RSASSA-PKCS1-v1_5 + SHA-256 only**, no ECDSA, no HSM/PKCS#11 integration.
  The private key is handed over as a PEM string — keeping it out of logs,
  source control and crash dumps is your job.
- A signature is only as good as the certificate behind it. A self-signed
  certificate verifies cryptographically and still means nothing to a viewer's
  trust store.

What remains outside the scope of this library are **structured e-invoicing
formats** (ZUGFeRD/Factur-X, XRechnung): they are a different kind of
authenticity — machine-readable invoice semantics, not a cryptographic
signature — and fast-pdf neither produces nor validates them today.

## Supply chain

- Zero runtime dependencies — the published package contains only its own
  compiled output (`dist/`), README and LICENSE.
- No install scripts run for consumers installing from the npm registry.
