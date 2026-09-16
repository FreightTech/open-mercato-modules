/**
 * Rollup ("summarised") columns — the client half.
 *
 * Written from the symptom a user reports, not from the shape of the code.
 * The failures this feature has are all silent ones: a column that renders
 * `0,00` for every row, a column that renders `—` for every row, or a saved
 * view that quietly forgets a column it had.
 */
import {
  buildRollupColumnDefs,
  isRollupColumnKey,
  parseRollupColumnKey,
  parseRollupColumns,
  rollupColumnDataKey,
  rollupColumnsToParam,
} from '../utils/rollupColumns'
import type { RollupColumnRef } from '../types/rollup'
import { apiToDynamicTable, dynamicTableToApi } from '../utils/perspectiveTransforms'
import type { PerspectiveConfig } from '../types/perspective'

const COUNT: RollupColumnRef = { source: 'lines', field: 'id', fn: 'count', label: 'Cost lines · Lines' }
const SUM: RollupColumnRef = {
  source: 'lines',
  field: 'estimated_cost',
  fn: 'sum',
  label: 'Cost lines · Sum of Estimated cost',
}

function renderOf(ref: RollupColumnRef, value: unknown): string {
  const col = buildRollupColumnDefs([ref], { locale: 'pl-PL' })[0]
  return String(col.renderer!(value, {}, col, 0, 0))
}

describe('rollup column keys', () => {
  it('round-trips a key', () => {
    const key = rollupColumnDataKey(SUM)
    expect(key).toBe('rollup__lines__estimated_cost__sum')
    expect(isRollupColumnKey(key)).toBe(true)
    expect(parseRollupColumnKey(key)).toEqual({
      source: 'lines',
      field: 'estimated_cost',
      fn: 'sum',
    })
  })

  it('does not mistake a lookup or formula column for a rollup', () => {
    expect(isRollupColumnKey('lookup__contractor__tax_id')).toBe(false)
    expect(isRollupColumnKey('formula__marza')).toBe(false)
    expect(parseRollupColumnKey('rollup__lines__estimated_cost')).toBeUndefined()
    expect(parseRollupColumnKey('rollup__lines__cost__median')).toBeUndefined()
  })
})

describe('the rollups query param', () => {
  it('is empty when the view has no summarised column — so the route is untouched', () => {
    expect(rollupColumnsToParam([])).toBe('')
  })

  it('asks the server for each aggregate exactly once', () => {
    // Two refs differing only in label are ONE aggregate to the server; asking
    // twice would buy a second GROUP BY for nothing.
    const param = rollupColumnsToParam([COUNT, SUM, { ...COUNT, label: 'Renamed' }])
    expect(param).toBe('lines:id:count,lines:estimated_cost:sum')
  })
})

describe('the saved view', () => {
  it('keeps its summarised columns across a save/reload', () => {
    const config = {
      id: 'p1',
      name: 'Costs',
      columns: { visible: ['id', rollupColumnDataKey(SUM)], hidden: [] },
      filters: [],
      sorting: [],
      rollupColumns: [COUNT, SUM],
    } as unknown as PerspectiveConfig

    const settings = dynamicTableToApi(config)
    // The upstream settings schema strips unknown TOP-LEVEL keys; the rollups
    // must travel inside `filters`, or they vanish on the first reload.
    expect((settings as any).rollups).toBeUndefined()
    expect((settings.filters as any)._rollups).toEqual([COUNT, SUM])

    const back = apiToDynamicTable(
      { id: 'p1', name: 'Costs', settings, isDefault: false } as any,
      ['id', rollupColumnDataKey(SUM)],
    )
    expect(back.rollupColumns).toEqual([COUNT, SUM])
  })

  it('drops a malformed or unknown entry instead of crashing the table', () => {
    expect(
      parseRollupColumns([
        COUNT,
        null,
        'nonsense',
        { source: 'lines' },
        { source: 'lines', field: 'x', fn: 'median' },
        // COUNT is only ever over the child's id — the server enforces it, so a
        // ref that disagrees would render a permanently empty column.
        { source: 'lines', field: 'estimated_cost', fn: 'count' },
        COUNT,
      ]),
    ).toEqual([COUNT])
  })

  it('falls back to the key when a stored label is missing', () => {
    const [ref] = parseRollupColumns([{ source: 'lines', field: 'id', fn: 'count' }])
    expect(ref.label).toBe('rollup__lines__id__count')
  })
})

describe('the rendered cell', () => {
  it('shows the number Postgres actually sent, not 0,00', () => {
    // COUNT comes back as int8 ("7") and SUM over numeric as "18400.0000".
    // Both are non-finite to `Number.isFinite`, which is how every server-side
    // total used to render as 0,00.
    expect(renderOf(COUNT, '7')).toBe('7')
    expect(renderOf(SUM, '18400.0000')).toBe('18 400,00')
  })

  it('keeps "no children" visually distinct from "did not resolve"', () => {
    expect(renderOf(COUNT, 0)).toBe('0')
    expect(renderOf(COUNT, null)).toBe('—')
    expect(renderOf(COUNT, undefined)).toBe('—')
  })

  it('is numeric, right-aligned, monospace and read-only in every write path', () => {
    const [col] = buildRollupColumnDefs([SUM])
    // `type: 'numeric'` is load-bearing: grouping's AggregationRule refuses a
    // non-numeric column and getSortDirectionLabels would offer "A → Z".
    expect(col.type).toBe('numeric')
    expect(col.align).toBe('right')
    expect(col.mono).toBe(true)
    expect(col.readOnly).toBe(true)
    expect(col.disableFill).toBe(true)
  })

  it('exports the raw number, not the locale-formatted string', () => {
    const [col] = buildRollupColumnDefs([SUM], { locale: 'pl-PL' })
    expect(col.exportValue!('18400.0000', {})).toBe('18400.0000')
    expect(col.exportValue!(null, {})).toBe('')
  })

  it('carries the label the user saw when they added it', () => {
    const [col] = buildRollupColumnDefs([SUM])
    expect(col.title).toBe('Cost lines · Sum of Estimated cost')
  })
})
