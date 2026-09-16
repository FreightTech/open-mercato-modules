import { apiToDynamicTable, dynamicTableToApi } from '../utils/perspectiveTransforms'
import type { PerspectiveConfig } from '../types/perspective'
import type { PerspectiveDto, PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'

const allColumns = ['revenue', 'cost']

function config(overrides: Partial<PerspectiveConfig> = {}): PerspectiveConfig {
  return {
    id: 'p1',
    name: 'View',
    columns: { visible: allColumns, hidden: [] },
    filters: [],
    sorting: [],
    ...overrides,
  }
}

function dtoFromSettings(settings: PerspectiveSettings): PerspectiveDto {
  return { id: 'p1', name: 'View', tableId: 'folders', settings } as PerspectiveDto
}

const margin = {
  key: 'formula__marza',
  label: 'Marża',
  expression: 'revenue - cost',
  resultType: 'number' as const,
}

describe('perspectiveTransforms — calculated columns', () => {
  it('persists formulas INSIDE the filters passthrough, never as a top-level key', () => {
    // The upstream settings schema silently strips unknown top-level keys. A
    // formula saved there would vanish on reload with no error anywhere — the
    // exact failure `_aggregations`, `_lookups` and `_conditionalFormats` all
    // already ride this channel to avoid.
    const settings = dynamicTableToApi(config({ formulas: [margin] }))
    const filters = settings.filters as Record<string, unknown>
    expect(filters._formulas).toEqual([margin])
    expect((settings as Record<string, unknown>).formulas).toBeUndefined()
  })

  it('round-trips a formula column unchanged', () => {
    const settings = dynamicTableToApi(config({ formulas: [margin] }))
    const back = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(back.formulas).toEqual([margin])
  })

  it('emits an empty list rather than undefined, so a cleared set is really cleared', () => {
    const settings = dynamicTableToApi(config({ formulas: [] }))
    expect((settings.filters as Record<string, unknown>)._formulas).toEqual([])
  })

  it('drops a malformed entry instead of crashing the table', () => {
    const dto = dtoFromSettings({
      columnOrder: allColumns,
      columnVisibility: { revenue: true, cost: true },
      filters: {
        v: 2,
        rows: [],
        _formulas: [
          margin,
          { key: 'not_a_formula_key', expression: 'x' },
          { key: 'formula__blank', expression: '   ' },
          'nonsense',
          null,
        ],
      },
      sorting: [],
      grouping: [],
    } as unknown as PerspectiveSettings)

    expect(apiToDynamicTable(dto, allColumns).formulas).toEqual([margin])
  })

  it('reads a view saved before formulas existed as having none', () => {
    const dto = dtoFromSettings({
      columnOrder: allColumns,
      columnVisibility: { revenue: true, cost: true },
      filters: { v: 2, rows: [] },
      sorting: [],
      grouping: [],
    } as unknown as PerspectiveSettings)

    expect(apiToDynamicTable(dto, allColumns).formulas).toEqual([])
  })
})
