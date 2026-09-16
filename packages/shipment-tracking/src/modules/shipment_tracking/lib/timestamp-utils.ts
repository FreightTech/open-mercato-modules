/**
 * Multi-source timestamp utilities for shipment tracking.
 *
 * Supports tracking ETD/ETA/ATD/ATA from multiple sources with full history (SCD pattern).
 * Primary value is computed using "latest update wins" strategy.
 */

export type TimestampSource = 'carrier_api' | 'manual' | 'ais' | 'port' | 'edi'

export type TimestampType = 'ETD' | 'ETA' | 'ATD' | 'ATA'

/**
 * A single timestamp entry tracking value, source, and when it was recorded.
 * Multiple entries per source are allowed (SCD - Slowly Changing Dimension pattern).
 */
export type ShipmentTimestampEntry = {
  /** ISO 8601 datetime value (e.g., "2026-02-24T15:30:00") */
  value: string
  /** Original timezone offset (e.g., "+08:00", "-05:00", "Z") */
  offset: string | null
  /** Source system that provided this timestamp */
  source: TimestampSource
  /** When this entry was recorded/updated (ISO 8601) */
  updatedAt: string
  /** Optional reference to the source tracking event ID */
  sourceEventId?: string | null
}

/**
 * Computed primary timestamp with its metadata.
 */
export type ComputedTimestamp = {
  value: Date
  offset: string | null
  source: TimestampSource
  updatedAt: Date
  sourceEventId?: string | null
}

/**
 * Gets the latest (primary) timestamp from an array of entries.
 * Uses "latest update wins" strategy - the entry with most recent updatedAt is primary.
 *
 * @param entries Array of timestamp entries or null/undefined
 * @returns The latest entry or null if no entries
 */
export function getLatestTimestamp(
  entries: ShipmentTimestampEntry[] | null | undefined,
): ComputedTimestamp | null {
  if (!entries?.length) return null

  // Use >= to prefer later entries when updatedAt is equal.
  // This handles the case where entries are added in the same millisecond.
  const latest = entries.reduce((best, entry) =>
    entry.updatedAt >= best.updatedAt ? entry : best,
  )

  return {
    value: new Date(latest.value),
    offset: latest.offset,
    source: latest.source,
    updatedAt: new Date(latest.updatedAt),
    sourceEventId: latest.sourceEventId,
  }
}

/**
 * Gets the primary value as a Date, or null if no entries.
 * Convenience wrapper around getLatestTimestamp.
 */
export function getPrimaryTimestampValue(
  entries: ShipmentTimestampEntry[] | null | undefined,
): Date | null {
  return getLatestTimestamp(entries)?.value ?? null
}

/**
 * Gets the primary offset, or null if no entries.
 */
export function getPrimaryTimestampOffset(
  entries: ShipmentTimestampEntry[] | null | undefined,
): string | null {
  return getLatestTimestamp(entries)?.offset ?? null
}

/**
 * Creates a new timestamp entry.
 *
 * @param value The timestamp value (Date or ISO string)
 * @param offset Timezone offset string (e.g., "+08:00") or null
 * @param source Source system
 * @param sourceEventId Optional source event ID for traceability
 * @returns A new ShipmentTimestampEntry
 */
export function createTimestampEntry(
  value: Date | string,
  offset: string | null,
  source: TimestampSource,
  sourceEventId?: string | null,
): ShipmentTimestampEntry {
  const dateValue = typeof value === 'string' ? new Date(value) : value

  return {
    value: dateValue.toISOString(),
    offset,
    source,
    updatedAt: new Date().toISOString(),
    sourceEventId: sourceEventId ?? null,
  }
}

/**
 * Adds a timestamp entry to an array with time-based deduplication.
 * Deduplication: if an entry with the same value+source exists, it won't be added.
 * Multiple entries per source with different values ARE allowed (SCD pattern).
 *
 * @param entries Existing entries array (will be mutated) or null
 * @param newEntry Entry to add
 * @returns The updated array (creates new array if input was null)
 */
