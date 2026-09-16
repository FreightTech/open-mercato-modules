import type { APIRequestContext } from '@playwright/test'

export const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

export interface AuthSession {
  token: string
  orgId: string
  tenantId: string
  userId?: string
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  return JSON.parse(Buffer.from(payload, 'base64url').toString())
}

/**
 * Log in via the host auth endpoint and return the JWT + scope claims.
 * Credentials default to the local seed admin but are overridable via
 * TEST_LOGIN_EMAIL / TEST_LOGIN_PASSWORD for other environments.
 */
export async function login(
  request: APIRequestContext,
  email = process.env.TEST_LOGIN_EMAIL?.trim() || 'admin@acme.com',
  password = process.env.TEST_LOGIN_PASSWORD?.trim() || 'secret',
): Promise<AuthSession> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await request.post(`${BASE_URL}/api/auth/login`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  if (!response.ok()) {
    throw new Error(`Login failed: ${response.status()} ${await response.text()}`)
  }
  const body = await response.json()
  if (!body?.token) throw new Error('Login response missing token')
  const jwt = decodeJwt(body.token)
  return {
    token: body.token,
    orgId: String(jwt.orgId ?? jwt.organizationId ?? ''),
    tenantId: String(jwt.tenantId ?? ''),
    userId: jwt.sub ? String(jwt.sub) : undefined,
  }
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

const CONFIG_API = `${BASE_URL}/api/terminal_tracking/terminal-configs`

/** A unique terminal code so parallel/repeat runs never collide on the unique index. */
export function uniqueTerminalCode(prefix = 'gcttest'): string {
  const stamp = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1_000).toString().padStart(3, '0')}`
  return `${prefix}-${stamp}`.toLowerCase()
}

/**
 * Build a GCT terminal-config create payload. `baseUrl` defaults to a
 * connection-refused loopback so `testConnection` fails fast and deterministically
 * without touching a real terminal. `organizationId`/`tenantId` are injected
 * server-side from the auth scope, so they are intentionally omitted here.
 */
export function buildGctConfigPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    terminalCode: uniqueTerminalCode(),
    adapterType: 'gct',
    displayName: 'GCT Test',
    baseUrl: 'http://127.0.0.1:1',
    authType: 'gct_token',
    endpoints: { unit: '/gctapi/GetContainerDetails' },
    authConfig: { companyCode: 'ACME', loginName: 'user', loginPassword: 'secret' },
    unlocode: 'PLGDY',
    ...overrides,
  }
}

/**
 * Build a BCT/INCOS terminal-config create payload. Like the GCT builder,
 * `baseUrl` defaults to a connection-refused loopback so `testConnection` fails
 * fast without touching the real INCOS host. Auth is HTTP Basic
 * (`{ username, password }`). Daily-cap rate limit mirrors production
 * (10000 requests / 86400s).
 */
export function buildBctConfigPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    terminalCode: uniqueTerminalCode('bcttest'),
    adapterType: 'bct',
    displayName: 'BCT Test',
    baseUrl: 'http://127.0.0.1:1',
    authType: 'basic',
    endpoints: { unit: '/rest-container/container', vessel: '/rest-vesselvisit/vesselvisit' },
    authConfig: { username: 'user', password: 'secret' },
    rateLimitRequests: 10000,
    rateLimitWindowSeconds: 86400,
    unlocode: 'PLBCT',
    ...overrides,
  }
}

export async function createTerminalConfig(
  request: APIRequestContext,
  session: AuthSession,
  overrides: Record<string, unknown> = {},
  build: (o: Record<string, unknown>) => Record<string, unknown> = buildGctConfigPayload,
): Promise<{ id: string; payload: Record<string, unknown> }> {
  const payload = build(overrides)
  const res = await request.post(CONFIG_API, { headers: authHeaders(session.token), data: payload })
  if (!res.ok()) throw new Error(`Create config failed: ${res.status()} ${await res.text()}`)
  const body = (await res.json()) as { id: string }
  return { id: body.id, payload }
}

/** Create a BCT/INCOS terminal config (Basic auth), reusing the shared POST. */
export async function createBctTerminalConfig(
  request: APIRequestContext,
  session: AuthSession,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; payload: Record<string, unknown> }> {
  return createTerminalConfig(request, session, overrides, buildBctConfigPayload)
}

export async function testTerminalConfig(
  request: APIRequestContext,
  session: AuthSession,
  id: string,
): Promise<{ status: number; body: { success?: boolean; message?: string; latencyMs?: number } }> {
  const res = await request.post(`${CONFIG_API}/test`, {
    headers: authHeaders(session.token),
    data: { id },
  })
  return { status: res.status(), body: res.ok() ? await res.json() : { message: await res.text() } }
}

/** Best-effort soft-delete used in teardown; never throws. */
export async function deleteTerminalConfig(
  request: APIRequestContext,
  session: AuthSession,
  id: string,
): Promise<void> {
  try {
    await request.delete(CONFIG_API, { headers: authHeaders(session.token), data: { id } })
  } catch {
    // teardown best-effort
  }
}
