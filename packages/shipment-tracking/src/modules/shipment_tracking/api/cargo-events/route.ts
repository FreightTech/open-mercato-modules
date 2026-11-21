import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { TrackingEvent } from '../../data/entities'
import { trackingEventListSchema } from '../../data/validators'
import { pagedOrmList } from '../../lib/paged-list'
import {
  createShipmentTrackingCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

type TrackingEventListQuery = z.infer<typeof trackingEventListSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.shipments.view'] },
}

const listFields = [
  'id',
  'trackingJob',
  'source',
  'sourceEventId',
  'eventType',
  'eventCode',
  'eventClassifierCode',
  'eventDateTime',
  'description',
  'equipmentReference',
  'locationName',
  'locationUnlocode',
  'locationCountry',
  'vesselName',
  'vesselImo',
  'voyageNumber',
  'createdAt',
]

const buildFilters = (query: TrackingEventListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = {}

  if (query.trackingJobId) {
    filters.tracking_job_id = { $eq: query.trackingJobId }
  }

  if (query.equipmentReference) {
    filters.equipmentReference = query.equipmentReference
  }

  if (query.source) {
    filters.source = query.source
  }

  if (query.eventType) {
    filters.eventType = query.eventType
  }

  if (query.eventCode) {
    filters.eventCode = query.eventCode
  }

  return filters
}

// GEPARD-355: page and sort on the server (lib/paged-list) — the CRUD fallback alone reads the whole table.
const cargoEventSortFieldMap = {
  id: 'id',
  eventDateTime: 'event_date_time',
  eventType: 'event_type',
  eventCode: 'event_code',
  createdAt: 'created_at',
}

const cargoEventPages = pagedOrmList({
  entity: TrackingEvent,
  sortFieldMap: cargoEventSortFieldMap,
  defaultSort: { field: 'eventDateTime', dir: 'desc' },
  orgField: 'organizationId',
  tenantField: 'tenantId',
  softDeleteField: null,
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: TrackingEvent,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: null,
  },
  list: {
    schema: trackingEventListSchema,
    fields: listFields,
    sortFieldMap: cargoEventSortFieldMap,
    buildFilters: async (query, ctx) => cargoEventPages.buildFilters(buildFilters(query), query, ctx),
  },
  hooks: {
    afterList: cargoEventPages.afterList,
  },
})

export const openApi = createShipmentTrackingCrudOpenApi({
  resourceName: 'TrackingEvent',
  pluralName: 'TrackingEvents',
  querySchema: trackingEventListSchema,
  listResponseSchema: createPagedListResponseSchema(z.object({
    id: z.string().uuid(),
    source: z.string(),
    eventType: z.string(),
    eventCode: z.string(),
    eventDateTime: z.string(),
    equipmentReference: z.string().nullable(),
    locationName: z.string().nullable(),
  })),
})

export const metadata = crud.metadata
export const GET = crud.GET
