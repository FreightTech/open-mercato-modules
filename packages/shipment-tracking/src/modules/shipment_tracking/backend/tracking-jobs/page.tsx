'use client'

// Thin host over the registered table, wrapped in the split-view host so the
// user can open another module's table beside it without leaving this page.
// The table itself lives at
// `modules/shipment_tracking/tables/tracking_job/table.client.tsx` and is
// rendered here via the registry, so there is no second implementation.
//
// Specs: .ai/specs/2026-08-04-module-table-registry.md
//        .ai/specs/2026-08-17-split-view-workspace-composition.md

import { SplitViewHost } from '@freighttech/ui/backend/dynamic-table'

export default function TrackingJobsPage() {
  return <SplitViewHost tableId="shipment_tracking.tracking_job" />
}
