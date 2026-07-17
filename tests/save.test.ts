import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "../src/index";
import { saveFile } from "../src/adapters/save";

describe("save()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers Deno.writeFile when available", async () => {
    const writeFile = vi.fn(async () => {});
    vi.stubGlobal("Deno", { writeFile });
    await saveFile("x.pdf", new Uint8Array([1]));
    expect(writeFile).toHaveBeenCalledWith("x.pdf", new Uint8Array([1]));
  });

  it("falls back to a browser download link", async () => {
    vi.stubGlobal("process", undefined);
    const click = vi.fn();
    const anchor = { href: "", download: "", click };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    await saveFile("download.pdf", new Uint8Array([1]));
    expect(anchor.download).toBe("download.pdf");
    expect(click).toHaveBeenCalled();
  });

  it("throws a helpful error when no runtime API exists", async () => {
    vi.stubGlobal("process", undefined);
    await expect(saveFile("x.pdf", new Uint8Array([1]))).rejects.toThrow(/toBuffer/);
  });
  it("writes the rendered PDF to disk on Node", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fast-pdf-"));
    const path = join(dir, "out.pdf");
    try {
      const pdf = new PDFDocument();
      pdf.text("Saved to disk");
      await pdf.save(path);
      const bytes = await readFile(path);
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(500);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