export function addTimestampEntry(
  entries: ShipmentTimestampEntry[] | null | undefined,
  newEntry: ShipmentTimestampEntry,
): ShipmentTimestampEntry[] {
  const result = entries ? [...entries] : []

  // Dedupe: check if exact same value+source combo already exists
  const isDuplicate = result.some(
    (e) => e.value === newEntry.value && e.source === newEntry.source,
  )

  if (!isDuplicate) {
    result.push(newEntry)
  }

  return result
}

/**
 * Merges extracted times into existing timestamp arrays.
 * Used when processing tracking events to update shipment timestamps.
 *
 * @param current Current timestamp arrays from shipment
 * @param extracted Newly extracted timestamps from events
 * @param source Source of the extracted timestamps
 * @param sourceEventId Optional source event ID
 * @returns Updated timestamp arrays
 */
export function mergeExtractedTimestamps(
  current: {
    etdTimestamps?: ShipmentTimestampEntry[] | null
    etaTimestamps?: ShipmentTimestampEntry[] | null
    atdTimestamps?: ShipmentTimestampEntry[] | null
    ataTimestamps?: ShipmentTimestampEntry[] | null
  },
  extracted: {
    etd?: Date | null
    etdOffset?: string | null
    eta?: Date | null
    etaOffset?: string | null
    atd?: Date | null
    atdOffset?: string | null
    ata?: Date | null
    ataOffset?: string | null
  },
  source: TimestampSource,
  sourceEventId?: string | null,
): {
  etdTimestamps: ShipmentTimestampEntry[] | null
  etaTimestamps: ShipmentTimestampEntry[] | null
  atdTimestamps: ShipmentTimestampEntry[] | null
  ataTimestamps: ShipmentTimestampEntry[] | null
  changed: boolean
} {
  let changed = false
  let etdTimestamps = current.etdTimestamps ?? null
  let etaTimestamps = current.etaTimestamps ?? null
  let atdTimestamps = current.atdTimestamps ?? null
  let ataTimestamps = current.ataTimestamps ?? null

  if (extracted.etd) {
    const entry = createTimestampEntry(extracted.etd, extracted.etdOffset ?? null, source, sourceEventId)
    const before = etdTimestamps?.length ?? 0
    etdTimestamps = addTimestampEntry(etdTimestamps, entry)
    if ((etdTimestamps?.length ?? 0) > before) changed = true
  }

  if (extracted.eta) {
    const entry = createTimestampEntry(extracted.eta, extracted.etaOffset ?? null, source, sourceEventId)
    const before = etaTimestamps?.length ?? 0
    etaTimestamps = addTimestampEntry(etaTimestamps, entry)
    if ((etaTimestamps?.length ?? 0) > before) changed = true
  }

  if (extracted.atd) {
    const entry = createTimestampEntry(extracted.atd, extracted.atdOffset ?? null, source, sourceEventId)
    const before = atdTimestamps?.length ?? 0
    atdTimestamps = addTimestampEntry(atdTimestamps, entry)
    if ((atdTimestamps?.length ?? 0) > before) changed = true
  }

  if (extracted.ata) {
    const entry = createTimestampEntry(extracted.ata, extracted.ataOffset ?? null, source, sourceEventId)
    const before = ataTimestamps?.length ?? 0
    ataTimestamps = addTimestampEntry(ataTimestamps, entry)
    if ((ataTimestamps?.length ?? 0) > before) changed = true
  }

  return {
    etdTimestamps,
    etaTimestamps,
    atdTimestamps,
    ataTimestamps,
    changed,
  }
}

/**
 * Checks if a timestamp array has any entries.
 */
export function hasTimestamps(entries: ShipmentTimestampEntry[] | null | undefined): boolean {
  return !!entries && entries.length > 0
}

/**
 * Gets all timestamps from a specific source.
 */
export function getTimestampsBySource(
  entries: ShipmentTimestampEntry[] | null | undefined,
  source: TimestampSource,
): ShipmentTimestampEntry[] {
  if (!entries) return []
  return entries.filter((e) => e.source === source)
}

/**
 * Gets the history of timestamp changes, sorted by updatedAt (oldest first).
 */
export function getTimestampHistory(
  entries: ShipmentTimestampEntry[] | null | undefined,
): ShipmentTimestampEntry[] {
  if (!entries) return []
  return [...entries].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}
