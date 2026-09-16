import { act, renderHook } from '@testing-library/react'
import { useGrouping } from '../hooks/useGrouping'
import type { ColumnDef } from '../types/index'
import type { GroupRule } from '../types/grouping'

// `groupKeyOfDataIndex` exists for ONE reason: `dataIndexToVisualIndex` returns
// the raw data index for a row that is not visible, which is a sensible
// fallback for scrolling and silently WRONG for a row hidden inside a collapsed
// group. Find-and-replace must be able to expand that group before scrolling,
// or it parks the user on an unrelated row.

const columns: ColumnDef[] = [
  { data: 'carrier', title: 'Carrier' },
  { data: 'ref', title: 'Ref' },
]

const data = [
  { carrier: 'Maersk', ref: 'A1' },
  { carrier: 'MSC', ref: 'B1' },
  { carrier: 'Maersk', ref: 'A2' },
  { carrier: 'MSC', ref: 'B2' },
]

const byCarrier: GroupRule[] = [{ id: 'g1', field: 'carrier', direction: 'asc' }]

describe('useGrouping — groupKeyOfDataIndex', () => {
  it('returns null when grouping is off', () => {
    const { result } = renderHook(() => useGrouping(data, [], columns))
    expect(result.current.groupKeyOfDataIndex(0)).toBeNull()
  })

  it('maps every data row to the group that holds it', () => {
    const { result } = renderHook(() => useGrouping(data, byCarrier, columns))
    expect(result.current.groupKeyOfDataIndex(0)).toBe('carrier:Maersk')
    expect(result.current.groupKeyOfDataIndex(2)).toBe('carrier:Maersk')
    expect(result.current.groupKeyOfDataIndex(1)).toBe('carrier:MSC')
    expect(result.current.groupKeyOfDataIndex(3)).toBe('carrier:MSC')
  })

  it('still answers for a row inside a COLLAPSED group — the whole point', () => {
    const { result } = renderHook(() => useGrouping(data, byCarrier, columns))
    act(() => { result.current.toggleGroup('carrier:Maersk') })

    expect(result.current.collapsedGroups.has('carrier:Maersk')).toBe(true)
    // The row is no longer a visual row…
    const visualRows = result.current.visualRows ?? []
    expect(visualRows.some((r) => r.type === 'dataRow' && r.dataIndex === 0)).toBe(false)
    // …and `dataIndexToVisualIndex` therefore hands back a MISLEADING index,
    // which is exactly why the group key has to be available separately.
    expect(result.current.dataIndexToVisualIndex(0)).toBe(0)
    expect(result.current.groupKeyOfDataIndex(0)).toBe('carrier:Maersk')
  })

  it('returns null for an index outside the data', () => {
    const { result } = renderHook(() => useGrouping(data, byCarrier, columns))
    expect(result.current.groupKeyOfDataIndex(99)).toBeNull()
  })
})
