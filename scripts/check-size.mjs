#!/usr/bin/env node
/**
 * Bundle-size budget: measures what a consumer's bundler would ship for each
 * entry point and fails when one outgrows its budget.
 *
 * Why this exists: the README once claimed "~13 KB min+gzip" while the real
 * figure was 52 KB — nobody had lied, the number had simply never been
 * measured again after it was written. The coverage figure drifted the same
 * way. A number that no gate re-measures is a number that goes stale, so this
 * one is re-measured on every CI run.
 *
 * Method — the one the README documents, so the two cannot disagree: take the
 * built `dist/<entry>.js`, bundle it with esbuild (`--bundle --minify`, ESM,
 * neutral platform, Node built-ins left external) and gzip the result at level 9.
 * Both the Node and the browser build are measured, and the larger of the two
 * counts.
 *
 * Budgets sit roughly 3 % above the measured value. Raising one is allowed —
 * it is a one-line diff here, which is exactly the point: growth becomes a
 * visible decision instead of an accident.
 *
 * Usage: node scripts/check-size.mjs          (expects an up-to-date dist/)
 *        node scripts/check-size.mjs --json   (machine-readable)
 */
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

/** min+gzip budgets in bytes, per public entry point. */
const BUDGETS = {
  index: 50_500, // fast-pdf           — measured 48,933 B at 1.0.0
  dom: 54_000, // fast-pdf/dom         — measured 52,263 B at 1.0.0
  internal: 7_300, // fast-pdf/internal — measured 6,949 B at 1.0.0
};

async function measure(file) {
  const result = await build({
    entryPoints: [file],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "neutral",
    external: ["node:*", "fs/promises"],
    write: false,
    logLevel: "silent",
  });
  const minified = result.outputFiles[0].contents;
  return { minified: minified.length, gzip: gzipSync(minified, { level: 9 }).length };
}

const rows = [];
let failed = false;

for (const [entry, budget] of Object.entries(BUDGETS)) {
  for (const variant of ["", ".browser"]) {
    const file = `dist/${entry}${variant}.js`;
    if (!existsSync(file)) {
      console.error(`check-size: ${file} is missing — run \`npm run build\` first.`);
      process.exit(2);
    }
    const { minified, gzip } = await measure(file);
    const over = gzip > budget;
    failed ||= over;
    rows.push({ file, minified, gzip, budget, over });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const fmt = (n) => n.toLocaleString("en-US").padStart(9);
  console.log("entry                     minified   min+gzip     budget   used");
  for (const row of rows) {
    const used = ((row.gzip / row.budget) * 100).toFixed(1).padStart(5);
    console.log(
      `${row.file.padEnd(24)}${fmt(row.minified)}  ${fmt(row.gzip)}  ${fmt(row.budget)}  ${used}%${row.over ? "  OVER BUDGET" : ""}`,
    );
  }
}

if (failed) {
  console.error(
    "\ncheck-size: at least one entry point is over its min+gzip budget.\n" +
      "Either shrink the change, or raise the budget in scripts/check-size.mjs\n" +
      "and update the size table in README.md in the same commit.",
  );
  process.exit(1);
}
