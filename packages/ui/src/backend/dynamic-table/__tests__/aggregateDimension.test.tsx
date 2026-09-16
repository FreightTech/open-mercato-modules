/**
 * HEDGE-147 — a `sum` must never add amounts in different currencies together.
 *
 * The defect these tests pin: the "By counterparty (sum)" view on
 * `/backend/invoicing` rendered `TOTAL · ALL 4 MATCHING ROWS · 15 750,00` for
 * 6 150 PLN + 1 200 EUR − 200 EUR + 8 600 USD. One unlabelled number, on the
 * only summary line an accountant closes the month from, and nothing on screen
 * disqualified it.
 *
 * The mechanism is `AggregationRule.dimension`: the aggregate is partitioned by
 * a column (here `currencyCode`) and rendered as one labelled line per slice.
 */
import { render } from '@testing-library/react'
import { computeAggregates } from '../hooks/useGrouping'
import { formatAggregate, AGGREGATE_UNLABELLED_DIMENSION } from '../utils/formatAggregate'
import { parseAggregateSpec, AggregateSpecError } from '../server/aggregate'
import type { ColumnDef } from '../types/index'
import type { AggregationRule } from '../types/grouping'

const amountCol: ColumnDef = { data: 'grossAmount', type: 'numeric' }
const columnsByField = new Map<string, ColumnDef>([
  ['grossAmount', amountCol],
  ['currencyCode', { data: 'currencyCode' }],
])

/** The exact dataset from the HEDGE-109 walkthrough that produced 15 750,00. */
const ROWS = [
  { grossAmount: '6150.00', currencyCode: 'PLN' },
  { grossAmount: '1200.00', currencyCode: 'EUR' },
  { grossAmount: '-200.00', currencyCode: 'EUR' },
  { grossAmount: '8600.00', currencyCode: 'USD' },
]
const ALL = ROWS.map((_, i) => i)

const rule = (over: Partial<AggregationRule> = {}): AggregationRule => ({
  id: 'agg-grossAmount',
  field: 'grossAmount',
  fn: 'sum',
  ...over,
})

describe('computeAggregates — dimensioned rules', () => {
  it('still produces the plain scalar when no dimension is set (unchanged behaviour)', () => {
    const out = computeAggregates(ROWS, ALL, [rule()], columnsByField)
    expect(out.values.grossAmount).toBe(15750)
    expect(out.breakdowns.grossAmount).toBeUndefined()
  })

  it('splits the sum per currency instead of adding PLN + EUR + USD together', () => {
    const out = computeAggregates(ROWS, ALL, [rule({ dimension: 'currencyCode' })], columnsByField)
    expect(out.breakdowns.grossAmount).toEqual([
      { key: 'PLN', value: 6150 },
      { key: 'EUR', value: 1000 }, // 1200 + (-200) — netted WITHIN the currency
      { key: 'USD', value: 8600 },
    ])
  })

  it('never lets two currencies land in one slice', () => {
    const { breakdowns } = computeAggregates(
      ROWS,
      ALL,
      [rule({ dimension: 'currencyCode' })],
      columnsByField,
    )
    const keys = breakdowns.grossAmount.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.sort()).toEqual(['EUR', 'PLN', 'USD'])
  })

  it('buckets rows with no currency under the empty key rather than dropping them', () => {
    const rows = [...ROWS, { grossAmount: '5.00', currencyCode: null }]
    const { breakdowns } = computeAggregates(
      rows,
      rows.map((_, i) => i),
      [rule({ dimension: 'currencyCode' })],
      columnsByField,
    )
    expect(breakdowns.grossAmount).toContainEqual({ key: '', value: 5 })
  })
})

