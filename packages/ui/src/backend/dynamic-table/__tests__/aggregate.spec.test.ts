import {
  parseAggregateSpec,
  buildAggregateWhere,
  buildAggregateSelect,
  mapAggregateRow,
  tenancyFromRouteContext,
  aggregateKey,
  AggregateSpecError,
  AggregateScopeError,
  MAX_AGGREGATE_ENTRIES,
} from '../server/aggregate'

// The route's public column key -> ORM property. This IS the allow-list.
const fieldMap: Record<string, string> = {
  grossAmount: 'grossAmount',
  netAmount: 'netAmount',
  id: 'id',
  issuedAt: 'issuedAt',
}

describe('parseAggregateSpec', () => {
  it('parses a well-formed spec', () => {
    expect(parseAggregateSpec('grossAmount:sum,netAmount:avg,id:count', fieldMap)).toEqual([
      { field: 'grossAmount', fn: 'sum', property: 'grossAmount' },
      { field: 'netAmount', fn: 'avg', property: 'netAmount' },
      { field: 'id', fn: 'count', property: 'id' },
    ])
  })

  it('accepts every widened function', () => {
    const spec = ['sum', 'avg', 'min', 'max', 'count', 'countDistinct']
      .map((fn) => `grossAmount:${fn}`)
      .join(',')
    expect(parseAggregateSpec(spec, fieldMap)).toHaveLength(6)
  })

  it('treats absent / empty as "no aggregate requested"', () => {
    expect(parseAggregateSpec(undefined, fieldMap)).toEqual([])
    expect(parseAggregateSpec(null, fieldMap)).toEqual([])
    expect(parseAggregateSpec('   ', fieldMap)).toEqual([])
  })

  it('de-duplicates identical field:fn pairs', () => {
    expect(parseAggregateSpec('grossAmount:sum,grossAmount:sum', fieldMap)).toHaveLength(1)
  })

  // ── Rejection: an unknown field must never reach SQL ──
  it('rejects a field that is not on the route allow-list', () => {
    expect(() => parseAggregateSpec('secretSalary:sum', fieldMap)).toThrow(AggregateSpecError)
  })

  it('rejects an SQL-injection attempt outright', () => {
    expect(() => parseAggregateSpec('x);DROP TABLE invoices;--:sum', fieldMap)).toThrow(
      AggregateSpecError,
    )
    expect(() => parseAggregateSpec('grossAmount:sum);DROP TABLE t;--', fieldMap)).toThrow(
      AggregateSpecError,
    )
  })

  it('rejects an unknown function', () => {
    expect(() => parseAggregateSpec('grossAmount:median', fieldMap)).toThrow(AggregateSpecError)
  })

  it('rejects malformed entries', () => {
    expect(() => parseAggregateSpec('grossAmount', fieldMap)).toThrow(AggregateSpecError)
    expect(() => parseAggregateSpec(':sum', fieldMap)).toThrow(AggregateSpecError)
    expect(() => parseAggregateSpec('grossAmount:', fieldMap)).toThrow(AggregateSpecError)
  })

  it('rejects an over-long spec and too many entries', () => {
    expect(() => parseAggregateSpec('a'.repeat(501), fieldMap)).toThrow(AggregateSpecError)
    const many = Array.from({ length: MAX_AGGREGATE_ENTRIES + 1 }, (_, i) => `f${i}:sum`).join(',')
    expect(() => parseAggregateSpec(many, fieldMap)).toThrow(AggregateSpecError)
  })

  it('does not treat inherited Object properties as allow-listed fields', () => {
    expect(() => parseAggregateSpec('constructor:sum', fieldMap)).toThrow(AggregateSpecError)
    expect(() => parseAggregateSpec('toString:count', fieldMap)).toThrow(AggregateSpecError)
  })
})

