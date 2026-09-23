/**
 * How a widget PRESENTS itself in a workspace — which group of the picker it
 * sits in, and which section its "Pokaż wszystko" link opens.
 *
 * WHY IT IS HERE and not on the widget: `DashboardWidgetMetadata` is an
 * `@open-mercato/*` type this repo consumes read-only, so neither fact can be
 * declared on it without an upstream change. Same line, same reasoning as
 * `WIDGET_SHARED_FILTERS` in `split-view/sharedCriteria.ts`.
 *
 * Both are optional. A widget with no entry is listed under its module and has
 * no footer link — which is honest: a link to a guessed route is worse than no
 * link.
 */

/**
 * The picker's widget groups, in display order — the designer's typology
 * (Figma "Typologia widżetów", 549:542). "Other" catches anything unmapped.
 */
export const WIDGET_KINDS = [
  'charts',
  'lists',
  'cards',
  'activity',
  'process',
  'triage',
  'tables',
  'banners',
  'map',
  'other',
] as const

export type WidgetKind = (typeof WIDGET_KINDS)[number]

export type WidgetPresentation = {
  kind?: WidgetKind
  /** The section the widget summarises — the footer CTA and "Otwórz dział". */
  href?: string
}

/**
 * Keyed by widget id. Add an entry when you add a widget; leave `href` out
 * unless the route is real.
 */
export const WIDGET_PRESENTATION: Record<string, WidgetPresentation> = {
  // Upstream analytics (dashboards module) — KPIs are cards, the rest charts.
  'dashboards.analytics.aovKpi': { kind: 'cards', href: '/backend' },
  'dashboards.analytics.newCustomersKpi': { kind: 'cards', href: '/backend' },
  'dashboards.analytics.ordersKpi': { kind: 'cards', href: '/backend' },
  'dashboards.analytics.revenueKpi': { kind: 'cards', href: '/backend' },
  'dashboards.analytics.ordersByStatus': { kind: 'charts', href: '/backend' },
  'dashboards.analytics.pipelineSummary': { kind: 'charts', href: '/backend' },
  'dashboards.analytics.revenueTrend': { kind: 'charts', href: '/backend' },
  'dashboards.analytics.salesByRegion': { kind: 'charts', href: '/backend' },
  'dashboards.analytics.topCustomers': { kind: 'charts', href: '/backend' },
  'dashboards.analytics.topProducts': { kind: 'charts', href: '/backend' },
  // FMS
  'shipment_tracking.dashboard.ships_map': { kind: 'map', href: '/backend/folders-transport' },
  'offers.dashboard.pendingResponseOffers': { kind: 'lists', href: '/backend/offers' },
  'offers.dashboard.unsentOffers': { kind: 'lists', href: '/backend/offers' },
  'invoicing.dashboard.activity': { kind: 'activity', href: '/backend/invoicing' },
  'invoicing.dashboard.inflows': { kind: 'charts', href: '/backend/invoicing' },
  'invoicing.dashboard.outflows': { kind: 'charts', href: '/backend/invoicing' },
  'invoicing.dashboard.toBook': { kind: 'lists', href: '/backend/invoicing' },
}

export function widgetPresentation(widgetId: string): WidgetPresentation {
  return WIDGET_PRESENTATION[widgetId] ?? {}
}
