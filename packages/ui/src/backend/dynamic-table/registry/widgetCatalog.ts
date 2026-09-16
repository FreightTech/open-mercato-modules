'use client'

// The widget half of the content registry: what widgets exist, what the user is
// allowed to place, and the render context they need — WITHOUT loading a single
// widget chunk.
//
// ── Why /api/dashboards/layout and not /api/dashboards/widgets/catalog ───────
// The catalog endpoint reads like the obvious choice and is the wrong one. Twice:
//
//  1. It is gated on `dashboards.admin.assign-widgets`
//     (@open-mercato/core/modules/dashboards/api/widgets/catalog.ts:10) and 403s
//     for every ordinary user. A picker built on it would be empty for exactly
//     the people who use it.
//  2. It is NOT ACL-filtered per user. It returns every widget the build
//     contains, so the few users who can call it would be offered widgets they
//     may not render.
//
// `GET /api/dashboards/layout` requires only `dashboards.view` and returns
// `widgets` already narrowed by `resolveAllowedWidgetIds`, which applies BOTH
// the role/user widget assignments and `userHasAllFeatures(...)` against the
// widget's own `metadata.features`. It also returns `context` — the
// user/tenant/organization triple every widget component is handed — which the
// catalog endpoint does not, and which we would otherwise have no honest source
// for. One call answers both questions the same way the dashboard asks them.
//
// **It is a GET that writes.** When the user has no `DashboardLayout` row yet it
// creates one seeded with the default widgets, and it prunes widgets that are no
// longer permitted. That is the same effect as visiting /backend/dashboard, and
// it is idempotent after the first call — but it IS a side effect and is
// recorded here rather than discovered later. There is no read-only endpoint
// that answers "which widgets may I place" without an upstream change, and an
// upstream change is out of scope.
//
// Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md (Phase 2)

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type {
  DashboardWidgetRenderContext,
  DashboardWidgetSize,
} from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '../../utils/apiCall'
import { getDashboardWidgets } from '../../dashboard/widgetRegistry'

/**
 * One widget as the picker and the pane need it: enough to list it, enough to
 * mount it, and nothing that requires fetching its code.
 *
 * Mirrors the DTO `/api/dashboards/layout` returns, minus the fields only the
 * dashboard's own grid uses.
 */
export type WidgetCatalogEntry = {
  /** '<module>.dashboard.<slug>' — the stable id stored on a pane. */
  id: string
  title: string
  description: string | null
  /** Key into the client-side widget entry registry; what `loadDashboardWidgetModule` takes. */
  loaderKey: string
  /** lucide-react icon name, same convention as `TableDefinitionMetadata.icon`. */
  icon: string | null
  /** ACL features the widget declares. Already applied server-side; kept for display and audit. */
  features: string[]
  /** Owning module — the only grouping the DTO carries, so it is the picker's group. */
  moduleId: string
  defaultSettings: unknown
  defaultSize: DashboardWidgetSize
  supportsRefresh: boolean
}

export type WidgetCatalog = {
  /** Widgets this user may place, ACL-filtered server-side. */
  widgets: WidgetCatalogEntry[]
  /** The user/tenant/org triple a widget component is handed. Null until fetched. */
  context: DashboardWidgetRenderContext | null
  /** False while the catalogue is in flight, so a picker does not flash empty. */
  ready: boolean
}

export const EMPTY_WIDGET_CATALOG: WidgetCatalog = {
  widgets: [],
  context: null,
  ready: false,
}

type LayoutWidgetDto = {
  id?: unknown
  title?: unknown
  description?: unknown
  defaultSize?: unknown
  defaultSettings?: unknown
  features?: unknown
  moduleId?: unknown
  icon?: unknown
  loaderKey?: unknown
  supportsRefresh?: unknown
}

type LayoutContextDto = {
  userId?: unknown
  tenantId?: unknown
  organizationId?: unknown
  userName?: unknown
  userEmail?: unknown
  userLabel?: unknown
}

