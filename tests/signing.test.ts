import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "../src/index";
import { latin1String, bytesToHex, hexToBytes } from "../src/pdf/objects";
import { readTLV, children, elementBytes, seq, set, tlv, oid, integer, contextConstructed, nullValue, utcTime } from "../src/pdf/asn1";

const bs = (u: Uint8Array) => u as unknown as BufferSource;
const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};
const sha256 = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", bs(d)));

// A throwaway RSA key + self-signed certificate, generated fresh each run — so
// no private key is ever committed. Uses the same asn1 primitives as src/.
let KEY = "";
let CERT = "";
beforeAll(async () => {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const utf8 = (s: string) => tlv(0x0c, new Uint8Array([...s].map((c) => c.charCodeAt(0))));
  const name = seq(set(seq(oid("2.5.4.3"), utf8("fast-pdf Test Signer"))));
  const sigAlg = seq(oid("1.2.840.113549.1.1.11"), nullValue()); // sha256WithRSAEncryption
  const validity = seq(utcTime(new Date("2020-01-01T00:00:00Z")), utcTime(new Date("2040-01-01T00:00:00Z")));
  const tbs = seq(contextConstructed(0, integer(2)), integer(1), sigAlg, name, validity, name, spki);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, kp.privateKey, bs(tbs)));
  const cert = seq(tbs, sigAlg, tlv(0x03, concat(new Uint8Array([0]), sig))); // BIT STRING
  const pem = (u: Uint8Array, label: string) =>
    `-----BEGIN ${label}-----\n${Buffer.from(u).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END ${label}-----\n`;
  KEY = pem(pkcs8, "PRIVATE KEY");
  CERT = pem(cert, "CERTIFICATE");
});

async function signedPdf(): Promise<Uint8Array> {
  const pdf = new PDFDocument({ deterministic: true });
  pdf.text("Please countersign.");
  pdf.signature({ label: "Signature", sign: { privateKeyPem: KEY, certificatePem: CERT, reason: "Approved" } });
  return pdf.render();
}

/** Pull the signed byte ranges and the trimmed CMS DER out of a signed file. */
function extract(file: Uint8Array): { content: Uint8Array; cms: Uint8Array } {
  const s = latin1String(file);
  const br = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/.exec(s)!;
  const [a, b, c, d] = br.slice(1, 5).map(Number) as [number, number, number, number];
  const content = concat(file.subarray(a, a + b), file.subarray(c, c + d));
  const hexStart = s.indexOf("/Contents <") + "/Contents <".length;
  const der = hexToBytes(s.slice(hexStart, s.indexOf(">", hexStart)));
  return { content, cms: der.subarray(0, readTLV(der, 0).end) };
}

describe("PAdES-B digital signatures", () => {
  it("emits the expected signature dictionary and AcroForm flags", async () => {
    const s = latin1String(await signedPdf());
    expect(s).toContain("/Type /Sig");
    expect(s).toContain("/SubFilter /ETSI.CAdES.detached");
    expect(s).toContain("/Filter /Adobe.PPKLite");
    expect(/\/ByteRange \[0 \d{10} \d{10} \d{10}\]/.test(s)).toBe(true);
    expect(s).toContain("/SigFlags 3");
    expect(s).toContain("(Approved)");
  });

  it("covers the whole file except the /Contents gap", async () => {
    const file = await signedPdf();
    const s = latin1String(file);
    const [, , b, c, d] = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/.exec(s)!.map(Number);
    const gapStart = s.indexOf("/Contents <") + "/Contents <".length - 1; // the '<'
    expect(b).toBe(gapStart);
    expect(c! + d!).toBe(file.length); // second range runs to EOF
  });

  it("produces a CMS signature that verifies against the certificate", async () => {
    const { content, cms } = extract(await signedPdf());

    // ── Navigate the CMS SignedData ──
    const ci = children(cms, 0); // ContentInfo: [ oid, [0] ]
    const sd = children(cms, ci[1]!.contentStart); // SignedData fields
    const signerInfos = sd[sd.length - 1]!; // SET OF SignerInfo
    const si = children(cms, signerInfos.start)[0]!; // the one SignerInfo
    const siFields = children(cms, si.start);
    const signedAttrs = siFields.find((f) => f.tag === 0xa0)!;
    const sigOctet = siFields.find((f) => f.tag === 0x04)!;
    const signature = cms.subarray(sigOctet.contentStart, sigOctet.end);

    // The bytes actually signed are the attributes re-tagged as SET OF (0x31).
    const signed = elementBytes(cms, signedAttrs.start).slice();
    signed[0] = 0x31;

    // messageDigest attribute must equal SHA-256 of the signed document bytes.
    const MESSAGE_DIGEST_OID = "06092a864886f70d010904";
    let messageDigest: Uint8Array | undefined;
    for (const attr of children(cms, signedAttrs.start)) {
      const [oidT, valueSet] = children(cms, attr.start);
      if (bytesToHex(cms.subarray(oidT!.start, oidT!.end)) === MESSAGE_DIGEST_OID) {
        const octet = children(cms, valueSet!.start)[0]!;
        messageDigest = cms.subarray(octet.contentStart, octet.end);
      }
    }
    expect(bytesToHex(messageDigest!)).toBe(bytesToHex(await sha256(content)));

    // Extract the signer's public key (SubjectPublicKeyInfo) from the embedded cert.
    const certs = sd.find((f) => f.tag === 0xa0)!; // [0] IMPLICIT certificates
    const cert = children(cms, certs.start)[0]!;
    const tbs = children(cms, cert.start)[0]!;
    const tbsFields = children(cms, tbs.start);
    const spkiIdx = tbsFields[0]!.tag === 0xa0 ? 6 : 5; // skip optional [0] version
    const spki = elementBytes(cms, tbsFields[spkiIdx]!.start);

    const key = await crypto.subtle.importKey(
      "spki",
      bs(spki),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, bs(signature), bs(signed));
    expect(ok).toBe(true);
  });

  it("allows at most one signed field per document", async () => {
    const pdf = new PDFDocument();
    pdf.signature({ sign: { privateKeyPem: KEY, certificatePem: CERT } });
    pdf.signature({ sign: { privateKeyPem: KEY, certificatePem: CERT } });
    await expect(pdf.render()).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("refuses to sign an encrypted document", async () => {
    const pdf = new PDFDocument({ encrypt: { ownerPassword: "o" } });
    pdf.signature({ sign: { privateKeyPem: KEY, certificatePem: CERT } });
    await expect(pdf.render()).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("rejects a malformed key or certificate up front", async () => {
    const pdf = new PDFDocument();
    pdf.signature({ sign: { privateKeyPem: "not a pem", certificatePem: CERT } });
    await expect(pdf.render()).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
