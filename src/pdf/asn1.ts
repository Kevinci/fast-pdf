/**
 * Minimal ASN.1 DER encoder and reader — just enough to build a CMS
 * SignedData structure for PAdES/CAdES signatures and to pick the issuer and
 * serial number out of an X.509 certificate. Not a general ASN.1 library.
 *
 * DER is used (not BER): definite lengths, and SET OF members sorted by their
 * encoding, as CMS signed attributes require.
 */

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** DER length octets for a content length. */
function lengthBytes(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const out: number[] = [];
  let v = n;
  while (v > 0) {
    out.unshift(v & 0xff);
    v >>>= 8;
  }
  return new Uint8Array([0x80 | out.length, ...out]);
}

/** Encode a single TLV: tag byte, DER length, content. */
export function tlv(tag: number, content: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([tag]), lengthBytes(content.length), content]);
}

export const seq = (...items: Uint8Array[]): Uint8Array => tlv(0x30, concatBytes(items));

/** SET OF with DER ordering (members sorted lexicographically by their encoding). */
export function setOf(items: Uint8Array[]): Uint8Array {
  const sorted = [...items].sort(compareBytes);
  return tlv(0x31, concatBytes(sorted));
}

/** Plain SET (order preserved) — for the single-value attribute SETs. */
export const set = (...items: Uint8Array[]): Uint8Array => tlv(0x31, concatBytes(items));

export const octetString = (content: Uint8Array): Uint8Array => tlv(0x04, content);

export const nullValue = (): Uint8Array => new Uint8Array([0x05, 0x00]);

/** Context-specific constructed tag [n] wrapping content (e.g. [0] EXPLICIT). */
export const contextConstructed = (n: number, content: Uint8Array): Uint8Array => tlv(0xa0 | n, content);

/** Small unsigned INTEGER (used for version fields). */
export function integer(n: number): Uint8Array {
  const out: number[] = [];
  let v = n;
  do {
    out.unshift(v & 0xff);
    v >>>= 8;
  } while (v > 0);
  if (out[0]! & 0x80) out.unshift(0x00); // keep it positive
  return tlv(0x02, new Uint8Array(out));
}

/** Encode a dotted OID string into a DER OBJECT IDENTIFIER. */
export function oid(dotted: string): Uint8Array {
  const parts = dotted.split(".").map(Number);
  const body: number[] = [40 * parts[0]! + parts[1]!];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i]!;
    const chunk: number[] = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    body.push(...chunk);
  }
  return tlv(0x06, new Uint8Array(body));
}

/** ASN.1 UTCTime "YYMMDDhhmmssZ" (UTC). */
export function utcTime(date: Date): Uint8Array {
  const p = (n: number) => String(n).padStart(2, "0");
  const s =
    p(date.getUTCFullYear() % 100) +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds()) +
    "Z";
  return tlv(0x17, new Uint8Array([...s].map((c) => c.charCodeAt(0))));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

// ── Minimal DER reader (for extracting fields from a certificate) ──

export interface TLV {
  tag: number;
  /** Offset of the tag byte (start of the whole element). */
  start: number;
  /** Offset of the content (after tag + length octets). */
  contentStart: number;
  /** Content length in bytes. */
  length: number;
  /** Offset just past this TLV. */
  end: number;
}

/** Read one TLV header starting at `offset`. */
export function readTLV(bytes: Uint8Array, offset: number): TLV {
  const tag = bytes[offset]!;
  let i = offset + 1;
  let len = bytes[i]!;
  i += 1;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let j = 0; j < n; j++) len = (len << 8) | bytes[i + j]!;
    i += n;
  }
  return { tag, start: offset, contentStart: i, length: len, end: i + len };
}

/** The full TLV byte slice (tag through content) of the element at `offset`. */
export function elementBytes(bytes: Uint8Array, offset: number): Uint8Array {
  const t = readTLV(bytes, offset);
  return bytes.subarray(offset, t.end);
}

/** Iterate the immediate children of the constructed element at `offset`. */
export function children(bytes: Uint8Array, offset: number): TLV[] {
  const parent = readTLV(bytes, offset);
  const out: TLV[] = [];
  let i = parent.contentStart;
  while (i < parent.end) {
    const t = readTLV(bytes, i);
    out.push(t);
    i = t.end;
  }
  return out;
}
