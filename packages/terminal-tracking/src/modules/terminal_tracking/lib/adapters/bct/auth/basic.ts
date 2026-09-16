import type { ResolvedTerminalConfig } from '../../../terminal-adapter'

/**
 * INCOS authenticates every call with plain HTTP Basic (`-u user:password` in
 * the vendor docs). There is no token endpoint or cache — the header is derived
 * from the decrypted `auth_config` on each request. Credentials live in
 * `auth_config` as `{ username, password }` (encrypted at rest; see
 * encryption.ts).
 */

export class BctAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BctAuthError'
  }
}

/**
 * Build the `Authorization: Basic <base64(user:pass)>` header for a config.
 * Throws `BctAuthError` when either credential is missing, so a misconfigured
 * terminal fails with a clear message rather than a silent 401.
 */
export function basicAuthHeader(config: ResolvedTerminalConfig): string {
  const auth = (config.authConfig ?? {}) as Record<string, unknown>
  const username = String(auth.username ?? '')
  const password = String(auth.password ?? '')
  if (!username || !password) {
    throw new BctAuthError(
      `BCT/INCOS config ${config.terminalCode} is missing username/password in auth_config`,
    )
  }
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
  return `Basic ${token}`
}
