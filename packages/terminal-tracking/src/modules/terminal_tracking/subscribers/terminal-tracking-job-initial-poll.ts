import type { TerminalTrackingService } from '../services/terminalTrackingService'
import { terminalLogger } from '../lib/logger'

export const metadata = {
  event: 'terminal_tracking.tracking_job.created',
  persistent: false,
  id: 'terminal_tracking:tracking-job-initial-poll',
}

type Payload = {
  id: string
  terminalCode: string
  containerNumber: string
  tenantId: string
  organizationId: string
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

export default async function handle(payload: Payload, ctx: ResolverContext) {
  // createJob already polls inline; this subscriber is a safety net for jobs
  // created through other paths. It is idempotent thanks to event dedup.
  const service = ctx.resolve<TerminalTrackingService>('terminalTrackingService')
  try {
    await service.pollJob(payload.id)
  } catch (err) {
    terminalLogger.error('Initial poll failed', {
      jobId: payload.id,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
