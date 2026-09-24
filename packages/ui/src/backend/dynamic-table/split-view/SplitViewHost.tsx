'use client'

/**
 * Split view — renders a WORKSPACE of registered tables and widgets in one
 * screen: a main grid (a tree of slots) and, below it, optional sections of up
 * to four more.
 *
 * A table page renders this instead of its table component, naming itself as
 * the only pane. With one pane it looks exactly like the page did before this
 * feature existed, plus one small "Dostosuj" tab in the page's top padding.
 * The workspace bar and the pane cards appear only once there is more than one
 * slot. That is what makes it ambient — you compose from where you already are.
 *
 * Where each control lives (the designer's prototype, gt-demo 03.09–14.09):
 *   - "Dostosuj" tab → the "Dostosowanie widoku" drawer: grid, slots, layouts.
 *   - Workspace bar (split only): shared search + filters, "Wspólne / Per
 *     tabela", "Dodaj widget", "Wygląd", "Pełny ekran".
 *   - A pane's ⋮: open its section, swap it, add beside it, remove it.
 *   - A table's ⚙: density and which of its bars are shown.
 *
 * The grid needs no changes to work here: its event bus is per-element, copy
 * and paste are both target-guarded, `height: 'fill'` measures against the
 * nearest scroll ancestor (each pane is one), and the cell store — including
 * its undo stack — is created per instance.
 *
 * Specs: .ai/specs/2026-08-04-dynamic-table-split-view.md
 *        .ai/specs/2026-08-17-split-view-workspace-composition.md
 *        .ai/specs/2026-09-23-split-view-workspace-customize.md
 */

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import ReactDOM from 'react-dom'
import { SlidersHorizontal } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useTableById, useTableRegistry } from '../registry/TableRegistryContext'
import { TableDisplayContext, type TableDisplayHost } from '../components/TableDisplayContext'
import { widgetPresentation } from '../registry/widgetPresentation'
import { AnchoredMenu } from './AnchoredMenu'
import { ContentPicker } from './ContentPicker'
import { CustomizeDrawer } from './CustomizeDrawer'
import { EmptySlot } from './EmptySlot'
import { PaneMenuRows } from './PaneMenu'
import { WidgetPane } from './WidgetPane'
import { AddWidgetMenu, BoxHeader, CustomizeTab, FullscreenToggle, LayoutMenu } from './WorkspaceActions'
import { WorkspaceFilterBar, type UnmappedPaneReport } from './WorkspaceFilterBar'
import { PANE_CARD } from './chrome'
import { mapCriteriaForTable, mapCriteriaForWidget, type SharedCriteria } from './sharedCriteria'
import type { FilterRow } from '../types/index'
import { useSplitViewLayouts } from './useSplitViewLayouts'
import { readStoredLayout, writeStoredLayout } from './layoutPersistence'
import {
  BOX_MAX_SLOTS,
  PANE_MIN_HEIGHT_PX,
  PANE_MIN_WIDTH_PX,
  SPLIT_LAYOUT_VERSION,
  addContent,
  applyBoxTemplate,
  applyGridTemplate,
  countPanes,
  countSlots,
  emptySlotAt,
  evenAll,
  fillSlot,
  isDefaultLayout,
  layoutSignature,
  listAllPanes,
  listAllSlots,
  listSlots,
  removeBox,
  removePane,
  replaceContent,
  resetLayout,
  resizeAt,
  rowsOf,
  setPaneChrome,
  setPaneContentSettings,
  splitPane,
  tableContent,
  templateOf,
  type LayoutNode,
  type NodePath,
  type PaneChrome,
  type PaneContentRef,
  type PaneNode,
  type SplitDirection,
  type SplitLayout,
} from './types'

// The M3 chrome constants used to live in this file and are imported from here
// by name elsewhere; they are re-exported so those imports keep working.
export { M3_MENU_CAPTION, M3_MENU_PANEL, M3_MENU_ROW, M3_MENU_ROW_ON } from './chrome'

// ─────────────────────────────────────────────────────────────────────────────

function PaneMessage({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-body-regular-sm text-[var(--m3-on-surface-variant)]" {...rest}>
      {children}
    </div>
  )
}

/**
 * The ⚙ switches for one table pane, published to the table through
 * `TableDisplayContext` (the table renders the ⚙ itself, because only it knows
 * its own density key). Memoised on the pane's chrome so the table below does
 * not re-render on unrelated layout changes — a divider drag re-renders the
 * host every frame.
 */
