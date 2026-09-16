import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ShipsGoConfig, TrackingJob } from '../data/entities'
import type { CarrierFetchResult } from '../lib/carrier-adapter'
import {
  registerOceanShipment,
  getOceanShipment,
  registerAirShipment,
  getAirShipment,
  type ShipsGoClientConfig,
} from '../lib/shipsgo-client'
import { mapOceanShipmentToEvents, mapAirShipmentToEvents } from '../lib/shipsgo-mapper'
import { trackingLogger } from '../lib/logger'

const DEFAULT_BASE_URL = 'https://api.shipsgo.com/v2'

// Platform-fallback rate limit when no per-tenant row governs the account.
// Kept under ShipsGo's documented 100 req/min account-wide ceiling.
const DEFAULT_RATE_LIMIT = { requests: 60, windowSeconds: 60 } as const

/**
 * Rate-limit identity for the shared platform (env-token) account. All tenants
 * that fall back to SHIPSGO_API_TOKEN hit the SAME ShipsGo account, so they must
 * share ONE rate-limit budget (keyed on this) rather than each getting their own
 * — otherwise N tenants × the per-tenant limit would blow the 100 req/min cap.
 * Tenants with their own ShipsGoConfig row (BYO token) key on their tenant id.
 */
const PLATFORM_RATE_LIMIT_IDENTITY = 'shipsgo:platform-shared'

export type ShipsGoRateLimit = { requests: number; windowSeconds: number }

/** Everything a single poll needs, resolved from ONE config read. */
export type ShipsGoPollContext = {
  config: ShipsGoClientConfig | null
  rateLimit: ShipsGoRateLimit
  /** checkRateLimit identity — per-tenant for BYO tokens, shared for the platform account. */
  rateLimitIdentity: string
}

type ShipsGoProviderDeps = {
  em: () => EntityManager
}

/**
 * ShipsGo aggregator provider — the register-then-poll counterpart to the
 * direct DCSA carrier adapters. Resolves the per-tenant ShipsGo config (or a
 * platform env fallback), registers the shipment on first poll (idempotently,
 * using the tracking-job id as ShipsGo `reference`), then fetches + maps.
 */
export class ShipsGoProvider {
  constructor(private deps: ShipsGoProviderDeps) {}

