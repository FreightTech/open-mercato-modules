import type {
  TerminalAdapter,
  TerminalFetchResult,
  TerminalFetchedEvent,
  TerminalAdapterTestResult,
  ResolvedTerminalConfig,
  NormalizedVesselVisit,
} from '../../terminal-adapter'
import type { IncosContainer, IncosContainerResponse, IncosVesselVisitResponse } from './types'
import { basicAuthHeader, BctAuthError } from './auth/basic'
import { mapContainerToEvents, normalizeIncosVesselVisit, splitVisitRef } from './incos-semantics'
import { n4Request } from '../n4/http'
import { terminalLogger } from '../../logger'

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

/**
 * Config-driven adapter for the INCOS API that fronts BCT (Bałtycki Terminal
 * Kontenerowy, Gdynia). One instance serves every INCOS terminal configured with
 * `adapterType: 'bct'`; per-terminal differences live in the TerminalConfig.
 *
 * Differences from the N4 adapter that shape this code:
 *  - Auth is plain HTTP Basic (see ./auth/basic.ts), not an OAuth2 Bearer grant —
 *    there is no token endpoint or cache; the header is rebuilt per request.
 *  - The container lookup is a per-container path GET (`/rest-container/container/
 *    {nbr}`) returning a single snapshot, so `fetchEventsBatch` loops
 *    `fetchEvents` (bounded upstream by the per-terminal limiter), like GCT.
 *  - INCOS keys a vessel visit on (vessel, voyage), so the container mapping packs
 *    both into the visit ref (`CODE/VOY`) and `fetchVesselVisit` splits it back;
 *    enrichment runs only when the TerminalConfig sets `endpoints.vessel`.
 */
export class BctTerminalAdapter implements TerminalAdapter {
  readonly adapterType = 'bct'

  readonly defaultEndpoints = {
    // INCOS's container-lookup base occupies the generic `unit` slot; the
    // container number is appended as a path segment per request.
    unit: '/rest-container/container',
    // Vessel-visit lookup base; vesselCode + voyage are appended per request.
    // Enrichment only runs when the TerminalConfig also sets `endpoints.vessel`
    // (the service gates on it) — this is the path used when it does.
    vessel: '/rest-vesselvisit/vesselvisit',
  }

  private containerUrl(containerNumber: string, config: ResolvedTerminalConfig): string {
    const path = config.endpoints?.unit?.trim() || this.defaultEndpoints.unit
    return `${joinUrl(config.baseUrl, path)}/${encodeURIComponent(containerNumber)}`
  }

  private vesselUrl(vesselCode: string, voyage: string, config: ResolvedTerminalConfig): string {
    const path = config.endpoints?.vessel?.trim() || this.defaultEndpoints.vessel
    return `${joinUrl(config.baseUrl, path)}/${encodeURIComponent(vesselCode)}/${encodeURIComponent(voyage)}`
  }

  private async getContainer(
    containerNumber: string,
    config: ResolvedTerminalConfig,
  ): Promise<IncosContainer | null> {
    const { status, ok, text } = await n4Request(
      this.containerUrl(containerNumber, config),
      {
        method: 'GET',
        headers: {
          Authorization: basicAuthHeader(config),
          Accept: 'application/json',
        },
      },
      { proxyUrl: config.proxyUrl, label: `${config.terminalCode} container` },
    )

    if (status === 401 || status === 403) {
      throw new BctAuthError(`INCOS container lookup unauthorized (${status}) for ${config.terminalCode}`)
    }
    if (!ok) {
      throw new Error(`INCOS container lookup failed (${status}) for ${config.terminalCode}`)
    }

    let parsed: IncosContainerResponse
    try {
      parsed = JSON.parse(text) as IncosContainerResponse
    } catch {
      throw new Error(`INCOS container response was not valid JSON for ${config.terminalCode}`)
    }

    // An unknown container does NOT error: INCOS echoes it back as a SUCCESS
    // envelope with the number filled in and every other field null (observed
    // live) — so the timestamp-gating in `mapContainerToEvents` yields no events
    // and the job keeps polling. A genuine ERROR envelope (bad request etc.) is
    // treated the same "not found → no events" way rather than thrown, so one odd
    // response can't sink a poll. (Bad credentials surface earlier as a 401.)
    if (String(parsed.status ?? '').toUpperCase() !== 'SUCCESS') return null
    const data = parsed.data
    if (!data || !data.container_nbr) return null
    return data
  }

