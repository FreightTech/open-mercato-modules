/**
 * Tracking Job Initial Poll Subscriber
 *
 * Triggers an immediate poll when a new tracking job is created.
 * This ensures the carrier API is queried right away instead of waiting
 * for the next scheduled poll interval.
 */

import type { TrackingService } from '../services/trackingService'

export const metadata = {
  event: 'shipment_tracking.tracking_job.created',
  persistent: false, // In-process, immediate execution
  id: 'shipment_tracking:tracking-job-initial-poll',
}

type TrackingJobCreatedPayload = {
  id: string
  carrierCode: string
  referenceType: string
  referenceValue: string
  tenantId: string
  organizationId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: TrackingJobCreatedPayload, ctx: ResolverContext) {
  const trackingService = ctx.resolve<TrackingService>('shipmentTrackingService')

  console.log('[shipment-tracking] Triggering initial poll for new tracking job:', {
    jobId: payload.id,
    carrierCode: payload.carrierCode,
    reference: `${payload.referenceType}:${payload.referenceValue}`,
  })

  try {
    const result = await trackingService.pollTrackingJob(payload.id)

    console.log('[shipment-tracking] Initial poll completed:', {
      jobId: payload.id,
      newEvents: result.newEvents,
      shipmentsCreated: result.shipmentsCreated,
      shipmentsUpdated: result.shipmentsUpdated,
    })
  } catch (error) {
    // Log error but don't rethrow - the job is created and will be polled on schedule
    // Errors are already recorded in the job's errorHistory by pollTrackingJob
    console.error('[shipment-tracking] Initial poll failed for job:', payload.id, error)
  }
}
