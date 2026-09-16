import { describe, it, expect } from 'vitest'
import { mapAirShipmentToEvents } from '../lib/shipsgo-mapper'
import { deriveAirShipmentStatus } from '../lib/status-machine'
import type { ShipsGoAirShipment } from '../lib/shipsgo-client'

/**
 * TC-TRACK-415 — ShipsGo air movement mapping + air status machine.
 *
 * Air has no container/vessel model: mapAirShipmentToEvents emits one TRANSPORT
 * event per movement (DEP→DEPA, ARR→ARRI so shared time-extraction fills
 * ATD/ATA) and carries AWB/flight/airline + the ShipsGo top-level status on the
 * result. deriveAirShipmentStatus maps that top-level status forward-only.
 */

function airShipment(overrides: Partial<ShipsGoAirShipment> = {}): ShipsGoAirShipment {
  return {
    id: 55555,
    reference: 'job-air',
    awb_number: '020-12345678',
    airline: { iata: 'LH', name: 'Lufthansa' },
    status: 'EN_ROUTE',
    movements: [
      { event: 'RCS', status: 'ACT', location: { iata: 'WAW', name: 'Warsaw', country: { code: 'PL', name: 'Poland' } }, flight: null, timestamp: '2026-08-01T08:00:00Z' },
      { event: 'DEP', status: 'ACT', location: { iata: 'WAW', name: 'Warsaw', country: { code: 'PL', name: 'Poland' } }, flight: 'LH1234', timestamp: '2026-08-01T12:00:00Z' },
      { event: 'ARR', status: 'EST', location: { iata: 'JFK', name: 'New York', country: { code: 'US', name: 'United States' } }, flight: 'LH1234', timestamp: '2026-08-01T20:00:00Z' },
    ],
    ...overrides,
  }
}

