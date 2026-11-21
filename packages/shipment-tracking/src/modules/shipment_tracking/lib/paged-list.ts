import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { mergeAdvancedFilters } from '@open-mercato/shared/lib/crud/advanced-filter-integration'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'

/**
 * Server-side page and sort for a `makeCrudRoute` list that has no `list.entityId`.
 *
 * Without an entity id the CRUD factory lists through its plain-ORM fallback: a bare `repo.find(where)` with no limit,
 * offset or order, and `total` = the rows it read. Every request then returns the whole table whatever `page`,
 * `pageSize` and `sortField` say (tms-ft 21.11: shipments 2358 rows / 33 MB, cargo events 26 397 / 65 MB per request),
 * and a grid showing 20 shows the same 20 on every page (GEPARD-355).
 *
 * The query-engine path (`entityId` + snake_case `fields`) is not used here: it answers in snake_case (the list items
 * are read by the shipment and tracking-job drawers in camelCase) and it drops the nested JSONB conditions the
 * shipments search uses (`originLocation: { name: … }`), so the search would match everything.
 *
 * So the fallback stays, and the page is chosen before it runs:
 * - `buildFilters` (it gets the request's scope) reads the page's ids with the same filters and scope the fallback
 *   applies, ordered and limited, plus the total, and narrows the fallback's `find` to those ids;
 * - `afterList` puts the rows back in that order and answers the real total with `page`, `pageSize`, `totalPages`
 *   (added fields; `items` keep the shape they had).
 * An export (`?format=`) and a fetch by id (`?id=` / `?ids=`) are left to the fallback as before.
 */

type EntityClass = { name: string } & (new (...args: never[]) => unknown)
type Direction = 'asc' | 'desc'
type ListQuery = { page?: unknown; pageSize?: unknown; sortField?: unknown; sortDir?: unknown } & Record<string, unknown>
type Slice = { ids: string[]; total: number; page: number; pageSize: number }

export type PagedOrmListOptions = {
  entity: EntityClass
  /** The route's `sortFieldMap`: its keys are the request's `sortField` values and must be entity property names. */
  sortFieldMap: Record<string, string>
  defaultSort: { field: string; dir: Direction }
  /** The route's `orm` scope fields, as given to `makeCrudRoute` (null = none). */
  orgField?: string | null
  tenantField?: string | null
  softDeleteField?: string | null
}

const MAX_PAGE_SIZE = 100

export function pageOf(query: ListQuery): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(Number(query.page) || 1))
  const pageSize = Math.min(Math.max(Math.floor(Number(query.pageSize) || 50), 1), MAX_PAGE_SIZE)
  return { page, pageSize }
}

/** The order to read by: the requested field when the route sorts by it, else the default; the id breaks ties. */
export function orderOf(query: ListQuery, options: Pick<PagedOrmListOptions, 'sortFieldMap' | 'defaultSort'>, properties?: Set<string>): Record<string, Direction> {
  const requested = typeof query.sortField === 'string' ? query.sortField : ''
  const known = (field: string) => Object.prototype.hasOwnProperty.call(options.sortFieldMap, field) && (!properties || properties.has(field))
  const field = requested && known(requested) ? requested : options.defaultSort.field
  const dir: Direction = requested && known(requested)
    ? (query.sortDir === 'desc' ? 'desc' : 'asc')
    : options.defaultSort.dir
  return field === 'id' ? { id: dir } : { [field]: dir, id: 'asc' }
}

/** What makes the request one the fallback answers whole: an export or a fetch by id. */
function servedWhole(query: ListQuery, request: Request | undefined): boolean {
  if (query.id) return true
  let params: URLSearchParams | null = null
  try {
    params = request ? new URL(request.url).searchParams : null
  } catch {
    params = null
  }
  const param = (name: string) => (params?.get(name) ?? (typeof query[name] === 'string' ? (query[name] as string) : '')).trim()
  return Boolean(param('format') || param('ids') || param('id'))
}

/** The factory maps a filter keyed by a column name to its property; the same here, so both queries match. */
function toPropertyKeys(filters: Record<string, unknown>, em: any, entity: EntityClass): Record<string, unknown> {
  const meta = em?.getMetadata?.()?.find?.(entity.name)
  if (!meta?.properties) return filters
  const byColumn = new Map<string, string>()
  for (const [prop, propMeta] of Object.entries<any>(meta.properties)) {
    for (const column of (propMeta?.fieldNames ?? []) as string[]) if (column !== prop) byColumn.set(column, prop)
  }
  if (byColumn.size === 0) return filters
  return Object.fromEntries(Object.entries(filters).map(([key, value]) => [byColumn.get(key) ?? key, value]))
}

export function pagedOrmList(options: PagedOrmListOptions) {
  const slices = new WeakMap<object, Slice>()

  async function buildFilters(base: Record<string, unknown>, query: ListQuery, ctx: CrudCtx): Promise<Record<string, unknown>> {
    const request = ctx?.request as Request | undefined
    if (!request || servedWhole(query, request)) return base
    const em = (ctx.container.resolve('em') as any).fork()
    const where = buildScopedWhere(toPropertyKeys(mergeAdvancedFilters(base, query as any) as Record<string, unknown>, em, options.entity), {
      organizationId: options.orgField ? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null : undefined,
      organizationIds: options.orgField ? ctx.organizationIds ?? undefined : undefined,
      tenantId: options.tenantField ? ctx.auth?.tenantId : undefined,
      orgField: options.orgField ?? null,
      tenantField: options.tenantField ?? null,
      softDeleteField: options.softDeleteField ?? null,
    })
    const { page, pageSize } = pageOf(query)
    const meta = em.getMetadata?.()?.find?.(options.entity.name)
    const properties = meta?.properties ? new Set<string>(Object.keys(meta.properties)) : undefined
    const [rows, total] = await em.findAndCount(options.entity, where, {
      fields: ['id'],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: orderOf(query, options, properties),
    })
    const ids = (rows as Array<{ id: string }>).map((row) => String(row.id))
    slices.set(request, { ids, total, page, pageSize })
    return { ...base, id: { $in: ids } }
  }

  async function afterList(payload: { items?: unknown[]; total?: number } & Record<string, unknown>, ctx: CrudCtx): Promise<void> {
    const request = ctx?.request as Request | undefined
    const slice = request ? slices.get(request) : undefined
    if (!slice) return
    slices.delete(request as Request)
    const position = new Map(slice.ids.map((id, index) => [id, index]))
    const items = Array.isArray(payload.items) ? payload.items : []
    payload.items = [...items].sort((a, b) => (position.get(String((a as { id?: unknown }).id)) ?? 0) - (position.get(String((b as { id?: unknown }).id)) ?? 0))
    payload.total = slice.total
    payload.page = slice.page
    payload.pageSize = slice.pageSize
    payload.totalPages = Math.ceil(slice.total / slice.pageSize)
  }

  return { buildFilters, afterList }
}
