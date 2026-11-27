/**
 * Assembles docs/demo.html (self-contained, offline-fähig) aus:
 *  - docs/demo-src.html   (Markup mit Tailwind-Klassen + Design-Tokens)
 *  - docs/demo.tw.css     (generiertes Tailwind-CSS — via `npm run docs:demo`)
 *  - docs/assets/demo-*.png (Screenshots, als data-URIs eingebettet)
 *  - dist/dom.browser.js    (fast-pdf/dom samt Kern, damit der
 *    "PDF herunterladen"-Knopf der Beispieltabelle wirklich läuft)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const docs = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(docs, name));

/**
 * Die Seite bleibt eine einzige Datei — also wandert auch die Bibliothek
 * hinein. Ohne sie wäre die Beispieltabelle nur ein Screenshot; mit ihr
 * erzeugt der Knopf im Browser des Lesers ein echtes PDF.
 *
 * Seit 0.9.0 baut tsup mit Code-Splitting: `dist/dom.browser.js` importiert
 * den Kern aus `./chunk-*.js`, und ein Inline-Skript kann keine relativen
 * Dateien nachladen. esbuild bündelt deshalb alles zu einem ESM-String.
 *
 * Das Bundle läuft in einer eigenen Funktion statt auf Modulebene: das
 * Inline-Skript deklariert selbst `options`, `render`, `lang` …, und ein
 * gleichnamiger Top-Level-Name im Bundle würde still überschrieben (`var`)
 * oder das ganze Modul zum SyntaxError machen (`let`/`const`). Heraus
 * kommen nur die Exporte von fast-pdf/dom, unter ihren öffentlichen Namen.
 */
async function library() {
  const entry = join(docs, "..", "dist", "dom.browser.js");
  if (!existsSync(entry)) {
    throw new Error(
      "dist/dom.browser.js fehlt — bitte zuerst `npm run build`, " +
        "sonst hätte die Demo-Tabelle keinen funktionierenden Download-Knopf.",
    );
  }
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    logLevel: "silent",
  });
  // Die Source-Map liegt nicht neben der HTML-Datei; ein Verweis würde in
  // den DevTools nur einen 404 erzeugen.
  let code = result.outputFiles[0].text.replace(/^\/\/# sourceMappingURL=.*$/gm, "");

  // esbuild schließt ein ESM-Bundle mit genau einem `export { … };` ab.
  const tail = code.match(/\nexport\s*\{([^}]*)\};?\s*$/);
  if (!tail) throw new Error("build-demo: kein abschließendes `export { … }` im Bundle gefunden");
  code = code.slice(0, tail.index);
  if (/^\s*(?:import|export)\b/m.test(code)) {
    throw new Error("build-demo: das Bundle enthält noch import/export — inline nicht lauffähig");
  }
  const names = tail[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [local, exported = local] = part.split(/\s+as\s+/);
      return { local, exported };
    });
  if (!names.some((n) => n.exported === "attachTablePdfButton")) {
    throw new Error("build-demo: fast-pdf/dom exportiert kein attachTablePdfButton mehr");
  }

  const wrapped =
    `const { ${names.map((n) => n.exported).join(", ")} } = (() => {\n${code}\n` +
    `return { ${names.map((n) => `${n.exported}: ${n.local}`).join(", ")} };\n})()`;

  // Im <script>-Element beendet `</script` das Element mitten im Code, und
  // `<!--` schaltet den HTML-Parser in einen Escape-Modus. Beides kommt nur
  // in Strings, Regex-Literalen oder Kommentaren vor, wo `\x3C` dasselbe
  // Zeichen ist.
  return wrapped.replace(/<(?=\/script|!--)/gi, String.raw`\x3C`);
}

const libraryCode = await library();
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
  .replace("__FASTPDF_JS__", () => libraryCode);

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
