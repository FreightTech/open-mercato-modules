import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { Shipment } from '../../data/entities'
import { shipmentListSchema, shipmentCreateSchema, shipmentUpdateSchema } from '../../data/validators'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  createShipmentTrackingCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { withScopedPayload } from '../utils'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const rawBodySchema = z.object({}).passthrough()

type ShipmentListQuery = z.infer<typeof shipmentListSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.shipments.view'] },
  POST: { requireAuth: true, requireFeatures: ['shipment_tracking.shipments.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['shipment_tracking.shipments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['shipment_tracking.shipments.manage'] },
}

const listFields = [
  'id',
  'status',
  'carrierCode',
  'containerNumber',
  'bookingNumber',
  'isoEquipmentCode',
  'bolNumber',
  // Multi-source timestamp arrays
  'etdTimestamps',
  'etaTimestamps',
  'atdTimestamps',
  'ataTimestamps',
  // Location data (JSONB)
  'originLocation',
  'destinationLocation',
  // Vessel info
  'vesselName',
  'vesselImo',
  'voyageNumber',
  'eventCount',
  // Denormalized route & events (JSONB)
  'routeStops',
  'cargoEvents',
  // Aggregated seals (JSONB)
  'seals',
  // Tracking job relation (for fetching events - kept for backward compatibility)
  'trackingJob',
  'createdAt',
  'updatedAt',
]

const buildFilters = (query: ShipmentListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = { deletedAt: null }

  if (query.id) {
    filters.id = query.id
  }

  const search = query.search?.trim()
  if (search && search.length > 0) {
    const escaped = escapeLikePattern(search)
    const pattern = `%${escaped}%`
    filters.$or = [
      { containerNumber: { $ilike: pattern } },
      { bookingNumber: { $ilike: pattern } },
      { bolNumber: { $ilike: pattern } },
      { carrierCode: { $ilike: pattern } },
      { vesselName: { $ilike: pattern } },
      // HEDGE-101 — JSONB nested property search, as NESTED OBJECTS.
      //
      // `origin_location` / `destination_location` are `jsonb` columns, not
      // relations. A dotted string key (`'originLocation.name'`) is read by
      // MikroORM as a RELATION PATH, so it emitted a condition against a table
      // that was never joined and the query died with
      // `missing FROM-clause entry for table "originLocation"` — a hard 500 on
      // every keystroke. The nested-object form is what compiles to
      // `"origin_location"->>'name'`.
      //
      // The condition is only added when `q` is non-empty, which is why the
      // route looked healthy until the first search: this path had never worked.
      { originLocation: { name: { $ilike: pattern } } },
      { originLocation: { unlocode: { $ilike: pattern } } },
      { destinationLocation: { name: { $ilike: pattern } } },
      { destinationLocation: { unlocode: { $ilike: pattern } } },
    ]
  }

  if (query.status) {
    filters.status = query.status
  }

  if (query.carrierCode) {
    filters.carrierCode = query.carrierCode
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Shipment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: shipmentListSchema,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      status: 'status',
      carrierCode: 'carrier_code',
      containerNumber: 'container_number',
      bookingNumber: 'booking_number',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'shipment_tracking.shipment.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return shipmentCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'shipment_tracking.shipment.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return shipmentUpdateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
    delete: {
      commandId: 'shipment_tracking.shipment.delete',
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
  resourceName: 'Shipment',
  pluralName: 'Shipments',
  querySchema: shipmentListSchema,
  listResponseSchema: createPagedListResponseSchema(z.object({
    id: z.string().uuid(),
    status: z.string(),
    carrierCode: z.string().nullable(),
    containerNumber: z.string().nullable(),
    bookingNumber: z.string().nullable(),
    bolNumber: z.string().nullable(),
  })),
  create: {
    schema: rawBodySchema,
    description: 'Creates a new shipment.',
  },
  update: {
    schema: rawBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing shipment by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a shipment by id.',
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
