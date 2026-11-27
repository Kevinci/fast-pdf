import type { TableSlice } from "./ttf";

/**
 * OpenType layout features — the two that make Latin text look set rather
 * than typed: pair kerning and standard ligatures.
 *
 * What is read:
 *
 * - **Kerning** from `GPOS` (feature `kern`, pair adjustment lookups, type 2,
 *   formats 1 and 2, directly or through an extension lookup), which is where
 *   every current font keeps it, and from the legacy `kern` table (format 0)
 *   when a font has no `GPOS` kerning.
 * - **Ligatures** from `GSUB` (feature `liga`, ligature substitution lookups,
 *   type 4, directly or through an extension lookup): fi, fl, ffi and
 *   whatever else the font defines as standard.
 *
 * What is deliberately not here: contextual lookups, mark positioning and
 * anything script-specific. This is not a shaping engine — Arabic and Indic
 * scripts need reordering and joining that two lookup types cannot give.
 *
 * A font file is untrusted input. Every read goes through a `DataView`, which
 * throws on an out-of-range offset, and the caller treats any throw as "this
 * font has no usable features". Loops are bounded by counts read from the
 * file, and the one place where a hostile file could make those counts
 * multiply — the ligature table, which is expanded up front — has a hard cap.
 */

export interface Ligature {
  /** The glyphs that must follow the first one, in order. */
  rest: number[];
  /** The glyph that replaces the whole sequence. */
  glyph: number;
}

export interface LayoutFeatures {
  /** Horizontal adjustment between two adjacent glyphs, in font units. */
  kern(left: number, right: number): number;
  /** Ligatures keyed by their first glyph, in the font's order of preference. */
  ligatures: Map<number, Ligature[]>;
}

const NONE: LayoutFeatures = { kern: () => 0, ligatures: new Map() };

/** Upper bound on ligatures expanded from one font; real fonts have dozens. */
const MAX_LIGATURES = 20_000;

const tagAt = (v: DataView, at: number): string =>
  String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

const popcount = (n: number): number => {
  let count = 0;
  for (let bits = n & 0xff; bits !== 0; bits >>= 1) count += bits & 1;
  return count;
};

/**
 * Offsets of the lookup tables a feature points at, for Latin text.
 *
 * The script is `latn`, else `DFLT`, else the first one listed; within it the
 * default language system. A font without a script list contributes every
 * feature carrying the tag.
 */
function lookupsFor(v: DataView, base: number, tag: string): number[] {
  const scriptList = base + v.getUint16(base + 4);
  const featureList = base + v.getUint16(base + 6);
  const lookupList = base + v.getUint16(base + 8);

  let allowed: Set<number> | null = null;
  const scriptCount = v.getUint16(scriptList);
  let script = 0;
  for (const wanted of ["latn", "DFLT"]) {
    for (let i = 0; i < scriptCount && script === 0; i++) {
      const record = scriptList + 2 + i * 6;
      if (tagAt(v, record) === wanted) script = scriptList + v.getUint16(record + 4);
    }
  }
  if (script === 0 && scriptCount > 0) script = scriptList + v.getUint16(scriptList + 2 + 4);
  if (script !== 0) {
    const defaultLangSys = v.getUint16(script);
    const langSys =
      defaultLangSys !== 0
        ? script + defaultLangSys
        : v.getUint16(script + 2) > 0
          ? script + v.getUint16(script + 4 + 4)
          : 0;
    if (langSys !== 0) {
      allowed = new Set();
      const required = v.getUint16(langSys + 2);
      if (required !== 0xffff) allowed.add(required);
      const count = v.getUint16(langSys + 4);
      for (let i = 0; i < count; i++) allowed.add(v.getUint16(langSys + 6 + i * 2));
    }
  }

  const indices = new Set<number>();
  const featureCount = v.getUint16(featureList);
  for (let i = 0; i < featureCount; i++) {
    const record = featureList + 2 + i * 6;
    if (tagAt(v, record) !== tag || (allowed !== null && !allowed.has(i))) continue;
    const feature = featureList + v.getUint16(record + 4);
    const count = v.getUint16(feature + 2);
    for (let j = 0; j < count; j++) indices.add(v.getUint16(feature + 4 + j * 2));
  }

  const lookupCount = v.getUint16(lookupList);
  return [...indices]
    .filter((index) => index < lookupCount)
    .sort((a, b) => a - b)
    .map((index) => lookupList + v.getUint16(lookupList + 2 + index * 2));
}

