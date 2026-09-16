/**
 * Thin logging wrapper. Mirrors the shipment-tracking logger shape but stays
 * dependency-light (falls back to console). The host app's logger can be wired
 * in later via DI if needed.
 */
const PREFIX = '[terminal-tracking]'

export const terminalLogger = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (process.env.TERMINAL_TRACKING_DEBUG) console.debug(PREFIX, message, meta ?? '')
  },
  info(message: string, meta?: Record<string, unknown>) {
    console.log(PREFIX, message, meta ?? '')
  },
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(PREFIX, message, meta ?? '')
  },
  error(message: string, meta?: Record<string, unknown>) {
    console.error(PREFIX, message, meta ?? '')
  },
}
