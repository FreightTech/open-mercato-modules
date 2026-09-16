// server/aggregate.ts
//
// Shared server-side aggregation helper for DynamicTable list routes.
//
// The whole point of this file is one structural rule:
//
//   THE AGGREGATE RUNS OVER THE SAME `WHERE` CLAUSE AS THE ROW QUERY.
//
// A total computed from a separately-built filter object describes a different
// set of rows than the ones on screen — and if that separate build forgets
// `organization_id`, it describes every tenant's rows. So the caller hands over
// the *same* filters object it passed to `findAndCount`, and this helper
// re-asserts tenancy on top of it as defence in depth.

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AggregationFn, AggregateResult, AggregateBreakdownEntry } from '../types/grouping'
import { isAggregationFn } from '../types/grouping'
import { coerceAggregateValue } from '../utils/formatAggregate'

/** Hard cap on how many aggregates one request may ask for. */
export const MAX_AGGREGATE_ENTRIES = 12

/** Hard cap on the raw `aggregate=` string length. */
export const MAX_AGGREGATE_PARAM_LENGTH = 500

export interface AggregateEntry {
  /** Client-facing column key (the `ColumnDef.data` value). */
  field: string
  fn: AggregationFn
  /** ORM property name the field resolves to, via the route's `fieldMap`. */
  property: string
  /** Client-facing key of the optional partition column. */
  dimension?: string
  /** ORM property the dimension resolves to, via the same `fieldMap`. */
  dimensionProperty?: string
}

export class AggregateSpecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AggregateSpecError'
  }
}

export class AggregateScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AggregateScopeError'
  }
}

/** `${field}:${fn}` — the key an `AggregateResult.values` entry is filed under. */
export function aggregateKey(field: string, fn: AggregationFn): string {
  return `${field}:${fn}`
}

// ─── Spec parsing ────────────────────────────────────────────────────────────

/**
 * Parse `aggregate=grossAmount:sum,netAmount:avg,id:count`.
 *
 * An entry may carry an OPTIONAL third segment — `grossAmount:sum:currencyCode`
 * — naming a column to partition the aggregate by. That yields one figure per
 * distinct value instead of a single scalar, which is what stops a `sum` from
 * silently adding amounts in different currencies together (HEDGE-147). Two-part
 * entries are unchanged, so already-deployed clients and routes are unaffected.
 *
 * Every field — the aggregated one AND the dimension — is resolved through the
 * route's `fieldMap` allow-list, so an unknown or hostile field name never
 * becomes SQL; it is a 400. `fn` is a closed union. Throws `AggregateSpecError`;
 * callers map that to a 400.
 */
export function parseAggregateSpec(
  raw: string | null | undefined,
  fieldMap: Record<string, string>,
): AggregateEntry[] {
  if (raw === null || raw === undefined) return []
  if (typeof raw !== 'string') throw new AggregateSpecError('aggregate must be a string')
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.length > MAX_AGGREGATE_PARAM_LENGTH) {
    throw new AggregateSpecError(`aggregate must be at most ${MAX_AGGREGATE_PARAM_LENGTH} characters`)
  }

  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length > MAX_AGGREGATE_ENTRIES) {
    throw new AggregateSpecError(`aggregate accepts at most ${MAX_AGGREGATE_ENTRIES} entries`)
  }

  const seen = new Set<string>()
  const out: AggregateEntry[] = []
  for (const part of parts) {
    const idx = part.indexOf(':')
    if (idx <= 0 || idx === part.length - 1) {
      throw new AggregateSpecError(`Malformed aggregate entry: "${part}" (expected field:fn)`)
    }
    const field = part.slice(0, idx).trim()
    const rest = part.slice(idx + 1).trim()
    const dimIdx = rest.indexOf(':')
    const fn = (dimIdx < 0 ? rest : rest.slice(0, dimIdx)).trim()
    const dimension = dimIdx < 0 ? '' : rest.slice(dimIdx + 1).trim()
    if (!field) throw new AggregateSpecError(`Malformed aggregate entry: "${part}"`)
    if (!isAggregationFn(fn)) throw new AggregateSpecError(`Unknown aggregate function: "${fn}"`)

    // Allow-list: the field must be a column this route publishes.
    const property = Object.prototype.hasOwnProperty.call(fieldMap, field) ? fieldMap[field] : undefined
    if (!property || typeof property !== 'string') {
      throw new AggregateSpecError(`Unknown aggregate field: "${field}"`)
    }

    // Same allow-list for the partition column — it reaches SQL as a GROUP BY
    // identifier, so it gets exactly the treatment the aggregated field gets.
    let dimensionProperty: string | undefined
    if (dimIdx >= 0) {
      if (!dimension) {
        throw new AggregateSpecError(`Malformed aggregate entry: "${part}" (empty dimension)`)
      }
      const dimProp = Object.prototype.hasOwnProperty.call(fieldMap, dimension)
        ? fieldMap[dimension]
        : undefined
      if (!dimProp || typeof dimProp !== 'string') {
        throw new AggregateSpecError(`Unknown aggregate dimension: "${dimension}"`)
      }
      dimensionProperty = dimProp
    }

    const key = aggregateKey(field, fn)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(
      dimensionProperty
        ? { field, fn, property, dimension, dimensionProperty }
        : { field, fn, property },
    )
  }
  return out
}

