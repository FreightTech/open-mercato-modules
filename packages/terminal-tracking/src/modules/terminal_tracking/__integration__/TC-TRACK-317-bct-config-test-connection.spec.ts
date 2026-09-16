import { expect, test } from '@playwright/test'
import {
  login,
  createBctTerminalConfig,
  testTerminalConfig,
  deleteTerminalConfig,
  type AuthSession,
} from './helpers'

/**
 * TC-TRACK-317 — BCT (Bałtycki Terminal Kontenerowy, Gdynia) / INCOS adapter
 * wiring, exercised through the real host app.
 *
 * These do NOT hit the live INCOS API — test-connection fails deterministically
 * (connection-refused loopback host). What they prove is that the Phase-1
 * additions are wired end-to-end through the app:
 *  - the `basic` auth type + `bct` adapter pass create validation (validator +
 *    entity changes),
 *  - the `bct` adapter is registered and resolved by adapterType (registry) —
 *    the failure is a real adapter result, never "no adapter for type",
 *  - test-connection returns a STRUCTURED { success:false } payload, not a 500.
 *
 * Note: the exact failure message depends on the environment. Where tenant-data
 * decryption of `auth_config` is active, the loopback host yields a transport
 * error; where it is not (and creds resolve empty), the adapter's Basic-auth
 * guard fires first. Both are structured failures — the assertions below hold
 * either way and deliberately do not pin the first case's message text.
 */
test.describe('TC-TRACK-317: BCT terminal-config test connection', () => {
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

  test('accepts a basic/bct config and reports a structured connection failure', async ({ request }) => {
    const { id } = await createBctTerminalConfig(request, session)
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

  test('surfaces missing BCT credentials as a clear failure message', async ({ request }) => {
    const { id } = await createBctTerminalConfig(request, session, { authConfig: {} })
    createdIds.push(id)

    const { status, body } = await testTerminalConfig(request, session, id)
    expect(status).toBe(200)
    expect(body.success).toBe(false)
    // The adapter's Basic-auth guard names the missing fields.
    expect(body.message).toContain('username/password')
  })
})
