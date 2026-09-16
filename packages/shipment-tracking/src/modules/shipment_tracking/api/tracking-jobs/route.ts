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
