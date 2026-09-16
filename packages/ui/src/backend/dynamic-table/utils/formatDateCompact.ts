/**
 * DynamicTable — COMPACT DATE FORMATTING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dates are the single biggest space consumer in the container table, and the
 * 3 Aug 2026 INF workshops recorded two SEPARATE complaints about them:
 *
 *   A8 (i)  FORMAT. "Date rendering takes too much space AND is inconsistent."
 *           After the migration some values carry a time, some do not, some
 *           lack the year. This file defines ONE deterministic rule set and
 *           applies it to every shape the data actually arrives in.
 *
 *   A8 (ii) MODEL. Three date levels — planned / estimated / actual — are
 *           crushed into one cell and distinguished only by COLOUR plus a 9px
 *           letter. Agnieszka wants estimated and actual visibly separate;
 *           Szymon preferred an earlier icon-based variant. `formatLevels()`
 *           below carries the level in a GLYPH (shape = meaning, colour = mere
 *           reinforcement) and costs zero extra horizontal space.
 *
 *   B14     ISO WEEK NUMBERS. Klaudiusz reads them constantly — when a topic
 *           needs attention, when a vessel ETA falls. `isoWeek()` here is
 *           correct across year boundaries (the classic bug) and the week can
 *           be shown alongside or instead of the date.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERFORMANCE CONTRACT — read before editing
 *
 * The grid virtualizes ROWS ONLY. `VirtualRow` does a plain `columns.map`, so
 * EVERY column of EVERY mounted row renders, and denser tables mount MORE
 * cells. Anything in here is executed thousands of times per render pass.
 *
 * Three rules hold the line, in order of how much they buy:
 *
 *   1. RESULTS ARE MEMOISED PER FORMATTER, keyed on the raw string. On scroll
 *      the same values re-render constantly, so the steady state is a single
 *      `Map.get` returning a FROZEN, SHARED object — no parse, no allocation,
 *      not even for the key (the raw string IS the key). The cache is bounded
 *      by a two-generation swap, so it cannot leak on a long-lived page.
 *
 *   2. PARSING IS charCode ARITHMETIC, not regex and not `new Date()`.
 *      `String.prototype.exec` allocates a match array per call; module-level
 *      regexes fix the compile cost but not the allocation. A `Date` is
 *      constructed ONLY for values that genuinely need timezone conversion
 *      (an instant with a non-zero UTC time), and only on a cache miss.
 *
 *   3. `Intl.DateTimeFormat` IS NEVER CONSTRUCTED PER CALL — nor per cell, nor
 *      per render. It is constructed exactly ONCE PER LOCALE, ever, to probe
 *      that locale's day/month order and separator (`localePattern`). Every
 *      subsequent format is string concatenation over cached primitives.
 *
 * There is no `date-fns` import here on purpose. `format()` re-parses its
 * pattern string on every call; at 20 columns × 60 mounted rows that is the
 * difference between a smooth scroll and a janky one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// ISO-8601 WEEK ARITHMETIC
//
// Implemented on the proleptic Gregorian calendar with pure integer maths
// (Howard Hinnant's civil-date algorithms). No `Date`, no allocation, no
// timezone involvement — the week of a calendar date is a property of that
// date, not of an instant.
//
// The classic bug this avoids: computing the week from "day-of-year / 7". That
// is wrong at every year boundary. 1 Jan 2021 is in week 53 OF 2020; 31 Dec
// 2019 is in week 1 OF 2020. ISO-8601 defines the week by its THURSDAY, which
// is what the code below actually computes.
// ─────────────────────────────────────────────────────────────────────────────

/** Days since 1970-01-01 for a proleptic Gregorian y/m/d. Exact for any year. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400 // [0, 399]
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1 // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy // [0, 146096]
  return era * 146097 + doe - 719468
}

/** Calendar YEAR of a days-since-epoch value. (Inverse of `daysFromCivil`, year only.) */
export function yearFromDays(days: number): number {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097 // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const m = mp + (mp < 10 ? 3 : -9)
  return y + (m <= 2 ? 1 : 0)
}

/**
 * ISO-8601 weekday, Monday = 0 … Sunday = 6.
 * (1970-01-01 was a Thursday, i.e. index 3 — hence the `+ 3`.)
 */
