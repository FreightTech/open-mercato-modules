import React from 'react'
import { Building2 } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['terminal_tracking.terminal_configs.view'],
  pageTitle: 'Terminals',
  pageTitleKey: 'terminal_tracking.nav.terminal_configs',
  pageGroup: 'Terminal Tracking',
  pageGroupKey: 'terminal_tracking.nav.group',
  pageContext: 'settings' as const,
  pagePriority: 10,
  pageOrder: 100,
  icon: React.createElement(Building2, { size: 16 }),
  breadcrumb: [{ label: 'Terminals', labelKey: 'terminal_tracking.nav.terminal_configs' }],
}
