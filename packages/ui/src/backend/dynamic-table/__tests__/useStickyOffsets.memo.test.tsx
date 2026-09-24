import { renderHook } from '@testing-library/react'
import { useStickyOffsets, ROW_HEADER_WIDTH } from '../hooks/index'
import { createCellStore } from '../store/index'
import type { ColumnDef } from '../types/index'

/**
 * Anchor Defect 5 — `VirtualRow`'s `React.memo` is only worth having if every
 * prop it receives has a stable identity. `leftOffsets` / `rightOffsets` go
 * straight into every mounted row, so if this hook returns fresh arrays on each
 * render the memo is dead before any handler prop is even considered — and the
 * whole grid re-renders on a keystroke in the filter box.
 *
 * These tests pin identity, not values (values are covered by
 * useStickyOffsets.test.ts).
 */

const columns: ColumnDef[] = [
  { data: 'a', sticky: 'left', width: 100 },
  { data: 'b', width: 120 },
  { data: 'c', sticky: 'right', width: 80 },
]

describe('useStickyOffsets — referential stability', () => {
  it('returns the SAME arrays across an unrelated re-render', () => {
    const store = createCellStore([], columns)
    const { result, rerender } = renderHook(() => useStickyOffsets(columns, store, false))

    const first = result.current
    rerender()
    rerender()

    expect(result.current).toBe(first)
    expect(result.current.leftOffsets).toBe(first.leftOffsets)
    expect(result.current.rightOffsets).toBe(first.rightOffsets)
  })

  it('recomputes when a column width changes in the store', () => {
    const store = createCellStore([], columns)
    const { result, rerender } = renderHook(() => useStickyOffsets(columns, store, false))

    const first = result.current
    store.setColumnWidth(0, 300)
    rerender()

    expect(result.current).not.toBe(first)
    expect(result.current.leftOffsets).toEqual(first.leftOffsets)
  })

  it('recomputes when the column array identity changes (perspective reorder)', () => {
    const store = createCellStore([], columns)
    let current = columns
    const { result, rerender } = renderHook(() => useStickyOffsets(current, store, false))

    const first = result.current
    current = [columns[1], columns[0], columns[2]]
    store.setColumns(current)
    rerender()

    expect(result.current).not.toBe(first)
    expect(result.current.leftOffsets[1]).toBe(0) // 'a' is pinned, now at index 1
  })

  it('recomputes when the row-header flag flips', () => {
    const store = createCellStore([], columns)
    let rowHeaders = false
    const { result, rerender } = renderHook(() => useStickyOffsets(columns, store, rowHeaders))

    const first = result.current
    rowHeaders = true
    rerender()

    expect(result.current).not.toBe(first)
    // The painted row-header gutter (RowHeaderCell renders 50px).
    expect(result.current.leftOffsets[0]).toBe(ROW_HEADER_WIDTH)
    expect(ROW_HEADER_WIDTH).toBe(50)
  })
})
