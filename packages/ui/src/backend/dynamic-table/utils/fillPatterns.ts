// utils/fillPatterns.ts
//
// Fill-series pattern detection and extrapolation. PURE: no store, no React,
// no DOM. Where Excel has an established behaviour, that behaviour is the
// specification — nothing here is invented UX.
//
// The chain is ordered and `copy` is terminal, so today's shipped behaviour
// (drag a value down, get that value repeated) is the floor: a seed that
// matches no series still fills, it just fills by copying.
//
//   1. weekdayStep  Mon-Fri dates whose delta is a whole number of WEEKDAYS
//   2. dateStep     day / month / year steps on a `type: 'date'` column
//   3. numericStep  finite numbers with an exact constant delta
//   4. suffixStep   `REF-001` -> `REF-002`, zero-padding preserved
//   5. copy         cyclic tiling of the seed — always matches
//
// `at(i)` takes a SIGNED index: `at(0)..at(k-1)` reproduce the seed, `at(k)`
// and up extend forwards, `at(-1)` and down extend backwards. That single
// signed accessor is why up/left fill needs no separate code path.

import type { ColumnDef } from '../types/index';

// ============================================
// TYPES
// ============================================
// These belong in `types/index.ts` alongside `FillPreview` once Wave 3 rewrites
// it; they live here so this module ships without touching the shared type file.

/** Continue the series, or tile the seed. `Ctrl`/`Alt` inverts the default. */
export type FillMode = 'series' | 'copy';

/** One line of the fill source: a source column (vertical) or row (horizontal). */
export interface FillSeed {
  /** Seed values in fill order: top-to-bottom vertically, left-to-right horizontally. */
  values: unknown[];
  /** The column the seed came from — supplies `type`, `source` and `fillSeries`. */
  column: ColumnDef;
}

export interface FillPattern {
  kind: 'numeric' | 'date' | 'weekday' | 'suffix' | 'copy';
  /** Mode used when no modifier is held. Excel differs per pattern. */
  defaultMode: FillMode;
  /** Value at signed seed index `i`. */
  at(i: number): unknown;
}

export type FillDetector = (seed: FillSeed) => FillPattern | null;

// ============================================
// SHARED HELPERS
// ============================================

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Cyclic tiling, correct for negative indices: `at(-1)` is the LAST seed value. */
function cyclic<T>(values: readonly T[], i: number): T {
  const k = values.length;
  return values[((i % k) + k) % k];
}

function copyPattern(seed: FillSeed): FillPattern {
  const values = seed.values.length > 0 ? seed.values : [undefined];
  return { kind: 'copy', defaultMode: 'copy', at: (i) => cyclic(values, i) };
}

/** Every delta between consecutive entries is the same value. */
function constantDelta(nums: number[], epsilon = 1e-9): number | null {
  if (nums.length < 2) return null;
  const step = nums[1] - nums[0];
  for (let i = 2; i < nums.length; i++) {
    if (Math.abs(nums[i] - nums[i - 1] - step) > epsilon) return null;
  }
  return step;
}

// --- numbers -------------------------------------------------------------

/**
 * Parse a stored cell value as a number. Accepts the `pl` decimal comma and
 * space/NBSP thousands separators, because that is what a Polish Excel puts in
 * a cell. Rejects zero-padded digit strings (`007`) — those are identifiers and
 * belong to `suffixStep`, which preserves the padding.
 */
function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;
  if (/^[+-]?0\d/.test(raw)) return null;
  const normalised = raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normalised)) return null;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

function decimalsOf(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : String(value ?? '');
  const match = /[.,](\d+)$/.exec(text.trim());
  return match ? match[1].length : 0;
}

function roundTo(value: number, decimals: number): number {
  if (decimals <= 0) return Math.round(value);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// --- dates ---------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/**
 * Parse a date cell. `YYYY-MM-DD` (what the grid stores) and `Date` instances
 * only, plus a last-resort `Date` parse — deliberately narrow, because the
 * caller must never date-parse a column that is not `type: 'date'`.
 */
function parseYmd(value: unknown): Ymd | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
}