export function isoWeekday(year: number, month: number, day: number): number {
  const z = daysFromCivil(year, month, day)
  return ((z + 3) % 7 + 7) % 7
}

/**
 * ISO-8601 week number (1–53) of a calendar date.
 *
 * Definition, and the reason this is not "day-of-year / 7": a week belongs to
 * the year that contains its THURSDAY. So we jump to this week's Thursday,
 * take THAT date's year as the ISO year, and count weeks from that ISO year's
 * 1 January.
 */
export function isoWeek(year: number, month: number, day: number): number {
  const z = daysFromCivil(year, month, day)
  const dow = ((z + 3) % 7 + 7) % 7 // 0 = Monday
  const thursday = z + 3 - dow
  const isoYear = yearFromDays(thursday)
  const jan1 = daysFromCivil(isoYear, 1, 1)
  return Math.floor((thursday - jan1) / 7) + 1
}

/**
 * The YEAR the ISO week belongs to, which is NOT always the calendar year.
 * 2021-01-01 → 2020 (week 53). 2019-12-30 → 2020 (week 1).
 * Needed whenever a week number is stored, filtered or sorted rather than just
 * shown next to its own date.
 */
export function isoWeekYear(year: number, month: number, day: number): number {
  const z = daysFromCivil(year, month, day)
  const dow = ((z + 3) % 7 + 7) % 7
  return yearFromDays(z + 3 - dow)
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSING
// ─────────────────────────────────────────────────────────────────────────────

export type DateInput = string | number | Date | null | undefined

/**
 * A timestamp decomposed into the parts we actually render.
 *
 * `hasTime` and `isMidnight` are kept SEPARATE on purpose. "This value carries
 * no time at all" and "this value carries a time that happens to be 00:00" are
 * different facts about the data, and A8(i) is precisely the complaint that the
 * migration blurred them. The formatter decides what to do; the parser only
 * reports.
 */
export type TimestampParts = {
  year: number
  month: number // 1–12
  day: number // 1–31
  hours: number // 0–23
  minutes: number // 0–59
  /** The source string/value carried a time component at all. */
  hasTime: boolean
  /** `hasTime` and that time is exactly 00:00. */
  isMidnight: boolean
  /** The source was an instant that we converted into the viewer's local zone. */
  wasInstant: boolean
}

const CH_DASH = 45
const CH_T_UPPER = 84
const CH_T_LOWER = 116
const CH_SPACE = 32
const CH_COLON = 58
const CH_Z_UPPER = 90
const CH_Z_LOWER = 122
const CH_PLUS = 43
const CH_ZERO = 48

/** Two ASCII digits at `i`, or -1. Allocation-free. */
function digits2(s: string, i: number): number {
  const a = s.charCodeAt(i) - CH_ZERO
  const b = s.charCodeAt(i + 1) - CH_ZERO
  if (a < 0 || a > 9 || b < 0 || b > 9) return -1
  return a * 10 + b
}

/** Four ASCII digits at `i`, or -1. Allocation-free. */
function digits4(s: string, i: number): number {
  const a = s.charCodeAt(i) - CH_ZERO
  const b = s.charCodeAt(i + 1) - CH_ZERO
  const c = s.charCodeAt(i + 2) - CH_ZERO
  const d = s.charCodeAt(i + 3) - CH_ZERO
  if (a < 0 || a > 9 || b < 0 || b > 9 || c < 0 || c > 9 || d < 0 || d > 9) return -1
  return a * 1000 + b * 100 + c * 10 + d
}

/**
 * True when every character from `from` up to (excluding) `to` is either an
 * ASCII zero, a colon or a dot — i.e. the time-of-day is exactly 00:00:00.000.
 * Used to recognise the migration artefact described in `parseTimestamp`.
 */
function isZeroTimeRun(s: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i)
    if (c !== CH_ZERO && c !== CH_COLON && c !== 46 /* . */) return false
  }
  return true
}

function partsFromDate(d: Date, wasInstant: boolean): TimestampParts {
  const hours = d.getHours()
  const minutes = d.getMinutes()
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hours,
    minutes,
    hasTime: true,
    isMidnight: hours === 0 && minutes === 0,
    wasInstant,
  }
}

