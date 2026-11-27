import type { Font } from "../fonts/font";
import type { ParsedImage } from "../images/image";
import type { PDFValue } from "../pdf/objects";
import type { PDFWriter } from "../pdf/writer";
import type { DocumentMetadata } from "../types/index";

/**
 * Render hooks — the seam an opt-in entry point uses to change what a
 * document is allowed to contain and what its catalog carries.
 *
 * This is how `fast-pdf/pdfa` and `fast-pdf/zugferd` work without living in
 * the core bundle: the core only knows that *a* hook may be registered for a
 * document and calls it at three fixed points of `render()`. Everything the
 * hook does — XMP, the output intent, embedded files, the PDF/A prohibitions —
 * ships in the subpath that registers it.
 *
 * Deliberately not exported from any entry point. It is an internal contract
 * between entries of this package, so it can change with them.
 */
export interface RenderHook {
  /** Called first. Throw to refuse a document the mode cannot represent. */
  begin(state: RenderState): void;
  /** Called once per unique image, after parsing. Throw to refuse it. */
  image(parsed: ParsedImage): void;
  /** Write extra objects and return the catalog entries that point at them. */
  catalog(writer: PDFWriter, context: CatalogContext): Record<string, PDFValue | undefined>;
}

export interface RenderState {
  /** Every font some page actually draws with, each once. */
  fonts: Font[];
  /** The `encrypt` option is set. */
  encrypted: boolean;
  /** At least one page comes from `append()`. */
  imported: boolean;
  /**
   * The document has interactive form fields — text fields, checkboxes,
   * radio groups or dropdowns. Signature fields do not count.
   */
  forms: boolean;
}

export interface CatalogContext {
  metadata: DocumentMetadata;
  language?: string;
  /** The timestamp the Info dictionary uses; absent in a deterministic render. */
  date?: Date;
}

const hooks = new WeakMap<object, RenderHook>();

/** The hook registered for this document, if any. */
export function hookOf(document: object): RenderHook | undefined {
  return hooks.get(document);
}

/** Register the hook for a document. One hook per document. */
export function setHook(document: object, hook: RenderHook): void {
  hooks.set(document, hook);
}
