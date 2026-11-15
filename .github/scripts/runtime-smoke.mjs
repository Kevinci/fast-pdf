/**
 * Cross-runtime smoke test: does the *shipped* bundle work on this runtime?
 *
 * Two different promises are checked with this one script:
 *
 *   - `engines: node >= 18` in package.json. That is a promise to consumers
 *     about the published artifact, and npm enforces it. The right way to test
 *     it is "does dist/index.js render a PDF on Node 18", not "does ESLint run
 *     on Node 18" — the dev toolchain is a contributor concern, not a
 *     consumer one.
 *   - The README's Bun and Deno support.
 *
 * It therefore loads `dist/index.js` — the artifact npm actually ships —
 * instead of the TypeScript sources, because that is what a consumer gets.
 *
 * Deliberately minimal: text with non-ASCII glyphs (WinAnsi path), a table
 * (layout engine) and `save()` (the adapter in src/adapters/save.ts, the only
 * module with per-runtime branches). The resulting PDF is handed to
 * `qpdf --check` by the caller — "it did not throw" is not evidence that the
 * bytes are a valid PDF.
 *
 * Usage: <runtime> .github/scripts/runtime-smoke.mjs <output.pdf>
 */
import { PDFDocument } from "../../dist/index.js";

// `globalThis.X` rather than a bare `X`: a bare identifier is an undefined
// global under ESLint's Node config and fails `no-undef`.
const args = globalThis.Deno ? globalThis.Deno.args : globalThis.process.argv.slice(2);
const target = args[0];

if (!target) {
  console.error("usage: runtime-smoke.mjs <output.pdf>");
  throw new Error("missing output path");
}

// Order matters: Bun and Deno both expose a `process` shim with
// `versions.node`, so Node has to be the last branch or it would claim them.
function describeRuntime() {
  if (globalThis.Deno) return `Deno ${globalThis.Deno.version.deno}`;
  if (globalThis.Bun) return `Bun ${globalThis.Bun.version}`;
  if (globalThis.process?.versions?.node) return `Node ${globalThis.process.versions.node}`;
  return "unknown runtime";
}

const runtime = describeRuntime();

const pdf = new PDFDocument({
  metadata: { title: "fast-pdf cross-runtime smoke test", author: "fast-pdf CI" },
});

pdf.text("fast-pdf cross-runtime smoke test", { size: 20, bold: true });
pdf.moveDown();
pdf.text(`Rendered by ${runtime} from the built dist/index.js bundle.`, {
  color: "#334155",
  spacingAfter: 12,
});
pdf.text("Non-ASCII: Umlaute (äöüß), Euro (€), Gedankenstrich (–), Anführungszeichen („“).", {
  spacingAfter: 12,
});

pdf.table([
  ["Check", "Covered"],
  ["Text layout and font metrics", "yes"],
  ["Table layout", "yes"],
  ["save() runtime adapter", "yes"],
]);

await pdf.save(target);
console.log(`${runtime} wrote ${target}`);
