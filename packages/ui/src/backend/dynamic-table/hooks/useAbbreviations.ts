'use client'

/**
 * DynamicTable — ABBREVIATION DICTIONARY SUBSCRIPTION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `utils/abbreviations.ts` is a process-local registry populated ONCE at app
 * boot from the `facilities` and `contractors` tables. That import order is the
 * whole problem this file exists to solve:
 *
 *   1. the grid mounts and renders every cell — dictionary still empty,
 *   2. the boot fetch resolves and `registerAbbreviations` fills the registry,
 *   3. …and nothing re-renders, so the user keeps looking at "Port Gdańsk"
 *      until they happen to sort, filter or page.
 *
 * The registry's own doc says consumers "must include `abbreviationsVersion()`
 * in their dependency list", but a plain module-level integer is not something
 * React can observe — reading it inside a `useMemo` captures whatever it was at
 * mount and never notices the bump. `useSyncExternalStore` is the correct
 * primitive: `subscribeAbbreviations` is the subscribe half, and
 * `abbreviationsVersion` is the snapshot half.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 * Put the returned number in the dependency list of whatever memoizes derived
 * label output — the column definitions, a precomputed initials index:
 *
 *     const abbrevVersion = useAbbreviationsVersion()
 *     const columns = React.useMemo(() => buildColumns(), [cfg, abbrevVersion])
 *
 * ── Why the version and not the dictionary itself ──────────────────────────
 * The renderers read the registry directly at render time (one `Map.get`), so
 * they never need the dictionary threaded through props. All that is missing is
 * the SIGNAL that a re-render is now worth doing, and an integer is the
 * cheapest possible carrier for it — it changes at most twice in the lifetime
 * of a page, so nothing downstream is re-computed on any other pass.
 *
 * ── SSR ────────────────────────────────────────────────────────────────────
 * The server snapshot is a constant `0` rather than `abbreviationsVersion()`.
 * On the server the registry only ever holds the static seed, and returning a
 * value that could differ between the server render and the client's first
 * render is precisely the hydration mismatch `getServerSnapshot` exists to
 * prevent.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import * as React from 'react'

import { abbreviationsVersion, subscribeAbbreviations } from '../utils/abbreviations'

/** Constant across every server render — see the SSR note above. */
function getServerSnapshot(): number {
  return 0
}

/**
 * The current abbreviation-dictionary version, re-rendering the caller whenever
 * a dictionary is registered.
 */
export function useAbbreviationsVersion(): number {
  return React.useSyncExternalStore(
    subscribeAbbreviations,
    abbreviationsVersion,
    getServerSnapshot,
  )
}

export default useAbbreviationsVersion
