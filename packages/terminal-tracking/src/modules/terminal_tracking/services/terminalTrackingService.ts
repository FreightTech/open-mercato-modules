import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { TerminalConfig, TerminalTrackingJob, TerminalEvent, TerminalVesselVisit } from '../data/entities'
import type { ResolvedTerminalConfig, TerminalFetchedEvent, TerminalAdapter } from '../lib/terminal-adapter'
import type { TerminalRegistry } from './terminalRegistry'
import { checkRateLimit, type CacheService } from '../lib/rate-limiter'
import { semanticEventIdFor, pickVesselVisit, parseCargoCategory } from '../lib/adapters/n4/n4-semantics'
import { impedimentsChanged, isEmptyReady, isImportHoldsCleared } from '../lib/availability'
import { parseTerminalStops, stopsChanged, type TerminalStops } from '../lib/stops'
import { terminalLogger } from '../lib/logger'

/** Default TTL for a cached /VESSEL visit lookup. Vessel ETA/ATA move on the
 * scale of hours and the shared rate bucket is mostly spent on /unit polls, so
 * one hour balances freshness against token spend. */
const DEFAULT_VESSEL_CACHE_TTL_SECONDS = 3600

/** Max containers per /unit request. N4 accepts a comma-separated UNIT_NBR list
 * (the terminal supports up to ~500); we cap lower to bound URL/response size
 * and keep each batch to a single rate-limit token. */
const MAX_CONTAINERS_PER_UNIT_REQUEST = 100

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** A container's terminal lifecycle is complete when this poll returned events
 * and every current leg has departed (`DEPA`). Empty results are NOT departed
 * (container not found / unmapped states) — keep polling. */
function isFullyDeparted(events: TerminalFetchedEvent[]): boolean {
  return events.length > 0 && events.every((e) => e.eventCode === 'DEPA')
}

type Deps = {
  em: () => EntityManager
  eventBus: EventBus
  terminalRegistry: TerminalRegistry
  cacheService: CacheService
}

const MAX_ERROR_HISTORY = 20
const MAX_RETRIES = 10

export type CreateJobInput = {
  organizationId: string
  tenantId: string
  terminalCode: string
  containerNumber: string
  schedule?: string[] | null
}

export type PollJobResult = { newEvents: number; updatedEvents: number }
export type PollAllResult = { polled: number; newEvents: number; updatedEvents: number; failed: number }

type EventLike = Pick<
  TerminalEvent,
  | 'eventClassifierCode'
  | 'eventDateTime'
  | 'transitState'
  | 'visitState'
  | 'facilityCode'
  | 'facilityCodeListProvider'
  | 'unlocode'
  | 'visitRefIn'
  | 'visitRefOut'
  | 'vesselName'
  | 'voyageNumber'
  | 'modeOfTransport'
  | 'seals'
  | 'vgmWeightKg'
  | 'impediments'
  | 'loadedAt'
>

/** Stable signature of an event's mutable container fields, to detect changes
 * between polls. Excludes the identity (key) fields, which never change. */
function eventSignature(e: EventLike): string {
  return JSON.stringify({
    cls: e.eventClassifierCode ?? null,
    dt: e.eventDateTime ? new Date(e.eventDateTime).toISOString() : null,
    transitState: e.transitState ?? null,
    visitState: e.visitState ?? null,
    facilityCode: e.facilityCode ?? null,
    facilityCodeListProvider: e.facilityCodeListProvider ?? null,
    unlocode: e.unlocode ?? null,
    visitRefIn: e.visitRefIn ?? null,
    visitRefOut: e.visitRefOut ?? null,
    vesselName: e.vesselName ?? null,
    voyageNumber: e.voyageNumber ?? null,
    modeOfTransport: e.modeOfTransport ?? null,
    seals: e.seals ?? null,
    vgmWeightKg: e.vgmWeightKg ?? null,
    impediments: e.impediments ?? null,
    loadedAt: e.loadedAt ? new Date(e.loadedAt).toISOString() : null,
  })
}

type VesselLike = {
  vesselName?: string | null
  ibVoyage?: string | null
  obVoyage?: string | null
  line?: string | null
  phase?: string | null
  eta?: Date | null
  etd?: Date | null
  ata?: Date | null
  atd?: Date | null
  beginReceive?: Date | null
  dryCutoff?: Date | null
}

/** Stable signature of a vessel visit's meaningful fields (ETA/ATA/etc.), to
 * detect when /VESSEL data changes between polls. */
