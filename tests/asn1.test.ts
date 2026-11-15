import { describe, expect, it } from "vitest";
import {
  children,
  concatBytes,
  contextConstructed,
  elementBytes,
  integer,
  nullValue,
  octetString,
  oid,
  readTLV,
  seq,
  set,
  setOf,
  tlv,
  utcTime,
} from "../src/pdf/asn1";
import { bytesToHex } from "../src/pdf/objects";

const hex = (u: Uint8Array) => bytesToHex(u);
const bytes = (...n: number[]) => new Uint8Array(n);
const filled = (n: number, value = 0x41) => new Uint8Array(n).fill(value);

/**
 * These tests exist because a CMS signature is only worth as much as its DER:
 * a verifier re-parses every length and every INTEGER. An encoder that is off
 * by one byte produces a signature that *looks* fine and is rejected by every
 * viewer — and because the lengths involved depend on the key and the
 * certificate, such a fault would show up only for some inputs.
 */
describe("DER length encoding", () => {
  it("uses the short form below 128 and the long form from 128 on", () => {
    // The boundary the spec draws at 0x80, checked from both sides.
    expect(hex(tlv(0x04, filled(0)))).toBe("0400");
    expect(hex(tlv(0x04, filled(1)).subarray(0, 2))).toBe("0401");
    expect(hex(tlv(0x04, filled(127)).subarray(0, 2))).toBe("047f");
    expect(hex(tlv(0x04, filled(128)).subarray(0, 3))).toBe("048180");
    expect(hex(tlv(0x04, filled(129)).subarray(0, 3))).toBe("048181");
    expect(hex(tlv(0x04, filled(255)).subarray(0, 3))).toBe("0481ff");
    expect(hex(tlv(0x04, filled(256)).subarray(0, 4))).toBe("04820100");
    expect(hex(tlv(0x04, filled(257)).subarray(0, 4))).toBe("04820101");
    expect(hex(tlv(0x04, filled(65535)).subarray(0, 4))).toBe("0482ffff");
    expect(hex(tlv(0x04, filled(65536)).subarray(0, 5))).toBe("0483010000");
  });

  it("round-trips every length through the reader without drifting", () => {
    // A sweep rather than samples: an off-by-one in the length octets would
    // survive a handful of spot checks but not a contiguous range across both
    // form boundaries.
    const lengths = [...Array.from({ length: 300 }, (_, i) => i), 65535, 65536, 70000];
    for (const n of lengths) {
      const content = filled(n, 0x5a);
      const encoded = tlv(0x04, content);
      const t = readTLV(encoded, 0);
      expect(t.tag).toBe(0x04);
      expect(t.length).toBe(n);
      // The element must claim exactly the bytes it occupies — no more, so a
      // following sibling is found, and no fewer, so content is not truncated.
      expect(t.end).toBe(encoded.length);
      expect(encoded.subarray(t.contentStart, t.end)).toEqual(content);
    }
  });

  it("keeps sibling boundaries intact when a member crosses into the long form", () => {
    // children() walks siblings by hopping over each length. A member just
    // above 127 bytes is where a short/long-form mistake first bites.
    const outer = seq(octetString(filled(127, 0x01)), octetString(filled(128, 0x02)), integer(7));
    const kids = children(outer, 0);
    expect(kids).toHaveLength(3);
    expect(kids[0]!.length).toBe(127);
    expect(kids[1]!.length).toBe(128);
    expect(hex(elementBytes(outer, kids[2]!.start))).toBe("020107");
    expect(kids[2]!.end).toBe(outer.length);
  });
});

describe("DER INTEGER encoding", () => {
  it("prefixes a leading zero exactly when the top bit would read as negative", () => {
    // The rule that bites random values: 0x80..0xff needs 00, 0x7f must not
    // get one. Both mistakes produce a parseable but wrong integer.
    expect(hex(integer(0))).toBe("020100");
    expect(hex(integer(1))).toBe("020101");
    expect(hex(integer(127))).toBe("02017f");
    expect(hex(integer(128))).toBe("02020080");
    expect(hex(integer(255))).toBe("020200ff");
    expect(hex(integer(256))).toBe("02020100");
    expect(hex(integer(32767))).toBe("02027fff");
    expect(hex(integer(32768))).toBe("0203008000");
    expect(hex(integer(65535))).toBe("020300ffff");
    expect(hex(integer(65536))).toBe("0203010000");
  });

  it("never emits a superfluous leading zero", () => {
    // DER forbids padding a value whose top bit is already clear; a parser is
    // entitled to reject it.
    for (const n of [1, 2, 0x7f, 0x100, 0x7fff, 0x10000, 0x7fffff]) {
      const encoded = integer(n);
      const content = encoded.subarray(readTLV(encoded, 0).contentStart);
      expect(content.length).toBeGreaterThan(0);
      if (content.length > 1) expect(content[0] === 0 && content[1]! < 0x80).toBe(false);
    }
  });
});

