import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateShipsMapSettings, type ShipsMapSettings } from './config'

const ShipsMapWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<ShipsMapSettings> = {
  metadata: {
    id: 'shipment_tracking.dashboard.ships_map',
    title: 'Ships Map',
    description: 'Live positions of every vessel carrying your tracked containers, on one map.',
    features: ['dashboards.view', 'shipment_tracking.dashboard.ships_map.view'],
    defaultSize: 'lg',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['fms', 'shipment_tracking', 'map'],
    category: 'shipment_tracking',
    icon: 'ship',
    supportsRefresh: true,
  },
  Widget: ShipsMapWidget,
  hydrateSettings: hydrateShipsMapSettings,
  dehydrateSettings: (settings) => settings,
}

export default widget
