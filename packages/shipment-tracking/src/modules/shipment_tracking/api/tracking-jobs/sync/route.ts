import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus } from '@open-mercato/shared/lib/commands'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['shipment_tracking.tracking_jobs.manage'] },
}

const syncSchema = z.object({
  id: z.string().uuid(),
})

export const openApi = {
  POST: {
    operationId: 'triggerTrackingJobSync',
    summary: 'Trigger sync for a tracking job',
    description: 'Immediately polls the carrier for new events on the specified tracking job.',
    tags: ['ShipmentTracking'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Sync result',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                newEvents: { type: 'number' },
                shipmentsCreated: { type: 'number' },
                shipmentsUpdated: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
}

export async function POST(request: NextRequest) {
  const auth = await getAuthFromRequest(request)

  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = syncSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const commandBus = container.resolve('commandBus') as CommandBus

  const selectedOrgId = scope?.selectedId ?? auth.orgId
  const tenantId = auth.tenantId

  try {
    const { result } = await commandBus.execute<
      { jobId: string; tenantId: string; organizationId: string },
      { newEvents: number; shipmentsCreated: number; shipmentsUpdated: number }
    >('shipment_tracking.tracking.poll_single', {
      input: {
        jobId: parsed.data.id,
        tenantId,
        organizationId: selectedOrgId,
      },
      ctx: {
        container,
        auth,
        organizationScope: scope,
        selectedOrganizationId: selectedOrgId ?? null,
        organizationIds: scope?.filterIds ?? (selectedOrgId ? [selectedOrgId] : null),
        request,
      },
      metadata: {
        tenantId: tenantId ?? null,
        organizationId: selectedOrgId ?? null,
        resourceKind: 'shipment_tracking.tracking_job',
        resourceId: parsed.data.id,
      },
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[tracking-jobs/sync] error:', error)
    const message = error instanceof Error ? error.message : 'Failed to sync tracking job'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
