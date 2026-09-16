import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * Shipment Tracking Notification Types
 *
 * These are per-tracking-job notification types for POI proximity events.
 * Using per-job events ensures only one notification per booking/BOL,
 * regardless of how many containers are being tracked.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  // ─── Tracking Job POI Port Events ──────────────────────────────
  {
    type: 'shipment_tracking.tracking_job.poi.port_arrival',
    module: 'shipment_tracking',
    titleKey: 'shipment_tracking.notifications.tracking_job.poi.port_arrival.title',
    bodyKey: 'shipment_tracking.notifications.tracking_job.poi.port_arrival.body',
    icon: 'anchor',
    severity: 'success',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/shipment-tracking?shipment={sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/shipment-tracking?shipment={sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
  {
    type: 'shipment_tracking.tracking_job.poi.port_proximity_arrival',
    module: 'shipment_tracking',
    titleKey: 'shipment_tracking.notifications.tracking_job.poi.port_proximity_arrival.title',
    bodyKey: 'shipment_tracking.notifications.tracking_job.poi.port_proximity_arrival.body',
    icon: 'navigation',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/shipment-tracking?shipment={sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/shipment-tracking?shipment={sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: 'shipment_tracking.tracking_job.poi.port_departure',
    module: 'shipment_tracking',
    titleKey: 'shipment_tracking.notifications.tracking_job.poi.port_departure.title',
    bodyKey: 'shipment_tracking.notifications.tracking_job.poi.port_departure.body',
    icon: 'ship',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/shipment-tracking?shipment={sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/shipment-tracking?shipment={sourceEntityId}',
    expiresAfterHours: 168,
  },

  // ─── Tracking Job POI Terminal Events ──────────────────────────
  {
    type: 'shipment_tracking.tracking_job.poi.terminal_arrival',
    module: 'shipment_tracking',
    titleKey: 'shipment_tracking.notifications.tracking_job.poi.terminal_arrival.title',
    bodyKey: 'shipment_tracking.notifications.tracking_job.poi.terminal_arrival.body',
    icon: 'container',
    severity: 'success',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/shipment-tracking?shipment={sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/shipment-tracking?shipment={sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: 'shipment_tracking.tracking_job.poi.terminal_proximity_arrival',
    module: 'shipment_tracking',
    titleKey: 'shipment_tracking.notifications.tracking_job.poi.terminal_proximity_arrival.title',
    bodyKey: 'shipment_tracking.notifications.tracking_job.poi.terminal_proximity_arrival.body',
    icon: 'navigation',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/shipment-tracking?shipment={sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/shipment-tracking?shipment={sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: 'shipment_tracking.tracking_job.poi.terminal_departure',
    module: 'shipment_tracking',
    titleKey: 'shipment_tracking.notifications.tracking_job.poi.terminal_departure.title',
    bodyKey: 'shipment_tracking.notifications.tracking_job.poi.terminal_departure.body',
    icon: 'ship',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/shipment-tracking?shipment={sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/shipment-tracking?shipment={sourceEntityId}',
    expiresAfterHours: 168,
  },

  // ─── Tracking Job POI Waypoint Events ──────────────────────────
  {
    type: 'shipment_tracking.tracking_job.poi.waypoint_reached',
    module: 'shipment_tracking',
    titleKey: 'shipment_tracking.notifications.tracking_job.poi.waypoint_reached.title',
    bodyKey: 'shipment_tracking.notifications.tracking_job.poi.waypoint_reached.body',
    icon: 'map-pin',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/shipment-tracking?shipment={sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/shipment-tracking?shipment={sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
