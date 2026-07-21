/**
 * PDF object model and serializer.
 *
 * PDF is a binary format whose structural syntax is Latin-1, not UTF-8.
 * All serialization goes through latin1 encoding: one JS char code = one byte.
 * TextEncoder (UTF-8) must never touch PDF bytes.
 */
import { FastPDFError } from "../errors";

/** Reference to an indirect object ("12 0 R"). */
export class Ref {
  constructor(
    readonly num: number,
    readonly gen: number = 0,
  ) {}
}

/** A PDF name ("/Type"). */
export class Name {
  constructor(readonly value: string) {}
}

/** A PDF literal string ("(text)"). Value is latin1: one char = one byte. */
export class PDFString {
  constructor(readonly value: string) {}
}

/**
 * A PDF hexadecimal string ("<48656c6c6f>"). `value` is the already
 * hex-encoded payload (an even number of hex digits). Used where a byte
 * string is cleaner as hex than as an escaped literal, e.g. the file `/ID`.
 */
export class HexString {
  constructor(readonly value: string) {}
}

export type PDFValue =
  | number
  | boolean
  | null
  | Ref
  | Name
  | PDFString
  | HexString
  | PDFValue[]
  | { [key: string]: PDFValue | undefined };

/** Format a number the PDF way: no exponent, few decimals, no trailing zeros. */
export function fmtNumber(n: number): string {
  // Last line of defence: public entry points validate first (src/validate.ts),
  // but any number reaching the serializer must still be representable.
  if (!Number.isFinite(n)) throw new FastPDFError(`Non-finite number in PDF output: ${n}`, "INVALID_NUMBER");
  // String() switches to exponent notation at 1e21, which PDF syntax forbids.
  if (Math.abs(n) >= 1e21) throw new FastPDFError(`Number too large for PDF output: ${n}`, "INVALID_NUMBER");
  if (Number.isInteger(n)) return String(n);
  return n
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

/** Lower-case hex encoding of a byte array (two digits per byte). */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

/** Decode an even-length hex string back to bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const NAME_IRREGULAR = /[^\x21-\x7e]|[#()<>[\]{}/%]/;

function serializeName(value: string): string {
  if (!NAME_IRREGULAR.test(value)) return `/${value}`;
  // Irregular names are escaped byte-wise; non-ASCII text becomes UTF-8
  // bytes first (ISO 32000-1 §7.3.5) so every #XX escape stays two digits.
  const bytes = new TextEncoder().encode(value);
  let out = "/";
  for (const c of bytes) {
    if (c > 0x21 && c < 0x7f && !"#()<>[]{}/%".includes(String.fromCharCode(c))) {
      out += String.fromCharCode(c);
    } else {
      out += "#" + c.toString(16).padStart(2, "0").toUpperCase();
    }
  }
  return out;
}

/** Escape a latin1 string for a PDF literal string. */
export function escapeString(latin1: string): string {
  let out = "";
  for (let i = 0; i < latin1.length; i++) {
    const c = latin1.charCodeAt(i);
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += "\\" + latin1[i];
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x0a) out += "\\n";
    // Other control bytes (e.g. the high byte of 2-byte glyph IDs) as octal.
    else if (c < 0x20) out += "\\" + c.toString(8).padStart(3, "0");
    else out += latin1[i];
  }
  return out;
}

/** Serialize any PDF value to its latin1 syntax string. */
export function serialize(value: PDFValue): string {
  if (value === null) return "null";
  if (typeof value === "number") return fmtNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Ref) return `${value.num} ${value.gen} R`;
  if (value instanceof Name) return serializeName(value.value);
  if (value instanceof PDFString) return `(${escapeString(value.value)})`;
  if (value instanceof HexString) return `<${value.value}>`;
  if (Array.isArray(value)) return `[${value.map(serialize).join(" ")}]`;
  // dictionary
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    parts.push(`${serializeName(k)} ${serialize(v)}`);
  }
  return `<< ${parts.join(" ")} >>`;
}

/** Encode a latin1 string (one char = one byte) to bytes. */
export function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Decode bytes to a latin1 string (one byte = one char). */
export function latin1String(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** Encode a JS string as a PDF text string (Info/metadata). Uses UTF-16BE with BOM when needed. */
export function textString(s: string): PDFString {
  let ascii = true;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7e) {
      ascii = false;
      break;
    }
  }
  if (ascii) return new PDFString(s);
  let out = "\xfe\xff"; // UTF-16BE BOM
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += String.fromCharCode(c >> 8) + String.fromCharCode(c & 0xff);
  }
  return new PDFString(out);
}
