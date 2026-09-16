'use client'

/**
 * DENSITY PREFERENCE — persistence for the user-settable row/type density.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * DECISION 1 — localStorage, NOT the perspective / preference API.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The 3 Aug 2026 INF workshops recorded a real incident (A3): a user changed
 * what she believed was her own view setting and changed it for the whole
 * organisation. Her reaction, verbatim:
 *
 *     "Czyli jak tu porobiłam, to porobiłam wszystkim?"  —  "Tak."
 *
 * That was received as a BUG, not as a feature. Density is the same class of
 * setting — it is about one person's eyes and one person's monitor — so the
 * single hardest requirement here is that it CANNOT leak between users.
 *
 * Weighing the two options honestly:
 *
 *   localStorage                         perspective API (/api/perspectives/:id)
 *   ─────────────────────────────────    ────────────────────────────────────────
 *   + physically cannot leak to          − perspectives are a SHARED, server-held
 *     another user account: it is a        object; sharing one is a supported
 *     browser-profile-local store          feature, which is exactly the A3
 *                                          leak vector we must not re-open
 *   + zero server work, zero new         − needs an endpoint change, a migration
 *     endpoint, no migration               path and a review
 *   + synchronous on read → the grid     − a round trip before the first paint,
 *     paints at the right density          i.e. a visible comfortable→dense flash
 *     without a request                    on every page load
 *   + testable today                     − being modified by a concurrent wave
 *                                          RIGHT NOW; depending on it creates a
 *                                          coupling that cannot be tested today
 *   − does not follow the user to a      + follows the user across machines
 *     second machine
 *
 * Only the last row favours the API, and it is the weakest of the six: density
 * is a function of the SCREEN you are sitting at. A user on a 27" desk monitor
 * and a 13" laptop plausibly wants different answers, so per-device is arguably
 * the more correct semantics rather than a compromise. RECOMMENDATION TAKEN:
 * localStorage.
 *
 * This mirrors `useColumnWidthPersistence`, which reached the same conclusion
 * for column widths and states it in the same terms ("a per-device ergonomic
 * preference"). We deliberately share its `fms.dt.uid` scope cache rather than
 * inventing a second one.
 *
 * If cross-machine sync is ever asked for, the shape to add is a per-USER
 * (never per-perspective, never per-organisation) settings row that seeds
 * localStorage on login — not a move of the read path onto the network.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * DECISION 2 — ONE setting across ALL grids, not per table.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The storage key contains NO tableId. That is deliberate.
 *
 * Argued from how the two users in the workshop actually work:
 *
 *   • Klaudiusz lives in ONE wide table all day. For him per-table and global
 *     are indistinguishable — he would set it once either way. Per-table buys
 *     him nothing.
 *
 *   • Agnieszka moves between the container table, offers, invoices and
 *     folders. Per-table would make her set the same preference four times,
 *     and — worse — would leave her with grids at inconsistent densities that
 *     she never chose, because she only ever visited some of them. She would
 *     read that as the application being broken, which is precisely how A3
 *     was received.
 *
 * Density is a statement about the reader (my eyes, my monitor, how I scan),
 * not about the data. A statement about the reader has exactly one correct
 * scope: the reader.
 *
 * The obvious objection — "a 4-column drawer sub-table does not need dense" —
 * costs nothing: a user who selected `dense` selected it because they can read
 * 11px, and a narrow table rendered dense is merely tidier. Where a table
 * genuinely must pin a level for structural reasons (a two-row summary strip),
 * that is a DEVELOPER decision, not a user preference, and it is expressed by
 * passing `override` — which is read-only and never written to storage.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY A MODULE-LEVEL STORE RATHER THAN useState
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * A page can mount several grids at once (a list plus a drawer sub-table).
 * With `useState` per hook, changing density in the toolbar would restyle one
 * grid and leave its neighbour behind. One module-level value + a subscriber
 * set means every mounted grid and every `DensityControl` on the page observes
 * the same level, and `useSyncExternalStore` makes that correct under
 * concurrent rendering rather than merely usually right.
 */

