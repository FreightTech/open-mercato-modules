import type { DocumentReference } from '../data/entities'

/**
 * Handles DCSA-compliant transport and equipment events and dispatches webhooks.
 * These are granular events like transport.departed, equipment.loaded, etc.
 */
export const metadata = {
  event: 'shipment_tracking.transport.*,shipment_tracking.equipment.*',
  persistent: true,
  id: 'shipment_tracking:dcsa-event-webhook-dispatch',
}

type DcsaEventPayload = {
  id: string
  shipmentId: string
  tenantId: string
  organizationId: string

  // Core event fields
  eventId: string
  eventType: string
  eventCode: string
  eventClassifierCode?: string | null
  eventDateTime?: string | null
  description?: string | null

  // Equipment fields
  equipmentReference?: string | null
  isoEquipmentCode?: string | null
  emptyIndicatorCode?: string | null
  isTransshipmentMove?: boolean | null

  // Location fields
  locationName?: string | null
  locationUnlocode?: string | null
  locationCountry?: string | null
  facilityCode?: string | null
  facilityTypeCode?: string | null

  // Transport call fields
  vesselName?: string | null
  vesselImo?: string | null
  voyageNumber?: string | null
  carrierServiceCode?: string | null
  modeOfTransport?: string | null

  // Document references
  relatedDocumentReferences?: DocumentReference[] | null

  // Metadata
  publisherName?: string | null
  publisherRole?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  eventName: string
}

export default async function handle(payload: DcsaEventPayload, ctx: ResolverContext) {
  try {
    const webhookService = ctx.resolve<any>('shipmentTrackingWebhookService')

    await webhookService.dispatchEvent({
      eventType: ctx.eventName,
      payload: {
        event: {
          // IDs
          id: payload.id,
          shipmentId: payload.shipmentId,

          // Core event fields
          eventType: payload.eventType,
          eventCode: payload.eventCode,
          eventClassifierCode: payload.eventClassifierCode,
          eventDateTime: payload.eventDateTime,
          description: payload.description,

          // Equipment fields (critical for multi-container bookings)
          equipmentReference: payload.equipmentReference,
          isoEquipmentCode: payload.isoEquipmentCode,
          emptyIndicatorCode: payload.emptyIndicatorCode,
          isTransshipmentMove: payload.isTransshipmentMove,

          // Location fields
          locationName: payload.locationName,
          locationUnlocode: payload.locationUnlocode,
          locationCountry: payload.locationCountry,
          facilityCode: payload.facilityCode,
          facilityTypeCode: payload.facilityTypeCode,

          // Transport call fields
          vesselName: payload.vesselName,
          vesselImo: payload.vesselImo,
          voyageNumber: payload.voyageNumber,
          carrierServiceCode: payload.carrierServiceCode,
          modeOfTransport: payload.modeOfTransport,

          // Document references
          relatedDocumentReferences: payload.relatedDocumentReferences,

          // Metadata
          publisherName: payload.publisherName,
          publisherRole: payload.publisherRole,
        },
      },
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })

    console.debug(`[shipment-tracking:dcsa-webhook] Dispatched ${ctx.eventName} for tracking event ${payload.id}`)
  } catch (error) {
    console.error(`[shipment-tracking:dcsa-webhook] Failed to dispatch ${ctx.eventName} webhook:`, error)
  }
}
