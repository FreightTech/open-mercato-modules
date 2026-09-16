/**
 * ShipsGo API v2 client (ocean + air).
 *
 * ShipsGo is a register-then-poll provider: you POST a shipment (spending a
 * credit) and receive a ShipsGo shipment id, then GET that id for movements.
 * Registration is idempotent on `reference` — a duplicate returns 409 with the
 * existing shipment, so we treat 200 and 409 the same (both yield an id).
 *
 * Raw `fetch` is correct here (this is a server-side lib, not UI — `apiCall`
 * is the frontend helper). Auth is the `X-Shipsgo-User-Token` header.
 *
 * Docs: https://api.shipsgo.com/v2
 */

const TOKEN_HEADER = 'X-Shipsgo-User-Token'

/**
 * Per-request timeout. ShipsGo polls run inside a sequential job loop, so a hung
 * endpoint would otherwise stall the whole worker. Aborted requests surface as a
 * normal fetch error → recorded as a transient job error.
 */
const REQUEST_TIMEOUT_MS = 20_000

/**
 * Standardizes an AWB to ShipsGo's `NNN-NNNNNNNN` shape (3 digits, hyphen, 8
 * digits) so a value typed with spaces/other separators still validates against
 * ShipsGo's `^[0-9]{3}(-)?[0-9]{8}$` pattern. Returns the trimmed input
 * unchanged when it isn't 11 digits (let ShipsGo return the authoritative error).
 */
export function normalizeAwbNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return raw.trim()
}

export type ShipsGoClientConfig = {
  apiToken: string
  baseUrl: string
}

/** Thrown on HTTP 402 — the ShipsGo account has no remaining credits. */
export class ShipsGoCreditsExhaustedError extends Error {
  constructor(message = 'ShipsGo credits exhausted (HTTP 402)') {
    super(message)
    this.name = 'ShipsGoCreditsExhaustedError'
  }
}

/**
 * Thrown on HTTP 403 — the token is missing/invalid/expired. This is an
 * account-level condition (like 402), not a per-job fault, so callers back the
 * job off instead of burning its retry budget.
 */
export class ShipsGoAuthError extends Error {
  constructor(message = 'ShipsGo authentication failed (HTTP 403)') {
    super(message)
    this.name = 'ShipsGoAuthError'
  }
}

/**
 * Thrown on HTTP 429 — the ShipsGo rate limit (100 req/min, collective across
 * the account) was exceeded. `retryAfterSeconds` is derived from the
 * `RateLimit-Reset` (UTC epoch) or `Retry-After` header when present. Transient,
 * so callers back the job off without consuming its retry budget.
 */
export class ShipsGoRateLimitedError extends Error {
  constructor(
    message = 'ShipsGo rate limit exceeded (HTTP 429)',
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'ShipsGoRateLimitedError'
  }
}

/** Thrown for any other non-2xx (and non-409) ShipsGo response. */
export class ShipsGoApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ShipsGoApiError'
  }
}

export type ShipsGoRegisterResult = {
  /** ShipsGo shipment id (stringified integer). */
  id: string
  /** True when the shipment already existed (HTTP 409) — no credit spent. */
  alreadyExisted: boolean
}

// ─── Response types (only the fields we consume) ─────────────────────────────

export type ShipsGoOceanLocation = {
  code?: string | null
  name?: string | null
  timezone?: string | null
  country?: { code?: string | null; name?: string | null } | null
}

export type ShipsGoOceanMovement = {
  event: string // EMSH | GTIN | LOAD | DEPA | ARRV | DISC | GTOT | EMRT
  status: 'EST' | 'ACT'
  location?: ShipsGoOceanLocation | null
  vessel?: { imo?: number | null; name?: string | null } | null
  voyage?: string | null
  timestamp: string
}

export type ShipsGoOceanContainer = {
  number: string
  status?: string | null
  size?: number | null
  type?: string | null
  movements?: ShipsGoOceanMovement[] | null
}

