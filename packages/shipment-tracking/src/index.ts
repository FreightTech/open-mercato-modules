/**
 * @freighttech/shipment-tracking
 *
 * Ocean container shipment tracking with pluggable carrier adapters and webhooks
 */

export {
  Shipment,
  TrackingJob,
  TrackingEvent,
  CarrierConfig,
  Webhook,
  WebhookDelivery,
} from './modules/shipment_tracking/data/entities'

export type {
  ShipmentTimestampEntry,
  TimestampSource,
  TimestampType,
} from './modules/shipment_tracking/data/entities'

export type { CarrierAdapter, CarrierAdapterTestResult } from './modules/shipment_tracking/lib/carrier-adapter'
export type { ShipmentStatus } from './modules/shipment_tracking/lib/status-machine'
export { deriveShipmentStatus } from './modules/shipment_tracking/lib/status-machine'
export { extractShipmentTimes } from './modules/shipment_tracking/lib/time-extraction'

// Timestamp utilities for multi-source tracking
export {
  getLatestTimestamp,
  getPrimaryTimestampValue,
  getPrimaryTimestampOffset,
  createTimestampEntry,
  addTimestampEntry,
  mergeExtractedTimestamps,
  hasTimestamps,
  getTimestampsBySource,
  getTimestampHistory,
} from './modules/shipment_tracking/lib/timestamp-utils'
export type { ComputedTimestamp } from './modules/shipment_tracking/lib/timestamp-utils'
