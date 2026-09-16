import { apiToDynamicTable, dynamicTableToApi } from '../utils/perspectiveTransforms'
import type { PerspectiveConfig } from '../types/index'
import type { PerspectiveDto, PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'

const allColumns = ['name', 'departure', 'arrival']

function baseConfig(overrides: Partial<PerspectiveConfig> = {}): PerspectiveConfig {
  return {
    id: 'p1',
    name: 'Ocean ops',
    color: 'blue',
    columns: { visible: allColumns, hidden: [] },
    filters: [{ id: 'f1', field: 'name', operator: 'contains', values: ['x'] } as any],
    sorting: [],
    grouping: [],
    aggregations: [],
    ...overrides,
  }
}

function dtoFromSettings(settings: PerspectiveSettings): PerspectiveDto {
  return { id: 'p1', name: 'Ocean ops', tableId: 'transport', settings, isDefault: false, createdAt: '2026-07-20T00:00:00Z' }
}

describe('perspectiveTransforms — dateFormat', () => {
  it('round-trips dateFormat through filters._dateFormat', () => {
    const settings = dynamicTableToApi(baseConfig({ dateFormat: 'iso-hm' }))

    // Smuggled into the passthrough filters record, not a top-level key.
    expect((settings as any).dateFormat).toBeUndefined()
    expect((settings.filters as any)._dateFormat).toBe('iso-hm')

    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.dateFormat).toBe('iso-hm')
  })

  it('keeps _color and filter rows alongside _dateFormat', () => {
    const restored = apiToDynamicTable(dtoFromSettings(dynamicTableToApi(baseConfig({ dateFormat: 'dm' }))), allColumns)
    expect(restored.color).toBe('blue')
    expect(restored.filters).toHaveLength(1)
    expect(restored.dateFormat).toBe('dm')
  })

  it('is undefined when none was saved (legacy view keeps its default format)', () => {
    const restored = apiToDynamicTable(
      dtoFromSettings({ columnOrder: allColumns, columnVisibility: {}, filters: { v: 2, rows: [] } as any }),
      allColumns,
    )
    expect(restored.dateFormat).toBeUndefined()
  })

  it('ignores a malformed (non-string) _dateFormat defensively', () => {
    const settings = {
      columnOrder: allColumns,
      columnVisibility: {},
      filters: { v: 2, rows: [], _dateFormat: { not: 'a string' } },
    } as any
    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.dateFormat).toBeUndefined()
  })
})
