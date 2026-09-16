import { parseFilterRow } from '../server/filterParser'

// Relative ("moving") date operators: is_in_next / is_in_last.
// These resolve to a today-anchored, day-bounded [start, end] window using an
// injected `now`, so the tests are deterministic. All Date math in the parser
// uses local-time constructors, so expectations build local Dates the same way.

const fieldMap = { valid_to: 'valid_to' }

function row(operator: string, values: unknown[]) {
  return { field: 'valid_to', operator, values }
}

// Convenience: the parser's day bounds, mirrored for assertions.
const startOfDay = (y: number, m: number, d: number) => new Date(y, m, d, 0, 0, 0, 0)
const endOfDay = (y: number, m: number, d: number) => new Date(y, m, d, 23, 59, 59, 999)

function bounds(clause: Record<string, unknown> | null) {
  const range = (clause?.valid_to ?? {}) as { $gte?: Date; $lte?: Date }
  return { gte: range.$gte?.getTime(), lte: range.$lte?.getTime() }
}

describe('TC-TABLE-002: relative date windows (days / weeks / months)', () => {
  const now = new Date(2026, 5, 12, 10, 30) // 2026-06-12 10:30 local

  it('is_in_next N days → [startOfToday, endOfDay(today + N)]', () => {
    const { gte, lte } = bounds(parseFilterRow(row('is_in_next', ['7', 'days']), fieldMap, now))
    expect(gte).toBe(startOfDay(2026, 5, 12).getTime())
    expect(lte).toBe(endOfDay(2026, 5, 19).getTime())
  })

  it('is_in_last N days → [startOfDay(today - N), endOfToday]', () => {
    const { gte, lte } = bounds(parseFilterRow(row('is_in_last', ['7', 'days']), fieldMap, now))
    expect(gte).toBe(startOfDay(2026, 5, 5).getTime())
    expect(lte).toBe(endOfDay(2026, 5, 12).getTime())
  })

  it('weeks unit multiplies by 7', () => {
    const next = bounds(parseFilterRow(row('is_in_next', ['2', 'weeks']), fieldMap, now))
    expect(next.lte).toBe(endOfDay(2026, 5, 26).getTime()) // +14 days
    const last = bounds(parseFilterRow(row('is_in_last', ['2', 'weeks']), fieldMap, now))
    expect(last.gte).toBe(startOfDay(2026, 4, 29).getTime()) // -14 days
  })

  it('months unit moves by calendar month', () => {
    const next = bounds(parseFilterRow(row('is_in_next', ['1', 'months']), fieldMap, now))
    expect(next.lte).toBe(endOfDay(2026, 6, 12).getTime()) // 2026-07-12
    const last = bounds(parseFilterRow(row('is_in_last', ['3', 'months']), fieldMap, now))
    expect(last.gte).toBe(startOfDay(2026, 2, 12).getTime()) // 2026-03-12
  })
})

describe('TC-TABLE-003: calendar-month end-of-month clamp', () => {
  it('May 31 − 1 month clamps to Apr 30 (not May 1)', () => {
    const now = new Date(2026, 4, 31, 9, 0) // 2026-05-31
    const { gte } = bounds(parseFilterRow(row('is_in_last', ['1', 'months']), fieldMap, now))
    expect(gte).toBe(startOfDay(2026, 3, 30).getTime()) // 2026-04-30
  })

  it('Jan 31 + 1 month clamps to Feb 28 in a non-leap year', () => {
    const now = new Date(2026, 0, 31, 9, 0) // 2026-01-31
    const { lte } = bounds(parseFilterRow(row('is_in_next', ['1', 'months']), fieldMap, now))
    expect(lte).toBe(endOfDay(2026, 1, 28).getTime()) // 2026-02-28
  })

  it('Jan 31 + 1 month clamps to Feb 29 in a leap year', () => {
    const now = new Date(2024, 0, 31, 9, 0) // 2024-01-31 (leap)
    const { lte } = bounds(parseFilterRow(row('is_in_next', ['1', 'months']), fieldMap, now))
    expect(lte).toBe(endOfDay(2024, 1, 29).getTime()) // 2024-02-29
  })
})

describe('TC-TABLE-004: robustness & today-inclusive boundaries', () => {
  const now = new Date(2026, 5, 12, 10, 30)

  it.each([
    ['empty', ['', 'days']],
    ['zero', ['0', 'days']],
    ['negative', ['-3', 'days']],
    ['non-numeric', ['abc', 'days']],
    ['fractional', ['1.5', 'days']],
  ])('drops the rule when count is %s', (_label, values) => {
    expect(parseFilterRow(row('is_in_next', values), fieldMap, now)).toBeNull()
    expect(parseFilterRow(row('is_in_last', values), fieldMap, now)).toBeNull()
  })

  it('defaults to days when unit is missing', () => {
    const withUnit = bounds(parseFilterRow(row('is_in_next', ['5', 'days']), fieldMap, now))
    const noUnit = bounds(parseFilterRow(row('is_in_next', ['5']), fieldMap, now))
    expect(noUnit).toEqual(withUnit)
  })

  it('defaults to days when unit is unrecognized', () => {
    const bogus = bounds(parseFilterRow(row('is_in_next', ['5', 'fortnights']), fieldMap, now))
    const days = bounds(parseFilterRow(row('is_in_next', ['5', 'days']), fieldMap, now))
    expect(bogus).toEqual(days)
  })

  it('window is today-inclusive on both directions', () => {
    const next = bounds(parseFilterRow(row('is_in_next', ['7', 'days']), fieldMap, now))
    expect(next.gte).toBe(startOfDay(2026, 5, 12).getTime()) // today included as start
    const last = bounds(parseFilterRow(row('is_in_last', ['7', 'days']), fieldMap, now))
    expect(last.lte).toBe(endOfDay(2026, 5, 12).getTime()) // today included as end
  })

  it('returns null for an unknown field', () => {
    expect(parseFilterRow({ field: 'nope', operator: 'is_in_next', values: ['7', 'days'] }, fieldMap, now)).toBeNull()
  })
})
