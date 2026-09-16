import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  endOfDay,
  parseIsoDay,
  resolveDateWindow,
  startOfDay,
} from './dateWindows'

export interface DynamicTableFilterRow {
  field: string
  operator: string
  values: unknown[]
}

/**
 * Parse a single DynamicTable FilterRow into a MikroORM Where clause.
 * Returns null if the row cannot be parsed (unknown field, missing value, etc.)
 *
 * Date semantics: when an operator is date-typed (`is_before` / `is_after` /
 * `is_on_or_before` / `is_on_or_after` / `is_between`) or when `equals` is
 * given an ISO `YYYY-MM-DD` value, the parser converts the right-hand side
 * into Date objects and uses day-bounded ranges so timestamp columns compare
 * correctly. The on/between/equals operators expand to a [start-of-day,
 * end-of-day] window so a row stored as `2026-05-11 14:30` matches a filter
 * for `equals 2026-05-11`.
 */
export function parseFilterRow(
  row: DynamicTableFilterRow,
  fieldMap: Record<string, string>,
  now: Date = new Date()
): Record<string, unknown> | null {
  const field = fieldMap[row.field]
  if (!field) return null

  const val = row.values[0]
  const hasValue = val !== undefined && val !== null && val !== ''
  const hasValues = Array.isArray(row.values) && row.values.length > 0

  switch (row.operator) {
    case 'is_any_of':
      if (!hasValues) return null
      return { [field]: { $in: row.values } }
    case 'is_not_any_of':
      if (!hasValues) return null
      return { [field]: { $nin: row.values } }
    case 'contains':
      if (!hasValue) return null
      return { [field]: { $ilike: `%${escapeLikePattern(String(val))}%` } }
    case 'is_empty':
      return { [field]: { $eq: null } }
    case 'is_not_empty':
      return { [field]: { $ne: null } }
    case 'equals': {
      if (!hasValue) return null
      // Same-day equality for ISO date values; exact-match otherwise.
      const day = parseIsoDay(val)
      if (day) return { [field]: { $gte: startOfDay(day), $lte: endOfDay(day) } }
      return { [field]: { $eq: val } }
    }
    case 'not_equals':
      if (!hasValue) return null
      return { [field]: { $ne: val } }
    case 'is_true':
      return { [field]: { $eq: true } }
    case 'is_false':
      return { [field]: { $eq: false } }
    case 'greater_than':
      if (!hasValue) return null
      return { [field]: { $gt: val } }
    case 'less_than':
      if (!hasValue) return null
      return { [field]: { $lt: val } }
    case 'is_before': {
      if (!hasValue) return null
      const day = parseIsoDay(val)
      // Strictly before the picked day starts.
      return { [field]: { $lt: day ?? val } }
    }
    case 'is_after': {
      if (!hasValue) return null
      const day = parseIsoDay(val)
      // Strictly after the picked day ends.
      return { [field]: { $gt: day ? endOfDay(day) : val } }
    }
    case 'is_on_or_before': {
      if (!hasValue) return null
      const day = parseIsoDay(val)
      // Anywhere on the picked day or earlier.
      return { [field]: { $lte: day ? endOfDay(day) : val } }
    }
    case 'is_on_or_after': {
      if (!hasValue) return null
      const day = parseIsoDay(val)
      return { [field]: { $gte: day ? startOfDay(day) : val } }
    }
    // ── Windowed date operators ───────────────────────────────────────────────
    // `is_between` (explicit range) and every now-relative preset / moving
    // window resolve through ONE shared resolver, so the DB-backed lists and
    // the in-memory lists can never drift apart on what "tomorrow" means.
    case 'is_between':
    case 'is_in_next':
    case 'is_in_last':
    case 'is_overdue':
    case 'is_today':
    case 'is_tomorrow':
    case 'is_this_week':
    case 'is_next_week': {
      const window = resolveDateWindow(row.operator, row.values, now)
      if (!window) return null
      const range: Record<string, Date> = {}
      if (window.from) range.$gte = window.from
      if (window.to) range[window.toExclusive ? '$lt' : '$lte'] = window.to
      return { [field]: range }
    }
    default:
      return null
  }
}

/**
 * Convert an array of DynamicTable FilterRows into MikroORM Where clauses.
 * Filters out rows that cannot be parsed (unknown field, missing value, etc.)
 */
export function parseDynamicTableFilters(
  filterRows: DynamicTableFilterRow[],
  fieldMap: Record<string, string>,
  now: Date = new Date()
): Record<string, unknown>[] {
  return filterRows
    .map((row) => parseFilterRow(row, fieldMap, now))
    .filter((f): f is Record<string, unknown> => f !== null)
}
