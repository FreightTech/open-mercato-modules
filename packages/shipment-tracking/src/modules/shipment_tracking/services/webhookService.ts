import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Shipment, TrackingEvent, TrackingJob, Webhook, WebhookDelivery } from '../data/entities'
import { dispatchWebhook } from '../lib/webhook-dispatcher'
import { sleep } from '../lib/background'

type WebhookServiceDeps = {
  em: () => EntityManager
  eventBus: EventBus
}

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] // 5s, 30s, 2min
const MAX_RETRIES = 3

/**
 * Builds a full shipment payload including tracking events for webhook dispatch.
 * Includes all DCSA T&T v3.0 fields.
 * Timestamps are provided as multi-source arrays; consumers compute primary via "latest updatedAt wins".
 */
function buildShipmentPayload(shipment: Shipment, trackingEvents: TrackingEvent[]): Record<string, unknown> {
  // Get current location from latest tracking event (derived at query time)
  const latestEvent = trackingEvents.length > 0 ? trackingEvents[trackingEvents.length - 1] : null

  return {
    id: shipment.id,
    status: shipment.status,
    carrierCode: shipment.carrierCode,
    containerNumber: shipment.containerNumber,
    isoEquipmentCode: shipment.isoEquipmentCode,
    bookingNumber: shipment.bookingNumber,
    bolNumber: shipment.bolNumber,
    // Multi-source timestamp arrays (consumers compute primary via "latest updatedAt wins")
    etdTimestamps: shipment.etdTimestamps,
    etaTimestamps: shipment.etaTimestamps,
    atdTimestamps: shipment.atdTimestamps,
    ataTimestamps: shipment.ataTimestamps,
    // Origin/destination (rich JSONB location data)
    originLocation: shipment.originLocation,
    destinationLocation: shipment.destinationLocation,
    // Current location derived from latest event
    currentLocationName: latestEvent?.locationName ?? null,
    currentLocationUnlocode: latestEvent?.locationUnlocode ?? null,
    // Vessel info
    vesselName: shipment.vesselName,
    vesselImo: shipment.vesselImo,
    voyageNumber: shipment.voyageNumber,
    eventCount: shipment.eventCount,
    lastEventAt: shipment.lastEventAt?.toISOString() ?? null,
    extra: shipment.extra,
    createdAt: shipment.createdAt?.toISOString() ?? null,
    updatedAt: shipment.updatedAt?.toISOString() ?? null,
    trackingEvents: trackingEvents.map((event) => ({
      // Event source
      id: event.id,
      source: event.source,
      sourceEventId: event.sourceEventId,

      // Core event fields
      eventType: event.eventType,
      eventCode: event.eventCode,
      eventClassifierCode: event.eventClassifierCode,
      eventDateTime: event.eventDateTime?.toISOString() ?? null,
      eventDateTimeOffset: event.eventDateTimeOffset,
      description: event.description,

      // Equipment fields (DCSA EQUIPMENT events)
      equipmentReference: event.equipmentReference,
      isoEquipmentCode: event.isoEquipmentCode,
      emptyIndicatorCode: event.emptyIndicatorCode,
      isTransshipmentMove: event.isTransshipmentMove,

      // Location fields
      locationName: event.locationName,
      locationUnlocode: event.locationUnlocode,
      locationCountry: event.locationCountry,
      facilityCode: event.facilityCode,
      facilityCodeListProvider: event.facilityCodeListProvider,
      facilityTypeCode: event.facilityTypeCode,
      latitude: event.latitude,
      longitude: event.longitude,

      // Transport call fields
      transportCallReference: event.transportCallReference,
      modeOfTransport: event.modeOfTransport,
      vesselName: event.vesselName,
      vesselImo: event.vesselImo,
      voyageNumber: event.voyageNumber,
      carrierServiceCode: event.carrierServiceCode,
      carrierExportVoyageNumber: event.carrierExportVoyageNumber,
      carrierImportVoyageNumber: event.carrierImportVoyageNumber,
      universalServiceReference: event.universalServiceReference,
      universalExportVoyageReference: event.universalExportVoyageReference,
      universalImportVoyageReference: event.universalImportVoyageReference,
      portVisitReference: event.portVisitReference,

      // Document references
      relatedDocumentReferences: event.relatedDocumentReferences,

      // Metadata fields
      eventCreatedDateTime: event.eventCreatedDateTime?.toISOString() ?? null,
      retractedEventId: event.retractedEventId,
      publisherName: event.publisherName,
      publisherRole: event.publisherRole,

      // Additional fields
      delayReasonCode: event.delayReasonCode,
      changeRemark: event.changeRemark,
      seals: event.seals,

      // Timestamps
      createdAt: event.createdAt?.toISOString() ?? null,
    })),
  }
}