describe("DER SET OF ordering", () => {
  // CMS signs the encoded SET OF of the signed attributes. If the order were
  // not canonical, the bytes a verifier reconstructs would differ from the
  // bytes that were signed and every signature would fail — for some
  // attribute combinations only.
  const CONTENT_TYPE = "1.2.840.113549.1.9.3";
  const MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
  const SIGNING_TIME = "1.2.840.113549.1.9.5";
  const SIGNING_CERT_V2 = "1.2.840.113549.1.9.16.2.47";

  const attribute = (typeOid: string, value: Uint8Array) => seq(oid(typeOid), set(value));

  it("sorts members by their encoding, independent of input order", () => {
    const attrs = [
      attribute(CONTENT_TYPE, oid("1.2.840.113549.1.7.1")),
      attribute(SIGNING_TIME, utcTime(new Date("2024-06-01T12:00:00Z"))),
      attribute(MESSAGE_DIGEST, octetString(filled(32, 0xab))),
      attribute(SIGNING_CERT_V2, seq(seq(seq(octetString(filled(32, 0xcd)))))),
    ];
    const forward = setOf(attrs);
    const reversed = setOf([...attrs].reverse());
    const shuffled = setOf([attrs[2]!, attrs[0]!, attrs[3]!, attrs[1]!]);
    expect(hex(reversed)).toBe(hex(forward));
    expect(hex(shuffled)).toBe(hex(forward));

    // And the order really is ascending by encoding, not merely stable.
    const members = children(forward, 0).map((t) => hex(elementBytes(forward, t.start)));
    expect([...members].sort()).toEqual(members);
  });

  it("orders shorter encodings before longer ones that share their prefix", () => {
    const short = octetString(bytes(0x01));
    const long = octetString(bytes(0x01, 0x00));
    // 04 01 01 vs 04 02 01 00 — the length octet decides, as DER requires.
    expect(hex(setOf([long, short]))).toBe(hex(concatBytes([bytes(0x31, 0x07), short, long])));
  });

  it("leaves a plain SET in the order given", () => {
    // set() is the single-value attribute wrapper; it must not reorder.
    expect(hex(set(octetString(bytes(0x02)), octetString(bytes(0x01))))).toBe("3106040102040101");
  });
});

describe("OBJECT IDENTIFIER encoding", () => {
  it("encodes the OIDs the CMS structure depends on", () => {
    // Known-good encodings from the registries; the first two subidentifiers
    // share a byte and every value above 127 spills into continuation bytes.
    expect(hex(oid("2.16.840.1.101.3.4.2.1"))).toBe("0609608648016503040201"); // SHA-256
    expect(hex(oid("1.2.840.113549.1.1.1"))).toBe("06092a864886f70d010101"); // rsaEncryption
    expect(hex(oid("1.2.840.113549.1.7.2"))).toBe("06092a864886f70d010702"); // signedData
    expect(hex(oid("2.5.4.3"))).toBe("0603550403"); // commonName
  });

  it("spills large subidentifiers into multiple continuation bytes", () => {
    // 113549 needs three base-128 digits, 2097152 needs four — the loop that
    // builds them is the only place arithmetic (not bit shifts) is used.
    expect(hex(oid("1.2.840.113549.1.9.16.2.47"))).toBe("060b2a864886f70d010910022f");
    expect(hex(oid("1.2.2097152"))).toBe("06052a81808000");
  });
});

describe("UTCTime encoding", () => {
  it("writes YYMMDDhhmmssZ with two-digit zero padding", () => {
    const t = utcTime(new Date("2009-02-03T04:05:06Z"));
    expect(readTLV(t, 0).tag).toBe(0x17);
    expect(readTLV(t, 0).length).toBe(13);
    expect(String.fromCharCode(...t.subarray(2))).toBe("090203040506Z");
  });

  it("wraps the year into two digits across the century", () => {
    expect(String.fromCharCode(...utcTime(new Date("2000-01-01T00:00:00Z")).subarray(2))).toBe(
      "000101000000Z",
    );
    expect(String.fromCharCode(...utcTime(new Date("2040-12-31T23:59:59Z")).subarray(2))).toBe(
      "401231235959Z",
    );
  });
});

describe("DER reader", () => {
  it("navigates a nested structure back to the values that went in", () => {
    const inner = seq(integer(1), nullValue());
    const doc = seq(oid("1.2.840.113549.1.7.2"), contextConstructed(0, inner));
    const top = children(doc, 0);
    expect(top).toHaveLength(2);
    expect(top[1]!.tag).toBe(0xa0);
    const recovered = children(doc, top[1]!.start)[0]!;
    expect(hex(elementBytes(doc, recovered.start))).toBe(hex(inner));
  });

  it("reports the content offset past a long-form length", () => {
    const big = tlv(0x04, filled(300));
    const t = readTLV(big, 0);
    expect(t.contentStart).toBe(4); // tag + 0x82 + two length octets
    expect(t.end - t.contentStart).toBe(300);
  });
});

describe("concatBytes", () => {
  it("joins parts in order and preserves total length", () => {
    expect(hex(concatBytes([bytes(1, 2), new Uint8Array(0), bytes(3)]))).toBe("010203");
    expect(concatBytes([]).length).toBe(0);
  });
});
