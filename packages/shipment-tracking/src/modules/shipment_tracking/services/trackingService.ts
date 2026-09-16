import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Shipment, TrackingJob, TrackingEvent, CarrierConfig, BicConfig } from '../data/entities'
import type { TrackingReferenceType, TrackingJobStatusEnum, ShipmentStatusEnum, FacilityCodeListProvider, TrackingProvider, TrackingMode } from '../data/entities'
import type { CarrierRegistryService } from './carrierRegistry'
import type { ShipsGoProvider } from './shipsGoProvider'
import type { WebhookService } from './webhookService'
import { ShipsGoCreditsExhaustedError, ShipsGoAuthError, ShipsGoRateLimitedError } from '../lib/shipsgo-client'
import type { CacheService } from '../lib/rate-limiter'
import { checkRateLimit } from '../lib/rate-limiter'
import { trackingLogger, withCarrierContext } from '../lib/logger'
import { deriveShipmentStatus, deriveAirShipmentStatus } from '../lib/status-machine'
import { extractShipmentTimes } from '../lib/time-extraction'
import { generatePollSchedule, getNextPollDate } from '../lib/schedule-generator'
import type { CarrierFetchedEvent } from '../lib/carrier-adapter'
import { mapDcsaEventToWebhookType, isSignificantMilestone } from '../lib/dcsa-event-mapping'
import { inferRouteFromEvents } from '../lib/route-inference'
import { allContainersComplete, destinationArrivedBefore, staleArrivalCutoff } from '../lib/empty-return'
import { mergeExtractedTimestamps, getPrimaryTimestampValue } from '../lib/timestamp-utils'
import { findLatestVesselInfo } from '../lib/vessel-extraction'
import { extractRouteFromEvents, mapTrackingEventToEntry } from '../lib/route-extraction'
import { buildLocationFromEvent, createBasicLocation, mergeLocationWithBicData, isLocationComplete } from '../lib/location-types'
import type { FacilityLocation } from '../lib/location-types'
import { BicApiClient, type BicFacility } from '../lib/bic-api-client'
import { applyLocationOverrideIfExists } from '../lib/location-overrides'

/**
 * Provider-agnostic summary of a poll's top-level references, threaded from the
 * fetch into shipment derivation. Ocean carries vessel/booking/BOL; air (ShipsGo
 * mode='air') carries the AWB, flight, airline and ShipsGo's top-level status.
 */
type CarrierResultSummary = {
  vesselName?: string | null
  vesselImo?: string | null
  bookingNumber?: string | null
  bolNumber?: string | null
  awbNumber?: string | null
  flightNumber?: string | null
  airlineCode?: string | null
  airlineName?: string | null
  airStatus?: string | null
  /** Provider shipment-level metadata merged into Shipment.extra (ShipsGo route / air cargo). */
  extra?: Record<string, unknown> | null
}

type TrackingServiceDeps = {
  em: () => EntityManager
  eventBus: EventBus
  carrierRegistry: CarrierRegistryService
  shipsGoProvider: ShipsGoProvider
  cacheService: CacheService
  webhookService: WebhookService
}

export class TrackingService {
  private deps: TrackingServiceDeps

  constructor(deps: TrackingServiceDeps) {
    this.deps = deps
  }

