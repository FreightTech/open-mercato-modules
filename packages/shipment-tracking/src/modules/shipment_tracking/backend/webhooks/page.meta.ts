import React from 'react'
import { Webhook } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['shipment_tracking.webhooks.view'],
  pageTitle: 'Webhooks',
  pageTitleKey: 'shipment_tracking.nav.webhooks',
  pageGroup: 'Shipment Tracking',
  pageGroupKey: 'shipment_tracking.nav.group',
  pageContext: 'settings' as const,
  pagePriority: 10,
  pageOrder: 130,
  icon: React.createElement(Webhook, { size: 16 }),
  breadcrumb: [{ label: 'Webhooks', labelKey: 'shipment_tracking.nav.webhooks' }],
}
