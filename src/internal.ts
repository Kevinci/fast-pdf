/**
 * `fast-pdf/internal` — the PDF engine underneath the document API.
 *
 * **Not covered by SemVer.** These are the parts `PDFDocument` is built from:
 * the object writer, the content-stream builder, the PDF primitives, raw
 * Flate and the font and encryption internals. They exist here so that
 * someone who needs to write a PDF construct fast-pdf does not offer can do
 * it without forking the package — not as a stable contract. Names,
 * signatures and behaviour may change in any release, including a patch.
 *
 * ```ts
 * import { PDFWriter, Name } from "fast-pdf/internal";
 * ```
 *
 * Two warnings that are easy to miss:
 *
 * - `ContentStream.raw()` and `serialize()` write PDF syntax verbatim. Never
 *   pass untrusted data into them — the escaping that protects `text()` and
 *   `table()` lives above this layer, not in it.
 * - Anything you build here is yours to keep working. If your use case is
 *   common, open an issue and ask for it in the main entry instead.
 */

export { PDFWriter } from "./pdf/writer";
export { ContentStream } from "./pdf/content";
export { Ref, Name, PDFString, serialize, type PDFValue } from "./pdf/objects";
export { deflate, inflate } from "./pdf/compress";
export { createSecurityHandler } from "./pdf/encrypt";
export { EmbeddedFont } from "./fonts/embedded";
export { TTFFont } from "./fonts/ttf";