function formatYmd({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days since 1970-01-01, computed in UTC so no timezone can shift a date. */
function ymdToDays({ y, m, d }: Ymd): number {
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function daysToYmd(days: number): Ymd {
  const date = new Date(days * MS_PER_DAY);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 (day 0) was a Thursday. */
function dayOfWeek(days: number): number {
  return ((days % 7) + 7 + 4) % 7;
}

function isWeekday(days: number): boolean {
  const dow = dayOfWeek(days);
  return dow >= 1 && dow <= 5;
}

/**
 * Monotonic index over Mon-Fri days only: consecutive weekdays differ by 1, so
 * Friday -> Monday is +1 and the "skip the weekend" rule needs no special case.
 */
function weekdayIndex(days: number): number {
  const dow = dayOfWeek(days);
  const week = Math.floor((days + 3) / 7);
  return week * 5 + (dow - 1);
}

function weekdayIndexToDays(index: number): number {
  const week = Math.floor(index / 5);
  const rest = ((index % 5) + 5) % 5;
  return week * 7 - 3 + rest;
}

function monthIndex({ y, m }: Ymd): number {
  return y * 12 + (m - 1);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function fromMonthIndex(index: number, day: number): Ymd {
  const y = Math.floor(index / 12);
  const m = (((index % 12) + 12) % 12) + 1;
  // Excel clamps: 31 Jan + 1 month = 28/29 Feb.
  return { y, m, d: Math.min(day, daysInMonth(y, m)) };
}

// ============================================
// DETECTORS
// ============================================

/**
 * 1. Weekday step. Runs BEFORE `dateStep`: `Fri, Mon, Tue` has day deltas
 * 3,1 and would die there, while as weekdays it is an unambiguous +1. A
 * Fri->Mon seed admits no other reading, so inferring it is not inventing UX.
 *
 * CONSECUTIVE WEEKDAYS ONLY (`|step| === 1`). "Both seeds happen to fall on a
 * weekday" is NOT the signal — that reading hijacked every wide date step whose
 * endpoints missed the weekend: `01.02.2027` + `11.02.2027` are ten CALENDAR
 * days apart but eight WEEKDAYS apart, and the series came out 23.02, 05.03,
 * 17.03 where Excel gives 21.02, 03.03, 13.03 (ledger row 1.16). A step of one
 * weekday is the only delta a user cannot have meant as anything else; every
 * other delta belongs to `dateStep`, which reads it as plain days.
 */
export const weekdayStep: FillDetector = (seed) => {
  if (seed.column.type !== 'date') return null;
  if (seed.values.length < 2) return null;
  const days: number[] = [];
  for (const value of seed.values) {
    const ymd = parseYmd(value);
    if (!ymd) return null;
    const d = ymdToDays(ymd);
    if (!isWeekday(d)) return null;
    days.push(d);
  }
  const indices = days.map(weekdayIndex);
  const step = constantDelta(indices);
  if (step === null || Math.abs(step) !== 1) return null;
  const base = indices[0];
  return {
    kind: 'weekday',
    defaultMode: 'series',
    at: (i) => formatYmd(daysToYmd(weekdayIndexToDays(base + step * i))),
  };
};

/**
 * 2. Date step — Excel's own ladder: constant day delta, else a whole-month
 * step on the same day-of-month (which covers whole years as a x12 month
 * step), else no match. A single date seeds +1 day.
 */
export const dateStep: FillDetector = (seed) => {
  if (seed.column.type !== 'date') return null;
  const parsed: Ymd[] = [];
  for (const value of seed.values) {
    const ymd = parseYmd(value);
    if (!ymd) return null;
    parsed.push(ymd);
  }
  if (parsed.length === 0) return null;

  if (parsed.length === 1) {
    const base = ymdToDays(parsed[0]);
    return { kind: 'date', defaultMode: 'series', at: (i) => formatYmd(daysToYmd(base + i)) };
  }

  // Month step is tested FIRST. Two dates always have a constant day delta, so
  // testing days first would read 31 Dec -> 31 Jan as "every 31 days" and land
  // on 3 March. Sharing a day-of-month is the unambiguous signal that the user
  // meant months — Excel reads it the same way.
  const sameDayOfMonth = parsed.every((p) => p.d === parsed[0].d);
  if (sameDayOfMonth) {
    const months = parsed.map(monthIndex);
    const monthStep = constantDelta(months);
    if (monthStep !== null && monthStep !== 0) {
      const base = months[0];
      const day = parsed[0].d;
      return {
        kind: 'date',
        defaultMode: 'series',
        at: (i) => formatYmd(fromMonthIndex(base + monthStep * i, day)),
      };
    }
  }

  const days = parsed.map(ymdToDays);
  const dayStep = constantDelta(days);
  if (dayStep !== null && dayStep !== 0) {
    const base = days[0];
    return { kind: 'date', defaultMode: 'series', at: (i) => formatYmd(daysToYmd(base + dayStep * i)) };
  }

  return null;
};

/**
 * 3. Numeric step. A single number DEFAULTS TO COPY — Excel's asymmetry with
 * dates, kept — and `Ctrl` turns it into +1. Two or more require an EXACT
 * constant delta: `1, 2, 4` falls through to copy rather than regressing to
 * 5.5, because a freight user reads a regression result as a bug.
 */
export const numericStep: FillDetector = (seed) => {
  const nums: number[] = [];
  for (const value of seed.values) {
    const n = parseNumeric(value);
    if (n === null) return null;
    nums.push(n);
  }
  if (nums.length === 0) return null;

  const decimals = seed.values.reduce<number>((max, v) => Math.max(max, decimalsOf(v)), 0);

  if (nums.length === 1) {
    const base = nums[0];
    return { kind: 'numeric', defaultMode: 'copy', at: (i) => roundTo(base + i, decimals) };
  }

  const step = constantDelta(nums, 10 ** -(decimals + 6));
  if (step === null) return null;
  const base = nums[0];
  return { kind: 'numeric', defaultMode: 'series', at: (i) => roundTo(base + step * i, decimals) };
};

const SUFFIX_RE = /^(.*?)(\d+)(\D*)$/;

/**
 * 4. Text with a trailing number: `REF-001` -> `REF-002`. Prefix and trailing
 * part must be identical across the seed. Zero-padding comes from the first
 * seed value and widens on overflow (`REF-999` -> `REF-1000`).
 */
export const suffixStep: FillDetector = (seed) => {
  let prefix: string | null = null;
  let tail: string | null = null;
  let width = 0;
  const nums: number[] = [];

  for (const value of seed.values) {
    if (typeof value !== 'string') return null;
    const match = SUFFIX_RE.exec(value);
    if (!match) return null;
    const [, p, digits, t] = match;
    if (prefix === null) {
      prefix = p;
      tail = t;
      width = digits.length;
    } else if (p !== prefix || t !== tail) {
      return null;
    }
    nums.push(Number(digits));
  }
  if (prefix === null || nums.length === 0) return null;

  const step = nums.length === 1 ? 1 : constantDelta(nums);
  if (step === null) return null;
  const base = nums[0];
  const head = prefix;
  const foot = tail ?? '';
  return {
    kind: 'suffix',
    defaultMode: 'series',
    at: (i) => {
      const n = base + step * i;
      const sign = n < 0 ? '-' : '';
      return `${head}${sign}${String(Math.abs(n)).padStart(width, '0')}${foot}`;
    },
  };
};

/** The ordered chain. First match wins; `copy` is applied after it. */
export const fillDetectors: readonly FillDetector[] = [weekdayStep, dateStep, numericStep, suffixStep];

// ============================================
// ENTRY POINTS
// ============================================

/**
 * Never returns null — `copy` is terminal, so an unrecognised seed still fills.
 *
 * Hard gates, before the chain runs:
 *  - `column.fillSeries === 'copy'` — a per-column opt-out for identity fields;
 *  - `dropdown` / `multiselect` / `boolean` — a `source` array is a presentation
 *    order, not a semantic sequence; cycling Draft -> Sent -> Paid -> Draft is
 *    not something a dispatcher asked for;
 *  - an all-blank seed has nothing to continue.
 */
export function detectFillPattern(seed: FillSeed): FillPattern {
  const column = seed.column;
  if (column.fillSeries === 'copy') return copyPattern(seed);
  if (column.type === 'dropdown' || column.type === 'multiselect' || column.type === 'boolean') {
    return copyPattern(seed);
  }
  if (seed.values.length === 0 || seed.values.every(isBlank)) return copyPattern(seed);

  for (const detect of fillDetectors) {
    const pattern = detect(seed);
    if (pattern) return pattern;
  }
  return copyPattern(seed);
}

/** `Ctrl`/`Alt` inverts copy <-> series. Applied by the CALLER, not a detector. */
export function invertFillMode(mode: FillMode): FillMode {
  return mode === 'series' ? 'copy' : 'series';
}

/**
 * Values for `count` cells beyond one seed line.
 *
 * `direction: 1` extends past the END of the seed (down / right);
 * `direction: -1` extends past its START (up / left).
 *
 * **Ordering**: the returned values are always ADJACENT-TO-SOURCE FIRST. For a
 * backwards fill, `result[0]` belongs in the cell immediately above/left of the
 * source and `result[n-1]` in the furthest one. The caller walks its target
 * cells outwards from the source in both directions, so it never has to reverse
 * this array.
 */
export function generateFill(
  seed: FillSeed,
  count: number,
  direction: 1 | -1,
  mode: FillMode,
): unknown[] {
  if (count <= 0) return [];
  const pattern = mode === 'copy' ? copyPattern(seed) : detectFillPattern(seed);
  const k = Math.max(seed.values.length, 1);
  const out: unknown[] = [];
  for (let n = 0; n < count; n++) {
    // Forwards continues at k, k+1, …; backwards at -1, -2, … — both walking
    // away from the source one step at a time.
    out.push(pattern.at(direction === 1 ? k + n : -1 - n));
  }
  return out;
}
