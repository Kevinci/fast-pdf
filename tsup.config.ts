import { defineConfig } from "tsup";
import { resolve } from "node:path";

/**
 * Two builds from one source tree:
 *
 * - `dist/index.js`      — universal (Node, Bun, Deno, browsers, edge).
 * - `dist/index.browser.js` — selected by the "browser" export condition;
 *   the file adapter is swapped for the download-only one, so no bundler
 *   ever has to resolve `node:fs/promises` for a client build.
 */
const shared = {
  format: ["esm"] as const,
  sourcemap: true,
  target: "es2022",
  platform: "neutral" as const,
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    dts: true,
    // Not `clean` — tsup runs array configs concurrently, so wiping the
    // output folder here would race the browser build. The npm script
    // clears dist/ before invoking tsup instead.
    clean: false,
  },
  {
    ...shared,
    entry: { "index.browser": "src/index.ts" },
    // Same public API, so dist/index.d.ts serves both entries.
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
