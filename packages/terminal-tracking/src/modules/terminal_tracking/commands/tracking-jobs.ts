import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { TerminalTrackingJob } from '../data/entities'
import type { TerminalTrackingService } from '../services/terminalTrackingService'
import { ensureTerminalPollSchedule } from '../lib/ensure-schedule'
import type {
  TrackingJobCreateInput,
  TrackingJobDeleteInput,
  TrackingJobPollInput,
} from '../data/validators'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) throw new Error('Tenant mismatch')
  if (!ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

const createTrackingJob: CommandHandler<TrackingJobCreateInput, { id: string; newEvents: number }> = {
  id: 'terminal_tracking.tracking_job.create',
  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)
    const service = ctx.container.resolve<TerminalTrackingService>('terminalTrackingService')
    const result = await service.createJob({
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      terminalCode: input.terminalCode,
      containerNumber: input.containerNumber,
      schedule: input.schedule ?? null,
    })
    // Self-heal the periodic poll schedule for orgs that predate the module.
    await ensureTerminalPollSchedule(ctx.container, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })
    return { id: result.trackingJobId, newEvents: result.newEvents }
  },
}

const deleteTrackingJob: CommandHandler<TrackingJobDeleteInput, { id: string }> = {
  id: 'terminal_tracking.tracking_job.delete',
  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const job = await em.findOne(TerminalTrackingJob, { id: input.id, deletedAt: null })
    if (!job) throw new Error('Terminal tracking job not found')
    ensureScope(ctx, job.tenantId, job.organizationId)
    job.deletedAt = new Date()
    job.status = 'deactivated'
    await em.flush()
    return { id: job.id }
  },
}

const pollTrackingJob: CommandHandler<TrackingJobPollInput, { newEvents: number }> = {
  id: 'terminal_tracking.tracking.poll_single',
  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const job = await em.findOne(TerminalTrackingJob, { id: input.jobId, deletedAt: null })
    if (!job) throw new Error('Terminal tracking job not found')
    ensureScope(ctx, job.tenantId, job.organizationId)
    const service = ctx.container.resolve<TerminalTrackingService>('terminalTrackingService')
    return service.pollJob(input.jobId)
  },
}

registerCommand(createTrackingJob)
registerCommand(deleteTrackingJob)
registerCommand(pollTrackingJob)
