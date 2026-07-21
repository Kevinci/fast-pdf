/**
 * PDF standard security handler — AES-256, revision 6 (ISO 32000-2, PDF 2.0).
 *
 * All cryptography goes through the Web Crypto API (crypto.subtle /
 * crypto.getRandomValues), available on Node >= 18, Bun, Deno, browsers and
 * edge runtimes — no Node built-ins, no third-party dependency. Only the R6
 * handler is implemented: it relies on SHA-256/384/512 and AES-256 and avoids
 * the broken RC4/MD5 primitives of the legacy handlers entirely.
 *
 * fast-pdf only ever *encrypts* (it never opens documents), so every AES call
 * here is an encryption. The no-padding variant exploits a property of CBC:
 * the leading blocks of a PKCS#7-padded ciphertext are exactly the unpadded
 * ciphertext, so we drop the trailing pad block Web Crypto always appends.
 */
import { FastPDFError } from "../errors";
import { HexString, Name, bytesToHex, type PDFValue } from "./objects";

/** Which operations a viewer is permitted to perform. All default to allowed. */
export interface DocumentPermissions {
  printing?: boolean;
  highQualityPrinting?: boolean;
  modifying?: boolean;
  copying?: boolean;
  annotating?: boolean;
  fillingForms?: boolean;
  extractingForAccessibility?: boolean;
  assembling?: boolean;
}

export interface EncryptionOptions {
  /** Password required to open the document. Empty (default) opens without a prompt. */
  userPassword?: string;
  /** Password granting full rights (bypasses permission restrictions). Defaults to userPassword. */
  ownerPassword?: string;
  /** Restrictions applied when opened with the user password. */
  permissions?: DocumentPermissions;
}

export interface SecurityHandler {
  /** The /Encrypt dictionary contents (its own strings are never encrypted). */
  dict: Record<string, PDFValue | undefined>;
  /** Encrypt one string or stream payload, prepending a fresh random IV. */
  encrypt(data: Uint8Array): Promise<Uint8Array>;
}

/** True when the runtime exposes the Web Crypto primitives this handler needs. */
export function supportsEncryption(): boolean {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return !!c && !!c.subtle && typeof c.getRandomValues === "function";
}

function subtle(): SubtleCrypto {
  if (!supportsEncryption()) {
    throw new FastPDFError(
      "Encryption requires the Web Crypto API, which this runtime does not provide",
      "ENCRYPTION_UNSUPPORTED",
    );
  }
  return (globalThis as { crypto: Crypto }).crypto.subtle;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(b);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
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

// Web Crypto's DOM types demand ArrayBuffer-backed views; our Uint8Arrays are
// always ArrayBuffer-backed at runtime, so this cast is sound.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest(`SHA-${bits}`, bs(data)));
}

/** AES-CBC encryption with NO padding; `data.length` must be a multiple of 16. */
async function aesCbcNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const ck = await subtle().importKey("raw", bs(key), "AES-CBC", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv: bs(iv) }, ck, bs(data)));
  return ct.subarray(0, data.length); // drop the PKCS#7 pad block Web Crypto appends
}

/** AES-256-CBC with a random IV and PKCS#7 padding — the AESV3 string/stream form. */
async function aesv3(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(16);
  const ck = await subtle().importKey("raw", bs(key), "AES-CBC", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv: bs(iv) }, ck, bs(data)));
  return concat(iv, ct);
}

const ZERO_IV = new Uint8Array(16);
const EMPTY = new Uint8Array(0);

/**
 * ISO 32000-2 Algorithm 2.B — the R6 password hash. Iterates SHA-2 and
 * AES-128-CBC until the mixing has run at least 64 rounds and the last
 * ciphertext byte falls under the round threshold.
 */
async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k: Uint8Array = await sha(256, concat(password, salt, udata));
  let e: Uint8Array = EMPTY;
  for (let round = 0; round < 64 || e[e.length - 1]! > round - 32; round++) {
    const block = concat(password, k, udata);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);
    e = await aesCbcNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i]!;
    const mod = sum % 3;
    k = await sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e);
  }
  return k.subarray(0, 32);
}

