import * as React from 'react'
import { render } from '@testing-library/react'
import {
  buildFormulaColumnDefs,
  formatFormulaValue,
  formulaColumnDataKey,
  formulaErrorToken,
  isFormulaColumnKey,
  parseFormulaColumns,
  slugifyFormulaLabel,
  uniqueFormulaColumnKey,
} from '../utils/formulaColumns'
import { fieldMetaFromColumns } from '../formula/check'
import type { ColumnDef } from '../types/index'
import type { FormulaColumnRef } from '../formula/types'

const columns: ColumnDef[] = [
  { data: 'revenue', title: 'Revenue', type: 'numeric' },
  { data: 'cost', title: 'Cost', type: 'numeric' },
  { data: 'qty', title: 'Qty', type: 'numeric' },
  { data: 'ref_no', title: 'Reference', type: 'text' },
]
const fields = fieldMetaFromColumns(columns)

const margin: FormulaColumnRef = {
  key: 'formula__margin',
  label: 'Margin',
  expression: 'revenue - cost',
  resultType: 'number',
}

/** Render a column's cell for one row and return the rendered element. */
function renderCell(def: ColumnDef, row: Record<string, unknown>): HTMLElement {
  const { container } = render(<>{def.renderer!(undefined, row, null, 0, 0)}</>)
  return container.firstElementChild as HTMLElement
}

describe('column keys', () => {
  it('prefixes calculated columns so they are told apart by prefix alone', () => {
    expect(formulaColumnDataKey('margin')).toBe('formula__margin')
    expect(isFormulaColumnKey('formula__margin')).toBe(true)
    expect(isFormulaColumnKey('lookup__contractor__tax_id')).toBe(false)
  })

  it('slugifies a label to ASCII, including Polish diacritics', () => {
    expect(slugifyFormulaLabel('Margin')).toBe('margin')
    expect(slugifyFormulaLabel('Marża brutto')).toBe('marza_brutto')
    expect(slugifyFormulaLabel('Zysk / szt.')).toBe('zysk_szt')
    expect(slugifyFormulaLabel('€€€')).toBe('calc')
  })

  it('never collides two columns with the same label into one', () => {
    expect(uniqueFormulaColumnKey('Margin', [])).toBe('formula__margin')
    expect(uniqueFormulaColumnKey('Margin', ['formula__margin'])).toBe('formula__margin_2')
    expect(uniqueFormulaColumnKey('Margin', ['formula__margin', 'formula__margin_2'])).toBe(
      'formula__margin_3',
    )
  })
})

describe('buildFormulaColumnDefs — the ColumnDef contract', () => {
  it('produces a read-only, non-fillable column typed from the declared result', () => {
    const [def] = buildFormulaColumnDefs([margin], { fields })
    expect(def.data).toBe('formula__margin')
    expect(def.title).toBe('Margin')
    expect(def.readOnly).toBe(true)
    expect(def.disableFill).toBe(true)
    expect(def.type).toBe('numeric')
    expect(def.align).toBe('right')
  })

  it('types a text / boolean / date result correctly', () => {
    const [text] = buildFormulaColumnDefs([{ ...margin, expression: 'ref_no', resultType: 'text' }], { fields })
    expect(text.type).toBe('text')
    expect(text.align).toBeUndefined()
    const [bool] = buildFormulaColumnDefs(
      [{ ...margin, expression: 'revenue > cost', resultType: 'boolean' }],
      { fields },
    )
    expect(bool.type).toBe('boolean')
  })
})