function vesselSignature(v: VesselLike): string {
  const d = (x?: Date | null) => (x ? x.toISOString() : null)
  return JSON.stringify({
    vesselName: v.vesselName ?? null,
    ibVoyage: v.ibVoyage ?? null,
    obVoyage: v.obVoyage ?? null,
    line: v.line ?? null,
    phase: v.phase ?? null,
    eta: d(v.eta),
    etd: d(v.etd),
    ata: d(v.ata),
    atd: d(v.atd),
    beginReceive: d(v.beginReceive),
    dryCutoff: d(v.dryCutoff),
  })
}

export class TerminalTrackingService {
  constructor(private readonly deps: Deps) {}

  private toResolvedConfig(config: TerminalConfig): ResolvedTerminalConfig {
    return {
      terminalCode: config.terminalCode,
      adapterType: config.adapterType,
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      proxyUrl: config.proxyUrl ?? null,
      endpoints: config.endpoints,
      authType: config.authType,
      tokenUrl: config.tokenUrl ?? null,
      scope: config.scope ?? null,
      clientId: config.clientId ?? null,
      authConfig: config.authConfig ?? null,
      rateLimitRequests: config.rateLimitRequests,
      rateLimitWindowSeconds: config.rateLimitWindowSeconds,
      unlocode: config.unlocode ?? null,
      facilityCode: (config.smdgCodes ?? [])[0] ?? (config.bicCodes ?? [])[0] ?? null,
      facilityCodeListProvider: (config.smdgCodes ?? []).length
        ? 'SMDG'
        : (config.bicCodes ?? []).length
          ? 'BIC'
          : null,
    }
  }

  async testTerminalConfig(input: {
    id: string
    organizationId: string
    tenantId: string
  }): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    const em = this.deps.em().fork()
    const config = await findOneWithDecryption(em, TerminalConfig, {
      id: input.id,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      deletedAt: null,
    })
    if (!config) return { success: false, message: 'Terminal config not found' }

    const adapter = this.deps.terminalRegistry.get(config.adapterType)
    if (!adapter) return { success: false, message: `No adapter registered for type '${config.adapterType}'` }