/**
 * Decompose any value the grid can hand us into display parts, or `null` if it
 * is not a timestamp at all.
 *
 * Shapes handled — these are the ones that actually exist in the FMS data after
 * the migration, not a generous superset:
 *
 *   "2026-12-31"                    date-only            → no time, ever
 *   "2026-12-31T14:30"              naive local          → 14:30, no Date built
 *   "2026-12-31T14:30:00"           naive local          → 14:30, no Date built
 *   "2026-12-31 14:30:00"           Postgres text        → 14:30, no Date built
 *   "2026-12-31T14:30:00Z"          instant              → converted to local
 *   "2026-12-31T14:30:00+02:00"     instant with offset  → converted to local
 *   "2026-12-31T00:00:00.000Z"      SEE BELOW
 *   Date / epoch-ms number                               → local parts
 *
 * ── The UTC-midnight rule, and why it is not over-cleverness ────────────────
 * A value of exactly `00:00:00.000Z` is treated as the DATE-ONLY value of its
 * UTC calendar day: no time is shown and NO timezone conversion happens.
 *
 * That pattern is not a real freight timestamp. Nothing departs, arrives or
 * cuts off at midnight UTC; it is what a date-only column looks like after it
 * was migrated into a `timestamptz`. Treating it as an instant produces two
 * visible bugs, both reported in A8(i): a fabricated "02:00" in Warsaw, and —
 * for any viewer west of Greenwich — the WRONG DAY. Rendering the UTC calendar
 * date is the only reading that is stable for every viewer.
 *
 * The escape hatch is `midnight: 'show'`, which disables both this and the
 * local-midnight suppression.
 */
export function parseTimestamp(value: DateInput): TimestampParts | null {
  if (value == null || value === '') return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return partsFromDate(new Date(value), true)
  }

  if (typeof value === 'object') {
    // `instanceof Date` is deliberately avoided: values can cross a realm
    // boundary (an iframe, a worker) and fail it while still being a Date.
    const t = (value as Date).getTime?.()
    if (typeof t !== 'number' || Number.isNaN(t)) return null
    return partsFromDate(value as Date, true)
  }

  if (typeof value !== 'string') return null

  const raw = value
  const len = raw.length
  if (len < 10) return null
  if (raw.charCodeAt(4) !== CH_DASH || raw.charCodeAt(7) !== CH_DASH) return null

  const year = digits4(raw, 0)
  const month = digits2(raw, 5)
  const day = digits2(raw, 8)
  if (year < 0 || month < 1 || month > 12 || day < 1 || day > 31) return null

  if (len === 10) {
    return { year, month, day, hours: 0, minutes: 0, hasTime: false, isMidnight: false, wasInstant: false }
  }

  const sep = raw.charCodeAt(10)
  if (sep !== CH_T_UPPER && sep !== CH_T_LOWER && sep !== CH_SPACE) return null
  if (len < 16 || raw.charCodeAt(13) !== CH_COLON) return null

  const hours = digits2(raw, 11)
  const minutes = digits2(raw, 14)
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

  // Locate a zone marker. After index 15 a '-' can only be an offset sign.
  let zoneAt = -1
  let isUtc = false
  for (let i = 16; i < len; i++) {
    const c = raw.charCodeAt(i)
    if (c === CH_Z_UPPER || c === CH_Z_LOWER) { isUtc = true; zoneAt = i; break }
    if (c === CH_PLUS || c === CH_DASH) { zoneAt = i; break }
  }

  if (isUtc && hours === 0 && minutes === 0 && isZeroTimeRun(raw, 16, zoneAt)) {
    // The migration artefact. Render the UTC calendar day, no time, no shift.
    return { year, month, day, hours: 0, minutes: 0, hasTime: false, isMidnight: false, wasInstant: false }
  }

  if (zoneAt >= 0) {
    // A real instant: it must be shown in the viewer's zone, which requires the
    // platform's timezone database. This is the ONLY branch that allocates a
    // Date — and only on a cache miss.
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return null
    return partsFromDate(d, true)
  }

  // Naive local date-time: the string already IS wall-clock. No Date needed.
  return {
    year,
    month,
    day,
    hours,
    minutes,
    hasTime: true,
    isMidnight: hours === 0 && minutes === 0,
    wasInstant: false,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCALE PATTERN — one Intl construction per locale, ever
// ─────────────────────────────────────────────────────────────────────────────

type LocalePattern = {
  /** Day before month (pl, de, en-GB) vs month before day (en-US). */
  dayFirst: boolean
  /** The literal between the two numeric parts: "." for pl/de, "/" for en. */
  separator: string
}

const PROBE = new Date(Date.UTC(2026, 11, 31, 12, 0, 0)) // 31 Dec 2026, unambiguous
const localePatterns = new Map<string, LocalePattern>()
const FALLBACK_PATTERN: LocalePattern = { dayFirst: true, separator: '.' }

/**
 * Discover a locale's numeric day/month order and separator ONCE and cache it.
 *
 * This is the whole reason the hot path needs no `Intl`: after the first call
 * for a locale, formatting a date is `dd + sep + mm`, pure concatenation.
 */
function localePattern(locale: string): LocalePattern {
  const hit = localePatterns.get(locale)
  if (hit) return hit
  let pattern = FALLBACK_PATTERN
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).formatToParts(PROBE)
    let dayIndex = -1
    let monthIndex = -1
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === 'day') dayIndex = i
      else if (parts[i].type === 'month') monthIndex = i
    }
    if (dayIndex >= 0 && monthIndex >= 0) {
      // Only the literal BETWEEN the two numbers counts. Several locales (de)
      // append a trailing "." which must not become the separator.
      const lo = Math.min(dayIndex, monthIndex)
      const hi = Math.max(dayIndex, monthIndex)
      let separator = FALLBACK_PATTERN.separator
      for (let i = lo + 1; i < hi; i++) {
        if (parts[i].type === 'literal') { separator = parts[i].value; break }
      }
      pattern = { dayFirst: dayIndex < monthIndex, separator }
    }
  } catch {
    // A malformed locale tag must never break a grid. Fall back to the primary
    // locale's shape (pl → 31.12) rather than throwing.
    pattern = FALLBACK_PATTERN
  }
  localePatterns.set(locale, pattern)
  return pattern
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export type TimestampLevel = 'planned' | 'estimated' | 'actual'

