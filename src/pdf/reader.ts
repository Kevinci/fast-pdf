/**
 * Minimal PDF reader — just enough to import pages from an existing file.
 *
 * This is the mirror image of `objects.ts`/`writer.ts`: a tokenizer for PDF
 * syntax, a cross-reference resolver (classic tables, cross-reference streams
 * and object streams) and a page-tree walk.
 *
 * Two deliberate non-goals keep it small: content streams are never decoded
 * (imported pages are copied byte-for-byte with their filters intact, so only
 * the structural streams — /XRef and /ObjStm — are ever inflated), and no
 * semantics are interpreted beyond what a page needs. Everything reachable
 * from a page dictionary is treated as an opaque object graph.
 *
 * Robustness matters more than strictness here: the input is a user upload
 * (a scan, a bank statement, something a broken generator produced), so a
 * damaged cross-reference table falls back to scanning the file for objects
 * rather than failing.
 */
import { FastPDFError } from "../errors";
import { inflate, supportsDecompression } from "./compress";
import { HexString, Name, PDFString, Ref, latin1String, type PDFValue } from "./objects";
import type { PageSize } from "../types/index";

/** A PDF dictionary as read from a file. */
export type PDFDict = { [key: string]: PDFValue | undefined };

/**
 * A stream object: its dictionary plus the raw, still-encoded bytes.
 * Streams only ever appear as indirect objects, never nested in a value,
 * so they are returned by `object()` and never by the value parser.
 */
export class PDFStream {
  constructor(
    readonly dict: PDFDict,
    readonly raw: Uint8Array,
  ) {}
}

export type PDFObject = PDFValue | PDFStream;

/** A page found in the source document, with inherited attributes resolved. */
export interface SourcePage {
  /** Reference to the page object in the *source* number space. */
  ref: Ref;
  dict: PDFDict;
  /** Effective /Resources (inherited from the page tree when absent). */
  resources: PDFValue | undefined;
  /** Visible box in source coordinates: [llx, lly, urx, ury] (CropBox ∩ MediaBox). */
  box: [number, number, number, number];
  /** /MediaBox, needed verbatim for a 1:1 copy. */
  mediaBox: [number, number, number, number];
  /** /Rotate normalized to 0, 90, 180 or 270. */
  rotate: number;
  /** Size as displayed, i.e. `box` with /Rotate applied. */
  size: PageSize;
}

/** Summary of a PDF file, without importing anything from it. */
export interface PDFInfo {
  /** PDF version from the file header, e.g. "1.7". */
  version: string;
  pageCount: number;
  /** True when the file is encrypted — such files cannot be imported. */
  encrypted: boolean;
  /** Displayed size of every page, in points. */
  pageSizes: PageSize[];
}

/** Decoded streams are bounded so a crafted "zlib bomb" cannot exhaust memory. */
const MAX_DECODED = 64 * 1024 * 1024;
/** Guard against pathologically nested arrays and dictionaries. */
const MAX_DEPTH = 128;
/** How far back from EOF to look for the `startxref` keyword. */
const TAIL = 4096;

const isWs = (b: number): boolean =>
  b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x00 || b === 0x0c;

const isDelim = (b: number): boolean =>
  b === 0x28 ||
  b === 0x29 ||
  b === 0x3c ||
  b === 0x3e ||
  b === 0x5b ||
  b === 0x5d ||
  b === 0x7b ||
  b === 0x7d ||
  b === 0x2f ||
  b === 0x25;

const isRegular = (b: number): boolean => !isWs(b) && !isDelim(b);
const isDigit = (b: number): boolean => b >= 0x30 && b <= 0x39;

function bad(message: string): never {
  throw new FastPDFError(message, "INVALID_PDF_FILE");
}

/**
 * Tokenizer over the raw file bytes.
 *
 * PDF syntax is Latin-1: one byte is one character. Positions are byte
 * offsets into the whole file, which is exactly what the cross-reference
 * table stores, so a lexer can be pointed straight at an object.
 */
class Lexer {
  pos = 0;

  constructor(readonly bytes: Uint8Array) {}

  private at(i = this.pos): number {
    return i < this.bytes.length ? this.bytes[i]! : -1;
  }

  get atEnd(): boolean {
    return this.pos >= this.bytes.length;
  }

  /** Skip whitespace and `%` comments. */
  skipWs(): void {
    for (;;) {
      while (this.pos < this.bytes.length && isWs(this.at())) this.pos++;
      if (this.at() !== 0x25) return; // '%'
      while (this.pos < this.bytes.length && this.at() !== 0x0a && this.at() !== 0x0d) this.pos++;
    }
  }