  /** Loads the tenant's (non-deleted) ShipsGoConfig row, decrypting the token. */
  private async loadRow(scope: { organizationId: string; tenantId: string }): Promise<ShipsGoConfig | null> {
    const em = this.deps.em()
    return findOneWithDecryption(
      em,
      ShipsGoConfig,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  }

  /**
   * Resolves the ShipsGo client config for a tenant scope.
   *
   * A tenant's own ShipsGoConfig row is **authoritative**: if it exists but is
   * disabled (isEnabled/isActive false), has the requested mode off, or has no
   * token, this returns null and does NOT fall back to the shared platform
   * account — otherwise a tenant who turned ShipsGo off would still spend
   * platform credits. The env fallback (SHIPSGO_API_TOKEN / SHIPSGO_BASE_URL)
   * applies only when the tenant has NO config row at all.
   */
  /** Pure row → client config (with env fallback when no row). See resolveConfig. */
  private configFromRow(row: ShipsGoConfig | null, mode: 'ocean' | 'air'): ShipsGoClientConfig | null {
    if (row) {
      if (!row.isEnabled || !row.isActive) return null
      if (mode === 'ocean' && !row.oceanEnabled) return null
      if (mode === 'air' && !row.airEnabled) return null
      if (!row.apiToken) return null
      return { apiToken: row.apiToken, baseUrl: row.baseUrl || DEFAULT_BASE_URL }
    }
    // No per-tenant row → platform env fallback (shared account).
    const envToken = process.env.SHIPSGO_API_TOKEN
    if (envToken) {
      return { apiToken: envToken, baseUrl: process.env.SHIPSGO_BASE_URL || DEFAULT_BASE_URL }
    }
    return null
  }

  /** Pure row → rate limit (row's values, else the platform default). */
  private rateLimitFromRow(row: ShipsGoConfig | null): ShipsGoRateLimit {
    if (row && row.rateLimitRequests > 0 && row.rateLimitWindowSeconds > 0) {
      return { requests: row.rateLimitRequests, windowSeconds: row.rateLimitWindowSeconds }
    }
    return { ...DEFAULT_RATE_LIMIT }
  }

  /**
   * Resolves the ShipsGo client config for a tenant scope.
   *
   * A tenant's own ShipsGoConfig row is **authoritative**: if it exists but is
   * disabled (isEnabled/isActive false), has the requested mode off, or has no
   * token, this returns null and does NOT fall back to the shared platform
   * account — otherwise a tenant who turned ShipsGo off would still spend
   * platform credits. The env fallback (SHIPSGO_API_TOKEN / SHIPSGO_BASE_URL)
   * applies only when the tenant has NO config row at all.
   */
  async resolveConfig(
    scope: { organizationId: string; tenantId: string },
    mode: 'ocean' | 'air',
  ): Promise<ShipsGoClientConfig | null> {
    return this.configFromRow(await this.loadRow(scope), mode)
  }

  /**
   * Per-tenant rate limit for ShipsGo polling. Honors the tenant row's
   * rate_limit_* when present, else the platform default (kept under ShipsGo's
   * 100 req/min account-wide ceiling).
   */
  async resolveRateLimit(scope: { organizationId: string; tenantId: string }): Promise<ShipsGoRateLimit> {
    return this.rateLimitFromRow(await this.loadRow(scope))
  }

  /**
   * Everything a poll needs from a SINGLE config read: the client config, the
   * rate limit, and the rate-limit identity (per-tenant for a BYO token; the
   * shared platform identity when falling back to the env token, so all such
   * tenants share one budget against the one ShipsGo account).
   */
  async resolvePollContext(
    scope: { organizationId: string; tenantId: string },
    mode: 'ocean' | 'air',
  ): Promise<ShipsGoPollContext> {
    const row = await this.loadRow(scope)
    return {
      config: this.configFromRow(row, mode),
      rateLimit: this.rateLimitFromRow(row),
      rateLimitIdentity: row ? scope.tenantId : PLATFORM_RATE_LIMIT_IDENTITY,
    }
  }

  /**
   * Fetches events for a ShipsGo-provider tracking job, registering it first if
   * it has no ShipsGo shipment id yet. Persists the id on the job immediately
   * after registration so a crash mid-poll never re-registers (ShipsGo's 409
   * dedup is a second guard). Branches ocean vs air on `job.mode`.
   *
   * `config` may be passed pre-resolved (the poll resolves it once alongside the
   * rate limit); omit it and the provider resolves it itself.
   */
  async fetchOrRegister(job: TrackingJob, config?: ShipsGoClientConfig | null): Promise<CarrierFetchResult> {
    const resolved = config === undefined
      ? await this.resolveConfig({ organizationId: job.organizationId, tenantId: job.tenantId }, job.mode)
      : config
    if (!resolved) {
      throw new Error(`ShipsGo not configured for tenant (mode=${job.mode})`)
    }

    return job.mode === 'air'
      ? this.fetchOrRegisterAir(job, resolved)
      : this.fetchOrRegisterOcean(job, resolved)
  }

  private async fetchOrRegisterOcean(
    job: TrackingJob,
    config: ShipsGoClientConfig,
  ): Promise<CarrierFetchResult> {
    const em = this.deps.em()

    if (!job.providerShipmentId) {
      const bookingNumber =
        job.referenceType === 'booking' || job.referenceType === 'bol' ? job.referenceValue : null
      const containerNumber = job.referenceType === 'container' ? job.referenceValue : null

      const result = await registerOceanShipment(config, {
        reference: job.id,
        bookingNumber,
        containerNumber,
      })

      job.providerShipmentId = result.id
      await em.flush()

      trackingLogger.info('ShipsGo shipment registered', {
        trackingJobId: job.id,
        providerShipmentId: result.id,
        alreadyExisted: result.alreadyExisted,
        referenceType: job.referenceType,
        mode: 'ocean',
      })
    }

    const shipment = await getOceanShipment(config, job.providerShipmentId)
    return mapOceanShipmentToEvents(shipment)
  }

  private async fetchOrRegisterAir(
    job: TrackingJob,
    config: ShipsGoClientConfig,
  ): Promise<CarrierFetchResult> {
    const em = this.deps.em()

    if (!job.providerShipmentId) {
      // Air jobs reference the AWB (referenceType='awb').
      const result = await registerAirShipment(config, {
        reference: job.id,
        awbNumber: job.referenceValue,
      })

      job.providerShipmentId = result.id
      await em.flush()

      trackingLogger.info('ShipsGo shipment registered', {
        trackingJobId: job.id,
        providerShipmentId: result.id,
        alreadyExisted: result.alreadyExisted,
        referenceType: job.referenceType,
        mode: 'air',
      })
    }

    const shipment = await getAirShipment(config, job.providerShipmentId)
    return mapAirShipmentToEvents(shipment)
  }
}