/** The three levels, least to most certain. */
export const TIMESTAMP_LEVELS: readonly TimestampLevel[] = ['planned', 'estimated', 'actual'] as const

/**
 * The level glyphs — a CERTAINTY RAMP: hollow → half → solid.
 *
 * Shape carries the meaning, so the distinction survives greyscale, colour
 * blindness and a printed screenshot. Colour is applied on top by `DateCell`
 * as pure reinforcement, never as the sole carrier (WCAG 1.4.1).
 *
 * They are plain string characters, not SVG icons, for a reason that is
 * measured rather than aesthetic: an icon is a React element per cell, and the
 * grid renders every column of every mounted row. A character costs nothing.
 */
export const LEVEL_GLYPHS: Readonly<Record<TimestampLevel, string>> = {
  planned: '○', // ○ hollow — intended
  estimated: '◐', // ◐ half — expected
  actual: '●', // ● solid — happened
}

export type CompactDateConfig = {
  /** BCP-47 tag. Drives day/month order and separator only. Default `'pl'`. */
  locale?: string
  /**
   * `'auto'` (default) shows the time only when the value carries one.
   * `'never'` never shows it. `'always'` shows 00:00 for date-only values —
   * almost certainly wrong for freight data, provided for completeness.
   */
  showTime?: 'auto' | 'never' | 'always'
  /**
   * `'hide'` (default) suppresses an exactly-midnight time and treats a
   * `00:00:00Z` instant as a date. See `parseTimestamp` for why.
   * `'show'` renders midnight literally and converts UTC midnight to local.
   */
  midnight?: 'hide' | 'show'
  /**
   * `'elide-current'` (default) drops the year when it equals `referenceYear`.
   * This is where most of the saving comes from: in a live operational table
   * the overwhelming majority of rows are in the current year, and the year is
   * the least informative 3 characters on the screen.
   */
  yearMode?: 'elide-current' | 'always' | 'never'
  /** Width of the year when shown. Default 2 → "31.12.26". */
  yearDigits?: 2 | 4
  /**
   * `'off'` (default) · `'suffix'` → "31.12 W53" · `'only'` → "W53".
   * Workshop B14 — Klaudiusz reads ISO weeks constantly.
   */
  week?: 'off' | 'suffix' | 'only'
  /** Prefix for the week tag. Default `'W'`. */
  weekPrefix?: string
  /**
   * Year the elision compares against. Injectable for deterministic tests;
   * defaults to the year at formatter-creation time.
   */
  referenceYear?: number
  /** Shown for null/undefined/''. Default `'–'` (en dash). */
  emptyPlaceholder?: string
  /**
   * Shown for a present-but-unparseable value. Default `'?'`.
   * DELIBERATELY DIFFERENT from `emptyPlaceholder`: "no date" is normal, "this
   * date is broken" is a data bug someone should report. Never "Invalid Date".
   */
  invalidPlaceholder?: string
  /** Override the certainty-ramp glyphs. */
  glyphs?: Partial<Record<TimestampLevel, string>>
  /**
   * Words for the levels, used in the hover breakdown (screen readers read
   * these, not the glyphs). English defaults — see the i18n wiring contract.
   */
  levelLabels?: Partial<Record<TimestampLevel, string>>
}