// ─── Tenancy ─────────────────────────────────────────────────────────────────

export interface AggregateTenancy {
  /** ORM property holding the organization id. `null` opts an unscoped entity out. */
  orgField?: string | null
  /**
   * The organization scope is a SET, not a single id — `buildScopeFilters`
   * emits `{ $in: [...] }` because a user may see several organizations.
   */
  organizationIds: string[]
  /** ORM property holding the tenant id. `null` opts out. */
  tenantField?: string | null
  tenantId?: string | null
  /** ORM property for soft deletion. `null` opts out. */
  softDeleteField?: string | null
}

/**
 * Merge the row query's `where` with the tenancy scope, and refuse to build an
 * aggregate that isn't scoped.
 *
 * The row query already carries these keys; re-applying identical values is a
 * no-op, and the throw is what turns "someone forgot" from a silent
 * cross-tenant total into a failed request.
 */
export function buildAggregateWhere(
  where: Record<string, unknown>,
  tenancy: AggregateTenancy,
): Record<string, unknown> {
  const orgField = tenancy.orgField === undefined ? 'organizationId' : tenancy.orgField
  const tenantField = tenancy.tenantField === undefined ? 'tenantId' : tenancy.tenantField
  const softDeleteField =
    tenancy.softDeleteField === undefined ? 'deletedAt' : tenancy.softDeleteField

  if (orgField) {
    const ids = (tenancy.organizationIds ?? []).filter((id) => typeof id === 'string' && id)
    if (ids.length === 0) {
      throw new AggregateScopeError(
        'Refusing to aggregate without an organization scope — an unscoped aggregate leaks other tenants’ totals.',
      )
    }
  }
  if (tenantField && !tenancy.tenantId) {
    throw new AggregateScopeError('Refusing to aggregate without a tenant id.')
  }

  const merged: Record<string, unknown> = { ...where }
  if (softDeleteField) merged[softDeleteField] = null
  if (tenantField) merged[tenantField] = tenancy.tenantId
  if (orgField) merged[orgField] = { $in: [...new Set(tenancy.organizationIds)] }
  return merged
}

/**
 * Adapt a `makeDynamicTableRoute` context + ORM config into `AggregateTenancy`.
 *
 * Structurally typed so this file never has to import the route factory. Note
 * `allowedOrgIds` is a **Set** — the visible organization scope is a set of ids
 * (`buildScopeFilters` emits `{ $in: [...] }`), not one id, and collapsing it
 * to `ctx.organizationId` would silently narrow or widen the aggregate.
 */
export function tenancyFromRouteContext(
  ctx: { tenantId: string | null; allowedOrgIds: Set<string> },
  orm: { orgField?: string | null; tenantField?: string | null; softDeleteField?: string | null } = {},
): AggregateTenancy {
  return {
    orgField: orm.orgField,
    organizationIds: [...ctx.allowedOrgIds],
    tenantField: orm.tenantField,
    tenantId: ctx.tenantId,
    softDeleteField: orm.softDeleteField,
  }
}

// ─── SQL construction ────────────────────────────────────────────────────────

