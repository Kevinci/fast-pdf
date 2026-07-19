#!/usr/bin/env node
/**
 * Installs the "fast-pdf-designer" Claude Code skill into the current
 * project: copies the skill folder shipped inside the fast-pdf package
 * to ./.claude/skills/fast-pdf-designer/.
 *
 * Usage (from your project root):  npx fast-pdf-skill
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(pkgRoot, ".claude", "skills", "fast-pdf-designer");
const dest = join(process.cwd(), ".claude", "skills", "fast-pdf-designer");

if (!existsSync(src)) {
  console.error("fast-pdf-skill: skill folder not found in the package — please reinstall fast-pdf.");
  process.exit(1);
}

const existed = existsSync(dest);
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true, force: true });

console.log(`${existed ? "Updated" : "Installed"} Claude Code skill → ${join(".claude", "skills", "fast-pdf-designer")}`);
console.log('Try it: ask Claude Code for "an invoice with fast-pdf" — the design rules load automatically.');
