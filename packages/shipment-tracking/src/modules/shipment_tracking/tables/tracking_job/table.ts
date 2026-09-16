import { lazyTable, type TableDefinition } from '@freighttech/ui/backend/dynamic-table'
import { E } from '#generated/entities.ids.generated'

const table: TableDefinition = {
  metadata: {
    id: 'shipment_tracking.tracking_job',
    title: 'Tracking Jobs',
    titleKey: 'shipment_tracking.nav.tracking_jobs',
    features: ['shipment_tracking.tracking_jobs.view'],
    // Existing perspectives key — immutable, user views persist against it.
    perspectiveTableId: 'shipment_tracking_jobs',
    entityId: E.shipment_tracking.tracking_job,
    href: '/backend/tracking-jobs',
    icon: 'radar',
    group: 'Shipment Tracking',
    groupKey: 'shipment_tracking.nav.group',
    // DELIBERATELY EMPTY. `status` is the one criterion this row could answer in
    // principle, and it is still not mapped: api/tracking-jobs/route.ts is a
    // `makeCrudRoute` whose `buildFilters` reads only its own named query params
    // (status, carrierCode, referenceType, referenceValue). Neither branch of the
    // factory looks at the DynamicTable `filters` JSON the hook sends — it merges
    // `filter[...]` keys instead — so a shared status rule reaches the server and
    // is discarded. Claiming the filter would show unfiltered rows to someone who
    // believes they are filtered; reporting it as unmapped is the honest answer.
    // (Mapping becomes correct the day that route parses `filters`.)
    //
    // The row also has no customer and no transport mode, and its only dates
    // (`nextPollAt` / `lastPollAt`) are poller scheduling, not shipment dates.
    sharedFilters: {},
  },
  Table: lazyTable(() => import('./table.client')),
}

export default table
