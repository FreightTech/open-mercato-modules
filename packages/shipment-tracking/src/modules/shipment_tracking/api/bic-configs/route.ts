import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { BicConfig } from '../../data/entities'
import { bicConfigUpsertSchema } from '../../data/validators'
import {
  createShipmentTrackingCrudOpenApi,
  defaultOkResponseSchema,
} from '../openapi'

// ─── Metadata ────────────────────────────────────────────────

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.carrier_configs.view'] },
  PUT: { requireAuth: true, requireFeatures: ['shipment_tracking.carrier_configs.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['shipment_tracking.carrier_configs.manage'] },
}

// ─── OpenAPI ─────────────────────────────────────────────────

const upsertSchema = z.object({
  isEnabled: z.boolean(),
  username: z.string(),
  password: z.string(),
  baseUrl: z.string().optional(),
})

const bicConfigResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  isEnabled: z.boolean(),
  username: z.string(),
  baseUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const openApi = createShipmentTrackingCrudOpenApi({
  resourceName: 'BicConfig',
  pluralName: 'BicConfigs',
  querySchema: z.object({}),
  listResponseSchema: z.object({ config: bicConfigResponseSchema.nullable() }),
  update: {
    schema: upsertSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Creates or updates the BIC API configuration for the current organization.',
  },
  del: {
    schema: z.object({}),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes the BIC API configuration.',
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
    BicConfig,
    { organizationId, tenantId },
    {},
    { tenantId, organizationId },
  )

  if (!config) {
    return NextResponse.json({ config: null })
  }

  // Return config without password
  return NextResponse.json({
    config: {
      id: config.id,
      organizationId: config.organizationId,
      tenantId: config.tenantId,
      isEnabled: config.isEnabled,
      username: config.username,
      // Password is NOT included for security
      baseUrl: config.baseUrl,
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
    const input = bicConfigUpsertSchema.parse({
      ...(body as object),
      organizationId,
      tenantId,
    })

    const { result } = await commandBus.execute<typeof input, { id: string }>(
      'shipment_tracking.bic_config.upsert',
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
          resourceKind: 'shipment_tracking.bic_config',
        },
      }
    )

    return NextResponse.json({ id: result?.id ?? null })
  } catch (err) {
    console.error('[bic-configs] PUT error:', err)
    const message = err instanceof Error ? err.message : 'Failed to save BIC config'
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
      'shipment_tracking.bic_config.delete',
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
          resourceKind: 'shipment_tracking.bic_config',
        },
      }
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[bic-configs] DELETE error:', err)
    const message = err instanceof Error ? err.message : 'Failed to delete BIC config'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
