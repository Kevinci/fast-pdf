import { defineConfig } from "tsup";
import { resolve } from "node:path";

/**
 * Three entry points, built twice:
 *
 * - `dist/index.js`    — the document API (`fast-pdf`).
 * - `dist/dom.js`      — the HTML-table reader (`fast-pdf/dom`).
 * - `dist/internal.js` — the engine below it (`fast-pdf/internal`).
 *
 * …and the same three again as `*.browser.js`, selected by the "browser"
 * export condition: there the file adapter is swapped for the download-only
 * one, so no bundler ever has to resolve `node:fs/promises` for a client
 * build. `fast-pdf/dom` needs that variant most of all — it runs *only* in a
 * browser, and it builds a `PDFDocument`, which is what pulls the adapter in.
 *
 * Both builds use ESM code splitting, so the core that `index` and `dom`
 * share lands in one `chunk-*.js` instead of being copied into each bundle.
 * That is what makes the subpaths free rather than a second copy of the
 * engine, and it is why `dist/` holds more files than entry points.
 *
 * Chunk names are content hashes, so the chunk that does not depend on the
 * save adapter — the engine shared by `internal` and the rest — comes out
 * byte-identical in both builds and is written once under one name. That is
 * deliberate deduplication, not a collision: if the content ever diverges,
 * so does the hash, and the two builds get separate files.
 */
const shared = {
  format: ["esm"] as const,
  sourcemap: true,
  target: "es2022",
  platform: "neutral" as const,
  treeshake: true,
  splitting: true,
};

const entries = {
  index: "src/index.ts",
  dom: "src/dom/index.ts",
  internal: "src/internal.ts",
};

/** The same entries under the names the browser build publishes them as. */
const browserEntries = Object.fromEntries(
  Object.entries(entries).map(([name, file]) => [`${name}.browser`, file]),
);

export default defineConfig([
  {
    ...shared,
    entry: entries,
    dts: true,
    // Not `clean` — tsup runs array configs concurrently, so wiping the
    // output folder here would race the browser build. The npm script
    // clears dist/ before invoking tsup instead.
    clean: false,
  },
  {
    ...shared,
    entry: browserEntries,
    // Same public API, so the .d.ts files of the first build serve both.
    dts: false,
    clean: false,
    esbuildPlugins: [
      {
        name: "fast-pdf-browser-save",
        setup(build) {
          build.onResolve({ filter: /(^|[\\/])adapters[\\/]save$/ }, () => ({
            path: resolve("src/adapters/save.browser.ts"),
          }));
        },
      },
    ],
  },
]);