type ResolvedConfig = Required<Omit<CompactDateConfig, 'glyphs' | 'levelLabels'>> & {
  glyphs: Record<TimestampLevel, string>
  levelLabels: Record<TimestampLevel, string>
}

const DEFAULT_LEVEL_LABELS: Record<TimestampLevel, string> = {
  planned: 'Planned',
  estimated: 'Estimated',
  actual: 'Actual',
}

function resolveConfig(config?: CompactDateConfig): ResolvedConfig {
  return {
    locale: config?.locale || 'pl',
    showTime: config?.showTime || 'auto',
    midnight: config?.midnight || 'hide',
    yearMode: config?.yearMode || 'elide-current',
    yearDigits: config?.yearDigits || 2,
    week: config?.week || 'off',
    weekPrefix: config?.weekPrefix ?? 'W',
    referenceYear: config?.referenceYear ?? new Date().getFullYear(),
    emptyPlaceholder: config?.emptyPlaceholder ?? '–',
    invalidPlaceholder: config?.invalidPlaceholder ?? '?',
    glyphs: config?.glyphs ? { ...LEVEL_GLYPHS, ...config.glyphs } : LEVEL_GLYPHS,
    levelLabels: config?.levelLabels
      ? { ...DEFAULT_LEVEL_LABELS, ...config.levelLabels }
      : DEFAULT_LEVEL_LABELS,
  }
}