describe('formatAggregate — dimensioned rendering', () => {
  const renderNode = (node: React.ReactNode) => render(<>{node}</>).container.textContent ?? ''

  it('prints one labelled line per currency, never a single combined figure', () => {
    const { breakdowns } = computeAggregates(
      ROWS,
      ALL,
      [rule({ dimension: 'currencyCode' })],
      columnsByField,
    )
    const text = renderNode(
      formatAggregate(15750, amountCol, 'en-US', 'sum', breakdowns.grossAmount),
    )
    expect(text).toContain('8,600.00')
    expect(text).toContain('USD')
    expect(text).toContain('6,150.00')
    expect(text).toContain('PLN')
    expect(text).toContain('1,000.00')
    expect(text).toContain('EUR')
    // THE REGRESSION GUARD: the cross-currency total must not be on screen.
    expect(text).not.toContain('15,750')
  })

  it('orders slices by magnitude so the dominant figure reads first', () => {
    const { breakdowns } = computeAggregates(
      ROWS,
      ALL,
      [rule({ dimension: 'currencyCode' })],
      columnsByField,
    )
    const text = renderNode(formatAggregate(0, amountCol, 'en-US', 'sum', breakdowns.grossAmount))
    expect(text.indexOf('8,600.00')).toBeLessThan(text.indexOf('6,150.00'))
    expect(text.indexOf('6,150.00')).toBeLessThan(text.indexOf('1,000.00'))
  })

  it('labels a SINGLE-currency breakdown too — an unlabelled number is the defect', () => {
    const text = renderNode(
      formatAggregate(6150, amountCol, 'en-US', 'sum', [{ key: 'PLN', value: 6150 }]),
    )
    expect(text).toBe('6,150.00 PLN')
  })

  it('labels the empty dimension rather than printing a bare number', () => {
    const text = renderNode(formatAggregate(5, amountCol, 'en-US', 'sum', [{ key: '', value: 5 }]))
    expect(text).toContain(AGGREGATE_UNLABELLED_DIMENSION)
  })

  it('a breakdown overrides even a column summaryRenderer', () => {
    // `summaryRenderer` takes a bare number and so cannot know the currency —
    // deferring to it would reintroduce the unlabelled total.
    const text = renderNode(
      formatAggregate(15750, { ...amountCol, summaryRenderer: (v) => `TOTAL ${v}` }, 'en-US', 'sum', [
        { key: 'PLN', value: 6150 },
        { key: 'USD', value: 8600 },
      ]),
    )
    expect(text).not.toContain('15750')
    expect(text).toContain('PLN')
    expect(text).toContain('USD')
  })

  it('falls back to the scalar path when there is no breakdown (unchanged behaviour)', () => {
    expect(formatAggregate(14145, amountCol, 'en-US', 'sum')).toBe('14,145.00')
    expect(formatAggregate(14145, amountCol, 'en-US', 'sum', [])).toBe('14,145.00')
  })
})

describe('parseAggregateSpec — the dimension is allow-listed like any other field', () => {
  const fieldMap = {
    grossAmount: 'grossAmount',
    netAmount: 'netAmount',
    currencyCode: 'currencyCode',
  }

  it('parses the two-part form exactly as before', () => {
    expect(parseAggregateSpec('grossAmount:sum', fieldMap)).toEqual([
      { field: 'grossAmount', fn: 'sum', property: 'grossAmount' },
    ])
  })

  it('parses the three-part form and resolves the dimension property', () => {
    expect(parseAggregateSpec('grossAmount:sum:currencyCode', fieldMap)).toEqual([
      {
        field: 'grossAmount',
        fn: 'sum',
        property: 'grossAmount',
        dimension: 'currencyCode',
        dimensionProperty: 'currencyCode',
      },
    ])
  })

  it('refuses a dimension that is not on the allow-list — it reaches SQL as GROUP BY', () => {
    expect(() => parseAggregateSpec('grossAmount:sum:evil', fieldMap)).toThrow(AggregateSpecError)
    expect(() => parseAggregateSpec('grossAmount:sum:"; drop table--', fieldMap)).toThrow(
      AggregateSpecError,
    )
  })

  it('refuses an empty dimension rather than silently ignoring it', () => {
    expect(() => parseAggregateSpec('grossAmount:sum:', fieldMap)).toThrow(AggregateSpecError)
  })

  it('handles a mixed spec of dimensioned and plain entries', () => {
    const out = parseAggregateSpec('grossAmount:sum:currencyCode,netAmount:avg', fieldMap)
    expect(out).toHaveLength(2)
    expect(out[0].dimension).toBe('currencyCode')
    expect(out[1].dimension).toBeUndefined()
  })
})
