import {
  checkAst,
  checkFormulaColumn,
  columnTypeToFormulaType,
  detectFormulaCycles,
  fieldMetaFromColumns,
} from '../formula/check'
import { parseFormula } from '../formula/parse'
import type { FormulaColumnRef, FormulaFieldMeta } from '../formula/types'

// Everything asserted here happens when the user SAVES the formula. The
// contract this file defends is that a saved view can never contain a formula
// with an unknown reference or a cycle, so no cell ever has to discover one.

const fields: FormulaFieldMeta[] = [
  { key: 'revenue', label: 'Revenue', type: 'number' },
  { key: 'cost', label: 'Cost', type: 'number' },
  { key: 'ref_no', label: 'Reference', type: 'text' },
  { key: 'etd', label: 'ETD', type: 'date' },
  { key: 'is_paid', label: 'Paid', type: 'boolean' },
  { key: 'mystery', label: 'Mystery', type: 'unknown' },
]

function check(expression: string) {
  const parsed = parseFormula(expression)
  if (!parsed.ok) throw new Error(`unparsable test input: ${expression}`)
  return checkAst(parsed.ast, { fields })
}

function codes(expression: string): string[] {
  const result = check(expression)
  return result.ok ? [] : result.issues.map((i) => i.code)
}

describe('checkAst — types', () => {
  it('types same-row arithmetic as a number', () => {
    expect(check('revenue - cost')).toEqual({ ok: true, type: 'number' })
  })

  it('types a comparison as a boolean and a concat as text', () => {
    expect(check('revenue > cost')).toEqual({ ok: true, type: 'boolean' })
    expect(check("ref_no & '-' & revenue")).toEqual({ ok: true, type: 'text' })
  })

  it('takes a function result type from the library', () => {
    expect(check('DAYS_BETWEEN(etd, TODAY())')).toEqual({ ok: true, type: 'number' })
    expect(check('UPPER(ref_no)')).toEqual({ ok: true, type: 'text' })
  })

  it('resolves IF to the type both branches agree on, and unknown otherwise', () => {
    expect(check('IF(is_paid, revenue, cost)')).toEqual({ ok: true, type: 'number' })
    expect(check('IF(is_paid, revenue, ref_no)')).toEqual({ ok: true, type: 'unknown' })
  })
})

describe('checkAst — reference errors', () => {
  it('rejects an unknown column and names it', () => {
    const result = check('revenue - profit')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0].code).toBe('unknown_field')
    expect(result.issues[0].params?.name).toBe('profit')
  })

  it('collects every problem, not just the first', () => {
    expect(codes('missing_a + missing_b')).toEqual(['unknown_field', 'unknown_field'])
  })
})

describe('checkAst — type errors', () => {
  it('rejects text in arithmetic and names the column by its label', () => {
    const result = check('revenue - ref_no')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0].code).toBe('type_mismatch')
    expect(result.issues[0].params?.name).toBe('Reference')
    expect(result.issues[0].message).toBe('Reference is not a number')
  })

  it('rejects a non-boolean operand of AND', () => {
    expect(codes('revenue AND is_paid')).toEqual(['type_mismatch'])
  })

  it('rejects an argument whose type the function does not take', () => {
    expect(codes('UPPER(revenue)')).toEqual(['type_mismatch'])
  })

  it('rejects ordering a date against a number', () => {
    expect(codes('etd > revenue')).toEqual(['type_mismatch'])
  })

  it('never complains about a column whose type the host did not declare', () => {
    expect(check('mystery * 2')).toEqual({ ok: true, type: 'number' })
    expect(check('UPPER(mystery)')).toEqual({ ok: true, type: 'text' })
  })
})

describe('checkAst — functions', () => {
  it('rejects an unknown function', () => {
    const result = check('VLOOKUP(revenue)')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0].code).toBe('unknown_function')
    expect(result.issues[0].params?.name).toBe('VLOOKUP')
  })

  it('rejects the wrong number of arguments', () => {
    expect(codes('IF(is_paid, revenue)')).toEqual(['arity'])
    expect(codes('ABS(revenue, cost)')).toEqual(['arity'])
  })

  it('accepts any number of arguments for a variadic function', () => {
    expect(check('SUM(revenue, cost, 10)')).toEqual({ ok: true, type: 'number' })
  })
})

