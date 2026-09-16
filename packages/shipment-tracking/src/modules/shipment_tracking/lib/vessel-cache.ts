/**
 * Process-global, bounded, short-TTL cache for public AIS vessel data, plus a small
 * concurrency limiter for fanning out `fetchVessel` calls.
 *
 * Why this exists: the ships-map dashboard widget resolves many shipments to a handful
 * of distinct vessels (a vessel carries several of our containers), then fetches each
 * vessel's live position from the external `vessel-api`. That service has no batch
 * endpoint, so we make one HTTP call per distinct IMO. To keep latency and upstream
 * quota in check we:
 *   - cache the public `VesselInfo` keyed by IMO (TTL ~5 min),
 *   - bound the cache so it can't grow over the process lifetime,
 *   - cap concurrency on the fan-out.
 *
 * The cache stores ONLY public maritime data (`VesselInfo` keyed by IMO) — never
 * tenant-scoped rows — so it is safe to share across tenants. The tenant-scoped
 * `Shipment` query and the shipment→vessel grouping are computed per request and
 * never cached here.
 */

import { fetchVessel, type VesselInfo } from './vessel-api'

// ─── Configuration ───────────────────────────────────────────

const TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_ENTRIES = 500 // hard cap so the cache can't grow unbounded over process life
const DEFAULT_CONCURRENCY = 8

type CacheEntry = { v: VesselInfo | null; exp: number }

// Module-level (process-global) cache. Keyed by IMO string.
const cache = new Map<string, CacheEntry>()

// ─── Cache ───────────────────────────────────────────────────

/**
 * Evict expired entries; if still at capacity, drop the oldest insertion (Map preserves
 * insertion order) so the cache stays bounded.
 */
function evictIfNeeded(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.exp <= now) cache.delete(key)
  }
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/**
 * Returns the cached `VesselInfo` for an IMO, fetching from `vessel-api` on a miss.
 *
 * A fetch failure is NOT cached — it propagates to the caller so the request handler can
 * fold the IMO into `unresolvedCount` (via `Promise.allSettled`). A successful fetch that
 * yields `null` (404 / unknown vessel) IS cached to avoid re-hitting a known-miss.
 */
export async function getVesselCached(imo: string): Promise<VesselInfo | null> {
  const now = Date.now()
  const hit = cache.get(imo)
  if (hit && hit.exp > now) return hit.v

  const vessel = await fetchVessel(imo)
  evictIfNeeded(Date.now())
  cache.set(imo, { v: vessel, exp: Date.now() + TTL_MS })
  return vessel
}

/** Test-only: clear the process-global cache. */
export function __clearVesselCache(): void {
  cache.clear()
}

// ─── Concurrency-capped fan-out ──────────────────────────────

/**
 * Run `task` over `items` with at most `concurrency` in flight, returning results in the
 * same order as `items`. Mirrors `Promise.allSettled` semantics: never rejects — each slot
 * resolves to `{ status: 'fulfilled', value }` or `{ status: 'rejected', reason }`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