import * as React from 'react'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import { getCurrentOrganizationScope } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { DEFAULT_DENSITY, isDensityLevel, type DensityLevel } from '../types/density'

/**
 * Storage key prefix. Note what is NOT in the key: no tableId, no perspective
 * id, no organisation id. See DECISION 2. The scope segment is the USER.
 */
export const DENSITY_STORAGE_PREFIX = 'fms.dt.density'

/**
 * Cache of the last authoritative userId.
 *
 * SHARED WITH `useColumnWidthPersistence` on purpose — it is the same question
 * ("who is this, synchronously, before the first paint?") and two caches would
 * drift. Whichever hook resolves first populates it for the other.
 */
export const DENSITY_SCOPE_CACHE_KEY = 'fms.dt.uid'

/** Scope used when neither a cached userId nor an organisation is knowable. */
const FALLBACK_SCOPE = 'shared'

function keyFor(scope: string): string {
  return `${DENSITY_STORAGE_PREFIX}:${scope}`
}

/* ───────────────────────────────────────────────────────────────────────────
   MODULE-LEVEL STORE
   ─────────────────────────────────────────────────────────────────────────── */

type Listener = () => void

const listeners = new Set<Listener>()

/**
 * The level every mounted grid observes. A primitive, so `getSnapshot` returns
 * a referentially stable value and `useSyncExternalStore` cannot loop.
 */
/**
 * Level PER TABLE, not per app.
 *
 * This was a single module-level value, so choosing "dense" in one grid
 * silently re-laid-out every other grid on screen — very visible once split
 * view can show three at once. Keyed by the table's storage id (which is
 * already pane-scoped, so two panes of the same table are independent too).
 */
const levels = new Map<string, DensityLevel>()
/** Applies to any table with no choice of its own. Also the legacy value. */
let currentLevel: DensityLevel = DEFAULT_DENSITY
/** Scope the current level was read under. `null` until first hydration. */
let currentScope: string | null = null
/** Whether `currentScope` came from the uid cache (vs an org/shared fallback). */
let scopeFromCache = false
let hydrated = false
let storageListenerAttached = false

function emit(): void {
  // Copy: a listener may unsubscribe during notification.
  for (const listener of Array.from(listeners)) listener()
}

/** Raw read — returns the stored level, or `null` for absent/corrupt/blocked. */
function readRaw(key: string): DensityLevel | null {
  try {
    const raw = window.localStorage.getItem(key)
    return isDensityLevel(raw) ? raw : null
  } catch {
    // Storage blocked (Safari private mode, hardened profile). Not an error
    // condition for us — a user with no reachable storage simply gets the
    // default every load, which is today's rendering.
    return null
  }
}

function writeRaw(key: string, level: DensityLevel): void {
  try {
    window.localStorage.setItem(key, level)
  } catch {
    // Quota exceeded / storage blocked. Persistence is best-effort; the
    // in-memory value still applies for this session, so the user's click is
    // never ignored — it just does not survive a reload.
  }
}

/**
 * Best-effort scope resolvable WITHOUT a network call: cached userId → active
 * organisation → shared. Synchronous, so the grid can paint at the right
 * density instead of flashing comfortable and re-laying-out.
 */
function syncScope(): { scope: string; fromCache: boolean } {
  try {
    const cached = window.localStorage.getItem(DENSITY_SCOPE_CACHE_KEY)
    if (cached) return { scope: cached, fromCache: true }
  } catch {
    /* storage unavailable */
  }
  let org: string | null = null
  try {
    org = getCurrentOrganizationScope().organizationId
  } catch {
    /* scope module not ready */
  }
  return { scope: org || FALLBACK_SCOPE, fromCache: false }
}

/**
 * Read storage into the module store. Idempotent, silent (never emits — it
 * runs inside `getSnapshot`, which must not have observable side effects).
 */
