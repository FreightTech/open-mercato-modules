/**
 * Shared filter-suggestion primitive.
 *
 * The generic `/api/entities/filter-suggestions` endpoint samples rows instead
 * of aggregating, so a skewed column reports only the values present in the
 * first page (production: `invoice.source` suggested 1 of its 3 values). This
 * helper runs a real SELECT DISTINCT, so these tests pin the SQL shape,
 * parameter binding and the identifier guard.
 */
import { distinctColumnValues } from '../server/filterSuggestions'

function emWith(rows: unknown, capture?: { sql?: string; params?: unknown[] }) {
  const execute = jest.fn(async (sql: string, params?: unknown[]) => {
    if (capture) { capture.sql = sql; capture.params = params }
    return rows
  })
  return { em: { getConnection: () => ({ execute }) } as never, execute }
}

describe('distinctColumnValues', () => {
  it('aggregates with DISTINCT rather than sampling', async () => {
    const cap: { sql?: string } = {}
    const { em } = emWith([{ value: 'a' }], cap)
    await distinctColumnValues({ em, table: 'invoices', column: 'source' })
    expect(cap.sql).toContain('SELECT DISTINCT')
    expect(cap.sql).toContain('ORDER BY value ASC')
  })

  it('returns the column values', async () => {
    const { em } = emWith([{ value: 'finance' }, { value: 'ksef' }])
    expect(await distinctColumnValues({ em, table: 'invoices', column: 'source' }))
      .toEqual(['finance', 'ksef'])
  })

  it('binds scalar scope values as parameters, never inline', async () => {
    const cap: { sql?: string; params?: unknown[] } = {}
    const { em } = emWith([], cap)
    await distinctColumnValues({
      em, table: 'invoices', column: 'source',
      scope: { organization_id: 'org-1', tenant_id: 'ten-1' },
    })
    expect(cap.sql).toContain('"organization_id" = ?')
    expect(cap.sql).toContain('"tenant_id" = ?')
    expect(cap.params?.slice(0, 2)).toEqual(['org-1', 'ten-1'])
  })

  it('expands an array scope to IN with one placeholder per value', async () => {
    const cap: { sql?: string; params?: unknown[] } = {}
    const { em } = emWith([], cap)
    await distinctColumnValues({
      em, table: 'invoices', column: 'source',
      scope: { organization_id: ['a', 'b', 'c'] },
    })
    // One placeholder per value, in order — the params array must line up.
    expect(cap.sql).toContain('IN (?, ?, ?)')
    expect(cap.params?.slice(0, 3)).toEqual(['a', 'b', 'c'])
  })

  it('treats an empty allow-list as "nothing in scope", not "no filter"', async () => {
    const { em, execute } = emWith([{ value: 'leaked' }])
    expect(await distinctColumnValues({
      em, table: 'invoices', column: 'source', scope: { organization_id: [] },
    })).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })

  it('renders a null scope value as IS NULL', async () => {
    const cap: { sql?: string } = {}
    const { em } = emWith([], cap)
    await distinctColumnValues({ em, table: 'folders', column: 'notes', scope: { deleted_at: null } })
    expect(cap.sql).toContain('"deleted_at" IS NULL')
  })

  it('parameterises the search needle', async () => {
    const cap: { sql?: string; params?: unknown[] } = {}
    const { em } = emWith([], cap)
    await distinctColumnValues({ em, table: 'facilities', column: 'name', query: "O'Brien" })
    expect(cap.sql).toContain('ILIKE')
    expect(cap.params).toContain("%O'Brien%")
  })

  it('excludes nulls and blank strings', async () => {
    const cap: { sql?: string } = {}
    const { em } = emWith([], cap)
    await distinctColumnValues({ em, table: 'facilities', column: 'name' })
    expect(cap.sql).toContain('IS NOT NULL')
    expect(cap.sql).toContain("<> ''")
  })

  it('joins when the column lives on a related table', async () => {
    const cap: { sql?: string } = {}
    const { em } = emWith([], cap)
    await distinctColumnValues({
      em, table: 'folders', column: 'name',
      join: { table: 'contractors', on: 'contractor_id', foreign: 'id' },
    })
    expect(cap.sql).toContain('INNER JOIN "contractors" AS j ON j."id" = t."contractor_id"')
    expect(cap.sql).toContain('j."name"')
  })

  it('caps the limit and keeps it parameterised', async () => {
    const cap: { params?: unknown[] } = {}
    const { em } = emWith([], cap)
    await distinctColumnValues({ em, table: 'facilities', column: 'name', limit: 10_000 })
    expect(cap.params?.[cap.params.length - 1]).toBe(200)
  })

  // Identifiers cannot be parameterised, so they must be rejected outright.
  it.each([
    ['table', { table: 'facilities; DROP TABLE users', column: 'name' }],
    ['column', { table: 'facilities', column: 'name; DELETE FROM users' }],
    ['quoted column', { table: 'facilities', column: 'name" --' }],
    ['scope column', { table: 'facilities', column: 'name', scope: { 'x; DROP': 'v' } }],
  ])('rejects an unsafe %s identifier', async (_label, args) => {
    const { em } = emWith([])
    await expect(distinctColumnValues({ em, ...(args as never) })).rejects.toThrow(/Unsafe/)
  })

  // MikroORM's getConnection().execute() goes through knex, which does not
  // understand Postgres `$1` placeholders. An earlier version emitted `$n`, so
  // every query threw and the catch turned it into a silent empty list — the
  // endpoints answered 200 with [] and looked correctly wired on production.
  it('emits knex-style ? placeholders, never Postgres $n', async () => {
    const cap: { sql?: string } = {}
    const { em } = emWith([], cap)
    await distinctColumnValues({
      em, table: 'invoices', column: 'source',
      scope: { organization_id: ['a', 'b'], tenant_id: 't' }, query: 'x', limit: 10,
    })
    expect(cap.sql).not.toMatch(/\$\d/)
    expect((cap.sql!.match(/\?/g) || []).length).toBe(5) // 2 org + tenant + ilike + limit
  })

  it('flattens several DB columns behind one grid column', async () => {
    const cap: { sql?: string } = {}
    const { em } = emWith([], cap)
    await distinctColumnValues({
      em, table: 'invoices', column: ['seller_name', 'buyer_name'],
      scope: { organization_id: 'org-1' },
    })
    // unnest is set-returning and illegal in WHERE, so it must be selected in a
    // subquery and filtered outside it.
    expect(cap.sql).toContain('unnest(ARRAY[t."seller_name"::text, t."buyer_name"::text])')
    expect(cap.sql).toMatch(/FROM \(SELECT .* FROM .* WHERE .*\) s WHERE/)
    expect(cap.sql).toContain('"organization_id" = ?')
  })

  it('degrades to [] when the table is unreachable', async () => {
    const em = { getConnection: () => ({ execute: async () => { throw new Error('no such table') } }) } as never
    expect(await distinctColumnValues({ em, table: 'ghost', column: 'name' })).toEqual([])
  })
})
