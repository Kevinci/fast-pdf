/**
 * Copying pages out of an existing PDF into a document being written.
 *
 * The strategy is deliberately dumb about content: a page's object graph is
 * cloned into the writer's number space with references remapped, and stream
 * bytes are carried over exactly as they were found, filters and all. Nothing
 * is re-encoded, so imported pages render identically to the source and no
 * filter beyond /FlateDecode has to be understood.
 *
 * Two placements are supported:
 *
 *   - **keep** — the page dictionary itself is copied, so the page keeps its
 *     /MediaBox, /Rotate and annotations. Highest fidelity.
 *   - **form** — the page is wrapped in a form XObject that can be scaled and
 *     placed anywhere, which is what fitting a foreign page size onto this
 *     document's format needs.
 *
 * Both need the same coordinate bridge: PDF pages carry a /Rotate flag and a
 * box that need not start at the origin, while everything above this layer
 * works in a plain top-left system over the *visible* page. `displayMatrix`
 * and `overlayMatrix` are the two directions of that mapping.
 */
import { FastPDFError } from "../errors";
import { deflate } from "./compress";
import { blockedUriScheme } from "../validate";
import { Name, PDFString, HexString, Ref, type PDFValue } from "./objects";
import { PDFStream, asDict, isName, type PDFDict, type PDFReader, type SourcePage } from "./reader";
import type { PDFWriter } from "./writer";

/** A PDF transformation matrix [a b c d e f]. */
export type Matrix = [number, number, number, number, number, number];

