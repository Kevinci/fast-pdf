import { describe, expect, it } from "vitest";
import { PDFDocument } from "../src/index";
import { FastPDFError } from "../src/errors";
import { latin1String, bytesToHex, hexToBytes } from "../src/pdf/objects";
import { supportsEncryption } from "../src/pdf/encrypt";

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof FastPDFError ? e.code : `not-fastpdf:${String(e)}`;
  }
  return undefined;
};

// ── Independent reader-side reimplementation of ISO 32000-2 Algorithm 2.B ──
// This duplicates the spec's password hash from scratch (no shared code with
// src/) so the test proves interoperability, not merely self-consistency. It
// is exactly what a viewer runs to validate the user password (Algorithm 11).
const subtle = globalThis.crypto.subtle;
const bs = (u: Uint8Array) => u as unknown as BufferSource;

async function sha(bits: 256 | 384 | 512, d: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest(`SHA-${bits}`, bs(d)));
}
async function aesNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", bs(key), "AES-CBC", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv: bs(iv) }, k, bs(data)));
  return ct.subarray(0, data.length);
}
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k: Uint8Array = await sha(256, cat(password, salt, udata));
  let e: Uint8Array = new Uint8Array(0);
  for (let round = 0; round < 64 || e[e.length - 1]! > round - 32; round++) {
    const block = cat(password, k, udata);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);
    e = await aesNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i]!;
    const mod = sum % 3;
    k = await sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e);
  }
  return k.subarray(0, 32);
}

const hexField = (s: string, key: string): Uint8Array =>
  hexToBytes(new RegExp(`/${key}\\s*<([0-9a-f]+)>`).exec(s)![1]!);

describe("AES-256 encryption", () => {
  it("is supported in this runtime", () => {
    expect(supportsEncryption()).toBe(true);
  });

  it("emits a well-formed R6 /Encrypt dictionary", async () => {
    const pdf = new PDFDocument({ encrypt: { ownerPassword: "owner" } });
    pdf.text("hi");
    const s = latin1String(await pdf.render());
    expect(s).toContain("/Filter /Standard");
    expect(s).toContain("/V 5");
    expect(s).toContain("/R 6");
    expect(s).toContain("/CFM /AESV3");
    expect(/\/Encrypt \d+ 0 R/.test(s)).toBe(true);
    expect(hexField(s, "U").length).toBe(48);
    expect(hexField(s, "O").length).toBe(48);
    expect(hexField(s, "UE").length).toBe(32);
    expect(hexField(s, "OE").length).toBe(32);
    expect(hexField(s, "Perms").length).toBe(16);
  });

  it("does not leak content or metadata as cleartext", async () => {
    const pdf = new PDFDocument({
      metadata: { title: "Board minutes Q3", author: "CFO" },
      encrypt: { ownerPassword: "owner" },
    });
    pdf.text("Revenue grew by 42 percent");
    const s = latin1String(await pdf.render());
    expect(s).not.toContain("Board minutes Q3");
    expect(s).not.toContain("Revenue grew");
    expect(s).not.toContain("(CFO)");
  });

  it("produces a /U that a viewer accepts for the user password (Algorithm 11)", async () => {
    const password = "open-sesame";
    const pdf = new PDFDocument({ encrypt: { userPassword: password } });
    pdf.text("secret");
    const s = latin1String(await pdf.render());
    const U = hexField(s, "U");
    const validationSalt = U.subarray(32, 40);
    const expected = await hash2B(new TextEncoder().encode(password), validationSalt, new Uint8Array(0));
    expect(bytesToHex(expected)).toBe(bytesToHex(U.subarray(0, 32)));
  });

  it("maps permission flags into /P", async () => {
    const pdf = new PDFDocument({
      encrypt: { ownerPassword: "owner", permissions: { printing: true, copying: false, modifying: false } },
    });
    pdf.text("hi");
    const s = latin1String(await pdf.render());
    const P = Number(/\/P\s+(-?\d+)/.exec(s)![1]);
    expect(P & (1 << 2)).not.toBe(0); // bit 3: printing allowed
    expect(P & (1 << 4)).toBe(0); //     bit 5: copying denied
    expect(P & (1 << 3)).toBe(0); //     bit 4: modifying denied
  });

  it("is non-deterministic (fresh salts and IVs per render)", async () => {
    const make = async () => {
      const pdf = new PDFDocument({ deterministic: true, encrypt: { ownerPassword: "owner" } });
      pdf.text("same input");
      return latin1String(await pdf.render());
    };
    expect(await make()).not.toBe(await make());
  });

  it("rejects an encrypt request with no passwords", async () => {
    expect(code(() => new PDFDocument({ encrypt: {} }).text("x"))).toBeUndefined(); // construction is fine
    const pdf = new PDFDocument({ encrypt: {} });
    pdf.text("x");
    await expect(pdf.render()).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