function useTableDisplay(
  chrome: PaneChrome | undefined,
  onToggle: (patch: Partial<PaneChrome>) => void,
): TableDisplayHost {
  const t = useT()
  const toggleRef = React.useRef(onToggle)
  toggleRef.current = onToggle
  const toolbar = chrome?.toolbar !== false
  const tabs = chrome?.viewsBar !== false && chrome?.tabs !== false
  const pagination = chrome?.viewsBar !== false && chrome?.pagination !== false
  // `undefined` = the table's own default; the grid reports the effective
  // state back to the switch (see `displayToggles` in DynamicTable).
  const striped = chrome?.striped
  return React.useMemo<TableDisplayHost>(
    () => ({
      striped,
      toggles: [
        { key: 'toolbar', label: t('splitView.tableSettings.toolbar', 'Toolbar'), checked: toolbar, onChange: (next) => toggleRef.current({ toolbar: next }) },
        // `viewsBar` is the legacy all-in-one switch; turning either finer one
        // back on clears it, or the row would stay hidden with both "on".
        { key: 'tabs', label: t('splitView.tableSettings.tabs', 'Tabs bar'), checked: tabs, onChange: (next) => toggleRef.current({ tabs: next, ...(next ? { viewsBar: true } : {}) }) },
        { key: 'pagination', label: t('splitView.tableSettings.pagination', 'Pagination'), checked: pagination, onChange: (next) => toggleRef.current({ pagination: next, ...(next ? { viewsBar: true } : {}) }) },
        { key: 'striped', label: t('splitView.tableSettings.striped', 'Zebra rows'), checked: striped === true, onChange: (next) => toggleRef.current({ striped: next }) },
      ],
    }),
    [t, toolbar, tabs, pagination, striped],
  )
}

function TablePaneBody({
  tableId,
  paneId,
  isPrimary,
  multiview,
  overflowExtras,
  chrome,
  onToggleChrome,
  sharedFilters,
  sharedSearch,
}: {
  tableId: string
  paneId: string
  isPrimary: boolean
  multiview: boolean
  overflowExtras?: React.ReactNode
  chrome?: PaneChrome
  onToggleChrome: (patch: Partial<PaneChrome>) => void
  sharedFilters?: FilterRow[]
  sharedSearch?: string
}) {
  const t = useT()
  const { definition, status } = useTableById(tableId)
  const display = useTableDisplay(chrome, onToggleChrome)

  if (status === 'unknown') {
    return (
      <PaneMessage data-pane-status="unknown">
        {t('splitView.pane.tableUnknown', 'This table is no longer available.')}
      </PaneMessage>
    )
  }
  if (status === 'denied') {
    return (
      <PaneMessage data-pane-status="denied">
        {t('splitView.pane.denied', 'You don’t have access to {title}.', {
          title: definition ? t(definition.metadata.titleKey, definition.metadata.title) : t('splitView.pane.thisTable', 'this table'),
        })}
      </PaneMessage>
    )
  }
  // `loading` = the grant check (a POST to /api/auth/feature-check) has not
  // answered yet. The PRIMARY pane is the page's own table and the server
  // already authorised this route to render it at all, so it is drawn
  // optimistically and the common path is unchanged. SECONDARY panes come out
  // of a SAVED LAYOUT, which can name a table whose grant was revoked since it
  // was saved — that is the case worth waiting for.
  if (status === 'loading' && !isPrimary) {
    return <PaneMessage data-pane-status="loading">{t('splitView.pane.checkingAccess', 'Checking access…')}</PaneMessage>
  }
  if (!definition) return null

  const Table = definition.Table
  // The PRIMARY pane is the page's own table, so it keeps the unscoped keys —
  // byte-identical to before split view existed. Pane ids are minted per
  // mount, so scoping the primary pane would hand every page load a fresh key
  // and silently discard the user's saved column widths on every navigation.
  // Secondary panes DO get a per-pane scope, which is what stops two panes of
  // the same table overwriting each other.
  const storageScope = isPrimary ? '' : `pane:${paneId}:`
  const hideTabs = chrome?.viewsBar === false || chrome?.tabs === false
  const hidePagination = chrome?.viewsBar === false || chrome?.pagination === false
  return (
    <TableDisplayContext.Provider value={display}>
      <Table
        storageScope={storageScope}
        embedded
        // The primary pane IS the page — opening a row is the page doing its
        // job. See `ownsPageNavigation` in registry/types.ts.
        ownsPageNavigation={isPrimary}
        multiview={multiview}
        overflowExtras={overflowExtras}
        hideToolbar={chrome?.toolbar === false}
        // The workspace bar REPLACES each pane's search row while it is on, so
        // the density cost of the bar is paid back by the rows it reclaims.
        hideSearch={chrome?.search === false || sharedSearch !== undefined}
        hideViews={hideTabs}
        hidePagination={hidePagination}
        sharedFilters={sharedFilters}
        sharedSearch={sharedSearch}
      />
    </TableDisplayContext.Provider>
  )
}

