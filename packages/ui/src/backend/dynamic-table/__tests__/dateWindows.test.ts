import { isDateWindowOperator, resolveDateWindow } from '../server/dateWindows'

/**
 * The shared date-window resolver (workshop A14).
 *
 * The point of the module is that the now-relative presets and the explicit
 * `is_between` range are ONE mechanism: whatever route applies the filter — SQL
 * push-down or in-memory comparator — it resolves the operator here and gets
 * the same `[from, to]`. These tests pin the windows themselves; the two
 * consumers are pinned separately (`filterParser.presets`, the folders route).
 *
 * Anchor: 2026-06-12 is a Friday (ISO weekday 5), so
 *   this ISO week = Mon 2026-06-08 … Sun 2026-06-14
 *   next ISO week = Mon 2026-06-15 … Sun 2026-06-21
 * All arithmetic is local-time, so expectations build local Dates the same way.
 */

const now = new Date(2026, 5, 12, 10, 30) // Fri 2026-06-12 10:30 local
const startOfDay = (y: number, m: number, d: number) => new Date(y, m, d, 0, 0, 0, 0)
const endOfDay = (y: number, m: number, d: number) => new Date(y, m, d, 23, 59, 59, 999)

describe('resolveDateWindow — now-relative presets', () => {
  it('is_today → the whole of today', () => {
    const w = resolveDateWindow('is_today', [], now)!
    expect(w.from!.getTime()).toBe(startOfDay(2026, 5, 12).getTime())
    expect(w.to!.getTime()).toBe(endOfDay(2026, 5, 12).getTime())
    expect(w.toExclusive).toBeFalsy()
  })

  it('is_tomorrow → the whole of tomorrow', () => {
    const w = resolveDateWindow('is_tomorrow', [], now)!
    expect(w.from!.getTime()).toBe(startOfDay(2026, 5, 13).getTime())
    expect(w.to!.getTime()).toBe(endOfDay(2026, 5, 13).getTime())
  })

  it('is_this_week → today through Sunday (upcoming, not past days)', () => {
    const w = resolveDateWindow('is_this_week', [], now)!
    expect(w.from!.getTime()).toBe(startOfDay(2026, 5, 12).getTime())
    expect(w.to!.getTime()).toBe(endOfDay(2026, 5, 14).getTime())
  })

  it('is_next_week → Monday through Sunday of next ISO week', () => {
    const w = resolveDateWindow('is_next_week', [], now)!
    expect(w.from!.getTime()).toBe(startOfDay(2026, 5, 15).getTime())
    expect(w.to!.getTime()).toBe(endOfDay(2026, 5, 21).getTime())
  })

  it('is_overdue → unbounded below, EXCLUSIVE at the start of today', () => {
    // Exclusivity is the reason `DateWindow` carries a flag at all: "overdue"
    // must not match anything happening today, and an inclusive end-of-yesterday
    // bound only reproduces that by a millisecond fudge.
    const w = resolveDateWindow('is_overdue', [], now)!
    expect(w.from).toBeNull()
    expect(w.to!.getTime()).toBe(startOfDay(2026, 5, 12).getTime())
    expect(w.toExclusive).toBe(true)
  })

  it('presets ignore stray values', () => {
    const w = resolveDateWindow('is_today', ['garbage', 'more'], now)!
    expect(w.from!.getTime()).toBe(startOfDay(2026, 5, 12).getTime())
  })

  it('re-resolves against the clock it is given — a saved preset never goes stale', () => {
    const later = new Date(2027, 0, 4, 8, 0)
    const w = resolveDateWindow('is_today', [], later)!
    expect(w.from!.getTime()).toBe(startOfDay(2027, 0, 4).getTime())
  })
})

describe('resolveDateWindow — moving windows', () => {
  it('is_in_next N days → [start of today, end of today + N]', () => {
    const w = resolveDateWindow('is_in_next', ['7', 'days'], now)!
    expect(w.from!.getTime()).toBe(startOfDay(2026, 5, 12).getTime())
    expect(w.to!.getTime()).toBe(endOfDay(2026, 5, 19).getTime())
  })

  it('is_in_last N days → [start of today - N, end of today]', () => {
    const w = resolveDateWindow('is_in_last', ['7', 'days'], now)!
    expect(w.from!.getTime()).toBe(startOfDay(2026, 5, 5).getTime())
    expect(w.to!.getTime()).toBe(endOfDay(2026, 5, 12).getTime())
  })

  it('months clamp to the end of the target month', () => {
    const may31 = new Date(2026, 4, 31, 12, 0)
    const w = resolveDateWindow('is_in_last', ['1', 'months'], may31)!
    expect(w.from!.getTime()).toBe(startOfDay(2026, 3, 30).getTime()) // Apr 30, not May 1
  })

  it('a missing or non-integer count drops the rule rather than matching nothing', () => {
    expect(resolveDateWindow('is_in_next', [], now)).toBeNull()
    expect(resolveDateWindow('is_in_next', ['1.5', 'days'], now)).toBeNull()
    expect(resolveDateWindow('is_in_next', ['5abc', 'days'], now)).toBeNull()
    expect(resolveDateWindow('is_in_next', ['0', 'days'], now)).toBeNull()
  })

  it('an unknown unit falls back to days', () => {
    const bogus = resolveDateWindow('is_in_next', ['5', 'fortnights'], now)!
    const days = resolveDateWindow('is_in_next', ['5', 'days'], now)!
    expect(bogus.to!.getTime()).toBe(days.to!.getTime())
  })
})

describe('resolveDateWindow — explicit is_between range', () => {
  it('both ends → day-bounded inclusive range', () => {
    const w = resolveDateWindow('is_between', ['2026-07-01', '2026-07-31'], now)!
    expect(w.from!.getTime()).toBe(startOfDay(2026, 6, 1).getTime())
    expect(w.to!.getTime()).toBe(endOfDay(2026, 6, 31).getTime())
  })

  it('half-open ranges stay useful — the missing side is unbounded', () => {
    const openTop = resolveDateWindow('is_between', ['2026-07-01', ''], now)!
    expect(openTop.from!.getTime()).toBe(startOfDay(2026, 6, 1).getTime())
    expect(openTop.to).toBeNull()

    const openBottom = resolveDateWindow('is_between', ['', '2026-07-31'], now)!
    expect(openBottom.from).toBeNull()
    expect(openBottom.to!.getTime()).toBe(endOfDay(2026, 6, 31).getTime())
  })

  it('neither end filled → drop the rule (never "match nothing")', () => {
    expect(resolveDateWindow('is_between', ['', ''], now)).toBeNull()
    expect(resolveDateWindow('is_between', [], now)).toBeNull()
  })

  it('rejects non-ISO input instead of guessing', () => {
    expect(resolveDateWindow('is_between', ['01/07/2026', '31/07/2026'], now)).toBeNull()
  })
})

describe('isDateWindowOperator', () => {
  it('covers presets, moving windows AND the explicit range', () => {
    for (const op of [
      'is_today', 'is_tomorrow', 'is_this_week', 'is_next_week', 'is_overdue',
      'is_in_next', 'is_in_last', 'is_between',
    ]) {
      expect(isDateWindowOperator(op)).toBe(true)
    }
  })

  it('excludes the single-sided date operators, which take a picked date', () => {
    for (const op of ['is_before', 'is_after', 'is_on_or_before', 'is_on_or_after', 'equals', 'contains']) {
      expect(isDateWindowOperator(op)).toBe(false)
    }
  })

  it('an unknown operator resolves to no window', () => {
    expect(resolveDateWindow('is_next_millennium', [], now)).toBeNull()
  })
})
