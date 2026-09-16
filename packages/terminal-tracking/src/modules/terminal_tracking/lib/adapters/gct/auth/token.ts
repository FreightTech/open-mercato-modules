import type { ResolvedTerminalConfig } from '../../../terminal-adapter'
import type { GctToken } from '../types'
import { n4Request } from '../../n4/http'
import { generateTotp } from '../../../totp'

/**
 * GCT token acquisition + process-level cache.
 *
 * GCT mints a token from a plain `GET /gctapi/Auth/{company}/{login}/{password}`
 * (credentials in the path — see the security note below), returning an ISO
 * `expires` instant. The token is then replayed in the `Authorization` header on
 * every data call. This mirrors `../../n4/auth/ropc.ts` in shape (cache keyed by
 * principal, 30s safety margin, invalidate-on-401) but not in wire protocol.
 *
 * LIFECYCLE: a cached token is reused until 30s before `expires`. Once it lapses
 * we first try to REFRESH it via the keep-alive endpoint (`GET /gctapi/ping`,
 * current token in the header) — cheap, no 2FA code — and only RE-AUTHENTICATE
 * (mint a new token with a fresh authenticator code) when the refresh fails.
 *
 * AUTH: GCT's login expects an authenticator one-time code where a password would
 * normally go. We store the base32 authenticator *secret* (the seed behind the
 * enrollment QR) in `auth_config` and derive the current 6-digit TOTP code at
 * mint time — never a static password. A legacy static `loginPassword` is still
 * honoured as a fallback so pre-existing configs don't hard-break.
 *
 * SECURITY: the credential (the derived code) is in the request URL, and the
 * secret must never appear anywhere. We NEVER log the URL — the shared
 * `n4Request` helper only logs the caller-supplied `label`, so we always pass an
 * opaque label and never the URL, and errors below never echo it. Only the
 * short-lived derived code ever reaches the URL; the seed does not.
 */

type CachedToken = { token: string; expiresAt: number }

const tokenCache = new Map<string, CachedToken>()

export class GctAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GctAuthError'
  }
}

type GctCredentials = { companyCode: string; loginName: string; totpSecret: string; legacyPassword: string }

function credentials(config: ResolvedTerminalConfig): GctCredentials {
  const auth = (config.authConfig ?? {}) as Record<string, unknown>
  const companyCode = String(auth.companyCode ?? '')
  const loginName = String(auth.loginName ?? '')
  const totpSecret = String(auth.totpSecret ?? '')
  // Legacy fallback: pre-TOTP configs stored a static `loginPassword`.
  const legacyPassword = String(auth.loginPassword ?? '')
  if (!companyCode || !loginName || (!totpSecret && !legacyPassword)) {
    throw new GctAuthError(
      `GCT config ${config.terminalCode} is missing companyCode/loginName/totpSecret in auth_config`,
    )
  }
  return { companyCode, loginName, totpSecret, legacyPassword }
}

/**
 * The value GCT expects in the password path segment: the current TOTP code
 * derived from the authenticator secret, or a legacy static password when no
 * secret is configured.
 */
function loginCode(creds: GctCredentials): string {
  return creds.totpSecret ? generateTotp(creds.totpSecret) : creds.legacyPassword
}

