/**
 * Assembles docs/demo.html (self-contained, offline-fähig) aus:
 *  - docs/demo-src.html   (Markup mit Tailwind-Klassen + Design-Tokens)
 *  - docs/demo.tw.css     (generiertes Tailwind-CSS — via `npm run docs:demo`)
 *  - docs/assets/demo-*.png (Screenshots, als data-URIs eingebettet)
 *  - dist/index.browser.js  (die Bibliothek selbst, damit der
 *    "PDF herunterladen"-Knopf der Beispieltabelle wirklich läuft)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const docs = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(docs, name));

/**
 * Die Seite bleibt eine einzige Datei — also wandert auch die Bibliothek
 * hinein. Ohne sie wäre die Beispieltabelle nur ein Screenshot; mit ihr
 * erzeugt der Knopf im Browser des Lesers ein echtes PDF.
 */
function library() {
  const path = join(docs, "..", "dist", "index.browser.js");
  if (!existsSync(path)) {
    throw new Error(
      "dist/index.browser.js fehlt — bitte zuerst `npm run build`, " +
        "sonst hätte die Demo-Tabelle keinen funktionierenden Download-Knopf.",
    );
  }
  // Die Source-Map liegt nicht neben der HTML-Datei; der Verweis würde in
  // den DevTools nur einen 404 erzeugen.
  return readFileSync(path, "utf8").replace(/^\/\/# sourceMappingURL=.*$/gm, "");
}

let html = read("demo-src.html").toString("utf8");
const css = read("demo.tw.css").toString("utf8");

const titleMatch = html.match(/<title>([\s\S]*?)<\/title>\s*/);
const title = titleMatch ? titleMatch[1] : "fast-pdf – Demo";
html = html.replace(/<title>[\s\S]*?<\/title>\s*/, "");

html = html
  .replace("__TW_CSS__", () => css)
  .replace("__QUICKSTART_B64__", () => read("assets/demo-quickstart.png").toString("base64"))
  .replace("__COVER_B64__", () => read("assets/demo-cover.png").toString("base64"))
  .replace("__DASHBOARD_B64__", () => read("assets/demo-dashboard.png").toString("base64"))
  .replace("__FASTPDF_JS__", () => library());

// Favicon: weißes Blatt mit Eselsohr und Akzent-Blitz auf der Akzentfarbe.
// Drei Formen, mehr überlebt 16 px nicht; der Blitz bleibt vollständig
// innerhalb des Blatts. Als data-URI, damit die Seite eine Datei bleibt.
const favicon =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#2e5ce6"/>' +
  '<path d="M9 5h8.5L24 11.5V25a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="#fff"/>' +
  '<path d="M17.5 5L24 11.5h-6.5z" fill="#9bb4f5"/>' +
  '<path d="M17.4 11.5l-6.6 8.1h4.1l-1.2 5.4 6.7-8.6h-4.2z" fill="#2e5ce6"/>' +
  "</svg>";

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(favicon)}">
<meta name="theme-color" content="#2e5ce6">
</head>
<body>
${html}
</body>
</html>
`;

writeFileSync(join(docs, "demo.html"), page);
// GitHub Pages (Quelle: main /docs) erwartet eine index.html als Einstieg.
writeFileSync(join(docs, "index.html"), page);
console.log(`→ docs/demo.html + docs/index.html (${(page.length / 1024).toFixed(0)} KB)`);
