/**
 * POI Event Webhook Dispatcher
 *
 * Handles POI proximity events and dispatches webhooks to registered endpoints.
 */

import type { ProximityEventType } from '../lib/poi-types'

export const metadata = {
  event: 'shipment_tracking.poi.*',
  persistent: true,
  id: 'shipment_tracking:poi-event-webhook-dispatch',
}

type PoiEventPayload = {
  shipmentId: string
  trackingEventId: string
  organizationId: string
  tenantId: string
  vesselName: string
  vesselMmsi: number
  vesselImo: string | null
  eventType: ProximityEventType
  poiCode: string | null
  latitude: number
  longitude: number
  eventDateTime: string
  distanceToPoiMeters: number | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  eventName: string
}

type WebhookService = {
  dispatchEvent: (params: {
    eventType: string
    payload: unknown
    tenantId: string
    organizationId: string
  }) => Promise<void>
}

export default async function handle(payload: PoiEventPayload, ctx: ResolverContext) {
  try {
    const webhookService = ctx.resolve<WebhookService | undefined>('shipmentTrackingWebhookService')

    if (!webhookService) {
      console.debug('[shipment-tracking:poi-webhook] WebhookService not available, skipping dispatch')
      return
    }

    await webhookService.dispatchEvent({
      eventType: ctx.eventName,
      payload: {
        event: {
          // IDs
          trackingEventId: payload.trackingEventId,
          shipmentId: payload.shipmentId,

          // Event type
          eventType: payload.eventType,
          eventDateTime: payload.eventDateTime,

          // Vessel info
          vesselName: payload.vesselName,
          vesselMmsi: payload.vesselMmsi,
          vesselImo: payload.vesselImo,

          // Location info
          poiCode: payload.poiCode,
          latitude: payload.latitude,
          longitude: payload.longitude,
          distanceToPoiMeters: payload.distanceToPoiMeters,

          // Source identifier
          source: 'ais',
        },
      },
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })

    console.debug(
      `[shipment-tracking:poi-webhook] Dispatched ${ctx.eventName} for shipment ${payload.shipmentId}`
    )
  } catch (error) {
    console.error(
      `[shipment-tracking:poi-webhook] Failed to dispatch ${ctx.eventName} webhook:`,
      error
    )
  }
}