  /** Read a run of regular characters (a keyword like `obj`, `R`, `endstream`). */
  keyword(): string {
    const start = this.pos;
    while (this.pos < this.bytes.length && isRegular(this.at())) this.pos++;
    return latin1String(this.bytes.subarray(start, this.pos));
  }

  /** True when the next token is exactly `word` (consumed only on a match). */
  eatKeyword(word: string): boolean {
    this.skipWs();
    const save = this.pos;
    if (this.keyword() === word) return true;
    this.pos = save;
    return false;
  }

  /** Read an integer, or null when the next token is not one. */
  integer(): number | null {
    this.skipWs();
    const start = this.pos;
    if (this.at() === 0x2b || this.at() === 0x2d) this.pos++;
    const digits = this.pos;
    while (isDigit(this.at())) this.pos++;
    if (this.pos === digits) {
      this.pos = start;
      return null;
    }
    return parseInt(latin1String(this.bytes.subarray(start, this.pos)), 10);
  }

  private number(): number {
    const start = this.pos;
    if (this.at() === 0x2b || this.at() === 0x2d) this.pos++;
    while (isDigit(this.at()) || this.at() === 0x2e) this.pos++;
    const text = latin1String(this.bytes.subarray(start, this.pos));
    const value = parseFloat(text);
    // "4." and "-.002" are legal PDF numbers that parseFloat handles; a lone
    // sign or dot is not a number at all.
    if (!Number.isFinite(value)) bad(`Malformed number at byte ${start}`);
    return value;
  }

  private name(): Name {
    this.pos++; // '/'
    let out = "";
    while (this.pos < this.bytes.length && isRegular(this.at())) {
      const b = this.at();
      this.pos++;
      if (b === 0x23 && isHex(this.at()) && isHex(this.at(this.pos + 1))) {
        out += String.fromCharCode(
          parseInt(latin1String(this.bytes.subarray(this.pos, this.pos + 2)), 16),
        );
        this.pos += 2;
      } else {
        out += String.fromCharCode(b);
      }
    }
    // Names are UTF-8 bytes on the wire (ISO 32000-1 §7.3.5); decoding them
    // back to text keeps round-tripping through serializeName() lossless.
    return new Name(utf8OrLatin1(out));
  }

  /** Literal string: `(…)` with nested parentheses and backslash escapes. */
  private literalString(): PDFString {
    this.pos++; // '('
    let out = "";
    let depth = 1;
    while (this.pos < this.bytes.length) {
      const b = this.at();
      this.pos++;
      if (b === 0x5c) {
        // backslash
        const e = this.at();
        this.pos++;
        if (e === 0x6e) out += "\n";
        else if (e === 0x72) out += "\r";
        else if (e === 0x74) out += "\t";
        else if (e === 0x62) out += "\b";
        else if (e === 0x66) out += "\f";
        else if (e >= 0x30 && e <= 0x37) {
          let oct = e - 0x30;
          for (let i = 0; i < 2 && this.at() >= 0x30 && this.at() <= 0x37; i++) {
            oct = oct * 8 + (this.at() - 0x30);
            this.pos++;
          }
          out += String.fromCharCode(oct & 0xff);
        } else if (e === 0x0a) {
          // line continuation — nothing to emit
        } else if (e === 0x0d) {
          if (this.at() === 0x0a) this.pos++;
        } else if (e === -1) {
          break;
        } else {
          out += String.fromCharCode(e);
        }
        continue;
      }
      if (b === 0x28) depth++;
      if (b === 0x29 && --depth === 0) return new PDFString(out);
      out += String.fromCharCode(b);
    }
    bad("Unterminated string");
  }

  private hexString(): HexString {
    this.pos++; // '<'
    let hex = "";
    while (this.pos < this.bytes.length && this.at() !== 0x3e) {
      if (isHex(this.at())) hex += String.fromCharCode(this.at());
      this.pos++;
    }
    this.pos++; // '>'
    // An odd number of digits means the last byte's low nibble is zero.
    return new HexString(hex.length % 2 === 0 ? hex : hex + "0");
  }

