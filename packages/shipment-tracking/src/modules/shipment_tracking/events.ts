import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Shipment Tracking Module Events
 *
 * Event Emission Granularity:
 * ───────────────────────────────────────────────────────────────────────────────
 * PER SHIPMENT (Container):
 *   - Shipment CRUD/Lifecycle events are emitted once per shipment entity.
 *   - A booking with 5 containers will trigger 5 events.
 *   - Includes: shipment.*, transport.*, equipment.*, poi.*
 *
 * PER TRACKING JOB (BOL/Booking):
 *   - Tracking job events are emitted once per tracking job, regardless of
 *     how many containers are in the booking.
 *   - Includes: tracking_job.*
 *
 * PER TRACKING EVENT (Raw Event Record):
 *   - tracking_event.created is emitted per raw event record from carriers.
 *   - Contains equipmentReference for the specific container.
 *
 * NOTE: For notifications, POI events emit per-shipment which can cause
 * duplicate notifications for multi-container bookings. The notification
 * subscriber should deduplicate by bookingNumber/bolNumber.
 * ───────────────────────────────────────────────────────────────────────────────
 */

const events = [
  // ─── Shipment CRUD ─────────────────────────────────────────────
  // Emitted PER SHIPMENT (container) - booking with N containers = N events
  { id: 'shipment_tracking.shipment.created', label: 'Shipment Created', entity: 'shipment', category: 'crud' },
  { id: 'shipment_tracking.shipment.updated', label: 'Shipment Updated', entity: 'shipment', category: 'crud' },
  { id: 'shipment_tracking.shipment.deleted', label: 'Shipment Deleted', entity: 'shipment', category: 'crud' },

  // ─── Shipment Lifecycle ────────────────────────────────────────
  // Emitted PER SHIPMENT (container) - booking with N containers = N events
  { id: 'shipment_tracking.shipment.status_changed', label: 'Shipment Status Changed', entity: 'shipment', category: 'lifecycle' },
  { id: 'shipment_tracking.shipment.booked', label: 'Shipment Booked', entity: 'shipment', category: 'lifecycle' },
  { id: 'shipment_tracking.shipment.pre_arrival', label: 'Shipment Pre-Arrival', entity: 'shipment', category: 'lifecycle' },
  { id: 'shipment_tracking.shipment.delivered', label: 'Shipment Delivered', entity: 'shipment', category: 'lifecycle' },

  // ─── Transport Events (DCSA TRANSPORT) ─────────────────────────
  // Emitted PER SHIPMENT when shipment ETA/ETD is updated
  // Vessel/transport movement events per DCSA T&T standard
  { id: 'shipment_tracking.transport.departed', label: 'Transport Departed', entity: 'shipment', category: 'lifecycle' },
  { id: 'shipment_tracking.transport.arrived', label: 'Transport Arrived', entity: 'shipment', category: 'lifecycle' },
  { id: 'shipment_tracking.transport.eta_updated', label: 'ETA Updated', entity: 'shipment', category: 'lifecycle' },
  { id: 'shipment_tracking.transport.etd_updated', label: 'ETD Updated', entity: 'shipment', category: 'lifecycle' },
  { id: 'shipment_tracking.transport.omitted', label: 'Port Omitted', entity: 'shipment', category: 'lifecycle' },

  // ─── Equipment Events (DCSA EQUIPMENT) ─────────────────────────
  // Emitted PER CONTAINER - tied to specific equipmentReference
  // Container handling events per DCSA T&T standard
  { id: 'shipment_tracking.equipment.loaded', label: 'Container Loaded', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.equipment.discharged', label: 'Container Discharged', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.equipment.gate_in', label: 'Container Gate In', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.equipment.gate_out', label: 'Container Gate Out', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.equipment.available_pickup', label: 'Available for Pickup', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.equipment.customs_released', label: 'Customs Released', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.equipment.inspected', label: 'Container Inspected', entity: 'tracking_event', category: 'lifecycle' },

  // NOTE: air (mode='air') milestones are NOT separate events. The ShipsGo
  // mapper translates air movements onto the DCSA departure/arrival/delivery
  // codes, so an air shipment already emits the shared transport.*/shipment.*
  // lifecycle events the notification system consumes. Dedicated air.* events
  // would need their own emit path + subscribers and would double-fire; add
  // them only when a consumer genuinely needs the RCS/MAN/RCF granularity.

  // ─── Tracking Events (generic) ─────────────────────────────────
  // Emitted PER RAW EVENT from carrier API (contains equipmentReference)
  { id: 'shipment_tracking.tracking_event.created', label: 'Tracking Event Created', entity: 'tracking_event', category: 'crud' },

  // ─── Internal Events (excluded from webhook triggers) ──────────
  // Emitted PER TRACKING JOB (BOL/Booking) - once regardless of container count
  // Tracking jobs - internal system events
  { id: 'shipment_tracking.tracking_job.created', label: 'Tracking Job Created', entity: 'tracking_job', category: 'crud', excludeFromTriggers: true },
  { id: 'shipment_tracking.tracking_job.updated', label: 'Tracking Job Updated', entity: 'tracking_job', category: 'crud', excludeFromTriggers: true },
  { id: 'shipment_tracking.tracking_job.failed', label: 'Tracking Job Failed', entity: 'tracking_job', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'shipment_tracking.tracking_job.completed', label: 'Tracking Job Completed', entity: 'tracking_job', category: 'lifecycle', excludeFromTriggers: true },

  // Webhook delivery - internal infrastructure events
  { id: 'shipment_tracking.webhook.delivery_success', label: 'Webhook Delivery Success', entity: 'webhook_delivery', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'shipment_tracking.webhook.delivery_failed', label: 'Webhook Delivery Failed', entity: 'webhook_delivery', category: 'lifecycle', excludeFromTriggers: true },

  // ─── Tracking Job Poll Events ──────────────────────────────────
  // Emitted PER TRACKING JOB
  { id: 'shipment_tracking.tracking_job.poll_failed', label: 'Tracking Job Poll Failed', entity: 'tracking_job', category: 'lifecycle', excludeFromTriggers: true },

  // ─── Tracking Job POI Events (for notifications) ───────────────
  // Emitted PER TRACKING JOB (BOL/Booking) - once regardless of container count
  // Used for in-app notifications to avoid duplicates for multi-container bookings
  { id: 'shipment_tracking.tracking_job.poi.port_arrival', label: 'Tracking Job - Port Arrival', entity: 'tracking_job', category: 'lifecycle' },
  { id: 'shipment_tracking.tracking_job.poi.port_proximity_arrival', label: 'Tracking Job - Approaching Port', entity: 'tracking_job', category: 'lifecycle' },
  { id: 'shipment_tracking.tracking_job.poi.port_departure', label: 'Tracking Job - Port Departure', entity: 'tracking_job', category: 'lifecycle' },
  { id: 'shipment_tracking.tracking_job.poi.terminal_arrival', label: 'Tracking Job - Terminal Arrival', entity: 'tracking_job', category: 'lifecycle' },
  { id: 'shipment_tracking.tracking_job.poi.terminal_proximity_arrival', label: 'Tracking Job - Approaching Terminal', entity: 'tracking_job', category: 'lifecycle' },
  { id: 'shipment_tracking.tracking_job.poi.terminal_departure', label: 'Tracking Job - Terminal Departure', entity: 'tracking_job', category: 'lifecycle' },
  { id: 'shipment_tracking.tracking_job.poi.waypoint_reached', label: 'Tracking Job - Waypoint Reached', entity: 'tracking_job', category: 'lifecycle' },

  // ─── POI Proximity Events (AIS) ─────────────────────────────────
  // Emitted PER SHIPMENT (container) - a vessel arrival triggers N events for N containers
  // Real-time vessel position events from AIS POI detector
  // NOTE: Notification subscribers should deduplicate by bookingNumber/bolNumber
  { id: 'shipment_tracking.poi.port_arrival', label: 'Vessel Port Arrival (AIS)', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.poi.port_proximity_arrival', label: 'Vessel Approaching Port (AIS)', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.poi.port_departure', label: 'Vessel Port Departure (AIS)', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.poi.terminal_arrival', label: 'Vessel Terminal Arrival (AIS)', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.poi.terminal_proximity_arrival', label: 'Vessel Approaching Terminal (AIS)', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.poi.terminal_departure', label: 'Vessel Terminal Departure (AIS)', entity: 'tracking_event', category: 'lifecycle' },
  { id: 'shipment_tracking.poi.waypoint_reached', label: 'Vessel Waypoint Reached (AIS)', entity: 'tracking_event', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'shipment_tracking',
  events,
})

export const emitShipmentTrackingEvent = eventsConfig.emit

export type ShipmentTrackingEventId = typeof events[number]['id']

export default eventsConfig
