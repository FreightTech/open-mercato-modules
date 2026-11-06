/**
 * pollAllActiveJobs keeps one job's entities in memory at a time (tms-ft 2026-11-06: the 06:00 "poll all" over ~2,800
 * jobs held every job, shipment and event of the run in one EntityManager and took the queue worker to its 2 GB heap
 * limit after 29 minutes).
 *
 * The EntityManager here records what is managed: `find` adds the jobs, each poll adds that job's shipment and events,
 * and `clear` empties it. The test reads the high-water mark.
 */
import { vi } from 'vitest'
import type { EntityManager } from '@mikro-orm/postgresql'
import { TrackingService } from '../services/trackingService'
import { CarrierRegistryService } from '../services/carrierRegistry'

type Job = { id: string; carrierCode: string; tenantId: string; organizationId: string }

function setup(jobCount: number, opts: { failing?: Set<string> } = {}) {
  const jobs: Job[] = Array.from({ length: jobCount }, (_, i) => ({
    id: `job-${i}`,
    carrierCode: 'msc',
    tenantId: 't-1',
    organizationId: 'o-1',
  }))
  const managed = new Set<unknown>()
  let highWater = 0
  const track = (...entities: unknown[]) => {
    for (const e of entities) managed.add(e)
    highWater = Math.max(highWater, managed.size)
  }
  const em = {
    find: vi.fn(async () => {
      const found = jobs.map((j) => ({ ...j }))
      track(...found)
      return found
    }),
    clear: vi.fn(() => managed.clear()),
  } as unknown as EntityManager
  const emitted: string[] = []
  const service = new TrackingService({
    em: () => em,
    eventBus: { emit: vi.fn(async (event: string) => void emitted.push(event)) } as never,
    carrierRegistry: new CarrierRegistryService(),
    cacheService: { get: vi.fn(), set: vi.fn(), del: vi.fn() } as never,
    webhookService: {} as never,
  } as never)
  const polled: string[] = []
  // One poll loads its job, a shipment and 20 events into the same EntityManager, as pollTrackingJob does.
  vi.spyOn(service, 'pollTrackingJob').mockImplementation(async (jobId: string) => {
    polled.push(jobId)
    track({ job: jobId }, { shipment: jobId }, ...Array.from({ length: 20 }, (_, i) => ({ event: `${jobId}-${i}` })))
    if (opts.failing?.has(jobId)) throw new Error('carrier answered 503')
    return { newEvents: 20, shipmentsCreated: 1, shipmentsUpdated: 0 }
  })
  return { service, em, polled, emitted, highWater: () => highWater }
}

describe('pollAllActiveJobs memory (tms-ft 2026-11-06 queue worker OOM)', () => {
  it('polls every active job and holds at most one job’s entities at a time', async () => {
    const { service, em, polled, highWater } = setup(500)

    const result = await service.pollAllActiveJobs('t-1', 'o-1')

    expect(result).toEqual({ polled: 500, newEvents: 500 * 20, failed: 0 })
    expect(polled).toHaveLength(500)
    // The job list itself (500) is the peak; a poll adds 22 on an empty map. Before the fix: 500 + 500 × 22 = 11,500.
    expect(highWater()).toBeLessThanOrEqual(500)
    expect(em.clear).toHaveBeenCalledTimes(501)
  })

  it('a job that fails is reported and its entities are dropped too; the rest still run', async () => {
    const { service, polled, emitted, highWater } = setup(50, { failing: new Set(['job-3', 'job-40']) })

    const result = await service.pollAllActiveJobs('t-1')

    expect(result.failed).toBe(2)
    expect(result.polled).toBe(48)
    expect(polled).toHaveLength(50)
    expect(emitted.filter((e) => e === 'shipment_tracking.tracking_job.poll_failed')).toHaveLength(2)
    expect(highWater()).toBeLessThanOrEqual(50)
  })
})