  /** Parse one object. Streams are handled by the caller, not here. */
  value(depth = 0): PDFValue {
    if (depth > MAX_DEPTH) bad("Object nesting too deep");
    this.skipWs();
    const b = this.at();
    if (b === -1) bad("Unexpected end of file");
    if (b === 0x2f) return this.name();
    if (b === 0x28) return this.literalString();
    if (b === 0x5b) return this.array(depth);
    if (b === 0x3c) {
      return this.at(this.pos + 1) === 0x3c ? this.dict(depth) : this.hexString();
    }
    if (isDigit(b) || b === 0x2b || b === 0x2d || b === 0x2e) return this.numberOrRef();
    const word = this.keyword();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    bad(`Unexpected token "${word || String.fromCharCode(b)}" at byte ${this.pos}`);
  }

  /**
   * A number, or an indirect reference. `12 0 R` is only distinguishable from
   * three separate objects by looking ahead, which is why arrays of numbers
   * have to be parsed with this two-token lookahead.
   */
  private numberOrRef(): PDFValue {
    const start = this.pos;
    const first = this.number();
    if (Number.isInteger(first) && first >= 0) {
      const save = this.pos;
      const gen = this.integer();
      if (gen !== null && gen >= 0) {
        this.skipWs();
        if (this.at() === 0x52 && !isRegular(this.at(this.pos + 1))) {
          this.pos++; // 'R'
          return new Ref(first, gen);
        }
      }
      this.pos = save;
    }
    if (this.pos === start) bad(`Malformed number at byte ${start}`);
    return first;
  }

  private array(depth: number): PDFValue[] {
    this.pos++; // '['
    const out: PDFValue[] = [];
    for (;;) {
      this.skipWs();
      if (this.at() === 0x5d) {
        this.pos++;
        return out;
      }
      if (this.atEnd) bad("Unterminated array");
      out.push(this.value(depth + 1));
    }
  }

  dict(depth = 0): PDFDict {
    this.pos += 2; // '<<'
    const out: PDFDict = {};
    for (;;) {
      this.skipWs();
      if (this.at() === 0x3e && this.at(this.pos + 1) === 0x3e) {
        this.pos += 2;
        return out;
      }
      if (this.atEnd) bad("Unterminated dictionary");
      if (this.at() !== 0x2f) bad(`Expected a name key at byte ${this.pos}`);
      const key = this.name().value;
      out[key] = this.value(depth + 1);
    }
  }
}

const isHex = (b: number): boolean =>
  isDigit(b) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);

/** Decode a byte string as UTF-8, falling back to Latin-1 when it is not valid. */
function utf8OrLatin1(latin1: string): string {
  if (!/[\x80-\xff]/.test(latin1)) return latin1;
  const bytes = new Uint8Array(latin1.length);
  for (let i = 0; i < latin1.length; i++) bytes[i] = latin1.charCodeAt(i);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return latin1;
  }
}

/** Where an object lives: at a byte offset, or inside an object stream. */
type XrefEntry =
  { kind: "offset"; offset: number } | { kind: "instream"; stream: number; index: number };

/** Undo a PNG predictor (used by nearly every cross-reference stream). */
function unpredict(
  data: Uint8Array,
  predictor: number,
  colors: number,
  bpc: number,
  columns: number,
): Uint8Array {
  if (predictor < 2) return data;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  if (predictor === 2) {
    // TIFF predictor — only the 8-bit case is representable this simply.
    if (bpc !== 8) bad("Unsupported TIFF predictor bit depth");
    const rows = Math.floor(data.length / rowLen);
    for (let r = 0; r < rows; r++) {
      const row = r * rowLen;
      for (let i = bpp; i < rowLen; i++)
        data[row + i] = (data[row + i]! + data[row + i - bpp]!) & 0xff;
    }
    return data;
  }
  // PNG predictors: each row is prefixed with its filter type.
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)]!;
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const raw = data[src + i]!;
      const left = i >= bpp ? out[dst + i - bpp]! : 0;
      const up = prev[i]!;
      const upLeft = i >= bpp ? prev[i - bpp]! : 0;
      let value: number;
      switch (type) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          bad(`Unknown PNG predictor row filter ${type}`);
      }
      out[dst + i] = value & 0xff;
    }
    prev = out.subarray(dst, dst + rowLen);
  }
  return out;
}

export class PDFReader {
  private readonly lexer: Lexer;
  private readonly xref = new Map<number, XrefEntry>();
  private readonly cache = new Map<number, PDFObject>();
  /** objStm object number → decoded bytes and the offsets of its members. */
  private readonly objStms = new Map<
    number,
    { bytes: Uint8Array; offsets: { num: number; at: number }[] }
  >();
  /** Object numbers currently being fetched — breaks reference cycles. */
  private readonly loading = new Set<number>();
  private trailer: PDFDict = {};
  private rebuilt = false;
  private sourcePages: SourcePage[] | null = null;

