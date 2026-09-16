import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest, type OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { parseDynamicTableFilters } from './filterParser'
import {
  AggregateSpecError,
  parseAggregateSpec,
  runAggregate,
  tenancyFromRouteContext,
} from './aggregate'

// ─── Types ───────────────────────────────────

export interface DynamicTableRouteOrmConfig {
  entity: any
  idField?: string
  orgField?: string | null
  tenantField?: string | null
  softDeleteField?: string | null
}

export interface DynamicTableRouteMethodMetadata {
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
}

export interface DynamicTableRouteCtx {
  auth: AuthContext
  container: any
  em: EntityManager
  scope: OrganizationScope | null
  tenantId: string | null
  organizationId: string | null
  allowedOrgIds: Set<string>
  request: NextRequest
}

export interface DynamicTableRouteUpdateConfig {
  schema: z.ZodType<any>
  mapPayload?: (payload: Record<string, unknown>, ctx: DynamicTableRouteCtx) => Record<string, unknown>
}

export interface DynamicTableRouteCreateConfig {
  schema: z.ZodType<any>
  mapPayload?: (payload: Record<string, unknown>, ctx: DynamicTableRouteCtx) => Record<string, unknown>
}

export interface DynamicTableRouteDeleteConfig {
  soft?: boolean
}

export interface DynamicTableRouteConfig<TEntity = any, TRow = any> {
  orm: DynamicTableRouteOrmConfig
  fieldMap: Record<string, string>
  transformItem: (entity: TEntity) => TRow

  search?: (q: string) => Record<string, unknown>
  buildFilters?: (query: Record<string, unknown>, ctx: DynamicTableRouteCtx) => Record<string, unknown>
  afterList?: (items: TRow[], ctx: DynamicTableRouteCtx) => Promise<TRow[]> | TRow[]

  update?: DynamicTableRouteUpdateConfig | false
  create?: DynamicTableRouteCreateConfig
  delete?: boolean | DynamicTableRouteDeleteConfig

  metadata?: {
    GET?: DynamicTableRouteMethodMetadata
    PUT?: DynamicTableRouteMethodMetadata
    POST?: DynamicTableRouteMethodMetadata
    DELETE?: DynamicTableRouteMethodMetadata
  }
}

// ─── Built-in list query schema ──────────────

const listQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(50),
    q: z.string().optional(),
    sortField: z.string().optional().default('id'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    filters: z.string().optional(),
    /** `field:fn,field:fn` — see `server/aggregate.ts`. Capped there too. */
    aggregate: z.string().max(500).optional(),
  })
  .passthrough()

// ─── Helpers ─────────────────────────────────

async function resolveContext(request: NextRequest): Promise<DynamicTableRouteCtx | null> {
  const auth = await getAuthFromRequest(request)
  if (!auth) return null

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = container.resolve('em') as EntityManager

  const tenantId = (auth.actorTenantId || auth.tenantId) as string | null
  const organizationId = (auth.actorOrgId || auth.orgId) as string | null

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) {
    scope.filterIds.forEach((id) => {
      if (typeof id === 'string') allowedOrgIds.add(id)
    })
  } else if (typeof auth.actorOrgId === 'string') {
    allowedOrgIds.add(auth.actorOrgId)
  } else if (typeof auth.orgId === 'string') {
    allowedOrgIds.add(auth.orgId)
  }

  return { auth, container, em, scope, tenantId, organizationId, allowedOrgIds, request }
}

function buildScopeFilters(
  ctx: DynamicTableRouteCtx,
  orm: DynamicTableRouteOrmConfig
): Record<string, unknown> {
  const filters: Record<string, unknown> = {}

  const softDeleteField = orm.softDeleteField === undefined ? 'deletedAt' : orm.softDeleteField
  if (softDeleteField) {
    filters[softDeleteField] = null
  }

  const tenantField = orm.tenantField === undefined ? 'tenantId' : orm.tenantField
  if (tenantField && ctx.tenantId) {
    filters[tenantField] = ctx.tenantId
  }

  const orgField = orm.orgField === undefined ? 'organizationId' : orm.orgField
  if (orgField && ctx.allowedOrgIds.size) {
    filters[orgField] = { $in: [...ctx.allowedOrgIds] }
  }

  return filters
}

// ─── Factory ─────────────────────────────────

