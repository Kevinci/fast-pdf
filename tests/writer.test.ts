import { describe, expect, it } from "vitest";
import { PDFWriter } from "../src/pdf/writer";
import { Name, latin1String } from "../src/pdf/objects";
import { deflate, inflate, supportsCompression } from "../src/pdf/compress";

describe("PDFWriter", () => {
  it("produces a structurally valid file with exact xref offsets", async () => {
    const writer = new PDFWriter();
    const pagesRef = writer.reserve();
    const pageRef = writer.add({
      Type: new Name("Page"),
      Parent: pagesRef,
      MediaBox: [0, 0, 612, 792],
    });
    writer.fill(pagesRef, { Type: new Name("Pages"), Kids: [pageRef], Count: 1 });
    const catalog = writer.add({ Type: new Name("Catalog"), Pages: pagesRef });
    const bytes = await writer.finalize(catalog);
    const text = latin1String(bytes);

    expect(text.startsWith("%PDF-1.7\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("/Root 3 0 R");

    // startxref must point at the xref table.
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");

    // Every xref offset must point at the start of "N 0 obj".
    const entries = /xref\n0 (\d+)\n/.exec(text)!;
    const count = Number(entries[1]);
    const table = text.slice(text.indexOf("xref\n"));
    const lines = table.split("\n").slice(2, 2 + count);
    for (let num = 1; num < count; num++) {
      const offset = Number(lines[num]!.slice(0, 10));
      expect(text.slice(offset, offset + `${num} 0 obj`.length)).toBe(`${num} 0 obj`);
    }
  });

  it("adds /Length to stream objects", async () => {
    const writer = new PDFWriter();
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const ref = writer.add({ Type: new Name("Catalog") });
    writer.addStream({}, data);
    const bytes = await writer.finalize(ref);
    const text = latin1String(bytes);
    expect(text).toContain("/Length 5");
    expect(text).toContain("stream\n\x01\x02\x03\x04\x05\nendstream");
  });

  it("rejects double fills and unfilled reservations", async () => {
    const writer = new PDFWriter();
    const ref = writer.reserve();
    writer.fill(ref, { A: 1 });
    expect(() => writer.fill(ref, { A: 2 })).toThrow(/already written/);

    const writer2 = new PDFWriter();
    const root = writer2.add({ Type: new Name("Catalog") });
    writer2.reserve();
    await expect(writer2.finalize(root)).rejects.toThrow(/never written/);
  });
});

describe("compress", () => {
  it("deflate/inflate round-trips", async () => {
    expect(supportsCompression()).toBe(true);
    const input = new TextEncoder().encode("fast-pdf ".repeat(1000));
    const compressed = await deflate(input);
    expect(compressed!.length).toBeLessThan(input.length / 5);
    const restored = await inflate(compressed!);
    expect(restored).toEqual(input);
  });
});
