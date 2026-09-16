import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureTerminalPollSchedule } from './lib/ensure-schedule'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['terminal_tracking.*'],
    employee: [
      'terminal_tracking.terminal_configs.view',
      'terminal_tracking.tracking_jobs.view',
      'terminal_tracking.events.view',
    ],
  },

  seedDefaults: async (ctx) => {
    // Register the periodic poll schedule at org onboarding. Config/job saves
    // re-ensure it for orgs that predate the module (see ensureTerminalPollSchedule).
    await ensureTerminalPollSchedule(ctx.container, {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
    })
  },
}

export default setup
