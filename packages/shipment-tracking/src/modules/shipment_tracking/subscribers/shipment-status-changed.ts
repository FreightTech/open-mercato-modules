import type { WebhookService } from '../services/webhookService'

export const metadata = {
  event: 'shipment_tracking.shipment.status_changed',
  persistent: true,
  id: 'shipment_tracking:shipment-status-changed',
}

type StatusChangedPayload = {
  id: string
  previousStatus: string
  newStatus: string
  tenantId: string
  organizationId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: StatusChangedPayload, ctx: ResolverContext) {
  try {
    const webhookService = ctx.resolve<WebhookService>('shipmentTrackingWebhookService')

    // Build full shipment payload to include in the webhook
    const shipmentData = await webhookService.buildFullShipmentPayload(payload.id)

    await webhookService.dispatchEvent({
      eventType: 'shipment_tracking.shipment.status_changed',
      payload: {
        previousStatus: payload.previousStatus,
        newStatus: payload.newStatus,
        shipment: shipmentData,
      },
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  } catch (error) {
    console.error('[shipment-tracking:subscriber] Failed to dispatch status_changed webhook:', error)
  }
}