function hydrate(): void {
  if (hydrated) return
  hydrated = true
  if (typeof window === 'undefined') return
  const resolved = syncScope()
  currentScope = resolved.scope
  scopeFromCache = resolved.fromCache
  currentLevel = readRaw(keyFor(resolved.scope)) ?? DEFAULT_DENSITY
}

function onStorage(event: StorageEvent): void {
  // `key === null` is a `localStorage.clear()` from another tab.
  const watched = keyFor(currentScope ?? FALLBACK_SCOPE)
  if (event.key !== null && event.key !== watched) return
  const next = readRaw(watched) ?? DEFAULT_DENSITY
  if (next === currentLevel) return
  currentLevel = next
  emit()
}

/* ───────────────────────────────────────────────────────────────────────────
   PUBLIC STORE API — usable outside React (tests, imperative callers)
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Current level for `tableKey`, falling back to the legacy app-wide value so a
 * user who had chosen a density before this was keyed keeps seeing it.
 */
export function getDensityPreference(tableKey?: string): DensityLevel {
  if (!hydrated) hydrate()
  if (!tableKey) return currentLevel
  const own = levels.get(tableKey)
  if (own) return own
  const stored = typeof window !== 'undefined'
    ? readRaw(`${keyFor(currentScope ?? FALLBACK_SCOPE)}:${tableKey}`)
    : null
  if (stored) {
    levels.set(tableKey, stored)
    return stored
  }
  return currentLevel
}

/**
 * The level React uses while hydrating a server-rendered tree.
 *
 * MUST be `DEFAULT_DENSITY`: the server has no access to the user's
 * localStorage, so any other answer would be a hydration mismatch. A user whose
 * stored preference is `dense` therefore hydrates at `comfortable` and is
 * corrected in the same commit — one attribute swap on a container, no reflow
 * beyond the grid, no request.
 */
export function getServerDensityPreference(): DensityLevel {
  return DEFAULT_DENSITY
}

/** Subscribe to level changes. Returns an unsubscribe function. */
export function subscribeDensityPreference(listener: Listener): () => void {
  listeners.add(listener)
  if (!storageListenerAttached && typeof window !== 'undefined') {
    storageListenerAttached = true
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Set and persist the level. No-op for an unchanged or invalid value, so a
 * corrupt caller can never blank the grid or spam re-renders.
 */
export function setDensityPreference(level: DensityLevel, tableKey?: string): void {
  if (!isDensityLevel(level)) return
  hydrate()
  const base = keyFor(currentScope ?? FALLBACK_SCOPE)
  if (tableKey) {
    if (levels.get(tableKey) === level) return
    levels.set(tableKey, level)
    if (typeof window !== 'undefined') writeRaw(`${base}:${tableKey}`, level)
    emit()
    return
  }
  if (currentLevel === level) return
  currentLevel = level
  if (typeof window !== 'undefined') writeRaw(base, level)
  emit()
}

/* ───────────────────────────────────────────────────────────────────────────
   IDENTITY CONFIRMATION — the A3 guarantee
   ─────────────────────────────────────────────────────────────────────────── */

let identityPromise: Promise<void> | null = null

/**
 * Confirm the authoritative userId in the background and reconcile the scope.
 *
 * This is what closes the last leak. `syncScope()` can only guess before the
 * first request completes, and the guess ("shared", or the organisation id) is
 * shared by construction. Two cases, resolved differently on purpose:
 *
 *   • painted under a FALLBACK scope (no uid cache yet) — this is the same
 *     user's first visit on this browser, so carry their choice forward to the
 *     user-scoped key. Losing a just-made setting on reload reads as a bug.
 *
 *   • painted under a DIFFERENT cached uid — a second account on this machine.
 *     Do NOT carry anything: load this user's own preference, which for a new
 *     user is `comfortable`. This is the case A3 is about, and inheriting here
 *     would be the exact defect.
 *
 * Runs at most ONCE per page load however many grids mount (`identityPromise`),
 * and every failure path is silent: an unreachable auth endpoint must never
 * cost the user their density.
 */
export function ensureDensityScope(): Promise<void> {
  if (identityPromise) return identityPromise
  identityPromise = (async () => {
    if (typeof window === 'undefined') return
    hydrate()
    const painted = currentScope ?? FALLBACK_SCOPE
    const paintedFromCache = scopeFromCache

    let uid: string | null = null
    try {
      const res = await apiCall<{ ok: boolean; userId?: string }>('/api/auth/feature-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: [] }),
      })
      if (res.ok && typeof res.result?.userId === 'string' && res.result.userId) {
        uid = res.result.userId
      }
    } catch {
      return // keep the scope we painted with
    }
    if (!uid || uid === painted) {
      if (uid) {
        try {
          window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, uid)
        } catch {
          /* ignore */
        }
      }
      return
    }

    try {
      window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, uid)
    } catch {
      /* ignore */
    }

    const uidKey = keyFor(uid)
    if (!paintedFromCache) {
      // Same user, first ever resolution — carry the fallback-scoped choice.
      // Never overwrite a preference this user already has.
      const carried = readRaw(keyFor(painted))
      if (carried && readRaw(uidKey) === null) writeRaw(uidKey, carried)
    }

    currentScope = uid
    scopeFromCache = true
    const next = readRaw(uidKey) ?? DEFAULT_DENSITY
    if (next !== currentLevel) {
      currentLevel = next
      emit()
    }
  })()
  return identityPromise
}

