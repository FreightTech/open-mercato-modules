import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { TrackingJob } from '../../data/entities'
import { trackingJobListSchema, trackingJobCreateSchema, trackingJobUpdateSchema } from '../../data/validators'
import {
  createShipmentTrackingCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { withScopedPayload } from '../utils'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const rawBodySchema = z.object({}).passthrough()

type TrackingJobListQuery = z.infer<typeof trackingJobListSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.tracking_jobs.view'] },
  POST: { requireAuth: true, requireFeatures: ['shipment_tracking.tracking_jobs.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['shipment_tracking.tracking_jobs.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['shipment_tracking.tracking_jobs.manage'] },
}

const listFields = [
  'id',
  'carrierCode',
  'referenceType',
  'referenceValue',
  'status',
  'nextPollAt',
  'lastPollAt',
  'retryCount',
  'createdAt',
  'updatedAt',
]

const buildFilters = (query: TrackingJobListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = {}

  if (query.status) {
    filters.status = query.status
  }

  if (query.carrierCode) {
    filters.carrierCode = query.carrierCode
  }

  if (query.referenceType) {
    filters.referenceType = query.referenceType
  }

  if (query.referenceValue) {
    filters.referenceValue = query.referenceValue
  }

  // Free-text search — the grid's own search box and a split-view workspace's
  // shared search both send it as `q`/`search`. The route used to discard it,
  // so a Tracking Jobs pane kept showing every row under a live needle with
  // nothing on screen saying so (TC-APP-612). Matches what a user types: a
  // container / booking / B/L reference, the carrier, or the provider's id.
  const raw = (query as { q?: unknown; search?: unknown }).q ?? (query as { search?: unknown }).search
  const needle = typeof raw === 'string' ? raw.trim() : ''
  if (needle) {
    const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    filters.$or = [
      { reference_value: { $ilike: pattern } },
      { carrier_code: { $ilike: pattern } },
      { reference_type: { $ilike: pattern } },
      { provider_shipment_id: { $ilike: pattern } },
    ]
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: TrackingJob,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: trackingJobListSchema,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      carrierCode: 'carrier_code',
      status: 'status',
      nextPollAt: 'next_poll_at',
      lastPollAt: 'last_poll_at',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'shipment_tracking.tracking_job.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return trackingJobCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'shipment_tracking.tracking_job.pause',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return trackingJobUpdateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
    delete: {
      commandId: 'shipment_tracking.tracking_job.deactivate',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const id = (raw as any)?.body?.id ?? (raw as any)?.query?.id
        return { id, ...scoped }
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
  },
})

export const openApi = createShipmentTrackingCrudOpenApi({
  resourceName: 'TrackingJob',
  pluralName: 'TrackingJobs',
  querySchema: trackingJobListSchema,
  listResponseSchema: createPagedListResponseSchema(z.object({
    id: z.string().uuid(),
    carrierCode: z.string(),
    referenceType: z.string(),
    referenceValue: z.string(),
    status: z.string(),
  })),
  create: {
    schema: rawBodySchema,
    description: 'Creates a new tracking job. The system will auto-discover containers from carrier events.',
  },
  update: {
    schema: rawBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Pauses a tracking job.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deactivates a tracking job.',
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