    return adapter.testConnection(this.toResolvedConfig(config))
  }

  async createJob(input: CreateJobInput): Promise<{ trackingJobId: string; newEvents: number }> {
    const em = this.deps.em().fork()

    const existing = await em.findOne(TerminalTrackingJob, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      terminalCode: input.terminalCode,
      containerNumber: input.containerNumber,
      // Reuse only a still-open job (avoid duplicate in-flight tracking). A
      // 'completed' job is NOT reused: a container that returns later gets a
      // fresh tracking job with clean history.
      status: { $in: ['active', 'paused'] },
      deletedAt: null,
    })

    if (existing) {
      // Re-poll the existing job so the caller gets fresh data.
      const result = await this.pollJob(existing.id)
      return { trackingJobId: existing.id, newEvents: result.newEvents }
    }

    const job = em.create(TerminalTrackingJob, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      terminalCode: input.terminalCode,
      containerNumber: input.containerNumber,
      status: 'active',
      schedule: input.schedule ?? null,
      nextPollAt: null,
    })
    await em.flush()

    // The initial-poll subscriber performs the first poll on this event.
    await this.deps.eventBus.emit('terminal_tracking.tracking_job.created', {
      id: job.id,
      terminalCode: job.terminalCode,
      containerNumber: job.containerNumber,
      tenantId: job.tenantId,
      organizationId: job.organizationId,
    })

    return { trackingJobId: job.id, newEvents: 0 }
  }

  async pollJob(jobId: string): Promise<PollJobResult> {
    const em = this.deps.em().fork()
    const job = await em.findOne(TerminalTrackingJob, { id: jobId, deletedAt: null })
    if (!job) throw new Error('Terminal tracking job not found')

    try {
      const config = await findOneWithDecryption(em, TerminalConfig, {
        organizationId: job.organizationId,
        tenantId: job.tenantId,
        terminalCode: job.terminalCode,
        isActive: true,
        deletedAt: null,
      })
      if (!config) throw new Error(`No active terminal config for '${job.terminalCode}'`)

      const limit = await checkRateLimit(
        this.deps.cacheService,
        job.tenantId,
        job.terminalCode,
        config.rateLimitRequests,
        config.rateLimitWindowSeconds,
      )
      if (!limit.allowed) {
        terminalLogger.debug('Rate limited, skipping poll', { jobId, terminalCode: job.terminalCode })
        return { newEvents: 0, updatedEvents: 0 }
      }

      const adapter = this.deps.terminalRegistry.get(config.adapterType)
      if (!adapter) throw new Error(`No adapter registered for type '${config.adapterType}'`)

      const resolved = this.toResolvedConfig(config)
      const result = await adapter.fetchEvents({ containerNumber: job.containerNumber, config: resolved })

      // Enrich events with vessel ETA/ATA from /VESSEL (cache-backed, rate-limited).
      const changedVesselRefs = await this.enrichWithVesselVisits(
        em,
        { organizationId: job.organizationId, tenantId: job.tenantId, terminalCode: job.terminalCode },
        config,
        resolved,
        adapter,
        result.events,
      )

      const { created, updated, currentByKey, priorImpedimentsByKey, priorStopsByKey } = await this.persistEvents(
        em,
        job,
        result.events,
        changedVesselRefs,
      )

      job.lastPollAt = new Date()
      job.nextPollAt = this.computeNextPoll(job.schedule)
      job.retryCount = 0
      // Every current leg departed → terminal lifecycle complete; drop from the
      // due-set. A re-appearing leg reverts to active on the next manual poll.
      job.status = isFullyDeparted(result.events) ? 'completed' : 'active'
      await em.flush()

      const vesselByEventId = new Map<string, TerminalFetchedEvent['vesselVisit']>(
        result.events.map((e) => [e.sourceEventId, e.vesselVisit ?? null]),
      )
      for (const event of created) {
        await this.emitCreated(event, vesselByEventId.get(event.sourceEventId) ?? null)
      }
      for (const event of updated) {
        await this.emitUpdated(event, vesselByEventId.get(event.sourceEventId) ?? null)
      }
      await this.evaluateAndEmitAvailability(em, job, currentByKey, priorImpedimentsByKey, priorStopsByKey, vesselByEventId)

      return { newEvents: created.length, updatedEvents: updated.length }
    } catch (err) {
      await this.recordJobError(em, job, err)
      return { newEvents: 0, updatedEvents: 0 }
    }
  }

  async pollAllActiveJobs(tenantId: string, organizationId?: string): Promise<PollAllResult> {
    const em = this.deps.em().fork()
    const now = new Date()
    const jobs = await em.find(TerminalTrackingJob, {
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      status: 'active',
      deletedAt: null,
      $or: [{ nextPollAt: null }, { nextPollAt: { $lte: now } }],
    })

    // Group due jobs per terminal config (org + terminalCode). Each group shares
    // one /unit request budget and one vessel-visit cache, so we poll it in
    // batches rather than one container at a time.
    const groups = new Map<string, TerminalTrackingJob[]>()
    for (const job of jobs) {
      const key = `${job.organizationId}::${job.terminalCode}`
      const arr = groups.get(key)
      if (arr) arr.push(job)
      else groups.set(key, [job])
    }

    let newEvents = 0
    let updatedEvents = 0
    let failed = 0
    for (const group of groups.values()) {
      try {
        const r = await this.pollTerminalGroup(em, group)
        newEvents += r.newEvents
        updatedEvents += r.updatedEvents
        failed += r.failed
      } catch {
        failed += group.length
      }
    }
    return { polled: jobs.length, newEvents, updatedEvents, failed }
  }

  /**
   * Poll one terminal group (same org + terminalCode) in batches. Each batch of
   * up to MAX_CONTAINERS_PER_UNIT_REQUEST containers is a single /unit call, and
   * vessel visits are resolved once across the whole batch (deduped + cached),
   * minimising API requests. Adapters without batch support fall back to the
   * per-container path.
   */
  private async pollTerminalGroup(
    em: EntityManager,
    jobs: TerminalTrackingJob[],
  ): Promise<{ newEvents: number; updatedEvents: number; failed: number }> {
    const first = jobs[0]
    const scope = {
      organizationId: first.organizationId,
      tenantId: first.tenantId,
      terminalCode: first.terminalCode,
    }

    let config: TerminalConfig | null = null
    try {
      config = await findOneWithDecryption(em, TerminalConfig, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        terminalCode: scope.terminalCode,
        isActive: true,
        deletedAt: null,
      })
    } catch {
      config = null
    }
    const adapter = config ? this.deps.terminalRegistry.get(config.adapterType) : undefined
    if (!config || !adapter) {
      const err = new Error(`No active terminal config/adapter for '${scope.terminalCode}'`)
      for (const job of jobs) await this.recordJobError(em, job, err)
      return { newEvents: 0, updatedEvents: 0, failed: jobs.length }
    }

    // Adapters lacking batch support: fall back to the per-container poll path.
    if (typeof adapter.fetchEventsBatch !== 'function') {
      let newEvents = 0
      let updatedEvents = 0
      let failed = 0
      for (const job of jobs) {
        try {
          const r = await this.pollJob(job.id)
          newEvents += r.newEvents
          updatedEvents += r.updatedEvents
        } catch {
          failed += 1
        }
      }
      return { newEvents, updatedEvents, failed }
    }

    const resolved = this.toResolvedConfig(config)
    let newEvents = 0
    let updatedEvents = 0
    let failed = 0

    for (const batch of chunk(jobs, MAX_CONTAINERS_PER_UNIT_REQUEST)) {
      const limit = await checkRateLimit(
        this.deps.cacheService,
        scope.tenantId,
        scope.terminalCode,
        config.rateLimitRequests,
        config.rateLimitWindowSeconds,
      )
      if (!limit.allowed) {
        terminalLogger.debug('Rate limited, skipping unit batch', {
          terminalCode: scope.terminalCode,
          batch: batch.length,
        })
        continue // jobs stay due; retried next cycle
      }

      try {
        const containerNumbers = batch.map((j) => j.containerNumber)
        const { events } = await adapter.fetchEventsBatch!({ containerNumbers, config: resolved })

        // Resolve vessel visits once across the whole batch (deduped + cached).
        const changedVesselRefs = await this.enrichWithVesselVisits(em, scope, config, resolved, adapter, events)

        const byContainer = new Map<string, TerminalFetchedEvent[]>()
        for (const e of events) {
          const arr = byContainer.get(e.containerNumber)
          if (arr) arr.push(e)
          else byContainer.set(e.containerNumber, [e])
        }

        for (const job of batch) {
          const jobEvents = byContainer.get(job.containerNumber) ?? []
          const { created, updated, currentByKey, priorImpedimentsByKey, priorStopsByKey } = await this.persistEvents(
            em,
            job,
            jobEvents,
            changedVesselRefs,
          )

          job.lastPollAt = new Date()
          job.nextPollAt = this.computeNextPoll(job.schedule)
          job.retryCount = 0
          job.status = isFullyDeparted(jobEvents) ? 'completed' : 'active'
          await em.flush()

          const vesselByEventId = new Map<string, TerminalFetchedEvent['vesselVisit']>(
            jobEvents.map((e) => [e.sourceEventId, e.vesselVisit ?? null]),
          )
          for (const ev of created) {
            await this.emitCreated(ev, vesselByEventId.get(ev.sourceEventId) ?? null)
            newEvents += 1
          }
          for (const ev of updated) {
            await this.emitUpdated(ev, vesselByEventId.get(ev.sourceEventId) ?? null)
            updatedEvents += 1
          }
          await this.evaluateAndEmitAvailability(em, job, currentByKey, priorImpedimentsByKey, priorStopsByKey, vesselByEventId)
        }
      } catch (err) {
        for (const job of batch) await this.recordJobError(em, job, err)
        failed += batch.length
      }
    }

    return { newEvents, updatedEvents, failed }
  }

  /**
   * Resolve the vessel visit for each fetched event/leg and attach ETA/ETD/
   * ATA/ATD + phase. The `TerminalVesselVisit` table is the cache: a row fresh
   * within the TTL is reused without an API call, so the many containers that
   * share one vessel visit cost a single /VESSEL fetch per cycle. Each fetch is
   * rate-limit-gated against the same bucket as /unit; when the budget is spent,
   * vessel enrichment is shed (the event still emits, sans vessel data) and
   * filled on the next cycle.
   */
  private async enrichWithVesselVisits(
    em: EntityManager,
    scope: { organizationId: string; tenantId: string; terminalCode: string },
    config: TerminalConfig,
    resolved: ResolvedTerminalConfig,
    adapter: TerminalAdapter,
    events: TerminalFetchedEvent[],
  ): Promise<Set<string>> {
    // Visit refs whose /VESSEL data changed (or first resolved) this poll.
    const changedRefs = new Set<string>()
    if (typeof adapter.fetchVesselVisit !== 'function') return changedRefs
    if (!resolved.endpoints.vessel) return changedRefs

    const picks = events.map((event) => ({ event, pick: pickVesselVisit(event) }))
    // All picked refs (for attaching cached data); only non-departed legs are
    // fetched — a DEPA leg's visit has sailed and /VESSEL returns empty.
    const allRefs = [...new Set(picks.map((p) => p.pick?.ref).filter((r): r is string => !!r))]
    const fetchRefs = [
      ...new Set(
        picks
          .filter((p) => p.pick && p.event.eventCode !== 'DEPA')
          .map((p) => p.pick!.ref),
      ),
    ]
    if (allRefs.length === 0) return changedRefs

    const ttlMs = (config.vesselCacheTtlSeconds ?? DEFAULT_VESSEL_CACHE_TTL_SECONDS) * 1000
    const now = Date.now()

    const existing = await em.find(TerminalVesselVisit, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      terminalCode: scope.terminalCode,
      visitRef: { $in: allRefs },
    })
    const byRef = new Map<string, TerminalVesselVisit>(existing.map((r) => [r.visitRef, r]))

    for (const ref of fetchRefs) {
      const cached = byRef.get(ref)
      if (cached && now - cached.updatedAt.getTime() < ttlMs) continue // fresh cache hit

      const limit = await checkRateLimit(
        this.deps.cacheService,
        scope.tenantId,
        scope.terminalCode,
        config.rateLimitRequests,
        config.rateLimitWindowSeconds,
      )
      if (!limit.allowed) {
        terminalLogger.debug('Rate limited, skipping vessel fetch', { terminalCode: scope.terminalCode, visitRef: ref })
        continue
      }

      try {
        const visit = await adapter.fetchVesselVisit!({ visitRef: ref, config: resolved })
        if (!visit) continue
        // A first-time resolution, or any field difference, counts as a change.
        if (!cached || vesselSignature(cached) !== vesselSignature(visit)) changedRefs.add(ref)
        const row =
          cached ??
          em.create(TerminalVesselVisit, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            terminalCode: scope.terminalCode,
            visitRef: ref,
          })
        row.vesselName = visit.vesselName
        row.ibVoyage = visit.ibVoyage
        row.obVoyage = visit.obVoyage
        row.line = visit.line
        row.phase = visit.phase
        row.eta = visit.eta
        row.etd = visit.etd
        row.ata = visit.ata
        row.atd = visit.atd
        row.beginReceive = visit.beginReceive
        row.dryCutoff = visit.dryCutoff
        row.rawData = visit.rawData
        row.updatedAt = new Date()
        byRef.set(ref, row)
      } catch (err) {
        terminalLogger.debug('Vessel fetch failed', {
          terminalCode: scope.terminalCode,
          visitRef: ref,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    await em.flush()

    // Attach the resolved visit onto each event (direction-correct voyage).
    for (const { event, pick } of picks) {
      if (!pick) continue
      const row = byRef.get(pick.ref)
      if (!row) continue
      event.vesselName = row.vesselName ?? null
      event.voyageNumber = (pick.dir === 'in' ? row.ibVoyage : row.obVoyage) ?? null
      event.vesselVisit = {
        visitRef: row.visitRef,
        vesselName: row.vesselName ?? null,
        ibVoyage: row.ibVoyage ?? null,
        obVoyage: row.obVoyage ?? null,
        line: row.line ?? null,
        phase: row.phase ?? null,
        eta: row.eta ?? null,
        etd: row.etd ?? null,
        ata: row.ata ?? null,
        atd: row.atd ?? null,
        beginReceive: row.beginReceive ?? null,
        dryCutoff: row.dryCutoff ?? null,
        rawData: row.rawData ?? null,
      }
    }

    return changedRefs
  }

  /**
   * Insert new events, and update existing ones whose container fields changed
   * or whose vessel visit data changed this poll. Returns both lists so the
   * caller can emit `.created` / `.updated` accordingly.
   */
  private async persistEvents(
    em: EntityManager,
    job: TerminalTrackingJob,
    fetched: TerminalFetchedEvent[],
    changedVesselRefs: Set<string>,
  ): Promise<{
    created: TerminalEvent[]
    updated: TerminalEvent[]
    currentByKey: Map<string, TerminalEvent>
    priorImpedimentsByKey: Map<string, string[] | null>
    priorStopsByKey: Map<string, TerminalStops>
  }> {
    if (fetched.length === 0) {
      return { created: [], updated: [], currentByKey: new Map(), priorImpedimentsByKey: new Map(), priorStopsByKey: new Map() }
    }

    const existing = await em.find(TerminalEvent, {
      job,
      sourceEventId: { $in: fetched.map((e) => e.sourceEventId) },
    })
    const byKey = new Map(existing.map((e) => [`${e.source}:${e.sourceEventId}`, e]))
    // Snapshot each existing event's holds BEFORE the update loop mutates them,
    // so availability detection can see the blocked → clear transition.
    const priorImpedimentsByKey = new Map<string, string[] | null>(
      existing.map((e) => [e.sourceEventId, e.impediments ?? null]),
    )
    // Same for the STOP flags (derived from rawData), so the availability step
    // can detect a stop-set change and emit `stops_updated`.
    const priorStopsByKey = new Map<string, TerminalStops>(
      existing.map((e) => [e.sourceEventId, parseTerminalStops(e.rawData)]),
    )

    const created: TerminalEvent[] = []
    const updated: TerminalEvent[] = []
    const handled = new Set<string>()
    for (const e of fetched) {
      const key = `${e.source}:${e.sourceEventId}`
      if (handled.has(key)) continue
      handled.add(key)

      const prior = byKey.get(key)
      if (!prior) {
        const entity = em.create(TerminalEvent, {
          organizationId: job.organizationId,
          tenantId: job.tenantId,
          job,
          source: e.source,
          sourceEventId: e.sourceEventId,
          eventType: e.eventType,
          eventCode: e.eventCode,
          eventClassifierCode: e.eventClassifierCode ?? null,
          eventDateTime: e.eventDateTime,
          containerNumber: e.containerNumber,
          ufvGkey: e.ufvGkey,
          transitState: e.transitState ?? null,
          visitState: e.visitState ?? null,
          facilityCode: e.facilityCode ?? null,
          facilityCodeListProvider: e.facilityCodeListProvider ?? null,
          unlocode: e.unlocode ?? null,
          visitRefIn: e.visitRefIn ?? null,
          visitRefOut: e.visitRefOut ?? null,
          vesselName: e.vesselName ?? null,
          voyageNumber: e.voyageNumber ?? null,
          modeOfTransport: e.modeOfTransport ?? null,
          seals: e.seals ?? null,
          vgmWeightKg: e.vgmWeightKg ?? null,
          impediments: e.impediments ?? null,
          loadedAt: e.loadedAt ?? null,
          rawData: e.rawData ?? null,
        })
        created.push(entity)
        continue
      }

      const containerChanged = eventSignature(prior) !== eventSignature(e)
      const vesselChanged = !!e.vesselVisit && changedVesselRefs.has(e.vesselVisit.visitRef)
      // The STOP flags live only in rawData, which eventSignature does not hash,
      // so a stop-only change must be detected separately to persist rawData.
      const stopFlagsChanged = stopsChanged(parseTerminalStops(prior.rawData), parseTerminalStops(e.rawData))
      if (!containerChanged && !vesselChanged && !stopFlagsChanged) continue

      if (containerChanged || stopFlagsChanged) {
        prior.eventClassifierCode = e.eventClassifierCode ?? null
        prior.eventDateTime = e.eventDateTime
        prior.transitState = e.transitState ?? null
        prior.visitState = e.visitState ?? null
        prior.facilityCode = e.facilityCode ?? null
        prior.facilityCodeListProvider = e.facilityCodeListProvider ?? null
        prior.unlocode = e.unlocode ?? null
        prior.visitRefIn = e.visitRefIn ?? null
        prior.visitRefOut = e.visitRefOut ?? null
        prior.vesselName = e.vesselName ?? null
        prior.voyageNumber = e.voyageNumber ?? null
        prior.modeOfTransport = e.modeOfTransport ?? null
        prior.seals = e.seals ?? null
        prior.vgmWeightKg = e.vgmWeightKg ?? null
        prior.impediments = e.impediments ?? null
        prior.loadedAt = e.loadedAt ?? null
        prior.rawData = e.rawData ?? null
      }
      updated.push(prior)
    }

    if (created.length || updated.length) await em.flush()

    // Current persisted entity for every fetched event (existing + created), so
    // availability detection evaluates the freshest snapshot per source event.
    const currentByKey = new Map<string, TerminalEvent>(existing.map((e) => [e.sourceEventId, e]))
    for (const c of created) currentByKey.set(c.sourceEventId, c)

    return { created, updated, currentByKey, priorImpedimentsByKey, priorStopsByKey }
  }

  private buildEventPayload(event: TerminalEvent, vesselVisit: TerminalFetchedEvent['vesselVisit'] = null) {
    return {
      id: event.id,
      jobId: event.job.id,
      tenantId: event.tenantId,
      organizationId: event.organizationId,
      source: event.source,
      sourceEventId: event.sourceEventId,
      eventType: event.eventType,
      eventCode: event.eventCode,
      eventClassifierCode: event.eventClassifierCode ?? null,
      eventDateTime: event.eventDateTime.toISOString(),
      containerNumber: event.containerNumber,
      ufvGkey: event.ufvGkey,
      transitState: event.transitState ?? null,
      // Direction of travel through the terminal ('import' | 'export' | null).
      // Consumers use it to decide which road leg a gate movement belongs to:
      // an import gates OUT onto the delivery leg, an export gates IN off the
      // pre-carriage leg. Derived from raw data, so it also holds for rows
      // stored before this field existed.
      cargoCategory: parseCargoCategory(event.rawData),
      facilityCode: event.facilityCode ?? null,
      facilityCodeListProvider: event.facilityCodeListProvider ?? null,
      unlocode: event.unlocode ?? null,
      vesselName: event.vesselName ?? null,
      voyageNumber: event.voyageNumber ?? null,
      modeOfTransport: event.modeOfTransport ?? null,
      seals: event.seals ?? null,
      impediments: event.impediments ?? null,
      // When the container was loaded onto transport (N4 `Loaded`), typed datetime.
      loadedAt: event.loadedAt ? event.loadedAt.toISOString() : null,
      // Per-mode load/pickup STOP flags derived from the raw N4 columns.
      stops: parseTerminalStops(event.rawData),
      // Nested vessel visit (from /VESSEL); null when unresolved. Dates ISO.
      vesselVisit: vesselVisit
        ? {
            visitRef: vesselVisit.visitRef,
            vesselName: vesselVisit.vesselName,
            ibVoyage: vesselVisit.ibVoyage,
            obVoyage: vesselVisit.obVoyage,
            line: vesselVisit.line,
            phase: vesselVisit.phase,
            eta: vesselVisit.eta ? vesselVisit.eta.toISOString() : null,
            etd: vesselVisit.etd ? vesselVisit.etd.toISOString() : null,
            ata: vesselVisit.ata ? vesselVisit.ata.toISOString() : null,
            atd: vesselVisit.atd ? vesselVisit.atd.toISOString() : null,
            beginReceive: vesselVisit.beginReceive ? vesselVisit.beginReceive.toISOString() : null,
            dryCutoff: vesselVisit.dryCutoff ? vesselVisit.dryCutoff.toISOString() : null,
          }
        : null,
      rawData: event.rawData ?? null,
    }
  }

  /** Emit a newly-created event: the raw `.created` event plus its semantic
   * milestone (gate_in / discharged / …). */
  private async emitCreated(
    event: TerminalEvent,
    vesselVisit: TerminalFetchedEvent['vesselVisit'] = null,
  ): Promise<void> {
    const payload = this.buildEventPayload(event, vesselVisit)
    await this.deps.eventBus.emit('terminal_tracking.terminal_event.created', payload)
    const semanticId = semanticEventIdFor(event.eventCode)
    if (semanticId) await this.deps.eventBus.emit(semanticId, payload)
  }

  /** Emit `.updated` when an existing event's container or vessel data changed.
   * Semantic milestone events are NOT re-emitted — the milestone already fired
   * on creation; only the underlying data moved. */
  private async emitUpdated(
    event: TerminalEvent,
    vesselVisit: TerminalFetchedEvent['vesselVisit'] = null,
  ): Promise<void> {
    const payload = this.buildEventPayload(event, vesselVisit)
    await this.deps.eventBus.emit('terminal_tracking.terminal_event.updated', payload)
  }

  /**
   * Evaluate the container's availability after a poll and emit the one-shot
   * milestone when it first becomes collectable:
   * - export empty ready for pickup (`equipment.empty_ready`)
   * - import blocking holds cleared (`equipment.holds_cleared`)
   *
   * The job-level `emptyReadyAt` / `holdsClearedAt` markers guarantee each event
   * fires at most once per container. A job may carry both an import and an
   * export leg, so both are checked independently.
   */
  private async evaluateAndEmitAvailability(
    em: EntityManager,
    job: TerminalTrackingJob,
    currentByKey: Map<string, TerminalEvent>,
    priorImpedimentsByKey: Map<string, string[] | null>,
    priorStopsByKey: Map<string, TerminalStops>,
    vesselByEventId: Map<string, TerminalFetchedEvent['vesselVisit']>,
  ): Promise<void> {
    let emptyEvent: TerminalEvent | null = null
    let holdsEvent: TerminalEvent | null = null
    // Events whose raw impediment set changed since the last poll (incl. first
    // appearance with holds). Unlike the one-shot markers above, every one emits.
    const holdsChangedEvents: TerminalEvent[] = []
    // Events whose STOP flags changed since the last poll (incl. first
    // appearance). Mirrors holdsChangedEvents.
    const stopsChangedEvents: TerminalEvent[] = []

    for (const [sourceEventId, entity] of currentByKey) {
      if (!job.emptyReadyAt && !emptyEvent && isEmptyReady(entity)) emptyEvent = entity
      if (
        !job.holdsClearedAt &&
        !holdsEvent &&
        isImportHoldsCleared(entity, priorImpedimentsByKey.get(sourceEventId) ?? null)
      ) {
        holdsEvent = entity
      }
      // `priorImpedimentsByKey` has no entry for events created this poll, so a
      // first-seen container with holds is reported as a change (empty prior).
      if (impedimentsChanged(priorImpedimentsByKey.get(sourceEventId), entity.impediments)) {
        holdsChangedEvents.push(entity)
      }
      // Same for STOP flags: a created event has no prior entry, so an empty
      // prior (all-null) surfaces a first-seen stop set as a change.
      const priorStops = priorStopsByKey.get(sourceEventId) ?? { vsl: null, road: null, rail: null }
      if (stopsChanged(priorStops, parseTerminalStops(entity.rawData))) {
        stopsChangedEvents.push(entity)
      }
    }

    if (!emptyEvent && !holdsEvent && holdsChangedEvents.length === 0 && stopsChangedEvents.length === 0) return

    // Only the one-shot markers mutate the job; flush just for those.
    if (emptyEvent || holdsEvent) {
      const now = new Date()
      if (emptyEvent) job.emptyReadyAt = now
      if (holdsEvent) job.holdsClearedAt = now
      await em.flush()
    }

    if (emptyEvent) {
      await this.deps.eventBus.emit('terminal_tracking.equipment.empty_ready', {
        ...this.buildEventPayload(emptyEvent, vesselByEventId.get(emptyEvent.sourceEventId) ?? null),
        emptyReady: true,
      })
    }
    if (holdsEvent) {
      await this.deps.eventBus.emit('terminal_tracking.equipment.holds_cleared', {
        ...this.buildEventPayload(holdsEvent, vesselByEventId.get(holdsEvent.sourceEventId) ?? null),
        holdsCleared: true,
      })
    }
    for (const entity of holdsChangedEvents) {
      await this.deps.eventBus.emit('terminal_tracking.equipment.holds_updated', {
        ...this.buildEventPayload(entity, vesselByEventId.get(entity.sourceEventId) ?? null),
        impediments: entity.impediments ?? [],
      })
    }
    for (const entity of stopsChangedEvents) {
      await this.deps.eventBus.emit('terminal_tracking.equipment.stops_updated', {
        ...this.buildEventPayload(entity, vesselByEventId.get(entity.sourceEventId) ?? null),
        stops: parseTerminalStops(entity.rawData),
      })
    }
  }

  private computeNextPoll(schedule?: string[] | null): Date | null {
    if (!schedule || schedule.length === 0) return null
    const now = Date.now()
    const upcoming = schedule
      .map((s) => new Date(s).getTime())
      .filter((t) => Number.isFinite(t) && t > now)
      .sort((a, b) => a - b)
    return upcoming.length ? new Date(upcoming[0]) : null
  }

  private async recordJobError(em: EntityManager, job: TerminalTrackingJob, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err)
    terminalLogger.warn('Poll failed', { jobId: job.id, terminalCode: job.terminalCode, message })

    const history = job.errorHistory ?? []
    history.unshift({ date: new Date().toISOString(), message })
    job.errorHistory = history.slice(0, MAX_ERROR_HISTORY)
    job.retryCount = (job.retryCount ?? 0) + 1
    job.lastPollAt = new Date()
    if (job.retryCount >= MAX_RETRIES) job.status = 'failed'

    try {
      await em.flush()
    } catch (flushErr) {
      terminalLogger.error('Failed to persist job error', {
        jobId: job.id,
        message: flushErr instanceof Error ? flushErr.message : String(flushErr),
      })
    }

    await this.deps.eventBus.emit('terminal_tracking.tracking_job.poll_failed', {
      id: job.id,
      terminalCode: job.terminalCode,
      containerNumber: job.containerNumber,
      tenantId: job.tenantId,
      organizationId: job.organizationId,
      message,
      retryCount: job.retryCount,
    })
  }
}
