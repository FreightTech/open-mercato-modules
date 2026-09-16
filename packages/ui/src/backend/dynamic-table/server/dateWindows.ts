/**
 * Date-window resolution for DynamicTable filter operators — ONE implementation,
 * shared by every list route regardless of how it applies filters.
 *
 * ## Why this file exists (workshop item A14)
 *
 * There are two kinds of list route in this repo:
 *
 *  - **DB-backed** routes push filters into SQL through {@link parseFilterRow}
 *    (`filterParser.ts`). Those understood the now-relative operators.
 *  - **In-memory** routes (the folders Files list, the Transport list) denormalise
 *    rows first and match with their own `applyColumnFilters`. Those did **not**.
 *    Their parser dropped any rule whose right-hand side was empty, and every
 *    preset (`is_today`, `is_tomorrow`, `is_this_week`, `is_next_week`,
 *    `is_overdue`) is deliberately value-less — so picking "tomorrow" on ETD
 *    silently returned the **entire unfiltered table**. `is_in_next` /
 *    `is_in_last` survived the drop but fell through to a substring match, so
 *    "next 7 days" matched every row whose ISO timestamp contained a "7".
 *
 * Both were invisible: a filter that changes nothing looks like "no shipments
 * match today", not like a bug. Resolving the operator to a concrete
 * `[from, to]` window here, once, means the preset and the explicit
 * `is_between` range are the *same mechanism* on every list — which is the
 * requirement: one operator whose window happens to be computed, the other
 * whose window is typed.
 *
 * All arithmetic is local-time (matching how operators read a calendar) and
 * day-bounded, so a row stored at `2026-06-12 14:30` matches `is_today` on
 * 2026-06-12.
 */

export type RelativeUnit = 'days' | 'weeks' | 'months'

/**
 * A resolved filter window. `from` is always an inclusive lower bound.
 * `to` is inclusive unless {@link DateWindow.toExclusive} is set — `is_overdue`
 * is "strictly before the start of today", which is not expressible as an
 * inclusive end-of-day bound without an off-by-one-millisecond fudge.
 * Either side may be `null`, meaning unbounded.
 */
export type DateWindow = {
  from: Date | null
  to: Date | null
  toExclusive?: boolean
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse `YYYY-MM-DD` into a local Date at the start of that day. */
export function parseIsoDay(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d, 0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

/**
 * Add `n` units to `base` (n may be negative). Days/weeks are plain day
 * arithmetic; months are calendar months with an end-of-month clamp so the
 * result is always a real date instead of a JS Date overflow:
 *   May 31 minus 1 month -> Apr 30   (not May 1)
 *   Jan 31 plus 1 month  -> Feb 28/29 (not Mar 2/3)
 */
export function addUnit(base: Date, n: number, unit: RelativeUnit): Date {
  if (unit === 'weeks') {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n * 7)
  }
  if (unit === 'months') {
    const targetFirst = new Date(base.getFullYear(), base.getMonth() + n, 1)
    const daysInTarget = new Date(targetFirst.getFullYear(), targetFirst.getMonth() + 1, 0).getDate()
    return new Date(targetFirst.getFullYear(), targetFirst.getMonth(), Math.min(base.getDate(), daysInTarget))
  }
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n)
}

/** Coerce a stored relative unit value, defaulting to days. */
export function parseUnit(value: unknown): RelativeUnit {
  return value === 'weeks' || value === 'months' ? value : 'days'
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
function isoWeekday(date: Date): number {
  const wd = date.getDay()
  return wd === 0 ? 7 : wd
}

/** Monday 00:00 of the ISO week containing `date`. */
export function startOfWeek(date: Date): Date {
  return startOfDay(addUnit(date, 1 - isoWeekday(date), 'days'))
}

/** Sunday 23:59 of the ISO week containing `date`. */
export function endOfWeek(date: Date): Date {
  return endOfDay(addUnit(date, 7 - isoWeekday(date), 'days'))
}

/**
 * Coerce a stored relative count to a positive integer, or null if invalid.
 * Uses `Number` (not `parseInt`) so fractional/garbage input like "1.5" or
 * "5abc" is rejected outright rather than silently truncated.
 */
export function parsePositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return Number.isInteger(n) && n >= 1 ? n : null
}

/**
 * Every operator that resolves to a `[from, to]` window.
 *
 * `is_between` is in this list ON PURPOSE. Agnieszka works date-first on an
 * explicit range ("szybciej mi jest operować na zakresie dat") and declined
 * more presets; Klaudiusz lives on "tomorrow". Both mechanisms must coexist in
 * the same operator list, and the cheapest way to guarantee they never diverge
 * is for them to produce the same shape.
 */
export const DATE_WINDOW_OPERATORS = [
  'is_between',
  'is_in_next',
  'is_in_last',
  'is_overdue',
  'is_today',
  'is_tomorrow',
  'is_this_week',
  'is_next_week',
] as const

export type DateWindowOperator = (typeof DATE_WINDOW_OPERATORS)[number]

const WINDOW_OPERATOR_SET: ReadonlySet<string> = new Set<string>(DATE_WINDOW_OPERATORS)

export function isDateWindowOperator(operator: string): operator is DateWindowOperator {
  return WINDOW_OPERATOR_SET.has(operator)
}

/**
 * Resolve a window operator + its stored `values` into a concrete
 * `[from, to]` range, anchored to `now`.
 *
 * Returns `null` when the rule cannot produce a window — an unknown operator,
 * an `is_between` with neither end filled, or an `is_in_next` whose count is
 * missing or not a positive integer. A `null` return means "drop this rule",
 * never "match nothing".
 *
 * `now` is injected (and re-read per request by callers) so a saved
 * perspective holding `is_tomorrow` keeps meaning *tomorrow*, not the day
 * after it was saved.
 */
export function resolveDateWindow(
  operator: string,
  values: readonly unknown[],
  now: Date = new Date(),
): DateWindow | null {
  switch (operator) {
    case 'is_between': {
      // Explicit range from the two FilterDatePickers — values = [from, to].
      // A half-open range (only one end filled) is still a useful filter, so
      // the missing side is left unbounded rather than dropping the rule.
      const from = parseIsoDay(values[0])
      const to = parseIsoDay(values[1])
      if (!from && !to) return null
      return { from: from ? startOfDay(from) : null, to: to ? endOfDay(to) : null }
    }
    case 'is_in_next': {
      // Moving window anchored to today: [start of today, end of today + N units].
      const count = parsePositiveInt(values[0])
      if (count === null) return null
      return { from: startOfDay(now), to: endOfDay(addUnit(now, count, parseUnit(values[1]))) }
    }
    case 'is_in_last': {
      const count = parsePositiveInt(values[0])
      if (count === null) return null
      return { from: startOfDay(addUnit(now, -count, parseUnit(values[1]))), to: endOfDay(now) }
    }
    case 'is_overdue':
      // Strictly before today — a date that has already passed.
      return { from: null, to: startOfDay(now), toExclusive: true }
    case 'is_today':
      return { from: startOfDay(now), to: endOfDay(now) }
    case 'is_tomorrow': {
      const t = addUnit(now, 1, 'days')
      return { from: startOfDay(t), to: endOfDay(t) }
    }
    case 'is_this_week':
      // Today through the end of the current ISO week (upcoming, not past days).
      return { from: startOfDay(now), to: endOfWeek(now) }
    case 'is_next_week': {
      const nextWeek = addUnit(now, 7, 'days')
      return { from: startOfWeek(nextWeek), to: endOfWeek(nextWeek) }
    }
    default:
      return null
  }
}