/**
 * WebhookService handles finding matching webhooks and dispatching them
 * with full shipment data and retry logic.
 */
export class WebhookService {
  private deps: WebhookServiceDeps

  constructor(deps: WebhookServiceDeps) {
    this.deps = deps
  }

  /**
   * Builds the full shipment payload including tracking events.
   * Events are fetched from the TrackingJob associated with the shipment.
   */
  async buildFullShipmentPayload(shipmentId: string): Promise<Record<string, unknown> | null> {
    const em = this.deps.em()

    const shipment = await em.findOne(Shipment, { id: shipmentId, deletedAt: null }, { populate: ['trackingJob'] })
    if (!shipment) {
      return null
    }

    // If shipment has a tracking job, get events filtered for this container
    let trackingEvents: TrackingEvent[] = []
    if (shipment.trackingJob) {
      const allEvents = await em.find(
        TrackingEvent,
        { trackingJob: shipment.trackingJob },
        { orderBy: { eventDateTime: 'asc' } },
      )
      // Filter events for this specific container
      // Include TRANSPORT events (no equipmentReference) and EQUIPMENT events matching this container
      trackingEvents = allEvents.filter((event) => {
        if (event.eventType === 'TRANSPORT') return true
        if (event.eventType === 'EQUIPMENT') {
          return event.equipmentReference === shipment.containerNumber
        }
        return false
      })
    }

    return buildShipmentPayload(shipment, trackingEvents)
  }

  /**
   * Dispatches webhooks for a shipment event with full data and retry logic.
   *
   * @param input.eventType - The event type (e.g., 'shipment.created', 'shipment.tracking_update')
   * @param input.shipmentPayload - Full shipment data including cargo events
   * @param input.tenantId - Tenant ID for finding matching webhooks
   * @param input.organizationId - Organization ID for finding matching webhooks
   * @returns Number of webhooks successfully dispatched
   */
  async dispatchWithRetry(input: {
    eventType: string
    shipmentPayload: Record<string, unknown>
    tenantId: string
    organizationId: string
  }): Promise<{ success: boolean; dispatched: number; failed: number }> {
    const em = this.deps.em()

    // Find matching webhooks
    const webhooks = await findWithDecryption(
      em,
      Webhook,
      {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        isActive: true,
      },
      undefined,
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )

    // Filter to webhooks subscribed to this event type
    const matching = webhooks.filter((webhook) => {
      return webhook.eventsSubscribed.some((pattern) => {
        // Exact match
        if (pattern === input.eventType) return true
        // Global wildcard
        if (pattern === '*') return true
        // Module wildcard (e.g., 'shipment_tracking.*' matches 'shipment_tracking.shipment.created')
        if (pattern.endsWith('.*')) {
          const prefix = pattern.slice(0, -2)
          if (input.eventType.startsWith(prefix + '.')) return true
        }
        // Entity wildcard (e.g., 'shipment_tracking.shipment.*' matches 'shipment_tracking.shipment.created')
        if (pattern.endsWith('.*')) {
          const prefix = pattern.slice(0, -1)
          if (input.eventType.startsWith(prefix)) return true
        }
        return false
      })
    })

    if (matching.length === 0) {
      console.debug('[shipment-tracking:webhook] No matching webhooks found for event:', input.eventType, {
        totalWebhooks: webhooks.length,
        webhookPatterns: webhooks.map((w) => w.eventsSubscribed),
      })
      return { success: true, dispatched: 0, failed: 0 }
    }

    console.log('[shipment-tracking:webhook] Dispatching to', matching.length, 'webhooks for event:', input.eventType)

    let dispatched = 0
    let failed = 0

    const fullPayload = {
      type: input.eventType,
      timestamp: new Date().toISOString(),
      ...input.shipmentPayload,
    }

    for (const webhook of matching) {
      const result = await this.dispatchSingleWebhook(em, webhook, fullPayload, input.eventType)
      if (result.success) {
        dispatched++
      } else {
        failed++
      }
    }

    return {
      success: failed === 0,
      dispatched,
      failed,
    }
  }

