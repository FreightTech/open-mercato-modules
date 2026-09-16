/**
 * @freighttech/terminal-tracking
 *
 * Container terminal (Navis N4) tracking: per-terminal config, periodic
 * polling, container event emission, and terminal matching.
 */

// Entities
export {
  TerminalConfig,
  TerminalTrackingJob,
  TerminalEvent,
} from './modules/terminal_tracking/data/entities'

// Types
export type {
  TerminalEventType,
  TerminalEventClassifierCode,
  TerminalEventSource,
  FacilityCodeProvider,
  TerminalModeOfTransport,
  TerminalAuthType,
  TerminalTrackingJobStatus,
  TerminalEndpoints,
  TerminalSealInfo,
} from './modules/terminal_tracking/data/entities'

// Adapter contract
export type {
  TerminalAdapter,
  TerminalFetchedEvent,
  TerminalFetchResult,
  TerminalAdapterTestResult,
  ResolvedTerminalConfig,
} from './modules/terminal_tracking/lib/terminal-adapter'

// Services
export { TerminalRegistry } from './modules/terminal_tracking/services/terminalRegistry'
export { TerminalTrackingService } from './modules/terminal_tracking/services/terminalTrackingService'
export { TerminalMatcherService } from './modules/terminal_tracking/services/terminalMatcherService'

// Events
export { eventsConfig, emitTerminalTrackingEvent } from './modules/terminal_tracking/events'
export type { TerminalTrackingEventId } from './modules/terminal_tracking/events'
