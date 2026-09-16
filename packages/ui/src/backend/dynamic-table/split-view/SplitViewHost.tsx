'use client'

/**
 * Split view — renders a TREE of registered tables in one screen.
 *
 * A table page renders this instead of its table component, naming itself as
 * the only pane. With one pane it looks exactly like the page did before this
 * feature existed; pane headers and dividers appear only once a second table is
 * opened. That is what makes it ambient — you split from where you already are.
 *
 * The layout is a tree so nested arrangements are expressible — notably "two
 * side by side with a third full-width beneath", which the earlier flat model
 * could not represent at all. Rendering is recursive: a split node lays its
 * children along its own axis and drops a divider between each pair.
 *
 * The grid needs no changes to work here: its event bus is per-element, copy
 * and paste are both target-guarded, `height: 'fill'` measures against the
 * nearest scroll ancestor (each pane is one), and the cell store — including
 * its undo stack — is created per instance.
 *
 * Spec: .ai/specs/2026-08-04-dynamic-table-split-view.md
 */

import * as React from 'react'
import ReactDOM from 'react-dom'
import { Columns2, Rows2, X, ExternalLink, Save, ChevronDown, Trash2, LayoutGrid, Grid2x2, PanelLeft, PanelRight, PanelTop, PanelBottom, MoreHorizontal, Check, SlidersHorizontal } from 'lucide-react'
import { useTableById, useTableRegistry } from '../registry/TableRegistryContext'
import { useToolbarOverflowClose, ToolbarOverflowCloseProvider } from '../components/ToolbarOverflow'
import { computeAnchoredPosition } from '../utils/anchoredPosition'
import { ContentPicker } from './ContentPicker'
import { WidgetPane } from './WidgetPane'
import { EmptySlot } from './EmptySlot'
import { WorkspaceFilterBar, type UnmappedPaneReport } from './WorkspaceFilterBar'
import {
  mapCriteriaForTable,
  mapCriteriaForWidget,
  type SharedCriteria,
} from './sharedCriteria'
import type { FilterRow } from '../types/index'
import { useSplitViewLayouts } from './useSplitViewLayouts'
import { readStoredLayout, writeStoredLayout } from './layoutPersistence'
import {
  ARRANGE_PRESETS,
  GRID_TEMPLATE_LIST,
  PANE_MIN_HEIGHT_PX,
  PANE_MIN_WIDTH_PX,
  SPLIT_LAYOUT_VERSION,
  applyGridTemplate,
  applyPreset,
  countPanes,
  countSlots,
  evenAll,
  fillSlot,
  listPanes,
  listSlots,
  makePaneId,
  removePane,
  resizeAt,
  setPaneChrome,
  setPaneContentSettings,
  splitPane,
  tableContent,
  type GridTemplateId,
  type LayoutNode,
  type NodePath,
  type PaneChrome,
  type PaneContentRef,
  type PresetId,
  type SplitDirection,
  type SplitLayout,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Material 3 chrome, shared by every menu the split view draws.
 *
 * The row string below was duplicated verbatim in five places, which is how
 * three of them drifted onto raw pixel type. One const, one look.
 *
 * `h-7` (28px) is kept DELIBERATELY: M3 specifies a 48dp menu item, and this is
 * a dense operations tool where six 48dp rows are most of a pane. Shape, colour,
 * state layers and motion are adopted from M3; its touch geometry is not — the
 * same trade `m3.css` documents at the top of the file.
 */
export const M3_MENU_ROW =
  'flex h-7 w-full items-center gap-2 rounded-m3-xs px-1.5 text-left text-body-regular-xs text-[var(--m3-on-surface)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] active:bg-[var(--m3-state-layer-pressed)]'

/**
 * The SELECTED form of a menu row. M3 marks selection by swapping the
 * container, never by an icon alone — the same `secondary-container` role the
 * grid uses for a selected row, so selection reads identically everywhere.
 */
export const M3_MENU_ROW_ON =
  `${M3_MENU_ROW} bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]`

/**
 * A section caption inside a menu ("Add table", "Show"). 10px chrome uses the
 * 10px token: routing it through a 12/16 token would grow every menu by 20%.
 */
export const M3_MENU_CAPTION =
  'text-label-semibold-2xs uppercase text-[var(--m3-on-surface-variant)]'

/**
 * A portalled menu panel — an M3 elevated surface: a `md` (12px) corner, the
 * softer `outline-variant` hairline, a container step for the fill, and the
 * two-shadow elevation rather than Tailwind's `shadow-*`.
 *
 * `WidgetPane` imports this. The resulting import cycle is safe: the binding is
 * read at RENDER time, long after both module bodies have initialised.
 */
export const M3_MENU_PANEL =
  'fixed z-[1000] overflow-y-auto rounded-m3-md border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container)] py-1 shadow-m3-2'

// ─────────────────────────────────────────────────────────────────────────────

function PaneBody({
  content,
  paneId,
  isPrimary,
  multiview,
  overflowExtras,
  chrome,
  onWidgetSettingsChange,
  sharedFilters,
  sharedSearch,
}: {
  content: PaneContentRef
  paneId: string
  isPrimary: boolean
  multiview: boolean
  overflowExtras?: React.ReactNode
  chrome?: PaneChrome
  onWidgetSettingsChange?: (next: unknown) => void
  sharedFilters?: FilterRow[]
  sharedSearch?: string
}) {
  if (content.kind === 'widget') {
    return (
      <WidgetPane
        content={content}
        slotId={paneId}
        onSettingsChange={onWidgetSettingsChange}
        overflowExtras={overflowExtras}
        hideToolbar={chrome?.toolbar === false}
      />
    )
  }
  return (
    <TablePaneBody
      tableId={content.tableId}
      paneId={paneId}
      isPrimary={isPrimary}
      multiview={multiview}
      overflowExtras={overflowExtras}
      chrome={chrome}
      sharedFilters={sharedFilters}
      sharedSearch={sharedSearch}
    />
  )
}

function TablePaneBody({
  tableId,
  paneId,
  isPrimary,
  multiview,
  overflowExtras,
  chrome,
  sharedFilters,
  sharedSearch,
}: {
  tableId: string
  paneId: string
  isPrimary: boolean
  multiview: boolean
  overflowExtras?: React.ReactNode
  chrome?: PaneChrome
  sharedFilters?: FilterRow[]
  sharedSearch?: string
}) {
  const { definition, status } = useTableById(tableId)

  if (status === 'unknown') {
    return (
      <PaneMessage data-pane-status="unknown">
        This table is no longer available.
      </PaneMessage>
    )
  }
  if (status === 'denied') {
    return (
      <PaneMessage data-pane-status="denied">
        You don’t have access to {definition?.metadata.title ?? 'this table'}.
      </PaneMessage>
    )
  }
  // `loading` = the grant check (a POST to /api/auth/feature-check) has not
  // answered yet. Falling through to the grid here meant a revoked table
  // mounted, fired its list request, and only then swapped to "no access" —
  // which contradicts the ACL-re-checked-at-render contract this file states.
  //
  // But holding EVERY pane would put a placeholder on the first load of every
  // list page in the app, because that check is a real round-trip on first
  // paint (react-query serves it from cache thereafter). That trades a visible
  // slowdown on the common path against a flash on a rare one.
  //
  // So it is split by provenance. The PRIMARY pane is the page's own table and
  // the server already authorised this route to render it at all, so it is
  // drawn optimistically and the common path is unchanged. SECONDARY panes come
  // out of a SAVED LAYOUT, which can name a table whose grant was revoked since
  // it was saved — that is the case worth waiting for.
  if (status === 'loading' && !isPrimary) {
    return <PaneMessage data-pane-status="loading">Checking access…</PaneMessage>
  }
  if (!definition) return null

  const Table = definition.Table
  // The PRIMARY pane is the page's own table, so it keeps the unscoped keys —
  // byte-identical to before split view existed. Anything else would break
  // persistence outright: pane ids are minted per mount, so scoping the primary
  // pane would hand every page load a fresh key and silently discard the user's
  // saved column widths on every navigation. (Caught in the browser, not by
  // typecheck — the code was "correct" and the behaviour was wrong.)
  //
  // Secondary panes DO get a per-pane scope, which is what stops two panes of
  // the same table overwriting each other. A saved layout persists its pane
  // ids, so reopening one restores the same scopes and the same widths.
  const storageScope = isPrimary ? '' : `pane:${paneId}:`
  return (
    <Table
      storageScope={storageScope}
      embedded
      // The primary pane IS the page — its table is what the route exists to
      // show, so opening a row is the page doing its job, not a click tearing
      // a host down. `embedded` alone said "do not navigate" to every pane, and
      // the Files list (whose only affordance to open a file is its row links
      // and row click) was left with no way in at all. See
      // `ownsPageNavigation` in registry/types.ts.
      ownsPageNavigation={isPrimary}
      multiview={multiview}
      overflowExtras={overflowExtras}
      hideToolbar={chrome?.toolbar === false}
      // The workspace bar REPLACES each pane's search row while it is on, so
      // the density cost of the bar is paid back by the rows it reclaims.
      hideSearch={chrome?.search === false || sharedSearch !== undefined}
      hideViews={chrome?.viewsBar === false}
      hidePagination={chrome?.viewsBar === false}
      sharedFilters={sharedFilters}
      sharedSearch={sharedSearch}
    />
  )
}

function PaneMessage({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-body-regular-sm text-[var(--m3-on-surface-variant)]" {...rest}>
      {children}
    </div>
  )
}


/**
 * Everything a pane can do, in ONE overflow menu inside the table's own
 * toolbar.
 *
 * Replaces a dedicated pane-header row that carried six icon buttons AND
 * repeated the table title the toolbar already showed. That row cost ~32px per
 * pane and bought nothing the toolbar could not hold.
 */
/**
 * The pane's own items, as ROWS — no button, no panel of its own.
 *
 * These are injected into the table's single overflow menu via
 * `uiConfig.toolbarOverflowExtras`. An earlier build rendered them behind a
 * second button sitting right next to the table's overflow, which left two
 * near-identical menus in one toolbar.
 */
function PaneMenuRows({
  href,
  chrome,
  canClose,
  extras,
  onSplit,
  onToggleChrome,
  onClose,
}: {
  href?: string
  chrome?: PaneChrome
  canClose: boolean
  extras?: React.ReactNode
  onSplit: (direction: SplitDirection, before: boolean, anchor: DOMRect) => void
  onToggleChrome: (patch: Partial<PaneChrome>) => void
  onClose: () => void
}) {
  // Terminal actions dismiss the menu; the Show toggles deliberately do not,
  // so several can be flipped in one visit.
  const closeMenu = useToolbarOverflowClose()

  const shows: Array<{ key: keyof PaneChrome; label: string }> = [
    { key: 'toolbar', label: 'Toolbar' },
    { key: 'search', label: 'Search' },
    { key: 'viewsBar', label: 'Views bar' },
  ]

  const ADD_TABLE: Array<{ dir: SplitDirection; before: boolean; label: string; Icon: typeof PanelLeft; attr: string }> = [
    { dir: 'row', before: true, label: 'Left', Icon: PanelLeft, attr: 'data-pane-split-left' },
    { dir: 'row', before: false, label: 'Right', Icon: PanelRight, attr: 'data-pane-split-right' },
    { dir: 'column', before: true, label: 'Above', Icon: PanelTop, attr: 'data-pane-split-up' },
    { dir: 'column', before: false, label: 'Below', Icon: PanelBottom, attr: 'data-pane-split-down' },
  ]

  const row = M3_MENU_ROW
  const gutter = 'flex w-4 shrink-0 justify-center'

  return (
    <div data-pane-menu-rows="">
      <div className={`px-2 pb-1 pt-1 ${M3_MENU_CAPTION}`}>
        Add table
      </div>
      <div className="px-2 pb-2">
        {/* An M3 connected button group: one pill, hairline-divided. The
            container's `overflow-hidden` is what gives the first and last
            segment their end caps. */}
        <div className="flex overflow-hidden rounded-m3-full border border-[var(--m3-outline)]">
          {ADD_TABLE.map((item, index) => (
            <button
              key={item.label}
              type="button"
              title={item.label}
              aria-label={`Add table ${item.label.toLowerCase()}`}
              onClick={(event) => { onSplit(item.dir, item.before, event.currentTarget.getBoundingClientRect()); closeMenu() }}
              className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[var(--m3-on-surface-variant)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] hover:text-[var(--m3-on-surface)] active:bg-[var(--m3-state-layer-pressed)] ${
                index > 0 ? 'border-l border-[var(--m3-outline)]' : ''
              }`}
              {...{ [item.attr]: '' }}
            >
              <item.Icon className="h-3.5 w-3.5" />
              <span className="text-label-semibold-2xs">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={`px-2 pb-0.5 ${M3_MENU_CAPTION}`}>Show</div>
      <div className="px-1">
        {shows.map((item) => {
          const on = chrome?.[item.key] !== false
          return (
            <button
              key={item.key}
              type="button"
              onClick={(event) => { event.stopPropagation(); onToggleChrome({ [item.key]: !on } as Partial<PaneChrome>) }}
              className={on ? M3_MENU_ROW_ON : M3_MENU_ROW}
              data-pane-chrome={item.key}
              data-pane-chrome-on={on ? 'true' : 'false'}
            >
              <span className={gutter}>{on && <Check className="h-3.5 w-3.5" />}</span>
              <span className={on ? '' : 'text-[var(--m3-on-surface-variant)]'}>{item.label}</span>
            </button>
          )
        })}
      </div>

      {extras && <div className="mt-1 border-t border-[var(--m3-outline-variant)] px-1 pt-1">{extras}</div>}

      <div className="mt-1 border-t border-[var(--m3-outline-variant)] px-1 pt-1">
        {href && (
          <a href={href} className={row} data-pane-open-full="" onClick={closeMenu}>
            <span className={gutter}><ExternalLink className="h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]" /></span>
            Open full page
          </a>
        )}
        {canClose && (
          <button type="button" onClick={() => { onClose(); closeMenu() }} className={row} data-pane-close="">
            <span className={gutter}><X className="h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]" /></span>
            Close pane
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The way back when a pane's toolbar is hidden — hiding it also hides the
 * overflow menu that turned it off.
 *
 * Portalled to `document.body`, like every other menu in the grid. As a plain
 * `absolute` panel it sat at `z-40` INSIDE a pane that clips its overflow, so
 * the grid's sticky columns painted over it and clicks landed on `td.hot-cell`
 * instead — the handle opened a menu that could not be used.
 */
function PaneRestoreMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = React.useState({ top: 0, left: 0, maxHeight: 720 })

  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const next = computeAnchoredPosition(
      trigger.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      // Clamped to what fits — see ToolbarOverflow's MENU_MAX_HEIGHT note.
      { width: 216, preferredHeight: 720, align: 'end', minHeight: 180 },
    )
    setPlacement({ top: next.top, left: next.left, maxHeight: next.maxHeight })
  }, [])

  React.useLayoutEffect(() => { if (open) reposition() }, [open, reposition])

  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onScroll = () => reposition()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, reposition])

  const close = React.useCallback(() => setOpen(false), [])

  return (
    <div className="absolute right-2 top-1.5 z-30" data-pane-restore="">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Pane options"
        aria-expanded={open}
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-m3-full border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-high)] text-[var(--m3-on-surface-variant)] shadow-m3-1 transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-surface-container-highest)] hover:text-[var(--m3-on-surface)]"
        data-pane-restore-btn=""
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={panelRef}
          className={M3_MENU_PANEL}
          style={{ top: placement.top, left: placement.left, width: 216, maxHeight: placement.maxHeight }}
          data-pane-restore-menu=""
        >
          <ToolbarOverflowCloseProvider value={close}>{children}</ToolbarOverflowCloseProvider>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** Pick an arrangement. Presets that need more panes than exist are disabled
 *  rather than hidden, so the shape you want is discoverable before you have
 *  enough tables open to use it. */
/**
 * One row that turns the workspace search/filter bar on and off.
 *
 * A plain toggle rather than a submenu: it has exactly two states, and the bar
 * it reveals IS the rest of the interface. Deliberately does NOT dismiss the
 * overflow menu — the neighbouring "Show" toggles behave the same way, so
 * several settings can be flipped in one visit.
 */
function SharedFilterToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="menuitemcheckbox"
      aria-checked={enabled}
      title={
        enabled
          ? 'Each pane goes back to its own search and filters'
          : 'Drive every pane from one search and filter bar'
      }
      className={enabled ? M3_MENU_ROW_ON : M3_MENU_ROW}
      data-split-shared-filters={enabled ? 'on' : 'off'}
    >
      <span className="flex w-4 shrink-0 justify-center">
        {enabled ? <Check className="h-3.5 w-3.5" /> : <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]" />}
      </span>
      <span className="flex-1">Shared search &amp; filters</span>
    </button>
  )
}

function ArrangeMenu({
  layout,
  onApply,
}: {
  layout: SplitLayout
  onApply: (next: SplitLayout) => void
}) {
  const [open, setOpen] = React.useState(false)
  const closeMenu = useToolbarOverflowClose()
  const paneCount = countPanes(layout.root)

  const pick = (preset: PresetId) => {
    onApply(applyPreset(layout, preset))
    setOpen(false)
    closeMenu()
  }

  return (
    <div data-split-arrange-section="">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Arrange panes"
        aria-expanded={open}
        className={M3_MENU_ROW}
        data-split-arrange=""
      >
        <span className="flex w-4 shrink-0 justify-center"><LayoutGrid className="h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]" /></span>
        <span className="flex-1">Arrange</span>
        <ChevronDown className={`h-3 w-3 text-[var(--m3-on-surface-variant)] transition-transform duration-[var(--m3-duration-short2)] ease-m3-standard ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Expands IN PLACE. A flyout here was `absolute` inside the overflow
          panel, which scrolls — so it was clipped by its own container and
          read as a dead control. */}
      {open && (
        <div className="mb-1 ml-1.5 border-l border-[var(--m3-outline-variant)] pl-1.5" data-split-arrange-menu="">
          {ARRANGE_PRESETS.map((preset) => {
            const enabled = paneCount >= preset.minPanes
            return (
              <button
                key={preset.id}
                type="button"
                disabled={!enabled}
                onClick={() => pick(preset.id)}
                className={`flex w-full items-start gap-2 rounded-m3-sm px-2 py-1.5 text-left transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard ${
                  enabled
                    ? 'hover:bg-[var(--m3-state-layer-hover)] active:bg-[var(--m3-state-layer-pressed)]'
                    : 'cursor-not-allowed text-[var(--m3-on-surface-variant)] opacity-[var(--m3-disabled-content-opacity)]'
                }`}
                data-split-arrange-preset={preset.id}
                title={enabled ? preset.hint : `Needs at least ${preset.minPanes} tables`}
              >
                {preset.id === 'rows'
                  ? <Rows2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--m3-on-surface-variant)]" />
                  : preset.id === 'columns'
                    ? <Columns2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--m3-on-surface-variant)]" />
                    : <LayoutGrid className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--m3-on-surface-variant)]" />}
                <span className="min-w-0">
                  <span className="block text-body-regular-xs">{preset.label}</span>
                  <span className="block text-body-regular-xs text-[var(--m3-on-surface-variant)]">{preset.hint}</span>
                </span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => { onApply({ ...layout, root: evenAll(layout.root) }); setOpen(false); closeMenu() }}
            className="w-full rounded-m3-sm px-2 py-1.5 text-left text-body-regular-xs transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] active:bg-[var(--m3-state-layer-pressed)]"
            data-split-arrange-even=""
          >
            Reset sizes
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * A template's shape, drawn from the tree itself.
 *
 * Deriving the thumbnail from `build()` rather than hand-drawing six icons
 * means a template can never advertise a shape it does not produce.
 */
function TemplatePreview({ node, selected }: { node: LayoutNode; selected?: boolean }) {
  if (node.kind !== 'split') {
    return (
      <div
        className={`flex-1 rounded-m3-xs ${
          selected
            ? 'bg-[color-mix(in_srgb,var(--m3-on-secondary-container)_60%,transparent)]'
            : 'bg-[var(--m3-outline)]'
        }`}
      />
    )
  }
  return (
    <div className={`flex flex-1 gap-[2px] ${node.direction === 'row' ? 'flex-row' : 'flex-col'}`}>
      {node.children.map((child, index) => (
        <TemplatePreview key={index} node={child} selected={selected} />
      ))}
    </div>
  )
}

/**
 * A layout's SHAPE, ignoring what fills it — `p`, `r(p,p)`, `c(p,r(p,p))`.
 *
 * Two layouts with the same signature occupy the same grid, which is exactly
 * what makes a template "the one you are currently in". The gallery had no
 * selected state at all before this.
 */
function shapeSignature(node: LayoutNode): string {
  if (node.kind !== 'split') return 'p'
  return `${node.direction === 'row' ? 'r' : 'c'}(${node.children.map(shapeSignature).join(',')})`
}

/**
 * Pick a SHAPE, fill it afterwards — the layout-first flow.
 *
 * Sits beside `ArrangeMenu` in the same overflow menu, and the two are labelled
 * apart because they answer different questions: a template says how many cells
 * there are, a preset says where the cells you already filled should go.
 * Existing panes are poured into the new shape, so choosing one never closes
 * the table you are looking at.
 */
function TemplatesMenu({
  layout,
  onApply,
}: {
  layout: SplitLayout
  onApply: (next: SplitLayout) => void
}) {
  const [open, setOpen] = React.useState(false)
  const closeMenu = useToolbarOverflowClose()
  const currentShape = shapeSignature(layout.root)

  const pick = (id: GridTemplateId) => {
    onApply(applyGridTemplate(layout, id))
    setOpen(false)
    closeMenu()
  }

  return (
    <div data-split-templates-section="">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Choose a grid"
        aria-expanded={open}
        className={M3_MENU_ROW}
        data-split-templates=""
      >
        <span className="flex w-4 shrink-0 justify-center"><Grid2x2 className="h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]" /></span>
        <span className="flex-1">Grid template</span>
        <ChevronDown className={`h-3 w-3 text-[var(--m3-on-surface-variant)] transition-transform duration-[var(--m3-duration-short2)] ease-m3-standard ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Expands IN PLACE for the same reason ArrangeMenu does — a flyout is
          clipped by the scrolling overflow panel it lives in. */}
      {open && (
        <div className="mb-1 ml-1.5 grid grid-cols-3 gap-1 border-l border-[var(--m3-outline-variant)] py-1 pl-1.5" data-split-templates-menu="">
          {GRID_TEMPLATE_LIST.map((template) => {
            const shape = template.build()
            // The template whose SHAPE the workspace is already in. Marked with
            // the same `secondary-container` swap selection uses everywhere.
            const isCurrent = shapeSignature(shape) === currentShape
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => pick(template.id)}
                title={`${template.label} — ${template.hint}`}
                aria-label={template.label}
                aria-pressed={isCurrent}
                className={`flex flex-col items-center gap-1 rounded-m3-sm p-1 transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard ${
                  isCurrent
                    ? 'bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]'
                    : 'text-[var(--m3-on-surface-variant)] hover:bg-[var(--m3-state-layer-hover)] active:bg-[var(--m3-state-layer-pressed)]'
                }`}
                data-split-template={template.id}
              >
                <span className="flex h-8 w-full gap-[2px] rounded-m3-xs border border-[var(--m3-outline-variant)] p-[2px]">
                  <TemplatePreview node={shape} selected={isCurrent} />
                </span>
                <span className="text-body-regular-xs">{template.slots}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Save / reopen named layouts. Personal-only in v1. */
function LayoutsMenu({
  anchorTableId,
  layout,
  onApply,
}: {
  anchorTableId: string
  layout: SplitLayout
  onApply: (layout: SplitLayout) => void
}) {
  const { layouts, save, remove } = useSplitViewLayouts(anchorTableId)
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const closeMenu = useToolbarOverflowClose()

  const commit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await save(trimmed, layout)
    setName('')
    setOpen(false)
    closeMenu()
  }

  return (
    <div data-split-layouts-section="">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={M3_MENU_ROW}
        data-split-layouts=""
      >
        <span className="flex w-4 shrink-0 justify-center"><Save className="h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]" /></span>
        <span className="flex-1">Layouts</span>
        <ChevronDown className={`h-3 w-3 text-[var(--m3-on-surface-variant)] transition-transform duration-[var(--m3-duration-short2)] ease-m3-standard ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mb-1 ml-1.5 border-l border-[var(--m3-outline-variant)] pl-1.5" data-split-layouts-menu="">
          <div className="flex items-center gap-1 pb-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter submits, Escape cancels — the dialog contract.
                if (e.key === 'Enter') { e.preventDefault(); void commit() }
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
              }}
              placeholder="Save current as…"
              // Was `outline-none` with no field affordance whatsoever — an
              // a11y defect. A field now looks like a field, and focus is the
              // teal interaction-affirmative signal, not the blue selection one.
              className="min-w-0 flex-1 rounded-m3-xs border border-[var(--m3-outline)] bg-[var(--m3-surface-container-lowest)] px-1.5 py-1 text-body-regular-xs text-[var(--m3-on-surface)] transition-[color,background-color,border-color,box-shadow] duration-[var(--m3-duration-short2)] ease-m3-standard placeholder:text-[var(--m3-on-surface-variant)] focus-visible:border-[var(--m3-focus-ring-color)] focus-visible:shadow-[var(--m3-focus-halo)] focus-visible:outline-none"
              data-split-layout-name=""
            />
            <button
              type="button"
              onClick={() => void commit()}
              className="shrink-0 rounded-m3-full px-2 py-1 text-body-regular-xs text-[var(--m3-on-surface)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] active:bg-[var(--m3-state-layer-pressed)]"
              data-split-layout-save=""
            >
              Save
            </button>
          </div>

          {layouts.length === 0 && (
            <div className="px-2 py-3 text-center text-body-regular-xs text-[var(--m3-on-surface-variant)]" data-split-layouts-empty="">
              No saved layouts yet.
            </div>
          )}
          {layouts.map((saved) => (
            <div key={saved.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { onApply(saved.layout); setOpen(false); closeMenu() }}
                className="flex-1 truncate rounded-m3-xs px-2 py-1 text-left text-body-regular-xs text-[var(--m3-on-surface)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] active:bg-[var(--m3-state-layer-pressed)]"
                data-split-layout-open={saved.name}
              >
                {saved.name}
              </button>
              <button
                type="button"
                onClick={() => void remove(saved.id)}
                aria-label={`Delete ${saved.name}`}
                className="rounded-m3-full p-1 text-[var(--m3-on-surface-variant)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-error-hover)] hover:text-[var(--m3-error)]"
                data-split-layout-delete={saved.name}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
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
 * Panes then sit at their minimum and the layout looks broken at any pane
 * count > 1.
 *
 * Measure the nearest SCROLL ancestor's client bottom and set an explicit
 * height — the same technique `DynamicTable` already uses for `height: 'fill'`
 * (DynamicTable.tsx), so the two agree instead of fighting.
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
      const bottom =
        scrollPane && scrollPane !== document.body
          ? Math.min(
              window.innerHeight,
              Math.round(scrollPane.getBoundingClientRect().top) + scrollPane.clientHeight,
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
 * The "no shared criteria" value, frozen at module scope.
 *
 * Identity matters: `criteria` is read off the layout and feeds the memo that
 * projects criteria onto every pane. A fresh `{ rules: [] }` per render would
 * change identity each time and re-project on every render of the host — the
 * same reason `sharedCriteria.ts` freezes its own `NOTHING`.
 */
const EMPTY_CRITERIA: SharedCriteria = Object.freeze({
  rules: Object.freeze([]) as unknown as SharedCriteria['rules'],
})

export function SplitViewHost({ tableId }: SplitViewHostProps) {
  const registry = useTableRegistry()

  // Restored SYNCHRONOUSLY in the initializer, not in an effect: an effect
  // would paint one default pane first and then swap in the real arrangement,
  // which reads as a flash and remounts every grid it restores.
  //
  // `registry.tables` is the accessible set, so a pane whose table the user
  // may no longer open is dropped rather than mounted as an empty box.
  const [layout, setLayout] = React.useState<SplitLayout>(() => {
    const known = new Set(registry.tables.map((table) => table.metadata.id))
    // Tables are pruned against the registry, which is available synchronously.
    //
    // Widgets are NOT pruned here, deliberately. The widget catalogue is
    // fetched (react-query), so at this first synchronous paint it is still
    // empty — pruning against it would drop every widget pane on every reload,
    // which is exactly the defect TC-APP-604 caught: widgets rendered fine in
    // session and silently vanished on refresh.
    //
    // Nothing is lost by keeping them: `WidgetPane` resolves its own content
    // through `useContentById` and already renders the same 'unknown' /
    // 'denied' messages a table pane does, so a widget the user can no longer
    // open degrades in THAT PANE ALONE rather than being deleted from their
    // saved arrangement behind their back.
    const stored = readStoredLayout(tableId, (content) =>
      content.kind === 'table' ? known.has(content.tableId) : true,
    )
    return (
      stored ?? {
        root: { kind: 'pane', id: makePaneId(), content: tableContent(tableId) },
        version: SPLIT_LAYOUT_VERSION,
      }
    )
  })

  // Every mutation funnels through `setLayout`, so one effect covers splits,
  // closes, divider drags, arrange presets, chrome toggles and named-layout
  // opens — there is no path that changes the layout without being saved.
  //
  // Coalesced on an animation frame because ONE of those paths is continuous:
  // a divider drag calls `setLayout` per `mousemove`, and each write does a
  // `getItem` for scope resolution, a `JSON.stringify` of the whole tree, a
  // `setItem` and up to two `removeItem`s — ~60 synchronous storage round-trips
  // a second, on the same thread that is re-rendering every grid in the layout.
  // The frame callback keeps discrete mutations effectively immediate (next
  // paint) while collapsing a drag to one write per frame, and the cleanup
  // flushes synchronously so nothing is lost on unmount or a tableId change.
  React.useEffect(() => {
    let frame: number | null = requestAnimationFrame(() => {
      frame = null
      writeStoredLayout(tableId, layout)
    })
    return () => {
      if (frame === null) return
      cancelAnimationFrame(frame)
      writeStoredLayout(tableId, layout)
    }
  }, [tableId, layout])
  /**
   * What the picker will do with the table you choose: split an existing pane
   * along an axis, or fill an empty slot in place.
   */
  const [pending, setPending] = React.useState<
    | { mode: 'split'; slotId: string; direction: SplitDirection; before: boolean; anchor: DOMRect | null }
    | { mode: 'fill'; slotId: string; anchor: DOMRect | null }
    | null
  >(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const fill = useFilledHeight(true)

  // ── Workspace-shared search and filtering ──
  //
  // Held HERE, at the host, because it is a property of the workspace rather
  // than of any pane. Each pane receives only the projection of it that that
  // pane can actually honour, translated into its own field names.
  //
  // Off by default: a workspace only starts driving its panes once the user
  // asks it to, so a single-pane page behaves exactly as it always did.
  //
  // These live ON THE LAYOUT, not in component state beside it.
  //
  // `SplitLayout` has carried `sharedCriteria` / `sharedFiltersEnabled` since v3
  // and `normalizeLayout` deliberately preserves both, but the host used to hold
  // them in `useState` and never read or wrote the layout fields — so enabling
  // the bar, adding a rule and reloading lost all of it. (The persistence test
  // passes either way: it drives the storage layer directly, never the host.)
  //
  // Deriving rather than mirroring is what makes opening a SAVED NAMED LAYOUT
  // work: its criteria arrive through `setLayout` like any other change, and are
  // simply read. A `useState` seeded once at mount would have been overwritten by
  // the stale component value the moment the named layout landed.
  //
  // Reads go through the layout; writes go through `setLayout`, so they ride the
  // same persistence funnel as every other mutation — no second save path.
  const sharedEnabled = layout.sharedFiltersEnabled ?? false
  // `sharedCriteria` is typed `unknown` on the layout ON PURPOSE — the persistence
  // layer carries it through a write/read cycle without knowing the vocabulary
  // (types.ts:117-122). Narrowing happens here, at the one place that does know,
  // and anything that is not a well-formed criteria object degrades to empty
  // rather than throwing on a hand-edited or older stored layout.
  const criteria = React.useMemo<SharedCriteria>(() => {
    const stored = layout.sharedCriteria
    if (!stored || typeof stored !== 'object') return EMPTY_CRITERIA
    const candidate = stored as Partial<SharedCriteria>
    return Array.isArray(candidate.rules) ? (stored as SharedCriteria) : EMPTY_CRITERIA
  }, [layout.sharedCriteria])
  const setSharedEnabled = React.useCallback(
    (next: boolean | ((on: boolean) => boolean)) => {
      setLayout((current) => {
        const was = current.sharedFiltersEnabled ?? false
        const value = typeof next === 'function' ? next(was) : next
        return value === was ? current : { ...current, sharedFiltersEnabled: value }
      })
    },
    [],
  )
  const setCriteria = React.useCallback((next: SharedCriteria) => {
    setLayout((current) =>
      current.sharedCriteria === next ? current : { ...current, sharedCriteria: next },
    )
  }, [])
  const liveCriteria = sharedEnabled ? criteria : null
  const hrefFor = React.useCallback(
    (id: string) => registry.tables.find((table) => table.metadata.id === id)?.metadata.href,
    [registry.tables],
  )

  const panes = React.useMemo(() => listPanes(layout.root), [layout])
  const slotCount = React.useMemo(() => countSlots(layout.root), [layout])
  const isSplit = slotCount > 1
  /**
   * The primary pane is the one holding THIS PAGE'S table — matched by identity,
   * never by position.
   *
   * This used to be `panes[0]`, i.e. document order. But `splitPane(..., before)`
   * inserts the new pane FIRST (`types.ts:436`), and the "Left" and "Above"
   * actions both pass `before: true` — so adding a table to the left of the page's
   * own table handed pane[0], and with it the UNSCOPED storage keys, to the newly
   * added table. Two things broke at once: the new pane wrote its column widths
   * over the standalone page's keys for that table, and the page's own table was
   * demoted to a `pane:<id>:` scope, silently discarding the widths and last-used
   * view the user had saved. Closing the pane flipped it back mid-session.
   * `applyPreset` / `applyGridTemplate` pour panes into slots in document order
   * too, so they inverted it the same way.
   *
   * Falls back to the first pane only when this page's table is not in the layout
   * at all (every pane replaced), which keeps a single pane unscoped as before.
   */
  const primaryPaneId = React.useMemo(() => {
    const own = panes.find(
      (pane) => pane.content.kind === 'table' && pane.content.tableId === tableId,
    )
    return (own ?? panes[0])?.id
  }, [panes, tableId])

  /**
   * Project the workspace criteria onto each pane, in that pane's own field
   * names — plus the list of criteria it could NOT honour.
   *
   * Computed here rather than inside each pane because the unmapped report is a
   * WORKSPACE-level statement ("2 panes are not filtered by customer"), and a
   * pane reporting upward during its own render would be a write during render.
   */
  const perPane = React.useMemo(() => {
    const filters = new Map<string, FilterRow[]>()
    const unmapped: UnmappedPaneReport[] = []
    for (const pane of panes) {
      const isTable = pane.content.kind === 'table'
      const definition = isTable
        ? registry.tables.find((t) => t.metadata.id === (pane.content as { tableId: string }).tableId)
        : undefined
      const result = isTable
        ? mapCriteriaForTable(liveCriteria, definition?.metadata)
        : mapCriteriaForWidget(liveCriteria, (pane.content as { widgetId: string }).widgetId)
      filters.set(pane.id, result.filters)
      if (result.unmapped.length > 0) {
        unmapped.push({
          paneId: pane.id,
          title: definition?.metadata.title ?? 'This pane',
          unmapped: result.unmapped,
        })
      }
    }
    return { filters, unmapped }
  }, [panes, registry.tables, liveCriteria])

  // `''` (bar on, box empty) must reach the panes so their hidden search boxes
  // stop filtering; `undefined` (bar off) must NOT, so each pane keeps its own.
  const sharedSearch = liveCriteria ? (liveCriteria.search ?? '') : undefined

  // Read `pending` from state, never from inside a `setPending` updater: React
  // treats updaters as pure and calls them twice under StrictMode, so a
  // setLayout side-effect in there is dropped or duplicated. That bug made
  // every split silently do nothing.
  const handlePick = React.useCallback(
    // Takes a full `PaneContentRef` rather than a table id, because the picker
    // now offers widgets too and only it knows which kind was chosen.
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

  const handleClose = React.useCallback((paneId: string) => {
    setLayout((current) => removePane(current, paneId))
  }, [])

  /**
   * Divider drag. The delta is converted to a fraction of the SPLIT NODE's own
   * extent along its own axis, so a drag means the same proportion wherever the
   * node sits in the tree and whichever way it runs.
   */
  const startDrag = React.useCallback(
    (splitPath: NodePath, index: number, start: number, axis: SplitDirection, element: HTMLElement) => {
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
        setLayout((current) => resizeAt(current, splitPath, index, delta / extent))
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove, true)
        document.removeEventListener('mouseup', onUp, true)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
      // Suppress selection for the drag — without it a drag across a grid
      // selects cell text and the pointer flickers.
      document.body.style.userSelect = 'none'
      document.body.style.cursor = axis === 'row' ? 'col-resize' : 'row-resize'
      document.addEventListener('mousemove', onMove, true)
      document.addEventListener('mouseup', onUp, true)
    },
    [],
  )

  /** Recursive renderer: a slot (filled or not), or a split laying children along its axis. */
  const renderNode = (node: LayoutNode, path: NodePath): React.ReactNode => {
    if (node.kind === 'empty') {
      return (
        <EmptySlot
          slotId={node.id}
          canRemove={slotCount > 1}
          onAdd={(anchor) => setPending({ mode: 'fill', slotId: node.id, anchor })}
          onRemove={() => handleClose(node.id)}
        />
      )
    }

    if (node.kind === 'pane') {
      const isPrimary = node.id === primaryPaneId
      const definitionHref = node.content.kind === 'table' ? hrefFor(node.content.tableId) : undefined
      // The pane's items are ROWS injected into the table's ONE overflow menu —
      // not a second button beside it.
      const paneRows = (
        <PaneMenuRows
          href={definitionHref}
          chrome={node.chrome}
          canClose={isSplit}
          // On EVERY pane, not just the primary one. Arrange and Layouts act on
          // the whole layout, so gating them behind one privileged pane meant
          // the controls appeared or vanished depending on which table's menu
          // you happened to open — with nothing on screen saying which pane was
          // the special one. Arrange also shows when unsplit: its presets
          // disable themselves with a "needs at least N tables" hint, which is
          // the discoverability this menu was designed for.
          extras={
            <>
              <TemplatesMenu layout={layout} onApply={setLayout} />
              <ArrangeMenu layout={layout} onApply={setLayout} />
              <SharedFilterToggle
                enabled={sharedEnabled}
                onToggle={() => setSharedEnabled((on) => !on)}
              />
              <LayoutsMenu anchorTableId={tableId} layout={layout} onApply={setLayout} />
            </>
          }
          onSplit={(direction, before, anchor) =>
            setPending({ mode: 'split', slotId: node.id, direction, before, anchor })
          }
          onToggleChrome={(patch) => setLayout((current) => setPaneChrome(current, node.id, patch))}
          onClose={() => handleClose(node.id)}
        />
      )
      const toolbarHidden = node.chrome?.toolbar === false
      return (
        <div
          // `flex-1` matters: without it a pane sizes to its CONTENT inside a
          // wrapper that has already been given a share, so after a height drag
          // the wrapper grows and the pane does not — leaving a visible gap.
          // The pane is an M3 OUTLINED card: a 16px corner, the softer
          // `outline-variant` hairline, elevation 0. Card chrome is applied
          // only when split — unsplit, `.hot-card` still draws its own frame
          // and a second one here would read as a concentric double hairline.
          // `overflow-hidden` is what clips the grid's square header to the
          // card radius, so it stays whatever else changes.
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden${
            isSplit
              ? ' rounded-m3-lg border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-lowest)]'
              : ''
          }`}
          data-pane-id={node.id}
          data-pane-table={node.content.kind === 'table' ? node.content.tableId : undefined}
          data-pane-widget={node.content.kind === 'widget' ? node.content.widgetId : undefined}
          data-pane-toolbar={toolbarHidden ? 'hidden' : undefined}
        >
          {/* Toolbar hidden means the overflow menu is hidden with it, so a user
              who hid it would have no way back. Float the same rows behind one
              small handle in the corner. */}
          {toolbarHidden && <PaneRestoreMenu>{paneRows}</PaneRestoreMenu>}
          <div className="min-h-0 flex-1 overflow-auto">
            <PaneBody
              content={node.content}
              paneId={node.id}
              isPrimary={isPrimary}
              multiview={isSplit}
              overflowExtras={paneRows}
              chrome={node.chrome}
              onWidgetSettingsChange={(next) =>
                setLayout((current) => setPaneContentSettings(current, node.id, next))
              }
              sharedFilters={perPane.filters.get(node.id)}
              sharedSearch={sharedSearch}
            />
          </div>
        </div>
      )
    }

    const isRow = node.direction === 'row'
    return (
      <div
        key={`split-${path.join('-')}`}
        className={`flex min-h-0 min-w-0 flex-1 ${isRow ? 'flex-row' : 'flex-col'}`}
        data-split-node={path.join('-') || 'root'}
        data-split-direction={node.direction}
      >
        {/* A nested split has no id of its own, so the key used to fall back to
            the array INDEX — and an index shifts when an earlier sibling is
            removed. Closing the first of `[paneA, split(B,C), paneD]` moved the
            nested split's key from `s1` to `s0`, so React unmounted and remounted
            that whole subtree: B and C lost scroll position, cell selection, any
            in-progress inline edit and any unsaved add-row draft, and each
            CellStore was recreated with its undo stack. Keying on the subtree's
            first SLOT id is stable across sibling removal, because slot ids are
            preserved by every tree op. */}
        {node.children.map((child, index) => (
          <React.Fragment
            key={child.kind === 'split' ? `s:${listSlots(child)[0]?.id ?? index}` : child.id}
          >
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
              {renderNode(child, [...path, index])}
            </div>
            {index < node.children.length - 1 && (
              <div
                role="separator"
                aria-orientation={isRow ? 'vertical' : 'horizontal'}
                title="Drag to resize"
                onMouseDown={(event) => {
                  event.preventDefault()
                  startDrag(path, index, isRow ? event.clientX : event.clientY, node.direction, event.currentTarget)
                }}
                onDoubleClick={() => setLayout((current) => ({ ...current, root: evenAll(current.root) }))}
                // Stays 4px of LAYOUT. Widening it to a "real" 8px gutter
                // would take 4px of grid height off every horizontal split,
                // and density is the product — so the bigger pointer target is
                // bought for free by an OVERLAY (`::after`, -2px on each side)
                // that costs no space at all.
                //
                // At rest the gutter is EMPTY: the two pane cards already draw
                // their own outlines, so a hairline down the middle would put
                // three lines inside 4px. `::before` is the drag handle and
                // only colours in on hover — an accent pill, eased in.
                //
                // It must also stay a DIRECT sibling of the size wrappers:
                // `startDrag` measures `element.parentElement` for the drag
                // extent, so no wrapper, no `gap`, no padding on the split node.
                className={`relative z-10 shrink-0 bg-transparent before:absolute before:rounded-m3-full before:bg-transparent before:transition-colors before:duration-[var(--m3-duration-short2)] before:ease-m3-standard before:content-[''] hover:before:bg-[var(--m3-accent)] after:absolute after:content-[''] ${
                  isRow
                    ? "w-1 cursor-col-resize before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 after:inset-y-0 after:-left-0.5 after:-right-0.5"
                    : "h-1 cursor-row-resize before:inset-x-0 before:top-1/2 before:h-0.5 before:-translate-y-1/2 after:inset-x-0 after:-top-0.5 after:-bottom-0.5"
                }`}
                data-split-divider={`${path.join('-') || 'root'}:${index}`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    )
  }

  return (
    <div
      ref={fill.ref}
      className="flex h-full min-h-0 flex-col bg-[var(--m3-surface)]"
      style={fill.height ? { height: fill.height } : undefined}
      data-split-view={isSplit ? 'true' : 'false'}
      data-shared-filters={sharedEnabled ? 'on' : 'off'}
    >
      {/* One row, and only while it is on. It replaces each pane's search row
          rather than adding to it, so N panes give back N rows for this one. */}
      {sharedEnabled && (
        <WorkspaceFilterBar
          criteria={criteria}
          onChange={setCriteria}
          unmappedByPane={perPane.unmapped}
          onToggleOff={() => setSharedEnabled(false)}
        />
      )}
      <div
        ref={containerRef}
        // `px-2` and NEVER `p-2`: horizontal breathing room for the outermost
        // cards is free, but vertical padding would cost 16px of grid height on
        // every list page. Only while split, so an unsplit page is unchanged.
        className={`flex min-h-0 flex-1${isSplit ? ' px-2' : ''}`}
        // When the panes' minimums exceed the container, scroll rather than
        // crushing every pane below legibility.
        style={isSplit ? { overflow: 'auto' } : undefined}
        data-split-root=""
      >
        {renderNode(layout.root, [])}
      </div>

      {pending && (
        <ContentPicker
          anchorRect={pending.anchor}
          // Tables AND widgets, both marked when already on screen rather than
          // hidden — a user looking for what they just opened should find it
          // where they expect, greyed, not absent.
          openContent={panes.map((pane) => pane.content)}
          onPick={handlePick}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}

export default SplitViewHost