/** SQL template per function. `%s` is the (metadata-derived) qualified column. */
function sqlForFn(fn: AggregationFn, column: string): string {
  switch (fn) {
    case 'sum':
      return `sum(${column})`
    case 'avg':
      return `avg(${column})`
    case 'min':
      return `min(${column})`
    case 'max':
      return `max(${column})`
    case 'count':
      return `count(${column})`
    case 'countDistinct':
      return `count(distinct ${column})`
  }
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface AggregateSelectPlan {
  /** Raw `select` expressions, in entry order, plus the trailing row count. */
  expressions: string[]
  /** Generated alias -> the `AggregateResult.values` key it fills. */
  aliasToKey: Record<string, string>
  /** Alias of the `count(*)` expression. */
  totalAlias: string
}

/**
 * Build the select list.
 *
 * Injection safety, three layers deep: `field` was already resolved through the
 * route's `fieldMap` allow-list; `columnOf` maps the ORM property to a real
 * column name taken from ORM metadata (never from the request); and the result
 * is re-checked against `SAFE_IDENTIFIER` before it is concatenated. Aliases
 * are generated (`agg_0`, `agg_1`, …), never derived from user input.
 */
export function buildAggregateSelect(
  entries: AggregateEntry[],
  columnOf: (property: string) => string | undefined,
  tableAlias: string,
): AggregateSelectPlan {
  if (!SAFE_IDENTIFIER.test(tableAlias)) {
    throw new AggregateSpecError(`Unsafe table alias: "${tableAlias}"`)
  }

  const expressions: string[] = []
  const aliasToKey: Record<string, string> = {}

  entries.forEach((entry, i) => {
    const column = columnOf(entry.property)
    if (!column) throw new AggregateSpecError(`Unmapped aggregate field: "${entry.field}"`)
    if (!SAFE_IDENTIFIER.test(column)) {
      throw new AggregateSpecError(`Unsafe column name for field "${entry.field}"`)
    }
    const alias = `agg_${i}`
    expressions.push(`${sqlForFn(entry.fn, `"${tableAlias}"."${column}"`)} as "${alias}"`)
    aliasToKey[alias] = aggregateKey(entry.field, entry.fn)
  })

  const totalAlias = 'agg_total'
  expressions.push(`count(*) as "${totalAlias}"`)
  return { expressions, aliasToKey, totalAlias }
}

/**
 * Turn one raw aggregate row (all values arrive as STRINGS from pg: `int8` for
 * counts, `numeric` for sums) into the transport shape.
 */
export function mapAggregateRow(
  row: Record<string, unknown> | null | undefined,
  plan: AggregateSelectPlan,
): AggregateResult {
  const values: Record<string, number | null> = {}
  for (const [alias, key] of Object.entries(plan.aliasToKey)) {
    values[key] = coerceAggregateValue(row?.[alias])
  }
  return {
    scope: 'dataset',
    total: coerceAggregateValue(row?.[plan.totalAlias]) ?? 0,
    values,
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

export interface RunAggregateOptions {
  em: EntityManager
  entity: any
  /**
   * The EXACT filters object handed to the row query. Passing a freshly built
   * one is the bug this helper exists to prevent.
   */
  where: Record<string, unknown>
  tenancy: AggregateTenancy
  entries: AggregateEntry[]
  /** SQL table alias. Generated, never user input. */
  tableAlias?: string
}

/**
 * Resolve an ORM property name to its physical column, from ENTITY METADATA.
 * Never from the request — that is what keeps the identifier trustworthy.
 * A property the metadata does not know is rejected rather than guessed.
 */
export function makeColumnResolver(
  em: EntityManager,
  entity: any,
): (property: string) => string | undefined {
  const anyEm = em as any
  let properties: Record<string, any> | undefined
  try {
    const metadata = anyEm.getMetadata?.()
    const meta =
      metadata?.find?.(entity) ?? metadata?.get?.(typeof entity === 'string' ? entity : entity?.name)
    properties = meta?.properties
  } catch {
    properties = undefined
  }
  return (property: string) => {
    const prop = properties?.[property]
    const fromMeta = prop?.fieldNames?.[0]
    if (typeof fromMeta === 'string' && fromMeta) return fromMeta
    if (properties) return undefined
    // No metadata at all (unit tests, unusual driver): fall back to the
    // conventional camelCase → snake_case mapping. Still gated by
    // SAFE_IDENTIFIER in `buildAggregateSelect`.
    return property.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  }
}

/**
 * `raw()` lives in `@mikro-orm/core`, which this package does not depend on
 * directly. It is imported lazily so that (a) the pure spec/SQL helpers above
 * stay importable in a jsdom unit test, and (b) nothing pulls the ORM into a
 * client bundle. Resolution happens inside the host app, which always has it.
 */
let rawFragment: ((sql: string) => unknown) | null = null
async function getRawFragment(): Promise<(sql: string) => unknown> {
  if (!rawFragment) {
    const mod: any = await import('@mikro-orm/core')
    if (typeof mod?.raw !== 'function') {
      throw new Error('@mikro-orm/core does not export raw(); cannot build an aggregate query')
    }
    rawFragment = (sql: string) => mod.raw(sql)
  }
  return rawFragment
}

/**
 * Run the aggregate. Returns `scope: 'dataset'` — it is computed over the whole
 * filtered set, which is the entire reason this exists.
 *
 * The query builder is seeded with the SAME `where` the row query used (plus a
 * re-assertion of tenancy), then its select list is swapped for the aggregate
 * expressions. Same builder, same clause, same rows.
 */
export async function runAggregate(options: RunAggregateOptions): Promise<AggregateResult> {
  const { em, entity, where, tenancy, entries } = options
  const tableAlias = options.tableAlias ?? 'dta'

  const scopedWhere = buildAggregateWhere(where, tenancy)

  if (entries.length === 0) {
    const total = await em.count(entity, scopedWhere as any)
    return { scope: 'dataset', total, values: {} }
  }

  const columnOf = makeColumnResolver(em, entity)
  const plan = buildAggregateSelect(entries, columnOf, tableAlias)
  const raw = await getRawFragment()

  const compileWith = (expressions: string[], groupByColumn?: string) => {
    const qb: any = em.createQueryBuilder(entity as any, tableAlias)
    qb.select('*')
    qb.where(scopedWhere as any)

    // Take the compiled row query and swap ONLY its select list. The FROM and the
    // WHERE (including tenancy) are whatever the row query produced — that is the
    // structural guarantee that the total describes the rows on screen.
    const native: any = qb.getNativeQuery()
    native.clear('select')
    native.select(expressions.map((expr) => raw(expr)))
    // MikroORM v7 dropped knex: `getNativeQuery()` returns the ORM's own
    // `NativeQueryBuilder`, whose signature is
    // `groupBy(groupBy: (string | RawQueryFragment)[])` — an ARRAY, and there
    // is no `groupByRaw`. Passing a bare fragment (or calling `groupByRaw`)
    // throws, and `runAggregate`'s caller swallows that into "no total", so the
    // footer silently degrades to page scope instead of erroring. Both parts of
    // the name are `SAFE_IDENTIFIER`-checked and metadata-derived above.
    if (groupByColumn) native.groupBy([raw(`"${tableAlias}"."${groupByColumn}"`)])
    return native.compile()
  }

  const { sql, params } = compileWith(plan.expressions)
  const row = (await (em.getConnection() as any).execute(sql, params, 'get')) as
    | Record<string, unknown>
    | null
    | undefined

  const result = mapAggregateRow(row, plan)

  // ── Per-dimension breakdowns ──
  //
  // One extra grouped query per distinct partition column, reusing the SAME
  // `where`. Kept separate from the scalar query so that adding a dimension can
  // never change the ungrouped `total`, and so a route/driver that cannot do
  // this degrades to "no breakdown" rather than to a wrong grand total.
  const dimensioned = entries.filter((e) => e.dimension && e.dimensionProperty)
  if (dimensioned.length > 0) {
    const breakdowns: Record<string, AggregateBreakdownEntry[]> = {}
    const byDimension = new Map<string, AggregateEntry[]>()
    for (const entry of dimensioned) {
      const list = byDimension.get(entry.dimensionProperty!)
      if (list) list.push(entry)
      else byDimension.set(entry.dimensionProperty!, [entry])
    }

    for (const [dimensionProperty, group] of byDimension) {
      const dimColumn = columnOf(dimensionProperty)
      if (!dimColumn) throw new AggregateSpecError(`Unmapped aggregate dimension: "${group[0].dimension}"`)
      if (!SAFE_IDENTIFIER.test(dimColumn)) {
        throw new AggregateSpecError(`Unsafe column name for dimension "${group[0].dimension}"`)
      }

      const expressions: string[] = [`"${tableAlias}"."${dimColumn}" as "agg_dim"`]
      const aliasToKey: Record<string, string> = {}
      group.forEach((entry, i) => {
        const column = columnOf(entry.property)
        if (!column) throw new AggregateSpecError(`Unmapped aggregate field: "${entry.field}"`)
        if (!SAFE_IDENTIFIER.test(column)) {
          throw new AggregateSpecError(`Unsafe column name for field "${entry.field}"`)
        }
        const alias = `agg_d_${i}`
        expressions.push(`${sqlForFn(entry.fn, `"${tableAlias}"."${column}"`)} as "${alias}"`)
        aliasToKey[alias] = aggregateKey(entry.field, entry.fn)
      })

      const compiled = compileWith(expressions, dimColumn)
      const rows = (await (em.getConnection() as any).execute(
        compiled.sql,
        compiled.params,
        'all',
      )) as Record<string, unknown>[] | null | undefined

      for (const key of Object.values(aliasToKey)) breakdowns[key] = []
      for (const r of rows ?? []) {
        const dimValue = r?.['agg_dim']
        const dimKey = dimValue === null || dimValue === undefined ? '' : String(dimValue)
        for (const [alias, key] of Object.entries(aliasToKey)) {
          breakdowns[key].push({ key: dimKey, value: coerceAggregateValue(r?.[alias]) })
        }
      }
    }
    result.breakdowns = breakdowns
  }

  return result
}
