'use client'

/**
 * THE PERSON'S OWN DEFAULT VIEW FOR A TABLE WHOSE PAGE KEEPS NO VIEWS.
 *
 * A grid whose host passes `savedPerspectives` / `activePerspectiveId` (a list page through `useDynamicTablePage`, a
 * split-view pane) has always written the person's column changes into their own `__base__` row through the host. A
 * grid whose host passes neither (a drawer sub-table, a settings list, a widget, a folder's flights) had nowhere to
 * write: a hidden column came back on the next visit (GT, GEPARD-283 — "czy każdy indywidualnie może zapisywać
 * widok?"). This hook gives every such grid with a `tableId` the same row, kept by the grid itself:
 *
 *  - read once per table and person from `GET /api/perspectives/<tableId>` — the person's own `__base__` row, the
 *    same row a host would have written, so nothing new on the server;
 *  - written ONLY when the person changes something (`save`), never on load and never from the table's defaults —
 *    a table nobody touched has no row;
 *  - per person by construction: the upstream perspectives service scopes rows by `user_id`; only the explicit
 *    Publish action shares a view, and this hook never publishes.
 *
 * A failed read (no `perspectives.use` feature, no route in a Storybook) leaves the grid as it was — nothing applied,
 * nothing written — instead of failing a write on every click.
 */

import * as React from 'react'
import { apiCall } from '../../utils/apiCall'
import { flash } from '../../FlashMessages'
import type { PerspectiveConfig } from '../types/perspective'
import { BASE_VIEW_PERSPECTIVE_NAME } from '../types/perspective'
import { apiToDynamicTable, dynamicTableToApi } from '../utils/perspectiveTransforms'
import type {
  PerspectiveDto,
  PerspectiveSettings,
  PerspectivesIndexResponse,
} from '@open-mercato/shared/modules/perspectives/types'

type StoredRow = { settings: PerspectiveSettings }

/**
 * The rows already read in this page session, so a table that unmounts and mounts again (a folder's widgets when the
 * person opens the next folder) paints the person's layout without a second request. Keyed by the person: the same
 * `fms.dt.uid` the column widths and the density are scoped by.
 */
const rowCache = new Map<string, StoredRow | null>()

function personScope(): string {
  try {
    return window.localStorage.getItem('fms.dt.uid') || 'shared'
  } catch {
    return 'shared'
  }
}

/** Test hook: forget every row read so far. */
export function __resetOwnBaseViewCache(): void {
  rowCache.clear()
}

export interface OwnBaseView {
  /** The person's own default view, or null while there is none (or it has not loaded). */
  view: PerspectiveConfig | null
  /** True once the read settled, whatever it returned. */
  loaded: boolean
  /** Keep this as the person's own default view: shown at once, written to the server. */
  save: (perspective: PerspectiveConfig) => void
}

export function useOwnBaseView(options: {
  tableId: string | undefined
  enabled: boolean
  allColumns: string[]
  defaultHiddenColumns: string[]
  saveFailedMessage: string
}): OwnBaseView {
  const { tableId, enabled, allColumns, defaultHiddenColumns, saveFailedMessage } = options
  const active = enabled && !!tableId
  const cacheKey = active ? `${personScope()}:${tableId}` : ''
  const [row, setRow] = React.useState<StoredRow | null>(() => (active ? rowCache.get(cacheKey) ?? null : null))
  const [loaded, setLoaded] = React.useState(() => active && rowCache.has(cacheKey))
  // The id the GRID knows this row by. It must not change when the server answers a first write with its own id: the
  // grid applies a view when the active id changes, and re-applying would undo whatever the person did meanwhile.
  const gridIdRef = React.useRef<string | null>(null)
  const serverIdRef = React.useRef<string | undefined>(undefined)
  const writableRef = React.useRef(true)
  // A change made before the read answered wins over what the read brings back.
  const changedRef = React.useRef(false)
  const failureShownRef = React.useRef(false)

  React.useEffect(() => {
    if (!active) return
    let cancelled = false
    changedRef.current = false
    if (rowCache.has(cacheKey)) {
      const cached = rowCache.get(cacheKey) ?? null
      setRow(cached)
      setLoaded(true)
      // The server id of a cached row was kept with it.
      serverIdRef.current = (cached as (StoredRow & { serverId?: string }) | null)?.serverId
      return
    }
    setLoaded(false)
    void (async () => {
      const response = await apiCall<PerspectivesIndexResponse>(`/api/perspectives/${encodeURIComponent(tableId as string)}`)
      if (cancelled) return
      if (!response.ok || !response.result) {
        writableRef.current = false
        setLoaded(true)
        return
      }
      writableRef.current = true
      const own = (response.result.perspectives ?? []).find((p: PerspectiveDto) => p.name === BASE_VIEW_PERSPECTIVE_NAME)
      const next = own ? ({ settings: own.settings, serverId: own.id } as StoredRow & { serverId: string }) : null
      if (!changedRef.current) {
        serverIdRef.current = own?.id
        if (own) gridIdRef.current = own.id
        rowCache.set(cacheKey, next)
        setRow(next)
      } else if (own && !serverIdRef.current) {
        // The person already changed something: keep their change, but write it into the row that exists.
        serverIdRef.current = own.id
      }
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [active, cacheKey, tableId])

  const columnsKey = allColumns.join('|')
  const hiddenKey = defaultHiddenColumns.join('|')
  const view = React.useMemo<PerspectiveConfig | null>(() => {
    if (!active || !row) return null
    if (!gridIdRef.current) gridIdRef.current = serverIdRef.current ?? `own-base-${tableId}`
    const dto = {
      id: gridIdRef.current,
      name: BASE_VIEW_PERSPECTIVE_NAME,
      settings: row.settings,
    } as unknown as PerspectiveDto
    // A row named `__base__` is the person's default view whether or not an older writer marked it.
    return { ...apiToDynamicTable(dto, allColumns, defaultHiddenColumns), id: gridIdRef.current, isBaseView: true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, row, columnsKey, hiddenKey, tableId])

  const save = React.useCallback(
    (perspective: PerspectiveConfig) => {
      if (!active || !perspective.isBaseView) return
      changedRef.current = true
      if (!gridIdRef.current) gridIdRef.current = perspective.id
      const settings = dynamicTableToApi({ ...perspective, name: BASE_VIEW_PERSPECTIVE_NAME, isBaseView: true })
      const next = { settings, serverId: serverIdRef.current } as StoredRow & { serverId?: string }
      rowCache.set(cacheKey, next)
      setRow(next)
      if (!writableRef.current) return
      void (async () => {
        const response = await apiCall<{ perspective?: { id?: string } }>(
          `/api/perspectives/${encodeURIComponent(tableId as string)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              perspectiveId: serverIdRef.current,
              name: BASE_VIEW_PERSPECTIVE_NAME,
              settings,
              isDefault: false,
            }),
          },
        )
        if (response.ok) {
          const id = response.result?.perspective?.id
          if (id) {
            serverIdRef.current = id
            const cached = rowCache.get(cacheKey) as (StoredRow & { serverId?: string }) | null | undefined
            if (cached) rowCache.set(cacheKey, { ...cached, serverId: id } as StoredRow)
          }
        } else if (!failureShownRef.current) {
          // Said once per table, not once per click: the layout still applies on screen.
          failureShownRef.current = true
          flash(saveFailedMessage, 'error')
        }
      })()
    },
    [active, cacheKey, tableId, saveFailedMessage],
  )

  return { view, loaded: active ? loaded : true, save }
}
