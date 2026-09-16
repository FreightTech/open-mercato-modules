import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { TerminalTrackingJob, TerminalEvent } from '../../data/entities'
import { trackingJobListSchema, trackingJobCreateSchema } from '../../data/validators'
import {
  createTerminalTrackingCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { withScopedPayload } from '../utils'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseDynamicTableFilters } from '@freighttech/ui/backend/dynamic-table/server'

const rawBodySchema = z.object({}).passthrough()

type ListQuery = z.infer<typeof trackingJobListSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['terminal_tracking.tracking_jobs.view'] },
  POST: { requireAuth: true, requireFeatures: ['terminal_tracking.tracking_jobs.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['terminal_tracking.tracking_jobs.manage'] },
}

// Maps DynamicTable column keys → MikroORM property paths. Doubles as an
// allowlist: unknown fields are dropped by the parser. Only real DB columns are
// filterable — gateInAt/gateOutAt/holds are derived in afterList, not stored.
const FILTER_FIELD_MAP: Record<string, string> = {
  terminalCode: 'terminalCode',
  containerNumber: 'containerNumber',
  status: 'status',
}

const buildFilters = (query: ListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = { deletedAt: null }
  if (query.terminalCode) filters.terminalCode = query.terminalCode
  if (query.containerNumber) filters.containerNumber = query.containerNumber
  if (query.status) filters.status = query.status
  // DynamicTable filter popover sends filters as a JSON-stringified FilterRow[].
  if (query.filters) {
    try {
      const dyn = JSON.parse(query.filters)
      const parsed = parseDynamicTableFilters(dyn, FILTER_FIELD_MAP)
      if (parsed.length) filters.$and = [...((filters.$and as Record<string, unknown>[]) ?? []), ...parsed]
    } catch {
      // Invalid filter JSON must not 500 the list — ignore and return the base filters.
    }
  }
  return filters
}

// Arrival milestones: a truck/rail gate-in (GTIN) or a vessel discharge (DISC).
// Either means "entered the terminal", so both feed the Gate-in column.
const ARRIVAL_CODES = new Set(['GTIN', 'DISC'])

/**
 * Enrich each listed job row with its Gate-in / Gate-out times and current holds,
 * derived from its TerminalEvent rows. One batched, tenant+org-scoped query for
 * the whole page (jobIds are already scoped by the list). Gate-in = earliest
 * arrival event; Gate-out = latest DEPA; holds = impediments on the most recent
 * event (the current snapshot).
 */
async function enrichWithMilestones(
  payload: { items?: Array<Record<string, unknown>> },
  ctx: { container: { resolve: (name: string) => unknown }; auth: { tenantId?: string | null } | null; organizationIds: string[] | null },
): Promise<void> {
  const items = Array.isArray(payload?.items) ? payload.items : []
  const tenantId = ctx.auth?.tenantId
  if (!items.length || !tenantId) return
  const jobIds = items.map((i) => i?.id).filter((x): x is string => typeof x === 'string')
  if (!jobIds.length) return

  const em = ctx.container.resolve('em') as EntityManager
  const where: Record<string, unknown> = { job: { $in: jobIds }, tenantId }
  if (ctx.organizationIds && ctx.organizationIds.length) where.organizationId = { $in: ctx.organizationIds }
  const events = await em.find(TerminalEvent, where, { orderBy: { eventDateTime: 'asc' } })

  const byJob = new Map<string, TerminalEvent[]>()
  for (const e of events) {
    const jobId = String((e.job as unknown as { id?: string })?.id ?? '')
    if (!jobId) continue
    const arr = byJob.get(jobId)
    if (arr) arr.push(e)
    else byJob.set(jobId, [e])
  }

  payload.items = items.map((item) => {
    const evs = byJob.get(String((item as { id?: unknown }).id)) ?? []
    const arrival = evs.find((e) => ARRIVAL_CODES.has(e.eventCode)) // earliest (sorted asc)
    const departure = [...evs].reverse().find((e) => e.eventCode === 'DEPA')
    const latest = evs.length ? evs[evs.length - 1] : null
    // List items are MikroORM entity instances whose JSON serialization only
    // emits *mapped* columns — ad-hoc props assigned here are dropped on the way
    // out. Round-trip to a plain object (same shape the response already produces)
    // so the computed columns survive. On cache hits items are already plain, so
    // this is just a clone.
    const plain = JSON.parse(JSON.stringify(item)) as Record<string, unknown>
    plain.gateInAt = arrival?.eventDateTime ? arrival.eventDateTime.toISOString() : null
    plain.gateOutAt = departure?.eventDateTime ? departure.eventDateTime.toISOString() : null
    plain.holds = latest?.impediments && latest.impediments.length ? latest.impediments : []
    return plain
  })
}

// Sort keys the grid may send → MikroORM entity properties. Derived columns
// (gateInAt/gateOutAt/holds) are computed post-query and are not sortable.
const SORT_FIELD_MAP: Record<string, string> = {
  id: 'id',
  terminalCode: 'terminalCode',
  containerNumber: 'containerNumber',
  status: 'status',
  createdAt: 'createdAt',
  lastPollAt: 'lastPollAt',
}

/**
 * Paginated list of tracking jobs. Hand-rolled (rather than the CRUD factory's
 * ORM-fallback list, which fetches every row and ignores page/pageSize) so the
 * DynamicTable pager gets real DB `limit`/`offset` and a true total. Mirrors the
 * sibling vessel-visits route; filters/derived columns reuse the shared helpers.
 */
async function listTrackingJobs(request: NextRequest): Promise<Response> {
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = trackingJobListSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }
  const page = parsed.data.page ?? 1
  const pageSize = parsed.data.pageSize ?? parsed.data.limit ?? 50

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = container.resolve('em') as EntityManager
  const orgIds = scope?.filterIds ?? [auth.orgId]

  const where: Record<string, unknown> = {
    ...buildFilters(parsed.data),
    tenantId: auth.tenantId,
    organizationId: { $in: orgIds },
  }

  const sortField = SORT_FIELD_MAP[parsed.data.sortField ?? ''] ?? 'createdAt'
  const sortDir = parsed.data.sortDir ?? 'desc'

  const [items, total] = await em.findAndCount(TerminalTrackingJob, where, {
    orderBy: { [sortField]: sortDir },
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })

  const payload: {
    items: Array<Record<string, unknown>>
    total: number
    page: number
    pageSize: number
    totalPages: number
  } = {
    items: items as unknown as Array<Record<string, unknown>>,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
  await enrichWithMilestones(payload, { container, auth, organizationIds: orgIds })
  return NextResponse.json(payload)
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: TerminalTrackingJob,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  actions: {
    create: {
      commandId: 'terminal_tracking.tracking_job.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return trackingJobCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null, newEvents: result?.newEvents ?? 0 }),
      status: 201,
    },
    delete: {
      commandId: 'terminal_tracking.tracking_job.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const body = (raw as any)?.body ?? raw ?? {}
        const scoped = withScopedPayload(body, ctx, translate)
        return { id: body.id, ...scoped }
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
  },
})

export const openApi = createTerminalTrackingCrudOpenApi({
  resourceName: 'TerminalTrackingJob',
  pluralName: 'TerminalTrackingJobs',
  querySchema: trackingJobListSchema,
  listResponseSchema: createPagedListResponseSchema(
    z.object({
      id: z.string().uuid(),
      terminalCode: z.string(),
      containerNumber: z.string(),
      status: z.string(),
      gateInAt: z.string().datetime().nullable(),
      gateOutAt: z.string().datetime().nullable(),
      holds: z.array(z.string()),
    }),
  ),
  create: { schema: rawBodySchema, description: 'Creates a terminal tracking job for a container.' },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a terminal tracking job.',
  },
})

export const metadata = routeMetadata
// GET is hand-rolled for real DB pagination (the factory's ORM-fallback list
// returns every row and ignores page/pageSize); POST/DELETE stay on the factory.
export const GET = listTrackingJobs
export const POST = crud.POST
export const DELETE = crud.DELETE
