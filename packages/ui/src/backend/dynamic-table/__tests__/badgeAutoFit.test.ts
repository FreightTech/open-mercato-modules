import {
  BADGE_FIT_MAX_WIDTH,
  badgeFitWidth,
  recordBadgeFit,
  planBadgeWidths,
} from '../utils/badgeAutoFit'
import type { ColumnDef } from '../types/index'

/**
 * Badge auto-fit must be MODEL-driven and window-independent: under column
 * virtualization a column can be unmounted while still needing a width, and a
 * measurement that depends on the mounted window is a scroll-coupled layout
 * feedback loop (column widens on mount → offsets shift → another column mounts
 * → …). These tests pin the two properties that make the loop impossible:
 * the fit is intrinsic (never derived from the cell's current width), and it is
 * cached by the stable `col.data` key so it survives reorder/hide and answers
 * for columns that are not mounted.
 */

const cols: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'status', title: 'Status', badge: true },
  { data: 'stage', title: 'Stage', badge: true },
]

describe('badgeFitWidth', () => {
  it('is a pure function of the pill content width plus padding', () => {
    expect(badgeFitWidth(100, false)).toBe(118) // 100 + 16 + 2
  })

  it('reserves extra room when the cell also shows a comment indicator', () => {
    expect(badgeFitWidth(100, true)).toBe(138) // 100 + 36 + 2
  })

  it('rounds fractional content widths up so the pill is never 1px short', () => {
    expect(badgeFitWidth(100.2, false)).toBe(119)
  })

  it('caps a freak value so one bad pill cannot blow out the layout', () => {
    expect(badgeFitWidth(5000, false)).toBe(BADGE_FIT_MAX_WIDTH)
  })
})

describe('recordBadgeFit — grow-only cache keyed by column data key', () => {
  it('records the first measurement', () => {
    const cache = new Map<string, number>()
    expect(recordBadgeFit(cache, 'status', 120)).toBe(true)
    expect(cache.get('status')).toBe(120)
  })

  it('grows but never shrinks — a narrower pill cannot un-fit the column', () => {
    const cache = new Map([['status', 120]])
    expect(recordBadgeFit(cache, 'status', 90)).toBe(false)
    expect(cache.get('status')).toBe(120)
    expect(recordBadgeFit(cache, 'status', 150)).toBe(true)
    expect(cache.get('status')).toBe(150)
  })

  it('ignores a zero or non-finite measurement (unmounted / display:none cell)', () => {
    const cache = new Map<string, number>()
    expect(recordBadgeFit(cache, 'status', 0)).toBe(false)
    expect(recordBadgeFit(cache, 'status', Number.NaN)).toBe(false)
    expect(cache.size).toBe(0)
  })
})

describe('planBadgeWidths — the write plan is derived from the model only', () => {
  const widths = (map: Record<number, number>) => (col: number) => map[col] ?? 100
  const noneResized = () => false

  it('produces no writes when nothing has been measured', () => {
    expect(planBadgeWidths(new Map(), cols, widths({}), noneResized)).toEqual([])
  })

  it('widens a column that is narrower than its fit', () => {
    const cache = new Map([['status', 150]])
    expect(planBadgeWidths(cache, cols, widths({ 1: 100 }), noneResized)).toEqual([
      { col: 1, width: 150 },
    ])
  })

  it('is idempotent — a column already wide enough produces no write', () => {
    const cache = new Map([['status', 150]])
    expect(planBadgeWidths(cache, cols, widths({ 1: 150 }), noneResized)).toEqual([])
    expect(planBadgeWidths(cache, cols, widths({ 1: 200 }), noneResized)).toEqual([])
  })

  it('never fights a width the user set by hand', () => {
    const cache = new Map([['status', 150]])
    const plan = planBadgeWidths(cache, cols, widths({ 1: 100 }), (col) => col === 1)
    expect(plan).toEqual([])
  })

  it('follows the column key through a perspective reorder, not the index', () => {
    const cache = new Map([['status', 150]])
    // Status moves from index 1 to index 0.
    const reordered: ColumnDef[] = [cols[1], cols[2], cols[0]]
    expect(planBadgeWidths(cache, reordered, widths({}), noneResized)).toEqual([
      { col: 0, width: 150 },
    ])
  })

  it('applies a cached fit to a column that was measured earlier and is not mounted now', () => {
    // `planBadgeWidths` never consults the DOM or a mounted window — it walks
    // the full column array, so an off-screen column is written just the same.
    const cache = new Map([
      ['status', 150],
      ['stage', 180],
    ])
    expect(planBadgeWidths(cache, cols, widths({}), noneResized)).toEqual([
      { col: 1, width: 150 },
      { col: 2, width: 180 },
    ])
  })

  it('ignores cached keys for columns the perspective has hidden', () => {
    const cache = new Map([['stage', 180]])
    const hidden: ColumnDef[] = [cols[0], cols[1]]
    expect(planBadgeWidths(cache, hidden, widths({}), noneResized)).toEqual([])
  })
})
