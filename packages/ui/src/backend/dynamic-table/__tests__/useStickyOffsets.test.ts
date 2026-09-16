import { computeStickyOffsets, ROW_HEADER_WIDTH } from '../hooks/index'
import { createCellStore } from '../store/index'
import type { ColumnDef } from '../types/index'

/**
 * Spec 0 / Phase 2 — sticky offset arithmetic.
 *
 * `computeStickyOffsets` is a pure calculation (no React state, no effects), so it
 * can be called directly; `useStickyOffsets` is a thin memo wrapper over it (see
 * useStickyOffsets.memo.test.tsx for the identity contract that keeps
 * `VirtualRow`'s React.memo alive). It decides the `left` / `right` a pinned column is glued to.
 * Note it reads widths from the STORE, not from the column objects it is handed —
 * that is what makes a user's manual resize move the pinned columns with it.
 * Get the arithmetic wrong and frozen columns leave a gap or overlap the row
 * header, which is the exact symptom the ROW_HEADER_WIDTH constant documents.
 */

let nextKey = 0
const col = (over: Partial<ColumnDef> = {}): ColumnDef => ({
  data: `c${nextKey++}`,
  width: 100,
  ...over,
})

/** Offsets are only meaningful when the store knows the same columns. */
function offsets(columns: ColumnDef[], rowHeaders = false) {
  const store = createCellStore([], columns)
  return computeStickyOffsets(columns, store, rowHeaders)
}

describe('computeStickyOffsets', () => {
  it('returns undefined for every non-sticky column', () => {
    const { leftOffsets, rightOffsets } = offsets([col(), col(), col()])

    expect(leftOffsets).toEqual([undefined, undefined, undefined])
    expect(rightOffsets).toEqual([undefined, undefined, undefined])
  })

  it('starts left offsets at 0 when there is no row-header column', () => {
    expect(offsets([col({ sticky: 'left' })]).leftOffsets[0]).toBe(0)
  })

  it('starts left offsets after the row header when one is rendered', () => {
    expect(offsets([col({ sticky: 'left' })], true).leftOffsets[0]).toBe(ROW_HEADER_WIDTH)
  })

  it('stacks consecutive left-sticky columns by their widths', () => {
    const { leftOffsets } = offsets([
      col({ sticky: 'left', width: 120 }),
      col({ sticky: 'left', width: 80 }),
      col(),
    ])

    expect(leftOffsets[0]).toBe(0)
    expect(leftOffsets[1]).toBe(120)
    expect(leftOffsets[2]).toBeUndefined()
  })

  it('does not count a non-sticky column between two pinned ones', () => {
    // The gap column scrolls away underneath the pinned block, so it must not
    // push the second pinned column to the right.
    const { leftOffsets } = offsets([
      col({ sticky: 'left', width: 100 }),
      col({ width: 999 }),
      col({ sticky: 'left', width: 50 }),
    ])

    expect(leftOffsets[0]).toBe(0)
    expect(leftOffsets[2]).toBe(100)
  })

  it('measures right-sticky columns from the right edge, inwards', () => {
    const { rightOffsets } = offsets([
      col(),
      col({ sticky: 'right', width: 90 }),
      col({ sticky: 'right', width: 60 }),
    ])

    // The last column is flush right; the one before it clears that column's width.
    expect(rightOffsets[2]).toBe(0)
    expect(rightOffsets[1]).toBe(60)
    expect(rightOffsets[0]).toBeUndefined()
  })

  it('tracks a manual resize, because widths come from the store', () => {
    const columns = [col({ sticky: 'left', width: 100 }), col({ sticky: 'left', width: 80 })]
    const store = createCellStore([], columns)
    store.setColumnWidth(0, 300)

    expect(computeStickyOffsets(columns, store, false).leftOffsets[1]).toBe(300)
  })

  it('falls back to the default width when a column declares none', () => {
    const columns: ColumnDef[] = [
      { data: 'a', sticky: 'left' },
      { data: 'b', sticky: 'left' },
    ]

    // store.getColumnWidth() defaults to 100 for an unconfigured column.
    expect(computeStickyOffsets(columns, createCellStore([], columns), false).leftOffsets[1]).toBe(100)
  })

  it('handles an empty column list', () => {
    expect(offsets([], true)).toEqual({ leftOffsets: [], rightOffsets: [] })
  })
})
