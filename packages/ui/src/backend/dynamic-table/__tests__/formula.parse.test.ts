import { collectFieldRefs, parseFormula, tokenize } from '../formula/parse'
import type { FormulaAst } from '../formula/types'

// The parser is the one place where a precedence slip produces a number that is
// wrong but plausible, so these assertions are on the AST shape rather than on
// an evaluated result — a wrong tree is caught here instead of being explained
// away downstream.

function ast(source: string): FormulaAst {
  const result = parseFormula(source)
  if (!result.ok) throw new Error(`expected a parse, got ${result.issue.message}`)
  return result.ast
}

function issue(source: string) {
  const result = parseFormula(source)
  if (result.ok) throw new Error(`expected a syntax error for ${source}`)
  return result.issue
}

describe('tokenize', () => {
  it('reads numbers, strings, identifiers and bracketed fields', () => {
    const tokens = tokenize('12.5 + "a b" + total_cost + [Unit price]')
    expect(tokens.map((t) => t.type)).toEqual([
      'number',
      'punct',
      'string',
      'punct',
      'ident',
      'punct',
      'field',
      'eof',
    ])
    expect(tokens[0].value).toBe(12.5)
    expect(tokens[2].value).toBe('a b')
    expect(tokens[6].text).toBe('Unit price')
  })

  it('prefers two-character operators over one-character ones', () => {
    expect(tokenize('a >= b').map((t) => t.text)).toEqual(['a', '>=', 'b', ''])
    expect(tokenize('a && b').map((t) => t.text)).toEqual(['a', '&&', 'b', ''])
    expect(tokenize('a & b').map((t) => t.text)).toEqual(['a', '&', 'b', ''])
  })

  it('honours backslash escapes inside strings', () => {
    expect(tokenize('"say \\"hi\\""')[0].value).toBe('say "hi"')
  })
})

describe('parseFormula — literals and references', () => {
  it('parses each literal kind', () => {
    expect(ast('42')).toEqual({ k: 'lit', v: 42 })
    expect(ast("'text'")).toEqual({ k: 'lit', v: 'text' })
    expect(ast('TRUE')).toEqual({ k: 'lit', v: true })
    expect(ast('false')).toEqual({ k: 'lit', v: false })
    expect(ast('NULL')).toEqual({ k: 'lit', v: null })
  })

  it('parses bare and bracketed field references', () => {
    expect(ast('revenue')).toEqual({ k: 'field', name: 'revenue' })
    expect(ast('[Unit price]')).toEqual({ k: 'field', name: 'Unit price' })
    expect(ast('lookup__contractor__tax_id')).toEqual({
      k: 'field',
      name: 'lookup__contractor__tax_id',
    })
  })
})

describe('parseFormula — precedence', () => {
  it('binds * tighter than +', () => {
    expect(ast('1 + 2 * 3')).toEqual({
      k: 'bin',
      op: '+',
      l: { k: 'lit', v: 1 },
      r: { k: 'bin', op: '*', l: { k: 'lit', v: 2 }, r: { k: 'lit', v: 3 } },
    })
  })

  it('honours explicit parentheses over precedence', () => {
    expect(ast('(1 + 2) * 3')).toEqual({
      k: 'bin',
      op: '*',
      l: { k: 'bin', op: '+', l: { k: 'lit', v: 1 }, r: { k: 'lit', v: 2 } },
      r: { k: 'lit', v: 3 },
    })
  })

  it('is left-associative for - and /', () => {
    expect(ast('10 - 3 - 2')).toEqual({
      k: 'bin',
      op: '-',
      l: { k: 'bin', op: '-', l: { k: 'lit', v: 10 }, r: { k: 'lit', v: 3 } },
      r: { k: 'lit', v: 2 },
    })
  })

  it('binds & (concat) tighter than comparison, as Excel does', () => {
    expect(ast("a & b = 'x'")).toEqual({
      k: 'bin',
      op: '=',
      l: { k: 'bin', op: 'concat', l: { k: 'field', name: 'a' }, r: { k: 'field', name: 'b' } },
      r: { k: 'lit', v: 'x' },
    })
  })

  it('binds comparison tighter than AND, and AND tighter than OR', () => {
    expect(ast('a > 1 AND b < 2 OR c')).toEqual({
      k: 'bin',
      op: '||',
      l: {
        k: 'bin',
        op: '&&',
        l: { k: 'bin', op: '>', l: { k: 'field', name: 'a' }, r: { k: 'lit', v: 1 } },
        r: { k: 'bin', op: '<', l: { k: 'field', name: 'b' }, r: { k: 'lit', v: 2 } },
      },
      r: { k: 'field', name: 'c' },
    })
  })

  it('applies unary minus before multiplication', () => {
    expect(ast('-a * 2')).toEqual({
      k: 'bin',
      op: '*',
      l: { k: 'neg', e: { k: 'field', name: 'a' } },
      r: { k: 'lit', v: 2 },
    })
  })

  it('normalises the alternate spellings of the comparison operators', () => {
    expect(ast('a <> b')).toEqual({
      k: 'bin',
      op: '!=',
      l: { k: 'field', name: 'a' },
      r: { k: 'field', name: 'b' },
    })
    expect(ast('a == b')).toEqual({
      k: 'bin',
      op: '=',
      l: { k: 'field', name: 'a' },
      r: { k: 'field', name: 'b' },
    })
  })
})

