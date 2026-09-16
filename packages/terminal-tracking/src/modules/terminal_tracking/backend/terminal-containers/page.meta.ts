import React from 'react'
import { Container } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['terminal_tracking.tracking_jobs.view'],
  pageTitle: 'Tracked Containers',
  pageTitleKey: 'terminal_tracking.nav.tracking_jobs',
  pageGroup: 'Terminal Tracking',
  pageGroupKey: 'terminal_tracking.nav.group',
  pageContext: 'settings' as const,
  pagePriority: 10,
  pageOrder: 110,
  icon: React.createElement(Container, { size: 16 }),
  breadcrumb: [{ label: 'Tracked Containers', labelKey: 'terminal_tracking.nav.tracking_jobs' }],
}
