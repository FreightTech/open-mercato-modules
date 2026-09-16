import {
  coerceToResultType,
  compileFormulaColumns,
  createFormulaRowEvaluator,
  evaluateAst,
  evaluateExpression,
  evaluateFormulaRow,
} from '../formula/evaluate'
import { parseFormula } from '../formula/parse'
import type { FormulaCellResult, FormulaColumnRef, FormulaFieldMeta } from '../formula/types'

// The rule these tests defend: a formula never invents a number. A null input
// yields EMPTY (never 0, never NaN), a bad input yields an error IN ITS OWN
// CELL, and neither blanks the column nor throws.

const fields: FormulaFieldMeta[] = [
  { key: 'revenue', label: 'Revenue', type: 'number' },
  { key: 'cost', label: 'Cost', type: 'number' },
  { key: 'qty', label: 'Qty', type: 'number' },
  { key: 'ref_no', label: 'Reference', type: 'text' },
  { key: 'etd', label: 'ETD', type: 'date' },
  { key: 'ata', label: 'ATA', type: 'date' },
  { key: 'is_paid', label: 'Paid', type: 'boolean' },
]

const fieldMap = new Map(fields.map((f) => [f.key, f]))

function run(expression: string, row: Record<string, unknown> = {}) {
  const parsed = parseFormula(expression)
  if (!parsed.ok) throw new Error(`unparsable test input: ${expression}`)
  return evaluateAst(parsed.ast, row, { fields: fieldMap, now: () => new Date(2026, 7, 3) })
}

function value(expression: string, row: Record<string, unknown> = {}) {
  const result = run(expression, row)
  if (!result.ok) throw new Error(`expected a value, got ${result.issue.code}`)
  return result.value
}

function errorCode(expression: string, row: Record<string, unknown> = {}) {
  const result = run(expression, row)
  if (result.ok) throw new Error(`expected an error, got ${String(result.value)}`)
  return result.issue.code
}

describe('evaluateAst — arithmetic', () => {
  it('computes same-row arithmetic', () => {
    expect(value('revenue - cost', { revenue: 1000, cost: 620 })).toBe(380)
    expect(value('revenue / qty', { revenue: 1000, qty: 4 })).toBe(250)
  })

  it('honours precedence at runtime, not only in the tree', () => {
    expect(value('1 + 2 * 3')).toBe(7)
    expect(value('(1 + 2) * 3')).toBe(9)
    expect(value('10 - 3 - 2')).toBe(5)
  })

  it('reads a money string as a number, because the API returns money as text', () => {
    expect(value('revenue - cost', { revenue: '1000.50', cost: '0.50' })).toBe(1000)
  })

  it('yields EMPTY when an operand is null — never 0 and never NaN', () => {
    expect(value('revenue - cost', { revenue: null, cost: 620 })).toBeNull()
    expect(value('revenue - cost', { revenue: 1000 })).toBeNull()
    expect(value('revenue * qty', { revenue: 1000, qty: '' })).toBeNull()
  })

  it('errors on division by zero rather than yielding Infinity', () => {
    expect(errorCode('revenue / qty', { revenue: 1000, qty: 0 })).toBe('divide_by_zero')
  })

  it('errors on text where a number is required', () => {
    expect(errorCode('revenue - ref_no', { revenue: 10, ref_no: 'MSCU1' })).toBe('type_mismatch')
  })

  it('negates', () => {
    expect(value('-revenue', { revenue: 5 })).toBe(-5)
    expect(value('-revenue', { revenue: null })).toBeNull()
  })
})

describe('evaluateAst — comparison and logic', () => {
  it('compares numbers, text and dates', () => {
    expect(value('revenue > cost', { revenue: 10, cost: 5 })).toBe(true)
    expect(value("ref_no < 'B'", { ref_no: 'A' })).toBe(true)
    expect(value('etd < ata', { etd: '2026-01-01', ata: '2026-02-01' })).toBe(true)
  })

  it('treats blank as equal to blank, as Excel does', () => {
    expect(value('revenue = cost', { revenue: null, cost: null })).toBe(true)
    expect(value('revenue = cost', { revenue: null, cost: 0 })).toBe(false)
  })

  it('compares a numeric string with a number by value', () => {
    expect(value('revenue = 10', { revenue: '10' })).toBe(true)
  })

  it('yields EMPTY when ordering against a blank', () => {
    expect(value('revenue > cost', { revenue: null, cost: 5 })).toBeNull()
  })

  it('short-circuits && and ||', () => {
    // The right operand would be a type error if it were reached.
    expect(value('is_paid && revenue > 0', { is_paid: false, revenue: 5 })).toBe(false)
    expect(value("is_paid || ref_no = 'x'", { is_paid: true, ref_no: 'x' })).toBe(true)
  })
})

describe('evaluateAst — concatenation', () => {
  it('joins values as text', () => {
    expect(value("ref_no & '-' & revenue", { ref_no: 'MSCU1', revenue: 12 })).toBe('MSCU1-12')
  })

  it('treats a blank as the empty string so an optional suffix cannot blank the column', () => {
    expect(value("ref_no & '-' & cost", { ref_no: 'A', cost: null })).toBe('A-')
  })

  it('is EMPTY only when both sides are blank', () => {
    expect(value('ref_no & cost', { ref_no: null, cost: null })).toBeNull()
  })
})

