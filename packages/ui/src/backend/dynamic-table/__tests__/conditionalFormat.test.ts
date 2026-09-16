import {
  compileConditionalFormats,
  conditionalFormatClassName,
  parseConditionalFormats,
  generateConditionalFormatRuleId,
  MAX_CONDITIONAL_FORMAT_RULES,
  type ConditionalFormatRule,
} from '../utils/conditionalFormat'

const rule = (over: Partial<ConditionalFormatRule>): ConditionalFormatRule => ({
  id: 'cf-1',
  field: 'amount',
  operator: 'gt',
  value: 100,
  style: 'red',
  ...over,
})

function paint(rules: ConditionalFormatRule[], field: string, value: unknown, row: any = {}) {
  return conditionalFormatClassName(compileConditionalFormats(rules), field, value, row)
}

describe('conditionalFormat — operators', () => {
  it('numeric comparisons', () => {
    expect(paint([rule({ operator: 'gt', value: 100 })], 'amount', 150)).toBe('cell-red')
    expect(paint([rule({ operator: 'gt', value: 100 })], 'amount', 50)).toBeUndefined()
    expect(paint([rule({ operator: 'gte', value: 100 })], 'amount', 100)).toBe('cell-red')
    expect(paint([rule({ operator: 'lt', value: 100 })], 'amount', 99)).toBe('cell-red')
    expect(paint([rule({ operator: 'lte', value: 100 })], 'amount', 100)).toBe('cell-red')
  })

  it('compares string cell values numerically (the grid stores numbers as text)', () => {
    expect(paint([rule({ operator: 'gt', value: 100 })], 'amount', '150.50')).toBe('cell-red')
  })

  it('eq / neq fall back to case-insensitive text when the value is not numeric', () => {
    const r = rule({ field: 'status', operator: 'eq', value: 'Open', style: 'green' })
    expect(paint([r], 'status', 'open')).toBe('cell-green')
    expect(paint([r], 'status', 'closed')).toBeUndefined()
    expect(paint([{ ...r, operator: 'neq' }], 'status', 'closed')).toBe('cell-green')
  })

  it('contains is case-insensitive substring matching', () => {
    const r = rule({ field: 'name', operator: 'contains', value: 'ACME', style: 'yellow' })
    expect(paint([r], 'name', 'acme logistics')).toBe('cell-yellow')
    expect(paint([r], 'name', 'other')).toBeUndefined()
  })

  it('isEmpty / isNotEmpty treat blank strings as empty', () => {
    const empty = rule({ field: 'ref', operator: 'isEmpty', style: 'red-subtle' })
    expect(paint([empty], 'ref', '')).toBe('cell-red-subtle')
    expect(paint([empty], 'ref', '   ')).toBe('cell-red-subtle')
    expect(paint([empty], 'ref', null)).toBe('cell-red-subtle')
    expect(paint([empty], 'ref', 'X')).toBeUndefined()
    expect(paint([{ ...empty, operator: 'isNotEmpty' }], 'ref', 'X')).toBe('cell-red-subtle')
  })
})

describe('conditionalFormat — the ETA-vs-ATA relative case', () => {
  const delayed = rule({
    id: 'cf-delay',
    field: 'ata',
    operator: 'afterField',
    compareField: 'eta',
    style: 'red',
  })

  it('paints the cell when the actual arrival is after the estimate', () => {
    expect(paint([delayed], 'ata', '2026-08-05', { eta: '2026-08-01', ata: '2026-08-05' })).toBe(
      'cell-red',
    )
  })

  it('leaves an on-time arrival alone', () => {
    expect(
      paint([delayed], 'ata', '2026-07-30', { eta: '2026-08-01', ata: '2026-07-30' }),
    ).toBeUndefined()
  })

  it('does not paint when either side is missing rather than guessing', () => {
    expect(paint([delayed], 'ata', null, { eta: '2026-08-01' })).toBeUndefined()
    expect(paint([delayed], 'ata', '2026-08-05', {})).toBeUndefined()
  })

  it('beforeField is the mirror image', () => {
    const early = { ...delayed, operator: 'beforeField' as const, style: 'green' as const }
    expect(paint([early], 'ata', '2026-07-30', { eta: '2026-08-01' })).toBe('cell-green')
  })
})