/**
 * Drop all in-memory state. FOR TESTS ONLY — it exists because the store is
 * module-level and therefore survives between test cases.
 */
export function resetDensityPreferenceStore(): void {
  listeners.clear()
  currentLevel = DEFAULT_DENSITY
  currentScope = null
  scopeFromCache = false
  hydrated = false
  identityPromise = null
  if (storageListenerAttached && typeof window !== 'undefined') {
    window.removeEventListener('storage', onStorage)
    storageListenerAttached = false
  }
}

/* ───────────────────────────────────────────────────────────────────────────
   REACT HOOK
   ─────────────────────────────────────────────────────────────────────────── */

export interface UseDensityPreferenceResult {
  /** The level to render at — the override when one is given, else the user's. */
  density: DensityLevel
  /**
   * Persist a new level for this user, across every grid on the page.
   * A no-op while an override is in force (a pinned table is not a preference).
   */
  setDensity: (level: DensityLevel) => void
  /** True when `density` came from `override` rather than from the user. */
  isOverridden: boolean
}

/**
 * Read (and write) the current user's density preference.
 *
 * @param override  A developer-pinned level for a table whose structure demands
 *                  one (e.g. a fixed-height summary strip). Read-only: it wins
 *                  over the preference for THIS table and is never persisted,
 *                  so it cannot silently become the user's setting everywhere.
 */
export function useDensityPreference(
  override?: DensityLevel | null,
  /** Table storage id — already pane-scoped, so panes are independent. */
  tableKey?: string,
): UseDensityPreferenceResult {
  const getSnapshot = React.useCallback(() => getDensityPreference(tableKey), [tableKey])
  const stored = React.useSyncExternalStore(
    subscribeDensityPreference,
    getSnapshot,
    getServerDensityPreference,
  )

  // Fire-and-forget; resolves once per page however many grids mount.
  React.useEffect(() => {
    void ensureDensityScope()
  }, [])

  const isOverridden = isDensityLevel(override)

  const setDensity = React.useCallback(
    (level: DensityLevel) => {
      if (isOverridden) return
      setDensityPreference(level, tableKey)
    },
    [isOverridden, tableKey],
  )

  return {
    density: isOverridden ? (override as DensityLevel) : stored,
    setDensity,
    isOverridden,
  }
}
