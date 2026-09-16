import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { Webhook } from '../../data/entities'
import { webhookListSchema, webhookCreateSchema, webhookUpdateSchema } from '../../data/validators'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import {
  createShipmentTrackingCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { withScopedPayload } from '../utils'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const rawBodySchema = z.object({}).passthrough()

type WebhookListQuery = z.infer<typeof webhookListSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.webhooks.view'] },
  POST: { requireAuth: true, requireFeatures: ['shipment_tracking.webhooks.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['shipment_tracking.webhooks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['shipment_tracking.webhooks.manage'] },
}

const listFields = [
  'id',
  'url',
  'eventsSubscribed',
  'hmacSecret',
  'isActive',
  'createdAt',
  'updatedAt',
]

const buildFilters = (query: WebhookListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = {}

  if (query.id) {
    filters.id = { $eq: query.id }
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
    entity: Webhook,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: webhookListSchema,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      url: 'url',
      isActive: 'is_active',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'shipment_tracking.webhook.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return webhookCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'shipment_tracking.webhook.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return webhookUpdateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
    delete: {
      commandId: 'shipment_tracking.webhook.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return { id: (raw as any)?.id, ...scoped }
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
  },
})

export const openApi = createShipmentTrackingCrudOpenApi({
  resourceName: 'Webhook',
  pluralName: 'Webhooks',
  querySchema: webhookListSchema,
  listResponseSchema: createPagedListResponseSchema(z.object({
    id: z.string().uuid(),
    url: z.string(),
    eventsSubscribed: z.array(z.string()),
    isActive: z.boolean(),
  })),
  create: {
    schema: rawBodySchema,
    description: 'Creates a new webhook subscription.',
  },
  update: {
    schema: rawBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing webhook.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a webhook.',
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