type LayoutResponse = {
  widgets?: LayoutWidgetDto[]
  context?: LayoutContextDto | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asSize(value: unknown): DashboardWidgetSize {
  return value === 'sm' || value === 'md' || value === 'lg' ? value : 'md'
}

/**
 * Narrow the DTO to what we render.
 *
 * Defensive because the response is a wire format: a widget missing `id` or
 * `loaderKey` cannot be placed OR mounted, so it is dropped rather than listed
 * as an entry that fails the moment it is picked.
 */
export function parseWidgetCatalog(payload: LayoutResponse | null): WidgetCatalogEntry[] {
  const rows = Array.isArray(payload?.widgets) ? payload!.widgets! : []
  const seen = new Set<string>()
  const out: WidgetCatalogEntry[] = []
  for (const row of rows) {
    const id = asString(row?.id)
    const loaderKey = asString(row?.loaderKey)
    if (!id || !loaderKey || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      title: asString(row?.title) ?? id,
      description: asString(row?.description),
      loaderKey,
      icon: asString(row?.icon),
      features: Array.isArray(row?.features) ? row!.features!.filter((f): f is string => typeof f === 'string') : [],
      moduleId: asString(row?.moduleId) ?? 'other',
      defaultSettings: row?.defaultSettings ?? null,
      defaultSize: asSize(row?.defaultSize),
      supportsRefresh: row?.supportsRefresh === true,
    })
  }
  return out
}

export function parseWidgetRenderContext(
  payload: LayoutResponse | null,
): DashboardWidgetRenderContext | null {
  const raw = payload?.context
  if (!raw || typeof raw !== 'object') return null
  const userId = asString(raw.userId)
  if (!userId) return null
  return {
    userId,
    tenantId: asString(raw.tenantId),
    organizationId: asString(raw.organizationId),
    userName: asString(raw.userName),
    userEmail: asString(raw.userEmail),
    userLabel: asString(raw.userLabel),
  }
}

/**
 * Does a widget's code exist in THIS build at all?
 *
 * The one signal that separates "removed from the product" from "you are not
 * permitted it" — because the server catalogue only ever returns the allowed
 * set, so absence from it means both things at once. The client entry registry
 * (populated by `registerDashboardWidgets` at bootstrap) is unfiltered and
 * carries only `{ key, loader }`, so this costs no fetch and loads no chunk.
 */
export function widgetLoaderKeyExists(loaderKey: string): boolean {
  if (!loaderKey) return false
  try {
    return getDashboardWidgets().some((entry) => entry.key === loaderKey)
  } catch {
    // Not registered (server render, or a host that never bootstrapped). Say
    // "unknown", not "denied" — claiming a permission verdict we cannot make.
    return false
  }
}

/**
 * Fetch + cache the widget catalogue.
 *
 * Keyed on the organization scope version for the same reason
 * `TableRegistryBootstrap` is: widget grants are per organization, and the org
 * switcher changes scope client-side with no reload, so a key without it would
 * serve the previous org's answer. `staleTime` matches the table grants (60s).
 */
export function useWidgetCatalog(options?: { enabled?: boolean }): WidgetCatalog {
  const scopeVersion = useOrganizationScopeVersion()
  const enabled = options?.enabled !== false

  const { data, isFetched } = useQuery({
    queryKey: ['dashboard-widget-catalog', scopeVersion],
    queryFn: async () => {
      const res = await apiCall<LayoutResponse>('/api/dashboards/layout')
      // A failed call offers nothing. Default-deny keeps a transient network
      // error from listing widgets the user cannot actually render.
      if (!res.ok || !res.result) return { widgets: [], context: null }
      return {
        widgets: parseWidgetCatalog(res.result),
        context: parseWidgetRenderContext(res.result),
      }
    },
    staleTime: 60_000,
    enabled,
  })

  return React.useMemo(
    () => ({
      widgets: data?.widgets ?? [],
      context: data?.context ?? null,
      ready: enabled ? isFetched : false,
    }),
    [data, isFetched, enabled],
  )
}