  /**
   * Dispatches a single webhook with retry logic.
   * Records delivery attempts in the WebhookDelivery table for audit.
   */
  private async dispatchSingleWebhook(
    em: EntityManager,
    webhook: Webhook,
    payload: Record<string, unknown>,
    eventType: string,
  ): Promise<{ success: boolean }> {
    // Create delivery record for audit
    // Use getReference to create a managed reference since webhook may be detached after decryption
    const delivery = em.create(WebhookDelivery, {
      webhook: em.getReference(Webhook, webhook.id),
      eventType,
      status: 'pending',
      payload,
      retryCount: 0,
    })
    em.persist(delivery)
    await em.flush()

    let lastResult: Awaited<ReturnType<typeof dispatchWebhook>> | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      lastResult = await dispatchWebhook({
        url: webhook.url,
        payload,
        hmacSecret: webhook.hmacSecret,
      })

      if (lastResult.success) {
        // Success - update delivery record
        delivery.status = 'success'
        delivery.responseStatus = lastResult.responseStatus ?? null
        delivery.responseBody = lastResult.responseBody ?? null
        delivery.retryCount = attempt
        await em.flush()

        // Emit success event for monitoring
        await this.deps.eventBus.emit('shipment_tracking.webhook.delivery_success', {
          deliveryId: delivery.id,
          webhookId: webhook.id,
          eventType,
          responseStatus: lastResult.responseStatus,
        })

        return { success: true }
      }

      // Failed - update delivery record with error
      delivery.responseStatus = lastResult.responseStatus ?? null
      delivery.responseBody = lastResult.responseBody ?? null
      delivery.errorMessage = lastResult.errorMessage ?? null
      delivery.retryCount = attempt + 1

      if (attempt < MAX_RETRIES) {
        // Wait before retry
        const delayMs = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
        await sleep(delayMs)
      }
    }

    // All retries exhausted
    delivery.status = 'failed'
    await em.flush()

    // Emit failure event for monitoring
    await this.deps.eventBus.emit('shipment_tracking.webhook.delivery_failed', {
      deliveryId: delivery.id,
      webhookId: webhook.id,
      eventType,
      retryCount: delivery.retryCount,
      lastError: lastResult?.errorMessage ?? 'Unknown error',
    })

    return { success: false }
  }

  /**
   * Legacy method for backwards compatibility with existing subscribers.
   * Finds matching webhooks and dispatches them (used by kept subscribers).
   *
   * @deprecated Use dispatchWithRetry() for new code
   */
  async dispatchEvent(input: {
    eventType: string
    payload: Record<string, unknown>
    tenantId: string
    organizationId: string
  }): Promise<number> {
    const result = await this.dispatchWithRetry({
      eventType: input.eventType,
      shipmentPayload: input.payload,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    return result.dispatched
  }
}
