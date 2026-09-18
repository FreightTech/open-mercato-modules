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
 * Max GCT requests in flight at once within a single batch. The service's rate
 * limiter gates the batch as a whole, not each container call, so this is the
 * only guard against bursting GCT's bespoke API — kept deliberately low.
 */
const GCT_BATCH_CONCURRENCY = 4

/** A synthetic, never-real container id used only to probe the data endpoint. */
const GCT_HEALTHCHECK_CONTAINER = 'HEALTHCHECK'

/**
 * Run `fn` over `items` with at most `limit` in flight. Resolves once all have
 * settled; `fn` is expected to handle its own errors (it never rejects here).
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice()
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      await fn(queue.shift()!)
    }
  })
  await Promise.all(runners)
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
    // A single container's auth error is fatal to the whole batch (token revoked/
    // expired mid-run); captured here and rethrown once the in-flight workers
    // drain. Data/transport errors are isolated so one bad container can't sink
    // the poll for the rest.
    let authError: GctAuthError | null = null

    await mapWithConcurrency(containerNumbers, GCT_BATCH_CONCURRENCY, async (containerNumber) => {
      if (authError) return // token already known dead — skip remaining work
      try {
        const result = await this.fetchEvents({ containerNumber, config })
        events.push(...result.events)
      } catch (err) {
        if (err instanceof GctAuthError) {
          authError = err
          return
        }
        terminalLogger.warn('gct fetchEventsBatch: container failed', {
          terminalCode: config.terminalCode,
          container: containerNumber,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })

    if (authError) throw authError
    return { events }
  }

  /**
   * Probe GetContainerDetails with a synthetic container to confirm the whole
   * data path — base URL, endpoint path, and token replay — not just that a token
   * can be minted. Returns the HTTP status, or null on a transport failure, and
   * never throws so {@link testConnection} can report it without masking a
   * working token.
   */
  private async probeDetails(config: ResolvedTerminalConfig, token: string): Promise<number | null> {
    try {
      const { status } = await n4Request(
        this.detailsUrl(config),
        {
          method: 'POST',
          headers: {
            Authorization: token,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ CntrID: GCT_HEALTHCHECK_CONTAINER, pageno: 1, pagesize: 1 }),
        },
        { proxyUrl: config.proxyUrl, label: `${config.terminalCode} GetContainerDetails probe` },
      )
      return status
    } catch {
      return null
    }
  }

  async testConnection(config: ResolvedTerminalConfig): Promise<TerminalAdapterTestResult> {
    const started = Date.now()
    let token: string
    try {
      token = await acquireGctToken(config)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, message, latencyMs: Date.now() - started }
    }

    // Token minted; now confirm the data endpoint actually accepts it. A good
    // token against a wrong base URL / endpoint path would otherwise pass silently.
    const status = await this.probeDetails(config, token)
    const latencyMs = Date.now() - started
    if (status === 401) {
      invalidateGctToken(config)
      return { success: false, message: 'Token rejected by GetContainerDetails (401)', latencyMs }
    }
    if (status === null) {
      // Mint already proved credentials + connectivity; only the probe leg failed.
      return { success: true, message: 'Token acquired; data endpoint probe did not respond', latencyMs }
    }
    return {
      success: true,
      message: `Token acquired; GetContainerDetails responded ${status}`,
      latencyMs,
    }
  }
}
