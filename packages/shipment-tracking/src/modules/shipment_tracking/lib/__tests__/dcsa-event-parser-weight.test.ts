import { describe, it, expect } from 'vitest'
import { parseDcsaEvents } from '../dcsa-event-parser'

/** Minimal DCSA equipment event with arbitrary extra keys merged in. */
function equipmentEvent(extra: Record<string, unknown>) {
  return {
    eventType: 'EQUIPMENT',
    equipmentEventTypeCode: 'LOAD',
    eventDateTime: '2026-01-01T00:00:00Z',
    equipmentReference: 'MSNU1234567',
    ...extra,
  }
}

describe('parseDcsaEvents — cargo weight', () => {
  it('extracts MSC snake_case gross_weight / vgm_weight (number or numeric string)', () => {
    const [e] = parseDcsaEvents([equipmentEvent({ gross_weight: '27490', vgm_weight: 27490 })], 'MSC')
    expect(e.grossWeightKg).toBe(27490)
    expect(e.vgmKg).toBe(27490)
  })

  it('extracts Hapag-Lloyd PascalCase GrossWeight / VGMWeight', () => {
    const [e] = parseDcsaEvents([equipmentEvent({ GrossWeight: 27680, VGMWeight: '27680' })], 'HAPAG-LLOYD')
    expect(e.grossWeightKg).toBe(27680)
    expect(e.vgmKg).toBe(27680)
  })

  it('is null when the event carries no weight', () => {
    const [e] = parseDcsaEvents([equipmentEvent({})], 'MSC')
    expect(e.grossWeightKg).toBeNull()
    expect(e.vgmKg).toBeNull()
  })

  it('treats 0 and blank as "not declared" (null)', () => {
    const [e] = parseDcsaEvents([equipmentEvent({ gross_weight: '0', vgm_weight: '' })], 'MSC')
    expect(e.grossWeightKg).toBeNull()
    expect(e.vgmKg).toBeNull()
  })
})
