import { expect, test } from '@playwright/test'
import {
  login,
  createTerminalConfig,
  testTerminalConfig,
  deleteTerminalConfig,
  type AuthSession,
} from './helpers'

/**
 * TC-TRACK-301 — GCT (Gdynia) adapter wiring, exercised through the real host app.
 *
 * These do NOT hit a live GCT terminal — test-connection fails deterministically
 * (unreachable host / missing credentials). What they prove is that the Phase-1
 * additions are wired end-to-end through the app:
 *  - the `gct_token` auth type passes create validation (validator change),
 *  - the `gct` adapter is registered and resolved by adapterType (registry) —
 *    the failure is a real adapter result, never "no adapter for type",
 *  - test-connection returns a STRUCTURED { success:false } payload, not a 500.
 *
 * Note: the exact failure message depends on the environment. Where tenant-data
 * decryption of `auth_config` is active, an unreachable host yields a transport
 * error; where it is not (and creds resolve empty), the adapter's credential
 * guard fires first. Both are structured failures — the assertions below hold
 * either way and deliberately do not pin the message text of the first case.
 */
test.describe('TC-TRACK-301: GCT terminal-config test connection', () => {
  let session: AuthSession
  const createdIds: string[] = []

  test.beforeAll(async ({ request }) => {
    session = await login(request)
  })

  test.afterEach(async ({ request }) => {
    while (createdIds.length) {
      await deleteTerminalConfig(request, session, createdIds.pop() as string)
    }
  })

  test('accepts a gct_token config and reports a structured connection failure', async ({ request }) => {
    const { id } = await createTerminalConfig(request, session)
    createdIds.push(id)
    expect(id).toBeTruthy()

    const { status, body } = await testTerminalConfig(request, session, id)
    // A structured 200 response — the adapter resolved and failed gracefully.
    expect(status).toBe(200)
    expect(body.success).toBe(false)
    expect(typeof body.message).toBe('string')
    expect(body.message).toBeTruthy()
    // Registration proof: it is not the generic "no adapter for type" error.
    expect(body.message?.toLowerCase()).not.toContain('no adapter')
  })

  test('surfaces missing GCT credentials as a clear failure message', async ({ request }) => {
    const { id } = await createTerminalConfig(request, session, { authConfig: {} })
    createdIds.push(id)

    const { status, body } = await testTerminalConfig(request, session, id)
    expect(status).toBe(200)
    expect(body.success).toBe(false)
    // The adapter's credential guard names the missing field.
    expect(body.message).toContain('companyCode')
  })
})