describe('coerceToResultType', () => {
  it('coerces the final value to the column’s declared type', () => {
    expect(coerceToResultType({ ok: true, value: '12.5' }, 'number', 'Margin')).toEqual({
      state: 'ok',
      value: 12.5,
    })
    expect(coerceToResultType({ ok: true, value: 3 }, 'text', 'Margin')).toEqual({
      state: 'ok',
      value: '3',
    })
  })

  it('maps null to EMPTY and a failure to an error state', () => {
    expect(coerceToResultType({ ok: true, value: null }, 'number', 'X')).toEqual({
      state: 'empty',
      value: null,
    })
    const errored = coerceToResultType(
      { ok: false, issue: { code: 'divide_by_zero', message: 'Cannot divide by zero' } },
      'number',
      'X',
    )
    expect(errored.state).toBe('error')
  })

  it('errors when the value cannot be the declared type', () => {
    const result = coerceToResultType({ ok: true, value: 'abc' }, 'number', 'Margin')
    expect(result.state).toBe('error')
    if (result.state !== 'error') return
    expect(result.issue.code).toBe('type_mismatch')
  })
})

describe('compileFormulaColumns + evaluateFormulaRow', () => {
  const ref = (
    key: string,
    expression: string,
    resultType: FormulaColumnRef['resultType'] = 'number',
  ): FormulaColumnRef => ({ key, label: key, expression, resultType })

  it('computes a column for a row', () => {
    const set = compileFormulaColumns([ref('formula__margin', 'revenue - cost')], fields)
    const results = evaluateFormulaRow(set, { revenue: 1000, cost: 620 })
    expect(results.get('formula__margin')).toEqual({ state: 'ok', value: 380 })
  })

  it('evaluates a dependent formula after the one it reads', () => {
    // Declared out of dependency order on purpose.
    const set = compileFormulaColumns(
      [
        ref('formula__pct', 'formula__margin / revenue * 100'),
        ref('formula__margin', 'revenue - cost'),
      ],
      fields,
    )
    expect(set.order.map((c) => c.ref.key)).toEqual(['formula__margin', 'formula__pct'])
    const results = evaluateFormulaRow(set, { revenue: 1000, cost: 900 })
    expect(results.get('formula__pct')).toEqual({ state: 'ok', value: 10 })
  })

  it('propagates an upstream error instead of inventing a fresh one', () => {
    const set = compileFormulaColumns(
      [ref('formula__a', 'revenue / qty'), ref('formula__b', 'formula__a + 1')],
      fields,
    )
    const results = evaluateFormulaRow(set, { revenue: 10, qty: 0 })
    expect((results.get('formula__b') as Extract<FormulaCellResult, { state: 'error' }>).issue.code).toBe(
      'divide_by_zero',
    )
  })

  it('keeps a broken definition inside its own column', () => {
    const set = compileFormulaColumns(
      [ref('formula__bad', 'revenue - nope'), ref('formula__good', 'revenue - cost')],
      fields,
    )
    const results = evaluateFormulaRow(set, { revenue: 1000, cost: 620 })
    expect(results.get('formula__good')).toEqual({ state: 'ok', value: 380 })
    const bad = results.get('formula__bad') as Extract<FormulaCellResult, { state: 'error' }>
    expect(bad.state).toBe('error')
    expect(bad.issue.code).toBe('unknown_field')
  })

  it('refuses a cycle at compile time rather than recursing at render time', () => {
    const set = compileFormulaColumns([ref('formula__a', 'formula__a + 1')], fields)
    expect(set.order).toHaveLength(0)
    expect(set.invalid.get('formula__a')?.code).toBe('cycle')
    expect(() => evaluateFormulaRow(set, { revenue: 1 })).not.toThrow()
  })

  it('records only genuine inputs as cache keys, not other formula columns', () => {
    const set = compileFormulaColumns(
      [
        ref('formula__margin', 'revenue - cost'),
        ref('formula__pct', 'formula__margin / revenue'),
      ],
      fields,
    )
    expect(set.inputKeys.sort()).toEqual(['cost', 'revenue'])
  })
})

describe('createFormulaRowEvaluator', () => {
  const set = compileFormulaColumns(
    [{ key: 'formula__margin', label: 'Margin', expression: 'revenue - cost', resultType: 'number' }],
    fields,
  )

  it('returns the cached result while the inputs are unchanged', () => {
    const evaluate = createFormulaRowEvaluator(set)
    const row = { revenue: 1000, cost: 620, ref_no: 'A' }
    const first = evaluate(row)
    expect(evaluate(row)).toBe(first)
  })

  it('recomputes when an input is mutated IN PLACE, which is what the cell store does', () => {
    const evaluate = createFormulaRowEvaluator(set)
    const row: Record<string, unknown> = { revenue: 1000, cost: 620 }
    expect(evaluate(row).get('formula__margin')).toEqual({ state: 'ok', value: 380 })
    row.cost = 500
    expect(evaluate(row).get('formula__margin')).toEqual({ state: 'ok', value: 500 })
  })

  it('does not recompute when an unrelated field is mutated', () => {
    const evaluate = createFormulaRowEvaluator(set)
    const row: Record<string, unknown> = { revenue: 1000, cost: 620, ref_no: 'A' }
    const first = evaluate(row)
    row.ref_no = 'B'
    expect(evaluate(row)).toBe(first)
  })

  it('tolerates a missing row', () => {
    const evaluate = createFormulaRowEvaluator(set)
    expect(evaluate(undefined as unknown as Record<string, unknown>).size).toBe(0)
  })
})

describe('evaluateExpression', () => {
  it('drives the editor preview in one call', () => {
    expect(evaluateExpression('revenue - cost', { revenue: 10, cost: 4 }, fields)).toEqual({
      state: 'ok',
      value: 6,
    })
  })

  it('returns the syntax issue rather than throwing while the user types', () => {
    const result = evaluateExpression('revenue -', {}, fields)
    expect(result.state).toBe('error')
    if (result.state !== 'error') return
    expect(result.issue.code).toBe('syntax')
  })
})
