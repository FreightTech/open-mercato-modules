import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { WebhookDelivery } from '../../../data/entities'
import { webhookDeliveryListSchema } from '../../../data/validators'
import {
  createShipmentTrackingCrudOpenApi,
  createPagedListResponseSchema,
} from '../../openapi'

type DeliveryListQuery = z.infer<typeof webhookDeliveryListSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.webhooks.view'] },
}

const listFields = [
  'id',
  'webhook_id',
  'event_type',
  'status',
  'retry_count',
  'next_retry_at',
  'response_status',
  'error_message',
  'created_at',
]

const buildFilters = (query: DeliveryListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = {}

  if (query.webhookId) {
    filters.webhook = query.webhookId
  }

  if (query.status) {
    filters.status = query.status
  }

  if (query.eventType) {
    filters.eventType = query.eventType
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: WebhookDelivery,
    idField: 'id',
    orgField: null,
    tenantField: null,
  },
  list: {
    schema: webhookDeliveryListSchema,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      status: 'status',
      eventType: 'event_type',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
})

export const openApi = createShipmentTrackingCrudOpenApi({
  resourceName: 'WebhookDelivery',
  pluralName: 'WebhookDeliveries',
  querySchema: webhookDeliveryListSchema,
  listResponseSchema: createPagedListResponseSchema(z.object({
    id: z.string().uuid(),
    eventType: z.string(),
    status: z.string(),
    retryCount: z.number(),
    responseStatus: z.number().nullable(),
    createdAt: z.string(),
  })),
})

export const metadata = crud.metadata
export const GET = crud.GET