describe('buildAggregateWhere — tenant isolation', () => {
  const rowWhere = { deletedAt: null, status: 'open', $and: [{ grossAmount: { $gt: 10 } }] }

  it('keeps the row query WHERE and re-asserts org (a SET) + tenant', () => {
    const merged = buildAggregateWhere(rowWhere, {
      organizationIds: ['org-1', 'org-2'],
      tenantId: 'tenant-1',
    })
    expect(merged.status).toBe('open')
    expect(merged.$and).toEqual(rowWhere.$and)
    expect(merged.organizationId).toEqual({ $in: ['org-1', 'org-2'] })
    expect(merged.tenantId).toBe('tenant-1')
    expect(merged.deletedAt).toBeNull()
  })

  it('does not mutate the caller’s WHERE object', () => {
    const original = { ...rowWhere }
    buildAggregateWhere(rowWhere, { organizationIds: ['org-1'], tenantId: 't' })
    expect(rowWhere).toEqual(original)
  })

  it('REFUSES to build an aggregate with no organization scope', () => {
    expect(() => buildAggregateWhere(rowWhere, { organizationIds: [], tenantId: 't' })).toThrow(
      AggregateScopeError,
    )
  })

  it('REFUSES to build an aggregate with no tenant', () => {
    expect(() =>
      buildAggregateWhere(rowWhere, { organizationIds: ['org-1'], tenantId: null }),
    ).toThrow(AggregateScopeError)
  })

  it('lets a genuinely unscoped entity opt out explicitly', () => {
    const merged = buildAggregateWhere(rowWhere, {
      organizationIds: [],
      orgField: null,
      tenantField: null,
      softDeleteField: null,
    })
    expect(merged.organizationId).toBeUndefined()
    expect(merged.tenantId).toBeUndefined()
  })

  it('honours custom scope field names', () => {
    const merged = buildAggregateWhere(
      {},
      { orgField: 'orgId', organizationIds: ['o'], tenantField: 'tid', tenantId: 't' },
    )
    expect(merged.orgId).toEqual({ $in: ['o'] })
    expect(merged.tid).toBe('t')
  })
})

describe('tenancyFromRouteContext', () => {
  it('carries the whole organization SET, not a single id', () => {
    const tenancy = tenancyFromRouteContext(
      { tenantId: 'tenant-9', allowedOrgIds: new Set(['a', 'b', 'c']) },
      {},
    )
    expect(tenancy.organizationIds.sort()).toEqual(['a', 'b', 'c'])
    expect(tenancy.tenantId).toBe('tenant-9')
  })
})

describe('buildAggregateSelect', () => {
  const columnOf = (property: string) =>
    ({ grossAmount: 'gross_amount', netAmount: 'net_amount', id: 'id' })[property]

  it('emits parameterless, quoted, generated-alias expressions plus a row count', () => {
    const plan = buildAggregateSelect(
      [
        { field: 'grossAmount', fn: 'sum', property: 'grossAmount' },
        { field: 'id', fn: 'countDistinct', property: 'id' },
      ],
      columnOf,
      'dta',
    )
    expect(plan.expressions).toEqual([
      'sum("dta"."gross_amount") as "agg_0"',
      'count(distinct "dta"."id") as "agg_1"',
      'count(*) as "agg_total"',
    ])
    expect(plan.aliasToKey).toEqual({ agg_0: 'grossAmount:sum', agg_1: 'id:countDistinct' })
  })

  it('rejects a column name that is not a plain identifier', () => {
    expect(() =>
      buildAggregateSelect(
        [{ field: 'x', fn: 'sum', property: 'x' }],
        () => 'gross"; drop table t; --',
        'dta',
      ),
    ).toThrow(AggregateSpecError)
  })

  it('rejects an unmapped property rather than guessing a column', () => {
    expect(() =>
      buildAggregateSelect([{ field: 'x', fn: 'sum', property: 'x' }], () => undefined, 'dta'),
    ).toThrow(AggregateSpecError)
  })

  it('rejects an unsafe table alias', () => {
    expect(() =>
      buildAggregateSelect([{ field: 'id', fn: 'count', property: 'id' }], columnOf, 'a"b'),
    ).toThrow(AggregateSpecError)
  })
})

describe('mapAggregateRow', () => {
  const plan = buildAggregateSelect(
    [
      { field: 'grossAmount', fn: 'sum', property: 'grossAmount' },
      { field: 'id', fn: 'count', property: 'id' },
      { field: 'netAmount', fn: 'min', property: 'netAmount' },
    ],
    (p) => ({ grossAmount: 'gross_amount', id: 'id', netAmount: 'net_amount' })[p],
    'dta',
  )

  it('coerces the STRING values pg actually returns', () => {
    // numeric -> "18400.0000", int8 -> "7". Un-coerced these render as 0,00.
    const result = mapAggregateRow(
      { agg_0: '18400.0000', agg_1: '7', agg_2: null, agg_total: '1240' },
      plan,
    )
    expect(result.values[aggregateKey('grossAmount', 'sum')]).toBe(18400)
    expect(result.values[aggregateKey('id', 'count')]).toBe(7)
    expect(result.values[aggregateKey('netAmount', 'min')]).toBeNull()
    expect(result.total).toBe(1240)
  })

  it('is always dataset-scoped — that is the entire point of the server aggregate', () => {
    expect(mapAggregateRow({ agg_total: '0' }, plan).scope).toBe('dataset')
  })

  it('survives an empty result row', () => {
    const result = mapAggregateRow(null, plan)
    expect(result.total).toBe(0)
    expect(result.values[aggregateKey('grossAmount', 'sum')]).toBeNull()
  })
})
