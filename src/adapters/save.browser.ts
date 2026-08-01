/**
 * Browser-only file output — the `save()` implementation that ships in
 * `dist/index.browser.js`, selected through the "browser" export condition.
 *
 * The point of this file is what it does NOT contain: no `node:fs/promises`
 * import, not even a dynamic one behind a runtime check. Bundlers resolve
 * imports statically, so the universal adapter's guarded `import()` still
 * drags a Node resolution into a client build (and breaks it, or forces an
 * alias plus a stub module). Here there is nothing to resolve.
 */

export async function saveFile(path: string, bytes: Uint8Array): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error(
      "save() in the browser build needs a DOM — use render(), toBlob() or toStream(), " +
        'or import the universal build (the "browser" export condition selected this one)',
    );
  }
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path;
  a.click();
  URL.revokeObjectURL(url);
}
