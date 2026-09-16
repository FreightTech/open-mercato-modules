import type {
  TerminalAdapter,
  TerminalFetchResult,
  TerminalFetchedEvent,
  TerminalAdapterTestResult,
  ResolvedTerminalConfig,
} from '../../terminal-adapter'
import type { GctContainer, GctContainerDetailsResponse } from './types'
import { acquireGctToken, invalidateGctToken, GctAuthError } from './auth/token'
import { mapContainerToEvents } from './gct-semantics'
import { n4Request } from '../n4/http'
import { terminalLogger } from '../../logger'

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

/**
 * Config-driven adapter for the GCT (Gdynia Container Terminal) API. One
 * instance serves every GCT terminal; per-terminal differences live in the
 * TerminalConfig.
 *
 * Differences from the N4 adapter that shape this code:
 *  - Auth is a path-minted token replayed in the `Authorization` header
 *    (see ./auth/token.ts), not an OAuth2 Bearer grant.
 *  - There is no fetch-many-by-container-number endpoint, so `fetchEventsBatch`
 *    simply loops `fetchEvents` (bounded upstream by the per-terminal limiter).
 *  - There is no vessel endpoint, so `fetchVesselVisit` is intentionally omitted
 *    — the service feature-detects it and skips vessel resolution for GCT.
 */
export class GctTerminalAdapter implements TerminalAdapter {
  readonly adapterType = 'gct'

  readonly defaultEndpoints = {
    // GCT's container-details endpoint occupies the generic `unit` slot.
    unit: '/gctapi/GetContainerDetails',
  }

  private detailsUrl(config: ResolvedTerminalConfig): string {
    const path = config.endpoints?.unit?.trim() || this.defaultEndpoints.unit
    return joinUrl(config.baseUrl, path)
  }

  private async getContainerDetails(
    containerNumber: string,
    config: ResolvedTerminalConfig,
    token: string,
  ): Promise<GctContainer[]> {
    const { status, ok, text } = await n4Request(
      this.detailsUrl(config),
      {
        method: 'POST',
        headers: {
          Authorization: token,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ CntrID: containerNumber, pageno: 1, pagesize: 100 }),
      },
      { proxyUrl: config.proxyUrl, label: `${config.terminalCode} GetContainerDetails` },
    )

    if (status === 401) {
      invalidateGctToken(config)
      throw new GctAuthError(`GetContainerDetails unauthorized (401) for ${config.terminalCode}`)
    }
    if (!ok) {
      throw new Error(`GetContainerDetails failed (${status}) for ${config.terminalCode}`)
    }

    let parsed: GctContainerDetailsResponse
    try {
      parsed = JSON.parse(text) as GctContainerDetailsResponse
    } catch {
      throw new Error(`GetContainerDetails response was not valid JSON for ${config.terminalCode}`)
    }
    return Array.isArray(parsed.Containers) ? parsed.Containers : []
  }

  async fetchEvents(input: {
    containerNumber: string
    config: ResolvedTerminalConfig
  }): Promise<TerminalFetchResult> {
    const { containerNumber, config } = input
    const token = await acquireGctToken(config)
    const containers = await this.getContainerDetails(containerNumber, config, token)

    const events: TerminalFetchedEvent[] = []
    for (const container of containers) {
      events.push(...mapContainerToEvents(container, config))
    }

    terminalLogger.debug('gct fetchEvents', {
      terminalCode: config.terminalCode,
      container: containerNumber,
      rows: containers.length,
      events: events.length,
    })

    return { events, containerNumber }
  }

  /**
   * GCT has no batch-by-container-number call, so fetch each container in turn.
   * Kept as a distinct method (rather than falling through to per-container in
   * the service) so the scheduler's batch path stays a single call site; the
   * per-terminal rate limiter still throttles the underlying requests. A single
   * container's failure is isolated so one bad number can't sink the whole poll.
   */
  async fetchEventsBatch(input: {
    containerNumbers: string[]
    config: ResolvedTerminalConfig
  }): Promise<{ events: TerminalFetchedEvent[] }> {
    const { containerNumbers, config } = input
    if (containerNumbers.length === 0) return { events: [] }

    // Acquire once up front so a genuine auth failure fails the whole batch
    // (marking the job failed) instead of being swallowed 100× as per-container
    // data errors below.
    await acquireGctToken(config)

    const events: TerminalFetchedEvent[] = []
    for (const containerNumber of containerNumbers) {
      try {
        const result = await this.fetchEvents({ containerNumber, config })
        events.push(...result.events)
      } catch (err) {
        // An auth error is fatal to the batch (token revoked/expired mid-run);
        // let it propagate. Data/transport errors are isolated so one bad
        // container can't sink the poll for the rest.
        if (err instanceof GctAuthError) throw err
        terminalLogger.warn('gct fetchEventsBatch: container failed', {
          terminalCode: config.terminalCode,
          container: containerNumber,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { events }
  }

  async testConnection(config: ResolvedTerminalConfig): Promise<TerminalAdapterTestResult> {
    const started = Date.now()
    try {
      await acquireGctToken(config)
      return { success: true, message: 'Token acquired', latencyMs: Date.now() - started }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, message, latencyMs: Date.now() - started }
    }
  }
}
