import { formatAggregate, coerceAggregateValue, AGGREGATE_EMPTY_PLACEHOLDER } from '../utils/formatAggregate'
import type { ColumnDef } from '../types/index'

const col = (over: Partial<ColumnDef> = {}): ColumnDef => ({ data: 'amount', type: 'numeric', ...over })

describe('formatAggregate', () => {
  it('formats with locale grouping + 2 decimals (pl)', () => {
    // pl-PL uses a non-breaking/thin space for thousands and a comma decimal.
    const out = formatAggregate(14145, col(), 'pl-PL') as string
    expect(out.replace(/[   ]/g, ' ')).toBe('14 145,00')
  })

  it('formats with en-US grouping', () => {
    expect(formatAggregate(14145, col(), 'en-US')).toBe('14,145.00')
  })

  it('defaults non-finite values to 0', () => {
    expect(formatAggregate(NaN, col(), 'en-US')).toBe('0.00')
  })

  it('uses the column summaryRenderer escape hatch when provided', () => {
    const out = formatAggregate(99, col({ summaryRenderer: (v) => `PLN ${v}` }), 'pl-PL')
    expect(out).toBe('PLN 99')
  })
})

describe('formatAggregate — server values arrive as strings', () => {
  // Postgres hands back int8 as "7" and numeric as "18400.0000" over JSON.
  // The old `value: number` + Number.isFinite(value) guard turned BOTH into
  // 0,00 — a silent, confidently-wrong total. This is the regression guard.
  it('formats a numeric SUM delivered as a string', () => {
    expect(formatAggregate('18400.0000', col(), 'en-US')).toBe('18,400.00')
  })

  it('formats an int8 COUNT delivered as a string, with no decimals', () => {
    expect(formatAggregate('7', col(), 'en-US', 'count')).toBe('7')
  })

  it('does NOT render a string total as zero', () => {
    expect(formatAggregate('18400.0000', col(), 'en-US')).not.toBe('0.00')
  })

  it('passes the coerced number to summaryRenderer, not the raw string', () => {
    const out = formatAggregate('18400.0000', col({ summaryRenderer: (v) => v + 1 }), 'en-US')
    expect(out).toBe(18401)
  })
})

describe('formatAggregate — per-function presentation', () => {
  it('renders counts as integers', () => {
    expect(formatAggregate(7, col(), 'en-US', 'count')).toBe('7')
    expect(formatAggregate(3, col(), 'en-US', 'countDistinct')).toBe('3')
  })

  it('renders sum/avg/min/max with two decimals', () => {
    expect(formatAggregate(7, col(), 'en-US', 'avg')).toBe('7.00')
    expect(formatAggregate(7, col(), 'en-US', 'min')).toBe('7.00')
  })

  it('renders MIN/MAX of a date column as a date, not epoch milliseconds', () => {
    const ms = Date.UTC(2026, 7, 3)
    const out = formatAggregate(ms, col({ type: 'date' }), 'en-US', 'min') as string
    expect(out).not.toMatch(/\d{10,}/)
    expect(out).toContain('2026')
  })

  it('renders an absent value as a placeholder rather than zero', () => {
    expect(formatAggregate(null, col(), 'en-US', 'min')).toBe(AGGREGATE_EMPTY_PLACEHOLDER)
    expect(formatAggregate(undefined, col(), 'en-US', 'avg')).toBe(AGGREGATE_EMPTY_PLACEHOLDER)
    expect(formatAggregate('', col(), 'en-US', 'avg')).toBe(AGGREGATE_EMPTY_PLACEHOLDER)
  })
})

describe('coerceAggregateValue', () => {
  it('parses the pg wire representations', () => {
    expect(coerceAggregateValue('7')).toBe(7)
    expect(coerceAggregateValue('18400.0000')).toBe(18400)
    expect(coerceAggregateValue('-12.5')).toBe(-12.5)
  })

  it('distinguishes "no value" from zero', () => {
    expect(coerceAggregateValue(null)).toBeNull()
    expect(coerceAggregateValue(undefined)).toBeNull()
    expect(coerceAggregateValue('   ')).toBeNull()
    expect(coerceAggregateValue(0)).toBe(0)
    expect(coerceAggregateValue('0')).toBe(0)
  })

  it('degrades garbage to 0 rather than NaN', () => {
    expect(coerceAggregateValue('oops')).toBe(0)
    expect(coerceAggregateValue(NaN)).toBe(0)
    expect(coerceAggregateValue(Infinity)).toBe(0)
  })

  it('handles bigint and Date', () => {
    expect(coerceAggregateValue(BigInt(42))).toBe(42)
    expect(coerceAggregateValue(new Date(1600))).toBe(1600)
  })
})
