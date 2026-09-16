/**
 * Shared primitive for DynamicTable filter-value suggestions.
 *
 * Why this exists instead of `/api/entities/filter-suggestions`:
 *
 *  1. The generic endpoint SAMPLES rather than aggregating — it pulls
 *     `pageSize: limit * 2` rows and de-duplicates whatever came back. On a
 *     skewed column that hides most values: on production, `invoice.source`
 *     returned a single suggestion while the table actually holds three
 *     (finance 8,499 / document 675 / ksef 66), because the first 100 rows were
 *     all `finance`.
 *  2. It resolves fields off the entity's own table, so any column the list
 *     denormalises (a joined contractor name, a container number living on a
 *     child unit) yields `[]` — and it fails *silently*, so the picker just
 *     looks empty rather than erroring.
 *
 * `distinctColumnValues` runs a real `SELECT DISTINCT` against a named
 * table/column, always constrained by the caller's scope, so every list can
 * offer the same suggestion behaviour regardless of where its data lives.
 */

/** Postgres identifier: letters, digits, underscore; not starting with a digit. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i

function assertIdentifier(kind: 'table' | 'column', value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`Unsafe ${kind} identifier for filter suggestions: ${JSON.stringify(value)}`)
  }
  return `"${value}"`
}

export interface DistinctColumnValuesOptions {
  /** MikroORM EntityManager (uses its underlying connection). */
  em: { getConnection: () => { execute: (sql: string, params?: unknown[]) => Promise<unknown> } }
  /** Physical table name. Caller-controlled — never user input. */
  table: string
  /**
   * Physical column(s) to aggregate. Caller-controlled — never user input.
   * Pass several when one grid column is fed by more than one DB column: the
   * invoice list's "counterparty" is `seller_name` for incoming invoices and
   * `buyer_name` for outgoing ones, so both have to be offered.
   */
  column: string | string[]
  /**
   * Scope predicate as physical column → value. `null` means `IS NULL` (used
   * for `deleted_at`), an array becomes `IN (...)`. Values are parameterised.
   */
  scope?: Record<string, string | string[] | null | undefined>
  /** Optional case-insensitive substring the value must contain. */
  query?: string
  /** Max suggestions returned. Defaults to 50, hard-capped at 200. */
  limit?: number
  /**
   * Optional join, for columns that live on a related table
   * (e.g. suggesting a contractor name for a folder list).
   */
  join?: { table: string; on: string; foreign: string }
}

/**
 * Distinct, non-empty, alphabetically ordered values for one column.
 *
 * Returns `[]` rather than throwing when the table is unreachable — a missing
 * suggestion list must never take down the list page that requested it.
 */
export async function distinctColumnValues(opts: DistinctColumnValuesOptions): Promise<string[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const base = assertIdentifier('table', opts.table)
  const columns = (Array.isArray(opts.column) ? opts.column : [opts.column])
    .map((c) => assertIdentifier('column', c))
  if (columns.length === 0) return []

  const params: unknown[] = []
  const where: string[] = []
  let from = `${base} AS t`
  let prefix = 't'

  if (opts.join) {
    const jt = assertIdentifier('table', opts.join.table)
    const on = assertIdentifier('column', opts.join.on)
    const foreign = assertIdentifier('column', opts.join.foreign)
    from = `${base} AS t INNER JOIN ${jt} AS j ON j.${foreign} = t.${on}`
    prefix = 'j'
  }

  // One grid column, possibly several DB columns: unnest keeps the scope
  // predicate (and its bound parameters) written exactly once.
  const target = columns.length === 1
    ? `${prefix}.${columns[0]}`
    : `unnest(ARRAY[${columns.map((c) => `${prefix}.${c}::text`).join(', ')}])`

  for (const [rawColumn, value] of Object.entries(opts.scope ?? {})) {
    if (value === undefined) continue
    const scoped = `t.${assertIdentifier('column', rawColumn)}`
    if (value === null) {
      where.push(`${scoped} IS NULL`)
    } else if (Array.isArray(value)) {
      // An empty allow-list means "no rows in scope" — not "no constraint".
      if (value.length === 0) return []
      const holes = value.map((entry) => {
        params.push(entry)
        return '?'
      })
      where.push(`${scoped} IN (${holes.join(', ')})`)
    } else {
      params.push(value)
      where.push(`${scoped} = ?`)
    }
  }

  // `unnest` is a set-returning function and cannot sit in WHERE, so the
  // multi-column form selects into a subquery and filters the flattened value
  // outside it. Scope predicates stay inside either way — they must be applied
  // before the columns are flattened, and their parameters bind first.
  const needle = (opts.query ?? '').trim()
  const scopeWhere = where.length > 0 ? `WHERE ${where.join(' AND ')} ` : ''

  const outer: string[] = ['value IS NOT NULL', "btrim(value) <> ''"]
  let sql: string
  if (columns.length === 1) {
    if (needle) params.push(`%${needle}%`)
    const outerSql = [...outer, ...(needle ? ['value ILIKE ?'] : [])].join(' AND ')
    sql =
      `SELECT DISTINCT value FROM (SELECT ${target}::text AS value FROM ${from} ${scopeWhere}) s ` +
      `WHERE ${outerSql} ORDER BY value ASC LIMIT ?`
  } else {
    if (needle) params.push(`%${needle}%`)
    const outerSql = [...outer, ...(needle ? ['value ILIKE ?'] : [])].join(' AND ')
    sql =
      `SELECT DISTINCT value FROM (SELECT ${target} AS value FROM ${from} ${scopeWhere}) s ` +
      `WHERE ${outerSql} ORDER BY value ASC LIMIT ?`
  }
  params.push(limit)

  try {
    const rows = (await opts.em.getConnection().execute(sql, params)) as Array<{ value: string }>
    return Array.isArray(rows) ? rows.map((r) => r.value).filter(Boolean) : []
  } catch (err) {
    // A missing suggestion list must never take down the list page, so this
    // still degrades to []. But it does NOT swallow the reason: a broken query
    // here is indistinguishable from "this column has no values", and that cost
    // a full release cycle once already — every endpoint answered 200 with an
    // empty list and looked correctly wired.
    console.error(
      `[filter-suggestions] query failed for ${opts.table}.${opts.column}:`,
      err instanceof Error ? err.message : err,
    )
    return []
  }
}
