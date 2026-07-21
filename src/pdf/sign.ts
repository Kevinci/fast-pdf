/**
 * Detached PAdES-B (CAdES) digital signatures.
 *
 * Builds a CMS SignedData structure by hand (DER via asn1.ts) and signs the
 * document digest with RSASSA-PKCS1-v1_5 + SHA-256 through the Web Crypto API
 * — no Node built-ins, no dependency. The signer certificate is embedded and
 * bound to the signature via the ESS signing-certificate-v2 attribute, which
 * is what raises a plain CMS signature to a PAdES-B baseline profile.
 *
 * The document itself is signed in two passes by the caller: render with
 * fixed-width /ByteRange and /Contents placeholders, then splice the real
 * values in (see prepareSignature / embedSignature).
 */
import { FastPDFError } from "../errors";
import {
  concatBytes,
  seq,
  set,
  setOf,
  octetString,
  nullValue,
  integer,
  oid,
  utcTime,
  contextConstructed,
  tlv,
  children,
  elementBytes,
  readTLV,
} from "./asn1";
import { latin1Bytes, bytesToHex } from "./objects";

export interface SigningOptions {
  /** Signer private key as an unencrypted PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----"). */
  privateKeyPem: string;
  /** Signer certificate as an X.509 PEM ("-----BEGIN CERTIFICATE-----"). */
  certificatePem: string;
  /** Optional reason, e.g. "I approve this document". */
  reason?: string;
  /** Optional signing location. */
  location?: string;
  /** Optional signer contact info. */
  contactInfo?: string;
  /** Signing time. Defaults to the current time. */
  signingTime?: Date;
}

// OIDs used in CMS / CAdES.
const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_RSA = "1.2.840.113549.1.1.1";
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";
const OID_SIGNING_CERT_V2 = "1.2.840.113549.1.9.16.2.47";

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) {
    throw new FastPDFError("Signing requires the Web Crypto API, which this runtime does not provide", "ENCRYPTION_UNSUPPORTED");
  }
  return c.subtle;
}

const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

/** Decode base64 (no line breaks) to bytes, without relying on Buffer. */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    if (ch === "=") break;
    const v = chars.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Extract the DER bytes carried by a PEM block with the given label. */