/** ShipsGo route summary (shipment-level; POL/POD, transit, emissions). */
export type ShipsGoOceanRoutePort = {
  location?: ShipsGoOceanLocation | null
  date_of_loading?: string | null
  date_of_discharge?: string | null
  date_of_discharge_predicted?: string | null
}

export type ShipsGoOceanRoute = {
  port_of_loading?: ShipsGoOceanRoutePort | null
  port_of_discharge?: ShipsGoOceanRoutePort | null
  transit_time?: number | null
  transit_percentage?: number | null
  co2_emission?: number | null
  ts_count?: number | null
}

export type ShipsGoOceanShipment = {
  id: number
  reference?: string | null
  booking_number?: string | null
  container_number?: string | null
  carrier?: { scac?: string | null; name?: string | null; status?: string | null } | null
  status?: string | null
  route?: ShipsGoOceanRoute | null
  containers?: ShipsGoOceanContainer[] | null
}

// ─── Air response types (only the fields we consume) ─────────────────────────

export type ShipsGoAirLocation = {
  name?: string | null
  iata?: string | null
  timezone?: string | null
  country?: { code?: string | null; name?: string | null } | null
}

export type ShipsGoAirMovement = {
  event: string // RCS | MAN | DEP | ARR | RCF | DLV
  status: 'EST' | 'ACT'
  location?: ShipsGoAirLocation | null
  flight?: string | null
  timestamp: string
}

/** ShipsGo air cargo summary (pieces / weight / volume). */
export type ShipsGoAirCargo = {
  pieces?: number | null
  weight?: number | null
  weight_unit?: string | null
  volume?: number | null
  volume_unit?: string | null
}

/** ShipsGo air route summary (origin/destination airports + transit/emissions). */
export type ShipsGoAirRoutePort = {
  location?: ShipsGoAirLocation | null
  date_of_dep?: string | null
  date_of_rcf?: string | null
}

export type ShipsGoAirRoute = {
  origin?: ShipsGoAirRoutePort | null
  destination?: ShipsGoAirRoutePort | null
  transit_time?: number | null
  transit_percentage?: number | null
  co2_emission?: number | null
  ts_count?: number | null
}

export type ShipsGoAirShipment = {
  id: number
  reference?: string | null
  awb_number?: string | null
  airline?: { iata?: string | null; name?: string | null } | null
  status?: string | null // NEW | INPROGRESS | BOOKED | EN_ROUTE | LANDED | DELIVERED | UNTRACKED
  status_extended?: unknown | null
  cargo?: ShipsGoAirCargo | null
  route?: ShipsGoAirRoute | null
  movements?: ShipsGoAirMovement[] | null
}

type ShipmentEnvelope<T> = { message?: string; shipment?: T }

// ─── Internal fetch helper ───────────────────────────────────────────────────

async function shipsGoFetch(
  config: ShipsGoClientConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const url = `${config.baseUrl.replace(/\/$/, '')}${path}`
  return fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      [TOKEN_HEADER]: config.apiToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

/**
 * Maps account-level HTTP statuses (402/403/429) to their typed errors so every
 * caller (register + GET) handles them uniformly. Returns without throwing for
 * anything else; the caller then handles 409 / generic failures itself.
 */
function throwForAccountLevelStatus(response: Response): void {
  if (response.status === 402) throw new ShipsGoCreditsExhaustedError()
  if (response.status === 403) throw new ShipsGoAuthError()
  if (response.status === 429) throw new ShipsGoRateLimitedError(undefined, retryAfterSeconds(response))
}

/** Seconds until the rate-limit window resets, from `RateLimit-Reset` (UTC epoch) or `Retry-After`. */
function retryAfterSeconds(response: Response): number | undefined {
  const reset = response.headers.get('RateLimit-Reset') ?? response.headers.get('X-RateLimit-Reset')
  if (reset) {
    const resetEpoch = Number(reset)
    if (Number.isFinite(resetEpoch)) return Math.max(0, Math.ceil(resetEpoch - Date.now() / 1000))
  }
  const retryAfter = response.headers.get('Retry-After')
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (Number.isFinite(secs)) return Math.max(0, Math.ceil(secs))
  }
  return undefined
}

