'use client'

// One registry over the two things a pane can hold.
//
// It WRAPS `TableRegistryContext` rather than replacing it: tables keep their
// existing provider, their existing `hasFeature` injection and
// `filterAccessibleTables`, and every page that renders a table by id is
// untouched. This layer adds widgets beside them and resolves both through ONE
// lookup with ONE set of degradation states, so a host renders a slot without
// caring which kind it holds.
//
// ── The four states, and why widgets can reach all four ──────────────────────
// Tables get `denied` from the host's grant check. Widgets cannot: the server
// catalogue (`/api/dashboards/layout`) returns only the ALLOWED set, so a widget
// the user may not have is simply absent — indistinguishable from one deleted in
// a release. The client-side widget entry registry closes that gap: it is
// unfiltered and lists every widget compiled into the build, so
//
//     in catalogue                        -> ok
//     not in catalogue, code exists       -> denied
//     not in catalogue, no code           -> unknown
//     catalogue still in flight           -> loading
//
// which is the same vocabulary tables already use, arrived at honestly rather
// than by collapsing two different failures into one message.
//
// Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md (Phase 2)

import * as React from 'react'
import type { PaneContentRef } from '../split-view/types'
import type { TableDefinition } from './types'
import { useAccessibleTables, useTableById } from './TableRegistryContext'
import {
  EMPTY_WIDGET_CATALOG,
  useWidgetCatalog,
  widgetLoaderKeyExists,
  type WidgetCatalog,
  type WidgetCatalogEntry,
} from './widgetCatalog'

/** Same four states the table registry already uses. Do not add a fifth. */
export type ContentStatus = 'ok' | 'unknown' | 'denied' | 'loading'

export type TableContentItem = {
  kind: 'table'
  id: string
  title: string
  icon?: string
  group?: string
  definition: TableDefinition
}

export type WidgetContentItem = {
  kind: 'widget'
  id: string
  title: string
  icon?: string
  group?: string
  /** What `loadDashboardWidgetModule` takes. Present on widgets only. */
  loaderKey: string
  description?: string | null
  defaultSettings?: unknown
  supportsRefresh?: boolean
}

/** One entry a picker can list and a pane can mount, of either kind. */
export type PaneContentItem = TableContentItem | WidgetContentItem

export type ContentRegistryValue = WidgetCatalog & {
  /**
   * True only when a provider is actually mounted.
   *
   * Distinct from `ready`, which means "the catalogue answered". Without this a
   * host that forgot the provider would sit at `loading` forever, which reads as
   * "still working" — the one failure mode worse than an error.
   */
  mounted: boolean
  /** Injected so tests need no widget bootstrap. Defaults to the real registry. */
  loaderKeyExists: (loaderKey: string) => boolean
}

const DEFAULT_VALUE: ContentRegistryValue = {
  ...EMPTY_WIDGET_CATALOG,
  mounted: false,
  // Default-deny, exactly as `TableRegistryContext` defaults `hasFeature` to
  // false: a host that forgot the provider offers nothing rather than
  // everything.
  loaderKeyExists: () => false,
}

const ContentRegistryContext = React.createContext<ContentRegistryValue>(DEFAULT_VALUE)

/**
 * Supplies an already-resolved catalogue. Use this when a host owns the fetch
 * (or a test owns the fixtures); use `ContentRegistryBootstrap` otherwise.
 */
export function ContentRegistryProvider({
  value,
  children,
}: {
  value: Omit<ContentRegistryValue, 'mounted' | 'loaderKeyExists'> &
    Partial<Pick<ContentRegistryValue, 'loaderKeyExists'>>
  children: React.ReactNode
}) {
  const resolved = React.useMemo<ContentRegistryValue>(
    () => ({
      widgets: value.widgets,
      context: value.context,
      ready: value.ready,
      mounted: true,
      loaderKeyExists: value.loaderKeyExists ?? widgetLoaderKeyExists,
    }),
    [value],
  )
  return <ContentRegistryContext.Provider value={resolved}>{children}</ContentRegistryContext.Provider>
}

/**
 * Fetches the widget catalogue and provides it. Mount once, inside whatever
 * already provides the table registry and a react-query client.
 */
export function ContentRegistryBootstrap({ children }: { children: React.ReactNode }) {
  const catalog = useWidgetCatalog()
  return <ContentRegistryProvider value={catalog}>{children}</ContentRegistryProvider>
}

