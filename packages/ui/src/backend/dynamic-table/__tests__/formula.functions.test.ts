import { evaluateAst } from '../formula/evaluate'
import { parseFormula } from '../formula/parse'
import {
  FORMULA_FUNCTIONS,
  FORMULA_FUNCTION_NAMES,
  FORMULA_FUNCTION_SIGNATURES,
  lookupFormulaFunction,
} from '../formula/functions'
import type { FormulaValue } from '../formula/types'

// One assertion per function, plus the blank-handling rule each one commits to.
// These are the cheapest tests in the codebase and they guard the most
// expensive class of bug: a number that is wrong but plausible.

const NOW = new Date(2026, 7, 3) // 2026-08-03, local

function call(expression: string, row: Record<string, unknown> = {}): FormulaValue {
  const parsed = parseFormula(expression)
  if (!parsed.ok) throw new Error(`unparsable: ${expression} — ${parsed.issue.message}`)
  const result = evaluateAst(parsed.ast, row, { now: () => NOW })
  if (!result.ok) throw new Error(`expected a value, got ${result.issue.code}`)
  return result.value
}

function callError(expression: string, row: Record<string, unknown> = {}): string {
  const parsed = parseFormula(expression)
  if (!parsed.ok) return parsed.issue.code
  const result = evaluateAst(parsed.ast, row, { now: () => NOW })
  if (result.ok) throw new Error(`expected an error, got ${String(result.value)}`)
  return result.issue.code
}

describe('the registry', () => {
  it('exposes every function under a canonical upper-case name', () => {
    for (const name of FORMULA_FUNCTION_NAMES) {
      expect(FORMULA_FUNCTIONS[name].name).toBe(name)
      expect(name).toBe(name.toUpperCase())
    }
  })

  it('looks functions up case-insensitively', () => {
    expect(lookupFormulaFunction('round')?.name).toBe('ROUND')
    expect(lookupFormulaFunction('Round')?.name).toBe('ROUND')
    expect(lookupFormulaFunction('nope')).toBeUndefined()
  })

  it('gives every function a signature for the editor list', () => {
    expect(FORMULA_FUNCTION_SIGNATURES).toHaveLength(FORMULA_FUNCTION_NAMES.length)
    for (const entry of FORMULA_FUNCTION_SIGNATURES) {
      expect(entry.signature).toContain(entry.name)
    }
  })

  it('covers the freight cases the spec names', () => {
    for (const name of ['IF', 'COALESCE', 'ROUND', 'ABS', 'MIN', 'MAX', 'DAYS_BETWEEN', 'CONCAT', 'UPPER', 'LOWER', 'LEN', 'IS_EMPTY']) {
      expect(FORMULA_FUNCTION_NAMES).toContain(name)
    }
  })
})

describe('logic', () => {
  it('IF picks a branch and evaluates only that branch', () => {
    expect(call('IF(a > 1, "big", "small")', { a: 2 })).toBe('big')
    expect(call('IF(a > 1, "big", "small")', { a: 0 })).toBe('small')
  })

  it('IF treats a blank condition as false', () => {
    expect(call('IF(a, 1, 2)', { a: null })).toBe(2)
  })

  it('IF does not evaluate the branch it did not take', () => {
    // The untaken branch divides by zero; taking it would error.
    expect(call('IF(a > 1, 10, 1 / 0)', { a: 5 })).toBe(10)
  })

  it('IFERROR replaces an error with a fallback', () => {
    expect(call('IFERROR(a / b, 0)', { a: 1, b: 0 })).toBe(0)
    expect(call('IFERROR(a / b, 0)', { a: 10, b: 2 })).toBe(5)
  })

  it('AND and OR short-circuit and skip the rest', () => {
    expect(call('AND(TRUE, FALSE, 1 / 0 > 0)')).toBe(false)
    expect(call('OR(FALSE, TRUE, 1 / 0 > 0)')).toBe(true)
    expect(call('AND(TRUE, TRUE)')).toBe(true)
    expect(call('OR(FALSE, FALSE)')).toBe(false)
  })

  it('NOT inverts, and stays blank on a blank', () => {
    expect(call('NOT(TRUE)')).toBe(false)
    expect(call('NOT(a)', { a: null })).toBeNull()
  })

  it('IS_EMPTY sees blanks and empty strings, and only those', () => {
    expect(call('IS_EMPTY(a)', { a: null })).toBe(true)
    expect(call('IS_EMPTY(a)', {})).toBe(true)
    expect(call('IS_EMPTY(a)', { a: '' })).toBe(true)
    expect(call('IS_EMPTY(a)', { a: 0 })).toBe(false)
    expect(call('IS_EMPTY(a)', { a: 'x' })).toBe(false)
  })

  it('COALESCE returns the first present value', () => {
    expect(call('COALESCE(a, b, 0)', { a: null, b: 7 })).toBe(7)
    expect(call('COALESCE(a, b, 0)', { a: null, b: null })).toBe(0)
    expect(call('COALESCE(a, b)', { a: null, b: null })).toBeNull()
  })
})

