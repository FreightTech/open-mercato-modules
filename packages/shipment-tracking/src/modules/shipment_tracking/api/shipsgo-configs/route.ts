import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ShipsGoConfig } from '../../data/entities'
import { shipsGoConfigUpsertSchema } from '../../data/validators'
import {
  createShipmentTrackingCrudOpenApi,
  defaultOkResponseSchema,
} from '../openapi'

// ─── Metadata ────────────────────────────────────────────────

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.shipsgo_config.view'] },
  PUT: { requireAuth: true, requireFeatures: ['shipment_tracking.shipsgo_config.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['shipment_tracking.shipsgo_config.manage'] },
}

// ─── OpenAPI ─────────────────────────────────────────────────

const upsertSchema = z.object({
  isEnabled: z.boolean(),
  apiToken: z.string(),
  baseUrl: z.string().optional(),
  oceanEnabled: z.boolean().optional(),
  airEnabled: z.boolean().optional(),
  rateLimitRequests: z.number().optional(),
  rateLimitWindowSeconds: z.number().optional(),
})

const shipsGoConfigResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  isEnabled: z.boolean(),
  baseUrl: z.string(),
  oceanEnabled: z.boolean(),
  airEnabled: z.boolean(),
  rateLimitRequests: z.number(),
  rateLimitWindowSeconds: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const openApi = createShipmentTrackingCrudOpenApi({
  resourceName: 'ShipsGoConfig',
  pluralName: 'ShipsGoConfigs',
  querySchema: z.object({}),
  listResponseSchema: z.object({ config: shipsGoConfigResponseSchema.nullable() }),
  update: {
    schema: upsertSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Creates or updates the ShipsGo API configuration for the current organization.',
  },
  del: {
    schema: z.object({}),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes the ShipsGo API configuration.',
  },
})

// ─── GET - Retrieve current config ───────────────────────────

export async function GET(request: NextRequest) {
  const auth = await getAuthFromRequest(request)

  if (!auth?.orgId || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = container.resolve('em') as EntityManager

  const organizationId = scope?.selectedId ?? auth.orgId
  const tenantId = auth.tenantId

  const config = await findOneWithDecryption(
    em,
    ShipsGoConfig,
    { organizationId, tenantId, deletedAt: null },
    {},
    { tenantId, organizationId },
  )

  if (!config) {
    return NextResponse.json({ config: null })
  }

  // Return config without the API token
  return NextResponse.json({
    config: {
      id: config.id,
      organizationId: config.organizationId,
      tenantId: config.tenantId,
      isEnabled: config.isEnabled,
      // apiToken is NOT included for security
      baseUrl: config.baseUrl,
      oceanEnabled: config.oceanEnabled,
      airEnabled: config.airEnabled,
      rateLimitRequests: config.rateLimitRequests,
      rateLimitWindowSeconds: config.rateLimitWindowSeconds,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    },
  })
}

// ─── PUT - Upsert config ─────────────────────────────────────

export async function PUT(request: NextRequest) {
  const auth = await getAuthFromRequest(request)

  if (!auth?.orgId || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const commandBus = container.resolve('commandBus') as CommandBus

  const organizationId = scope?.selectedId ?? auth.orgId
  const tenantId = auth.tenantId

  try {
    const input = shipsGoConfigUpsertSchema.parse({
      ...(body as object),
      organizationId,
      tenantId,
    })

    const { result } = await commandBus.execute<typeof input, { id: string }>(
      'shipment_tracking.shipsgo_config.upsert',
      {
        input,
        ctx: {
          container,
          auth,
          organizationScope: scope,
          selectedOrganizationId: organizationId ?? null,
          organizationIds: scope?.filterIds ?? (organizationId ? [organizationId] : null),
          request,
        },
        metadata: {
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          resourceKind: 'shipment_tracking.shipsgo_config',
        },
      }
    )

    return NextResponse.json({ id: result?.id ?? null })
  } catch (err) {
    console.error('[shipsgo-configs] PUT error:', err)
    const message = err instanceof Error ? err.message : 'Failed to save ShipsGo config'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

// ─── DELETE - Remove config ──────────────────────────────────

export async function DELETE(request: NextRequest) {
  const auth = await getAuthFromRequest(request)

  if (!auth?.orgId || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const commandBus = container.resolve('commandBus') as CommandBus

  const organizationId = scope?.selectedId ?? auth.orgId
  const tenantId = auth.tenantId

  try {
    await commandBus.execute<{ organizationId: string; tenantId: string }, { success: boolean }>(
      'shipment_tracking.shipsgo_config.delete',
      {
        input: { organizationId, tenantId },
        ctx: {
          container,
          auth,
          organizationScope: scope,
          selectedOrganizationId: organizationId ?? null,
          organizationIds: scope?.filterIds ?? (organizationId ? [organizationId] : null),
          request,
        },
        metadata: {
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          resourceKind: 'shipment_tracking.shipsgo_config',
        },
      }
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[shipsgo-configs] DELETE error:', err)
    const message = err instanceof Error ? err.message : 'Failed to delete ShipsGo config'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
