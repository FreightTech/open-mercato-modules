'use client'

// Saved instances of a widget, offered by name in every picker.
//
// A dashboard widget is a TYPE ("Data widget", "Saved report"): the catalogue
// lists it once and the slot's settings decide what it shows. When a module
// keeps named, saved things the user built — a data widget, a saved chart — a
// picker that only says "Data widget" makes the user pick twice, and nobody
// can find "Revenue by carrier" by typing it.
//
// So a widget module MAY carry `instances` (a field of the default-exported
// module object, next to `metadata` and `Widget`): a source that lists the saved
// things the current user can see, each with the settings that show it. Every
// picker (split views, the Pulpit, a module's Panele) lists them by name next
// to the widget types, and picking one places the widget with those settings.
// Nothing is registered anywhere: the widget's own module says it, and only
// the modules of widgets already in the user's catalogue are asked.
//
// The module is the light `widget.ts` (its metadata and a lazy client), so
// asking costs one small chunk per widget, once per session.
//
// Spec (FMS): .ai/specs/2026-10-08-workflows-data-widgets.md, "Placement".

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { DashboardWidgetComponentProps, DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { loadDashboardWidgetModule } from './widgetRegistry'

/** One saved, named thing a widget can show. */
export type WidgetInstance = {
  /** Stable within its widget (the saved record's id). */
  key: string
  /** The name the user gave it, as pickers list it. */
  title: string
  /** One supporting line (where it comes from, what it is). */
  description?: string | null
  /** The slot's settings that show this instance (what `hydrateSettings` takes). */
  settings: unknown
}

/** What a widget module carries as `instances`. */
export type WidgetInstanceSource = {
  /** The instances the current user can see. Called in the browser only. */
  list: () => Promise<WidgetInstance[]>
}

/**
 * A widget module (the default export of a module's `widget.ts`) that offers
 * saved instances: `{ metadata, Widget, …, instances: { list } }`.
 */
export type DashboardWidgetModuleWithInstances<TSettings = unknown> = DashboardWidgetModule<TSettings> & {
  instances?: WidgetInstanceSource
}

/** A widget's own props plus what a pane hands it beyond the upstream contract. */
export type PaneWidgetProps<TSettings = unknown> = DashboardWidgetComponentProps<TSettings> & {
  /**
   * Report the title this placement shows ("Revenue by carrier"), or null for
   * the widget type's own. A pane puts it in its header, so a widget that
   * reports one does not repeat it in its body. Absent where nothing listens.
   */
  onTitleChange?: (title: string | null) => void
}

/** One instance as a picker lists it. */
export type WidgetInstanceItem = {
  widgetId: string
  loaderKey: string
  instance: WidgetInstance
}

function sourceOf(mod: unknown): WidgetInstanceSource | null {
  if (!mod || typeof mod !== 'object') return null
  const candidate = (mod as { instances?: unknown }).instances
  if (!candidate || typeof candidate !== 'object') return null
  return typeof (candidate as WidgetInstanceSource).list === 'function' ? (candidate as WidgetInstanceSource) : null
}

function asInstance(raw: unknown): WidgetInstance | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.key !== 'string' || !r.key || typeof r.title !== 'string' || !r.title.trim()) return null
  return {
    key: r.key,
    title: r.title,
    description: typeof r.description === 'string' && r.description ? r.description : null,
    settings: r.settings ?? null,
  }
}

/**
 * Every instance offered by the given widgets. A widget whose module cannot be
 * loaded, has no `instances`, or whose `list()` fails contributes nothing — a
 * picker shows the rest rather than an error.
 *
 * `load` is injected for tests; it defaults to the real widget registry.
 */
export async function listWidgetInstances(
  widgets: ReadonlyArray<{ id: string; loaderKey: string }>,
  load: (loaderKey: string) => Promise<unknown> = loadDashboardWidgetModule,
): Promise<WidgetInstanceItem[]> {
  const perWidget = await Promise.all(
    widgets.map(async (widget) => {
      try {
        const source = sourceOf(await load(widget.loaderKey))
        if (!source) return []
        const listed = await source.list()
        if (!Array.isArray(listed)) return []
        const seen = new Set<string>()
        const out: WidgetInstanceItem[] = []
        for (const raw of listed) {
          const instance = asInstance(raw)
          if (!instance || seen.has(instance.key)) continue
          seen.add(instance.key)
          out.push({ widgetId: widget.id, loaderKey: widget.loaderKey, instance })
        }
        return out
      } catch (err) {
        try {
          console.warn(`[widgetInstances] ${widget.id}: instances could not be listed`, err)
        } catch {}
        return []
      }
    }),
  )
  return perWidget.flat()
}

/** Kept 30 s per (organisation, widget set): a picker opened again shows at once. */
const CACHE_MS = 30_000
const cache = new Map<string, { at: number; promise: Promise<WidgetInstanceItem[]> }>()

/** Forget every cached list (tests; a host after saving a new instance). */
export function invalidateWidgetInstances(): void {
  cache.clear()
}

function cachedList(key: string, widgets: ReadonlyArray<{ id: string; loaderKey: string }>): Promise<WidgetInstanceItem[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise
  const promise = listWidgetInstances(widgets)
  cache.set(key, { at: Date.now(), promise })
  return promise
}

/**
 * The instances of the given widgets, for a picker. Listed when `enabled`
 * (open pickers only), kept 30 s, listed again when the organisation changes.
 * Plain React state on purpose: pickers render in hosts and tests with no
 * query client, and a missing provider must not take the picker down.
 */
export function useWidgetInstances(
  widgets: ReadonlyArray<{ id: string; loaderKey: string }>,
  opts?: { enabled?: boolean },
): { items: WidgetInstanceItem[]; loading: boolean } {
  const scopeVersion = useOrganizationScopeVersion()
  const enabled = (opts?.enabled ?? true) && widgets.length > 0
  const key = React.useMemo(
    () => `${scopeVersion}|${widgets.map((w) => `${w.id}:${w.loaderKey}`).sort().join('|')}`,
    [widgets, scopeVersion],
  )
  const [state, setState] = React.useState<{ key: string; items: WidgetInstanceItem[] } | null>(null)
  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    cachedList(key, widgets).then(
      (items) => {
        if (!cancelled) setState({ key, items })
      },
      () => {
        if (!cancelled) setState({ key, items: [] })
      },
    )
    return () => {
      cancelled = true
    }
    // `key` stands for `widgets`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return React.useMemo(() => {
    if (!enabled) return { items: [], loading: false }
    // Until this key answers, keep the last list rather than flashing empty.
    return { items: state?.items ?? [], loading: state?.key !== key }
  }, [enabled, state, key])
}

/** The slot content an instance becomes when picked. */
export function instanceContent(item: WidgetInstanceItem): { kind: 'widget'; widgetId: string; loaderKey: string; settings: unknown } {
  return { kind: 'widget', widgetId: item.widgetId, loaderKey: item.loaderKey, settings: item.instance.settings }
}
