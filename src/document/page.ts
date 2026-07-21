import { ContentStream } from "../pdf/content";
import type { Font } from "../fonts/font";
import type { ImageFormat } from "../images/image";
import type { Margins, PageSize } from "../types/index";

/** An image registered on the document, shared across pages. */
export interface ImageEntry {
  id: string;
  bytes: Uint8Array;
  format: ImageFormat;
  /** Natural size in pixels. */
  pxWidth: number;
  pxHeight: number;
}

/**
 * A single page: a content stream plus the resources it references.
 *
 * The page exposes the user-facing coordinate system (origin top-left,
 * y grows downward); `ty()` converts to PDF space at the last moment.
 */
/** Where a link annotation points: an external URL or a spot on a page. */
export type LinkTarget = string | { page: Page; y: number };

/** A pending link annotation in top-based user coordinates. */
export interface PendingLink {
  x: number;
  y: number;
  width: number;
  height: number;
  target: LinkTarget;
}

/** A pending signature form field (empty, to be signed by the recipient). */
export interface PendingSignatureField {
  /** AcroForm field name (/T) — unique within the document. */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** When set, the field is cryptographically signed at render time. */
  sign?: import("../pdf/sign").SigningOptions;
}

export class Page {
  readonly content = new ContentStream();
  readonly fontsUsed = new Map<string, { font: Font; res: string }>();
  readonly imagesUsed = new Map<string, { entry: ImageEntry; res: string }>();
  readonly extGStatesUsed = new Map<number, { alpha: number; res: string }>();
  readonly links: PendingLink[] = [];
  readonly sigFields: PendingSignatureField[] = [];

  constructor(
    readonly size: PageSize,
    readonly margins: Margins,
  ) {}

  get contentWidth(): number {
    return this.size.width - this.margins.left - this.margins.right;
  }

  get contentBottom(): number {
    return this.size.height - this.margins.bottom;
  }

  /** Convert a top-based y coordinate to PDF space (bottom-based). */
  ty(y: number): number {
    return this.size.height - y;
  }

  /** Register a font on this page and return its resource name (/F0, /F1, …). */
  fontRes(font: Font): string {
    let entry = this.fontsUsed.get(font.key);
    if (!entry) {
      entry = { font, res: `F${this.fontsUsed.size}` };
      this.fontsUsed.set(font.key, entry);
    }
    return entry.res;
  }

  /** Register a constant-alpha graphics state and return its resource name (/GS0, …). */
  gsRes(alpha: number): string {
    const key = Math.round(alpha * 1000);
    let entry = this.extGStatesUsed.get(key);
    if (!entry) {
      entry = { alpha: key / 1000, res: `GS${this.extGStatesUsed.size}` };
      this.extGStatesUsed.set(key, entry);
    }
    return entry.res;
  }

  /** Register an image on this page and return its resource name (/Im0, /Im1, …). */
  imageRes(entry: ImageEntry): string {
    let used = this.imagesUsed.get(entry.id);
    if (!used) {
      used = { entry, res: `Im${this.imagesUsed.size}` };
      this.imagesUsed.set(entry.id, used);
    }
    return used.res;
  }
}
