'use client'

// A dashboard widget rendered as split-view pane content.
//
// This constructs the props object the widget ALREADY declares
// (`DashboardWidgetComponentProps`, a public upstream type) and hands it to the
// component `loadDashboardWidgetModule` returns — the same two steps
// `DashboardScreen` takes at DashboardScreen.tsx:521-701. Nothing upstream is
// changed, shimmed or adapted; a widget cannot tell it is in a pane rather than
// a dashboard card.
//
// Three differences from the dashboard card, each forced by the pane:
//
//  * `layout` is synthesized from the SLOT (`{ id: slot.id, widgetId, order: 0 }`)
//    rather than read from a dashboard layout row. A pane is not a dashboard
//    item and has no order among siblings; the slot id is the stable identity,
//    and it is what makes two panes of the same widget independent.
//  * `settings` live on the slot, so `onSettingsChange` bubbles to the host to
//    persist rather than PUTting the dashboard layout.
//  * Chrome is one 28px row. A table pane's controls live in the toolbar the
//    table already draws; a widget draws none, so the pane must supply the
//    minimum — title, refresh, overflow — and no more. Vertical space is the
//    scarce resource here.
//
// Degradation matches a table pane exactly: unknown and denied each render one
// clear line and nothing else, and a failed chunk load renders an ERROR, never a
// skeleton that waits forever (the mistake `lazyTable.tsx` documents).
//
// Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md (Phase 2)

import * as React from 'react'
import ReactDOM from 'react-dom'
import { Loader2, MoreHorizontal, RefreshCw } from 'lucide-react'
import type {
  DashboardLayoutItem,
  DashboardWidgetModule,
  DashboardWidgetRenderContext,
} from '@open-mercato/shared/modules/dashboard/widgets'
import { loadDashboardWidgetModule } from '../../dashboard/widgetRegistry'
import { ToolbarOverflowCloseProvider } from '../components/ToolbarOverflow'
// The one piece of chrome this file shares with its host. Importing it back
// from `SplitViewHost` is a cycle, and a safe one: the binding is read at
// RENDER time, long after both module bodies have initialised.
import { M3_MENU_PANEL } from './SplitViewHost'
import { computeAnchoredPosition } from '../utils/anchoredPosition'
import {
  useContentById,
  useWidgetRenderContext,
  type WidgetContentItem,
} from '../registry/ContentRegistryContext'
import type { PaneContentRef } from './types'

type WidgetRef = Extract<PaneContentRef, { kind: 'widget' }>
type LoadedModule = DashboardWidgetModule<any>

/** A context is required by the prop type but may not have arrived. Empty, never fabricated. */
const ANONYMOUS_CONTEXT: DashboardWidgetRenderContext = {
  userId: '',
  tenantId: null,
  organizationId: null,
  userName: null,
  userEmail: null,
  userLabel: null,
}

export type WidgetPaneProps = {
  /** The slot's content ref. `settings` on it are the user's; absent means defaults. */
  content: WidgetRef
  /** The owning slot's id — becomes `layout.id`, so two panes of one widget stay independent. */
  slotId: string
  /**
   * Persist the widget's new settings ON THE SLOT. The pane deliberately does
   * not write them itself: the host owns the layout tree and its persistence,
   * and a pane writing through it would be a second, racing writer.
   */
  onSettingsChange?: (next: unknown) => void
  /** Host rows for the pane's overflow menu (split / close / open full page). */
  overflowExtras?: React.ReactNode
  /** Mirrors a table pane's `hideToolbar` chrome toggle — hides the header row. */
  hideToolbar?: boolean
}

function PaneMessage({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="flex h-full items-center justify-center p-6 text-center text-body-regular-sm text-[var(--m3-on-surface-variant)]"
      {...rest}
    >
      {children}
    </div>
  )
}

export function WidgetPane({
  content,
  slotId,
  onSettingsChange,
  overflowExtras,
  hideToolbar,
}: WidgetPaneProps) {
  const { item, status } = useContentById(content)

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center" data-pane-status="loading">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--m3-on-surface-variant)]" aria-hidden="true" />
      </div>
    )
  }
  if (status === 'unknown') {
    return (
      <PaneMessage data-pane-status="unknown">This widget is no longer available.</PaneMessage>
    )
  }
  if (status === 'denied' || !item || item.kind !== 'widget') {
    return (
      <PaneMessage data-pane-status="denied">
        You don’t have access to {item?.title ?? 'this widget'}.
      </PaneMessage>
    )
  }

  return (
    <WidgetPaneBody
      item={item}
      content={content}
      slotId={slotId}
      onSettingsChange={onSettingsChange}
      overflowExtras={overflowExtras}
      hideToolbar={hideToolbar}
    />
  )
}