describe('conditionalFormat — compilation', () => {
  it('first matching rule wins', () => {
    const rules = [
      rule({ id: 'a', operator: 'gt', value: 10, style: 'yellow' }),
      rule({ id: 'b', operator: 'gt', value: 100, style: 'red' }),
    ]
    expect(paint(rules, 'amount', 150)).toBe('cell-yellow')
  })

  it('only evaluates rules for the cell’s own field', () => {
    const rules = [rule({ field: 'other', operator: 'isNotEmpty' })]
    expect(paint(rules, 'amount', 5)).toBeUndefined()
  })

  it('drops rules that cannot produce a predicate instead of matching everything', () => {
    const broken = [
      rule({ operator: 'gt', value: 'not-a-number' }),
      rule({ id: 'cf-2', operator: 'beforeField', compareField: undefined }),
      rule({ id: 'cf-3', operator: 'contains', value: '' }),
    ]
    const compiled = compileConditionalFormats(broken)
    expect(compiled.isEmpty).toBe(true)
    expect(conditionalFormatClassName(compiled, 'amount', 999, {})).toBeUndefined()
  })

  it('an empty rule set short-circuits', () => {
    expect(compileConditionalFormats([]).isEmpty).toBe(true)
    expect(compileConditionalFormats(undefined).isEmpty).toBe(true)
  })

  it('caps the compiled rule set (render-path performance guard)', () => {
    const many = Array.from({ length: MAX_CONDITIONAL_FORMAT_RULES + 5 }, (_, i) =>
      rule({ id: `cf-${i}`, field: `f${i}`, operator: 'isNotEmpty' }),
    )
    expect(compileConditionalFormats(many).byField.size).toBe(MAX_CONDITIONAL_FORMAT_RULES)
  })

  it('mints unique ids', () => {
    expect(generateConditionalFormatRuleId()).toMatch(/^cf-/)
    expect(generateConditionalFormatRuleId()).not.toBe(generateConditionalFormatRuleId())
  })
})

describe('parseConditionalFormats — persistence boundary', () => {
  it('accepts well-formed rules', () => {
    const parsed = parseConditionalFormats([
      { id: 'cf-1', field: 'amount', operator: 'gt', value: 100, style: 'red' },
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].operator).toBe('gt')
  })

  it('drops malformed entries rather than crashing the grid', () => {
    const parsed = parseConditionalFormats([
      { id: 'cf-1', field: 'amount', operator: 'gt', value: 100, style: 'red' },
      { field: '', operator: 'gt', style: 'red' }, // no field
      { field: 'x', operator: 'sideways', style: 'red' }, // unknown operator
      { field: 'x', operator: 'gt', style: 'chartreuse' }, // unknown style
      { field: 'x', operator: 'afterField', style: 'red' }, // relative with no target
      null,
      'garbage',
      42,
    ])
    expect(parsed).toHaveLength(1)
  })

  it('returns [] for anything that is not an array (legacy views)', () => {
    expect(parseConditionalFormats(undefined)).toEqual([])
    expect(parseConditionalFormats({})).toEqual([])
  })

  it('derives an id when one is missing', () => {
    const parsed = parseConditionalFormats([{ field: 'a', operator: 'isEmpty', style: 'red' }])
    expect(parsed[0].id).toMatch(/^cf-/)
  })

  it('caps the persisted list', () => {
    const many = Array.from({ length: 40 }, () => ({
      field: 'a',
      operator: 'isEmpty',
      style: 'red',
    }))
    expect(parseConditionalFormats(many)).toHaveLength(MAX_CONDITIONAL_FORMAT_RULES)
  })
})
