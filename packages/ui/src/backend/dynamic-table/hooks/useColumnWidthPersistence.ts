'use client'

import * as React from 'react'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import { getCurrentOrganizationScope } from '@open-mercato/shared/lib/frontend/organizationEvents'
import type { CellStore } from '../store/index'
import type { ColumnDef } from '../types/index'

// Column widths are a per-device ergonomic preference, so we persist them in
// localStorage rather than server-side perspectives. The key is scoped to the
// signed-in user (so two accounts on the same machine keep separate layouts),
// falling back to the active organization and finally a shared bucket. Widths are
// stored by column `data` key — NOT the store's column index — so they survive
// column reorder / show-hide.
const STORAGE_PREFIX = 'fms.dt.colw'
// Last authoritative userId, cached so the storage scope is known *synchronously*
// on the next load. That lets us apply saved widths in a layout effect (before
// the browser paints) instead of after an async /api/auth/feature-check round
// trip — which is what caused the visible default-then-resize layout shift.
const SCOPE_CACHE_KEY = 'fms.dt.uid'

// Apply widths before paint on the client; degrade to a no-op-safe passive effect
// during SSR (useLayoutEffect warns and does nothing on the server).
const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect

type StoredWidths = Record<string, number>

function keyFor(scope: string, tableId: string): string {
  return `${STORAGE_PREFIX}:${scope}:${tableId}`
}

/** Best-effort scope resolvable without a network call: cached userId → org → shared. */
function syncScope(): { scope: string; fromCache: boolean } {
  try {
    const cached = window.localStorage.getItem(SCOPE_CACHE_KEY)
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
  return { scope: org || 'shared', fromCache: false }
}

function readStored(key: string): StoredWidths {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as StoredWidths
  } catch {
    /* corrupt / unavailable storage — treat as empty */
  }
  return {}
}

function writeStored(key: string, value: StoredWidths): void {
  try {
    if (Object.keys(value).length === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full / blocked (private mode) — silently skip persistence */
  }
}

/** Returns how many columns were actually re-sized, so the caller can skip a needless re-render. */
function applyStored(
  store: CellStore,
  cols: ColumnDef[],
  stored: StoredWidths,
  userResizedColsRef: React.MutableRefObject<Set<number>>,
): number {
  let applied = 0
  cols.forEach((col, idx) => {
    const w = stored[col.data]
    if (typeof w === 'number' && w > 0) {
      store.setColumnWidth(idx, w)
      // Mark as user-resized so badge auto-fit / stretch don't override it.
      userResizedColsRef.current.add(idx)
      applied++
    }
  })
  return applied
}

export interface ColumnWidthPersistenceOptions {
  /** Stable table identity. When omitted, persistence is disabled (legacy behavior). */
  tableId?: string
  store: CellStore
  /** Columns in current (visible) order — index in this array maps to the store column index. */
  cols: ColumnDef[]
  /** Columns the user has explicitly sized; loaded widths are added so auto-fit/stretch won't override them. */
  userResizedColsRef: React.MutableRefObject<Set<number>>
}

export interface ColumnWidthPersistenceResult {
  /** Call on resize end with the resized column index to persist its width. */
  persistResize: (colIndex: number) => void
}

export function useColumnWidthPersistence({
  tableId,
  store,
  cols,
  userResizedColsRef,
}: ColumnWidthPersistenceOptions): ColumnWidthPersistenceResult {
  // Scope the widths were last applied under. Kept in a ref so persistResize and
  // the async confirmation below always read the current value without re-binding.
  const scopeRef = React.useRef<string>('')
  const scopeFromCacheRef = React.useRef<boolean>(false)
  const appliedKeyRef = React.useRef<string>('')

  // The store's change-subscription that drives the table's re-render is attached
  // in a passive effect that runs *after* our mount layout effect, so writing
  // widths to the store there notifies no one. Force a synchronous (pre-paint)
  // re-render of this component so the applied widths actually get painted.
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0)

  // Latest columns, read by the (run-once) async resolver without re-firing it.
  const colsRef = React.useRef(cols)
  colsRef.current = cols

  // Apply saved widths BEFORE the first paint, using the synchronously-known
  // scope — no layout shift. Guarded to run once per resolved key; column
  // reorder/show-hide is handled by the store preserving widths across
  // setColumns(), so this does not need to re-run on `cols` changes.
  useIsoLayoutEffect(() => {
    if (!tableId) return
    const { scope, fromCache } = syncScope()
    scopeRef.current = scope
    scopeFromCacheRef.current = fromCache
    const key = keyFor(scope, tableId)
    if (appliedKeyRef.current === key) return
    appliedKeyRef.current = key
    if (applyStored(store, cols, readStored(key), userResizedColsRef) > 0) forceRender()
    // `cols` intentionally read but not a trigger — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, store, userResizedColsRef])

  // Confirm the authoritative userId in the background and cache it for next load.
  // If it differs from the scope we painted with, reconcile so the layout is both
  // correct and never leaks between accounts:
  //  • painted with an org/shared fallback (no cache yet) → same user's first
  //    visit: migrate any widths saved under the fallback to the user key.
  //  • painted with a *different* cached user id → another account on this
  //    browser: wipe the borrowed layout and apply this user's own.
  React.useEffect(() => {
    if (!tableId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<{ ok: boolean; userId?: string }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: [] }),
        })
        if (cancelled || !res.ok) return
        const uid = res.result?.userId
        if (typeof uid !== 'string' || !uid) return

        const prevScope = scopeRef.current
        const prevFromCache = scopeFromCacheRef.current
        try { window.localStorage.setItem(SCOPE_CACHE_KEY, uid) } catch { /* ignore */ }
        if (prevScope === uid) return

        const uidKey = keyFor(uid, tableId)
        if (!prevFromCache) {
          // Same user, first ever resolution: carry forward fallback-scoped widths.
          const carried = readStored(keyFor(prevScope, tableId))
          if (Object.keys(carried).length) {
            writeStored(uidKey, { ...carried, ...readStored(uidKey) })
          }
        } else {
          // Different account painted first — reset before applying this user's.
          store.reinitColumnWidths()
          userResizedColsRef.current.clear()
        }
        scopeRef.current = uid
        scopeFromCacheRef.current = true
        appliedKeyRef.current = uidKey
        applyStored(store, colsRef.current, readStored(uidKey), userResizedColsRef)
        forceRender()
      } catch {
        /* keep the scope we painted with */
      }
    })()
    return () => { cancelled = true }
    // Resolve the user id once per table — column changes are read via colsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, store, userResizedColsRef])

  const persistResize = React.useCallback(
    (colIndex: number) => {
      if (!tableId) return
      const col = cols[colIndex]
      if (!col) return
      const scope = scopeRef.current || syncScope().scope
      const key = keyFor(scope, tableId)
      const stored = readStored(key)
      // The DECLARED width. Persisting the painted one would save this
      // session's fill-to-container surplus as if the user had chosen it, and
      // a narrower window next time would then inherit a column nobody sized.
      stored[col.data] = store.getBaseColumnWidth(colIndex)
      writeStored(key, stored)
    },
    [tableId, cols, store],
  )

  return { persistResize }
}
