import React from 'react'
import { Ship } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['shipment_tracking.shipments.view'],
  pageTitle: 'Shipments',
  pageTitleKey: 'shipment_tracking.nav.shipments',
  pageGroup: 'Shipment Tracking',
  pageGroupKey: 'shipment_tracking.nav.group',
  pageContext: 'settings' as const,
  pagePriority: 10,
  pageOrder: 100,
  icon: React.createElement(Ship, { size: 16 }),
  breadcrumb: [{ label: 'Shipments', labelKey: 'shipment_tracking.nav.shipments' }],
}
