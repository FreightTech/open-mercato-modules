import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { WebhookDelivery } from '../../../data/entities'
import { webhookDeliveryListSchema } from '../../../data/validators'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { pagedOrmList } from '../../../lib/paged-list'
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

/**
 * A delivery has no tenant or organisation of its own: it is its webhook's. So it is scoped through the webhook — the
 * caller's tenant and organisations — not left open to every tenant (GEPARD-355).
 */
const buildFilters = (query: DeliveryListQuery, ctx?: CrudCtx): Record<string, unknown> => {
  const filters: Record<string, unknown> = {}
  const webhookScope: Record<string, unknown> = {}
  if (ctx?.auth?.tenantId) webhookScope.tenantId = ctx.auth.tenantId
  if (Array.isArray(ctx?.organizationIds)) webhookScope.organizationId = { $in: ctx.organizationIds }
  if (Object.keys(webhookScope).length > 0) filters.webhook = webhookScope

  if (query.webhookId) {
    filters.webhook = { ...(filters.webhook as Record<string, unknown> | undefined), id: query.webhookId }
  }

  if (query.status) {
    filters.status = query.status
  }

  if (query.eventType) {
    filters.eventType = query.eventType
  }

  return filters
}

// GEPARD-355: page and sort on the server (lib/paged-list) — the CRUD fallback alone reads the whole table.
const deliverySortFieldMap = {
  id: 'id',
  status: 'status',
  eventType: 'event_type',
  createdAt: 'created_at',
}

const deliveryPages = pagedOrmList({
  entity: WebhookDelivery,
  sortFieldMap: deliverySortFieldMap,
  defaultSort: { field: 'createdAt', dir: 'desc' },
  orgField: null,
  tenantField: null,
  softDeleteField: null,
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: WebhookDelivery,
    idField: 'id',
    orgField: null,
    tenantField: null,
    // A delivery is never soft-deleted (no `deleted_at`): the factory's default `deletedAt: null` filter made every
    // list request fail with "Trying to query by not existing property WebhookDelivery.deletedAt" (500, tms-ft 21.11).
    softDeleteField: null,
  },
  list: {
    schema: webhookDeliveryListSchema,
    fields: listFields,
    sortFieldMap: deliverySortFieldMap,
    buildFilters: async (query, ctx) => deliveryPages.buildFilters(buildFilters(query, ctx), query, ctx),
  },
  hooks: {
    afterList: deliveryPages.afterList,
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