function configKey(c: ResolvedConfig): string {
  return (
    `${c.locale}|${c.showTime}|${c.midnight}|${c.yearMode}|${c.yearDigits}|${c.week}|` +
    `${c.weekPrefix}|${c.referenceYear}|${c.emptyPlaceholder}|${c.invalidPlaceholder}|` +
    `${c.glyphs.planned}${c.glyphs.estimated}${c.glyphs.actual}|` +
    `${c.levelLabels.planned}/${c.levelLabels.estimated}/${c.levelLabels.actual}`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A formatted date, split into the parts a cell renders separately.
 *
 * Split rather than pre-joined because the density scale hides the low-value
 * parts with CSS at `dense` — which is only possible if they are their own
 * elements. `text` is the joined form for clipboard, export and tooltips.
 */
export type CompactDate = {
  kind: 'empty' | 'invalid' | 'value'
  /** "31.12" or "31.12.26". Empty string when there is nothing to show. */
  date: string
  /** "14:30", or '' when the value carries no (shown) time. */
  time: string
  /** "W53", or '' when weeks are off. */
  week: string
  /** ISO week number 1–53, or 0 when not derivable. Always computed. */
  weekNumber: number
  /** ISO week-owning year (NOT always the calendar year), or 0. */
  weekYear: number
  /** Everything joined with spaces — export, clipboard, tooltip. */
  text: string
  /** Epoch ms of the shown value, or NaN. For overdue/relative comparisons. */
  ms: number
}

const EMPTY_WEEK = { week: '', weekNumber: 0, weekYear: 0 }

function makeEmpty(c: ResolvedConfig): CompactDate {
  return Object.freeze({
    kind: 'empty' as const, date: '', time: '', ...EMPTY_WEEK, text: c.emptyPlaceholder, ms: NaN,
  })
}

function makeInvalid(c: ResolvedConfig): CompactDate {
  return Object.freeze({
    kind: 'invalid' as const, date: '', time: '', ...EMPTY_WEEK, text: c.invalidPlaceholder, ms: NaN,
  })
}

/** Two-digit zero pad without `padStart` (which allocates twice). */
const PAD = [
  '00', '01', '02', '03', '04', '05', '06', '07', '08', '09',
  '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '20', '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '40', '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '50', '51', '52', '53', '54', '55', '56', '57', '58', '59',
]
function pad2(n: number): string {
  return n >= 0 && n < 60 ? PAD[n] : String(n)
}

/** Non-breaking space: date and time must never wrap apart inside a cell. */
const NBSP = ' '

function buildCompactDate(p: TimestampParts, c: ResolvedConfig): CompactDate {
  const dd = pad2(p.day)
  const mm = pad2(p.month)
  const pattern = localePattern(c.locale)

  let date = pattern.dayFirst ? dd + pattern.separator + mm : mm + pattern.separator + dd
  const showYear =
    c.yearMode === 'always' ? true : c.yearMode === 'never' ? false : p.year !== c.referenceYear
  if (showYear) {
    date += pattern.separator + (c.yearDigits === 4 ? String(p.year) : pad2(((p.year % 100) + 100) % 100))
  }

  const wantsTime =
    c.showTime === 'always' ||
    (c.showTime === 'auto' && p.hasTime && !(c.midnight === 'hide' && p.isMidnight))
  const time = wantsTime ? pad2(p.hours) + ':' + pad2(p.minutes) : ''

  const weekNumber = isoWeek(p.year, p.month, p.day)
  const weekYear = isoWeekYear(p.year, p.month, p.day)
  const week = c.week === 'off' ? '' : c.weekPrefix + weekNumber

  if (c.week === 'only') {
    return Object.freeze({
      kind: 'value' as const,
      date: '',
      time: '',
      week,
      weekNumber,
      weekYear,
      text: week,
      ms: new Date(p.year, p.month - 1, p.day, p.hours, p.minutes).getTime(),
    })
  }

  let text = date
  if (time) text += NBSP + time
  if (week) text += NBSP + week

  return Object.freeze({
    kind: 'value' as const,
    date,
    time,
    week,
    weekNumber,
    weekYear,
    text,
    ms: new Date(p.year, p.month - 1, p.day, p.hours, p.minutes).getTime(),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL MODEL — A8(ii)
// ─────────────────────────────────────────────────────────────────────────────

export type CompactTimestamp = {
  /** The level actually shown, resolved actual > estimated > planned. */
  level: TimestampLevel | null
  /** The certainty glyph for that level, or '' when there is no value. */
  glyph: string
  /** The formatted date of the shown level. */
  date: CompactDate
  /** "+2d" / "−5h" / '' — ONE unit, the most significant. */
  variance: string
  /** +1 late, −1 early, 0 none. Drives colour; never the sole signal. */
  varianceSign: 0 | 1 | -1
  /** Multi-line breakdown of every known level. Tooltip + screen readers. */
  title: string
  /** True when all three levels are absent. */
  isEmpty: boolean
}

/**
 * Signed difference in minutes between two parsed values. When EITHER side is
 * date-only there is no time to compare, so the difference is measured in whole
 * CALENDAR DAYS — never spurious hours. This mirrors `computeDelay` in
 * `packages/projects/.../lib/timestamp-display.ts`; the semantics must not
 * diverge or the same shipment would show two different delays in two tables.
 */
function diffMinutes(later: TimestampParts, earlier: TimestampParts): number {
  const dl = daysFromCivil(later.year, later.month, later.day)
  const de = daysFromCivil(earlier.year, earlier.month, earlier.day)
  if (!later.hasTime || !earlier.hasTime) return (dl - de) * 1440
  return (dl - de) * 1440 + (later.hours * 60 + later.minutes) - (earlier.hours * 60 + earlier.minutes)
}

/**
 * ONE unit, the most significant — "+2d", not "+2d 3h".
 *
 * The two-unit form in `timestamp-display.formatDelay` costs 3–4 extra
 * characters in a column where characters are the scarce resource, and the
 * second unit almost never changes a decision. The exact figures stay in the
 * hover breakdown.
 */
function formatVariance(minutes: number): string {
  if (minutes === 0) return ''
  const sign = minutes > 0 ? '+' : '−' // U+2212 minus, matching the repo
  const abs = Math.abs(minutes)
  if (abs >= 1440) return sign + Math.floor(abs / 1440) + 'd'
  if (abs >= 60) return sign + Math.floor(abs / 60) + 'h'
  return sign + abs + 'm'
}

const EMPTY_TIMESTAMP_TITLE = ''

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTER
// ─────────────────────────────────────────────────────────────────────────────

export type CompactDateFormatter = {
  readonly config: ResolvedConfig
  /** Format a single value. Memoised on the raw string. */
  format(value: DateInput): CompactDate
  /** Format a planned/estimated/actual triplet. Memoised on the three strings. */
  formatLevels(
    planned: DateInput,
    estimated: DateInput,
    actual: DateInput,
  ): CompactTimestamp
  /** Test/diagnostic hook. Not part of the rendering path. */
  readonly _cacheSize: () => number
}

/**
 * Bounded memo. Two generations rather than a real LRU: when the hot map fills,
 * it becomes the cold map and a fresh hot map starts. A value still in use gets
 * promoted back on its next lookup, and everything else is dropped wholesale
 * when the next swap happens.
 *
 * Cost per swap is one allocation; cost per lookup is one or two `Map.get`.
 * A real LRU would need a doubly-linked list touched on EVERY hit — strictly
 * more work in the hot path to solve a problem a grid does not have.
 */
const CACHE_MAX = 4096

function createMemo<V>() {
  let hot = new Map<string, V>()
  let cold = new Map<string, V>()
  return {
    get(key: string): V | undefined {
      const h = hot.get(key)
      if (h !== undefined) return h
      const c = cold.get(key)
      if (c !== undefined) {
        hot.set(key, c) // promote — it is still live
        return c
      }
      return undefined
    },
    set(key: string, value: V): V {
      if (hot.size >= CACHE_MAX) {
        cold = hot
        hot = new Map<string, V>()
      }
      hot.set(key, value)
      return value
    },
    size(): number {
      return hot.size + cold.size
    },
  }
}

function buildFormatter(c: ResolvedConfig): CompactDateFormatter {
  const empty = makeEmpty(c)
  const invalid = makeInvalid(c)
  const values = createMemo<CompactDate>()
  const levels = createMemo<CompactTimestamp>()

  const emptyTimestamp: CompactTimestamp = Object.freeze({
    level: null,
    glyph: '',
    date: empty,
    variance: '',
    varianceSign: 0 as const,
    title: EMPTY_TIMESTAMP_TITLE,
    isEmpty: true,
  })

  function formatParsed(value: DateInput): CompactDate {
    if (value == null || value === '') return empty
    const parts = parseTimestamp(value)
    if (!parts) return invalid
    return buildCompactDate(parts, c)
  }

  function format(value: DateInput): CompactDate {
    // Only strings are memoised. A `Date`/number has no stable cheap key, and
    // grids overwhelmingly carry ISO strings — building a key for the rare case
    // would tax the common one.
    if (typeof value !== 'string') return formatParsed(value)
    if (value === '') return empty
    const hit = values.get(value)
    if (hit !== undefined) return hit
    return values.set(value, formatParsed(value))
  }

  function formatLevels(
    planned: DateInput,
    estimated: DateInput,
    actual: DateInput,
  ): CompactTimestamp {
    const canCache =
      (planned == null || typeof planned === 'string') &&
      (estimated == null || typeof estimated === 'string') &&
      (actual == null || typeof actual === 'string')
    let key = ''
    if (canCache) {
      key = `${planned ?? ''} ${estimated ?? ''} ${actual ?? ''}`
      const hit = levels.get(key)
      if (hit !== undefined) return hit
    }

    const p = planned ? parseTimestamp(planned) : null
    const e = estimated ? parseTimestamp(estimated) : null
    const a = actual ? parseTimestamp(actual) : null

    // Precedence actual > estimated > planned — the most "real" known time.
    // Identical to `resolveLegTimestamp` in the folders module; the two must
    // agree or the transport table and the container table would disagree
    // about the same shipment.
    let level: TimestampLevel | null = null
    let shown: TimestampParts | null = null
    if (a) { level = 'actual'; shown = a }
    else if (e) { level = 'estimated'; shown = e }
    else if (p) { level = 'planned'; shown = p }

    if (!shown || !level) {
      // Everything absent — but "present and unparseable" must still surface.
      const anyPresent = !!(planned || estimated || actual)
      if (!anyPresent) {
        return canCache ? levels.set(key, emptyTimestamp) : emptyTimestamp
      }
      const broken: CompactTimestamp = Object.freeze({
        level: null,
        glyph: '',
        date: invalid,
        variance: '',
        varianceSign: 0 as const,
        title: EMPTY_TIMESTAMP_TITLE,
        isEmpty: false,
      })
      return canCache ? levels.set(key, broken) : broken
    }

    const date = buildCompactDate(shown, c)

    // Variance: actual vs estimate, else actual vs plan, else estimate vs plan.
    // A zero result is a real answer ("on time"), so it must not fall through
    // to the next pair — hence the explicit null checks rather than `||`.
    let varianceMinutes: number | null = null
    if (a && e) varianceMinutes = diffMinutes(a, e)
    else if (a && p) varianceMinutes = diffMinutes(a, p)
    else if (e && p) varianceMinutes = diffMinutes(e, p)

    const variance = varianceMinutes == null ? '' : formatVariance(varianceMinutes)
    const varianceSign: 0 | 1 | -1 =
      !variance || varianceMinutes == null ? 0 : varianceMinutes > 0 ? 1 : -1

    // Breakdown, most-real first. This is what a screen reader reads and what
    // hover reveals, so it uses WORDS — the glyphs are decorative by design.
    let title = ''
    if (a) title += `${c.levelLabels.actual}: ${buildCompactDate(a, c).text}`
    if (e) title += (title ? '\n' : '') + `${c.levelLabels.estimated}: ${buildCompactDate(e, c).text}`
    if (p) title += (title ? '\n' : '') + `${c.levelLabels.planned}: ${buildCompactDate(p, c).text}`

    const result: CompactTimestamp = Object.freeze({
      level,
      glyph: c.glyphs[level],
      date,
      variance,
      varianceSign,
      title,
      isEmpty: false,
    })
    return canCache ? levels.set(key, result) : result
  }

  return {
    config: c,
    format,
    formatLevels,
    _cacheSize: () => values.size() + levels.size(),
  }
}

const formatters = new Map<string, CompactDateFormatter>()

/**
 * Get (or build) the memoised formatter for a config.
 *
 * Hoist this — `DateCell` holds it in a `useMemo` — so the per-cell cost is a
 * single `Map.get` on the raw value and nothing else. Calling it per cell still
 * works and is not catastrophic (one small key string), but it is waste.
 */
export function getCompactDateFormatter(config?: CompactDateConfig): CompactDateFormatter {
  const resolved = resolveConfig(config)
  const key = configKey(resolved)
  const hit = formatters.get(key)
  if (hit) return hit
  const made = buildFormatter(resolved)
  formatters.set(key, made)
  return made
}

/** Convenience single-value entry point. Prefer the formatter in hot code. */
export function formatDateCompact(value: DateInput, config?: CompactDateConfig): CompactDate {
  return getCompactDateFormatter(config).format(value)
}

/** Convenience triplet entry point. Prefer the formatter in hot code. */
export function formatTimestampLevels(
  planned: DateInput,
  estimated: DateInput,
  actual: DateInput,
  config?: CompactDateConfig,
): CompactTimestamp {
  return getCompactDateFormatter(config).formatLevels(planned, estimated, actual)
}

/**
 * Reset every cache. Tests only — `referenceYear` is baked into the formatter
 * key, so production code never needs this.
 */
export function __resetCompactDateCaches(): void {
  formatters.clear()
  localePatterns.clear()
}