function cacheKey(config: ResolvedTerminalConfig, creds: GctCredentials): string {
  // Keyed by principal, NOT org/tenant: identical credentials mint the same
  // token, so sharing one cache entry is correct. Persisted rows stay
  // org-scoped independently of this cache.
  return `${config.terminalCode}:${creds.companyCode}:${creds.loginName}`
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

/** Default GCT auth path; a config may override via `endpoints.auth`. */
const DEFAULT_AUTH_PATH = '/gctapi/Auth'

/** Default GCT token-refresh (keep-alive) path; override via `endpoints.refresh`. */
const DEFAULT_REFRESH_PATH = '/gctapi/ping'

function authUrl(config: ResolvedTerminalConfig, creds: GctCredentials, code: string): string {
  const authPath =
    (config.endpoints as { auth?: string } | undefined)?.auth?.trim() || DEFAULT_AUTH_PATH
  const segments = [creds.companyCode, creds.loginName, code]
    .map((s) => encodeURIComponent(s))
    .join('/')
  return joinUrl(config.baseUrl, `${authPath}/${segments}`)
}

function refreshUrl(config: ResolvedTerminalConfig): string {
  const refreshPath =
    (config.endpoints as { refresh?: string } | undefined)?.refresh?.trim() || DEFAULT_REFRESH_PATH
  return joinUrl(config.baseUrl, refreshPath)
}

/** Parse GCT's ISO `expires` into epoch ms; null when unparseable. */
function parseExpires(value: string | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Fall back to a conservative 15-minute TTL when `expires` is missing/bad. */
function tokenTtl(parsed: GctToken, now: number): number {
  return parseExpires(parsed.expires) ?? now + 15 * 60 * 1000
}

/**
 * Full (re-)authentication: derive a fresh authenticator code (it rotates every
 * 30s) and mint a new token from the path-GET Auth endpoint. Caches and returns
 * the raw token. This spends one 2FA code, so it is the fallback path — callers
 * try {@link refreshGctToken} first when they still hold a token.
 */
async function mintGctToken(
  config: ResolvedTerminalConfig,
  creds: GctCredentials,
  key: string,
  now: number,
): Promise<string> {
  const { status, ok, text } = await n4Request(
    authUrl(config, creds, loginCode(creds)),
    { method: 'GET', headers: { Accept: 'application/json' } },
    { proxyUrl: config.proxyUrl, label: `${config.terminalCode} auth` },
  )

  if (!ok) {
    // Do not include the URL (it carries the derived auth code); status only.
    throw new GctAuthError(`GCT token request failed (${status}) for ${config.terminalCode}`)
  }

  let parsed: GctToken
  try {
    parsed = JSON.parse(text) as GctToken
  } catch {
    throw new GctAuthError(`GCT token response was not JSON for ${config.terminalCode}`)
  }
  if (!parsed.token) {
    throw new GctAuthError(`No token in GCT auth response for ${config.terminalCode}`)
  }

  const entry: CachedToken = { token: parsed.token, expiresAt: tokenTtl(parsed, now) }
  tokenCache.set(key, entry)
  return entry.token
}

/**
 * Extend the current token via GCT's keep-alive endpoint
 * (`GET /gctapi/ping`, current token replayed in the `Authorization` header).
 * Returns the refreshed cache entry on success, or `null` on ANY failure —
 * non-2xx, non-JSON, no token in the body, or a network error — so the caller
 * falls back to a full re-authentication. Never throws (no 2FA code is spent).
 */
async function refreshGctToken(
  config: ResolvedTerminalConfig,
  token: string,
  now: number,
): Promise<CachedToken | null> {
  let res
  try {
    res = await n4Request(
      refreshUrl(config),
      { method: 'GET', headers: { Accept: 'application/json', Authorization: token } },
      { proxyUrl: config.proxyUrl, label: `${config.terminalCode} refresh` },
    )
  } catch {
    // Transient network failure exhausted its retries → re-authenticate.
    return null
  }
  if (!res.ok) return null
  let parsed: GctToken
  try {
    parsed = JSON.parse(res.text) as GctToken
  } catch {
    return null
  }
  if (!parsed.token) return null
  return { token: parsed.token, expiresAt: tokenTtl(parsed, now) }
}

/**
 * Acquire (and cache) a GCT token for the `Authorization` header. A cached token
 * is reused until 30s before `expires`. Once it lapses, we first try to REFRESH
 * it via the keep-alive endpoint (cheap — no 2FA code); only if that fails do we
 * fully RE-AUTHENTICATE by minting a new token with a fresh authenticator code.
 */
export async function acquireGctToken(config: ResolvedTerminalConfig): Promise<string> {
  const creds = credentials(config)
  const key = cacheKey(config, creds)
  const now = Date.now()
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > now + 30_000) return cached.token

  // (Near-)expired but a token is still in hand: try the keep-alive refresh
  // before spending a fresh 2FA code. Any refresh failure → full re-auth.
  if (cached) {
    const refreshed = await refreshGctToken(config, cached.token, now)
    if (refreshed) {
      tokenCache.set(key, refreshed)
      return refreshed.token
    }
  }

  return mintGctToken(config, creds, key, now)
}

/** Clear the cached token for a terminal (used after a 401). */
export function invalidateGctToken(config: ResolvedTerminalConfig): void {
  try {
    tokenCache.delete(cacheKey(config, credentials(config)))
  } catch {
    // Missing creds → nothing cached; ignore.
  }
}
