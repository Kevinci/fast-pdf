import { describe, expect, it } from "vitest";
import { FastPDFError } from "../src/errors";
import { parseColor } from "../src/types/index";

describe("parseColor", () => {
  it("parses hex and object colors, clamping out-of-range channels", () => {
    expect(parseColor("#f00")).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseColor("#0080ff").b).toBe(1);
    expect(parseColor({ r: 300, g: -5, b: 128 })).toEqual({ r: 1, g: 0, b: 128 / 255 });
  });

  it("throws a typed error on malformed input", () => {
    try {
      parseColor("rebeccapurple");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FastPDFError);
      expect((e as FastPDFError).code).toBe("INVALID_COLOR");
    }
  });
});
import { Name, PDFString, Ref, escapeString, fmtNumber, latin1Bytes, serialize, textString } from "../src/pdf/objects";

describe("fmtNumber", () => {
  it("keeps integers plain", () => {
    expect(fmtNumber(42)).toBe("42");
    expect(fmtNumber(-7)).toBe("-7");
    expect(fmtNumber(0)).toBe("0");
  });

  it("trims trailing zeros on decimals", () => {
    expect(fmtNumber(1.5)).toBe("1.5");
    expect(fmtNumber(0.10000000001)).toBe("0.1");
    expect(fmtNumber(595.276)).toBe("595.276");
  });

  it("rejects non-finite numbers", () => {
    expect(() => fmtNumber(NaN)).toThrow();
    expect(() => fmtNumber(Infinity)).toThrow();
  });
});

describe("serialize", () => {
  it("serializes primitives", () => {
    expect(serialize(null)).toBe("null");
    expect(serialize(true)).toBe("true");
    expect(serialize(new Ref(12))).toBe("12 0 R");
    expect(serialize(new Name("Type"))).toBe("/Type");
    expect(serialize(new PDFString("hi"))).toBe("(hi)");
  });

  it("serializes arrays and dictionaries, skipping undefined entries", () => {
    expect(serialize([0, 0, 595.28, 841.89])).toBe("[0 0 595.28 841.89]");
    expect(serialize({ Type: new Name("Page"), Skip: undefined, Count: 2 })).toBe(
      "<< /Type /Page /Count 2 >>",
    );
  });

  it("escapes irregular name characters", () => {
    expect(serialize(new Name("A B(C)"))).toBe("/A#20B#28C#29");
  });
});

describe("escapeString", () => {
  it("escapes parens, backslash and EOL characters", () => {
    expect(escapeString("a(b)c\\d\ne\rf")).toBe("a\\(b\\)c\\\\d\\ne\\rf");
  });
});

describe("latin1Bytes", () => {
  it("maps one char to one byte, including bytes > 0x7f", () => {
    const bytes = latin1Bytes("A\xe4\xff");
    expect([...bytes]).toEqual([0x41, 0xe4, 0xff]);
  });
});

describe("textString", () => {
  it("keeps ASCII as literal strings", () => {
    expect(serialize(textString("Invoice"))).toBe("(Invoice)");
  });

  it("encodes non-ASCII as UTF-16BE with BOM", () => {
    const s = textString("Grüße");
    expect(s.value.charCodeAt(0)).toBe(0xfe);
    expect(s.value.charCodeAt(1)).toBe(0xff);
    // "G" as UTF-16BE
    expect(s.value.charCodeAt(2)).toBe(0x00);
    expect(s.value.charCodeAt(3)).toBe(0x47);
  });
});