/** Subtable offsets of one lookup that are of `type`, seeing through extension lookups. */
function subtablesOf(v: DataView, lookup: number, type: number, extensionType: number): number[] {
  const lookupType = v.getUint16(lookup);
  const count = v.getUint16(lookup + 4);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let subtable = lookup + v.getUint16(lookup + 6 + i * 2);
    let actual = lookupType;
    if (lookupType === extensionType) {
      actual = v.getUint16(subtable + 2);
      subtable += v.getUint32(subtable + 4);
    }
    if (actual === type) out.push(subtable);
  }
  return out;
}

/** Coverage index of a glyph, or -1. */
function coverageIndex(v: DataView, coverage: number, gid: number): number {
  const format = v.getUint16(coverage);
  let lo = 0;
  let hi = v.getUint16(coverage + 2) - 1;
  if (format === 1) {
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const glyph = v.getUint16(coverage + 4 + mid * 2);
      if (gid < glyph) hi = mid - 1;
      else if (gid > glyph) lo = mid + 1;
      else return mid;
    }
    return -1;
  }
  if (format === 2) {
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const range = coverage + 4 + mid * 6;
      if (gid < v.getUint16(range)) hi = mid - 1;
      else if (gid > v.getUint16(range + 2)) lo = mid + 1;
      else return v.getUint16(range + 4) + (gid - v.getUint16(range));
    }
  }
  return -1;
}

/** Class of a glyph in a class definition table (0 when unlisted). */
function classOf(v: DataView, classDef: number, gid: number): number {
  const format = v.getUint16(classDef);
  if (format === 1) {
    const start = v.getUint16(classDef + 2);
    const count = v.getUint16(classDef + 4);
    return gid >= start && gid < start + count ? v.getUint16(classDef + 6 + (gid - start) * 2) : 0;
  }
  if (format === 2) {
    let lo = 0;
    let hi = v.getUint16(classDef + 2) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const range = classDef + 4 + mid * 6;
      if (gid < v.getUint16(range)) hi = mid - 1;
      else if (gid > v.getUint16(range + 2)) lo = mid + 1;
      else return v.getUint16(range + 4);
    }
  }
  return 0;
}

/**
 * The xAdvance of the first glyph's value record in one pair subtable, or
 * `undefined` when the subtable does not apply to this pair.
 */
function pairAdjustment(
  v: DataView,
  subtable: number,
  left: number,
  right: number,
): number | undefined {
  const format = v.getUint16(subtable);
  const index = coverageIndex(v, subtable + v.getUint16(subtable + 2), left);
  if (index < 0) return undefined;
  const format1 = v.getUint16(subtable + 4);
  const format2 = v.getUint16(subtable + 6);
  // xAdvance is the third field of a value record; the two before it
  // (xPlacement, yPlacement) are present only when their bits are set.
  const advanceAt = format1 & 0x4 ? 2 * popcount(format1 & 0x3) : -1;
  const recordSize = 2 * (popcount(format1) + popcount(format2));

  if (format === 1) {
    if (index >= v.getUint16(subtable + 8)) return undefined;
    const pairSet = subtable + v.getUint16(subtable + 10 + index * 2);
    const size = 2 + recordSize;
    let lo = 0;
    let hi = v.getUint16(pairSet) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const record = pairSet + 2 + mid * size;
      const second = v.getUint16(record);
      if (right < second) hi = mid - 1;
      else if (right > second) lo = mid + 1;
      else return advanceAt < 0 ? 0 : v.getInt16(record + 2 + advanceAt);
    }
    return undefined;
  }
  if (format === 2) {
    const class1 = classOf(v, subtable + v.getUint16(subtable + 8), left);
    const class2 = classOf(v, subtable + v.getUint16(subtable + 10), right);
    const class1Count = v.getUint16(subtable + 12);
    const class2Count = v.getUint16(subtable + 14);
    if (class1 >= class1Count || class2 >= class2Count) return undefined;
    const record = subtable + 16 + (class1 * class2Count + class2) * recordSize;
    return advanceAt < 0 ? 0 : v.getInt16(record + advanceAt);
  }
  return undefined;
}

/** Kerning from `GPOS`: one list of pair subtables per lookup. */
function gposKerning(v: DataView, base: number): ((l: number, r: number) => number) | null {
  const lookups = lookupsFor(v, base, "kern")
    .map((lookup) => subtablesOf(v, lookup, 2, 9))
    .filter((subtables) => subtables.length > 0);
  if (lookups.length === 0) return null;
  return (left, right) => {
    let total = 0;
    for (const subtables of lookups) {
      // Within a lookup the first subtable that applies wins; lookups add up.
      for (const subtable of subtables) {
        const value = pairAdjustment(v, subtable, left, right);
        if (value !== undefined) {
          total += value;
          break;
        }
      }
    }
    return total;
  };
}

