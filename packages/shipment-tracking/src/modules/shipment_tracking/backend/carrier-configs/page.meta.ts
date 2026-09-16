import React from 'react'
import { KeyRound } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['shipment_tracking.carrier_configs.view'],
  pageTitle: 'Tracking Auth Config',
  pageTitleKey: 'shipment_tracking.nav.carrier_configs',
  pageGroup: 'Shipment Tracking',
  pageGroupKey: 'shipment_tracking.nav.group',
  pageContext: 'settings' as const,
  pagePriority: 10,
  pageOrder: 120,
  icon: React.createElement(KeyRound, { size: 16 }),
  breadcrumb: [{ label: 'Tracking Auth Config', labelKey: 'shipment_tracking.nav.carrier_configs' }],
}
