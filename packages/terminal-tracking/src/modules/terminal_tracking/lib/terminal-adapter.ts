import type {
  TerminalEventType,
  TerminalEventClassifierCode,
  TerminalEventSource,
  FacilityCodeProvider,
  TerminalModeOfTransport,
  TerminalAuthType,
  TerminalEndpoints,
  TerminalSealInfo,
} from '../data/entities'

/**
 * A terminal config with its `auth_config` already decrypted, handed to
 * adapters so they never touch the ORM or encryption layer directly.
 */
export type ResolvedTerminalConfig = {
  terminalCode: string
  adapterType: string
  displayName: string
  baseUrl: string
  /** Optional HTTP(S) forward proxy for this terminal's API calls. */
  proxyUrl?: string | null
  endpoints: TerminalEndpoints
  authType: TerminalAuthType
  tokenUrl?: string | null
  scope?: string | null
  clientId?: string | null
  /** Decrypted secrets, e.g. { username, password } or { clientSecret } */
  authConfig?: Record<string, unknown> | null
  rateLimitRequests: number
  rateLimitWindowSeconds: number
  unlocode?: string | null
  facilityCode?: string | null
  facilityCodeListProvider?: FacilityCodeProvider | null
}

/** A normalized, terminal-sourced event ready to persist as a TerminalEvent. */
export type TerminalFetchedEvent = {
  source: TerminalEventSource
  sourceEventId: string // '{terminalCode}:{ufvGkey}:{eventCode}'
  eventType: TerminalEventType
  eventCode: string
  eventClassifierCode?: TerminalEventClassifierCode | null
  eventDateTime: Date
  containerNumber: string
  ufvGkey: string
  transitState?: string | null
  visitState?: string | null
  facilityCode?: string | null
  facilityCodeListProvider?: FacilityCodeProvider | null
  unlocode?: string | null
  visitRefIn?: string | null
  visitRefOut?: string | null
  vesselName?: string | null
  voyageNumber?: string | null
  modeOfTransport?: TerminalModeOfTransport | null
  seals?: TerminalSealInfo[] | null
  vgmWeightKg?: number | null
  impediments?: string[] | null
  // When the container was loaded onto its transport (N4 `Loaded` column):
  // export = onto the vessel, import = onto road/rail. Parsed regardless of the
  // container's current transit state, so it survives past S60_LOADED.
  loadedAt?: Date | null
  // Nested vessel visit enrichment (from /VESSEL); populated by the service layer.
  vesselVisit?: NormalizedVesselVisit | null
  rawData?: Record<string, unknown> | null
}

/**
 * A normalized N4 `/VESSEL` visit, keyed by visit ref. Carries the full vessel
 * row: name, both voyages, line, phase, all four timestamps, plus the
 * begin-receive / dry-cutoff window dates.
 */
export type NormalizedVesselVisit = {
  visitRef: string
  vesselName: string | null
  ibVoyage: string | null
  obVoyage: string | null
  line: string | null
  phase: string | null
  eta: Date | null
  etd: Date | null
  ata: Date | null
  atd: Date | null
  beginReceive: Date | null
  dryCutoff: Date | null
  rawData: Record<string, unknown> | null
}

export type TerminalFetchResult = {
  events: TerminalFetchedEvent[]
  containerNumber: string
}

export type TerminalAdapterTestResult = {
  success: boolean
  message: string
  latencyMs?: number
}

export interface TerminalAdapter {
  /** Selects this adapter from the registry, e.g. 'n4'. */
  readonly adapterType: string

  /** Standard endpoint paths for this adapter family; used when a terminal config omits them. */
  readonly defaultEndpoints: TerminalEndpoints

  fetchEvents(input: {
    containerNumber: string
    config: ResolvedTerminalConfig
  }): Promise<TerminalFetchResult>

  /**
   * Fetch events for many containers in a single call (N4 /unit accepts a
   * comma-separated UNIT_NBR list). Optional: callers feature-detect and fall
   * back to per-container `fetchEvents`. Each returned event carries its own
   * `containerNumber` for grouping back onto the originating job.
   */
  fetchEventsBatch?(input: {
    containerNumbers: string[]
    config: ResolvedTerminalConfig
  }): Promise<{ events: TerminalFetchedEvent[] }>

  /**
   * Resolve a single vessel visit by its visit reference. Optional: adapters
   * that don't support a vessel endpoint omit it, and callers must feature-detect
   * before invoking. Returns null when the endpoint is unconfigured or the visit
   * is not found.
   */
  fetchVesselVisit?(input: {
    visitRef: string
    config: ResolvedTerminalConfig
  }): Promise<NormalizedVesselVisit | null>

  testConnection(config: ResolvedTerminalConfig): Promise<TerminalAdapterTestResult>
}
