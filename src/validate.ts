/**
 * Numeric input validation for the public API boundary.
 *
 * PDF syntax has no representation for NaN, infinities, or exponent
 * notation, so a bad number can only ever produce a corrupt document.
 * These helpers reject such values at the call site with a stable,
 * machine-readable code (`INVALID_NUMBER`) instead of letting them leak
 * into the serializer and surface as an untyped failure at render time.
 */
import { FastPDFError } from "./errors";

/**
 * Largest magnitude a PDF real may take before `String()` switches to
 * exponent notation, which ISO 32000-1 §7.3.3 forbids. Kept in sync with
 * the guard in `fmtNumber` (src/pdf/objects.ts), the last line of defence.
 */
export const MAX_PDF_NUMBER = 1e21;

/** Reject NaN, ±Infinity, non-numbers and out-of-range magnitudes. */
export function assertFinite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FastPDFError(`${name} must be a finite number (got ${value})`, "INVALID_NUMBER");
  }
  if (Math.abs(value) >= MAX_PDF_NUMBER) {
    throw new FastPDFError(`${name} is too large for a PDF number (got ${value})`, "INVALID_NUMBER");
  }
  return value;
}

/**
 * URI schemes that PDF viewers may hand straight to the OS or a script
 * engine. Rejected wherever a link target is set, so untrusted data — a
 * value flowing into `link()`, or an annotation inside an imported PDF —
 * cannot turn a document into a script or local-file launcher.
 */
const BLOCKED_URI_SCHEMES = new Set(["javascript", "vbscript", "data", "file"]);

/**
 * The blocked scheme of a URI, or null when it is safe to emit.
 * Control characters and spaces are stripped before matching so they cannot
 * disguise the scheme ("java\nscript:" and friends).
 */
export function blockedUriScheme(target: string): string | null {
  const compact = target.replace(/[\x00-\x20\x7f]/g, "");
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact)?.[1]?.toLowerCase();
  return scheme !== undefined && BLOCKED_URI_SCHEMES.has(scheme) ? scheme : null;
}

/** Reject anything that is not a finite number `>= 0`. */
export function assertNonNegative(value: number, name: string): number {
  assertFinite(value, name);
  if (value < 0) {
    throw new FastPDFError(`${name} must not be negative (got ${value})`, "INVALID_NUMBER");
  }
  return value;
}