/** Kerning from the legacy `kern` table (version 0, horizontal format-0 subtables). */
function legacyKerning(v: DataView, table: TableSlice): ((l: number, r: number) => number) | null {
  if (v.getUint16(table.offset) !== 0) return null;
  const pairs = new Map<number, number>();
  let at = table.offset + 4;
  const count = v.getUint16(table.offset + 2);
  for (let i = 0; i < count; i++) {
    const length = v.getUint16(at + 2);
    const coverage = v.getUint16(at + 4);
    // Format 0, horizontal, not cross-stream, not minimum.
    if (coverage >> 8 === 0 && (coverage & 0x7) === 0x1) {
      const pairCount = v.getUint16(at + 6);
      for (let j = 0; j < pairCount; j++) {
        const pair = at + 14 + j * 6;
        const key = v.getUint16(pair) * 0x10000 + v.getUint16(pair + 2);
        pairs.set(key, (pairs.get(key) ?? 0) + v.getInt16(pair + 4));
      }
    }
    if (length === 0) break;
    at += length;
  }
  return pairs.size > 0 ? (left, right) => pairs.get(left * 0x10000 + right) ?? 0 : null;
}

function gsubLigatures(v: DataView, base: number): Map<number, Ligature[]> {
  const out = new Map<number, Ligature[]>();
  let budget = MAX_LIGATURES;
  for (const lookup of lookupsFor(v, base, "liga")) {
    for (const subtable of subtablesOf(v, lookup, 4, 7)) {
      if (v.getUint16(subtable) !== 1) continue;
      const coverage = subtable + v.getUint16(subtable + 2);
      const setCount = v.getUint16(subtable + 4);
      // Coverage lists the first glyphs in the order of the ligature sets.
      const firsts = coverageGlyphs(v, coverage, setCount);
      for (let i = 0; i < setCount && i < firsts.length; i++) {
        const set = subtable + v.getUint16(subtable + 6 + i * 2);
        const ligatureCount = v.getUint16(set);
        for (let j = 0; j < ligatureCount; j++) {
          if (--budget < 0) return out;
          const ligature = set + v.getUint16(set + 2 + j * 2);
          const components = v.getUint16(ligature + 2);
          if (components < 2) continue;
          const rest: number[] = [];
          for (let k = 0; k < components - 1; k++) rest.push(v.getUint16(ligature + 4 + k * 2));
          let list = out.get(firsts[i]!);
          if (list === undefined) out.set(firsts[i]!, (list = []));
          list.push({ rest, glyph: v.getUint16(ligature) });
        }
      }
    }
  }
  return out;
}

/** The first `limit` glyphs of a coverage table, in coverage-index order. */
function coverageGlyphs(v: DataView, coverage: number, limit: number): number[] {
  const format = v.getUint16(coverage);
  const count = v.getUint16(coverage + 2);
  const out: number[] = [];
  if (format === 1) {
    for (let i = 0; i < count && out.length < limit; i++) {
      out.push(v.getUint16(coverage + 4 + i * 2));
    }
  } else if (format === 2) {
    for (let i = 0; i < count && out.length < limit; i++) {
      const range = coverage + 4 + i * 6;
      const end = v.getUint16(range + 2);
      for (let gid = v.getUint16(range); gid <= end && out.length < limit; gid++) out.push(gid);
    }
  }
  return out;
}

/**
 * Read the layout features of a font. Never throws: a font whose tables are
 * missing, unsupported or malformed simply has no features.
 */
export function readLayoutFeatures(
  view: DataView,
  tables: Map<string, TableSlice>,
): LayoutFeatures {
  let kern: ((left: number, right: number) => number) | null = null;
  let ligatures = new Map<number, Ligature[]>();

  const attempt = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };

  const gpos = tables.get("GPOS");
  if (gpos) kern = attempt(() => gposKerning(view, gpos.offset), null);
  const legacy = tables.get("kern");
  if (kern === null && legacy) kern = attempt(() => legacyKerning(view, legacy), null);
  const gsub = tables.get("GSUB");
  if (gsub) ligatures = attempt(() => gsubLigatures(view, gsub.offset), ligatures);

  if (kern === null && ligatures.size === 0) return NONE;

  // A pair lookup walks several tables; text repeats the same pairs endlessly.
  const cache = new Map<number, number>();
  const lookup = kern;
  return {
    ligatures,
    kern:
      lookup === null
        ? NONE.kern
        : (left, right) => {
            const key = left * 0x10000 + right;
            let value = cache.get(key);
            if (value === undefined) {
              value = attempt(() => lookup(left, right), 0);
              cache.set(key, value);
            }
            return value;
          },
  };
}