describe('maths', () => {
  it('ABS, CEILING, FLOOR, SQRT', () => {
    expect(call('ABS(-4)')).toBe(4)
    expect(call('CEILING(1.2)')).toBe(2)
    expect(call('FLOOR(1.8)')).toBe(1)
    expect(call('SQRT(9)')).toBe(3)
    expect(callError('SQRT(-1)')).toBe('type_mismatch')
  })

  it('ROUND rounds half away from zero, as Excel does', () => {
    expect(call('ROUND(2.5)')).toBe(3)
    expect(call('ROUND(-2.5)')).toBe(-3)
    expect(call('ROUND(1.005, 2)')).toBe(1.01)
    expect(call('ROUND(1234.5678, 2)')).toBe(1234.57)
    expect(call('ROUND(1234.5678, 0)')).toBe(1235)
  })

  it('MIN, MAX, SUM and AVERAGE skip blanks rather than treating them as zero', () => {
    expect(call('MIN(3, 1, 2)')).toBe(1)
    expect(call('MAX(3, 1, 2)')).toBe(3)
    expect(call('SUM(1, 2, 3)')).toBe(6)
    expect(call('AVERAGE(2, 4)')).toBe(3)
    expect(call('MIN(a, 5)', { a: null })).toBe(5)
    expect(call('SUM(a, 5)', { a: null })).toBe(5)
    expect(call('AVERAGE(a, 4)', { a: null })).toBe(4)
  })

  it('every-argument-blank yields blank, not zero', () => {
    expect(call('SUM(a, b)', { a: null, b: null })).toBeNull()
  })

  it('POWER and MOD', () => {
    expect(call('POWER(2, 10)')).toBe(1024)
    expect(call('MOD(7, 3)')).toBe(1)
    expect(callError('MOD(7, 0)')).toBe('divide_by_zero')
  })
})

describe('text', () => {
  it('CONCAT joins and drops blanks', () => {
    expect(call('CONCAT("A", "-", 1)')).toBe('A-1')
    expect(call('CONCAT(a, "B")', { a: null })).toBe('B')
  })

  it('UPPER, LOWER, TRIM, LEN', () => {
    expect(call('UPPER("abc")')).toBe('ABC')
    expect(call('LOWER("ABC")')).toBe('abc')
    expect(call('TRIM("  x  ")')).toBe('x')
    expect(call('LEN("abcd")')).toBe(4)
  })

  it('LEFT and RIGHT', () => {
    expect(call('LEFT("MSCU7234561", 4)')).toBe('MSCU')
    expect(call('RIGHT("MSCU7234561", 7)')).toBe('7234561')
    expect(call('RIGHT("abc", 0)')).toBe('')
  })

  it('CONTAINS is case-insensitive, matching how people search', () => {
    expect(call('CONTAINS("Gdańsk terminal", "TERMINAL")')).toBe(true)
    expect(call('CONTAINS("Gdańsk terminal", "hamburg")')).toBe(false)
  })

  it('TEXT and VALUE convert across the boundary', () => {
    expect(call('TEXT(12.5)')).toBe('12.5')
    expect(call('VALUE("12.5")')).toBe(12.5)
    expect(callError('VALUE("abc")')).toBe('type_mismatch')
  })

  it('text functions stay blank on a blank rather than returning ""', () => {
    expect(call('UPPER(a)', { a: null })).toBeNull()
    expect(call('LEN(a)', { a: null })).toBeNull()
  })
})

describe('dates', () => {
  it('TODAY uses the injected clock and is truncated to the day', () => {
    expect(call('TODAY()')).toEqual(new Date(2026, 7, 3))
  })

  it('DAYS_BETWEEN counts whole days and is signed', () => {
    expect(call('DAYS_BETWEEN(a, b)', { a: '2026-01-01', b: '2026-01-31' })).toBe(30)
    expect(call('DAYS_BETWEEN(a, b)', { a: '2026-01-31', b: '2026-01-01' })).toBe(-30)
  })

  it('DAYS_BETWEEN ignores the time of day', () => {
    expect(
      call('DAYS_BETWEEN(a, b)', { a: new Date(2026, 0, 1, 23), b: new Date(2026, 0, 2, 1) }),
    ).toBe(1)
  })

  it('DATE_ADD shifts by whole days', () => {
    expect(call('DATE_ADD(a, 10)', { a: '2026-01-25' })).toEqual(new Date(2026, 1, 4))
  })

  it('YEAR, MONTH and DAY are 1-based for the month, matching Excel', () => {
    expect(call('YEAR(a)', { a: '2026-08-03' })).toBe(2026)
    expect(call('MONTH(a)', { a: '2026-08-03' })).toBe(8)
    expect(call('DAY(a)', { a: '2026-08-03' })).toBe(3)
  })

  it('rejects a value that is not a date rather than guessing a locale', () => {
    expect(callError('YEAR(a)', { a: '03/08/2026' })).toBe('type_mismatch')
  })

  it('stays blank on a blank date', () => {
    expect(call('DAYS_BETWEEN(a, b)', { a: null, b: '2026-01-01' })).toBeNull()
  })
})

describe('arity is enforced at evaluation too, not only at definition', () => {
  it('rejects too few and too many arguments', () => {
    expect(callError('ABS()')).toBe('arity')
    expect(callError('ABS(1, 2)')).toBe('arity')
  })

  it('rejects an unknown function', () => {
    expect(callError('VLOOKUP(1)')).toBe('unknown_function')
  })
})
