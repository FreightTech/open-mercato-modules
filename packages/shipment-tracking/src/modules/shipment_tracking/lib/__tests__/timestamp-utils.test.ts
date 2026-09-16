import {
  getLatestTimestamp,
  getPrimaryTimestampValue,
  getPrimaryTimestampOffset,
  createTimestampEntry,
  addTimestampEntry,
  mergeExtractedTimestamps,
  hasTimestamps,
  getTimestampsBySource,
  getTimestampHistory,
  type ShipmentTimestampEntry,
} from '../timestamp-utils'

describe('timestamp-utils', () => {
  describe('createTimestampEntry', () => {
    it('should create entry from Date', () => {
      const date = new Date('2026-02-24T15:30:00Z')
      const entry = createTimestampEntry(date, '+08:00', 'carrier_api', 'evt-123')

      expect(entry.value).toBe('2026-02-24T15:30:00.000Z')
      expect(entry.offset).toBe('+08:00')
      expect(entry.source).toBe('carrier_api')
      expect(entry.sourceEventId).toBe('evt-123')
      expect(entry.updatedAt).toBeDefined()
    })

    it('should create entry from ISO string', () => {
      const entry = createTimestampEntry('2026-02-24T15:30:00Z', null, 'manual')

      expect(entry.value).toBe('2026-02-24T15:30:00.000Z')
      expect(entry.offset).toBeNull()
      expect(entry.source).toBe('manual')
      expect(entry.sourceEventId).toBeNull()
    })
  })

  describe('getLatestTimestamp', () => {
    it('should return null for empty array', () => {
      expect(getLatestTimestamp([])).toBeNull()
      expect(getLatestTimestamp(null)).toBeNull()
      expect(getLatestTimestamp(undefined)).toBeNull()
    })

    it('should return single entry', () => {
      const entries: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T15:30:00Z', offset: '+08:00', source: 'carrier_api', updatedAt: '2026-02-18T10:00:00Z' },
      ]

      const result = getLatestTimestamp(entries)
      expect(result).not.toBeNull()
      expect(result!.value.toISOString()).toBe('2026-02-24T15:30:00.000Z')
      expect(result!.offset).toBe('+08:00')
      expect(result!.source).toBe('carrier_api')
    })

    it('should return entry with latest updatedAt', () => {
      const entries: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T10:00:00Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-17T10:00:00Z' },
        { value: '2026-02-24T15:30:00Z', offset: '+08:00', source: 'manual', updatedAt: '2026-02-18T12:00:00Z' },
        { value: '2026-02-24T12:00:00Z', offset: null, source: 'ais', updatedAt: '2026-02-18T08:00:00Z' },
      ]

      const result = getLatestTimestamp(entries)
      expect(result!.value.toISOString()).toBe('2026-02-24T15:30:00.000Z')
      expect(result!.source).toBe('manual')
    })
  })

  describe('getPrimaryTimestampValue', () => {
    it('should return Date from latest entry', () => {
      const entries: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T15:30:00Z', offset: '+08:00', source: 'carrier_api', updatedAt: '2026-02-18T10:00:00Z' },
      ]

      const result = getPrimaryTimestampValue(entries)
      expect(result).toBeInstanceOf(Date)
      expect(result!.toISOString()).toBe('2026-02-24T15:30:00.000Z')
    })

    it('should return null for empty', () => {
      expect(getPrimaryTimestampValue(null)).toBeNull()
    })
  })

  describe('getPrimaryTimestampOffset', () => {
    it('should return offset from latest entry', () => {
      const entries: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T15:30:00Z', offset: '+08:00', source: 'carrier_api', updatedAt: '2026-02-18T10:00:00Z' },
      ]

      expect(getPrimaryTimestampOffset(entries)).toBe('+08:00')
    })

    it('should return null for null offset', () => {
      const entries: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T15:30:00Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-18T10:00:00Z' },
      ]

      expect(getPrimaryTimestampOffset(entries)).toBeNull()
    })
  })

  describe('addTimestampEntry', () => {
    it('should add entry to empty array', () => {
      const entry = createTimestampEntry('2026-02-24T15:30:00Z', null, 'carrier_api')
      const result = addTimestampEntry(null, entry)

      expect(result).toHaveLength(1)
      expect(result[0]).toBe(entry)
    })

    it('should add entry to existing array', () => {
      const existing: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T10:00:00Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-17T10:00:00Z' },
      ]
      const entry = createTimestampEntry('2026-02-24T15:30:00Z', null, 'manual')
      const result = addTimestampEntry(existing, entry)

      expect(result).toHaveLength(2)
    })

    it('should dedupe by value+source', () => {
      const existing: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T15:30:00.000Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-17T10:00:00Z' },
      ]
      const entry = createTimestampEntry('2026-02-24T15:30:00Z', null, 'carrier_api')
      const result = addTimestampEntry(existing, entry)

      expect(result).toHaveLength(1) // Not added - duplicate
    })

    it('should allow same value from different source', () => {
      const existing: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T15:30:00.000Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-17T10:00:00Z' },
      ]
      const entry = createTimestampEntry('2026-02-24T15:30:00Z', null, 'manual')
      const result = addTimestampEntry(existing, entry)

      expect(result).toHaveLength(2) // Added - different source
    })

    it('should allow different value from same source (SCD pattern)', () => {
      const existing: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T10:00:00.000Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-17T10:00:00Z' },
      ]
      const entry = createTimestampEntry('2026-02-24T15:30:00Z', null, 'carrier_api')
      const result = addTimestampEntry(existing, entry)

      expect(result).toHaveLength(2) // Added - different value
    })
  })

  describe('mergeExtractedTimestamps', () => {
    it('should merge extracted times into empty arrays', () => {
      const result = mergeExtractedTimestamps(
        {},
        {
          etd: new Date('2026-02-20T10:00:00Z'),
          etdOffset: '+08:00',
          eta: new Date('2026-02-25T15:00:00Z'),
          etaOffset: '+01:00',
        },
        'carrier_api',
        'evt-123',
      )

      expect(result.changed).toBe(true)
      expect(result.etdTimestamps).toHaveLength(1)
      expect(result.etaTimestamps).toHaveLength(1)
      expect(result.atdTimestamps).toBeNull()
      expect(result.ataTimestamps).toBeNull()
    })

    it('should merge extracted times into existing arrays', () => {
      const existing = {
        etdTimestamps: [
          { value: '2026-02-20T08:00:00.000Z', offset: null, source: 'carrier_api' as const, updatedAt: '2026-02-17T10:00:00Z' },
        ],
      }

      const result = mergeExtractedTimestamps(
        existing,
        {
          etd: new Date('2026-02-20T12:00:00Z'),
          etdOffset: '+08:00',
        },
        'carrier_api',
        'evt-456',
      )

      expect(result.changed).toBe(true)
      expect(result.etdTimestamps).toHaveLength(2)
    })

    it('should not add duplicate times', () => {
      const existing = {
        etdTimestamps: [
          { value: '2026-02-20T10:00:00.000Z', offset: '+08:00', source: 'carrier_api' as const, updatedAt: '2026-02-17T10:00:00Z' },
        ],
      }

      const result = mergeExtractedTimestamps(
        existing,
        {
          etd: new Date('2026-02-20T10:00:00Z'),
          etdOffset: '+08:00',
        },
        'carrier_api',
      )

      expect(result.changed).toBe(false)
      expect(result.etdTimestamps).toHaveLength(1)
    })
  })

  describe('hasTimestamps', () => {
    it('should return false for empty/null', () => {
      expect(hasTimestamps(null)).toBe(false)
      expect(hasTimestamps(undefined)).toBe(false)
      expect(hasTimestamps([])).toBe(false)
    })

    it('should return true for non-empty array', () => {
      const entries: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T15:30:00Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-18T10:00:00Z' },
      ]
      expect(hasTimestamps(entries)).toBe(true)
    })
  })

  describe('getTimestampsBySource', () => {
    it('should filter by source', () => {
      const entries: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T10:00:00Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-17T10:00:00Z' },
        { value: '2026-02-24T12:00:00Z', offset: null, source: 'manual', updatedAt: '2026-02-17T12:00:00Z' },
        { value: '2026-02-24T14:00:00Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-17T14:00:00Z' },
      ]

      const result = getTimestampsBySource(entries, 'carrier_api')
      expect(result).toHaveLength(2)
      expect(result.every(e => e.source === 'carrier_api')).toBe(true)
    })
  })

  describe('getTimestampHistory', () => {
    it('should sort by updatedAt ascending', () => {
      const entries: ShipmentTimestampEntry[] = [
        { value: '2026-02-24T14:00:00Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-18T14:00:00Z' },
        { value: '2026-02-24T10:00:00Z', offset: null, source: 'carrier_api', updatedAt: '2026-02-18T10:00:00Z' },
        { value: '2026-02-24T12:00:00Z', offset: null, source: 'manual', updatedAt: '2026-02-18T12:00:00Z' },
      ]

      const result = getTimestampHistory(entries)
      expect(result).toHaveLength(3)
      expect(result[0].updatedAt).toBe('2026-02-18T10:00:00Z')
      expect(result[1].updatedAt).toBe('2026-02-18T12:00:00Z')
      expect(result[2].updatedAt).toBe('2026-02-18T14:00:00Z')
    })
  })
})