  async fetchEvents(input: {
    containerNumber: string
    config: ResolvedTerminalConfig
  }): Promise<TerminalFetchResult> {
    const { containerNumber, config } = input
    const container = await this.getContainer(containerNumber, config)
    const events = container ? mapContainerToEvents(container, config) : []

    terminalLogger.debug('bct fetchEvents', {
      terminalCode: config.terminalCode,
      container: containerNumber,
      found: Boolean(container),
      events: events.length,
    })

    return { events, containerNumber }
  }

  /**
   * INCOS has no batch-by-container-number call, so fetch each container in turn.
   * Kept as a distinct method (rather than falling through to per-container in
   * the service) so the scheduler's batch path stays a single call site; the
   * per-terminal rate limiter still throttles the underlying requests. A single
   * container's failure is isolated so one bad number can't sink the whole poll —
   * except an auth error, which is fatal to the batch (bad credentials would just
   * repeat for every container).
   */
  async fetchEventsBatch(input: {
    containerNumbers: string[]
    config: ResolvedTerminalConfig
  }): Promise<{ events: TerminalFetchedEvent[] }> {
    const { containerNumbers, config } = input
    if (containerNumbers.length === 0) return { events: [] }

    const events: TerminalFetchedEvent[] = []
    for (const containerNumber of containerNumbers) {
      try {
        const result = await this.fetchEvents({ containerNumber, config })
        events.push(...result.events)
      } catch (err) {
        if (err instanceof BctAuthError) throw err
        terminalLogger.warn('bct fetchEventsBatch: container failed', {
          terminalCode: config.terminalCode,
          container: containerNumber,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { events }
  }

  /**
   * Resolve a vessel visit for a `CODE/VOY` ref (as produced by the container
   * mapping's `visitRefIn`/`visitRefOut`). INCOS keys visits by (vesselCode,
   * voyage), so the ref is split back into the two path segments. Returns null
   * when the ref is malformed or INCOS reports no such visit (or its per-caller
   * vessel-lookup rate limit is hit — an ERROR envelope). Vessel-visit dates are
   * `YYYY-MM-DD HH:MM:SS`, parsed by `normalizeIncosVesselVisit`.
   */
  async fetchVesselVisit(input: {
    visitRef: string
    config: ResolvedTerminalConfig
  }): Promise<NormalizedVesselVisit | null> {
    const { visitRef, config } = input
    const parts = splitVisitRef(visitRef)
    if (!parts) return null

    const { status, ok, text } = await n4Request(
      this.vesselUrl(parts.vesselCode, parts.voyage, config),
      { method: 'GET', headers: { Authorization: basicAuthHeader(config), Accept: 'application/json' } },
      { proxyUrl: config.proxyUrl, label: `${config.terminalCode} vesselvisit` },
    )

    if (status === 401 || status === 403) {
      throw new BctAuthError(`INCOS vessel lookup unauthorized (${status}) for ${config.terminalCode}`)
    }
    if (!ok) {
      throw new Error(`INCOS vessel lookup failed (${status}) for ${config.terminalCode}`)
    }

    let parsed: IncosVesselVisitResponse
    try {
      parsed = JSON.parse(text) as IncosVesselVisitResponse
    } catch {
      throw new Error(`INCOS vessel response was not valid JSON for ${config.terminalCode}`)
    }
    if (String(parsed.status ?? '').toUpperCase() !== 'SUCCESS' || !parsed.data) return null
    return normalizeIncosVesselVisit(parsed.data, visitRef)
  }

  /**
   * INCOS has no ping/health route, so probe the container endpoint with a
   * placeholder number. Verified live: a wrong password returns HTTP 401, while
   * an unknown container returns HTTP 200 with a SUCCESS envelope of nulls — so
   * a 401/403 means the Basic credentials are wrong and any other outcome proves
   * the host is reachable and the credentials are accepted. Missing credentials
   * surface via `basicAuthHeader` throwing before any request.
   */
  async testConnection(config: ResolvedTerminalConfig): Promise<TerminalAdapterTestResult> {
    const started = Date.now()
    try {
      const probe = 'TEST0000000'
      const { status } = await n4Request(
        this.containerUrl(probe, config),
        { method: 'GET', headers: { Authorization: basicAuthHeader(config), Accept: 'application/json' } },
        { proxyUrl: config.proxyUrl, label: `${config.terminalCode} test`, retries: 0 },
      )
      if (status === 401 || status === 403) {
        return {
          success: false,
          message: `Authentication rejected (${status}) — check username/password`,
          latencyMs: Date.now() - started,
        }
      }
      return { success: true, message: `Reachable and authenticated (HTTP ${status})`, latencyMs: Date.now() - started }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, message, latencyMs: Date.now() - started }
    }
  }
}
