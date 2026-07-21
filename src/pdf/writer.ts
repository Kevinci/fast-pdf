import {
  latin1Bytes,
  serialize,
  HexString,
  PDFString,
  Name,
  bytesToHex,
  hexToBytes,
  type PDFValue,
  Ref,
} from "./objects";

/**
 * PDFWriter — indirect object registry and file assembly.
 *
 * Object bodies are held as structured values and serialized only in
 * finalize(). Deferring serialization gives encryption a single choke point:
 * every string and stream is encrypted there, so no call site can forget to
 * protect a string it emits.
 *
 * finalize() lays out the file, computes exact byte offsets for the
 * cross-reference table and appends the trailer (with a content-derived /ID).
 */

type Body =
  | { kind: "value"; value: PDFValue }
  | { kind: "stream"; dict: Record<string, PDFValue | undefined>; data: Uint8Array }
  | { kind: "raw"; bytes: Uint8Array };

/** Hooks that turn on document encryption during finalize(). */
export interface Encryptor {
  /** Object number of the /Encrypt dictionary — its own strings are never encrypted. */
  exemptObject: number;
  /** Encrypt one string or stream payload (prepends a fresh random IV). */
  encrypt(data: Uint8Array): Promise<Uint8Array>;
}

/**
 * A 128-bit content digest of the assembled file body, rendered as 32 hex
 * digits. Four independent FNV-1a lanes (distinct odd multipliers) are folded
 * over every byte. This is an identifier, not a cryptographic hash: its only
 * contract is that identical content yields an identical value, so the file
 * `/ID` — and therefore the whole document — is byte-stable for byte-stable
 * input. Callers that need integrity should hash the finished file themselves.
 */
function contentDigest(chunks: Uint8Array[]): string {
  const lanes = [0x811c9dc5, 0xdeadbeef, 0x9e3779b9, 0x85ebca6b];
  const mult = [0x01000193, 0x01000195, 0x01000197, 0x01000199];
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]!;
      for (let l = 0; l < 4; l++) {
        lanes[l] = Math.imul((lanes[l]! ^ b) >>> 0, mult[l]!) >>> 0;
      }
    }
  }
  return lanes.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

/** Deep-clone a value, replacing every string leaf with its encrypted form. */
async function encryptStrings(value: PDFValue, encrypt: (d: Uint8Array) => Promise<Uint8Array>): Promise<PDFValue> {
  if (value instanceof PDFString) {
    return new HexString(bytesToHex(await encrypt(latin1Bytes(value.value))));
  }
  if (value instanceof HexString) {
    return new HexString(bytesToHex(await encrypt(hexToBytes(value.value))));
  }
  if (Array.isArray(value)) {
    const out: PDFValue[] = [];
    for (const item of value) out.push(await encryptStrings(item, encrypt));
    return out;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Ref) && !(value instanceof Name)) {
    const out: { [key: string]: PDFValue } = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = await encryptStrings(v, encrypt);
    }
    return out;
  }
  return value;
}

export class PDFWriter {
  /** Object bodies indexed by object number (index 0 unused — object 0 is the free head). */
  private bodies: (Body | null)[] = [null];

  /** Allocate an object number without a body yet (for circular references). */
  reserve(): Ref {
    this.bodies.push(null);
    return new Ref(this.bodies.length - 1);
  }

  /** Provide the body for a previously reserved object. */
  fill(ref: Ref, body: PDFValue | Uint8Array): void {
    if (this.bodies[ref.num] != null) {
      throw new Error(`Object ${ref.num} already written`);
    }
    this.bodies[ref.num] =
      body instanceof Uint8Array ? { kind: "raw", bytes: body } : { kind: "value", value: body };
  }

  /** Register a complete object and return its reference. */
  add(body: PDFValue | Uint8Array): Ref {
    const ref = this.reserve();
    this.fill(ref, body);
    return ref;
  }

  /** Register a stream object (dict + raw data). The /Length entry is added automatically. */
  addStream(dict: Record<string, PDFValue | undefined>, data: Uint8Array): Ref {
    const ref = this.reserve();
    this.fillStream(ref, dict, data);
    return ref;
  }

  fillStream(ref: Ref, dict: Record<string, PDFValue | undefined>, data: Uint8Array): void {
    if (this.bodies[ref.num] != null) {
      throw new Error(`Object ${ref.num} already written`);
    }
    this.bodies[ref.num] = { kind: "stream", dict, data };
  }

  /** Serialize one object body to its final bytes, applying encryption when active. */
  private async serializeBody(num: number, body: Body, enc?: Encryptor): Promise<Uint8Array> {
    const encryptThis = enc !== undefined && num !== enc.exemptObject;
    if (body.kind === "raw") return body.bytes;
    if (body.kind === "value") {
      const value = encryptThis ? await encryptStrings(body.value, enc!.encrypt) : body.value;
      return latin1Bytes(serialize(value));
    }
    // stream
    const dict = encryptThis
      ? ((await encryptStrings(body.dict as PDFValue, enc!.encrypt)) as Record<string, PDFValue | undefined>)
      : body.dict;
    const data = encryptThis ? await enc!.encrypt(body.data) : body.data;
    const head = latin1Bytes(serialize({ ...dict, Length: data.length }) + "\nstream\n");
    const tail = latin1Bytes("\nendstream");
    const out = new Uint8Array(head.length + data.length + tail.length);
    out.set(head, 0);
    out.set(data, head.length);
    out.set(tail, head.length + data.length);
    return out;
  }

  /** Assemble the final PDF file. */
  async finalize(root: Ref, info?: Ref, enc?: Encryptor): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    const push = (bytes: Uint8Array) => {
      chunks.push(bytes);
      offset += bytes.length;
    };

    // Header + binary marker comment (bytes > 0x80 so transfers treat the file as binary).
    push(latin1Bytes("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"));

    const offsets: number[] = [0];
    for (let num = 1; num < this.bodies.length; num++) {
      const body = this.bodies[num];
      if (body === null || body === undefined) {
        throw new Error(`Object ${num} was reserved but never written`);
      }
      offsets.push(offset);
      push(latin1Bytes(`${num} 0 obj\n`));
      push(await this.serializeBody(num, body, enc));
      push(latin1Bytes("\nendobj\n"));
    }

    const xrefOffset = offset;
    const size = this.bodies.length;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let num = 1; num < size; num++) {
      xref += `${String(offsets[num]).padStart(10, "0")} 00000 n \n`;
    }
    // File identifier, derived from the body so it is stable for stable input.
    // Both array entries are equal for a freshly created file (the first is the
    // permanent id, the second is updated on incremental change — see ISO 32000-1 §7.5.5).
    const id = new HexString(contentDigest(chunks));
    const trailer: Record<string, PDFValue | undefined> = {
      Size: size,
      Root: root,
      Info: info,
      Encrypt: enc !== undefined ? new Ref(enc.exemptObject) : undefined,
      ID: [id, id],
    };
    xref += `trailer\n${serialize(trailer)}\nstartxref\n${xrefOffset}\n%%EOF\n`;
    push(latin1Bytes(xref));

    const out = new Uint8Array(offset);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
}
