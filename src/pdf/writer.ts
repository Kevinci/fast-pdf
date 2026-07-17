import { latin1Bytes, serialize, type PDFValue, Ref } from "./objects";

/**
 * PDFWriter — indirect object registry and file assembly.
 *
 * Objects are registered as serialized bodies (everything between
 * "N 0 obj" and "endobj"). finalize() lays out the file, computes exact
 * byte offsets for the cross-reference table and appends the trailer.
 *
 * The writer is synchronous and pure; anything async (compression)
 * happens before bodies are handed in.
 */
export class PDFWriter {
  /** Object bodies indexed by object number (index 0 unused — object 0 is the free head). */
  private bodies: (Uint8Array | null)[] = [null];

  /** Allocate an object number without a body yet (for circular references). */
  reserve(): Ref {
    this.bodies.push(null);
    return new Ref(this.bodies.length - 1);
  }

  /** Provide the body for a previously reserved object. */
  fill(ref: Ref, body: PDFValue | Uint8Array): void {
    if (this.bodies[ref.num] !== null) {
      throw new Error(`Object ${ref.num} already written`);
    }
    this.bodies[ref.num] = body instanceof Uint8Array ? body : latin1Bytes(serialize(body));
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
    const head = latin1Bytes(serialize({ ...dict, Length: data.length }) + "\nstream\n");
    const tail = latin1Bytes("\nendstream");
    const body = new Uint8Array(head.length + data.length + tail.length);
    body.set(head, 0);
    body.set(data, head.length);
    body.set(tail, head.length + data.length);
    this.fill(ref, body);
  }

  /** Assemble the final PDF file. */
  finalize(root: Ref, info?: Ref): Uint8Array {
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
      push(body);
      push(latin1Bytes("\nendobj\n"));
    }

    const xrefOffset = offset;
    const size = this.bodies.length;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let num = 1; num < size; num++) {
      xref += `${String(offsets[num]).padStart(10, "0")} 00000 n \n`;
    }
    const trailer: Record<string, PDFValue | undefined> = { Size: size, Root: root, Info: info };
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
