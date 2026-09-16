import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { LocationOverride } from '../../data/entities'
import {
  locationOverrideListSchema,
  locationOverrideCreateSchema,
  locationOverrideUpdateSchema,
} from '../../data/validators'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import {
  createShipmentTrackingCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { withScopedPayload } from '../utils'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const rawBodySchema = z.object({}).passthrough()

type LocationOverrideListQuery = z.infer<typeof locationOverrideListSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.location_overrides.view'] },
  POST: { requireAuth: true, requireFeatures: ['shipment_tracking.location_overrides.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['shipment_tracking.location_overrides.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['shipment_tracking.location_overrides.manage'] },
}

const listFields = [
  'id',
  'carrierCode',
  'unlocode',
  'facilityCode',
  'facilityCodeListProvider',
  'overrideData',
  'description',
  'isActive',
  'createdAt',
  'updatedAt',
  'createdByUserId',
  'updatedByUserId',
]

const buildFilters = (query: LocationOverrideListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = {
    deletedAt: null,
  }

  if (query.carrierCode) {
    filters.carrierCode = { $eq: query.carrierCode }
  }

  if (query.unlocode) {
    filters.unlocode = { $eq: query.unlocode.toUpperCase() }
  }

  if (query.facilityCode) {
    filters.facilityCode = { $eq: query.facilityCode }
  }

  if (query.isActive !== undefined) {
    const parsed = parseBooleanToken(query.isActive)
    if (parsed !== null) {
      filters.isActive = parsed
    }
  }

  if (query.search) {
    const searchTerm = query.search.trim()
    if (searchTerm) {
      filters.$or = [
        { carrierCode: { $ilike: `%${searchTerm}%` } },
        { unlocode: { $ilike: `%${searchTerm}%` } },
        { facilityCode: { $ilike: `%${searchTerm}%` } },
        { description: { $ilike: `%${searchTerm}%` } },
      ]
    }
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: LocationOverride,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: locationOverrideListSchema,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      carrierCode: 'carrier_code',
      unlocode: 'unlocode',
      facilityCode: 'facility_code',
      isActive: 'is_active',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'shipment_tracking.location_override.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return locationOverrideCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'shipment_tracking.location_override.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return locationOverrideUpdateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
    delete: {
      commandId: 'shipment_tracking.location_override.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return { id: (raw as Record<string, unknown>)?.id, ...scoped }
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
  },
})

export const openApi = createShipmentTrackingCrudOpenApi({
  resourceName: 'LocationOverride',
  pluralName: 'LocationOverrides',
  querySchema: locationOverrideListSchema,
  listResponseSchema: createPagedListResponseSchema(z.object({
    id: z.string().uuid(),
    carrierCode: z.string().nullable(),
    unlocode: z.string(),
    facilityCode: z.string(),
    facilityCodeListProvider: z.enum(['BIC', 'SMDG']),
    overrideData: z.object({
      name: z.string(),
      address: z.string().nullable().optional(),
      operatorName: z.string().nullable().optional(),
      countryCode: z.string().nullable().optional(),
      facilityTypeCode: z.string().nullable().optional(),
      coords: z.object({
        latitude: z.number(),
        longitude: z.number(),
      }).nullable().optional(),
    }),
    description: z.string().nullable(),
    isActive: z.boolean(),
  })),
  create: {
    schema: rawBodySchema,
    description: 'Creates a new location override for BIC/SMDG facility data correction.',
  },
  update: {
    schema: rawBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing location override.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a location override (soft delete).',
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
