import { parseFilterRow } from '../server/filterParser'

// Now-relative preset date operators: is_overdue / is_today / is_tomorrow /
// is_this_week / is_next_week. Value-less; resolved to today-anchored,
// day-bounded windows from an injected `now`. All parser Date math uses
// local-time constructors, so expectations build local Dates the same way.
//
// Anchor: 2026-06-12 is a Friday (ISO weekday 5), so:
//   this ISO week  = Mon 2026-06-08 … Sun 2026-06-14
//   next ISO week  = Mon 2026-06-15 … Sun 2026-06-21

const fieldMap = { d: 'd' }
const row = (operator: string, values: unknown[] = []) => ({ field: 'd', operator, values })
const startOfDay = (y: number, m: number, d: number) => new Date(y, m, d, 0, 0, 0, 0)
const endOfDay = (y: number, m: number, d: number) => new Date(y, m, d, 23, 59, 59, 999)
const clauseFor = (c: Record<string, unknown> | null) =>
  (c?.d ?? {}) as { $gte?: Date; $lte?: Date; $lt?: Date }

describe('TC-TABLE-005: now-relative preset date operators', () => {
  const now = new Date(2026, 5, 12, 10, 30) // Fri 2026-06-12 10:30 local

  it('is_today → [start, end] of today', () => {
    const r = clauseFor(parseFilterRow(row('is_today'), fieldMap, now))
    expect(r.$gte!.getTime()).toBe(startOfDay(2026, 5, 12).getTime())
    expect(r.$lte!.getTime()).toBe(endOfDay(2026, 5, 12).getTime())
  })

  it('is_tomorrow → [start, end] of tomorrow', () => {
    const r = clauseFor(parseFilterRow(row('is_tomorrow'), fieldMap, now))
    expect(r.$gte!.getTime()).toBe(startOfDay(2026, 5, 13).getTime())
    expect(r.$lte!.getTime()).toBe(endOfDay(2026, 5, 13).getTime())
  })

  it('is_this_week → [today, Sunday of this ISO week]', () => {
    const r = clauseFor(parseFilterRow(row('is_this_week'), fieldMap, now))
    expect(r.$gte!.getTime()).toBe(startOfDay(2026, 5, 12).getTime()) // today
    expect(r.$lte!.getTime()).toBe(endOfDay(2026, 5, 14).getTime()) // Sun 06-14
  })

  it('is_next_week → [Monday, Sunday] of next ISO week', () => {
    const r = clauseFor(parseFilterRow(row('is_next_week'), fieldMap, now))
    expect(r.$gte!.getTime()).toBe(startOfDay(2026, 5, 15).getTime()) // Mon 06-15
    expect(r.$lte!.getTime()).toBe(endOfDay(2026, 5, 21).getTime()) // Sun 06-21
  })

  it('is_overdue → strictly before the start of today', () => {
    const r = clauseFor(parseFilterRow(row('is_overdue'), fieldMap, now))
    expect(r.$lt!.getTime()).toBe(startOfDay(2026, 5, 12).getTime())
    expect(r.$gte).toBeUndefined()
  })

  it('presets are value-less — stray values are ignored', () => {
    const r = clauseFor(parseFilterRow(row('is_today', ['garbage']), fieldMap, now))
    expect(r.$gte!.getTime()).toBe(startOfDay(2026, 5, 12).getTime())
    expect(r.$lte!.getTime()).toBe(endOfDay(2026, 5, 12).getTime())
  })

  it('Sunday anchor: this-week collapses to just today (ISO week ends today)', () => {
    const sunday = new Date(2026, 5, 14, 9, 0) // Sun 2026-06-14
    const r = clauseFor(parseFilterRow(row('is_this_week'), fieldMap, sunday))
    expect(r.$gte!.getTime()).toBe(startOfDay(2026, 5, 14).getTime())
    expect(r.$lte!.getTime()).toBe(endOfDay(2026, 5, 14).getTime())
  })
})
