import { apiToDynamicTable, dynamicTableToApi } from '../utils/perspectiveTransforms'
import type { PerspectiveConfig } from '../types/index'
import type { AggregationRule } from '../types/grouping'
import type { PerspectiveDto, PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'

const allColumns = ['name', 'amount', 'netAmount', 'status']

function baseConfig(overrides: Partial<PerspectiveConfig> = {}): PerspectiveConfig {
  return {
    id: 'p1',
    name: 'View',
    color: 'blue',
    columns: { visible: allColumns, hidden: [] },
    filters: [{ id: 'f1', field: 'status', operator: 'equals', values: ['open'] } as any],
    sorting: [],
    grouping: [{ id: 'g1', field: 'name', direction: 'asc' }],
    aggregations: [],
    ...overrides,
  }
}

function dtoFromSettings(settings: PerspectiveSettings): PerspectiveDto {
  return { id: 'p1', name: 'View', tableId: 'invoicing', settings, isDefault: false, createdAt: '2026-06-15T00:00:00Z' }
}

describe('perspectiveTransforms — aggregations', () => {
  it('round-trips the currency dimension — dropping it re-creates HEDGE-147', () => {
    // `parseAggregations` destructures the rule explicitly, so any property it
    // does not name is lost on reload. If `dimension` were dropped here, a saved
    // per-currency breakdown would silently become one cross-currency number
    // again on the next page load — and look completely normal.
    const aggregations: AggregationRule[] = [
      { id: 'agg-amount', field: 'amount', fn: 'sum', dimension: 'currency' },
    ]
    const settings = dynamicTableToApi(baseConfig({ aggregations }))
    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)

    expect(restored.aggregations).toEqual(aggregations)
    expect(restored.aggregations?.[0].dimension).toBe('currency')
  })

  it('leaves a rule without a dimension free of the key', () => {
    const settings = dynamicTableToApi(
      baseConfig({ aggregations: [{ id: 'agg-amount', field: 'amount', fn: 'sum' }] }),
    )
    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.aggregations?.[0]).not.toHaveProperty('dimension')
  })

  it('round-trips aggregations through filters._aggregations', () => {
    const aggregations: AggregationRule[] = [
      { id: 'agg-amount', field: 'amount', fn: 'sum' },
      { id: 'agg-netAmount', field: 'netAmount', fn: 'sum' },
    ]
    const settings = dynamicTableToApi(baseConfig({ aggregations }))

    // Smuggled into the passthrough filters record, not a top-level key.
    expect((settings as any).aggregations).toBeUndefined()
    expect((settings.filters as any)._aggregations).toEqual(aggregations)

    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.aggregations).toEqual(aggregations)
  })

  it('keeps _color and filter rows alongside _aggregations', () => {
    const settings = dynamicTableToApi(baseConfig({ aggregations: [{ id: 'agg-amount', field: 'amount', fn: 'sum' }] }))
    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)

    expect(restored.color).toBe('blue')
    expect(restored.filters).toHaveLength(1)
    expect(restored.aggregations).toHaveLength(1)
  })

  it('defaults to [] when no aggregations were saved (legacy view)', () => {
    const restored = apiToDynamicTable(
      dtoFromSettings({ columnOrder: allColumns, columnVisibility: {}, filters: { v: 2, rows: [] } as any }),
      allColumns,
    )
    expect(restored.aggregations).toEqual([])
  })

  it('drops malformed aggregation entries defensively', () => {
    const settings = {
      columnOrder: allColumns,
      columnVisibility: {},
      filters: {
        v: 2,
        rows: [],
        _aggregations: [
          { id: 'agg-amount', field: 'amount', fn: 'sum' }, // valid
          { id: 'x', field: '', fn: 'sum' }, // empty field
          { id: 'y', field: 'amount', fn: 'median' }, // unsupported fn
          { field: 'netAmount', fn: 'sum' }, // missing id -> derived
          null,
          'garbage',
        ],
      },
    } as any
    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.aggregations).toEqual([
      { id: 'agg-amount', field: 'amount', fn: 'sum' },
      { id: 'agg-netAmount', field: 'netAmount', fn: 'sum' },
    ])
  })
})
