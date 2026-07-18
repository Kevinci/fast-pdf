/**
 * Assembles docs/demo.html (self-contained, offline-fähig) aus:
 *  - docs/demo-src.html   (Markup mit Tailwind-Klassen + Design-Tokens)
 *  - docs/demo.tw.css     (generiertes Tailwind-CSS — via `npm run docs:demo`)
 *  - docs/assets/demo-*.png (Screenshots, als data-URIs eingebettet)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const docs = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(docs, name));

let html = read("demo-src.html").toString("utf8");
const css = read("demo.tw.css").toString("utf8");

const titleMatch = html.match(/<title>([\s\S]*?)<\/title>\s*/);
const title = titleMatch ? titleMatch[1] : "fast-pdf – Demo";
html = html.replace(/<title>[\s\S]*?<\/title>\s*/, "");

html = html
  .replace("__TW_CSS__", () => css)
  .replace("__COVER_B64__", () => read("assets/demo-cover.png").toString("base64"))
  .replace("__DASHBOARD_B64__", () => read("assets/demo-dashboard.png").toString("base64"));

const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
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