  readonly version: string;

  private constructor(bytes: Uint8Array, version: string) {
    this.lexer = new Lexer(bytes);
    this.version = version;
  }

  /** Parse the cross-reference information of a PDF file. */
  static async open(bytes: Uint8Array): Promise<PDFReader> {
    // Some generators emit junk before the header; offsets are then relative
    // to the header, so the prefix is dropped rather than tolerated.
    const head = latin1String(bytes.subarray(0, Math.min(bytes.length, 1024)));
    const at = head.indexOf("%PDF-");
    if (at < 0) {
      throw new FastPDFError("Not a PDF file (no %PDF- header found)", "INVALID_PDF_FILE");
    }
    const body = at === 0 ? bytes : bytes.subarray(at);
    const version = /^%PDF-(\d+\.\d+)/.exec(latin1String(body.subarray(0, 16)))?.[1] ?? "1.7";
    const reader = new PDFReader(body, version);
    await reader.load();
    return reader;
  }

  /** True when the file is encrypted; its objects cannot be read. */
  get encrypted(): boolean {
    return this.trailer.Encrypt !== undefined;
  }

  private async load(): Promise<void> {
    const start = this.findStartxref();
    if (start !== null) {
      try {
        await this.readXrefChain(start);
      } catch {
        // A damaged table is common in the wild — recover by scanning.
        this.xref.clear();
      }
    }
    if (this.xref.size === 0 || this.trailer.Root === undefined) await this.rebuild();
  }

  /** Byte offset of the last cross-reference section, from the file trailer. */
  private findStartxref(): number | null {
    const bytes = this.lexer.bytes;
    const from = Math.max(0, bytes.length - TAIL);
    const tail = latin1String(bytes.subarray(from));
    const at = tail.lastIndexOf("startxref");
    if (at < 0) return null;
    const lexer = new Lexer(bytes);
    lexer.pos = from + at + "startxref".length;
    const offset = lexer.integer();
    return offset !== null && offset >= 0 && offset < bytes.length ? offset : null;
  }

  /** Follow the /Prev chain, newest section first (earlier entries win). */
  private async readXrefChain(offset: number): Promise<void> {
    const seen = new Set<number>();
    let next: number | null = offset;
    while (next !== null && !seen.has(next)) {
      seen.add(next);
      next = await this.readXrefSection(next, seen);
    }
  }

  /** Read one section (table or stream) and return the /Prev offset, if any. */
  private async readXrefSection(offset: number, seen: Set<number>): Promise<number | null> {
    const lexer = this.lexer;
    lexer.pos = offset;
    if (lexer.eatKeyword("xref")) {
      for (;;) {
        if (lexer.eatKeyword("trailer")) break;
        const first = lexer.integer();
        const count = lexer.integer();
        if (first === null || count === null) bad(`Malformed xref subsection at byte ${lexer.pos}`);
        for (let i = 0; i < count; i++) {
          const at = lexer.integer();
          const gen = lexer.integer();
          if (at === null || gen === null) bad("Truncated xref entry");
          const type = lexer.eatKeyword("n")
            ? "n"
            : lexer.eatKeyword("f")
              ? "f"
              : bad("Bad xref entry type");
          const num = first + i;
          if (type === "n" && !this.xref.has(num))
            this.xref.set(num, { kind: "offset", offset: at });
        }
      }
      lexer.skipWs();
      const trailer = lexer.dict();
      this.mergeTrailer(trailer);
      // Hybrid files keep newer objects in a cross-reference stream that
      // classic-only readers are meant to ignore; we want them.
      const stm = trailer.XRefStm;
      if (typeof stm === "number" && !seen.has(stm)) {
        seen.add(stm);
        try {
          await this.readXrefStreamAt(stm);
        } catch {
          // A broken hybrid stream must not invalidate the classic table.
        }
      }
      return typeof trailer.Prev === "number" ? trailer.Prev : null;
    }
    const dict = await this.readXrefStreamAt(offset);
    return typeof dict.Prev === "number" ? dict.Prev : null;
  }