function toId(shipment: { id?: number } | undefined): string {
  if (!shipment || shipment.id == null) {
    throw new ShipsGoApiError(500, 'ShipsGo response missing shipment id')
  }
  return String(shipment.id)
}

async function handleRegister(response: Response): Promise<ShipsGoRegisterResult> {
  throwForAccountLevelStatus(response)
  if (response.status === 409) {
    // Already exists — free; extract the existing shipment id.
    const body = (await response.json().catch(() => ({}))) as ShipmentEnvelope<{ id: number }>
    return { id: toId(body.shipment), alreadyExisted: true }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown')
    throw new ShipsGoApiError(response.status, `ShipsGo register failed (${response.status}): ${text}`)
  }
  const body = (await response.json()) as ShipmentEnvelope<{ id: number }>
  return { id: toId(body.shipment), alreadyExisted: false }
}

// ─── Ocean ───────────────────────────────────────────────────────────────────

export async function registerOceanShipment(
  config: ShipsGoClientConfig,
  input: {
    reference: string
    bookingNumber?: string | null
    containerNumber?: string | null
    /** Optional SCAC hint — ShipsGo auto-detects the line when omitted. */
    carrier?: string | null
  },
): Promise<ShipsGoRegisterResult> {
  const payload: Record<string, unknown> = { reference: input.reference }
  if (input.bookingNumber) payload.booking_number = input.bookingNumber
  else if (input.containerNumber) payload.container_number = input.containerNumber
  if (input.carrier) payload.carrier = input.carrier

  const response = await shipsGoFetch(config, '/ocean/shipments', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return handleRegister(response)
}

export async function getOceanShipment(
  config: ShipsGoClientConfig,
  id: string,
): Promise<ShipsGoOceanShipment> {
  const response = await shipsGoFetch(config, `/ocean/shipments/${encodeURIComponent(id)}`, {
    method: 'GET',
  })
  throwForAccountLevelStatus(response)
  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown')
    throw new ShipsGoApiError(response.status, `ShipsGo get ocean shipment failed (${response.status}): ${text}`)
  }
  const body = (await response.json()) as ShipmentEnvelope<ShipsGoOceanShipment>
  if (!body.shipment) {
    throw new ShipsGoApiError(500, 'ShipsGo ocean response missing shipment')
  }
  return body.shipment
}

// ─── Air ───────────────────────────────────────────────────────────────────────

export async function registerAirShipment(
  config: ShipsGoClientConfig,
  input: {
    reference: string
    /** Air Waybill number — ShipsGo standardizes to `333-88888888`. */
    awbNumber: string
  },
): Promise<ShipsGoRegisterResult> {
  const response = await shipsGoFetch(config, '/air/shipments', {
    method: 'POST',
    body: JSON.stringify({ reference: input.reference, awb_number: normalizeAwbNumber(input.awbNumber) }),
  })
  return handleRegister(response)
}

export async function getAirShipment(
  config: ShipsGoClientConfig,
  id: string,
): Promise<ShipsGoAirShipment> {
  const response = await shipsGoFetch(config, `/air/shipments/${encodeURIComponent(id)}`, {
    method: 'GET',
  })
  throwForAccountLevelStatus(response)
  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown')
    throw new ShipsGoApiError(response.status, `ShipsGo get air shipment failed (${response.status}): ${text}`)
  }
  const body = (await response.json()) as ShipmentEnvelope<ShipsGoAirShipment>
  if (!body.shipment) {
    throw new ShipsGoApiError(500, 'ShipsGo air response missing shipment')
  }
  return body.shipment
}