function passwordBytes(pw: string): Uint8Array {
  // PDF 2.0 uses the UTF-8 encoding of the password, truncated to 127 bytes.
  return new TextEncoder().encode(pw).subarray(0, 127);
}

/** Encode the permission flags as the signed 32-bit /P integer (ISO 32000-1 Table 22). */
function permissionBits(p: DocumentPermissions | undefined): number {
  const on = (v: boolean | undefined) => v !== false; // default: allowed
  // Reserved bits 7-8 and 13-32 are 1; bits 1-2 are 0.
  let bits = 0xfffff0c0;
  if (on(p?.printing)) bits |= 1 << 2; // bit 3
  if (on(p?.modifying)) bits |= 1 << 3; // bit 4
  if (on(p?.copying)) bits |= 1 << 4; // bit 5
  if (on(p?.annotating)) bits |= 1 << 5; // bit 6
  if (on(p?.fillingForms)) bits |= 1 << 8; // bit 9
  if (on(p?.extractingForAccessibility)) bits |= 1 << 9; // bit 10
  if (on(p?.assembling)) bits |= 1 << 10; // bit 11
  if (on(p?.highQualityPrinting)) bits |= 1 << 11; // bit 12
  return bits | 0; // interpret as signed 32-bit
}

/**
 * Build a standard AES-256 (R6) security handler: the /Encrypt dictionary plus
 * an `encrypt()` closure over the random 256-bit file key. Under V5 the file
 * key is used directly for every string and stream — there is no per-object
 * key derivation.
 */
export async function createSecurityHandler(opts: EncryptionOptions): Promise<SecurityHandler> {
  subtle(); // fail fast on unsupported runtimes
  if ((opts.userPassword ?? "") === "" && (opts.ownerPassword ?? "") === "") {
    throw new FastPDFError("encrypt requires a userPassword and/or ownerPassword", "INVALID_ARGUMENT");
  }
  const userPw = passwordBytes(opts.userPassword ?? "");
  const ownerPw = passwordBytes(opts.ownerPassword ?? opts.userPassword ?? "");
  const fileKey = randomBytes(32);

  const uvs = randomBytes(8);
  const uks = randomBytes(8);
  const U = concat(await hash2B(userPw, uvs, EMPTY), uvs, uks);
  const UE = await aesCbcNoPad(await hash2B(userPw, uks, EMPTY), ZERO_IV, fileKey);

  const ovs = randomBytes(8);
  const oks = randomBytes(8);
  const O = concat(await hash2B(ownerPw, ovs, U), ovs, oks);
  const OE = await aesCbcNoPad(await hash2B(ownerPw, oks, U), ZERO_IV, fileKey);

  const P = permissionBits(opts.permissions);
  // Algorithm 10 — the 16-byte Perms block, AES-256-ECB (== single-block CBC/0-IV).
  const perms = new Uint8Array(16);
  perms[0] = P & 0xff;
  perms[1] = (P >> 8) & 0xff;
  perms[2] = (P >> 16) & 0xff;
  perms[3] = (P >> 24) & 0xff;
  perms[4] = perms[5] = perms[6] = perms[7] = 0xff;
  perms[8] = 0x54; // 'T' — document metadata is encrypted
  perms[9] = 0x61; // 'a'
  perms[10] = 0x64; // 'd'
  perms[11] = 0x62; // 'b'
  perms.set(randomBytes(4), 12);
  const Perms = await aesCbcNoPad(fileKey, ZERO_IV, perms);

  const dict: Record<string, PDFValue | undefined> = {
    Filter: new Name("Standard"),
    V: 5,
    R: 6,
    Length: 256,
    CF: { StdCF: { CFM: new Name("AESV3"), AuthEvent: new Name("DocOpen"), Length: 32 } },
    StmF: new Name("StdCF"),
    StrF: new Name("StdCF"),
    U: new HexString(bytesToHex(U)),
    O: new HexString(bytesToHex(O)),
    UE: new HexString(bytesToHex(UE)),
    OE: new HexString(bytesToHex(OE)),
    P,
    Perms: new HexString(bytesToHex(Perms)),
  };

  return { dict, encrypt: (data) => aesv3(fileKey, data) };
}
