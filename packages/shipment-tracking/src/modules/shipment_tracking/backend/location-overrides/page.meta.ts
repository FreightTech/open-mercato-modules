import React from 'react'
import { MapPin } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['shipment_tracking.location_overrides.view'],
  pageTitle: 'Location Overrides',
  pageTitleKey: 'shipment_tracking.nav.location_overrides',
  pageGroup: 'Shipment Tracking',
  pageGroupKey: 'shipment_tracking.nav.group',
  pageContext: 'settings' as const,
  pagePriority: 10,
  pageOrder: 140,
  icon: React.createElement(MapPin, { size: 16 }),
  breadcrumb: [{ label: 'Location Overrides', labelKey: 'shipment_tracking.nav.location_overrides' }],
}