  /** Read a cross-reference stream (`/Type /XRef`) at a byte offset. */
  private async readXrefStreamAt(offset: number): Promise<PDFDict> {
    const stream = this.parseIndirectAt(offset);
    if (!(stream instanceof PDFStream)) bad(`No cross-reference stream at byte ${offset}`);
    const dict = stream.dict;
    const w = this.resolveSync(dict.W);
    if (!Array.isArray(w)) bad("Cross-reference stream without /W");
    const widths = w.map((v) => (typeof v === "number" ? v : bad("Bad /W entry")));
    const size = typeof dict.Size === "number" ? dict.Size : 0;
    const indexValue = this.resolveSync(dict.Index);
    const index = Array.isArray(indexValue)
      ? indexValue.map((v) => (typeof v === "number" ? v : bad("Bad /Index entry")))
      : [0, size];
    const data = await this.decode(stream);

    const rowLen = widths.reduce((a, b) => a + b, 0);
    if (rowLen === 0) bad("Cross-reference stream with zero-width rows");
    let pos = 0;
    const field = (width: number): number => {
      let value = 0;
      for (let i = 0; i < width; i++) value = value * 256 + data[pos + i]!;
      pos += width;
      return value;
    };
    for (let s = 0; s + 1 < index.length; s += 2) {
      const first = index[s]!;
      const count = index[s + 1]!;
      for (let i = 0; i < count && pos + rowLen <= data.length; i++) {
        // A zero-width type field means "type 1" (ISO 32000-1 §7.5.8.2).
        const type = widths[0] === 0 ? 1 : field(widths[0]!);
        const f2 = field(widths[1]!);
        const f3 = field(widths[2]!);
        const num = first + i;
        if (this.xref.has(num)) continue;
        if (type === 1) this.xref.set(num, { kind: "offset", offset: f2 });
        else if (type === 2) this.xref.set(num, { kind: "instream", stream: f2, index: f3 });
      }
    }
    this.mergeTrailer(dict);
    return dict;
  }

  /** Keep the newest value for every trailer key (sections are read newest first). */
  private mergeTrailer(dict: PDFDict): void {
    for (const key of ["Root", "Info", "Encrypt", "ID", "Size"]) {
      if (this.trailer[key] === undefined && dict[key] !== undefined) this.trailer[key] = dict[key];
    }
  }

