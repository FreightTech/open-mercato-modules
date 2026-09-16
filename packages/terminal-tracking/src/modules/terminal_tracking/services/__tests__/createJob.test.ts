import { describe, it, expect, vi } from 'vitest'
import { TerminalTrackingService } from '../terminalTrackingService'

const INPUT = {
  organizationId: 'org-1',
  tenantId: 'ten-1',
  terminalCode: 'bct',
  containerNumber: 'GCXU5598460',
}

// Mock em whose findOne respects the reuse query's status filter, simulating a
// DB that holds exactly one job for this container in `dbJob.status`.
function makeService(dbJob: { id: string; status: string } | null) {
  const fork = {
    findOne: vi.fn(async (_entity: any, where: any) => {
      const statuses: string[] = where?.status?.$in ?? []
      return dbJob && statuses.includes(dbJob.status) ? dbJob : null
    }),
    create: vi.fn((_entity: any, data: any) => ({ id: 'new-job', ...data })),
    flush: vi.fn(async () => {}),
  }
  const em = { fork: () => fork }
  const eventBus = { emit: vi.fn(async () => {}) }
  const service = new TerminalTrackingService({
    em: () => em as never,
    eventBus: eventBus as never,
    terminalRegistry: { get: () => undefined } as never,
    cacheService: { get: async () => null, set: async () => {} } as never,
  })
  return { service, fork, eventBus }
}

describe('createJob reuse', () => {
  it('creates a NEW job when the same container only has a completed job (returns later)', async () => {
    const { service, fork, eventBus } = makeService({ id: 'old-job', status: 'completed' })
    const poll = vi.spyOn(service, 'pollJob')

    const res = await service.createJob(INPUT as never)

    expect(poll).not.toHaveBeenCalled() // not revived
    expect(fork.create).toHaveBeenCalledTimes(1) // fresh job
    expect(res.trackingJobId).toBe('new-job')
    expect(eventBus.emit).toHaveBeenCalledWith(
      'terminal_tracking.tracking_job.created',
      expect.any(Object),
    )
  })

  it('reuses an existing active job (no duplicate in-flight track)', async () => {
    const { service, fork } = makeService({ id: 'old-job', status: 'active' })
    const poll = vi.spyOn(service, 'pollJob').mockResolvedValue({ newEvents: 0, updatedEvents: 0 })

    const res = await service.createJob(INPUT as never)

    expect(poll).toHaveBeenCalledWith('old-job')
    expect(fork.create).not.toHaveBeenCalled()
    expect(res.trackingJobId).toBe('old-job')
  })
})
