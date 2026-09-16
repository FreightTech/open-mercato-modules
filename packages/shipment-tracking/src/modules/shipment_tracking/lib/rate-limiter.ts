import { logRateLimit } from './logger'

export type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds?: number
}

export type CacheService = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
}

/**
 * Token bucket rate limiter using a cache backend.
 *
 * Key: `st:ratelimit:{tenantId}:{carrier}`
 *
 * Stores the current token count and last refill timestamp in the cache.
 * Refills tokens proportionally based on elapsed time.
 */
export async function checkRateLimit(
  cache: CacheService,
  tenantId: string,
  carrierCode: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const key = `st:ratelimit:${tenantId}:${carrierCode}`
  const now = Date.now()

  const raw = await cache.get(key)
  let tokens = maxRequests
  let lastRefill = now

  if (raw) {
    try {
      const state = JSON.parse(raw) as { tokens: number; lastRefill: number }
      const elapsed = (now - state.lastRefill) / 1000
      const refilled = Math.floor((elapsed / windowSeconds) * maxRequests)
      tokens = Math.min(maxRequests, state.tokens + refilled)
      lastRefill = refilled > 0 ? now : state.lastRefill
    } catch {
      // Corrupted cache entry, reset
    }
  }

  if (tokens <= 0) {
    const retryAfterSeconds = Math.ceil(windowSeconds / maxRequests)
    logRateLimit({ carrierCode, tenantId, allowed: false, retryAfterSeconds })
    return { allowed: false, retryAfterSeconds }
  }

  tokens -= 1
  await cache.set(key, JSON.stringify({ tokens, lastRefill }), windowSeconds * 2)

  logRateLimit({ carrierCode, tenantId, allowed: true })
  return { allowed: true }
}
