import { coerceCellValue } from '../utils/coerceCellValue'
import type { ColumnDef } from '../types/index'

const text: ColumnDef = { data: 'name', type: 'text' }
const numeric: ColumnDef = { data: 'amount', type: 'numeric' }
const date: ColumnDef = { data: 'due', type: 'date' }
const bool: ColumnDef = { data: 'paid', type: 'boolean' }
const untyped: ColumnDef = { data: 'note' }

describe('coerceCellValue', () => {
  it('refuses a read-only column before looking at the value at all', () => {
    expect(coerceCellValue('anything', { ...text, readOnly: true })).toEqual({
      ok: false,
      reason: 'readOnly',
    })
  })

  it('lets a cell be cleared on every typed column — required-ness is decided one level up', () => {
    for (const col of [numeric, date, bool, text]) {
      expect(coerceCellValue('', col)).toEqual({ ok: true, value: null })
      expect(coerceCellValue(null, col)).toEqual({ ok: true, value: null })
    }
  })

  it('passes an untyped column straight through, including the empty string', () => {
    expect(coerceCellValue('', untyped)).toEqual({ ok: true, value: '' })
    expect(coerceCellValue({ a: 1 }, untyped)).toEqual({ ok: true, value: { a: 1 } })
  })

  describe('numeric', () => {
    it('parses a plain number', () => {
      expect(coerceCellValue('42.5', numeric)).toEqual({ ok: true, value: 42.5 })
    })

    it('reads the Polish decimal comma the way the user typed it', () => {
      // `parseFloat('1,5')` is 1 — silently a tenfold error on a cost column.
      expect(coerceCellValue('1,5', numeric)).toEqual({ ok: true, value: 1.5 })
    })

    it('REJECTS a non-number instead of blanking the cell', () => {
      // This is the whole point of the verdict: a paste of 200 cells reports
      // "3 were not numbers" rather than quietly emptying three of them.
      expect(coerceCellValue('abc', numeric)).toEqual({ ok: false, reason: 'notCoercible' })
    })
  })

  describe('date', () => {
    it('normalises to YYYY-MM-DD', () => {
      expect(coerceCellValue('2026-03-04', date)).toEqual({ ok: true, value: '2026-03-04' })
    })

    it('keeps the LOCAL day, so a midnight date does not slip back a day', () => {
      const local = new Date(2026, 0, 1, 0, 30)
      expect(coerceCellValue(local, date)).toEqual({ ok: true, value: '2026-01-01' })
    })

    it('rejects a date that is not a date', () => {
      expect(coerceCellValue('not-a-date', date)).toEqual({ ok: false, reason: 'notCoercible' })
    })
  })

  describe('boolean', () => {
    it.each([
      ['true', true],
      ['1', true],
      ['yes', true],
      ['tak', true],
      ['false', false],
      ['0', false],
      ['nie', false],
    ])('reads %s as %s', (input, expected) => {
      expect(coerceCellValue(input, bool)).toEqual({ ok: true, value: expected })
    })

    it('rejects a word that means neither', () => {
      expect(coerceCellValue('maybe', bool)).toEqual({ ok: false, reason: 'notCoercible' })
    })
  })

  describe('dropdown / multiselect', () => {
    const status: ColumnDef = { data: 'status', type: 'dropdown', source: ['draft', 'sent'] }

    it('accepts a value that is in the source', () => {
      expect(coerceCellValue('sent', status)).toEqual({ ok: true, value: 'sent' })
    })

    it('rejects a value outside the source with its own reason', () => {
      // Distinct from notCoercible: the user pasted a real string, it just is
      // not one this column can hold, and the report says so.
      expect(coerceCellValue('paid', status)).toEqual({ ok: false, reason: 'notInSource' })
    })

    it('reads {value,label} and {id,name} option shapes', () => {
      const objectSource: ColumnDef = {
        data: 'status',
        type: 'dropdown',
        source: [{ value: 'draft', label: 'Szkic' }, { id: 'sent', name: 'Wysłana' }],
      }
      expect(coerceCellValue('draft', objectSource)).toEqual({ ok: true, value: 'draft' })
      expect(coerceCellValue('sent', objectSource)).toEqual({ ok: true, value: 'sent' })
      expect(coerceCellValue('Szkic', objectSource)).toEqual({ ok: false, reason: 'notInSource' })
    })

    it('passes through when the column declares no source at all', () => {
      expect(coerceCellValue('anything', { data: 'x', type: 'dropdown' })).toEqual({
        ok: true,
        value: 'anything',
      })
    })

    it('checks every entry of a multiselect value', () => {
      const tags: ColumnDef = { data: 'tags', type: 'multiselect', source: ['a', 'b'] }
      expect(coerceCellValue(['a', 'b'], tags)).toEqual({ ok: true, value: ['a', 'b'] })
      expect(coerceCellValue(['a', 'zzz'], tags)).toEqual({ ok: false, reason: 'notInSource' })
    })
  })
})