describe('mapAirShipmentToEvents', () => {
  it('maps air movements to transport events and carries AWB/flight/airline', () => {
    const result = mapAirShipmentToEvents(airShipment())

    expect(result.events).toHaveLength(3)
    for (const e of result.events) {
      expect(e.source).toBe('shipsgo')
      expect(e.eventType).toBe('TRANSPORT')
    }
    // DEP→DEPA, ARR→ARRI so the shared time-extraction fills ATD/ATA/ETA.
    const codes = result.events.map((e) => e.eventCode)
    expect(codes).toContain('DEPA')
    expect(codes).toContain('ARRI')
    expect(codes).toContain('RCS')

    expect(result.awbNumber).toBe('020-12345678')
    expect(result.airlineCode).toBe('LH')
    expect(result.airlineName).toBe('Lufthansa')
    expect(result.flightNumber).toBe('LH1234') // latest flight seen
    expect(result.airStatus).toBe('EN_ROUTE')
    expect(result.containerNumber).toBeNull()
  })

  it('persists the local UTC offset from the ShipsGo timestamp (eventDateTimeOffset)', () => {
    const result = mapAirShipmentToEvents(
      airShipment({
        movements: [
          { event: 'DEP', status: 'EST', location: { iata: 'PEK', name: 'Beijing' }, flight: 'CA841', timestamp: '2026-09-09T02:55:00+08:00' },
          { event: 'ARR', status: 'EST', location: { iata: 'VIE', name: 'Vienna' }, flight: 'CA841', timestamp: '2026-09-09T06:50:00+02:00' },
          { event: 'RCS', status: 'ACT', location: { iata: 'FRA', name: 'Frankfurt' }, flight: null, timestamp: '2026-09-08T10:00:00Z' },
        ],
      }),
    )
    const byCode = Object.fromEntries(result.events.map((e) => [e.eventCode, e]))
    expect(byCode['DEPA'].eventDateTimeOffset).toBe('+08:00')
    expect(byCode['ARRI'].eventDateTimeOffset).toBe('+02:00')
    // Z / UTC → null (already the default)
    expect(byCode['RCS'].eventDateTimeOffset).toBeNull()
    // The stored instant is still the correct UTC moment regardless of offset.
    expect(byCode['DEPA'].eventDateTime.toISOString()).toBe('2026-09-08T18:55:00.000Z')
  })

  it('flags AIR mode of transport on flight-bearing movements', () => {
    const result = mapAirShipmentToEvents(airShipment())
    const dep = result.events.find((e) => e.eventCode === 'DEPA')!
    expect(dep.modeOfTransport).toBe('AIR')
    expect(dep.eventClassifierCode).toBe('ACT')
    const arr = result.events.find((e) => e.eventCode === 'ARRI')!
    expect(arr.eventClassifierCode).toBe('EST')
  })

  it('produces deterministic ids and skips unknown/invalid movements', () => {
    const s = airShipment({
      movements: [
        { event: 'XXX', status: 'ACT', timestamp: '2026-08-01T10:00:00Z' },
        { event: 'DEP', status: 'ACT', timestamp: 'not-a-date' },
        { event: 'DLV', status: 'ACT', timestamp: '2026-08-02T10:00:00Z' },
      ],
    })
    const a = mapAirShipmentToEvents(s)
    const b = mapAirShipmentToEvents(s)
    expect(a.events).toHaveLength(1)
    expect(a.events[0].eventCode).toBe('DLVR')
    expect(a.events.map((e) => e.sourceEventId)).toEqual(b.events.map((e) => e.sourceEventId))
  })

  it('handles a shipment with no movements', () => {
    const result = mapAirShipmentToEvents(airShipment({ movements: [], status: 'BOOKED' }))
    expect(result.events).toEqual([])
    expect(result.airStatus).toBe('BOOKED')
  })

  it('captures cargo (pieces/weight/volume) + status_extended into extra', () => {
    const result = mapAirShipmentToEvents(
      airShipment({
        cargo: { pieces: 12, weight: 340.5, weight_unit: 'kg', volume: 2.1, volume_unit: 'm3' },
        status_extended: { EN_ROUTE: 12 },
      }),
    )
    const extra = result.extra as any
    expect(extra.shipsgoAir.cargo).toEqual({ pieces: 12, weight: 340.5, weightUnit: 'kg', volume: 2.1, volumeUnit: 'm3' })
    expect(extra.shipsgoAir.statusExtended).toEqual({ EN_ROUTE: 12 })
  })

  it('captures the air route (origin/destination airports + transit/CO2) into extra', () => {
    const result = mapAirShipmentToEvents(
      airShipment({
        route: {
          origin: { location: { iata: 'PEK', name: 'Beijing Capital' }, date_of_dep: '2026-09-09T02:55:00+08:00' },
          destination: { location: { iata: 'VIE', name: 'Vienna' }, date_of_rcf: '2026-09-09T06:50:00+02:00' },
          transit_time: 10,
          transit_percentage: 0,
          co2_emission: 1.61,
          ts_count: 0,
        },
      }),
    )
    const extra = result.extra as any
    expect(extra.shipsgoAir.route).toMatchObject({
      origin: { iata: 'PEK', name: 'Beijing Capital' },
      destination: { iata: 'VIE', name: 'Vienna' },
      transitTimeDays: 10,
      co2Emission: 1.61,
      transshipmentCount: 0,
    })
  })

  it('leaves extra null when no cargo, route or status_extended', () => {
    expect(mapAirShipmentToEvents(airShipment()).extra).toBeNull()
  })
})

describe('deriveAirShipmentStatus', () => {
  it('maps ShipsGo top-level status onto the internal enum', () => {
    expect(deriveAirShipmentStatus('BOOKED', 'PENDING')).toBe('BOOKED')
    expect(deriveAirShipmentStatus('EN_ROUTE', 'BOOKED')).toBe('IN_TRANSIT')
    expect(deriveAirShipmentStatus('LANDED', 'IN_TRANSIT')).toBe('ARRIVED')
    expect(deriveAirShipmentStatus('DELIVERED', 'ARRIVED')).toBe('DELIVERED')
  })

  it('never downgrades and ignores unknown/empty status', () => {
    expect(deriveAirShipmentStatus('BOOKED', 'IN_TRANSIT')).toBe('IN_TRANSIT')
    expect(deriveAirShipmentStatus('UNTRACKED', 'IN_TRANSIT')).toBe('IN_TRANSIT')
    expect(deriveAirShipmentStatus(null, 'BOOKED')).toBe('BOOKED')
    expect(deriveAirShipmentStatus('WHatever', 'BOOKED')).toBe('BOOKED')
  })
})
