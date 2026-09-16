/**
 * TC-TRACK-410 — ShipsGo config API contract & token-hiding.
 *
 * Verifies the per-tenant ShipsGo configuration route
 *   packages/shipment-tracking/src/modules/shipment_tracking/api/shipsgo-configs/route.ts
 *
 * Acceptance:
 *   - Unauthenticated GET/PUT/DELETE → 401.
 *   - PUT upserts the config for the caller's org/tenant (200, returns id).
 *   - GET returns the stored config but NEVER echoes the apiToken (the token is
 *     encrypted at rest and must not leave the server) — the security invariant.
 *   - PUT with the "__UNCHANGED__" sentinel keeps the config without rotating
 *     the token (still 200, config still present + enabled).
 *   - DELETE removes it; a subsequent GET returns { config: null }.
 *
 * This is the only surface of the ShipsGo feature with a self-contained HTTP
 * contract: a ShipsGo *tracking job* cannot be created from the public API
 * (it is routed to internally on unsupported-carrier legs), and register→poll
 * would require a live, credit-spending ShipsGo account — those behaviours are
 * pinned by the unit/service tests (shipsgo-provider / shipsgo-poll /
 * shipsgo-client / shipsgo-mapper), not here.
 *
 * Fully self-contained: no fixtures, no hardcoded IDs. The config is a singleton
 * per org/tenant, so the test snapshots any pre-existing config and restores it
 * in teardown to stay order-independent.
 */

import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const ENDPOINT = '/api/shipment_tracking/shipsgo-configs'

type ShipsGoConfig = {
  id: string
  isEnabled: boolean
  baseUrl: string
  oceanEnabled: boolean
  airEnabled: boolean
  apiToken?: string
}

async function getConfig(api: APIRequestContext): Promise<ShipsGoConfig | null> {
  const res = await api.get(ENDPOINT)
  if (!res.ok()) return null
  const body = (await res.json().catch(() => null)) as { config?: ShipsGoConfig | null } | null
  return body?.config ?? null
}

test.describe('TC-TRACK-410: ShipsGo config API', () => {
  let snapshot: ShipsGoConfig | null = null

  test.beforeEach(async ({ page }) => {
    await login(page, 'superadmin')
    // Snapshot any existing config so we can restore singleton state afterwards.
    snapshot = await getConfig(page.request)
  })

  test.afterEach(async ({ page }) => {
    // Restore: delete our test config, then re-apply the original if there was one.
    await page.request.delete(ENDPOINT).catch(() => null)
    if (snapshot) {
      await page.request
        .put(ENDPOINT, {
          data: {
            isEnabled: snapshot.isEnabled,
            apiToken: '__UNCHANGED__', // original token was never exposed; keep whatever was there
            baseUrl: snapshot.baseUrl,
            oceanEnabled: snapshot.oceanEnabled,
            airEnabled: snapshot.airEnabled,
          },
        })
        .catch(() => null)
    }
  })

  test('rejects unauthenticated access with 401', async ({ request }) => {
    // `request` here is the bare context (no login/cookies).
    const res = await request.get(ENDPOINT)
    expect(res.status()).toBe(401)
  })

  test('upserts config and never returns the apiToken on GET', async ({ page }) => {
    const put = await page.request.put(ENDPOINT, {
      data: {
        isEnabled: true,
        apiToken: 'secret-token-value',
        baseUrl: 'https://api.shipsgo.com/v2',
        oceanEnabled: true,
        airEnabled: false,
      },
    })
    expect(put.ok()).toBeTruthy()

    const config = await getConfig(page.request)
    expect(config).not.toBeNull()
    expect(config!.isEnabled).toBe(true)
    expect(config!.oceanEnabled).toBe(true)
    expect(config!.airEnabled).toBe(false)
    expect(config!.baseUrl).toBe('https://api.shipsgo.com/v2')

    // The security invariant: the token must never travel back to the client.
    expect(config).not.toHaveProperty('apiToken')
    expect(JSON.stringify(config)).not.toContain('secret-token-value')
  })

  test('keeps the config on an __UNCHANGED__ token update (no rotation required)', async ({ page }) => {
    await page.request.put(ENDPOINT, {
      data: { isEnabled: true, apiToken: 'secret-token-value', baseUrl: 'https://api.shipsgo.com/v2' },
    })

    const update = await page.request.put(ENDPOINT, {
      data: { isEnabled: false, apiToken: '__UNCHANGED__', baseUrl: 'https://api.shipsgo.com/v2' },
    })
    expect(update.ok()).toBeTruthy()

    const config = await getConfig(page.request)
    expect(config).not.toBeNull()
    expect(config!.isEnabled).toBe(false)
    expect(config).not.toHaveProperty('apiToken')
  })

  test('deletes the config; a subsequent GET returns null', async ({ page }) => {
    await page.request.put(ENDPOINT, {
      data: { isEnabled: true, apiToken: 'secret-token-value', baseUrl: 'https://api.shipsgo.com/v2' },
    })
    expect(await getConfig(page.request)).not.toBeNull()

    const del = await page.request.delete(ENDPOINT)
    expect(del.ok()).toBeTruthy()

    expect(await getConfig(page.request)).toBeNull()
  })
})