export function makeDynamicTableRoute<TEntity = any, TRow = any>(
  config: DynamicTableRouteConfig<TEntity, TRow>
) {
  const { orm, fieldMap, transformItem } = config

  // ── GET: List with filters, search, sort, pagination ──

  async function GET(request: NextRequest) {
    const ctx = await resolveContext(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const rawQuery: Record<string, string | undefined> = {}
    url.searchParams.forEach((value, key) => {
      rawQuery[key] = value
    })

    const parse = listQuerySchema.safeParse(rawQuery)
    if (!parse.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parse.error },
        { status: 400 }
      )
    }

    const query = parse.data

    // Build base scope filters (tenant, org, soft delete)
    const filters: Record<string, unknown> = buildScopeFilters(ctx, orm)

    // Custom filters from query params
    if (config.buildFilters) {
      Object.assign(filters, config.buildFilters(rawQuery, ctx))
    }

    // Search
    if (query.q && query.q.trim() && config.search) {
      const searchFilters = config.search(query.q.trim())
      Object.assign(filters, searchFilters)
    }

    // DynamicTable filters (JSON)
    if (query.filters) {
      try {
        const dynamicFilters: Array<{ field: string; operator: string; values: unknown[] }> =
          JSON.parse(query.filters)
        if (dynamicFilters.length > 0) {
          const parsedFilters = parseDynamicTableFilters(dynamicFilters, fieldMap)
          if (parsedFilters.length > 0) {
            filters.$and = [
              ...((filters.$and as Record<string, unknown>[]) || []),
              ...parsedFilters,
            ]
          }
        }
      } catch {
        // Ignore invalid filters JSON
      }
    }

    // Sort
    const sortField = fieldMap[query.sortField] || fieldMap[Object.keys(fieldMap)[0]] || 'id'
    const sortDir = query.sortDir || 'asc'

    // Query
    const [entities, total] = await ctx.em.findAndCount(orm.entity, filters, {
      orderBy: { [sortField]: sortDir },
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    })

    let items = (entities as TEntity[]).map(transformItem)

    if (config.afterList) {
      items = await config.afterList(items, ctx)
    }

    // ── Optional dataset-wide aggregate ──
    //
    // CRITICAL: `filters` is the SAME OBJECT REFERENCE just handed to
    // `findAndCount`. Rebuilding an equivalent-looking one is the cross-tenant
    // total this helper exists to prevent — the aggregate must describe exactly
    // the rows the page is a window onto.
    //
    // Absent `?aggregate=`, the response is byte-identical to before: the key
    // is spread in conditionally, never emitted as `undefined`.
    let aggregate: Awaited<ReturnType<typeof runAggregate>> | undefined
    if (query.aggregate) {
      let entries
      try {
        entries = parseAggregateSpec(query.aggregate, fieldMap)
      } catch (err) {
        if (err instanceof AggregateSpecError) {
          return NextResponse.json({ error: err.message }, { status: 400 })
        }
        throw err
      }
      if (entries.length > 0) {
        aggregate = await runAggregate({
          em: ctx.em,
          entity: orm.entity,
          where: filters,
          tenancy: tenancyFromRouteContext(ctx, orm),
          entries,
        })
      }
    }

    return NextResponse.json({
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
      ...(aggregate ? { aggregate } : {}),
    })
  }

  // ── POST: Create new entity ──

  async function POST(request: NextRequest) {
    if (!config.create) {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const ctx = await resolveContext(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!ctx.tenantId || !ctx.organizationId) {
      return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
    }

    const body = await request.json()
    const parse = config.create.schema.safeParse(body)
    if (!parse.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parse.error },
        { status: 400 }
      )
    }

    let payload: Record<string, unknown> = { ...parse.data }
    if (config.create.mapPayload) {
      payload = config.create.mapPayload(payload, ctx)
    }

    const tenantField = orm.tenantField === undefined ? 'tenantId' : orm.tenantField
    const orgField = orm.orgField === undefined ? 'organizationId' : orm.orgField

    const entityData: Record<string, unknown> = { ...payload }
    if (tenantField) entityData[tenantField] = ctx.tenantId
    if (orgField) entityData[orgField] = ctx.organizationId
    if ('createdBy' in (new orm.entity() as any)) {
      entityData.createdBy = typeof ctx.auth?.userId === 'string' ? ctx.auth.userId : null
    }

    const entity = ctx.em.create(orm.entity, entityData)
    await ctx.em.persist(entity).flush()

    const idField = orm.idField || 'id'
    return NextResponse.json({
      id: (entity as any)[idField],
      success: true,
    })
  }

  // ── PUT: Update entity by id (for cell edit) ──

  async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    if (config.update === false) {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const ctx = await resolveContext(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    if (config.update) {
      const parse = config.update.schema.safeParse(body)
      if (!parse.success) {
        return NextResponse.json(
          { error: 'Invalid request body', details: parse.error },
          { status: 400 }
        )
      }
    }

    const idField = orm.idField || 'id'
    const findFilters: Record<string, unknown> = {
      [idField]: id,
      ...buildScopeFilters(ctx, orm),
    }

    const entity = await ctx.em.findOne(orm.entity, findFilters)
    if (!entity) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let payload: Record<string, unknown> = { ...body }
    if (config.update && config.update.mapPayload) {
      payload = config.update.mapPayload(payload, ctx)
    }

    ctx.em.assign(entity, payload)
    if ('updatedBy' in (entity as any)) {
      ;(entity as any).updatedBy = typeof ctx.auth?.userId === 'string' ? ctx.auth.userId : null
    }
    await ctx.em.flush()

    return NextResponse.json({
      id: (entity as any)[idField],
      success: true,
    })
  }

  // ── DELETE: Remove entity by id ──

  async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    if (!config.delete) {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const ctx = await resolveContext(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const idField = orm.idField || 'id'
    const findFilters: Record<string, unknown> = {
      [idField]: id,
      ...buildScopeFilters(ctx, orm),
    }

    const entity = await ctx.em.findOne(orm.entity, findFilters)
    if (!entity) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const deleteConfig = typeof config.delete === 'object' ? config.delete : {}
    const useSoftDelete = deleteConfig.soft !== false

    const softDeleteField = orm.softDeleteField === undefined ? 'deletedAt' : orm.softDeleteField

    if (useSoftDelete && softDeleteField) {
      ;(entity as any)[softDeleteField] = new Date()
      if ('updatedBy' in (entity as any)) {
        ;(entity as any).updatedBy = typeof ctx.auth?.userId === 'string' ? ctx.auth.userId : null
      }
      await ctx.em.flush()
    } else {
      await ctx.em.remove(entity).flush()
    }

    return NextResponse.json({ success: true })
  }

  // ── Metadata ──

  const metadata: Record<string, DynamicTableRouteMethodMetadata | undefined> = {
    GET: config.metadata?.GET,
    POST: config.metadata?.POST,
    PUT: config.metadata?.PUT,
    DELETE: config.metadata?.DELETE,
  }

  return { GET, POST, PUT, DELETE, metadata }
}
