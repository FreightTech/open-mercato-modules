import type { DocumentReference } from '../data/entities'

export const metadata = {
  event: 'shipment_tracking.tracking_event.created',
  persistent: true,
  id: 'shipment_tracking:tracking-event-created',
}

type TrackingEventCreatedPayload = {
  id: string
  trackingJobId: string
  tenantId: string
  organizationId: string

  // Event source
  source: string
  sourceEventId?: string | null

  // Core event fields
  eventType: string
  eventCode: string
  eventClassifierCode?: string | null
  eventDateTime?: string | null
  description?: string | null

  // Equipment fields (critical for multi-container bookings)
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
}

export default async function handle(payload: TrackingEventCreatedPayload, ctx: ResolverContext) {
  try {
    const webhookService = ctx.resolve<any>('shipmentTrackingWebhookService')

    await webhookService.dispatchEvent({
      eventType: 'shipment_tracking.tracking_event.created',
      payload: {
        event: {
          // IDs
          id: payload.id,
          trackingJobId: payload.trackingJobId,

          // Event source
          source: payload.source,
          sourceEventId: payload.sourceEventId,

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
  } catch (error) {
    console.error('[shipment-tracking:subscriber] Failed to dispatch tracking_event.created webhook:', error)
  }
}