/**
 * The way back when a WIDGET pane's header is hidden — hiding it also hides
 * the ⋮ that turned it off. (A table pane gets the same from the grid itself:
 * its ⚙ and ⋯ float in the corner.)
 */
function WidgetRestoreMenu({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="absolute right-2 top-2 z-30" data-pane-restore="">
      <AnchoredMenu
        placement={{ width: 232, preferredHeight: 560, align: 'end' }}
        panelProps={{ 'data-pane-restore-menu': '' }}
        renderTrigger={({ ref, open, toggle }) => (
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            aria-label={t('splitView.pane.options', 'Pane options')}
            aria-expanded={open}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-m3-full bg-[var(--m3-surface-container-lowest)] text-[var(--m3-on-surface-variant)] shadow-m3-1 transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-surface-container-high)] hover:text-[var(--m3-on-surface)]"
            data-pane-restore-btn=""
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      >
        {() => children}
      </AnchoredMenu>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export type SplitViewHostProps = {
  /** The table this page is for — the initial, and always first, pane. */
  tableId: string
}

/**
 * Fill the available height.
 *
 * `h-full` cannot chain here: the AppShell's `<main>` has a real flex height,
 * but the page wrappers between it and us are block-level with `height: auto`,
 * so a percentage height resolves against `auto` and collapses to content.
 * Measure the nearest SCROLL ancestor's client bottom and set an explicit
 * height — the same technique `DynamicTable` uses for `height: 'fill'`, so the
 * two agree instead of fighting.
 */
function useFilledHeight(enabled: boolean) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [height, setHeight] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    if (!enabled) {
      setHeight(null)
      return
    }
    const element = ref.current
    if (!element) return

    let scrollPane: HTMLElement | null = element.parentElement
    while (scrollPane && scrollPane !== document.body) {
      const overflowY = getComputedStyle(scrollPane).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') break
      scrollPane = scrollPane.parentElement
    }

    const measure = () => {
      const rect = element.getBoundingClientRect()
      // The scroll pane's own bottom padding is inside its client box; filling
      // down to that edge overflowed the page by exactly that padding and put
      // a second scrollbar beside the workspace's.
      const bottom =
        scrollPane && scrollPane !== document.body
          ? Math.min(
              window.innerHeight,
              Math.round(scrollPane.getBoundingClientRect().top) +
                scrollPane.clientHeight -
                (parseFloat(getComputedStyle(scrollPane).paddingBottom) || 0),
            )
          : window.innerHeight
      setHeight(Math.max(Math.floor(bottom - rect.top), 320))
    }

    measure()
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    if (scrollPane && scrollPane !== document.body) observer.observe(scrollPane)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [enabled])

  return { ref, height }
}

/**
 * The client height of an element, kept current.
 *
 * Takes the ELEMENT, not a ref object: full screen re-mounts the workspace in a
 * portal, which swaps the element behind a stable ref — an observer keyed on
 * the ref kept watching the detached one, and the main grid collapsed to its
 * minimum height in full screen.
 */
