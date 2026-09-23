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
import { Loader2, MoreVertical, RefreshCw } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  DashboardLayoutItem,
  DashboardWidgetModule,
  DashboardWidgetRenderContext,
} from '@open-mercato/shared/modules/dashboard/widgets'
import { loadDashboardWidgetModule } from '../../dashboard/widgetRegistry'
import { AnchoredMenu } from './AnchoredMenu'
import { ICON_BUTTON } from './chrome'
import { contentTitle } from './ContentPicker'
import { widgetPresentation } from '../registry/widgetPresentation'
import {
  useContentById,
  useWidgetRenderContext,
  type WidgetContentItem,
} from '../registry/ContentRegistryContext'
import type { PaneContentRef } from './types'
import type { FilterRow } from '../types/index'
import { WORKSPACE_FILTERS_SETTINGS_KEY } from './sharedCriteria'

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
  /**
   * Show the footer link to the widget's section ("Pokaż wszystko"). A
   * per-widget choice stored on the slot; default on. Ignored when the widget
   * has nowhere to link to.
   */
  showCta?: boolean
  /**
   * The workspace's filters, already in this widget's own field names
   * (`mapCriteriaForWidget`). Handed to the widget in its settings under
   * `WORKSPACE_FILTERS_SETTINGS_KEY`; a widget that does not read them is
   * reported as "not filtered" by the bar, never silently skipped.
   */
  sharedFilters?: FilterRow[]
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
  showCta = true,
  sharedFilters,
}: WidgetPaneProps) {
  const t = useT()
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
      <PaneMessage data-pane-status="unknown">
        {t('splitView.pane.widgetUnknown', 'This widget is no longer available.')}
      </PaneMessage>
    )
  }
  if (status === 'denied' || !item || item.kind !== 'widget') {
    return (
      <PaneMessage data-pane-status="denied">
        {t('splitView.pane.denied', 'You don’t have access to {title}.', {
          title: item ? contentTitle(t, item) : t('splitView.pane.thisWidget', 'this widget'),
        })}
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
      showCta={showCta}
      sharedFilters={sharedFilters}
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
  showCta,
  sharedFilters,
}: {
  item: WidgetContentItem
  content: WidgetRef
  slotId: string
  onSettingsChange?: (next: unknown) => void
  overflowExtras?: React.ReactNode
  hideToolbar?: boolean
  showCta?: boolean
  sharedFilters?: FilterRow[]
}) {
  const t = useT()
  const title = contentTitle(t, item)
  const description = item.description
    ? t(`splitView.widgetDescription.${item.id}`, item.description)
    : null
  const href = widgetPresentation(item.id).href
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
      // A widget that spreads its settings back would echo the workspace
      // filters; they are the workspace's, not the slot's, so they never persist.
      if (next && typeof next === 'object' && WORKSPACE_FILTERS_SETTINGS_KEY in (next as object)) {
        const { [WORKSPACE_FILTERS_SETTINGS_KEY]: _omit, ...rest } = next as Record<string, unknown>
        next = rest
      }
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

  // The settings the widget SEES: its own, plus the workspace filters on top.
  // Never written back — `handleSettingsChange` persists what the widget sends,
  // and a widget echoing this key would only re-store the same rows.
  const widgetSettings = React.useMemo(() => {
    if (!sharedFilters || sharedFilters.length === 0) return hydratedSettings
    const base = hydratedSettings && typeof hydratedSettings === 'object' ? hydratedSettings : {}
    return { ...(base as Record<string, unknown>), [WORKSPACE_FILTERS_SETTINGS_KEY]: sharedFilters }
  }, [hydratedSettings, sharedFilters])

  return (
    // The Figma widget card (549:542, "Widżet"): a header with the title, the
    // supporting line and one ⋮ — every widget action lives in that menu, never
    // as header buttons — then the content, then an optional footer link to the
    // widget's section. 16px insets, the compact reference (696:19056).
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-pane-widget-body={content.widgetId}
    >
      {!hideToolbar && (
        <div
          className="flex shrink-0 items-start gap-2 px-4 pb-2 pt-3 text-[var(--m3-on-surface)]"
          data-pane-widget-header=""
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body-medium-sm" title={title}>
              {title}
            </span>
            {description && (
              <span
                className="truncate text-body-regular-sm text-[var(--m3-on-surface-variant)]"
                title={description}
                data-pane-widget-description=""
              >
                {description}
              </span>
            )}
          </div>
          {supportsRefresh && (
            <button
              type="button"
              onClick={triggerRefresh}
              disabled={loading || loadFailed}
              aria-label={t('splitView.pane.refresh', 'Refresh')}
              title={t('splitView.pane.refresh', 'Refresh')}
              className={ICON_BUTTON}
              data-pane-widget-refresh=""
            >
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </button>
          )}
          {overflowExtras ? (
            <AnchoredMenu
              placement={{ width: 232, preferredHeight: 560, align: 'end' }}
              panelProps={{ 'data-pane-widget-menu': '' }}
              renderTrigger={({ ref, open, toggle }) => (
                <button
                  ref={ref}
                  type="button"
                  onClick={toggle}
                  aria-label={t('splitView.pane.options', 'Pane options')}
                  aria-expanded={open}
                  className={ICON_BUTTON}
                  data-pane-widget-menu-btn=""
                >
                  <MoreVertical />
                </button>
              )}
            >
              {() => overflowExtras}
            </AnchoredMenu>
          ) : null}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-3" data-pane-widget-content="">
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
            {t('splitView.pane.widgetFailed', 'This widget could not be loaded.')}
          </div>
        )}
        {!loading && !loadFailed && Widget && (
          <Widget
            mode="view"
            layout={layout}
            settings={widgetSettings}
            context={renderContext ?? ANONYMOUS_CONTEXT}
            onSettingsChange={handleSettingsChange}
            refreshToken={refreshToken}
            onRefreshStateChange={setRefreshing}
          />
        )}
      </div>

      {showCta && href && (
        // Figma: a hairline, then a 48px row with one text button on the right.
        <div
          className="flex h-12 shrink-0 items-center justify-end border-t border-[var(--m3-outline-variant)] px-2"
          data-pane-widget-footer=""
        >
          <a
            href={href}
            className="inline-flex h-8 items-center rounded-m3-full px-3 text-label-medium-md text-[var(--m3-on-surface)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] active:bg-[var(--m3-state-layer-pressed)]"
            data-pane-widget-cta=""
          >
            {t('splitView.pane.showAll', 'Show all')}
          </a>
        </div>
      )}
    </div>
  )
}

export default WidgetPane
