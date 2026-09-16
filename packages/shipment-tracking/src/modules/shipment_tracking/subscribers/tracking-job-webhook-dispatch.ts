/**
 * Tracking Job Event Handler
 *
 * NOTE: As of DCSA T&T compliance update, tracking_job events are marked as
 * internal events (excludeFromTriggers: true) and are NOT dispatched to
 * external webhooks. These events are for internal system monitoring only.
 *
 * This subscriber remains for internal audit logging but does not dispatch
 * webhooks to external consumers. External consumers should subscribe to
 * DCSA-compliant events like:
 * - shipment_tracking.transport.* (departed, arrived, eta_updated, etc.)
 * - shipment_tracking.equipment.* (loaded, discharged, gate_in, etc.)
 * - shipment_tracking.shipment.* (created, updated, status_changed, etc.)
 */

export const metadata = {
  event: 'shipment_tracking.tracking_job.*',
  persistent: true,
  id: 'shipment_tracking:tracking-job-webhook-dispatch',
}

type TrackingJobEventPayload = {
  id: string
  shipmentId?: string
  carrierCode?: string
  tenantId: string
  organizationId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  eventName: string
}

export default async function handle(payload: TrackingJobEventPayload, ctx: ResolverContext) {
  // Extract the action from the event name (e.g., "created", "updated", "failed")
  const eventParts = ctx.eventName.split('.')
  const action = eventParts[eventParts.length - 1]

  // Internal logging only - no webhook dispatch for tracking_job events
  // These are internal system events per DCSA compliance requirements
  console.debug(`[shipment-tracking:internal] Tracking job event: ${action}`, {
    jobId: payload.id,
    shipmentId: payload.shipmentId,
    carrierCode: payload.carrierCode,
  })

  // NOTE: Webhook dispatch removed - tracking_job events are internal only
  // External consumers should subscribe to DCSA-compliant transport/equipment events
}