function useClientHeight(element: HTMLElement | null) {
  const [height, setHeight] = React.useState(0)
  React.useLayoutEffect(() => {
    if (!element) return
    const measure = () => setHeight(element.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return height
}

/**
 * The "no shared criteria" value, frozen at module scope — identity matters,
 * because `criteria` feeds the memo that projects criteria onto every pane.
 */
const EMPTY_CRITERIA: SharedCriteria = Object.freeze({
  rules: Object.freeze([]) as unknown as SharedCriteria['rules'],
})

/** The default pane's id: stable across server and client for one table. */
function defaultPaneId(tableId: string): string {
  let hash = 0
  for (let index = 0; index < tableId.length; index++) hash = (hash * 31 + tableId.charCodeAt(index)) | 0
  return `p0${(hash >>> 0).toString(36)}`
}

/**
 * Scroll the workspace — and ONLY the workspace — until a pane is in view.
 * Not `scrollIntoView`: that scrolls every scrollable ancestor too, and moved
 * the whole page up under the navbar, taking the "Dostosuj" tab with it.
 */
function revealPane(paneId: string) {
  const pane = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"], [data-pane-empty="${paneId}"]`)
  const root = pane?.closest<HTMLElement>('[data-split-root]')
  if (!pane || !root) return
  const paneRect = pane.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  if (paneRect.top >= rootRect.top && paneRect.bottom <= rootRect.bottom) return
  const top = root.scrollTop + (paneRect.top - rootRect.top) - SECTION_GAP_PX - BOX_HEADER_PX
  root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

/** Vertical gap between the main grid and the sections, and between sections. */
const SECTION_GAP_PX = 16
/** Room kept clear at the workspace's right edge for an overlay scrollbar. */
const OVERLAY_SCROLLBAR_CLEARANCE_PX = 8
/** A section's header strip. */
const BOX_HEADER_PX = 32

export function SplitViewHost({ tableId }: SplitViewHostProps) {
  const t = useT()
  const registry = useTableRegistry()

  // The server has no stored layout, so the first render — on the server AND
  // during hydration — is always the page's own table. Restoring in the
  // initializer instead made the hydrated tree disagree with the server's
  // (a different arrangement, random pane ids) and React does not patch that.
  //
  // The stored arrangement is read in a LAYOUT effect: it commits before the
  // browser paints, so there is still no flash of the default pane, and the
  // grid is not rendered until then, so no pane mounts only to be replaced.
  //
  // Tables are pruned against the registry once it has loaded (see below);
  // widgets are NOT — the widget catalogue is fetched, so pruning against it
  // at first paint would drop every widget pane on every reload (TC-APP-604).
  // A widget the user can no longer open degrades in its own pane instead.
  const [layout, setLayout] = React.useState<SplitLayout>(() => ({
    // A DETERMINISTIC id: this initializer runs on the server too.
    root: { kind: 'pane', id: defaultPaneId(tableId), content: tableContent(tableId) },
    version: SPLIT_LAYOUT_VERSION,
  }))
  const [restored, setRestored] = React.useState(false)
  // The layout as last restored (or the initial default). Until the user
  // changes something the layout IS this object, and an untouched layout is
  // never written back: that write is what clobbered saved layouts.
  const baselineRef = React.useRef<SplitLayout>(layout)
  const defaultLayoutRef = React.useRef<SplitLayout>(layout)
  const layoutRef = React.useRef(layout)
  layoutRef.current = layout
  // The organisation scope and the table registry both arrive after first
  // paint. The stored layout may be keyed under the organisation (written
  // before the user id resolved), and a read without it finds nothing — so the
  // restore runs again as each arrives, for as long as the user has not
  // touched the layout.
  const scopeVersion = useOrganizationScopeVersion()
  React.useLayoutEffect(() => {
    if (layoutRef.current !== baselineRef.current) return
    // Prune tables only against a registry that has LOADED; against an empty
    // one every pane reads as unknown. A pane whose table really is gone
    // degrades in place instead, like a widget pane.
    const known = registry.ready ? new Set(registry.tables.map((table) => table.metadata.id)) : null
    const stored = readStoredLayout(tableId, (content) =>
      content.kind === 'table' && known ? known.has(content.tableId) : true,
    )
    if (stored) {
      baselineRef.current = stored
      setLayout(stored)
    } else if (baselineRef.current !== defaultLayoutRef.current) {
      // An earlier read (registry not loaded yet) kept panes this one prunes
      // away entirely: back to the page's own table (TC-APP-609).
      baselineRef.current = defaultLayoutRef.current
      setLayout(defaultLayoutRef.current)
    }
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, registry.ready, scopeVersion])

  // Every user mutation funnels through `setLayout`, so one effect covers all
  // of them. Coalesced on an animation frame because a divider drag calls
  // `setLayout` per `mousemove`; the cleanup flushes synchronously so nothing
  // is lost. Nothing is written before the first read, and an untouched layout
  // is not written at all (see `baselineRef`).
  React.useEffect(() => {
    if (!restored || layout === baselineRef.current) return
    let frame: number | null = requestAnimationFrame(() => {
      frame = null
      writeStoredLayout(tableId, layout)
    })
    return () => {
      if (frame === null) return
      cancelAnimationFrame(frame)
      writeStoredLayout(tableId, layout)
    }
  }, [tableId, layout, restored])

  /** What the picker will do with the content you choose. */
  const [pending, setPending] = React.useState<
    | { mode: 'split'; slotId: string; direction: SplitDirection; before: boolean; anchor: DOMRect | null }
    | { mode: 'fill'; slotId: string; anchor: DOMRect | null }
    | null
  >(null)
  const [customizeOpen, setCustomizeOpen] = React.useState(false)
  const [fullscreen, setFullscreen] = React.useState(false)
  const fill = useFilledHeight(!fullscreen)
  const [areaElement, setAreaElement] = React.useState<HTMLDivElement | null>(null)
  const areaHeight = useClientHeight(areaElement)
  // When sections make the workspace scroll, its scrollbar takes width from
  // the grid but not from the bar above it, so the cards stopped short of the
  // bar's right edge. The bar is padded by the same amount.
  // An OVERLAY scrollbar (macOS default) takes no width and draws over the
  // cards' right edge instead; then the workspace keeps a strip clear for it
  // and the bar matches that strip.
  const [scrollbar, setScrollbar] = React.useState({ classic: 0, overlay: 0 })
  React.useLayoutEffect(() => {
    if (!areaElement) return
    const measure = () => {
      const classic = Math.max(0, areaElement.offsetWidth - areaElement.clientWidth)
      const scrolls = areaElement.scrollHeight > areaElement.clientHeight + 1
      const overlay = classic === 0 && scrolls ? OVERLAY_SCROLLBAR_CLEARANCE_PX : 0
      setScrollbar((current) =>
        current.classic === classic && current.overlay === overlay ? current : { classic, overlay },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(areaElement)
    for (const child of Array.from(areaElement.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [areaElement, layout, fullscreen])
  const { layouts, save } = useSplitViewLayouts(tableId)

  // Escape leaves full screen — unless a menu or the drawer is what Escape is for.
  React.useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[data-split-menu-panel], [role="dialog"][data-state="open"]')) return
      setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const panes = React.useMemo(() => listAllPanes(layout), [layout])
  const slotCount = React.useMemo(() => listAllSlots(layout).length, [layout])
  const mainSlotCount = React.useMemo(() => countSlots(layout.root), [layout])
  const boxes = layout.boxes ?? []
  const isSplit = slotCount > 1

  // ── Workspace-shared search and filtering ──
  //
  // Held on the LAYOUT (not in component state beside it), so it rides the
  // same persistence funnel as everything else and a saved layout brings its
  // criteria with it. "Wspólne" is the default for a workspace: the designer's
  // bar opens in shared mode, and a single-pane page never shows the bar.
  const sharedEnabled = layout.sharedFiltersEnabled ?? true
  const criteria = React.useMemo<SharedCriteria>(() => {
    const stored = layout.sharedCriteria
    if (!stored || typeof stored !== 'object') return EMPTY_CRITERIA
    const candidate = stored as Partial<SharedCriteria>
    return Array.isArray(candidate.rules) ? (stored as SharedCriteria) : EMPTY_CRITERIA
  }, [layout.sharedCriteria])
  const setSharedEnabled = React.useCallback((value: boolean) => {
    setLayout((current) =>
      (current.sharedFiltersEnabled ?? true) === value ? current : { ...current, sharedFiltersEnabled: value },
    )
  }, [])
  const setCriteria = React.useCallback((next: SharedCriteria) => {
    setLayout((current) => (current.sharedCriteria === next ? current : { ...current, sharedCriteria: next }))
  }, [])
  const liveCriteria = isSplit && sharedEnabled ? criteria : null
  const hrefFor = React.useCallback(
    (id: string) => registry.tables.find((table) => table.metadata.id === id)?.metadata.href,
    [registry.tables],
  )

  /**
   * The primary pane is the one holding THIS PAGE'S table — matched by
   * identity, never by position. `splitPane(..., before)` inserts the new pane
   * first, so "first pane" would hand the page's unscoped storage keys to
   * whatever was added on its left.
   */
  const primaryPaneId = React.useMemo(() => {
    const own = panes.find((pane) => pane.content.kind === 'table' && pane.content.tableId === tableId)
    return (own ?? panes[0])?.id
  }, [panes, tableId])

  /**
   * Project the workspace criteria onto each pane in that pane's own field
   * names, plus what it could NOT honour — a workspace-level statement, so it
   * is computed here rather than reported upward during a pane's render.
   */
  const perPane = React.useMemo(() => {
    const filters = new Map<string, FilterRow[]>()
    const unmapped: UnmappedPaneReport[] = []
    for (const pane of panes) {
      const isTable = pane.content.kind === 'table'
      const definition = isTable
        ? registry.tables.find((table) => table.metadata.id === (pane.content as { tableId: string }).tableId)
        : undefined
      const result = isTable
        ? mapCriteriaForTable(liveCriteria, definition?.metadata)
        : mapCriteriaForWidget(liveCriteria, (pane.content as { widgetId: string }).widgetId)
      filters.set(pane.id, result.filters)
      if (result.unmapped.length > 0) {
        unmapped.push({
          paneId: pane.id,
          title: definition
            ? t(definition.metadata.titleKey, definition.metadata.title)
            : pane.content.kind === 'widget'
              ? t(`splitView.widgetTitle.${pane.content.widgetId}`, pane.content.widgetId)
              : t('splitView.pane.thisPane', 'This pane'),
          unmapped: result.unmapped,
        })
      }
    }
    return { filters, unmapped }
  }, [panes, registry.tables, liveCriteria, t])

  // `''` (bar on, box empty) must reach the panes so their hidden search boxes
  // stop filtering; `undefined` (bar off) must NOT, so each pane keeps its own.
  const sharedSearch = liveCriteria ? (liveCriteria.search ?? '') : undefined

  // Read `pending` from state, never from inside a `setPending` updater: React
  // calls updaters twice under StrictMode, which once made every split vanish.
  const handlePick = React.useCallback(
    (content: PaneContentRef) => {
      if (!pending) return
      setLayout((current) =>
        pending.mode === 'fill'
          ? fillSlot(current, pending.slotId, content)
          : splitPane(current, pending.slotId, content, pending.direction, pending.before),
      )
      setPending(null)
    },
    [pending],
  )

  /** "Dodaj widget": first free slot, else a new or growing section — then show it. */
  const handleAdd = React.useCallback((content: PaneContentRef) => {
    let landed: string | null = null
    setLayout((current) => {
      const result = addContent(current, content)
      landed = result.slotId
      return result.layout
    })
    // Bring the new pane into view — a full grid puts it in a section below
    // the fold. After a beat, not on the next frame: the menu that asked for
    // it closes and hands focus back to its trigger, and that focus move
    // cancels a smooth scroll started in the same frame.
    window.setTimeout(() => {
      if (landed) revealPane(landed)
    }, 120)
  }, [])

  const signature = React.useMemo(() => layoutSignature(layout), [layout])
  const activeLayoutId = React.useMemo(
    () => layouts.find((saved) => layoutSignature(saved.layout) === signature)?.id ?? null,
    [layouts, signature],
  )
  const isDefault = isDefaultLayout(layout, tableId)

  /**
   * Divider drag. The delta is converted to a fraction of the SPLIT NODE's own
   * extent along its own axis, so a drag means the same proportion wherever
   * the node sits in the tree. `boxId` names the section; absent = main grid.
   */
  const startDrag = React.useCallback(
    (
      splitPath: NodePath,
      index: number,
      start: number,
      axis: SplitDirection,
      element: HTMLElement,
      boxId: string | undefined,
    ) => {
      const container = element.parentElement
      if (!container) return
      const rect = container.getBoundingClientRect()
      const extent = axis === 'row' ? rect.width : rect.height
      if (extent <= 0) return
      let last = start

      const onMove = (event: MouseEvent) => {
        const position = axis === 'row' ? event.clientX : event.clientY
        const delta = position - last
        if (delta === 0) return
        last = position
        setLayout((current) => resizeAt(current, splitPath, index, delta / extent, boxId))
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove, true)
        document.removeEventListener('mouseup', onUp, true)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
      document.body.style.userSelect = 'none'
      document.body.style.cursor = axis === 'row' ? 'col-resize' : 'row-resize'
      document.addEventListener('mousemove', onMove, true)
      document.addEventListener('mouseup', onUp, true)
    },
    [],
  )

  const renderPane = (node: PaneNode) => {
    const isPrimary = node.id === primaryPaneId
    const isWidget = node.content.kind === 'widget'
    const href = node.content.kind === 'table'
      ? hrefFor(node.content.tableId)
      : widgetPresentation(node.content.widgetId).href
    const toggleChrome = (patch: Partial<PaneChrome>) => setLayout((current) => setPaneChrome(current, node.id, patch))
    const paneRows = (
      <PaneMenuRows
        // The primary pane IS this page; "open section" would reload it.
        href={isPrimary ? undefined : href}
        current={node.content}
        canSwap={!isPrimary}
        canRemove={isSplit && !isPrimary}
        widget={isWidget ? { chrome: node.chrome, hasCta: !!href, onToggleChrome: toggleChrome } : undefined}
        onSplit={(direction, before, anchor) => setPending({ mode: 'split', slotId: node.id, direction, before, anchor })}
        onSwap={(content) => setLayout((current) => replaceContent(current, node.id, content))}
        // In a grid, removing a panel leaves its cell for the next one
        // (the prototype's "Usuń panel"); the empty cell has its own ✕ to
        // collapse it. Outside a grid there is no cell to keep.
        onRemove={() => setLayout((current) => (isSplit ? emptySlotAt(current, node.id) : removePane(current, node.id)))}
      />
    )
    const headerHidden = node.chrome?.toolbar === false
    return (
      <div
        // `flex-1` matters: without it a pane sizes to its CONTENT inside a
        // wrapper that has already been given a share. Card chrome only while
        // split — unsplit, `.hot-card` draws its own frame and a second one
        // here would read as a double edge. `overflow-hidden` clips the grid's
        // square header to the card radius.
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden${isSplit ? ` ${PANE_CARD}` : ''}`}
        data-pane-id={node.id}
        data-pane-table={node.content.kind === 'table' ? node.content.tableId : undefined}
        data-pane-widget={node.content.kind === 'widget' ? node.content.widgetId : undefined}
        data-pane-primary={isPrimary ? 'true' : undefined}
        data-pane-toolbar={headerHidden ? 'hidden' : undefined}
      >
        {isWidget && headerHidden && <WidgetRestoreMenu>{paneRows}</WidgetRestoreMenu>}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          {node.content.kind === 'widget' ? (
            <WidgetPane
              content={node.content}
              slotId={node.id}
              onSettingsChange={(next) => setLayout((current) => setPaneContentSettings(current, node.id, next))}
              overflowExtras={paneRows}
              hideToolbar={headerHidden}
              showCta={node.chrome?.cta !== false}
              sharedFilters={perPane.filters.get(node.id)}
            />
          ) : (
            <TablePaneBody
              tableId={node.content.tableId}
              paneId={node.id}
              isPrimary={isPrimary}
              multiview={isSplit}
              overflowExtras={paneRows}
              chrome={node.chrome}
              onToggleChrome={toggleChrome}
              sharedFilters={perPane.filters.get(node.id)}
              sharedSearch={sharedSearch}
            />
          )}
        </div>
      </div>
    )
  }

  /** Recursive renderer: a slot (filled or not), or a split laying children along its axis. */
  const renderNode = (node: LayoutNode, path: NodePath, boxId?: string, treeSlots = mainSlotCount): React.ReactNode => {
    if (node.kind === 'empty') {
      return (
        <EmptySlot
          slotId={node.id}
          canRemove={slotCount > 1 && (treeSlots > 1 || !!boxId)}
          onAdd={(anchor) => setPending({ mode: 'fill', slotId: node.id, anchor })}
          onRemove={() => setLayout((current) => removePane(current, node.id))}
        />
      )
    }
    if (node.kind === 'pane') return renderPane(node)

    const isRow = node.direction === 'row'
    const dividerKey = `${boxId ? `${boxId}/` : ''}${path.join('-') || 'root'}`
    return (
      <div
        className={`flex min-h-0 min-w-0 flex-1 ${isRow ? 'flex-row' : 'flex-col'}`}
        data-split-node={dividerKey}
        data-split-direction={node.direction}
      >
        {/* Keyed on the subtree's first SLOT id, never the index: an index
            shifts when an earlier sibling is removed, which remounted whole
            subtrees and lost scroll, selection, edits and undo stacks. */}
        {node.children.map((child, index) => (
          <React.Fragment key={child.kind === 'split' ? `s:${listSlots(child)[0]?.id ?? index}` : child.id}>
            <div
              className="flex min-h-0 min-w-0 flex-col"
              style={{
                flexGrow: node.sizes[index] ?? 1,
                flexShrink: 1,
                flexBasis: 0,
                minWidth: isRow ? PANE_MIN_WIDTH_PX : undefined,
                minHeight: !isRow ? PANE_MIN_HEIGHT_PX : undefined,
              }}
            >
              {renderNode(child, [...path, index], boxId, treeSlots)}
            </div>
            {index < node.children.length - 1 && (
              <div
                role="separator"
                aria-orientation={isRow ? 'vertical' : 'horizontal'}
                title={t('splitView.divider.hint', 'Drag to resize · double-click to even out')}
                onMouseDown={(event) => {
                  event.preventDefault()
                  startDrag(path, index, isRow ? event.clientX : event.clientY, node.direction, event.currentTarget, boxId)
                }}
                onDoubleClick={() =>
                  setLayout((current) =>
                    boxId
                      ? { ...current, boxes: (current.boxes ?? []).map((box) => (box.id === boxId ? { ...box, root: evenAll(box.root) } : box)) }
                      : { ...current, root: evenAll(current.root) },
                  )
                }
                // The gutter between cards: 16px, the prototype's grid gap
                // (measured). At rest it is EMPTY — the cards' own edges do the
                // separating — and `::before` is the drag handle, an accent
                // pill that colours in on hover. It must stay a DIRECT sibling
                // of the size wrappers: `startDrag` measures `parentElement`.
                className={`relative z-10 shrink-0 bg-transparent before:absolute before:rounded-m3-full before:bg-transparent before:transition-colors before:duration-[var(--m3-duration-short2)] before:ease-m3-standard before:content-[''] hover:before:bg-[var(--m3-accent)] ${
                  isRow
                    ? 'w-4 cursor-col-resize before:inset-y-2 before:left-1/2 before:w-0.5 before:-translate-x-1/2'
                    : 'h-4 cursor-row-resize before:inset-x-2 before:top-1/2 before:h-0.5 before:-translate-y-1/2'
                }`}
                data-split-divider={`${dividerKey}:${index}`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    )
  }

  // A section is as tall as its rows; one row is half the visible area, so a
  // 2×2 section fills the screen like the main grid does and a one-row
  // section takes half. Never shorter than a pane can usefully be.
  const rowHeight = Math.max(PANE_MIN_HEIGHT_PX + 40, Math.floor((areaHeight - SECTION_GAP_PX) / 2))
  const hasBoxes = boxes.length > 0

  const workspace = (
    <div
      ref={fullscreen ? undefined : fill.ref}
      className={`relative flex min-h-0 flex-col bg-[var(--m3-surface)] ${fullscreen ? 'h-full' : 'h-full'}`}
      data-split-view={isSplit ? 'true' : 'false'}
      data-shared-filters={isSplit && sharedEnabled ? 'on' : 'off'}
      data-split-fullscreen={fullscreen ? 'true' : undefined}
      style={
        {
          ...(!fullscreen && fill.height ? { height: fill.height } : {}),
          // Read by the bar's and the grid's right padding — see `scrollbar`.
          '--ws-scrollbar': `${scrollbar.classic + scrollbar.overlay}px`,
          '--ws-overlay': `${scrollbar.overlay}px`,
        } as React.CSSProperties
      }
    >
      {!fullscreen && <CustomizeTab onOpen={() => setCustomizeOpen(true)} active={customizeOpen} />}

      {isSplit && (
        <WorkspaceFilterBar
          className="pl-2 pr-[calc(0.5rem+var(--ws-scrollbar,0px))]"
          criteria={criteria}
          onChange={setCriteria}
          unmappedByPane={perPane.unmapped}
          shared={sharedEnabled}
          onSharedChange={setSharedEnabled}
          trailing={
            <>
              <AddWidgetMenu onAdd={handleAdd} />
              <LayoutMenu
                layouts={layouts}
                activeId={activeLayoutId}
                isDefault={isDefault}
                onApply={(saved) => setLayout(() => saved.layout)}
                onDefault={() => setLayout((current) => resetLayout(current, tableId))}
                onSaveCurrent={() =>
                  void save(t('splitView.layouts.defaultName', 'Layout {n}', { n: String(layouts.length + 1) }), layout)
                }
                onCustomize={() => setCustomizeOpen(true)}
              />
              <FullscreenToggle active={fullscreen} onToggle={() => setFullscreen((value) => !value)} />
            </>
          }
        />
      )}

      <div
        ref={setAreaElement}
        // `px-2` and NEVER `p-2` for the grid: horizontal breathing room is
        // free, vertical padding would cost grid height on every list page.
        className={`min-h-0 flex-1${isSplit ? ' pb-2 pl-2 pr-[calc(0.5rem+var(--ws-overlay,0px))]' : ''}${hasBoxes ? ' flex flex-col overflow-y-auto' : ' flex'}`}
        style={isSplit && !hasBoxes ? { overflow: 'auto' } : undefined}
        data-split-root=""
      >
        <div
          className="flex min-h-0 min-w-0 flex-1"
          style={hasBoxes ? { flex: '0 0 auto', height: Math.max(areaHeight - 8, PANE_MIN_HEIGHT_PX) } : undefined}
          data-split-main=""
        >
          {restored && renderNode(layout.root, [], undefined, mainSlotCount)}
        </div>

        {boxes.map((box, index) => {
          const rows = rowsOf(box.root)
          return (
            <section
              key={box.id}
              className="flex shrink-0 flex-col"
              style={{ marginTop: SECTION_GAP_PX, height: BOX_HEADER_PX + rows * rowHeight }}
              data-workspace-box={box.id}
              aria-label={t('splitView.box.label', 'Section {n}', { n: String(index + 2) })}
            >
              <BoxHeader
                index={index + 2}
                count={countPanes(box.root)}
                max={BOX_MAX_SLOTS}
                currentTemplate={templateOf(box.root)}
                onPickTemplate={(id) => setLayout((current) => applyBoxTemplate(current, box.id, id))}
                onRemove={() => setLayout((current) => removeBox(current, box.id))}
              />
              <div className="flex min-h-0 flex-1">{renderNode(box.root, [], box.id, countSlots(box.root))}</div>
            </section>
          )
        })}
      </div>

      {pending && (
        <ContentPicker
          anchorRect={pending.anchor}
          openContent={panes.map((pane) => pane.content)}
          onPick={handlePick}
          onClose={() => setPending(null)}
        />
      )}

      <CustomizeDrawer
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        layout={layout}
        setLayout={setLayout}
        primaryTableId={tableId}
        primaryPaneId={primaryPaneId}
      />
    </div>
  )

  if (fullscreen && typeof document !== 'undefined') {
    // A real full screen: portalled to <body> and fixed over the whole
    // viewport, sidebar and top bar included. Inside the app shell the
    // workspace would be trapped under the sidebar's stacking context.
    return ReactDOM.createPortal(
      <div className="fixed inset-0 z-[900] flex flex-col bg-[var(--m3-surface)] p-2" data-split-fullscreen-overlay="">
        {workspace}
      </div>,
      document.body,
    )
  }
  return workspace
}

export default SplitViewHost