describe('parseFormula — calls', () => {
  it('upper-cases the function name so IF and if are one function', () => {
    expect(ast('if(a, 1, 2)')).toEqual({
      k: 'call',
      fn: 'IF',
      args: [{ k: 'field', name: 'a' }, { k: 'lit', v: 1 }, { k: 'lit', v: 2 }],
    })
  })

  it('parses a zero-argument call', () => {
    expect(ast('TODAY()')).toEqual({ k: 'call', fn: 'TODAY', args: [] })
  })

  it('parses nested calls', () => {
    expect(ast('ROUND(SUM(a, b), 2)')).toEqual({
      k: 'call',
      fn: 'ROUND',
      args: [
        { k: 'call', fn: 'SUM', args: [{ k: 'field', name: 'a' }, { k: 'field', name: 'b' }] },
        { k: 'lit', v: 2 },
      ],
    })
  })

  it('reads AND as a function when it is followed by "(" and as an operator otherwise', () => {
    expect(ast('AND(a, b)')).toEqual({
      k: 'call',
      fn: 'AND',
      args: [{ k: 'field', name: 'a' }, { k: 'field', name: 'b' }],
    })
    expect(ast('a AND b')).toEqual({
      k: 'bin',
      op: '&&',
      l: { k: 'field', name: 'a' },
      r: { k: 'field', name: 'b' },
    })
  })

  it('lowers NOT to the library function, keeping the AST to five node kinds', () => {
    expect(ast('NOT a')).toEqual({ k: 'call', fn: 'NOT', args: [{ k: 'field', name: 'a' }] })
    expect(ast('!a')).toEqual({ k: 'call', fn: 'NOT', args: [{ k: 'field', name: 'a' }] })
  })
})

describe('parseFormula — syntax errors', () => {
  it('never throws; a malformed formula is a returned issue', () => {
    expect(() => parseFormula('((((')).not.toThrow()
    expect(parseFormula('((((').ok).toBe(false)
  })

  it('reports the offending token and its position', () => {
    const err = issue('a + ')
    expect(err.code).toBe('syntax')
    expect(err.params?.token).toBe('end of formula')
    expect(err.position).toBe(4)
  })

  it('rejects an unknown character', () => {
    expect(issue('2 ^ 3').params?.token).toBe('^')
  })

  it('rejects an unterminated string and an unterminated bracket', () => {
    expect(issue('"abc').code).toBe('syntax')
    expect(issue('[abc').code).toBe('syntax')
    expect(issue('[]').code).toBe('syntax')
  })

  it('rejects a chained comparison rather than silently mis-reading it', () => {
    expect(issue('a < b < c').code).toBe('syntax')
  })

  it('rejects trailing input after a complete expression', () => {
    expect(issue('1 2').code).toBe('syntax')
  })

  it('treats an empty expression as a syntax issue, not a crash', () => {
    expect(issue('   ').code).toBe('syntax')
  })
})

describe('collectFieldRefs', () => {
  it('collects every reference once, in first-seen order', () => {
    expect(collectFieldRefs(ast('IF(a > b, a - b, [Other] & a)'))).toEqual(['a', 'b', 'Other'])
  })

  it('returns nothing for an expression over literals only', () => {
    expect(collectFieldRefs(ast('1 + 2'))).toEqual([])
  })
})
