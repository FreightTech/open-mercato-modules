import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

type SchedulerServiceType = {
  register: (registration: {
    name: string
    description?: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue' | 'command'
    targetQueue?: string
    targetCommand?: string
    targetPayload?: unknown
    sourceType?: 'user' | 'module'
    sourceModule?: string
    isEnabled?: boolean
  }) => Promise<void>
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['shipment_tracking.*'],
    employee: [
      'shipment_tracking.shipments.view',
      'shipment_tracking.tracking_jobs.view',
      'shipment_tracking.carrier_configs.view',
      'shipment_tracking.shipsgo_config.view',
      'shipment_tracking.webhooks.view',
      'shipment_tracking.location_overrides.view',
    ],
  },

  seedDefaults: async (ctx) => {
    // Register scheduled jobs for this organization
    // The scheduler service may not be available in all installations
    try {
      const schedulerService = ctx.container.resolve<SchedulerServiceType>('schedulerService')

      // Register daily poll schedule
      await schedulerService.register({
        name: 'Daily Shipment Tracking Poll',
        description:
          'Polls all active tracking jobs for carrier updates every day at 6:00 AM UTC. You can change the schedule time in the scheduler settings.',
        scopeType: 'organization',
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        scheduleType: 'cron',
        scheduleValue: '0 6 * * *', // 6:00 AM UTC daily
        timezone: 'UTC',
        targetType: 'command',
        targetCommand: 'shipment_tracking.tracking.poll_all',
        targetPayload: {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
        },
        sourceType: 'module',
        sourceModule: 'shipment_tracking',
        isEnabled: true,
      })
      console.log(
        `[shipment-tracking] Registered daily poll schedule for org ${ctx.organizationId}`,
      )

      // Register PRE_ARRIVAL evaluation schedule
      // Runs every 6 hours to check IN_TRANSIT shipments approaching destination
      await schedulerService.register({
        name: 'Pre-Arrival Status Evaluation',
        description:
          'Checks IN_TRANSIT shipments every 6 hours and upgrades them to PRE_ARRIVAL when ETA is within 7 days.',
        scopeType: 'organization',
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        scheduleType: 'cron',
        scheduleValue: '0 */6 * * *', // Every 6 hours
        timezone: 'UTC',
        targetType: 'command',
        targetCommand: 'shipment_tracking.tracking.evaluate_pre_arrival',
        targetPayload: {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
        },
        sourceType: 'module',
        sourceModule: 'shipment_tracking',
        isEnabled: true,
      })
      console.log(
        `[shipment-tracking] Registered pre-arrival evaluation schedule for org ${ctx.organizationId}`,
      )
    } catch (error) {
      // Scheduler module may not be installed - this is fine
      console.debug('[shipment-tracking] Scheduler service not available, skipping schedule registration')
    }
  },
}

export default setup