export function useContentRegistry(): ContentRegistryValue {
  return React.useContext(ContentRegistryContext)
}

/** The widget render context (`userId` / `tenantId` / `organizationId`), or null. */
export function useWidgetRenderContext() {
  return useContentRegistry().context
}

function widgetItem(entry: WidgetCatalogEntry): WidgetContentItem {
  return {
    kind: 'widget',
    id: entry.id,
    title: entry.title,
    icon: entry.icon ?? undefined,
    group: entry.moduleId,
    loaderKey: entry.loaderKey,
    description: entry.description,
    defaultSettings: entry.defaultSettings,
    supportsRefresh: entry.supportsRefresh,
  }
}

function tableItem(definition: TableDefinition): TableContentItem {
  return {
    kind: 'table',
    id: definition.metadata.id,
    title: definition.metadata.title,
    icon: definition.metadata.icon,
    group: definition.metadata.group,
    definition,
  }
}

/**
 * Everything the current user may put in a slot — tables AND widgets.
 *
 * Tables come through `filterAccessibleTables` (the host's grant check, applied
 * client-side, UX not security); widgets arrive pre-filtered by the server. Two
 * ACL paths, because the two halves genuinely have two authorities — but one
 * result shape, so a picker never branches.
 */
export function useAccessibleContent(): PaneContentItem[] {
  const tables = useAccessibleTables()
  const { widgets } = useContentRegistry()
  return React.useMemo(
    () => [...tables.map(tableItem), ...widgets.map(widgetItem)],
    [tables, widgets],
  )
}

function useWidgetById(ref: Extract<PaneContentRef, { kind: 'widget' }>): {
  item: PaneContentItem | null
  status: ContentStatus
} {
  const { widgets, ready, mounted, loaderKeyExists } = useContentRegistry()
  return React.useMemo(() => {
    if (!mounted) {
      // Only complain about a slot that actually names a widget — the sentinel
      // ref below keeps hook order stable on table-only pages, and those hosts
      // are under no obligation to mount this provider.
      if (ref.widgetId && process.env.NODE_ENV !== 'production') {
        try {
          console.warn(
            '[ContentRegistry] A widget slot was resolved with no ContentRegistryProvider mounted. ' +
              'Wrap the host in <ContentRegistryBootstrap> — otherwise every widget pane reads as removed.',
          )
        } catch {}
      }
      return { item: null, status: 'unknown' as const }
    }
    const entry = widgets.find((w) => w.id === ref.widgetId)
    if (entry) return { item: widgetItem(entry), status: 'ok' as const }
    if (!ready) return { item: null, status: 'loading' as const }
    // Absent from the allowed set. Its code still being in the build is what
    // makes this a permission verdict rather than a missing feature.
    if (loaderKeyExists(ref.loaderKey)) return { item: null, status: 'denied' as const }
    return { item: null, status: 'unknown' as const }
  }, [widgets, ready, mounted, loaderKeyExists, ref, ref.widgetId, ref.loaderKey])
}

function useTableContentById(ref: Extract<PaneContentRef, { kind: 'table' }>): {
  item: PaneContentItem | null
  status: ContentStatus
} {
  const { definition, status } = useTableById(ref.tableId)
  return React.useMemo(
    () => ({ item: definition ? tableItem(definition) : null, status }),
    [definition, status],
  )
}

/**
 * Resolve one slot's content, of either kind.
 *
 * Both branches run their hooks unconditionally — `PaneContentRef.kind` is
 * stable for the life of a slot (changing content replaces the node, minting a
 * new pane id), so this cannot reorder hooks between renders, and keeping both
 * live avoids forcing every caller to branch before it knows what it has.
 */
export function useContentById(ref: PaneContentRef | null | undefined): {
  item: PaneContentItem | null
  status: ContentStatus
} {
  const tableRef = React.useMemo<Extract<PaneContentRef, { kind: 'table' }>>(
    () => (ref?.kind === 'table' ? ref : { kind: 'table', tableId: '' }),
    [ref],
  )
  const widgetRef = React.useMemo<Extract<PaneContentRef, { kind: 'widget' }>>(
    () => (ref?.kind === 'widget' ? ref : { kind: 'widget', widgetId: '', loaderKey: '' }),
    [ref],
  )
  const table = useTableContentById(tableRef)
  const widget = useWidgetById(widgetRef)

  if (!ref) return { item: null, status: 'unknown' }
  return ref.kind === 'table' ? table : widget
}
