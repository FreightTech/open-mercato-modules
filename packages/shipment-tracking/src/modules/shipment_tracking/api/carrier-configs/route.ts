import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { CarrierConfig } from '../../data/entities'
import { carrierConfigListSchema, carrierConfigCreateSchema, carrierConfigUpdateSchema } from '../../data/validators'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import {
  createShipmentTrackingCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { withScopedPayload } from '../utils'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const rawBodySchema = z.object({}).passthrough()

type CarrierConfigListQuery = z.infer<typeof carrierConfigListSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.carrier_configs.view'] },
  POST: { requireAuth: true, requireFeatures: ['shipment_tracking.carrier_configs.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['shipment_tracking.carrier_configs.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['shipment_tracking.carrier_configs.manage'] },
}

const listFields = [
  'id',
  'carrierCode',
  'apiEndpoint',
  'authConfig',
  'rateLimitRequests',
  'rateLimitWindowSeconds',
  'isActive',
  'createdAt',
  'updatedAt',
]

const buildFilters = (query: CarrierConfigListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = { deletedAt: null }

  if (query.carrierCode) {
    filters.carrierCode = query.carrierCode
  }

  if (query.isActive !== undefined) {
    const parsed = parseBooleanToken(query.isActive)
    if (parsed !== null) {
      filters.isActive = parsed
    }
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CarrierConfig,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: carrierConfigListSchema,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      carrierCode: 'carrier_code',
      isActive: 'is_active',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'shipment_tracking.carrier_config.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return carrierConfigCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'shipment_tracking.carrier_config.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return carrierConfigUpdateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
    delete: {
      commandId: 'shipment_tracking.carrier_config.delete',
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

export const openApi = createShipmentTrackingCrudOpenApi({
  resourceName: 'CarrierConfig',
  pluralName: 'CarrierConfigs',
  querySchema: carrierConfigListSchema,
  listResponseSchema: createPagedListResponseSchema(z.object({
    id: z.string().uuid(),
    carrierCode: z.string(),
    apiEndpoint: z.string().nullable(),
    isActive: z.boolean(),
  })),
  create: {
    schema: rawBodySchema,
    description: 'Creates a new carrier configuration.',
  },
  update: {
    schema: rawBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing carrier configuration.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a carrier configuration.',
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
