import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { TerminalConfig } from '../../data/entities'
import {
  terminalConfigListSchema,
  terminalConfigCreateSchema,
  terminalConfigUpdateSchema,
} from '../../data/validators'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import {
  createTerminalTrackingCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { withScopedPayload } from '../utils'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const rawBodySchema = z.object({}).passthrough()

type ListQuery = z.infer<typeof terminalConfigListSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['terminal_tracking.terminal_configs.view'] },
  POST: { requireAuth: true, requireFeatures: ['terminal_tracking.terminal_configs.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['terminal_tracking.terminal_configs.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['terminal_tracking.terminal_configs.manage'] },
}

const listFields = [
  'id',
  'terminalCode',
  'adapterType',
  'displayName',
  'baseUrl',
  'authType',
  'unlocode',
  'isActive',
  'createdAt',
  'updatedAt',
]

const buildFilters = (query: ListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = { deletedAt: null }
  if (query.terminalCode) filters.terminalCode = query.terminalCode
  if (query.isActive !== undefined) {
    const parsed = parseBooleanToken(query.isActive)
    if (parsed !== null) filters.isActive = parsed
  }
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: TerminalConfig,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: terminalConfigListSchema,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      terminalCode: 'terminal_code',
      isActive: 'is_active',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'terminal_tracking.terminal_config.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return terminalConfigCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'terminal_tracking.terminal_config.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return terminalConfigUpdateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 200,
    },
    delete: {
      commandId: 'terminal_tracking.terminal_config.delete',
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
  resourceName: 'TerminalConfig',
  pluralName: 'TerminalConfigs',
  querySchema: terminalConfigListSchema,
  listResponseSchema: createPagedListResponseSchema(
    z.object({
      id: z.string().uuid(),
      terminalCode: z.string(),
      adapterType: z.string(),
      displayName: z.string(),
      isActive: z.boolean(),
    }),
  ),
  create: { schema: rawBodySchema, description: 'Creates a new terminal configuration.' },
  update: {
    schema: rawBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing terminal configuration.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a terminal configuration.',
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