function pemToDer(pem: string, label: string): Uint8Array {
  const re = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`);
  const m = re.exec(pem);
  if (!m) throw new FastPDFError(`No "${label}" PEM block found`, "INVALID_ARGUMENT");
  return base64ToBytes(m[1]!);
}

/**
 * Pull the raw DER of the issuer Name and the serialNumber INTEGER out of an
 * X.509 certificate, for the CMS IssuerAndSerialNumber signer identifier.
 */
function issuerAndSerial(certDer: Uint8Array): Uint8Array {
  const tbs = children(certDer, 0)[0]!; // tbsCertificate
  const fields = children(certDer, tbs.start);
  // tbsCertificate: [ [0] version? , serialNumber, signature, issuer, ... ]
  let idx = 0;
  if (fields[idx]!.tag === 0xa0) idx++; // optional explicit version
  const serial = elementBytes(certDer, fields[idx]!.start); // serialNumber INTEGER
  idx += 2; // skip serialNumber and signature AlgorithmIdentifier
  const issuer = elementBytes(certDer, fields[idx]!.start); // issuer Name
  return seq(issuer, serial);
}

const sha256Algo = () => seq(oid(OID_SHA256)); // AlgorithmIdentifier, params absent for SHA-256

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", bs(data)));
}

function attribute(typeOid: string, value: Uint8Array): Uint8Array {
  return seq(oid(typeOid), set(value));
}

/**
 * Assemble the CMS SignedData (a detached PAdES-B signature) over `digest`,
 * the SHA-256 of the document's signed byte ranges. Returns DER bytes.
 */
async function buildCMS(digest: Uint8Array, opts: SigningOptions): Promise<Uint8Array> {
  const certDer = pemToDer(opts.certificatePem, "CERTIFICATE");
  const keyDer = pemToDer(opts.privateKeyPem, "PRIVATE KEY");
  const key = await subtle().importKey(
    "pkcs8",
    bs(keyDer),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // ESS signing-certificate-v2: SEQ { SEQ OF ESSCertIDv2 { OCTET STRING certHash } }.
  // The SHA-256 hashAlgorithm is the default and is omitted.
  const certHash = await sha256(certDer);
  const signingCertV2 = seq(seq(seq(octetString(certHash))));

  const signingTime = opts.signingTime ?? new Date();
  // Signed attributes (DER SET OF, sorted).
  const signedAttrs = [
    attribute(OID_CONTENT_TYPE, oid(OID_DATA)),
    attribute(OID_SIGNING_TIME, utcTime(signingTime)),
    attribute(OID_MESSAGE_DIGEST, octetString(digest)),
    attribute(OID_SIGNING_CERT_V2, signingCertV2),
  ];
  const attrsContent = setOf(signedAttrs); // 0x31 ... — this exact encoding is what gets signed

  const signature = new Uint8Array(await subtle().sign({ name: "RSASSA-PKCS1-v1_5" }, key, bs(attrsContent)));

  // In the SignerInfo the attributes are carried as [0] IMPLICIT, i.e. the same
  // content bytes under tag 0xA0 instead of 0x31.
  const signedAttrsImplicit = tlv(0xa0, attrsContent.subarray(readTLV(attrsContent, 0).contentStart));

  const signerInfo = seq(
    integer(1), // version (issuerAndSerialNumber)
    issuerAndSerial(certDer),
    sha256Algo(), // digestAlgorithm
    signedAttrsImplicit,
    seq(oid(OID_RSA), nullValue()), // signatureAlgorithm (rsaEncryption)
    octetString(signature),
  );

  const signedData = seq(
    integer(1), // version
    setOf([sha256Algo()]), // digestAlgorithms
    seq(oid(OID_DATA)), // encapContentInfo — detached, no eContent
    contextConstructed(0, elementBytes(certDer, 0)), // [0] IMPLICIT certificates
    setOf([signerInfo]), // signerInfos
  );

  return seq(oid(OID_SIGNED_DATA), contextConstructed(0, signedData));
}

// Placeholder sizing. /Contents must be wide enough for the DER signature; the
// three /ByteRange numbers are fixed-width so the layout is known before the
// real offsets are computed.
const CONTENTS_HEX_LEN = 16384; // 8192 bytes — ample for RSA-4096 + certificate
const BR = "0000000000"; // 10-digit zero-padded ByteRange placeholder

/** The raw serialized bytes of the signature dictionary, with placeholders. */
export function signaturePlaceholder(opts: SigningOptions): Uint8Array {
  // Validate the PEM up front so a bad key fails before rendering.
  pemToDer(opts.certificatePem, "CERTIFICATE");
  pemToDer(opts.privateKeyPem, "PRIVATE KEY");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const time = opts.signingTime ?? new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const m =
    `D:${time.getUTCFullYear()}${p(time.getUTCMonth() + 1)}${p(time.getUTCDate())}` +
    `${p(time.getUTCHours())}${p(time.getUTCMinutes())}${p(time.getUTCSeconds())}Z`;
  let dict =
    `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached` +
    ` /ByteRange [0 ${BR} ${BR} ${BR}]` +
    ` /Contents <${"0".repeat(CONTENTS_HEX_LEN)}>` +
    ` /M (${m})`;
  if (opts.reason !== undefined) dict += ` /Reason (${esc(opts.reason)})`;
  if (opts.location !== undefined) dict += ` /Location (${esc(opts.location)})`;
  if (opts.contactInfo !== undefined) dict += ` /ContactInfo (${esc(opts.contactInfo)})`;
  dict += " >>";
  return latin1Bytes(dict);
}

/**
 * Second pass: given the fully rendered file (with placeholders), fill in the
 * /ByteRange, sign the covered bytes and splice the CMS into /Contents.
 * Mutates and returns `file`.
 */
export async function embedSignature(file: Uint8Array, opts: SigningOptions): Promise<Uint8Array> {
  // Locate the /Contents hex placeholder (the long run of zeros between < >).
  const needle = latin1Bytes(`/Contents <`);
  const cStart = indexOfBytes(file, needle);
  if (cStart < 0) throw new FastPDFError("signature placeholder not found", "INTERNAL");
  const hexStart = cStart + needle.length;
  const hexEnd = hexStart + CONTENTS_HEX_LEN; // position of the closing '>'
  const gapStart = hexStart - 1; // the '<'
  const gapEnd = hexEnd + 1; // just past the '>'

  // ByteRange = [0, gapStart, gapEnd, len - gapEnd] — everything but the gap.
  const range = [0, gapStart, gapEnd, file.length - gapEnd];
  writeByteRange(file, range);

  // Digest the two signed ranges (the gap holding /Contents is excluded).
  const signed = concatBytes([file.subarray(0, gapStart), file.subarray(gapEnd)]);
  const digest = await sha256(signed);
  const cms = await buildCMS(digest, opts);

  const hex = bytesToHex(cms);
  if (hex.length > CONTENTS_HEX_LEN) {
    throw new FastPDFError("signature too large for the reserved /Contents space", "INTERNAL");
  }
  // Write the DER hex, zero-padded to the reserved width.
  const padded = hex + "0".repeat(CONTENTS_HEX_LEN - hex.length);
  for (let i = 0; i < CONTENTS_HEX_LEN; i++) file[hexStart + i] = padded.charCodeAt(i);
  return file;
}

/** Overwrite the fixed-width /ByteRange placeholder with the real offsets. */
function writeByteRange(file: Uint8Array, range: number[]): void {
  const marker = latin1Bytes("/ByteRange [0 ");
  const at = indexOfBytes(file, marker);
  if (at < 0) throw new FastPDFError("ByteRange placeholder not found", "INTERNAL");
  // Layout: "/ByteRange [0 dddddddddd dddddddddd dddddddddd]"
  let pos = at + marker.length;
  for (let k = 1; k < 4; k++) {
    const digits = String(range[k]!).padStart(10, "0");
    for (let i = 0; i < 10; i++) file[pos + i] = digits.charCodeAt(i);
    pos += 10 + 1; // field width + single space separator
  }
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
