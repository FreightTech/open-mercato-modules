import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  // ─── Tracking job lifecycle (internal) ─────────────────────────
  { id: 'terminal_tracking.tracking_job.created', label: 'Terminal Tracking Job Created', entity: 'tracking_job', category: 'crud', excludeFromTriggers: true },
  { id: 'terminal_tracking.tracking_job.updated', label: 'Terminal Tracking Job Updated', entity: 'tracking_job', category: 'crud', excludeFromTriggers: true },
  { id: 'terminal_tracking.tracking_job.failed', label: 'Terminal Tracking Job Failed', entity: 'tracking_job', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'terminal_tracking.tracking_job.poll_failed', label: 'Terminal Tracking Job Poll Failed', entity: 'tracking_job', category: 'lifecycle', excludeFromTriggers: true },

  // ─── Raw terminal event (the bridge trigger) ───────────────────
  { id: 'terminal_tracking.terminal_event.created', label: 'Terminal Event Created', entity: 'terminal_event', category: 'crud' },
  { id: 'terminal_tracking.terminal_event.updated', label: 'Terminal Event Updated', entity: 'terminal_event', category: 'crud' },

  // ─── Semantic milestones (per container) ───────────────────────
  { id: 'terminal_tracking.equipment.gate_in', label: 'Container Gate In (Terminal)', entity: 'terminal_event', category: 'lifecycle' },
  { id: 'terminal_tracking.equipment.discharged', label: 'Container Discharged (Terminal)', entity: 'terminal_event', category: 'lifecycle' },
  { id: 'terminal_tracking.equipment.loaded', label: 'Container Loaded (Terminal)', entity: 'terminal_event', category: 'lifecycle' },
  { id: 'terminal_tracking.transport.departed', label: 'Container Departed (Terminal)', entity: 'terminal_event', category: 'lifecycle' },

  // ─── Availability milestones (fire once per container) ─────────
  // Export empty released for collection: empty container in the yard with no
  // movement-blocking holds.
  { id: 'terminal_tracking.equipment.empty_ready', label: 'Empty Container Ready For Pickup (Terminal)', entity: 'terminal_event', category: 'lifecycle' },
  // Import container's blocking holds removed: it became collectable (transition
  // from blocked → unblocked while in the yard).
  { id: 'terminal_tracking.equipment.holds_cleared', label: 'Import Holds Cleared (Terminal)', entity: 'terminal_event', category: 'lifecycle' },
  // The raw impediment (hold) set changed between polls. Unlike the two
  // one-shot availability events above, this fires every poll the set changes
  // (including first appearance with holds) so downstream consumers can mirror
  // the current hold list. Payload carries `impediments: string[]`.
  { id: 'terminal_tracking.equipment.holds_updated', label: 'Container Holds Updated (Terminal)', entity: 'terminal_event', category: 'lifecycle' },
  // The per-mode load/pickup STOP flags (Stop-Vsl / Stop-Road / Stop-Rail)
  // changed between polls. Like `holds_updated`, fires every poll the set
  // changes (incl. first appearance) so downstream consumers can mirror the
  // current stops. Payload carries `stops: { vsl, road, rail: boolean | null }`.
  { id: 'terminal_tracking.equipment.stops_updated', label: 'Container Load Stops Updated (Terminal)', entity: 'terminal_event', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'terminal_tracking',
  events,
})

export const emitTerminalTrackingEvent = eventsConfig.emit

export type TerminalTrackingEventId = typeof events[number]['id']

export default eventsConfig
