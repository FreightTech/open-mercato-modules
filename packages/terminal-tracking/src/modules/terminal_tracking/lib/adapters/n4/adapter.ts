import type {
  TerminalAdapter,
  TerminalFetchResult,
  TerminalFetchedEvent,
  TerminalAdapterTestResult,
  ResolvedTerminalConfig,
  NormalizedVesselVisit,
} from '../../terminal-adapter'
import { acquireToken, invalidateToken, TerminalAuthError } from './auth/ropc'
import { parseUnitDataTable, type N4DataTableResponse } from './parsers/data-table'
import { parseVesselDataTable } from './parsers/vessel-data-table'
import { mapRowToEvent, parseN4DateTime } from './n4-semantics'
import { n4Request } from './http'
import { terminalLogger } from '../../logger'

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

/** Parse an N4 JSON body, turning a malformed payload into a clear adapter error. */
function parseN4Json(text: string, terminalCode: string, what: string): N4DataTableResponse {
  try {
    return JSON.parse(text) as N4DataTableResponse
  } catch {
    throw new Error(`${what} response was not valid JSON for ${terminalCode}`)
  }
}

/**
 * Config-driven adapter for Navis N4 terminals. One instance serves all N4
 * terminals; per-terminal differences live in the TerminalConfig.
 */
export class N4TerminalAdapter implements TerminalAdapter {
  readonly adapterType = 'n4'

  readonly defaultEndpoints = {
    unit: '/unit',
    vessel: '/VESSEL',
    trainVisits: '/TRAIN_VISITS',
  }

  private async getUnitMany(
    containerNumbers: string[],
    config: ResolvedTerminalConfig,
    token: string,
  ): Promise<N4DataTableResponse> {
    // N4 /unit accepts a comma-separated UNIT_NBR list; encode each part so the
    // commas stay as the list separator.
    const joined = containerNumbers.map((c) => encodeURIComponent(c)).join(',')
    const url = `${joinUrl(config.baseUrl, config.endpoints.unit)}?UNIT_NBR=${joined}`
    const { status, ok, text } = await n4Request(
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      { proxyUrl: config.proxyUrl, label: `${config.terminalCode} /unit` },
    )
    if (status === 401) {
      invalidateToken(config)
      throw new TerminalAuthError(`Unit request unauthorized (401) for ${config.terminalCode}`)
    }
    if (!ok) {
      throw new Error(`Unit request failed (${status}) for ${config.terminalCode}`)
    }
    return parseN4Json(text, config.terminalCode, 'Unit')
  }

  private async getVessel(
    visitRef: string,
    config: ResolvedTerminalConfig,
    token: string,
  ): Promise<N4DataTableResponse> {
    const url = `${joinUrl(config.baseUrl, config.endpoints.vessel as string)}?VISIT_REF=${encodeURIComponent(visitRef)}`
    const { status, ok, text } = await n4Request(
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      { proxyUrl: config.proxyUrl, label: `${config.terminalCode} /VESSEL` },
    )
    if (status === 401) {
      invalidateToken(config)
      throw new TerminalAuthError(`Vessel request unauthorized (401) for ${config.terminalCode}`)
    }
    if (!ok) {
      throw new Error(`Vessel request failed (${status}) for ${config.terminalCode}`)
    }
    return parseN4Json(text, config.terminalCode, 'Vessel')
  }

  async fetchVesselVisit(input: {
    visitRef: string
    config: ResolvedTerminalConfig
  }): Promise<NormalizedVesselVisit | null> {
    const { visitRef, config } = input
    if (!config.endpoints.vessel) return null

    const token = await acquireToken(config)
    const body = await this.getVessel(visitRef, config, token)
    const row = parseVesselDataTable(body)
    if (!row) return null

    return {
      visitRef: row.visitRef,
      vesselName: row.vesselName,
      ibVoyage: row.ibVoyage,
      obVoyage: row.obVoyage,
      line: row.line,
      phase: row.phase,
      eta: parseN4DateTime(row.eta),
      etd: parseN4DateTime(row.etd),
      ata: parseN4DateTime(row.ata),
      atd: parseN4DateTime(row.atd),
      beginReceive: parseN4DateTime(row.beginReceive),
      dryCutoff: parseN4DateTime(row.dryCutoff),
      rawData: row.raw,
    }
  }

  async fetchEvents(input: {
    containerNumber: string
    config: ResolvedTerminalConfig
  }): Promise<TerminalFetchResult> {
    const { containerNumber, config } = input
    const { events } = await this.fetchEventsBatch({ containerNumbers: [containerNumber], config })
    return { events, containerNumber }
  }

  async fetchEventsBatch(input: {
    containerNumbers: string[]
    config: ResolvedTerminalConfig
  }): Promise<{ events: TerminalFetchedEvent[] }> {
    const { containerNumbers, config } = input
    if (containerNumbers.length === 0) return { events: [] }

    const token = await acquireToken(config)
    const body = await this.getUnitMany(containerNumbers, config, token)
    const rows = parseUnitDataTable(body)

    const events: TerminalFetchedEvent[] = []
    for (const row of rows) {
      const event = mapRowToEvent(row, config)
      if (event) events.push(event)
    }

    terminalLogger.debug('fetchEventsBatch', {
      terminalCode: config.terminalCode,
      containers: containerNumbers.length,
      rows: rows.length,
      events: events.length,
    })

    return { events }
  }

  async testConnection(config: ResolvedTerminalConfig): Promise<TerminalAdapterTestResult> {
    const started = Date.now()
    try {
      await acquireToken(config)
      return { success: true, message: 'Token acquired', latencyMs: Date.now() - started }
    } catch (err) {
      const code = err instanceof TerminalAuthError ? err.code : undefined
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, message: code ? `${message} (${code})` : message, latencyMs: Date.now() - started }
    }
  }
}
