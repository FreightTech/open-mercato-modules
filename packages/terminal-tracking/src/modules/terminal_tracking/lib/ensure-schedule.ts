import { createHash } from 'node:crypto'
import { terminalLogger } from './logger'

type SchedulerLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
  exists?: (scheduleId: string) => Promise<boolean>
}

type ResolveLike = { resolve: <T = unknown>(name: string) => T }

/**
 * Deterministic RFC 4122 (v5-style) uuid derived from a stable seed, so the same
 * (org, tenant) always maps to the same scheduled-job id. The scheduler upserts
 * by id (idempotent `register`), and consumers validate with `z.uuid()`, so the
 * version (nibble 13 = '5') and variant (nibble 17 = 8-b) bits must be set.
 */
function deterministicUuid(seed: string): string {
  const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32).split('')
  hex[12] = '5' // version 5
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) // variant 10xx -> 8..b
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

/**
 * Ensure the periodic "poll all" schedule exists for an org/tenant — create-only.
 *
 * The schedule is seeded with the module defaults the first time only. Once it
 * exists, this no-ops so user edits in the scheduler settings (cadence, enabled
 * state) are the source of truth and are never overwritten — `setup.ts` and the
 * config/job-save callers re-run this purely to self-heal orgs that predate the
 * module. Stays a single row thanks to the deterministic id. No-ops gracefully
 * when the optional scheduler module isn't installed.
 */
export async function ensureTerminalPollSchedule(
  container: ResolveLike,
  scope: { organizationId: string; tenantId: string },
): Promise<void> {
  let scheduler: SchedulerLike
  try {
    scheduler = container.resolve<SchedulerLike>('schedulerService')
  } catch {
    return // scheduler module not installed
  }
  if (!scheduler?.register) return

  const id = deterministicUuid(`terminal_tracking:poll_all:${scope.organizationId}:${scope.tenantId}`)

  // Create-only: never overwrite an existing schedule, so UI cadence/enabled edits win.
  // (`register` is a full upsert, so without this guard every config/job save would
  // revert the row to the defaults below.)
  try {
    if (scheduler.exists && (await scheduler.exists(id))) return
  } catch {
    // Existence check is best-effort; fall through to register on failure.
  }

  try {
    await scheduler.register({
      id,
      name: 'Terminal Tracking Poll',
      description:
        'Polls all active terminal tracking jobs every 4 hours. Change the cadence in the scheduler settings.',
      scopeType: 'organization',
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      scheduleType: 'cron',
      scheduleValue: '0 */4 * * *',
      timezone: 'UTC',
      targetType: 'command',
      targetCommand: 'terminal_tracking.tracking.poll_all',
      targetPayload: { tenantId: scope.tenantId, organizationId: scope.organizationId },
      sourceType: 'module',
      sourceModule: 'terminal_tracking',
      isEnabled: true,
    })
  } catch (err) {
    terminalLogger.warn('Failed to ensure terminal poll schedule', {
      organizationId: scope.organizationId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
