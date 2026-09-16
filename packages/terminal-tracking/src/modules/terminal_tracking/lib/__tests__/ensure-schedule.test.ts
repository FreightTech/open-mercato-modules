import { describe, it, expect, vi } from 'vitest'
import { ensureTerminalPollSchedule } from '../ensure-schedule'

const scope = {
  organizationId: '942dbb1e-ff24-430b-bd9b-af1aed4d28e9',
  tenantId: '60e4e4d2-5765-40c2-9075-33a1a2aed068',
}

function makeContainer(scheduler: unknown) {
  return {
    resolve: <T = unknown>(_name: string) => scheduler as T,
  }
}

describe('ensureTerminalPollSchedule (create-only)', () => {
  it('does not register when the schedule already exists (preserves UI edits)', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    const exists = vi.fn().mockResolvedValue(true)

    await ensureTerminalPollSchedule(makeContainer({ register, exists }), scope)

    expect(exists).toHaveBeenCalledTimes(1)
    expect(register).not.toHaveBeenCalled()
  })

  it('registers with module defaults when the schedule is missing', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    const exists = vi.fn().mockResolvedValue(false)

    await ensureTerminalPollSchedule(makeContainer({ register, exists }), scope)

    expect(register).toHaveBeenCalledTimes(1)
    const reg = register.mock.calls[0][0] as Record<string, unknown>
    // Same id is passed to exists() and register() so the guard is reliable.
    expect(reg.id).toBe(exists.mock.calls[0][0])
    expect(reg.scheduleType).toBe('cron')
    expect(reg.scheduleValue).toBe('0 */4 * * *')
    expect(reg.targetCommand).toBe('terminal_tracking.tracking.poll_all')
  })

  it('falls back to register when the existence check throws', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    const exists = vi.fn().mockRejectedValue(new Error('boom'))

    await ensureTerminalPollSchedule(makeContainer({ register, exists }), scope)

    expect(register).toHaveBeenCalledTimes(1)
  })

  it('registers when the scheduler has no exists() method (older scheduler)', async () => {
    const register = vi.fn().mockResolvedValue(undefined)

    await ensureTerminalPollSchedule(makeContainer({ register }), scope)

    expect(register).toHaveBeenCalledTimes(1)
  })

  it('no-ops when the scheduler module is not installed', async () => {
    const container = {
      resolve: () => {
        throw new Error('not registered')
      },
    }

    await expect(ensureTerminalPollSchedule(container, scope)).resolves.toBeUndefined()
  })
})
