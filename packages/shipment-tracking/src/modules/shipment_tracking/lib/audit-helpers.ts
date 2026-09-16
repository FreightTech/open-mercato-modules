import type { EntityManager } from '@mikro-orm/postgresql'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'

/**
 * Get the user ID of who created a tracking job by querying audit logs.
 *
 * This is used for notifications where we need to notify the user who created
 * the tracking job, but the TrackingJob entity doesn't store createdByUserId.
 */
export async function getTrackingJobCreator(
  em: EntityManager,
  trackingJobId: string,
  tenantId: string,
): Promise<string | null> {
  const createLog = await em.findOne(
    ActionLog,
    {
      tenantId,
      resourceKind: 'shipment_tracking.tracking_job',
      resourceId: trackingJobId,
      commandId: 'shipment_tracking.tracking_job.create',
      executionState: 'done',
      deletedAt: null,
    },
    { orderBy: { createdAt: 'asc' } },
  )

  return createLog?.actorUserId ?? null
}