  /**
   * Last resort: scan the whole file for `N G obj` and rebuild the table.
   * Later definitions win, matching how incremental updates supersede
   * earlier revisions of an object.
   */
  private async rebuild(): Promise<void> {
    if (this.rebuilt) return;
    this.rebuilt = true;
    this.cache.clear();
    this.objStms.clear();
    const text = latin1String(this.lexer.bytes);
    const pattern = /(\d+)[\x00\t\f\r\n ]+(\d+)[\x00\t\f\r\n ]+obj\b/g;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      // Reject a match that starts mid-number ("12 0 obj" inside "912 0 obj").
      const before = m.index > 0 ? text.charCodeAt(m.index - 1) : 0x20;
      if (isDigit(before)) continue;
      const num = parseInt(m[1]!, 10);
      // An object-stream entry always wins: scanning only finds top-level
      // objects, so overwriting one would resurrect the superseded revision of
      // an object that a later update moved into a stream.
      if (this.xref.get(num)?.kind === "instream") continue;
      this.xref.set(num, { kind: "offset", offset: m.index });
    }
    if (this.trailer.Root === undefined) {
      // Prefer a real trailer; otherwise look for the catalog itself.
      const trailers = [...text.matchAll(/trailer/g)].map((m) => m.index);
      for (const at of trailers.reverse()) {
        try {
          const lexer = new Lexer(this.lexer.bytes);
          lexer.pos = at + "trailer".length;
          lexer.skipWs();
          const dict = lexer.dict();
          if (dict.Root !== undefined) {
            this.mergeTrailer(dict);
            break;
          }
        } catch {
          continue;
        }
      }
    }
    if (this.trailer.Root === undefined) {
      for (const num of this.xref.keys()) {
        const obj = await this.object(num);
        const dict = obj instanceof PDFStream ? undefined : asDict(obj);
        if (dict !== undefined && isName(dict.Type, "Catalog")) {
          this.trailer.Root = new Ref(num);
          break;
        }
        if (dict !== undefined && isName(dict.Type, "XRef") && dict.Root !== undefined) {
          this.trailer.Root = dict.Root;
        }
      }
    }
  }

  /** Parse `N G obj … endobj` at a byte offset. */
  private parseIndirectAt(offset: number): PDFObject {
    const lexer = this.lexer;
    lexer.pos = offset;
    const num = lexer.integer();
    const gen = lexer.integer();
    if (num === null || gen === null || !lexer.eatKeyword("obj")) {
      bad(`No indirect object at byte ${offset}`);
    }
    const value = lexer.value();
    if (!lexer.eatKeyword("stream")) return value;
    const dict = asDict(value);
    if (dict === undefined) bad(`Stream at byte ${offset} without a dictionary`);
    // The `stream` keyword is followed by CRLF or LF — never CR alone.
    if (lexer.bytes[lexer.pos] === 0x0d) lexer.pos++;
    if (lexer.bytes[lexer.pos] === 0x0a) lexer.pos++;
    const start = lexer.pos;
    const declared = this.resolveSync(dict.Length);
    let end = -1;
    if (typeof declared === "number" && declared >= 0 && start + declared <= lexer.bytes.length) {
      const after = new Lexer(lexer.bytes);
      after.pos = start + declared;
      if (after.eatKeyword("endstream")) end = start + declared;
    }
    if (end < 0) {
      // A wrong or indirect-and-unreachable /Length is common; find the
      // keyword instead and drop the EOL that precedes it.
      end = indexOfBytes(lexer.bytes, "endstream", start);
      if (end < 0) bad(`Unterminated stream at byte ${offset}`);
      if (lexer.bytes[end - 1] === 0x0a) end--;
      if (lexer.bytes[end - 1] === 0x0d) end--;
    }
    return new PDFStream(dict, lexer.bytes.subarray(start, end));
  }

  /** Fetch an indirect object by number. Missing objects read as null. */
  async object(num: number): Promise<PDFObject> {
    const hit = this.cache.get(num);
    if (hit !== undefined) return hit;
    if (this.loading.has(num)) return null; // reference cycle
    const entry = this.xref.get(num);
    if (entry === undefined) {
      if (this.rebuilt) return null;
      await this.rebuild();
      return this.xref.has(num) ? this.object(num) : null;
    }
    this.loading.add(num);
    try {
      let value: PDFObject;
      if (entry.kind === "offset") {
        try {
          value = this.parseIndirectAt(entry.offset);
        } catch (error) {
          if (this.rebuilt) throw error;
          // Offsets can be stale (a file edited without updating the table).
          await this.rebuild();
          this.loading.delete(num);
          return this.object(num);
        }
      } else {
        value = await this.fromObjectStream(entry.stream, entry.index, num);
      }
      this.cache.set(num, value);
      return value;
    } finally {
      this.loading.delete(num);
    }
  }

  /** Read one member of an object stream (`/Type /ObjStm`). */
  private async fromObjectStream(
    streamNum: number,
    index: number,
    wanted: number,
  ): Promise<PDFObject> {
    let parsed = this.objStms.get(streamNum);
    if (parsed === undefined) {
      const stream = await this.object(streamNum);
      if (!(stream instanceof PDFStream)) bad(`Object stream ${streamNum} is missing`);
      const bytes = await this.decode(stream);
      const count = this.resolveSync(stream.dict.N);
      const first = this.resolveSync(stream.dict.First);
      if (typeof count !== "number" || typeof first !== "number")
        bad("Object stream without /N and /First");
      const header = new Lexer(bytes);
      const offsets: { num: number; at: number }[] = [];
      for (let i = 0; i < count; i++) {
        const num = header.integer();
        const at = header.integer();
        if (num === null || at === null) break;
        offsets.push({ num, at: first + at });
      }
      parsed = { bytes, offsets };
      this.objStms.set(streamNum, parsed);
    }
    // The index is authoritative, but a wrong one is recoverable by number.
    const entry =
      parsed.offsets[index]?.num === wanted
        ? parsed.offsets[index]
        : parsed.offsets.find((o) => o.num === wanted);
    if (entry === undefined) return null;
    const lexer = new Lexer(parsed.bytes);
    lexer.pos = entry.at;
    return lexer.value();
  }

  /** Decode a structural stream (/XRef, /ObjStm) — FlateDecode only. */
  private async decode(stream: PDFStream): Promise<Uint8Array> {
    const filters = asArray(this.resolveSync(stream.dict.Filter));
    const parmsList = asArray(this.resolveSync(stream.dict.DecodeParms));
    let data = stream.raw;
    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      if (!(filter instanceof Name)) bad("Malformed /Filter entry");
      if (filter.value !== "FlateDecode" && filter.value !== "Fl") {
        throw new FastPDFError(
          `Unsupported filter /${filter.value} on a structural stream`,
          "UNSUPPORTED_PDF",
        );
      }
      if (!supportsDecompression()) {
        throw new FastPDFError(
          "Reading this PDF needs DecompressionStream, which this runtime does not provide",
          "DECOMPRESSION_UNSUPPORTED",
        );
      }
      try {
        data = await inflate(data, MAX_DECODED);
      } catch (error) {
        if (error instanceof FastPDFError) throw error;
        bad(`Could not inflate a stream: ${(error as Error).message}`);
      }
      const parms = asDict(this.resolveSync(parmsList[i]));
      if (parms !== undefined) {
        const num = (key: string, fallback: number): number => {
          const value = this.resolveSync(parms[key]);
          return typeof value === "number" ? value : fallback;
        };
        data = unpredict(
          data,
          num("Predictor", 1),
          num("Colors", 1),
          num("BitsPerComponent", 8),
          num("Columns", 1),
        );
      }
    }
    return data;
  }

  /**
   * Resolve a reference. Only safe for values whose target is a plain object
   * at a byte offset (lengths, boxes, /W) — those are parsed synchronously,
   * which is what the tokenizer and stream reader need mid-parse.
   */
  private resolveSync(value: PDFValue | undefined): PDFValue | undefined {
    if (!(value instanceof Ref)) return value;
    const cached = this.cache.get(value.num);
    if (cached !== undefined) return cached instanceof PDFStream ? undefined : cached;
    const entry = this.xref.get(value.num);
    if (entry === undefined || entry.kind !== "offset") return undefined;
    const save = this.lexer.pos;
    try {
      const parsed = this.parseIndirectAt(entry.offset);
      return parsed instanceof PDFStream ? undefined : parsed;
    } catch {
      return undefined;
    } finally {
      this.lexer.pos = save;
    }
  }

  /** Follow references until a direct value is reached. */
  async resolve(value: PDFValue | undefined): Promise<PDFObject | undefined> {
    let current: PDFObject | undefined = value;
    for (let i = 0; i < 32 && current instanceof Ref; i++) {
      current = await this.object(current.num);
    }
    return current instanceof Ref ? undefined : current;
  }

  private async resolveDict(value: PDFValue | undefined): Promise<PDFDict | undefined> {
    const resolved = await this.resolve(value);
    if (resolved instanceof PDFStream) return resolved.dict;
    return asDict(resolved);
  }

  /** Every page of the document, in reading order, with inheritance applied. */
  async pages(): Promise<SourcePage[]> {
    if (this.sourcePages !== null) return this.sourcePages;
    if (this.encrypted) {
      throw new FastPDFError(
        "This PDF is encrypted — fast-pdf cannot import pages from encrypted files. Remove the protection first.",
        "ENCRYPTED_PDF",
      );
    }
    const out: SourcePage[] = [];
    const catalog = await this.resolveDict(this.trailer.Root);
    const root = catalog?.Pages;
    if (root instanceof Ref) {
      await this.walk(root, {}, out, new Set());
    }
    if (out.length === 0) out.push(...(await this.scanForPages()));
    if (out.length === 0) {
      throw new FastPDFError("This PDF contains no readable pages", "INVALID_PDF_FILE");
    }
    this.sourcePages = out;
    return out;
  }

  /** Recursive page-tree walk. Inheritable attributes flow down into `inherited`. */
  private async walk(
    ref: Ref,
    inherited: PDFDict,
    out: SourcePage[],
    seen: Set<number>,
  ): Promise<void> {
    if (seen.has(ref.num) || out.length > 20000) return;
    seen.add(ref.num);
    const dict = await this.resolveDict(ref);
    if (dict === undefined) return;
    const own: PDFDict = { ...inherited };
    for (const key of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
      if (dict[key] !== undefined) own[key] = dict[key];
    }
    const kids = await this.resolve(dict.Kids);
    // /Type is often missing in hand-written files — /Kids decides.
    if (Array.isArray(kids) && !isName(dict.Type, "Page")) {
      for (const kid of kids) {
        if (kid instanceof Ref) await this.walk(kid, own, out, seen);
      }
      return;
    }
    if (isName(dict.Type, "Pages")) return; // a /Pages node with no usable /Kids
    out.push(await this.describePage(ref, dict, own));
  }

  /** Build a SourcePage from a page dictionary plus its inherited attributes. */
  private async describePage(ref: Ref, dict: PDFDict, inherited: PDFDict): Promise<SourcePage> {
    const mediaBox = (await this.box(dict.MediaBox ?? inherited.MediaBox)) ?? [0, 0, 612, 792];
    const crop = await this.box(dict.CropBox ?? inherited.CropBox);
    // The crop box is only meaningful where it overlaps the media box.
    const box: [number, number, number, number] = crop
      ? [
          Math.max(mediaBox[0], Math.min(crop[0], crop[2])),
          Math.max(mediaBox[1], Math.min(crop[1], crop[3])),
          Math.min(mediaBox[2], Math.max(crop[0], crop[2])),
          Math.min(mediaBox[3], Math.max(crop[1], crop[3])),
        ]
      : mediaBox;
    if (box[2] - box[0] <= 0 || box[3] - box[1] <= 0) {
      box[0] = mediaBox[0];
      box[1] = mediaBox[1];
      box[2] = mediaBox[2];
      box[3] = mediaBox[3];
    }
    const rotateValue = await this.resolve(dict.Rotate ?? inherited.Rotate);
    const raw = typeof rotateValue === "number" ? Math.round(rotateValue / 90) * 90 : 0;
    const rotate = ((raw % 360) + 360) % 360;
    const width = box[2] - box[0];
    const height = box[3] - box[1];
    const swapped = rotate === 90 || rotate === 270;
    return {
      ref,
      dict,
      resources: dict.Resources ?? inherited.Resources,
      box,
      mediaBox,
      rotate,
      size: { width: swapped ? height : width, height: swapped ? width : height },
    };
  }

  /** Normalize a rectangle: four resolved numbers, lower-left first. */
  private async box(value: PDFValue | undefined): Promise<[number, number, number, number] | null> {
    const array = await this.resolve(value);
    if (!Array.isArray(array) || array.length < 4) return null;
    const n: number[] = [];
    for (const entry of array.slice(0, 4)) {
      const resolved = await this.resolve(entry);
      if (typeof resolved !== "number" || !Number.isFinite(resolved)) return null;
      n.push(resolved);
    }
    return [
      Math.min(n[0]!, n[2]!),
      Math.min(n[1]!, n[3]!),
      Math.max(n[0]!, n[2]!),
      Math.max(n[1]!, n[3]!),
    ];
  }

  /** The content streams of a page, in order. */
  async contents(page: SourcePage): Promise<PDFStream[]> {
    const value = await this.resolve(page.dict.Contents);
    const out: PDFStream[] = [];
    if (value instanceof PDFStream) return [value];
    if (Array.isArray(value)) {
      for (const entry of value) {
        const stream = await this.resolve(entry);
        if (stream instanceof PDFStream) out.push(stream);
      }
    }
    return out;
  }

  /**
   * Decode a content stream. Unlike the structural streams this is optional
   * work — a page copied 1:1 keeps its bytes — so an exotic filter is a
   * recoverable condition, reported with the code `UNSUPPORTED_PDF`.
   */
  async decoded(stream: PDFStream): Promise<Uint8Array> {
    return this.decode(stream);
  }

  /** Fallback for a broken page tree: take every `/Type /Page` object there is. */
  private async scanForPages(): Promise<SourcePage[]> {
    await this.rebuild();
    const out: SourcePage[] = [];
    for (const num of [...this.xref.keys()].sort((a, b) => a - b)) {
      const obj = await this.object(num);
      if (obj instanceof PDFStream || obj === null) continue;
      const dict = asDict(obj);
      if (dict === undefined || !isName(dict.Type, "Page")) continue;
      out.push(await this.describePage(new Ref(num), dict, {}));
    }
    return out;
  }
}

