/**
 * Cross-runtime file output. This is the ONLY module that touches
 * platform-specific APIs, and every access is feature-detected so
 * bundlers can ship this file to any target.
 */

declare const Deno: { writeFile(path: string, data: Uint8Array): Promise<void> } | undefined;

export async function saveFile(path: string, bytes: Uint8Array): Promise<void> {
  // Deno
  if (typeof Deno !== "undefined" && typeof Deno.writeFile === "function") {
    await Deno.writeFile(path, bytes);
    return;
  }

  // Node / Bun
  if (typeof process !== "undefined" && process.versions?.node) {
    const fs = await import(/* @vite-ignore */ "node:fs/promises");
    await fs.writeFile(path, bytes);
    return;
  }

  // Browser: trigger a download named after `path`.
  if (typeof document !== "undefined") {
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = path;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  throw new Error(
    "No file system available in this runtime — use render(), toBlob() or toBuffer() instead of save()",
  );
}