function WidgetPaneBody({
  item,
  content,
  slotId,
  onSettingsChange,
  overflowExtras,
  hideToolbar,
}: {
  item: WidgetContentItem
  content: WidgetRef
  slotId: string
  onSettingsChange?: (next: unknown) => void
  overflowExtras?: React.ReactNode
  hideToolbar?: boolean
}) {
  const renderContext = useWidgetRenderContext()
  const [module, setModule] = React.useState<LoadedModule | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [refreshToken, setRefreshToken] = React.useState(0)
  const [refreshing, setRefreshing] = React.useState(false)

  const loaderKey = item.loaderKey

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    loadDashboardWidgetModule(loaderKey)
      .then((loaded) => {
        if (cancelled) return
        // A null module means the loader key resolved to nothing — same outcome
        // as a thrown chunk error, and it must LOOK like one.
        setModule(loaded)
        setLoadFailed(!loaded)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        try {
          console.error('Failed to load widget module', err)
        } catch {}
        setLoadFailed(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loaderKey])

  React.useEffect(() => {
    if (loadFailed) setRefreshing(false)
  }, [loadFailed])

  const hydratedSettings = React.useMemo(() => {
    const raw = content.settings ?? item.defaultSettings ?? null
    if (module?.hydrateSettings) {
      try {
        return module.hydrateSettings(raw)
      } catch (err) {
        try {
          console.warn('Failed to hydrate widget settings', err)
        } catch {}
        return raw
      }
    }
    return raw
  }, [content.settings, item.defaultSettings, module])

  const handleSettingsChange = React.useCallback(
    (next: unknown) => {
      let raw = next
      if (module?.dehydrateSettings) {
        try {
          raw = module.dehydrateSettings(next as never)
        } catch (err) {
          try {
            console.warn('Failed to dehydrate widget settings', err)
          } catch {}
        }
      }
      onSettingsChange?.(raw)
    },
    [module, onSettingsChange],
  )

  // The slot IS the layout item. `order: 0` because a pane has no siblings to
  // order against — the tree owns arrangement, not this number.
  const layout = React.useMemo<DashboardLayoutItem>(
    () => ({ id: slotId, widgetId: content.widgetId, order: 0, settings: content.settings }),
    [slotId, content.widgetId, content.settings],
  )

  const supportsRefresh = item.supportsRefresh ?? false
  const triggerRefresh = React.useCallback(() => {
    if (loading || loadFailed) return
    setRefreshing(true)
    setRefreshToken((value) => value + 1)
  }, [loading, loadFailed])

  const Widget = module?.Widget ?? null

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-pane-widget-body={content.widgetId}
    >
      {!hideToolbar && (
        <div
          // A tinted container step instead of a hairline: M3 separates by
          // surface role wherever both would read, and this band is the card's
          // own top edge — the pane's `overflow-hidden` clips it to the radius.
          className="flex h-7 shrink-0 items-center gap-1 bg-[var(--m3-surface-container-low)] px-2 text-[var(--m3-on-surface)]"
          data-pane-widget-header=""
        >
          <span className="min-w-0 flex-1 truncate text-label-semibold-xs" title={item.title}>
            {item.title}
          </span>
          {supportsRefresh && (
            <button
              type="button"
              onClick={triggerRefresh}
              disabled={loading || loadFailed}
              aria-label="Refresh"
              title="Refresh"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-m3-full text-[var(--m3-on-surface-variant)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] hover:text-[var(--m3-on-surface)] active:bg-[var(--m3-state-layer-pressed)] disabled:opacity-[var(--m3-disabled-content-opacity)]"
              data-pane-widget-refresh=""
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {overflowExtras ? <WidgetPaneMenu>{overflowExtras}</WidgetPaneMenu> : null}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2" data-pane-widget-content="">
        {loading && (
          <div className="flex h-full items-center justify-center" data-pane-widget-loading="">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--m3-on-surface-variant)]" aria-hidden="true" />
          </div>
        )}
        {!loading && loadFailed && (
          <div
            className="p-4 text-body-regular-sm text-[var(--m3-on-surface-variant)]"
            role="alert"
            data-pane-widget-error=""
          >
            This widget could not be loaded.
          </div>
        )}
        {!loading && !loadFailed && Widget && (
          <Widget
            mode="view"
            layout={layout}
            settings={hydratedSettings}
            context={renderContext ?? ANONYMOUS_CONTEXT}
            onSettingsChange={handleSettingsChange}
            refreshToken={refreshToken}
            onRefreshStateChange={setRefreshing}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The pane's overflow menu.
 *
 * Portalled to `document.body` and positioned with `computeAnchoredPosition`,
 * like every other menu in the grid — a pane clips its overflow, so an
 * absolutely-positioned panel would be painted over and unclickable (the bug
 * `PaneRestoreMenu` documents). `ToolbarOverflowCloseProvider` is what lets the
 * host's rows close the menu after acting, so they behave identically to the
 * rows a table pane puts in its own toolbar overflow.
 */
function WidgetPaneMenu({ children }: { children: React.ReactNode }) {
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
      { width: 216, preferredHeight: 720, align: 'end', minHeight: 180 },
    )
    setPlacement({ top: next.top, left: next.left, maxHeight: next.maxHeight })
  }, [])

  React.useLayoutEffect(() => {
    if (open) reposition()
  }, [open, reposition])

  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
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
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Pane options"
        aria-expanded={open}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-m3-full text-[var(--m3-on-surface-variant)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] hover:text-[var(--m3-on-surface)] active:bg-[var(--m3-state-layer-pressed)]"
        data-pane-widget-menu-btn=""
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            ref={panelRef}
            className={M3_MENU_PANEL}
            style={{ top: placement.top, left: placement.left, width: 216, maxHeight: placement.maxHeight }}
            data-pane-widget-menu=""
          >
            <ToolbarOverflowCloseProvider value={close}>{children}</ToolbarOverflowCloseProvider>
          </div>,
          document.body,
        )}
    </>
  )
}

export default WidgetPane
