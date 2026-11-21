/**
 * GEPARD-355: the lists page and sort on the server. The CRUD factory's plain-ORM fallback reads the whole table, so
 * `pagedOrmList` chooses the page first (limit, offset, order, the same scope) and narrows the fallback to its ids.
 */
import { describe, expect, it, vi } from 'vitest'
import { orderOf, pageOf, pagedOrmList } from '../paged-list'

class Shipment {}

const properties = {
  id: { fieldNames: ['id'] },
  carrierCode: { fieldNames: ['carrier_code'] },
  createdAt: { fieldNames: ['created_at'] },
  organizationId: { fieldNames: ['organization_id'] },
  tenantId: { fieldNames: ['tenant_id'] },
  deletedAt: { fieldNames: ['deleted_at'] },
  originLocation: { fieldNames: ['origin_location'] },
}

function setup(rows: Array<{ id: string }> = [{ id: 'b' }, { id: 'a' }], total = 57) {
  const findAndCount = vi.fn(async () => [rows, total])
  const fork = { findAndCount, getMetadata: () => ({ find: () => ({ properties }) }) }
  const em = { fork: vi.fn(() => fork) }
  const ctx = (url: string, extra: Record<string, unknown> = {}) => ({
    container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
    auth: { tenantId: 'tenant-1', orgId: 'org-1' },
    organizationScope: null,
    selectedOrganizationId: 'org-1',
    organizationIds: ['org-1'],
    request: new Request(url),
    ...extra,
  }) as any
  const pages = pagedOrmList({
    entity: Shipment as any,
    sortFieldMap: { id: 'id', carrierCode: 'carrier_code', createdAt: 'created_at' },
    defaultSort: { field: 'createdAt', dir: 'desc' },
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  })
  return { pages, findAndCount, ctx }
}

describe('pagedOrmList — the page chosen before the fallback reads', () => {
  it('reads one page: limit = pageSize, offset from the page, the default order, the scope and the filters', async () => {
    const { pages, findAndCount, ctx } = setup()
    const out = await pages.buildFilters({ status: 'IN_TRANSIT' }, { page: 2, pageSize: 20 }, ctx('http://x/api/shipment_tracking/shipments?page=2&pageSize=20'))
    expect(findAndCount).toHaveBeenCalledTimes(1)
    const [, where, options] = findAndCount.mock.calls[0] as any[]
    expect(options).toMatchObject({ limit: 20, offset: 20, orderBy: { createdAt: 'desc', id: 'asc' }, fields: ['id'] })
    expect(where).toMatchObject({ status: 'IN_TRANSIT', organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null })
    // The fallback's `find` is narrowed to the page's rows.
    expect(out).toEqual({ status: 'IN_TRANSIT', id: { $in: ['b', 'a'] } })
  })

  it("sorts by the requested field when the route sorts by it, the id breaking ties", async () => {
    const { pages, findAndCount, ctx } = setup()
    await pages.buildFilters({}, { page: 1, pageSize: 20, sortField: 'carrierCode', sortDir: 'desc' }, ctx('http://x/api/s?page=1'))
    expect((findAndCount.mock.calls[0] as any[])[2].orderBy).toEqual({ carrierCode: 'desc', id: 'asc' })
  })

  it('a sort field the route does not offer falls back to the default (never an arbitrary property)', () => {
    const options = { sortFieldMap: { id: 'id', createdAt: 'created_at' }, defaultSort: { field: 'createdAt', dir: 'desc' as const } }
    expect(orderOf({ sortField: 'originLocation', sortDir: 'asc' }, options, new Set(Object.keys(properties)))).toEqual({ createdAt: 'desc', id: 'asc' })
    expect(orderOf({ sortField: 'id', sortDir: 'desc' }, options)).toEqual({ id: 'desc' })
  })

  it('pageSize is capped at 100 and defaults to 50; the page starts at 1', () => {
    expect(pageOf({ page: 0, pageSize: 5000 })).toEqual({ page: 1, pageSize: 100 })
    expect(pageOf({})).toEqual({ page: 1, pageSize: 50 })
  })

  it('an export or a fetch by id is answered whole, as before', async () => {
    const { pages, findAndCount, ctx } = setup()
    expect(await pages.buildFilters({ a: 1 }, { page: 1 }, ctx('http://x/api/s?format=csv'))).toEqual({ a: 1 })
    expect(await pages.buildFilters({ a: 1 }, { page: 1, id: 'abc' }, ctx('http://x/api/s?id=abc'))).toEqual({ a: 1 })
    expect(await pages.buildFilters({ a: 1 }, { page: 1 }, ctx('http://x/api/s?ids=a,b'))).toEqual({ a: 1 })
    expect(findAndCount).not.toHaveBeenCalled()
  })

  it('afterList puts the rows in the page order and answers the real total with the page', async () => {
    const { pages, ctx } = setup()
    const c = ctx('http://x/api/s?page=2&pageSize=20')
    await pages.buildFilters({}, { page: 2, pageSize: 20 }, c)
    const payload: any = { items: [{ id: 'a' }, { id: 'b' }], total: 2 }
    await pages.afterList(payload, { ...c, query: {} })
    expect(payload.items.map((i: any) => i.id)).toEqual(['b', 'a'])
    expect(payload).toMatchObject({ total: 57, page: 2, pageSize: 20, totalPages: 3 })
  })

  it('afterList leaves a whole answer (export, by id) as the fallback built it', async () => {
    const { pages, ctx } = setup()
    const payload: any = { items: [{ id: 'a' }], total: 1 }
    await pages.afterList(payload, { ...ctx('http://x/api/s?format=csv'), query: {} })
    expect(payload).toEqual({ items: [{ id: 'a' }], total: 1 })
  })
})
