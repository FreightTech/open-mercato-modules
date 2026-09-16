import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus } from '@open-mercato/shared/lib/commands'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['shipment_tracking.webhooks.manage'] },
}

const testWebhookSchema = z.object({
  id: z.string().uuid(),
})

/**
 * POST: Send a test webhook delivery to verify the endpoint is working
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthFromRequest(request)

  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse request body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = testWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const commandBus = container.resolve('commandBus') as CommandBus

  const selectedOrgId = scope?.selectedId ?? auth.orgId
  const tenantId = auth.tenantId

  try {
    const { result } = await commandBus.execute<
      { id: string; tenantId: string; organizationId: string },
      { success: boolean; deliveryId: string }
    >('shipment_tracking.webhook.test', {
      input: {
        id: parsed.data.id,
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
        resourceKind: 'shipment_tracking.webhook',
        resourceId: parsed.data.id,
      },
    })

    return NextResponse.json({
      success: result.success,
      deliveryId: result.deliveryId,
    })
  } catch (error) {
    console.error('[webhooks/test] error:', error)
    const message = error instanceof Error ? error.message : 'Failed to send test webhook'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