describe('checkAst — divide by zero', () => {
  it('is caught at definition time when the divisor is a literal zero', () => {
    expect(codes('revenue / 0')).toEqual(['divide_by_zero'])
  })

  it('is left to evaluation when the divisor is a column', () => {
    expect(check('revenue / cost')).toEqual({ ok: true, type: 'number' })
  })
})

describe('detectFormulaCycles', () => {
  const ref = (key: string, expression: string): FormulaColumnRef => ({
    key,
    label: key,
    expression,
    resultType: 'number',
  })

  it('finds a self-reference', () => {
    const cycles = detectFormulaCycles([ref('formula__a', 'formula__a + 1')])
    expect(cycles.get('formula__a')).toEqual(['formula__a', 'formula__a'])
  })

  it('finds a mutual reference and flags every participant', () => {
    const cycles = detectFormulaCycles([
      ref('formula__a', 'formula__b + 1'),
      ref('formula__b', 'formula__a + 1'),
    ])
    expect(cycles.has('formula__a')).toBe(true)
    expect(cycles.has('formula__b')).toBe(true)
  })

  it('allows a chain that is not a cycle', () => {
    const cycles = detectFormulaCycles([
      ref('formula__a', 'revenue - cost'),
      ref('formula__b', 'formula__a * 2'),
      ref('formula__c', 'formula__b + formula__a'),
    ])
    expect(cycles.size).toBe(0)
  })

  it('ignores a formula that does not parse rather than crashing', () => {
    expect(detectFormulaCycles([ref('formula__a', '((((')]).size).toBe(0)
  })
})

describe('checkFormulaColumn', () => {
  const margin: FormulaColumnRef = {
    key: 'formula__margin',
    label: 'Margin',
    expression: 'revenue - cost',
    resultType: 'number',
  }

  it('accepts a well-formed definition', () => {
    const result = checkFormulaColumn({ ref: margin, fields })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.type).toBe('number')
  })

  it('refuses a self-referencing formula at definition time', () => {
    const result = checkFormulaColumn({
      ref: { ...margin, expression: 'formula__margin + 1' },
      fields,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0].code).toBe('cycle')
    expect(result.issues[0].message).toBe('This formula refers to itself')
  })

  it('refuses a formula that closes a cycle with an existing one', () => {
    const other: FormulaColumnRef = {
      key: 'formula__other',
      label: 'Other',
      expression: 'formula__margin * 2',
      resultType: 'number',
    }
    const result = checkFormulaColumn({
      ref: { ...margin, expression: 'formula__other - cost' },
      fields,
      existing: [other],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0].code).toBe('cycle')
  })

  it('lets a formula read another formula column', () => {
    const result = checkFormulaColumn({
      ref: {
        key: 'formula__margin_pct',
        label: 'Margin %',
        expression: 'formula__margin / revenue * 100',
        resultType: 'number',
      },
      fields,
      existing: [margin],
    })
    expect(result.ok).toBe(true)
  })

  it('does not mistake re-saving a formula for a cycle with its own old version', () => {
    const result = checkFormulaColumn({
      ref: { ...margin, expression: 'revenue - cost - 1' },
      fields,
      existing: [margin],
    })
    expect(result.ok).toBe(true)
  })

  it('reports a syntax error before anything else', () => {
    const result = checkFormulaColumn({ ref: { ...margin, expression: 'revenue -' }, fields })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0].code).toBe('syntax')
  })
})

describe('column metadata', () => {
  it('translates ColumnDef.type into the checker vocabulary', () => {
    expect(columnTypeToFormulaType('numeric')).toBe('number')
    expect(columnTypeToFormulaType('date')).toBe('date')
    expect(columnTypeToFormulaType('boolean')).toBe('boolean')
    expect(columnTypeToFormulaType('dropdown')).toBe('text')
    expect(columnTypeToFormulaType(undefined)).toBe('unknown')
  })

  it('derives field metadata from column defs', () => {
    expect(
      fieldMetaFromColumns([
        { data: 'revenue', title: 'Revenue', type: 'numeric' },
        { data: 'note' },
      ]),
    ).toEqual([
      { key: 'revenue', label: 'Revenue', type: 'number' },
      { key: 'note', label: undefined, type: 'unknown' },
    ])
  })
})
