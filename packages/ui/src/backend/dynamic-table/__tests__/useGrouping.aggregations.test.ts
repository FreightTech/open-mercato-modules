import { renderHook } from '@testing-library/react'
import { useGrouping } from '../hooks/useGrouping'
import type { ColumnDef } from '../types/index'
import type { GroupRule, AggregationRule, GroupSummaryVisualRow } from '../types/grouping'

const columns: ColumnDef[] = [
  { data: 'invoice', title: 'Invoice' },
  { data: 'client', title: 'Client' },
  { data: 'gross', title: 'Gross', type: 'numeric' },
  { data: 'net', title: 'Net', type: 'numeric' },
  { data: 'issuedAt', title: 'Issued', type: 'date' },
]

const data = [
  { invoice: 'A', client: 'X', gross: '100.50', net: 80, issuedAt: '2026-03-01' },
  { invoice: 'A', client: 'Y', gross: '9.50', net: 8, issuedAt: '2026-01-15' },
  { invoice: 'B', client: 'X', gross: 'oops', net: null, issuedAt: '' }, // non-numeric / null
]

const groupByInvoice: GroupRule[] = [{ id: 'g1', field: 'invoice', direction: 'asc' }]
const sumGross: AggregationRule[] = [{ id: 'agg-gross', field: 'gross', fn: 'sum' }]

function summaries(
  rules: GroupRule[],
  aggs: AggregationRule[],
  options?: { totalRows?: number },
  rows: any[] = data,
) {
  const { result } = renderHook(() => useGrouping(rows, rules, columns, aggs, options))
  return (result.current.visualRows ?? []).filter(
    (r): r is GroupSummaryVisualRow => r.type === 'groupSummary',
  )
}

const group = (s: GroupSummaryVisualRow[], key: string) =>
  s.find((r) => r.groupKey.includes(key))!

describe('useGrouping — aggregations', () => {
  it('emits a SUM summary per group, parsing string/null defensively', () => {
    const s = summaries(groupByInvoice, sumGross)
    expect(s).toHaveLength(2)
    expect(group(s, 'A').values.gross).toBeCloseTo(110)
    expect(group(s, 'B').values.gross).toBe(0) // 'oops' contributes nothing
  })

  it('sums multiple columns at once', () => {
    const s = summaries(groupByInvoice, [
      { id: 'agg-gross', field: 'gross', fn: 'sum' },
      { id: 'agg-net', field: 'net', fn: 'sum' },
    ])
    const a = group(s, 'A')
    expect(a.values.gross).toBeCloseTo(110)
    expect(a.values.net).toBe(88)
  })

  it('produces a summary at every level for nested grouping', () => {
    const nested: GroupRule[] = [
      { id: 'g1', field: 'invoice', direction: 'asc' },
      { id: 'g2', field: 'client', direction: 'asc' },
    ]
    const s = summaries(nested, sumGross)
    // 2 invoices + 3 (invoice,client) leaf groups = 5 summary rows.
    expect(s).toHaveLength(5)
  })

  it('emits no summary rows when there are no aggregation rules', () => {
    expect(summaries(groupByInvoice, [])).toHaveLength(0)
  })
})

describe('useGrouping — widened aggregation functions', () => {
  it('avg ignores non-numeric cells and returns null when there is nothing to average', () => {
    const s = summaries(groupByInvoice, [{ id: 'agg-gross', field: 'gross', fn: 'avg' }])
    expect(group(s, 'A').values.gross).toBeCloseTo(55)
    expect(group(s, 'B').values.gross).toBeNull() // only 'oops' — no numbers at all
  })

  it('min / max over numbers', () => {
    const s = summaries(groupByInvoice, [{ id: 'agg-gross', field: 'gross', fn: 'min' }])
    expect(group(s, 'A').values.gross).toBeCloseTo(9.5)
    const t = summaries(groupByInvoice, [{ id: 'agg-gross', field: 'gross', fn: 'max' }])
    expect(group(t, 'A').values.gross).toBeCloseTo(100.5)
  })

  it('min / max over a date column compare chronologically and yield epoch ms', () => {
    const s = summaries(groupByInvoice, [{ id: 'agg-issuedAt', field: 'issuedAt', fn: 'min' }])
    expect(group(s, 'A').values.issuedAt).toBe(Date.parse('2026-01-15'))
    const t = summaries(groupByInvoice, [{ id: 'agg-issuedAt', field: 'issuedAt', fn: 'max' }])
    expect(group(t, 'A').values.issuedAt).toBe(Date.parse('2026-03-01'))
  })

  it('count counts non-empty cells (SQL COUNT(col)), not rows', () => {
    const s = summaries(groupByInvoice, [{ id: 'agg-net', field: 'net', fn: 'count' }])
    expect(group(s, 'A').values.net).toBe(2)
    expect(group(s, 'B').values.net).toBe(0) // net is null on B's only row
  })

  it('count works on a text column too (Excel COUNTA)', () => {
    const s = summaries(groupByInvoice, [{ id: 'agg-client', field: 'client', fn: 'count' }])
    expect(group(s, 'A').values.client).toBe(2)
  })

  it('countDistinct de-duplicates', () => {
    const rows = [
      { invoice: 'A', client: 'X' },
      { invoice: 'A', client: 'X' },
      { invoice: 'A', client: 'Y' },
      { invoice: 'A', client: '' },
    ]
    const s = summaries(
      groupByInvoice,
      [{ id: 'agg-client', field: 'client', fn: 'countDistinct' }],
      undefined,
      rows,
    )
    expect(group(s, 'A').values.client).toBe(2)
  })

  it('records the function that produced each value so the renderer can format it', () => {
    const s = summaries(groupByInvoice, [
      { id: 'agg-gross', field: 'gross', fn: 'avg' },
      { id: 'agg-net', field: 'net', fn: 'count' },
    ])
    expect(group(s, 'A').fns).toEqual({ gross: 'avg', net: 'count' })
  })
})

describe('useGrouping — subtotal scope (the honesty contract)', () => {
  // Client grouping folds over ONE server page. A subtotal that presents a page
  // fold as a group total is the defect; every summary must say what it covers.
  it('labels subtotals page-scoped when the dataset is bigger than the loaded page', () => {
    const s = summaries(groupByInvoice, sumGross, { totalRows: 1240 })
    expect(s.every((r) => r.scope === 'page')).toBe(true)
  })

  it('labels subtotals dataset-scoped when the loaded page IS the whole dataset', () => {
    const s = summaries(groupByInvoice, sumGross, { totalRows: data.length })
    expect(s.every((r) => r.scope === 'dataset')).toBe(true)
  })

  it('defaults to page scope when coverage is unknown — never claims more than it knows', () => {
    const s = summaries(groupByInvoice, sumGross)
    expect(s.every((r) => r.scope === 'page')).toBe(true)
  })

  it('reports how many loaded rows fed each subtotal', () => {
    const s = summaries(groupByInvoice, sumGross, { totalRows: 1240 })
    expect(group(s, 'A').rowsCovered).toBe(2)
    expect(group(s, 'B').rowsCovered).toBe(1)
  })

  it('exposes the scope on the hook result so the host can label the grid', () => {
    const { result } = renderHook(() =>
      useGrouping(data, groupByInvoice, columns, sumGross, { totalRows: 1240 }),
    )
    expect(result.current.aggregateScope).toBe('page')
  })
})
