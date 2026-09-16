import { apiToDynamicTable, dynamicTableToApi } from '../utils/perspectiveTransforms'
import type { DynamicTablePerspectiveConfig } from '../utils/perspectiveTransforms'
import type { ConditionalFormatRule } from '../utils/conditionalFormat'
import type { AggregationRule } from '../types/grouping'
import type { PerspectiveDto, PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'

const allColumns = ['name', 'amount', 'eta', 'ata']

function baseConfig(
  overrides: Partial<DynamicTablePerspectiveConfig> = {},
): DynamicTablePerspectiveConfig {
  return {
    id: 'p1',
    name: 'View',
    color: 'blue',
    columns: { visible: allColumns, hidden: [] },
    filters: [],
    sorting: [],
    grouping: [{ id: 'g1', field: 'name', direction: 'asc' }],
    aggregations: [],
    ...overrides,
  }
}

function dtoFromSettings(settings: PerspectiveSettings): PerspectiveDto {
  return {
    id: 'p1',
    name: 'View',
    tableId: 'invoicing',
    settings,
    isDefault: false,
    createdAt: '2026-08-03T00:00:00Z',
  }
}

const rules: ConditionalFormatRule[] = [
  { id: 'cf-1', field: 'amount', operator: 'gt', value: 100, style: 'red' },
  { id: 'cf-2', field: 'ata', operator: 'afterField', compareField: 'eta', style: 'yellow' },
]

describe('perspectiveTransforms — conditional formats', () => {
  it('round-trips rules through the filters._conditionalFormats passthrough', () => {
    const settings = dynamicTableToApi(baseConfig({ conditionalFormats: rules }))

    // Smuggled into `filters`, NOT a top-level key — the settings schema strips
    // unknown top-level keys, which is how rules silently vanish on reload.
    expect((settings as any).conditionalFormats).toBeUndefined()
    expect((settings.filters as any)._conditionalFormats).toEqual(rules)

    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.conditionalFormats).toEqual(rules)
  })

  it('defaults to [] for a legacy view that never saved any', () => {
    const restored = apiToDynamicTable(
      dtoFromSettings({ columnOrder: allColumns, columnVisibility: {}, filters: { v: 2, rows: [] } } as any),
      allColumns,
    )
    expect(restored.conditionalFormats).toEqual([])
  })

  it('keeps _aggregations, _color and _conditionalFormats side by side', () => {
    const settings = dynamicTableToApi(
      baseConfig({
        aggregations: [{ id: 'agg-amount', field: 'amount', fn: 'avg' }],
        conditionalFormats: rules,
      }),
    )
    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.color).toBe('blue')
    expect(restored.aggregations).toHaveLength(1)
    expect(restored.conditionalFormats).toHaveLength(2)
  })
})

describe('perspectiveTransforms — widened aggregation functions survive a round-trip', () => {
  // This used to be a local ['sum'] whitelist: a view saved with avg/min/max
  // came back with NO aggregations at all, silently.
  it.each(['sum', 'avg', 'min', 'max', 'count', 'countDistinct'] as const)(
    'keeps a %s rule',
    (fn) => {
      const aggregations: AggregationRule[] = [{ id: 'agg-amount', field: 'amount', fn }]
      const settings = dynamicTableToApi(baseConfig({ aggregations }))
      expect(apiToDynamicTable(dtoFromSettings(settings), allColumns).aggregations).toEqual(
        aggregations,
      )
    },
  )

  it('degrades gracefully when a NEWER client saved an unknown function', () => {
    const settings = {
      columnOrder: allColumns,
      columnVisibility: {},
      filters: {
        v: 2,
        rows: [],
        _aggregations: [
          { id: 'agg-amount', field: 'amount', fn: 'median' }, // from the future
          { id: 'agg-name', field: 'name', fn: 'count' },
        ],
      },
    } as any
    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    // The unknown rule is dropped; the rest of the view still loads.
    expect(restored.aggregations).toEqual([{ id: 'agg-name', field: 'name', fn: 'count' }])
  })
})
