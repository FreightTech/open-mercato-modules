/**
 * NATS Configuration for POI Proximity Events
 *
 * Configuration for connecting to NATS server and subscribing to
 * POI proximity events from the AIS system.
 */

import { createHash, randomUUID } from 'crypto'

// ─── Configuration Interface ─────────────────────────────────

export interface PoiNatsConfig {
  /** NATS server URL (e.g., nats://localhost:4222) */
  serverUrl: string

  /** JetStream stream name containing POI events */
  streamName: string

  /** NATS subject for POI proximity events (filter within stream) */
  subject: string

  /** Unique instance identifier (derived from JWT_SECRET or explicit) */
  instanceId: string

  /** Durable consumer name for reliable message delivery (includes instanceId) */
  consumerName: string

  /** Connection name for debugging */
  connectionName: string

  /** Reconnect settings */
  reconnect: {
    /** Maximum reconnect attempts (-1 for infinite) */
    maxAttempts: number
    /** Initial delay between reconnects in ms */
    initialDelayMs: number
    /** Maximum delay between reconnects in ms */
    maxDelayMs: number
  }
}

// ─── Instance ID Generation ──────────────────────────────────

/**
 * Generate a unique instance ID for this deployment.
 *
 * Priority:
 * 1. POI_NATS_INSTANCE_ID env var (explicit override)
 * 2. Hash of JWT_SECRET (stable, unique per installation)
 * 3. Random UUID prefix (fallback for dev/testing)
 */
function generateInstanceId(): string {
  // 1. Explicit override
  if (process.env.POI_NATS_INSTANCE_ID) {
    return process.env.POI_NATS_INSTANCE_ID
  }

  // 2. Derive from JWT_SECRET (stable across restarts)
  const jwtSecret = process.env.JWT_SECRET
  if (jwtSecret) {
    const hash = createHash('sha256').update(jwtSecret).digest('hex')
    return hash.substring(0, 8)
  }

  // 3. Fallback to random (dev/testing only)
  console.warn('[poi-nats] JWT_SECRET not set, using random instance ID (not stable across restarts)')
  return randomUUID().split('-')[0]
}

// ─── Default Configuration ───────────────────────────────────

const DEFAULT_RECONNECT = {
  maxAttempts: -1, // Infinite reconnect
  initialDelayMs: 250,
  maxDelayMs: 5000,
}

// ─── Configuration Loader ────────────────────────────────────

/**
 * Load POI NATS configuration from environment variables.
 *
 * Environment variables:
 * - POI_NATS_URL: NATS server URL (required to enable)
 * - POI_NATS_STREAM: JetStream stream name (default: AIS_STREAM)
 * - POI_NATS_SUBJECT: Subject filter for POI events (default: ais.ship.proximity.events)
 * - POI_NATS_INSTANCE_ID: Unique instance identifier (default: derived from JWT_SECRET)
 *
 * The consumer name is auto-generated as: shipment-tracking-poi-{instanceId}
 * This allows multiple self-hosted instances to each receive all messages independently.
 */
export function loadPoiNatsConfig(): PoiNatsConfig {
  const instanceId = generateInstanceId()
  const consumerName = `shipment-tracking-poi-${instanceId}`

  return {
    serverUrl: process.env.POI_NATS_URL || 'nats://localhost:4222',
    streamName: process.env.POI_NATS_STREAM || 'AIS_STREAM',
    subject: process.env.POI_NATS_SUBJECT || 'ais.ship.proximity.events',
    instanceId,
    consumerName,
    connectionName: `shipment-tracking-poi-${instanceId}`,
    reconnect: DEFAULT_RECONNECT,
  }
}

/**
 * Check if POI NATS integration is configured.
 *
 * Returns true only if POI_NATS_URL is explicitly set.
 * When not configured, the POI subscriber will be skipped.
 */
export function isPoiNatsConfigured(): boolean {
  return !!process.env.POI_NATS_URL
}

/**
 * Validate POI NATS configuration.
 *
 * @throws Error if configuration is invalid
 */
export function validatePoiNatsConfig(config: PoiNatsConfig): void {
  if (!config.serverUrl) {
    throw new Error('POI_NATS_URL is required')
  }

  if (!config.serverUrl.startsWith('nats://') && !config.serverUrl.startsWith('nats+tls://')) {
    throw new Error('POI_NATS_URL must start with nats:// or nats+tls://')
  }

  if (!config.subject) {
    throw new Error('POI_NATS_SUBJECT is required')
  }
}
