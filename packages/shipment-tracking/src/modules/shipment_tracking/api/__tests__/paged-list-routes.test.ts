/**
 * GEPARD-355: every list route of the module pages and sorts on the server. The real route modules are loaded with
 * `makeCrudRoute` captured, and each list's `buildFilters` + `afterList` must read one ordered page, not the table.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

const captured: Array<Record<string, any>> = []
vi.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (opts: Record<string, any>) => {
    captured.push(opts)
    return { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn(), metadata: opts.metadata }
  },
}))
vi.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (_k: string, f: string) => f }) }))

const routes: Record<string, Record<string, any>> = {}

beforeAll(async () => {
  for (const [name, load] of [
    ['shipments', () => import('../shipments/route')],
    ['tracking-jobs', () => import('../tracking-jobs/route')],
    ['cargo-events', () => import('../cargo-events/route')],
    ['webhooks/deliveries', () => import('../webhooks/deliveries/route')],
  ] as const) {
    const before = captured.length
    await load()
    routes[name] = captured[before]
  }
})

function ctx(url: string) {
  const findAndCount = vi.fn(async () => [[{ id: 'r2' }, { id: 'r1' }], 2358])
  const fork = { findAndCount, getMetadata: () => ({ find: () => null }) }
  const c = {
    container: { resolve: (name: string) => (name === 'em' ? { fork: () => fork } : undefined) },
    auth: { tenantId: 'tenant-1', orgId: 'org-1' },
    organizationScope: null,
    selectedOrganizationId: 'org-1',
    organizationIds: ['org-1'],
    request: new Request(url),
  }
  return { c: c as any, findAndCount }
}

describe.each(['shipments', 'tracking-jobs', 'cargo-events', 'webhooks/deliveries'])('%s list: one ordered page from the server', (name) => {
  it('reads page 3 of 20 with an order, narrows the fallback to it and answers the real total', async () => {
    const opts = routes[name]
    expect(opts, `${name} route registered`).toBeDefined()
    const { c, findAndCount } = ctx(`http://x/api/shipment_tracking/${name}?page=3&pageSize=20`)
    const query = opts.list.schema.parse({ page: '3', pageSize: '20' })
    const filters = await opts.list.buildFilters(query, c)
    expect(findAndCount).toHaveBeenCalledTimes(1)
    const options = (findAndCount.mock.calls[0] as any[])[2]
    expect(options.limit).toBe(20)
    expect(options.offset).toBe(40)
    expect(Object.keys(options.orderBy).length).toBeGreaterThan(0)
    expect(filters.id).toEqual({ $in: ['r2', 'r1'] })

    const payload: any = { items: [{ id: 'r1' }, { id: 'r2' }], total: 2 }
    await opts.hooks.afterList(payload, { ...c, query })
    expect(payload.items.map((i: any) => i.id)).toEqual(['r2', 'r1'])
    expect(payload).toMatchObject({ total: 2358, page: 3, pageSize: 20, totalPages: 118 })
  })

  it('a requested sort the route offers reaches the query', async () => {
    const opts = routes[name]
    const field = Object.keys(opts.list.sortFieldMap).find((f) => f !== 'id') as string
    const { c, findAndCount } = ctx(`http://x/api/shipment_tracking/${name}?page=1`)
    await opts.list.buildFilters(opts.list.schema.parse({ page: '1', pageSize: '20', sortField: field, sortDir: 'asc' }), c)
    expect((findAndCount.mock.calls[0] as any[])[2].orderBy).toEqual({ [field]: 'asc', id: 'asc' })
  })
})

describe('webhooks/deliveries', () => {
  it('has no soft-delete filter (a delivery has no deleted_at — the 500 on tms-ft 21.11)', () => {
    expect(routes['webhooks/deliveries'].orm.softDeleteField).toBeNull()
  })

  it("is scoped through its webhook to the caller's tenant and organisations", async () => {
    const opts = routes['webhooks/deliveries']
    const { c, findAndCount } = ctx('http://x/api/shipment_tracking/webhooks/deliveries?page=1')
    await opts.list.buildFilters(opts.list.schema.parse({ page: '1', webhookId: '6f1d3c1e-0000-4000-8000-000000000001' }), c)
    const where = (findAndCount.mock.calls[0] as any[])[1]
    expect(where.webhook).toEqual({ tenantId: 'tenant-1', organizationId: { $in: ['org-1'] }, id: '6f1d3c1e-0000-4000-8000-000000000001' })
  })
})

describe('the grids ask for an order the server applies (review N1)', () => {
  // useDynamicTablePage sends sortField=id when the page sets no defaultSort, and a UUID id is a random order: the
  // routes' newest-first default would never be reached from the screen.
  it.each([
    ['shipments', '../../backend/shipment-tracking/page.tsx'],
    ['tracking-jobs', '../../tables/tracking_job/table.client.tsx'],
  ])('%s grid opens newest first, on a field its route sorts by', async (name, file) => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const source = readFileSync(path.resolve(__dirname, file), 'utf8')
    const match = source.match(/defaultSort:\s*\{\s*field:\s*'(\w+)',\s*direction:\s*'(asc|desc)'\s*\}/)
    expect(match?.slice(1)).toEqual(['createdAt', 'desc'])
    expect(Object.keys(routes[name].list.sortFieldMap)).toContain(match?.[1])
  })
})
