import type { ResolvedTerminalConfig } from '../../../terminal-adapter'
import { n4Request } from '../http'

type CachedToken = { token: string; expiresAt: number }

// Process-level token cache, keyed by terminal + principal.
const tokenCache = new Map<string, CachedToken>()

export class TerminalAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'TerminalAuthError'
  }
}

function cacheKey(config: ResolvedTerminalConfig): string {
  const principal =
    config.authType === 'oauth2_password'
      ? String((config.authConfig as Record<string, unknown>)?.username ?? '')
      : String(config.clientId ?? '')
  return `${config.terminalCode}:${principal}`
}

function buildBody(config: ResolvedTerminalConfig): URLSearchParams {
  const auth = (config.authConfig ?? {}) as Record<string, unknown>
  const body = new URLSearchParams()
  if (config.clientId) body.set('client_id', config.clientId)
  if (config.scope) body.set('scope', config.scope)

  if (config.authType === 'oauth2_password') {
    body.set('grant_type', 'password')
    body.set('username', String(auth.username ?? ''))
    body.set('password', String(auth.password ?? ''))
  } else {
    body.set('grant_type', 'client_credentials')
    if (auth.clientSecret) body.set('client_secret', String(auth.clientSecret))
  }
  return body
}

/** Extract the `AADB2C…` / OAuth error code from a token error body. */
function extractErrorCode(text: string): string | undefined {
  const m = text.match(/AADB2C\d+|AADSTS\d+/)
  if (m) return m[0]
  try {
    const j = JSON.parse(text) as { error?: string }
    return j.error
  } catch {
    return undefined
  }
}

/**
 * Acquire (and cache) an OAuth access token for the terminal. Supports
 * Azure B2C ROPC (password grant) and client-credentials. Surfaces the exact
 * `AADB2C…` code on failure (e.g. AADB2C90225 for a not-yet-changed password).
 */
export async function acquireToken(config: ResolvedTerminalConfig): Promise<string> {
  if (!config.tokenUrl) throw new TerminalAuthError('Terminal config has no tokenUrl')

  const key = cacheKey(config)
  const cached = tokenCache.get(key)
  const now = Date.now()
  if (cached && cached.expiresAt > now + 30_000) return cached.token

  const { status, ok, text } = await n4Request(
    config.tokenUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildBody(config).toString(),
    },
    { proxyUrl: config.proxyUrl, label: `${config.terminalCode} token` },
  )

  if (!ok) {
    throw new TerminalAuthError(
      `Token request failed (${status})${extractErrorCode(text) ? `: ${extractErrorCode(text)}` : ''}`,
      extractErrorCode(text),
    )
  }

  let parsed: { access_token?: string; expires_in?: string | number }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new TerminalAuthError('Token response was not JSON')
  }
  if (!parsed.access_token) {
    throw new TerminalAuthError('No access_token in token response', extractErrorCode(text))
  }

  const ttlSeconds = Number(parsed.expires_in ?? 3600)
  tokenCache.set(key, { token: parsed.access_token, expiresAt: now + ttlSeconds * 1000 })
  return parsed.access_token
}

/** Clear the cached token for a terminal (used after auth failures). */
export function invalidateToken(config: ResolvedTerminalConfig): void {
  tokenCache.delete(cacheKey(config))
}