describe('buildFormulaColumnDefs — rendering', () => {
  it('computes for every row it is handed', () => {
    const [def] = buildFormulaColumnDefs([margin], { fields })
    expect(renderCell(def, { revenue: 1000, cost: 620 }).textContent).toBe('380')
    expect(renderCell(def, { revenue: 50, cost: 20 }).textContent).toBe('30')
  })

  it('shows an em dash, not 0 or NaN, when an input is blank', () => {
    const [def] = buildFormulaColumnDefs([margin], { fields })
    const cell = renderCell(def, { revenue: null, cost: 620 })
    expect(cell.getAttribute('data-formula-state')).toBe('empty')
    expect(cell.textContent).toBe('—')
  })

  it('shows the error IN THE CELL and leaves the rest of the grid rendering', () => {
    const [def] = buildFormulaColumnDefs(
      [{ ...margin, expression: 'revenue / qty' }],
      { fields },
    )
    const bad = renderCell(def, { revenue: 100, qty: 0 })
    expect(bad.getAttribute('data-formula-state')).toBe('error')
    expect(bad.getAttribute('data-formula-error')).toBe('divide_by_zero')
    expect(bad.textContent).toBe('#DIV/0!')
    expect(bad.getAttribute('title')).toBe('Cannot divide by zero')

    const good = renderCell(def, { revenue: 100, qty: 4 })
    expect(good.getAttribute('data-formula-state')).toBe('ok')
    expect(good.textContent).toBe('25')
  })

  it('translates the error tooltip when a translator is supplied', () => {
    const [def] = buildFormulaColumnDefs([{ ...margin, expression: 'revenue / qty' }], {
      fields,
      translate: (key) => `translated:${key}`,
    })
    expect(renderCell(def, { revenue: 1, qty: 0 }).getAttribute('title')).toBe(
      'translated:dynamicTable.formula.error.divideByZero',
    )
  })

  it('recomputes after the row object is mutated in place by an inline edit', () => {
    const [def] = buildFormulaColumnDefs([margin], { fields })
    const row: Record<string, unknown> = { revenue: 1000, cost: 620 }
    expect(renderCell(def, row).textContent).toBe('380')
    row.cost = 500
    expect(renderCell(def, row).textContent).toBe('500')
  })

  it('renders a boolean and a date in a stable, locale-free form', () => {
    const [bool] = buildFormulaColumnDefs(
      [{ ...margin, expression: 'revenue > cost', resultType: 'boolean' }],
      { fields },
    )
    expect(renderCell(bool, { revenue: 2, cost: 1 }).textContent).toBe('TRUE')

    const [date] = buildFormulaColumnDefs(
      [{ ...margin, expression: 'TODAY()', resultType: 'date' }],
      { fields, now: () => new Date(2026, 7, 3) },
    )
    expect(renderCell(date, {}).textContent).toBe('2026-08-03')
  })

  it('trims floating-point noise instead of showing 0.30000000000000004', () => {
    const [def] = buildFormulaColumnDefs([{ ...margin, expression: 'revenue + cost' }], { fields })
    expect(renderCell(def, { revenue: 0.1, cost: 0.2 }).textContent).toBe('0.3')
  })
})

describe('buildFormulaColumnDefs — export', () => {
  it('exports the computed value, not the (absent) stored one', () => {
    const [def] = buildFormulaColumnDefs([margin], { fields })
    expect(def.exportValue!(undefined, { revenue: 1000, cost: 620 })).toBe(380)
  })

  it('exports blank as null and an error as its Excel token', () => {
    const [def] = buildFormulaColumnDefs([{ ...margin, expression: 'revenue / qty' }], { fields })
    expect(def.exportValue!(undefined, { revenue: null, qty: 2 })).toBeNull()
    expect(def.exportValue!(undefined, { revenue: 1, qty: 0 })).toBe('#DIV/0!')
  })
})

describe('formatting helpers', () => {
  it('maps each error code to the Excel token users already read', () => {
    expect(formulaErrorToken('divide_by_zero')).toBe('#DIV/0!')
    expect(formulaErrorToken('type_mismatch')).toBe('#VALUE!')
    expect(formulaErrorToken('unknown_field')).toBe('#REF!')
    expect(formulaErrorToken('syntax')).toBe('#NAME?')
  })

  it('formats each value kind', () => {
    expect(formatFormulaValue({ state: 'ok', value: 12 })).toBe('12')
    expect(formatFormulaValue({ state: 'ok', value: true })).toBe('TRUE')
    expect(formatFormulaValue({ state: 'ok', value: 'x' })).toBe('x')
    expect(formatFormulaValue({ state: 'empty', value: null })).toBe('')
  })
})

describe('parseFormulaColumns', () => {
  it('round-trips a well-formed definition', () => {
    expect(parseFormulaColumns([margin])).toEqual([margin])
  })

  it('drops anything malformed rather than crashing the table', () => {
    expect(parseFormulaColumns(undefined)).toEqual([])
    expect(parseFormulaColumns('nope')).toEqual([])
    expect(
      parseFormulaColumns([
        null,
        { key: 'not_a_formula_key', expression: 'a' },
        { key: 'formula__x' },
        { key: 'formula__y', expression: '   ' },
      ]),
    ).toEqual([])
  })

  it('defaults a missing label and an unknown result type', () => {
    expect(parseFormulaColumns([{ key: 'formula__x', expression: 'a', resultType: 'money' }])).toEqual(
      [{ key: 'formula__x', label: 'formula__x', expression: 'a', resultType: 'text' }],
    )
  })

  it('keeps the first of two definitions sharing a key', () => {
    expect(
      parseFormulaColumns([
        { key: 'formula__x', label: 'First', expression: 'a', resultType: 'number' },
        { key: 'formula__x', label: 'Second', expression: 'b', resultType: 'number' },
      ]),
    ).toEqual([{ key: 'formula__x', label: 'First', expression: 'a', resultType: 'number' }])
  })
})