/** Read a PDF's page count and page sizes without importing anything. */
export async function pdfInfo(bytes: Uint8Array): Promise<PDFInfo> {
  const reader = await PDFReader.open(bytes);
  if (reader.encrypted) {
    return { version: reader.version, pageCount: 0, encrypted: true, pageSizes: [] };
  }
  const pages = await reader.pages();
  return {
    version: reader.version,
    pageCount: pages.length,
    encrypted: false,
    pageSizes: pages.map((p) => ({ ...p.size })),
  };
}

// ── Small shared helpers ───────────────────────────────────────────────

/** Narrow a parsed value to a dictionary (arrays and wrappers are not). */
export function asDict(value: PDFValue | PDFObject | undefined): PDFDict | undefined {
  if (value === null || value === undefined || typeof value !== "object") return undefined;
  if (Array.isArray(value) || value instanceof Ref || value instanceof Name) return undefined;
  if (value instanceof PDFString || value instanceof HexString || value instanceof PDFStream)
    return undefined;
  return value as PDFDict;
}

/** Treat a single value as a one-element array (PDF allows both forms). */
export function asArray(value: PDFValue | undefined): (PDFValue | undefined)[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function isName(value: PDFValue | undefined, name: string): boolean {
  return value instanceof Name && value.value === name;
}

/** Index of an ASCII needle in a byte array, or -1. */
function indexOfBytes(bytes: Uint8Array, needle: string, from: number): number {
  const first = needle.charCodeAt(0);
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}
