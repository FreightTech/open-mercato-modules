/**
 * POI Event Notification Subscriber
 *
 * Subscribes to per-tracking-job POI proximity events and creates in-app
 * notifications for the user who created the tracking job.
 *
 * These events are emitted once per tracking job (BOL/Booking), not per
 * shipment (container), so no deduplication is needed.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import type { ProximityEventType } from '../lib/poi-types'
import { getTrackingJobCreator } from '../lib/audit-helpers'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'shipment_tracking.tracking_job.poi.*',
  persistent: true,
  id: 'shipment_tracking:tracking-job-poi-notification',
}

type TrackingJobPoiEventPayload = {
  trackingJobId: string
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
  containerNumber?: string | null
  bookingNumber?: string | null
  bolNumber?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Map POI event types to per-job notification type identifiers.
 */
function mapEventTypeToNotificationType(eventType: ProximityEventType): string {
  const map: Record<ProximityEventType, string> = {
    PORT_ARRIVAL: 'shipment_tracking.tracking_job.poi.port_arrival',
    PORT_PROXIMITY_ARRIVAL: 'shipment_tracking.tracking_job.poi.port_proximity_arrival',
    PORT_PROXIMITY_DEPARTURE: 'shipment_tracking.tracking_job.poi.port_departure',
    TERMINAL_ARRIVAL: 'shipment_tracking.tracking_job.poi.terminal_arrival',
    TERMINAL_PROXIMITY_ARRIVAL: 'shipment_tracking.tracking_job.poi.terminal_proximity_arrival',
    TERMINAL_PROXIMITY_DEPARTURE: 'shipment_tracking.tracking_job.poi.terminal_departure',
    WAYPOINT_REACHED: 'shipment_tracking.tracking_job.poi.waypoint_reached',
  }
  return map[eventType]
}

/**
 * Build a reference info string for the notification body.
 * Shows the booking number, BOL number, or container number.
 *
 * Format: "Booking BOOK123" or "BOL 12345" or "Container MSCU1234567"
 */
function buildReferenceInfo(
  bookingNumber: string | null | undefined,
  bolNumber: string | null | undefined,
  containerNumber: string | null | undefined
): string {
  if (bookingNumber) {
    return `Booking ${bookingNumber}`
  }
  if (bolNumber) {
    return `BOL ${bolNumber}`
  }
  if (containerNumber) {
    return `Container ${containerNumber}`
  }
  return 'Shipment'
}

export default async function handle(payload: TrackingJobPoiEventPayload, ctx: ResolverContext) {
  try {
    const em = ctx.resolve<EntityManager>('em')

    // Get the creator of the tracking job from audit logs
    const creatorUserId = await getTrackingJobCreator(em, payload.trackingJobId, payload.tenantId)

    if (!creatorUserId) {
      console.info(
        `[poi-notification] Skipping notification - no creator found for tracking job ${payload.trackingJobId}`
      )
      return
    }

    // Find the notification type definition
    const notificationType = mapEventTypeToNotificationType(payload.eventType)
    const typeDef = notificationTypes.find((t) => t.type === notificationType)

    if (!typeDef) {
      console.warn(`[poi-notification] No notification type found for event: ${payload.eventType}`)
      return
    }

    // Build reference info string (e.g., "Booking BOOK123")
    const referenceInfo = buildReferenceInfo(
      payload.bookingNumber,
      payload.bolNumber,
      payload.containerNumber
    )

    // Build notification input
    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: creatorUserId,
      bodyVariables: {
        vesselName: payload.vesselName,
        location: payload.poiCode ?? 'unknown location',
        referenceInfo,
      },
      sourceEntityType: 'shipment_tracking:shipment',
      sourceEntityId: payload.shipmentId,
      linkHref: `/backend/shipment-tracking?shipment=${payload.shipmentId}`,
    })

    // Create the notification
    const notificationService = resolveNotificationService(ctx)
    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })

    console.info(
      `[poi-notification] Created notification for tracking job ${payload.trackingJobId} ` +
        `(event: ${payload.eventType}, recipient: ${creatorUserId}, ref: ${referenceInfo})`
    )
  } catch (error) {
    console.error('[poi-notification] Failed to process POI event notification:', error)
  }
}