/** The matrix that applies `m` first and then `n`. */
export function concatMatrix(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** Map a point through a matrix. */
export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Map a rectangle through a matrix. Annotation rectangles are unordered pairs
 * of opposite corners, so the result is renormalized to lower-left first —
 * under a rotation the corners swap roles.
 */
export function transformRect(
  m: Matrix,
  rect: readonly [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay] = applyMatrix(m, rect[0], rect[1]);
  const [bx, by] = applyMatrix(m, rect[2], rect[3]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/**
 * Source page space → display space: the transform a viewer applies for
 * /Rotate, with the page box moved to the origin. After it, the page occupies
 * [0, 0, size.width, size.height].
 */
export function displayMatrix(page: SourcePage): Matrix {
  const [llx, lly, urx, ury] = page.box;
  const w = urx - llx;
  const h = ury - lly;
  switch (page.rotate) {
    case 90:
      return [0, -1, 1, 0, -lly, w + llx];
    case 180:
      return [-1, 0, 0, -1, w + llx, h + lly];
    case 270:
      return [0, 1, -1, 0, h + lly, -llx];
    default:
      return [1, 0, 0, 1, -llx, -lly];
  }
}

/**
 * Display space → source page space, the inverse of `displayMatrix`. Used as
 * the /Matrix of an overlay drawn on a page that was copied 1:1: the overlay
 * is authored against the visible page, but lands in a content stream that
 * the viewer will still rotate and offset.
 */
export function overlayMatrix(page: SourcePage): Matrix {
  const [llx, lly, urx, ury] = page.box;
  const w = urx - llx;
  const h = ury - lly;
  switch (page.rotate) {
    case 90:
      return [0, 1, -1, 0, llx + w, lly];
    case 180:
      return [-1, 0, 0, -1, llx + w, lly + h];
    case 270:
      return [0, -1, 1, 0, llx, lly + h];
    default:
      return [1, 0, 0, 1, llx, lly];
  }
}

/**
 * Clones an object graph from a reader into a writer, remapping every
 * indirect reference. One copier is shared by all pages of one import so
 * fonts, images and colour spaces used by several pages are written once.
 *
 * References are reserved before their target is fetched, which is what makes
 * the cyclic graphs PDF is full of (a page pointing at its parent pointing
 * back at the page) terminate.
 */
export class ObjectCopier {
  /** Source object number → its reference here, or null when dropped. */
  private readonly map = new Map<number, Ref | null>();

  constructor(
    private readonly reader: PDFReader,
    private readonly writer: PDFWriter,
  ) {}

  /**
   * Pre-bind a source object number to a reference in the output, so anything
   * pointing at it (a /Parent, a link destination) lands on our object instead
   * of duplicating the source's. `null` drops the reference.
   */
  seed(num: number, ref: Ref | null): void {
    this.map.set(num, ref);
  }

  /** Deep-copy a value, following and remapping references. */
  async copy(value: PDFValue | undefined): Promise<PDFValue | undefined> {
    if (value === undefined || value === null) return value;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Name || value instanceof PDFString || value instanceof HexString)
      return value;
    if (value instanceof Ref) return this.copyRef(value);
    if (Array.isArray(value)) {
      const out: PDFValue[] = [];
      for (const entry of value) out.push((await this.copy(entry)) ?? null);
      return out;
    }
    return this.copyDict(value as PDFDict);
  }

  /** Copy a dictionary, optionally leaving keys out. */
  async copyDict(dict: PDFDict, skip: readonly string[] = []): Promise<PDFDict> {
    const out: PDFDict = {};
    for (const [key, entry] of Object.entries(dict)) {
      if (entry === undefined || skip.includes(key)) continue;
      out[key] = await this.copy(entry);
    }
    return out;
  }

  private async copyRef(ref: Ref): Promise<PDFValue> {
    const known = this.map.get(ref.num);
    if (known !== undefined) return known;
    const target = this.writer.reserve();
    this.map.set(ref.num, target);
    const object = await this.reader.object(ref.num);
    if (object instanceof PDFStream) {
      // /Length is recomputed by the writer; every other key (filters
      // included) is kept so the untouched bytes stay decodable.
      this.writer.fillStream(target, await this.copyDict(object.dict, ["Length"]), object.raw);
    } else {
      this.writer.fill(target, (await this.copy(object)) ?? null);
    }
    return target;
  }
}

/**
 * Page-dictionary keys carried over by a 1:1 copy.
 *
 * A whitelist rather than a blocklist: keys like /StructParents, /B or
 * /PieceInfo point into document-wide structures that are not imported, and
 * copying them would either dangle or drag half the source file along.
 * /Parent and /Annots are set by the caller.
 */
const PAGE_KEYS = [
  "Contents",
  "Resources",
  "MediaBox",
  "CropBox",
  "BleedBox",
  "TrimBox",
  "ArtBox",
  "Rotate",
  "Group",
  "UserUnit",
] as const;

/** Copy a source page dictionary for a 1:1 import (without /Parent, /Annots). */
export async function importPageDict(copier: ObjectCopier, page: SourcePage): Promise<PDFDict> {
  const out: PDFDict = {};
  for (const key of PAGE_KEYS) {
    if (page.dict[key] !== undefined) out[key] = await copier.copy(page.dict[key]);
  }
  // Inherited values are materialized on the page — the source page tree is
  // not copied, so there is nothing left to inherit from. Missing any of these
  // would silently change how the page renders: a page that inherited
  // /Rotate 90 from its parent would come out upright but sideways.
  if (out.Resources === undefined && page.resources !== undefined) {
    out.Resources = await copier.copy(page.resources);
  }
  if (out.MediaBox === undefined) out.MediaBox = [...page.mediaBox];
  if (page.rotate !== 0) out.Rotate = page.rotate;
  const cropped = page.box.some((value, i) => value !== page.mediaBox[i]);
  if (cropped) out.CropBox = [...page.box];
  return out;
}

/**
 * Wrap a source page in a form XObject, ready to be drawn with `Do`.
 * The returned object draws into [0, 0, page.size.width, page.size.height].
 */
export async function importAsForm(
  reader: PDFReader,
  copier: ObjectCopier,
  writer: PDFWriter,
  page: SourcePage,
  compress: boolean,
): Promise<Ref> {
  const streams = await reader.contents(page);
  const dict: PDFDict = {
    Type: new Name("XObject"),
    Subtype: new Name("Form"),
    FormType: 1,
    BBox: [...page.box],
    Matrix: displayMatrix(page),
    Resources: (await copier.copy(page.resources)) ?? {},
    Group: await copier.copy(page.dict.Group),
  };

  // One stream is the common case and needs no decoding at all: its bytes and
  // filters move over untouched. Several streams have to be concatenated,
  // which means decoding them first.
  if (streams.length === 1) {
    const only = streams[0]!;
    dict.Filter = await copier.copy(only.dict.Filter);
    dict.DecodeParms = await copier.copy(only.dict.DecodeParms);
    return writer.addStream(dict, only.raw);
  }
  const parts: Uint8Array[] = [];
  for (const stream of streams) {
    try {
      parts.push(await reader.decoded(stream));
    } catch (error) {
      if (error instanceof FastPDFError && error.code === "UNSUPPORTED_PDF") {
        throw new FastPDFError(
          `${error.message}. This page can still be appended unscaled with fit: "keep".`,
          "UNSUPPORTED_PDF",
        );
      }
      throw error;
    }
    parts.push(new Uint8Array([0x0a]));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const data = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    data.set(part, at);
    at += part.length;
  }
  // This is the one path that decodes content, so it is also the one that has
  // to compress again — otherwise a multi-stream page would grow on import.
  const deflated = compress ? await deflate(data) : null;
  dict.Filter = deflated !== null ? new Name("FlateDecode") : undefined;
  return writer.addStream(dict, deflated ?? data);
}

/** What the annotation import needs to know about the pages around it. */
export interface AnnotContext {
  /** Source object numbers of the pages that were imported. */
  imported: Set<number>;
  /** Reference of the page the annotations belong to, in the output. */
  pageRef: Ref;
  /**
   * Transform from source page space to this page's space, or null for a 1:1
   * copy (where source coordinates already are page coordinates).
   */
  transform: Matrix | null;
}

/**
 * Annotation subtypes carried over from an imported page.
 *
 * A whitelist, because the source is an untrusted upload: /Widget belongs to an
 * /AcroForm that is not imported, and /FileAttachment, /Sound, /Movie,
 * /RichMedia and /3D carry payloads that would turn a passive document into a
 * carrier for one. What is left is markup — links, notes, highlights, shapes —
 * which draws and does nothing else.
 */
const ANNOT_SUBTYPES = new Set([
  "Link",
  "Text",
  "FreeText",
  "Highlight",
  "Underline",
  "StrikeOut",
  "Squiggly",
  "Square",
  "Circle",
  "Line",
  "Polygon",
  "PolyLine",
  "Stamp",
  "Ink",
  "Caret",
]);

/**
 * Keys never copied from an annotation dictionary. /Rect, /QuadPoints and /P
 * are rewritten; /AA holds cursor-triggered actions (including JavaScript) that
 * the /A check below would otherwise never see; /Parent and /Popup point at
 * objects that do not come along.
 */
const ANNOT_SKIP = ["P", "Parent", "Rect", "QuadPoints", "Popup", "AA"] as const;

/**
 * Copy the annotations of a source page.
 *
 * Beyond the subtype whitelist, two things are dropped: actions other than a
 * plain URI or an in-document jump — an uploaded PDF must not be able to
 * smuggle /Launch or /JavaScript into the output — and jumps whose target page
 * was not imported, including named destinations, which would resolve against a
 * name tree that does not come along.
 */
export async function importAnnots(
  reader: PDFReader,
  copier: ObjectCopier,
  writer: PDFWriter,
  page: SourcePage,
  context: AnnotContext,
): Promise<Ref[]> {
  const list = await reader.resolve(page.dict.Annots);
  if (!Array.isArray(list)) return [];
  const out: Ref[] = [];
  for (const entry of list) {
    const dict = asDict(await reader.resolve(entry));
    if (dict === undefined) continue;
    if (!(dict.Subtype instanceof Name) || !ANNOT_SUBTYPES.has(dict.Subtype.value)) continue;
    // A /Link whose only behaviour sat in /AA (which is never copied) would come
    // through as a rectangle that does nothing. It is harmless, but a viewer
    // still shows a hover cursor over it — which reads as "the filter did not
    // work". A link without a destination has no purpose, so it goes too.
    if (isName(dict.Subtype, "Link") && dict.A === undefined && dict.Dest === undefined) continue;
    if (dict.A !== undefined && !(await isSafeAction(reader, dict.A, context))) continue;
    if (dict.Dest !== undefined && !(await isImportedDestination(reader, dict.Dest, context)))
      continue;
    // Rewritten rather than cloned: the rectangle may need transforming and
    // the back-reference to the page has to point at ours.
    const copied = await copier.copyDict(dict, ANNOT_SKIP);
    copied.P = context.pageRef;
    copied.Rect = await rect(reader, dict.Rect, context.transform);
    const quads = await quadPoints(reader, dict.QuadPoints, context.transform);
    if (quads !== undefined) copied.QuadPoints = quads;
    out.push(writer.add(copied));
  }
  return out;
}

async function isSafeAction(
  reader: PDFReader,
  value: PDFValue,
  context: AnnotContext,
): Promise<boolean> {
  const action = asDict(await reader.resolve(value));
  if (action === undefined) return false;
  if (isName(action.S, "URI")) {
    const uri = await reader.resolve(action.URI);
    const target = uri instanceof PDFString ? uri.value : null;
    return target !== null && blockedUriScheme(target) === null;
  }
  if (isName(action.S, "GoTo")) return isImportedDestination(reader, action.D, context);
  return false;
}

/** True when a destination points at a page that came along with the import. */
async function isImportedDestination(
  reader: PDFReader,
  value: PDFValue | undefined,
  context: AnnotContext,
): Promise<boolean> {
  if (value === undefined) return false;
  // A named destination resolves through the catalog's name tree, which is
  // not imported — there is nothing to point at.
  const target = value instanceof Ref ? await reader.resolve(value) : value;
  if (!Array.isArray(target) || target.length === 0) return false;
  const first = target[0];
  return first instanceof Ref && context.imported.has(first.num);
}

/** Resolve a /Rect and map it into the target page's coordinates. */
async function rect(
  reader: PDFReader,
  value: PDFValue | undefined,
  transform: Matrix | null,
): Promise<PDFValue> {
  const n = await numberArray(reader, value, 4);
  if (n === null) return [0, 0, 0, 0];
  const box: [number, number, number, number] = [n[0]!, n[1]!, n[2]!, n[3]!];
  return transform === null ? box : transformRect(transform, box);
}

/** Resolve /QuadPoints and map every point, or undefined when absent. */
async function quadPoints(
  reader: PDFReader,
  value: PDFValue | undefined,
  transform: Matrix | null,
): Promise<PDFValue | undefined> {
  if (value === undefined) return undefined;
  const resolved = await reader.resolve(value);
  if (!Array.isArray(resolved)) return undefined;
  const numbers = await numberArray(reader, resolved, resolved.length - (resolved.length % 2));
  if (numbers === null) return undefined;
  if (transform === null) return numbers;
  const out: number[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const [x, y] = applyMatrix(transform, numbers[i]!, numbers[i + 1]!);
    out.push(x, y);
  }
  return out;
}

/** Resolve an array of exactly `count` finite numbers, or null. */
async function numberArray(
  reader: PDFReader,
  value: PDFValue | undefined,
  count: number,
): Promise<number[] | null> {
  const array = await reader.resolve(value);
  if (!Array.isArray(array) || array.length < count || count <= 0) return null;
  const out: number[] = [];
  for (const entry of array.slice(0, count)) {
    const resolved = await reader.resolve(entry);
    if (typeof resolved !== "number" || !Number.isFinite(resolved)) return null;
    out.push(resolved);
  }
  return out;
}

/**
 * A page's /Resources as a direct dictionary in the output, with one extra
 * /XObject entry.
 *
 * Two things make this necessary for an overlay: a shared (inherited)
 * resources dictionary has to become this page's own before an entry can be
 * added to it, and the overlay's own resources have to stay behind a single
 * name so they cannot collide with the ones the source already uses.
 */
export async function resourcesWithOverlay(
  reader: PDFReader,
  copier: ObjectCopier,
  page: SourcePage,
  name: string,
  ref: Ref,
): Promise<PDFDict> {
  const source = asDict(await reader.resolve(page.resources));
  const copied = source === undefined ? {} : await copier.copyDict(source);
  const existing = asDict(copied.XObject);
  return { ...copied, XObject: { ...(existing ?? {}), [name]: ref } };
}
