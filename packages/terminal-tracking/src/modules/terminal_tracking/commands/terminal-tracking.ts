import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { TerminalTrackingService } from '../services/terminalTrackingService'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId?: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) throw new Error('Tenant mismatch')
  if (organizationId && !ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

type PollAllInput = { tenantId: string; organizationId?: string }
type PollAllResult = { polled: number; newEvents: number; failed: number }

const pollAllActiveJobs: CommandHandler<PollAllInput, PollAllResult> = {
  id: 'terminal_tracking.tracking.poll_all',
  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)
    const service = ctx.container.resolve<TerminalTrackingService>('terminalTrackingService')
    return service.pollAllActiveJobs(input.tenantId, input.organizationId)
  },
  buildLog({ result, input }) {
    return {
      actionLabel: 'Poll all terminal tracking jobs',
      resourceKind: 'terminal_tracking.tracking',
      resourceId: input.organizationId ?? input.tenantId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      details: { polled: result.polled, newEvents: result.newEvents, failed: result.failed },
    }
  },
}

registerCommand(pollAllActiveJobs)
