import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only this checkout's tests. Agent worktrees live under .claude/ and
    // carry their own copy of the suite, which must not be run from here.
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.claude/**"],
    coverage: {
      include: ["src/**/*.ts"],
      // Thresholds sit one to two points below the measured value, not flush
      // against it. Flush would turn every ordinary refactor red; the previous
      // gap of five to ten points caught nothing at all — the suite drifted
      // from 92.08 % to 89.11 % statements without anyone noticing, because
      // `prepublishOnly` ran `npm test` rather than this script. It now runs
      // this one.
      //
      // Measured 2026-10-31: statements 92.65, branches 84.51, functions
      // 96.80, lines 94.24.
      //
      // Note `src/adapters/save.browser.ts` sits at 0 % and cannot run under
      // Node at all, which costs the totals ~0.2-0.3 points permanently. It is
      // deliberately NOT excluded: an exclude would raise the percentage
      // without adding a single test, which is a threshold cut in disguise.
      thresholds: {
        statements: 92,
        lines: 93,
        functions: 95,
        branches: 83,
      },
    },
  },
});