  /**
   * Creates a tracking job and immediately polls the carrier.
   * This is the main entry point for new tracking requests.
   * 
   * The system will:
   * 1. Create a TrackingJob for the given carrier and reference
   * 2. Poll the carrier API for events
   * 3. Auto-discover containers from EQUIPMENT events and create Shipments
   * 4. Auto-infer origin/destination ports from events if not provided
   * 5. Emit events for new cargo events and shipment status changes
   */
  async createTrackingJob(input: {
    organizationId: string
    tenantId: string
    carrierCode: string
    referenceType: TrackingReferenceType
    referenceValue: string
    // Provider defaults to 'carrier' (direct DCSA adapter). 'shipsgo' routes
    // through the aggregator fallback and does not require a local adapter.
    provider?: TrackingProvider
    // Transport mode; defaults to 'ocean'.
    mode?: TrackingMode
    // Origin/destination are optional - will be auto-inferred from events if not provided
    originUnlocode?: string
    destinationUnlocode?: string
    schedule?: string[]
  }): Promise<{
    trackingJobId: string
    shipmentsCreated: number
    newEvents: number
  }> {
    const em = this.deps.em()
    const { organizationId, tenantId, carrierCode, referenceType, referenceValue, schedule } = input
    const provider: TrackingProvider = input.provider ?? 'carrier'
    const mode: TrackingMode = input.mode ?? 'ocean'
    // Origin/destination may be provided or will be auto-inferred from events
    let originUnlocode = input.originUnlocode?.toUpperCase()
    let destinationUnlocode = input.destinationUnlocode?.toUpperCase()

    const carrierCodeLower = carrierCode.toLowerCase()

    // Direct-carrier jobs require a registered adapter; ShipsGo (aggregator)
    // jobs do not — they are register-then-poll and carrier-agnostic for ocean.
    if (provider === 'carrier' && !this.deps.carrierRegistry.has(carrierCodeLower)) {
      throw new Error(`No adapter registered for carrier: ${carrierCode}`)
    }

    // Check for existing active job with same reference
    const existingJob = await em.findOne(TrackingJob, {
      organizationId,
      tenantId,
      carrierCode: carrierCodeLower,
      referenceType,
      referenceValue,
      status: { $in: ['active', 'paused'] },
      deletedAt: null,
    })

    if (existingJob) {
      trackingLogger.debug('TrackingJob already exists', {
        trackingJobId: existingJob.id,
        carrierCode: carrierCodeLower,
        referenceType,
        referenceValue,
      })
      // Poll the existing job
      const pollResult = await this.pollTrackingJob(existingJob.id)
      return {
        trackingJobId: existingJob.id,
        shipmentsCreated: pollResult.shipmentsCreated,
        newEvents: pollResult.newEvents,
      }
    }

    // Generate poll schedule
    const pollSchedule = schedule ?? generatePollSchedule({})
    const nextPollAt = getNextPollDate(pollSchedule)

    // Create new tracking job (origin/destination may be null, will be inferred from first poll)
    const trackingJob = em.create(TrackingJob, {
      organizationId,
      tenantId,
      provider,
      mode,
      carrierCode: carrierCodeLower,
      referenceType,
      referenceValue,
      originUnlocode: originUnlocode ?? null,
      destinationUnlocode: destinationUnlocode ?? null,
      status: 'active',
      schedule: pollSchedule,
      nextPollAt,
    })

    em.persist(trackingJob)
    await em.flush()

    trackingLogger.info('Created TrackingJob', {
      trackingJobId: trackingJob.id,
      carrierCode: carrierCodeLower,
      referenceType,
      referenceValue,
      tenantId,
      organizationId,
    })

    // Emit tracking job created event
    await this.deps.eventBus.emit('shipment_tracking.tracking_job.created', {
      id: trackingJob.id,
      carrierCode: carrierCodeLower,
      referenceType,
      referenceValue,
      tenantId,
      organizationId,
    })

    // Poll immediately
    let pollResult = { shipmentsCreated: 0, newEvents: 0 }
    try {
      pollResult = await this.pollTrackingJob(trackingJob.id)
    } catch (error) {
      trackingLogger.error('Initial poll failed', {
        trackingJobId: trackingJob.id,
        carrierCode: carrierCodeLower,
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      await this.deps.eventBus.emit('shipment_tracking.tracking_job.poll_failed', {
        id: trackingJob.id,
        carrierCode: carrierCodeLower,
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId,
        organizationId,
      })
    }

    return {
      trackingJobId: trackingJob.id,
      shipmentsCreated: pollResult.shipmentsCreated,
      newEvents: pollResult.newEvents,
    }
  }

  /**
   * Polls all active tracking jobs for a tenant/organization.
   * Called by the scheduler for periodic re-polling.
   */
  async pollAllActiveJobs(
    tenantId: string,
    organizationId?: string,
  ): Promise<{ polled: number; newEvents: number; failed: number }> {
    const em = this.deps.em()

    const filter: Record<string, unknown> = {
      tenantId,
      status: 'active',
      deletedAt: null,
    }

    if (organizationId) {
      filter.organizationId = organizationId
    }

    const jobs = await em.find(TrackingJob, filter)

    let polled = 0
    let totalNewEvents = 0
    let failed = 0

    for (const job of jobs) {
      try {
        const result = await this.pollTrackingJob(job.id)
        polled++
        totalNewEvents += result.newEvents
      } catch (error) {
        failed++
        trackingLogger.error('Poll failed for job', {
          trackingJobId: job.id,
          carrierCode: job.carrierCode,
          error: error instanceof Error ? error.message : 'Unknown error',
        })

        await this.deps.eventBus.emit('shipment_tracking.tracking_job.poll_failed', {
          id: job.id,
          carrierCode: job.carrierCode,
          error: error instanceof Error ? error.message : 'Unknown error',
          tenantId: job.tenantId,
          organizationId: job.organizationId,
        })
      }
    }

    trackingLogger.info('Poll all completed', {
      polled,
      totalNewEvents,
      failed,
      tenantId,
      organizationId,
    })

    return { polled, newEvents: totalNewEvents, failed }
  }

  /**
   * Polls a single tracking job:
   * 1. Fetches events from the carrier
   * 2. Persists new TrackingEvents
   * 3. Auto-discovers containers and creates/updates Shipments
   * 4. Emits events for cargo events and shipment changes
   */
  async pollTrackingJob(jobId: string): Promise<{
    newEvents: number
    shipmentsCreated: number
    shipmentsUpdated: number
  }> {
    const em = this.deps.em()
    const job = await em.findOne(TrackingJob, { id: jobId }, { populate: ['shipments'] })

    if (!job) {
      throw new Error(`TrackingJob not found: ${jobId}`)
    }

    if (job.status !== 'active') {
      return { newEvents: 0, shipmentsCreated: 0, shipmentsUpdated: 0 }
    }

    // Tenant scope — used for the fetch below and for BIC enrichment later.
    const scope = { tenantId: job.tenantId, organizationId: job.organizationId }

    // Fetch events. Two provider paths converge on the same downstream pipeline:
    //   'carrier' → direct DCSA adapter (rate-limited, config-driven auth)
    //   'shipsgo' → aggregator, register-then-poll (no local adapter/config)
    let fetchedEvents: CarrierFetchedEvent[]
    let carrierResult: CarrierResultSummary

    if (job.provider === 'shipsgo') {
      // Resolve config + rate limit in one config read.
      const pollContext = await this.deps.shipsGoProvider.resolvePollContext(scope, job.mode)
      // Per-tenant rate limit — ShipsGo caps at 100 req/min account-wide, so a
      // bulk import of unsupported/air legs could otherwise be throttled (and
      // waste credits). The identity is per-tenant for a BYO token and shared
      // for the platform account, so env-fallback tenants share one budget.
      // Skip this tick when over the limit; the schedule retries it, and the job
      // is left untouched (no error, no retry burn).
      const limitResult = await checkRateLimit(
        this.deps.cacheService,
        pollContext.rateLimitIdentity,
        'shipsgo',
        pollContext.rateLimit.requests,
        pollContext.rateLimit.windowSeconds,
      )
      if (!limitResult.allowed) {
        trackingLogger.debug('ShipsGo rate limited, skipping poll', {
          trackingJobId: jobId,
          retryAfterSeconds: limitResult.retryAfterSeconds,
        })
        return { newEvents: 0, shipmentsCreated: 0, shipmentsUpdated: 0 }
      }

      try {
        const result = await this.deps.shipsGoProvider.fetchOrRegister(job, pollContext.config)
        fetchedEvents = result.events
        carrierResult = {
          vesselName: result.vesselName,
          vesselImo: result.vesselImo,
          bookingNumber: result.bookingNumber,
          bolNumber: result.bolNumber,
          awbNumber: result.awbNumber,
          flightNumber: result.flightNumber,
          airlineCode: result.airlineCode,
          airlineName: result.airlineName,
          airStatus: result.airStatus,
          extra: result.extra,
        }
      } catch (error) {
        // Credit exhaustion (HTTP 402) is an account-level condition, not a
        // per-job fault. Routing it through recordJobError would burn the
        // 10-strike failure budget and flip healthy jobs to 'failed' after ~10
        // polls — while re-POSTing to an exhausted account each time. Instead
        // back the job off and leave retryCount untouched, so it resumes on its
        // own once credits are topped up.
        if (error instanceof ShipsGoCreditsExhaustedError) {
          await this.recordCreditExhaustion(em, job)
          return { newEvents: 0, shipmentsCreated: 0, shipmentsUpdated: 0 }
        }
        // 429 (rate limit) and 403 (auth) are transient/account-level like 402:
        // back the job off without burning its retry budget so it recovers on
        // its own once the window resets / the token is fixed.
        if (error instanceof ShipsGoRateLimitedError) {
          const backoffMs = (error.retryAfterSeconds ?? 60) * 1000
          await this.recordTransientBackoff(em, job, error.message, backoffMs)
          return { newEvents: 0, shipmentsCreated: 0, shipmentsUpdated: 0 }
        }
        if (error instanceof ShipsGoAuthError) {
          await this.recordTransientBackoff(em, job, error.message, 30 * 60 * 1000)
          return { newEvents: 0, shipmentsCreated: 0, shipmentsUpdated: 0 }
        }
        const message = error instanceof Error ? error.message : 'Unknown ShipsGo fetch error'
        await this.recordJobError(em, job, message)
        return { newEvents: 0, shipmentsCreated: 0, shipmentsUpdated: 0 }
      }
    } else {
      // Resolve carrier adapter
      const adapter = this.deps.carrierRegistry.get(job.carrierCode)
      if (!adapter) {
        await this.recordJobError(em, job, `No adapter registered for carrier: ${job.carrierCode}`)
        return { newEvents: 0, shipmentsCreated: 0, shipmentsUpdated: 0 }
      }

      // Load carrier config for rate limiting and auth
      const carrierConfig = await findOneWithDecryption(
        em,
        CarrierConfig,
        {
          carrierCode: job.carrierCode,
          organizationId: job.organizationId,
          tenantId: job.tenantId,
          isActive: true,
        },
        undefined,
        scope,
      )

      // Check rate limit
      if (carrierConfig) {
        const limitResult = await checkRateLimit(
          this.deps.cacheService,
          job.tenantId,
          job.carrierCode,
          carrierConfig.rateLimitRequests,
          carrierConfig.rateLimitWindowSeconds,
        )

        if (!limitResult.allowed) {
          trackingLogger.debug('Rate limited, skipping poll', {
            trackingJobId: jobId,
            carrierCode: job.carrierCode,
            retryAfterSeconds: limitResult.retryAfterSeconds,
          })
          return { newEvents: 0, shipmentsCreated: 0, shipmentsUpdated: 0 }
        }
      }

      try {
        const result = await adapter.fetchEvents({
          referenceType: job.referenceType,
          referenceValue: job.referenceValue,
          apiEndpoint: carrierConfig?.apiEndpoint,
          authConfig: carrierConfig?.authConfig,
        })
        fetchedEvents = result.events
        carrierResult = {
          vesselName: result.vesselName,
          vesselImo: result.vesselImo,
          bookingNumber: result.bookingNumber,
          bolNumber: result.bolNumber,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown fetch error'
        await this.recordJobError(em, job, message)
        return { newEvents: 0, shipmentsCreated: 0, shipmentsUpdated: 0 }
      }
    }

    // Auto-infer origin/destination from events if not already set
    if (fetchedEvents.length > 0 && (!job.originUnlocode || !job.destinationUnlocode)) {
      const inferred = inferRouteFromEvents(fetchedEvents)

      if (!job.originUnlocode && inferred.originUnlocode) {
        job.originUnlocode = inferred.originUnlocode
        trackingLogger.info('Auto-inferred origin', {
          trackingJobId: job.id,
          carrierCode: job.carrierCode,
          origin: inferred.originUnlocode,
          confidence: inferred.confidence.origin,
        })
      }

      if (!job.destinationUnlocode && inferred.destinationUnlocode) {
        job.destinationUnlocode = inferred.destinationUnlocode
        trackingLogger.info('Auto-inferred destination', {
          trackingJobId: job.id,
          carrierCode: job.carrierCode,
          destination: inferred.destinationUnlocode,
          confidence: inferred.confidence.destination,
        })
      }
    }

    // Persist new events (deduplicate by source + sourceEventId).
    // Estimated (EST) movements reuse a timestamp-independent sourceEventId (see
    // the ShipsGo mapper), so a shifting estimate maps to the SAME row: refresh
    // its timestamp in place rather than skipping (stale ETA) or inserting a new
    // row every poll (unbounded churn + per-poll event noise). Actuals are
    // immutable, so an existing ACT row is simply skipped.
    const existingByKey = new Map(
      (
        await em.find(TrackingEvent, {
          trackingJob: job,
          sourceEventId: { $in: fetchedEvents.map((e) => e.sourceEventId) },
        })
      ).map((e) => [`${e.source}:${e.sourceEventId}`, e]),
    )

    const newEvents: TrackingEvent[] = []
    let estRefreshed = false
    for (const fetched of fetchedEvents) {
      const dedupeKey = `${fetched.source}:${fetched.sourceEventId}`
      const prior = existingByKey.get(dedupeKey)
      if (prior) {
        // Refresh a moving estimate in place; leave actuals untouched.
        if (
          fetched.eventClassifierCode === 'EST' &&
          prior.eventDateTime.getTime() !== fetched.eventDateTime.getTime()
        ) {
          prior.eventDateTime = fetched.eventDateTime
          prior.eventDateTimeOffset = fetched.eventDateTimeOffset ?? prior.eventDateTimeOffset
          prior.description = fetched.description ?? prior.description
          prior.rawData = fetched.rawData ?? prior.rawData
          estRefreshed = true
        }
        continue
      }

      const trackingEvent = em.create(TrackingEvent, {
        organizationId: job.organizationId,
        tenantId: job.tenantId,
        trackingJob: job,

        // Source identification
        source: fetched.source,
        sourceEventId: fetched.sourceEventId,

        // Core event fields
        eventType: fetched.eventType,
        eventCode: fetched.eventCode,
        eventClassifierCode: fetched.eventClassifierCode,
        eventDateTime: fetched.eventDateTime,
        eventDateTimeOffset: fetched.eventDateTimeOffset,
        description: fetched.description,
        rawData: fetched.rawData,

        // Equipment fields
        equipmentReference: fetched.equipmentReference,
        isoEquipmentCode: fetched.isoEquipmentCode,
        emptyIndicatorCode: fetched.emptyIndicatorCode,
        isTransshipmentMove: fetched.isTransshipmentMove,

        // Location fields
        locationName: fetched.locationName,
        locationUnlocode: fetched.locationUnlocode,
        locationCountry: fetched.locationCountry,
        facilityCode: fetched.facilityCode,
        facilityCodeListProvider: fetched.facilityCodeListProvider,
        facilityTypeCode: fetched.facilityTypeCode,
        facilityAddress: fetched.facilityAddress,
        latitude: fetched.latitude,
        longitude: fetched.longitude,

        // Transport call fields
        transportCallReference: fetched.transportCallReference,
        modeOfTransport: fetched.modeOfTransport,
        vesselName: fetched.vesselName,
        vesselImo: fetched.vesselImo,
        voyageNumber: fetched.voyageNumber,
        carrierServiceCode: fetched.carrierServiceCode,
        carrierExportVoyageNumber: fetched.carrierExportVoyageNumber,
        carrierImportVoyageNumber: fetched.carrierImportVoyageNumber,
        universalServiceReference: fetched.universalServiceReference,
        universalExportVoyageReference: fetched.universalExportVoyageReference,
        universalImportVoyageReference: fetched.universalImportVoyageReference,
        portVisitReference: fetched.portVisitReference,

        // Document references
        relatedDocumentReferences: fetched.relatedDocumentReferences,

        // Metadata fields
        eventCreatedDateTime: fetched.eventCreatedDateTime,
        retractedEventId: fetched.retractedEventId,
        publisherName: fetched.publisherName,
        publisherRole: fetched.publisherRole,

        // Additional fields
        delayReasonCode: fetched.delayReasonCode,
        changeRemark: fetched.changeRemark,
        seals: fetched.seals,
      })
      newEvents.push(trackingEvent)
      existingByKey.set(dedupeKey, trackingEvent) // Prevent duplicates within same batch
    }

    // Persist new events / in-place EST refreshes (if any)
    if (newEvents.length > 0 || estRefreshed) {
      await em.flush()
    }

    // Load BIC config for facility enrichment
    const bicConfig = await this.loadBicConfig(em, scope)

    // Auto-discover containers and create/update Shipments
    // Always run sync even without new events to backfill missing data (e.g. booking numbers)
    const { shipmentsCreated, shipmentsUpdated, allComplete } = await this.syncShipmentsFromEvents(
      em,
      job,
      carrierResult,
      bicConfig,
    )

    // Update job
    job.lastPollAt = new Date()
    job.retryCount = 0
    await em.flush()

    // Emit events for each new tracking event
    for (const event of newEvents) {
      await this.emitTrackingEventCreated(event, job)
    }

    // Every tracked container has completed its journey (empty return for DCSA,
    // delivery for COSCO), or the backup fired (arrived at destination long ago)
    // → stop polling this job (self-heals already-active completed jobs on their
    // next poll).
    if (allComplete && job.status === 'active') {
      await this.stopJobInline(em, job, 'completed')
      trackingLogger.info('Tracking job completed (empty return / delivery, or stale after destination arrival)', {
        trackingJobId: job.id,
        tenantId: job.tenantId,
        organizationId: job.organizationId,
      })
    }

    return { newEvents: newEvents.length, shipmentsCreated, shipmentsUpdated }
  }

  /**
   * Syncs Shipments based on TrackingEvents for a job.
   * Auto-discovers containers from equipmentReference in EQUIPMENT events.
   * For container-based tracking (referenceType='container'), creates exactly one Shipment.
   * For booking/BOL tracking, creates one Shipment per unique equipmentReference.
   */
  /**
   * Air counterpart to syncShipmentsFromEvents. Air has no container/equipment
   * model, so it maintains exactly one AWB-keyed Shipment (mode='air') per job,
   * fills flight/airline metadata, and derives timestamps + status from the air
   * movements (via deriveShipmentStateFromEvents with the ShipsGo top-level
   * airStatus). The job auto-completes once the shipment is DELIVERED.
   */
  private async syncAirShipmentFromEvents(
    em: EntityManager,
    job: TrackingJob,
    carrierResult: CarrierResultSummary,
    bicConfig: BicConfig | null,
  ): Promise<{ shipmentsCreated: number; shipmentsUpdated: number; allComplete: boolean }> {
    const allEvents = await em.find(
      TrackingEvent,
      { trackingJob: job },
      { orderBy: { eventDateTime: 'asc' } },
    )

    const existing = await em.find(Shipment, { trackingJob: job, deletedAt: null })
    let shipment = existing[0]
    let shipmentsCreated = 0
    let isNew = false

    if (!shipment) {
      shipment = em.create(Shipment, {
        organizationId: job.organizationId,
        tenantId: job.tenantId,
        trackingJob: job,
        carrierCode: job.carrierCode,
        mode: 'air',
        awbNumber: carrierResult.awbNumber ?? job.referenceValue,
        originLocation: job.originUnlocode ? createBasicLocation(job.originUnlocode) : null,
        destinationLocation: job.destinationUnlocode ? createBasicLocation(job.destinationUnlocode) : null,
        status: deriveAirShipmentStatus(carrierResult.airStatus, 'PENDING') as ShipmentStatusEnum,
      })
      em.persist(shipment)
      shipmentsCreated = 1
      isNew = true
      trackingLogger.info('Auto-created air Shipment', {
        shipmentId: shipment.id,
        awbNumber: shipment.awbNumber,
        trackingJobId: job.id,
      })
    }

    // Latest flight/airline metadata wins (backfill on new, refresh on existing).
    if (carrierResult.flightNumber) shipment.flightNumber = carrierResult.flightNumber
    if (carrierResult.airlineCode) shipment.airlineCode = carrierResult.airlineCode
    if (carrierResult.airlineName) shipment.airlineName = carrierResult.airlineName
    if (!shipment.awbNumber && carrierResult.awbNumber) shipment.awbNumber = carrierResult.awbNumber
    // Merge provider shipment-level metadata (ShipsGo air cargo / status_extended) into extra.
    if (carrierResult.extra) {
      shipment.extra = { ...(shipment.extra ?? {}), ...carrierResult.extra }
    }

    const statusChanges: Array<{ shipment: Shipment; previousStatus: string; newStatus: string }> = []
    const etaChanges: Array<{ shipment: Shipment; previousEta: Date; newEta: Date }> = []
    const etdChanges: Array<{ shipment: Shipment; previousEtd: Date; newEtd: Date }> = []

    let shipmentsUpdated = 0
    if (allEvents.length > 0) {
      const result = await this.deriveShipmentStateFromEvents(
        em, shipment, allEvents, bicConfig, carrierResult.airStatus ?? null,
      )
      if (result.changed) {
        shipmentsUpdated = 1
        if (result.statusChange) statusChanges.push({ shipment, ...result.statusChange })
        if (result.etaChange) etaChanges.push({ shipment, ...result.etaChange })
        if (result.etdChange) etdChanges.push({ shipment, ...result.etdChange })
      }
    } else if (carrierResult.airStatus) {
      // No movements yet — still reflect the ShipsGo top-level status.
      const next = deriveAirShipmentStatus(carrierResult.airStatus, shipment.status)
      if (next !== shipment.status) {
        statusChanges.push({ shipment, previousStatus: shipment.status, newStatus: next })
        shipment.status = next as ShipmentStatusEnum
        shipmentsUpdated = 1
      }
    }

    await em.flush()

    if (isNew) {
      await this.deps.eventBus.emit('shipment_tracking.shipment.created', {
        id: shipment.id,
        awbNumber: shipment.awbNumber,
        trackingJobId: job.id,
        tenantId: job.tenantId,
        organizationId: job.organizationId,
      })
    }
    await this.emitShipmentDerivedChanges([shipment], statusChanges, etaChanges, etdChanges)

    // Air completes on DELIVERED, or — the backup, mirroring the ocean stale
    // cutoff — once it has ARRIVED and its latest movement is older than
    // STALE_AFTER_ARRIVAL_DAYS. Air last-mile delivery is frequently untracked,
    // so without this an ARRIVED-but-never-DELIVERED shipment would poll forever.
    const latestEventAt = allEvents.length > 0 ? allEvents[allEvents.length - 1].eventDateTime : null
    const staleArrived =
      shipment.status === 'ARRIVED' && latestEventAt != null && latestEventAt < staleArrivalCutoff()

    return {
      shipmentsCreated,
      shipmentsUpdated,
      allComplete: shipment.status === 'DELIVERED' || staleArrived,
    }
  }

  private async syncShipmentsFromEvents(
    em: EntityManager,
    job: TrackingJob,
    carrierResult: CarrierResultSummary,
    bicConfig: BicConfig | null,
  ): Promise<{ shipmentsCreated: number; shipmentsUpdated: number; allComplete: boolean }> {
    // Air jobs have no container/equipment model — one AWB-keyed Shipment.
    if (job.mode === 'air') {
      return this.syncAirShipmentFromEvents(em, job, carrierResult, bicConfig)
    }

    // Get all events for this job
    const allEvents = await em.find(
      TrackingEvent,
      { trackingJob: job },
      { orderBy: { eventDateTime: 'asc' } },
    )

    if (allEvents.length === 0) {
      return { shipmentsCreated: 0, shipmentsUpdated: 0, allComplete: false }
    }

    // Extract unique container numbers (equipmentReferences) from EQUIPMENT events
    const containerNumbers = new Set<string>()
    for (const event of allEvents) {
      if (event.eventType === 'EQUIPMENT' && event.equipmentReference) {
        containerNumbers.add(event.equipmentReference)
      }
    }

    // For container-based tracking with no equipment events yet, use the reference value
    if (containerNumbers.size === 0 && job.referenceType === 'container') {
      containerNumbers.add(job.referenceValue)
    }

    // If still no containers found, nothing to do yet
    if (containerNumbers.size === 0) {
      return { shipmentsCreated: 0, shipmentsUpdated: 0, allComplete: false }
    }

    // Load existing shipments for this job
    const existingShipments = await em.find(Shipment, {
      trackingJob: job,
      deletedAt: null,
    })
    const shipmentsByContainer = new Map(
      existingShipments.map((s) => [s.containerNumber, s]),
    )

    let shipmentsCreated = 0
    let shipmentsUpdated = 0

    // Track shipments that need events emitted after flush
    const newShipments: Array<{ shipment: Shipment; containerNumber: string }> = []
    const statusChanges: Array<{
      shipment: Shipment
      previousStatus: string
      newStatus: string
    }> = []
    const etaChanges: Array<{
      shipment: Shipment
      previousEta: Date
      newEta: Date
    }> = []
    const etdChanges: Array<{
      shipment: Shipment
      previousEtd: Date
      newEtd: Date
    }> = []

    // Create or update shipments for each container
    for (const containerNumber of containerNumbers) {
      let shipment = shipmentsByContainer.get(containerNumber)

      if (!shipment) {
        // Create new shipment - inherit origin/destination from tracking job
        shipment = em.create(Shipment, {
          organizationId: job.organizationId,
          tenantId: job.tenantId,
          trackingJob: job,
          carrierCode: job.carrierCode,
          containerNumber,
          bookingNumber: job.referenceType === 'booking' ? job.referenceValue : carrierResult.bookingNumber,
          bolNumber: job.referenceType === 'bol' ? job.referenceValue : carrierResult.bolNumber,
          // Initialize with basic location from job's UN/LOCODE if available
          // Will be enriched with full facility data from events later
          originLocation: job.originUnlocode ? createBasicLocation(job.originUnlocode) : null,
          destinationLocation: job.destinationUnlocode ? createBasicLocation(job.destinationUnlocode) : null,
          status: 'PENDING',
        })
        em.persist(shipment)
        shipmentsByContainer.set(containerNumber, shipment)
        shipmentsCreated++
        newShipments.push({ shipment, containerNumber })

        trackingLogger.info('Auto-created Shipment', {
          shipmentId: shipment.id,
          containerNumber,
          trackingJobId: job.id,
          carrierCode: job.carrierCode,
        })
      }

      // Backfill booking/BOL number from carrier result if still missing
      if (!shipment.bookingNumber && carrierResult.bookingNumber) {
        shipment.bookingNumber = carrierResult.bookingNumber
      }
      if (!shipment.bolNumber && carrierResult.bolNumber) {
        shipment.bolNumber = carrierResult.bolNumber
      }
      // Merge provider shipment-level metadata (ShipsGo route summary) into extra.
      if (carrierResult.extra) {
        shipment.extra = { ...(shipment.extra ?? {}), ...carrierResult.extra }
      }

      // Update shipment state from events
      const result = await this.deriveShipmentStateFromEvents(em, shipment, allEvents, bicConfig)
      if (result.changed) {
        shipmentsUpdated++
        if (result.statusChange) {
          statusChanges.push({
            shipment,
            previousStatus: result.statusChange.previousStatus,
            newStatus: result.statusChange.newStatus,
          })
        }
        if (result.etaChange) {
          etaChanges.push({
            shipment,
            previousEta: result.etaChange.previousEta,
            newEta: result.etaChange.newEta,
          })
        }
        if (result.etdChange) {
          etdChanges.push({
            shipment,
            previousEtd: result.etdChange.previousEtd,
            newEtd: result.etdChange.newEtd,
          })
        }
      }
    }

    // Flush all changes to database BEFORE emitting events
    await em.flush()

    // Now emit events - shipments are committed and can be fetched by subscribers
    for (const { shipment, containerNumber } of newShipments) {
      await this.deps.eventBus.emit('shipment_tracking.shipment.created', {
        id: shipment.id,
        containerNumber,
        trackingJobId: job.id,
        tenantId: job.tenantId,
        organizationId: job.organizationId,
      })
    }

    // Emit status/timestamp change events (shared with the real-time AIS refresh path)
    const polledShipments = [...containerNumbers]
      .map((cn) => shipmentsByContainer.get(cn))
      .filter((s): s is Shipment => s != null)
    await this.emitShipmentDerivedChanges(polledShipments, statusChanges, etaChanges, etdChanges)

    // Whole shipment done once every tracked container has completed its
    // journey (empty return for DCSA carriers, delivery for COSCO), OR — as a
    // backup when that event never arrives — once it arrived at its destination
    // port more than STALE_AFTER_ARRIVAL_DAYS ago.
    const allComplete =
      allContainersComplete(allEvents, containerNumbers) ||
      destinationArrivedBefore(allEvents, job.destinationUnlocode, staleArrivalCutoff())

    return { shipmentsCreated, shipmentsUpdated, allComplete }
  }

  /**
   * Emit the shipment status/lifecycle/timestamp change events produced by a round of
   * deriveShipmentStateFromEvents. Shared by the carrier poll (syncShipmentsFromEvents)
   * and the real-time AIS refresh (refreshShipmentsFromEvents) so both paths surface the
   * same downstream events. Call AFTER flushing so subscribers can fetch committed rows.
   *
   * @param updatedShipments - shipments to emit a bare `shipment.updated` for when they
   *   did not also produce a status change (status changes already emit `updated`).
   */
  private async emitShipmentDerivedChanges(
    updatedShipments: Shipment[],
    statusChanges: Array<{ shipment: Shipment; previousStatus: string; newStatus: string }>,
    etaChanges: Array<{ shipment: Shipment; previousEta: Date; newEta: Date }>,
    etdChanges: Array<{ shipment: Shipment; previousEtd: Date; newEtd: Date }>,
  ): Promise<void> {
    for (const { shipment, previousStatus, newStatus } of statusChanges) {
      await this.deps.eventBus.emit('shipment_tracking.shipment.status_changed', {
        id: shipment.id,
        previousStatus,
        newStatus,
        tenantId: shipment.tenantId,
        organizationId: shipment.organizationId,
      })

      // Emit specific lifecycle events
      if (newStatus === 'BOOKED' && previousStatus === 'PENDING') {
        await this.deps.eventBus.emit('shipment_tracking.shipment.booked', {
          id: shipment.id,
          tenantId: shipment.tenantId,
          organizationId: shipment.organizationId,
        })
      }

      if (newStatus === 'PRE_ARRIVAL') {
        await this.deps.eventBus.emit('shipment_tracking.shipment.pre_arrival', {
          id: shipment.id,
          tenantId: shipment.tenantId,
          organizationId: shipment.organizationId,
        })
      }

      if (newStatus === 'DELIVERED') {
        await this.deps.eventBus.emit('shipment_tracking.shipment.delivered', {
          id: shipment.id,
          tenantId: shipment.tenantId,
          organizationId: shipment.organizationId,
        })
      }

      await this.deps.eventBus.emit('shipment_tracking.shipment.updated', {
        id: shipment.id,
        tenantId: shipment.tenantId,
        organizationId: shipment.organizationId,
      })
    }

    // Emit shipment.updated for shipments that had data changes but no status change
    // (status changes already emit updated above). This ensures cross-module subscribers
    // (e.g., fms_files leg sync) pick up vessel info, timestamps, booking numbers, etc.
    const alreadyEmittedIds = new Set(statusChanges.map((sc) => sc.shipment.id))
    for (const shipment of updatedShipments) {
      if (!alreadyEmittedIds.has(shipment.id)) {
        await this.deps.eventBus.emit('shipment_tracking.shipment.updated', {
          id: shipment.id,
          tenantId: shipment.tenantId,
          organizationId: shipment.organizationId,
        })
      }
    }

    // Emit ETA change events
    for (const { shipment, previousEta, newEta } of etaChanges) {
      await this.deps.eventBus.emit('shipment_tracking.transport.eta_updated', {
        id: shipment.id,
        previousEta: previousEta.toISOString(),
        newEta: newEta.toISOString(),
        tenantId: shipment.tenantId,
        organizationId: shipment.organizationId,
      })
    }

    // Emit ETD change events
    for (const { shipment, previousEtd, newEtd } of etdChanges) {
      await this.deps.eventBus.emit('shipment_tracking.transport.etd_updated', {
        id: shipment.id,
        previousEtd: previousEtd.toISOString(),
        newEtd: newEtd.toISOString(),
        tenantId: shipment.tenantId,
        organizationId: shipment.organizationId,
      })
    }
  }

  /**
   * Re-derive denormalized state (cargoEvents, routeStops, status, ETA/ETD/ATA/ATD, seals,
   * locations) for a tracking job's shipments from their persisted TrackingEvents, then emit
   * the resulting change events. Used by real-time ingestion (e.g. AIS POI events over NATS)
   * so the Journey Timeline and derived state update immediately instead of waiting for the
   * next carrier poll. Idempotent: deriveShipmentStateFromEvents is a no-op when nothing changed.
   *
   * @param em - entity manager managing the (already flushed) new TrackingEvents
   * @param trackingJobId - the job whose shipments to refresh
   * @param shipmentIds - optional subset; defaults to all of the job's shipments
   */
  async refreshShipmentsFromEvents(
    em: EntityManager,
    trackingJobId: string,
    shipmentIds?: string[],
  ): Promise<void> {
    const job = await em.findOne(TrackingJob, { id: trackingJobId })
    if (!job) return

    // Air shipments derive status from ShipsGo's top-level air status during the
    // poll (deriveAirShipmentStatus), not from DCSA/AIS vessel events. Running
    // the DCSA re-derive here (no airStatus) would mis-set them. AIS is
    // vessel-only, so an air job should never reach this path — guard anyway.
    if (job.mode === 'air') return

    const shipments = shipmentIds && shipmentIds.length > 0
      ? await em.find(Shipment, { trackingJob: job, deletedAt: null, id: { $in: shipmentIds } })
      : await em.find(Shipment, { trackingJob: job, deletedAt: null })
    if (shipments.length === 0) return

    const allEvents = await em.find(
      TrackingEvent,
      { trackingJob: job },
      { orderBy: { eventDateTime: 'asc' } },
    )
    if (allEvents.length === 0) return

    const bicConfig = await this.loadBicConfig(em, {
      organizationId: job.organizationId,
      tenantId: job.tenantId,
    })

    const statusChanges: Array<{ shipment: Shipment; previousStatus: string; newStatus: string }> = []
    const etaChanges: Array<{ shipment: Shipment; previousEta: Date; newEta: Date }> = []
    const etdChanges: Array<{ shipment: Shipment; previousEtd: Date; newEtd: Date }> = []
    const changedShipments: Shipment[] = []

    for (const shipment of shipments) {
      const result = await this.deriveShipmentStateFromEvents(em, shipment, allEvents, bicConfig)
      if (!result.changed) continue
      changedShipments.push(shipment)
      if (result.statusChange) statusChanges.push({ shipment, ...result.statusChange })
      if (result.etaChange) etaChanges.push({ shipment, ...result.etaChange })
      if (result.etdChange) etdChanges.push({ shipment, ...result.etdChange })
    }

    if (changedShipments.length === 0) return

    await em.flush()
    await this.emitShipmentDerivedChanges(changedShipments, statusChanges, etaChanges, etdChanges)
  }

  /**
   * Derives and updates Shipment state from TrackingEvents.
   * Filters events by equipmentReference to get container-specific events.
   * TRANSPORT events (no equipmentReference) apply to all containers.
   * 
   * Returns status change info and time changes so caller can emit events after flush.
   */
  private async deriveShipmentStateFromEvents(
    em: EntityManager,
    shipment: Shipment,
    allEvents: TrackingEvent[],
    bicConfig: BicConfig | null,
    airStatus?: string | null,
  ): Promise<{
    changed: boolean
    statusChange?: { previousStatus: string; newStatus: string }
    etaChange?: { previousEta: Date; newEta: Date }
    etdChange?: { previousEtd: Date; newEtd: Date }
  }> {
    // Filter events for this specific container
    // Include EQUIPMENT events with matching equipmentReference
    // Include TRANSPORT events (they apply to all containers)
    const containerEvents = allEvents.filter((event) => {
      if (event.eventType === 'TRANSPORT') return true
      if (event.eventType === 'EQUIPMENT') {
        return event.equipmentReference === shipment.containerNumber
      }
      return false
    })

    if (containerEvents.length === 0) {
      return { changed: false }
    }

    // Get UN/LOCODEs from JSONB location objects
    const originUnlocode = shipment.originLocation?.unlocode ?? null
    const destinationUnlocode = shipment.destinationLocation?.unlocode ?? null
    
    const context = {
      originUnlocode,
      destinationUnlocode,
    }

    // Extract times from events first - needed for both status derivation and updates
    const times = extractShipmentTimes(
      containerEvents.map((event) => ({
        eventCode: event.eventCode,
        eventClassifierCode: event.eventClassifierCode,
        eventDateTime: event.eventDateTime,
        eventDateTimeOffset: event.eventDateTimeOffset,
        eventCreatedDateTime: event.eventCreatedDateTime,
        locationUnlocode: event.locationUnlocode,
      })),
      context,
    )

    // Get latest event for lastEventAt
    const latestEvent = containerEvents[containerEvents.length - 1]

    // Find latest event with vessel info (gate operations often don't have vessel data)
    const latestVesselInfo = findLatestVesselInfo(containerEvents)

    // Track previous primary timestamp values for change detection
    const previousEta = getPrimaryTimestampValue(shipment.etaTimestamps)
    const previousEtd = getPrimaryTimestampValue(shipment.etdTimestamps)
    const previousAtd = getPrimaryTimestampValue(shipment.atdTimestamps)
    const previousAta = getPrimaryTimestampValue(shipment.ataTimestamps)

    // Merge extracted timestamps into existing arrays (with deduplication)
    const mergedTimestamps = mergeExtractedTimestamps(
      {
        etdTimestamps: shipment.etdTimestamps,
        etaTimestamps: shipment.etaTimestamps,
        atdTimestamps: shipment.atdTimestamps,
        ataTimestamps: shipment.ataTimestamps,
      },
      times,
      'carrier_api',
      latestEvent?.sourceEventId,
    )

    // Get new primary values after merge
    const newEta = getPrimaryTimestampValue(mergedTimestamps.etaTimestamps)
    const newEtd = getPrimaryTimestampValue(mergedTimestamps.etdTimestamps)
    const newAtd = getPrimaryTimestampValue(mergedTimestamps.atdTimestamps)
    const newAta = getPrimaryTimestampValue(mergedTimestamps.ataTimestamps)

    // Derive status. Air (mode='air') has no container/vessel movement model, so
    // its status comes from ShipsGo's top-level status (LANDED→ARRIVED, …) rather
    // than DCSA event-location matching. Ocean/carrier use the DCSA status machine
    // with a time context for the PRE_ARRIVAL upgrade.
    const previousStatus = shipment.status
    const newStatus = airStatus !== undefined
      ? deriveAirShipmentStatus(airStatus, shipment.status)
      : deriveShipmentStatus(
          containerEvents.map((event) => ({
            eventCode: event.eventCode,
            eventClassifierCode: event.eventClassifierCode,
            locationUnlocode: event.locationUnlocode,
          })),
          context,
          shipment.status,
          { eta: newEta, ata: newAta },
        )

    // Check if ETA/ETD changed (compare timestamps, handle null)
    const etaChanged = newEta && previousEta && newEta.getTime() !== previousEta.getTime()
    const etdChanged = newEtd && previousEtd && newEtd.getTime() !== previousEtd.getTime()

    // Check if anything changed.
    // Includes an event-count delta so that appending events which don't move any derived
    // value (e.g. AIS POI port/terminal events, whose codes aren't read by time/status
    // extraction) still triggers a denormalized cargoEvents/routeStops rebuild — otherwise
    // they'd never reach the Journey Timeline.
    const changed =
      previousStatus !== newStatus ||
      mergedTimestamps.changed ||
      (newEtd && !previousEtd) || etdChanged ||
      (newEta && !previousEta) || etaChanged ||
      (newAtd && !previousAtd) || (newAtd && previousAtd && newAtd.getTime() !== previousAtd.getTime()) ||
      (newAta && !previousAta) || (newAta && previousAta && newAta.getTime() !== previousAta.getTime()) ||
      shipment.vesselName !== latestEvent?.vesselName ||
      containerEvents.length !== shipment.eventCount

    if (!changed) {
      return { changed: false }
    }

    // Update shipment
    shipment.status = newStatus as ShipmentStatusEnum

    // Update timestamp arrays
    shipment.etdTimestamps = mergedTimestamps.etdTimestamps
    shipment.etaTimestamps = mergedTimestamps.etaTimestamps
    shipment.atdTimestamps = mergedTimestamps.atdTimestamps
    shipment.ataTimestamps = mergedTimestamps.ataTimestamps

    // Update vessel info from latest event with vessel data
    if (latestVesselInfo) {
      shipment.vesselName = latestVesselInfo.vesselName ?? shipment.vesselName
      shipment.vesselImo = latestVesselInfo.vesselImo ?? shipment.vesselImo
      shipment.voyageNumber = latestVesselInfo.voyageNumber ?? shipment.voyageNumber
    }

    // Extract ISO equipment code from the first EQUIPMENT event that has it
    if (!shipment.isoEquipmentCode) {
      const eventWithIsoCode = containerEvents.find(e => e.isoEquipmentCode)
      if (eventWithIsoCode) {
        shipment.isoEquipmentCode = eventWithIsoCode.isoEquipmentCode
      }
    }

    // Extract booking number from document references if not already set
    if (!shipment.bookingNumber) {
      for (const event of containerEvents) {
        const bkgRef = event.relatedDocumentReferences?.find(ref => ref.type === 'BKG')
        if (bkgRef?.value) {
          shipment.bookingNumber = bkgRef.value
          break
        }
      }
    }

    // Extract BOL number from document references if not already set
    if (!shipment.bolNumber) {
      for (const event of containerEvents) {
        const bolRef = event.relatedDocumentReferences?.find(ref => ref.type === 'TRD' || ref.type === 'SHI')
        if (bolRef?.value) {
          shipment.bolNumber = bolRef.value
          break
        }
      }
    }

    // Update lastEventAt from actual latest event
    if (latestEvent) {
      shipment.lastEventAt = latestEvent.eventDateTime
    }

    shipment.eventCount = containerEvents.length

    // ─── Denormalize cargo events and route stops ────────────────────
    // Map TrackingEvent entities to CargoEventEntry format for JSONB storage
    const cargoEvents = containerEvents.map(mapTrackingEventToEntry)
    shipment.cargoEvents = cargoEvents

    // Extract route stops from the mapped events
    shipment.routeStops = extractRouteFromEvents(cargoEvents, {
      originUnlocode,
      destinationUnlocode,
    })

    // ─── Aggregate seals from all events ─────────────────────────────
    // Collect all unique seals seen across all cargo events for this container.
    // Deduplicate by seal number, keeping the most recent occurrence.
    const allSeals = containerEvents
      .flatMap(e => e.seals ?? [])
      .filter(seal => seal.number) // Ensure valid seal with number
    
    if (allSeals.length > 0) {
      // Deduplicate by seal number - later occurrences (newer events) win
      const seenSeals = new Map<string, typeof allSeals[0]>()
      for (const seal of allSeals) {
        seenSeals.set(seal.number, seal)
      }
      shipment.seals = Array.from(seenSeals.values())
    } else {
      shipment.seals = null
    }

    // ─── Build rich origin/destination locations ────────────────────
    // Find the best event for origin using priority:
    // 1. LOAD event at origin (actual loading at terminal)
    // 2. Any event at origin with facilityCode (terminal data available)
    // 3. Fallback: any event at origin location
    const originEventsAtLocation = containerEvents.filter(e => 
      e.locationUnlocode === originUnlocode
    )
    const originEvent = 
      // Priority 1: LOAD event at origin
      originEventsAtLocation.find(e => e.eventCode === 'LOAD' && e.eventClassifierCode === 'ACT') ??
      // Priority 2: Any event with facility code at origin
      originEventsAtLocation.find(e => e.facilityCode != null) ??
      // Fallback: First event at origin, or LOAD event anywhere if no origin specified
      originEventsAtLocation[0] ??
      (!originUnlocode ? containerEvents.find(e => e.eventCode === 'LOAD' && e.eventClassifierCode === 'ACT') : null)
    
    // Find the best event for destination using priority:
    // 1. DISC event at destination (actual discharge at terminal)
    // 2. Any event at destination with facilityCode (terminal data available)
    // 3. Fallback: last event at destination location
    const destEventsAtLocation = containerEvents.filter(e => 
      e.locationUnlocode === destinationUnlocode
    )
    const destEventsReversed = [...destEventsAtLocation].reverse()
    const destEvent = 
      // Priority 1: DISC event at destination (last one)
      destEventsReversed.find(e => e.eventCode === 'DISC' && e.eventClassifierCode === 'ACT') ??
      // Priority 2: Any event with facility code at destination (last one)
      destEventsReversed.find(e => e.facilityCode != null) ??
      // Fallback: Last event at destination, or DISC/ARRI event anywhere if no destination specified
      destEventsReversed[0] ??
      (!destinationUnlocode ? [...containerEvents].reverse().find(e => (e.eventCode === 'DISC' || e.eventCode === 'ARRI') && e.eventClassifierCode === 'ACT') : null)

    if (originEvent) {
      shipment.originLocation = buildLocationFromEvent({
        locationName: originEvent.locationName,
        locationUnlocode: originEvent.locationUnlocode,
        locationCountry: originEvent.locationCountry,
        facilityCode: originEvent.facilityCode,
        facilityCodeListProvider: originEvent.facilityCodeListProvider,
        facilityTypeCode: originEvent.facilityTypeCode,
        facilityAddress: originEvent.facilityAddress,
        latitude: originEvent.latitude,
        longitude: originEvent.longitude,
      })
    }

    if (destEvent) {
      shipment.destinationLocation = buildLocationFromEvent({
        locationName: destEvent.locationName,
        locationUnlocode: destEvent.locationUnlocode,
        locationCountry: destEvent.locationCountry,
        facilityCode: destEvent.facilityCode,
        facilityCodeListProvider: destEvent.facilityCodeListProvider,
        facilityTypeCode: destEvent.facilityTypeCode,
        facilityAddress: destEvent.facilityAddress,
        latitude: destEvent.latitude,
        longitude: destEvent.longitude,
      })
    }

    // ─── Enrich locations with BIC Facility API data ─────────────────
    // Only enrich if BIC config is enabled and locations are incomplete
    if (bicConfig) {
      await this.enrichShipmentLocationsWithBic(shipment, containerEvents, bicConfig)
    }

    // ─── Apply location overrides ─────────────────────────────────────
    // Overrides take priority over BIC data and allow correcting incorrect terminal info
    const scope = { organizationId: shipment.organizationId, tenantId: shipment.tenantId }
    const carrierCode = shipment.carrierCode?.toUpperCase() ?? null

    shipment.originLocation = await applyLocationOverrideIfExists(
      em, shipment.originLocation, carrierCode, scope
    )
    shipment.destinationLocation = await applyLocationOverrideIfExists(
      em, shipment.destinationLocation, carrierCode, scope
    )

    // Apply overrides to route stops
    if (shipment.routeStops) {
      for (const stop of shipment.routeStops) {
        if (stop.facilityCode && stop.facilityCodeListProvider) {
          const overridden = await applyLocationOverrideIfExists(em, {
            name: stop.location,
            unlocode: stop.unlocode ?? null,
            countryCode: stop.unlocode?.slice(0, 2) ?? null,
            facilityCode: stop.facilityCode,
            facilityCodeListProvider: stop.facilityCodeListProvider,
            facilityTypeCode: stop.facilityTypeCode ?? null,
            address: stop.facilityAddress ?? null,
            coords: stop.coords ?? null,
            operatorName: null,
            source: 'dcsa',
          }, carrierCode, scope)
          if (overridden && overridden.source === 'manual') {
            stop.location = overridden.name
            stop.facilityAddress = overridden.address
            stop.coords = overridden.coords
          }
        }
      }
    }

    // Return change info so caller can emit events after flush
    const statusChange = previousStatus !== newStatus
      ? { previousStatus, newStatus }
      : undefined

    // Only report ETA/ETD changes when the value actually changed (not initial set)
    const etaChange = etaChanged && previousEta && newEta
      ? { previousEta, newEta }
      : undefined

    const etdChange = etdChanged && previousEtd && newEtd
      ? { previousEtd, newEtd }
      : undefined

    return { changed: true, statusChange, etaChange, etdChange }
  }

  /**
   * Emits events for a newly created TrackingEvent.
   */
  private async emitTrackingEventCreated(
    event: TrackingEvent,
    job: TrackingJob,
  ): Promise<void> {
    const eventPayload = {
      id: event.id,
      trackingJobId: job.id,
      tenantId: event.tenantId,
      organizationId: event.organizationId,

      // Source
      source: event.source,
      sourceEventId: event.sourceEventId,

      // Core event fields
      eventType: event.eventType,
      eventCode: event.eventCode,
      eventClassifierCode: event.eventClassifierCode,
      eventDateTime: event.eventDateTime?.toISOString(),
      description: event.description,

      // Equipment fields
      equipmentReference: event.equipmentReference,
      isoEquipmentCode: event.isoEquipmentCode,
      emptyIndicatorCode: event.emptyIndicatorCode,
      isTransshipmentMove: event.isTransshipmentMove,

      // Location fields
      locationName: event.locationName,
      locationUnlocode: event.locationUnlocode,
      locationCountry: event.locationCountry,
      facilityCode: event.facilityCode,
      facilityTypeCode: event.facilityTypeCode,

      // Transport call fields
      vesselName: event.vesselName,
      vesselImo: event.vesselImo,
      voyageNumber: event.voyageNumber,
      carrierServiceCode: event.carrierServiceCode,
      modeOfTransport: event.modeOfTransport,

      // Document references
      relatedDocumentReferences: event.relatedDocumentReferences,

      // Metadata
      publisherName: event.publisherName,
      publisherRole: event.publisherRole,
    }

    // Always emit generic event for backward compatibility
    await this.deps.eventBus.emit('shipment_tracking.tracking_event.created', eventPayload)

    // Emit granular DCSA-compliant event if significant milestone
    if (isSignificantMilestone({
      eventType: event.eventType,
      eventCode: event.eventCode,
      eventClassifierCode: event.eventClassifierCode,
    })) {
      const dcsaEventType = mapDcsaEventToWebhookType({
        eventType: event.eventType,
        eventCode: event.eventCode,
        eventClassifierCode: event.eventClassifierCode,
      })

      await this.deps.eventBus.emit(dcsaEventType, eventPayload)
    }
  }

  /**
   * Loads BIC Facility API configuration for a tenant/organization.
   */
  private async loadBicConfig(
    em: EntityManager,
    scope: { tenantId: string; organizationId: string },
  ): Promise<BicConfig | null> {
    return findOneWithDecryption(
      em,
      BicConfig,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        isEnabled: true,
      },
      undefined,
      scope,
    )
  }

  /**
   * Enriches shipment origin/destination locations and route stops with BIC Facility API data.
   * Only fetches data for facilities that are incomplete (missing coords or address).
   * One API call per unique facility code per poll.
   */
  private async enrichShipmentLocationsWithBic(
    shipment: Shipment,
    events: TrackingEvent[],
    bicConfig: BicConfig,
  ): Promise<void> {
    // Collect unique facility codes that need enrichment
    const facilitiesToEnrich = new Map<string, { code: string; provider: FacilityCodeListProvider; unlocode: string }>()

    // Check origin location
    if (shipment.originLocation && !isLocationComplete(shipment.originLocation) && shipment.originLocation.facilityCode) {
      const provider = shipment.originLocation.facilityCodeListProvider ?? 'SMDG'
      facilitiesToEnrich.set(shipment.originLocation.facilityCode, {
        code: shipment.originLocation.facilityCode,
        provider,
        unlocode: shipment.originLocation.unlocode ?? '',
      })
    }

    // Check destination location
    if (shipment.destinationLocation && !isLocationComplete(shipment.destinationLocation) && shipment.destinationLocation.facilityCode) {
      const provider = shipment.destinationLocation.facilityCodeListProvider ?? 'SMDG'
      facilitiesToEnrich.set(shipment.destinationLocation.facilityCode, {
        code: shipment.destinationLocation.facilityCode,
        provider,
        unlocode: shipment.destinationLocation.unlocode ?? '',
      })
    }

    // Check events for facility codes (for route stops enrichment)
    for (const event of events) {
      if (event.facilityCode && event.latitude == null && !event.facilityAddress) {
        const provider = event.facilityCodeListProvider ?? 'SMDG'
        if (!facilitiesToEnrich.has(event.facilityCode)) {
          facilitiesToEnrich.set(event.facilityCode, {
            code: event.facilityCode,
            provider,
            unlocode: event.locationUnlocode ?? '',
          })
        }
      }
    }

    if (facilitiesToEnrich.size === 0) {
      return
    }

    // Create BIC API client
    const client = new BicApiClient({
      baseUrl: bicConfig.baseUrl,
      username: bicConfig.username,
      password: bicConfig.password,
    })

    // Fetch facility data (one call per unique facility)
    const facilityMap = new Map<string, BicFacility>()
    for (const [code, info] of facilitiesToEnrich) {
      try {
        const facility = await client.getFacility(info.code, info.provider, info.unlocode)
        if (facility) {
          facilityMap.set(code, facility)
        }
      } catch (error) {
        trackingLogger.error('Failed to fetch BIC facility', {
          facilityCode: code,
          codeProvider: info.provider,
          unlocode: info.unlocode,
          shipmentId: shipment.id,
          error: error instanceof Error ? error.message : String(error),
        })
        // Continue with other facilities - don't fail the whole enrichment
      }
    }

    if (facilityMap.size === 0) {
      return
    }

    // Enrich origin location
    if (shipment.originLocation?.facilityCode && facilityMap.has(shipment.originLocation.facilityCode)) {
      const bic = facilityMap.get(shipment.originLocation.facilityCode)!
      shipment.originLocation = this.mergeLocationWithBicFacility(shipment.originLocation, bic)
    }

    // Enrich destination location
    if (shipment.destinationLocation?.facilityCode && facilityMap.has(shipment.destinationLocation.facilityCode)) {
      const bic = facilityMap.get(shipment.destinationLocation.facilityCode)!
      shipment.destinationLocation = this.mergeLocationWithBicFacility(shipment.destinationLocation, bic)
    }

    // Enrich route stops
    if (shipment.routeStops) {
      for (const stop of shipment.routeStops) {
        if (stop.facilityCode && facilityMap.has(stop.facilityCode)) {
          const bic = facilityMap.get(stop.facilityCode)!
          const coords = BicApiClient.parseCoordinates(bic)
          const address = BicApiClient.formatAddress(bic)
          
          if (!stop.coords && coords) {
            stop.coords = coords
          }
          if (!stop.facilityAddress && address) {
            stop.facilityAddress = address
          }
        }
      }
    }

    // Enrich cargo events
    if (shipment.cargoEvents) {
      for (const event of shipment.cargoEvents) {
        if (event.facilityCode && facilityMap.has(event.facilityCode)) {
          const bic = facilityMap.get(event.facilityCode)!
          const coords = BicApiClient.parseCoordinates(bic)
          const address = BicApiClient.formatAddress(bic)
          
          if (event.latitude == null && coords) {
            event.latitude = coords.latitude
            event.longitude = coords.longitude
          }
          if (!event.facilityAddress && address) {
            event.facilityAddress = address
          }
        }
      }
    }
  }

  /**
   * Merges BIC facility data into a FacilityLocation (only fills missing fields).
   */
  private mergeLocationWithBicFacility(location: FacilityLocation, bic: BicFacility): FacilityLocation {
    const coords = BicApiClient.parseCoordinates(bic)
    const address = BicApiClient.formatAddress(bic)
    const operatorName = BicApiClient.getOperatorName(bic)
    const facilityName = BicApiClient.getFacilityName(bic)

    return mergeLocationWithBicData(location, {
      name: facilityName ?? undefined,
      address: address ?? undefined,
      coords: coords ?? undefined,
      operatorName: operatorName ?? undefined,
    })
  }

  /**
   * Stops an active tracking job (sets status to 'deactivated').
   * Tenant-scoped: refuses to stop a job not belonging to the caller's tenant.
   * Idempotent: returns { stopped: false } when the job is already inactive,
   * doesn't exist, or belongs to a different tenant.
   */
  async stopTrackingJob(
    jobId: string,
    ctx: { organizationId: string; tenantId: string },
  ): Promise<{ stopped: boolean }> {
    const em = this.deps.em()
    const job = await em.findOne(TrackingJob, {
      id: jobId,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
    })

    if (!job) {
      return { stopped: false }
    }

    if (job.status !== 'active' && job.status !== 'paused') {
      return { stopped: false }
    }

    await this.stopJobInline(em, job)

    trackingLogger.info('Tracking job stopped', {
      trackingJobId: jobId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    return { stopped: true }
  }

  /**
   * Stop a job (target status defaults to `deactivated`) and emit
   * `tracking_job.completed`, operating on the given EntityManager (the job must
   * be managed by it). Shared by the public `stopTrackingJob` (externally
   * stopped → `deactivated`) and the carrier-poll auto-stop (cargo finished →
   * `completed`) so both routes flush + emit identically. Either status is
   * excluded from the `status: 'active'` poll filter, so polling stops.
   */
  private async stopJobInline(
    em: EntityManager,
    job: TrackingJob,
    status: TrackingJobStatusEnum = 'deactivated',
  ): Promise<void> {
    job.status = status
    job.nextPollAt = null
    await em.flush()

    await this.deps.eventBus.emit('shipment_tracking.tracking_job.completed', {
      id: job.id,
      tenantId: job.tenantId,
      organizationId: job.organizationId,
    })
  }

  /**
   * Reconciliation: stops any active TrackingJob that has no folder_legs row
   * referencing it via tracking_job_id. Used by the daily reconciliation cron
   * to clean up orphans created by failed Phase B/C re-tracking flows.
   *
   * Returns { stoppedCount } so the cron can surface to ops.
   * The optional folderLegsTracker param exists so this code can run from
   * @freighttech/shipment-tracking without a hard import on @freighttech/projects:
   * the caller passes a function that returns the set of tracking_job_ids
   * currently referenced by folder_legs.
   */
  async reconcileOrphanedTrackingJobs(
    folderLegTrackingJobIds: Set<string>,
    ctx?: { organizationId?: string; tenantId?: string },
  ): Promise<{ stoppedCount: number; checked: number }> {
    const em = this.deps.em()
    const filter: Record<string, unknown> = {
      status: 'active',
      deletedAt: null,
    }
    if (ctx?.organizationId) filter.organizationId = ctx.organizationId
    if (ctx?.tenantId) filter.tenantId = ctx.tenantId

    const activeJobs = await em.find(TrackingJob, filter)

    let stoppedCount = 0
    for (const job of activeJobs) {
      if (folderLegTrackingJobIds.has(job.id)) continue
      const result = await this.stopTrackingJob(job.id, {
        organizationId: job.organizationId,
        tenantId: job.tenantId,
      })
      if (result.stopped) stoppedCount++
    }

    return { stoppedCount, checked: activeJobs.length }
  }

  /**
   * Records an error on a tracking job.
   */
  /**
   * Backs a job off by `backoffMs` and logs `message` in its error history,
   * WITHOUT touching retryCount. For account-level/transient ShipsGo conditions
   * (402 credits, 429 rate limit, 403 auth) that must not consume the per-job
   * failure budget (which would flip the job to 'failed') nor keep re-hitting an
   * exhausted/throttled account every poll. The job resumes on its own.
   */
  private async recordTransientBackoff(
    em: EntityManager,
    job: TrackingJob,
    message: string,
    backoffMs: number,
  ): Promise<void> {
    const history = job.errorHistory ?? []
    history.push({ date: new Date().toISOString(), message })
    if (history.length > 20) history.splice(0, history.length - 20)
    job.errorHistory = history
    job.lastPollAt = new Date()
    job.nextPollAt = new Date(Date.now() + backoffMs)
    await em.flush()
  }

  /** ShipsGo credit-exhaustion (HTTP 402): back off ~6h until credits are topped up. */
  private async recordCreditExhaustion(em: EntityManager, job: TrackingJob): Promise<void> {
    await this.recordTransientBackoff(em, job, 'ShipsGo credits exhausted (HTTP 402)', 6 * 60 * 60 * 1000)
  }

  private async recordJobError(
    em: EntityManager,
    job: TrackingJob,
    message: string,
  ): Promise<void> {
    const history = job.errorHistory ?? []
    history.push({ date: new Date().toISOString(), message })

    // Keep last 20 errors
    if (history.length > 20) {
      history.splice(0, history.length - 20)
    }

    job.errorHistory = history
    job.retryCount = (job.retryCount || 0) + 1
    job.lastPollAt = new Date()

    // Mark as failed after 10 consecutive errors
    if (job.retryCount >= 10) {
      job.status = 'failed'
      await em.flush()

      await this.deps.eventBus.emit('shipment_tracking.tracking_job.failed', {
        id: job.id,
        carrierCode: job.carrierCode,
        retryCount: job.retryCount,
        lastError: message,
        tenantId: job.tenantId,
        organizationId: job.organizationId,
      })
      return
    }

    await em.flush()
  }
}
