import { describe, it, expect } from 'vitest'
import { mapOceanShipmentToEvents } from '../lib/shipsgo-mapper'
import type { ShipsGoOceanShipment } from '../lib/shipsgo-client'

/**
 * TC-TRACK-411 — ShipsGo ocean movement mapping.
 *
 * Verifies mapOceanShipmentToEvents translates ShipsGo movements onto the
 * internal DCSA-style event vocabulary the downstream pipeline understands.
 */

function shipment(overrides: Partial<ShipsGoOceanShipment> = {}): ShipsGoOceanShipment {
  return {
    id: 12345,
    reference: 'job-abc',
    booking_number: 'MEDUQY000000',
    container_number: 'MSCU1234567',
    carrier: { scac: 'MSCU', name: 'MSC', status: 'active' },
    status: 'SAILING',
    containers: [
      {
        number: 'MSCU1234567',
        status: 'SAILING',
        size: 40,
        type: '45G1',
        movements: [
          {
            event: 'GTIN',
            status: 'ACT',
            location: { code: 'PLGDN', name: 'Gdańsk', country: { code: 'PL', name: 'Poland' } },
            vessel: null,
            voyage: null,
            timestamp: '2026-08-01T10:00:00Z',
          },
          {
            event: 'LOAD',
            status: 'ACT',
            location: { code: 'PLGDN', name: 'Gdańsk', country: { code: 'PL', name: 'Poland' } },
            vessel: { imo: 9839179, name: 'MSC GULSUN' },
            voyage: 'FL512A',
            timestamp: '2026-08-02T12:00:00Z',
          },
          {
            event: 'DEPA',
            status: 'ACT',
            location: { code: 'PLGDN', name: 'Gdańsk', country: { code: 'PL', name: 'Poland' } },
            vessel: { imo: 9839179, name: 'MSC GULSUN' },
            voyage: 'FL512A',
            timestamp: '2026-08-02T18:00:00Z',
          },
          {
            event: 'ARRV',
            status: 'EST',
            location: { code: 'NLRTM', name: 'Rotterdam', country: { code: 'NL', name: 'Netherlands' } },
            vessel: { imo: 9839179, name: 'MSC GULSUN' },
            voyage: 'FL512A',
            timestamp: '2026-08-20T06:00:00Z',
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe('mapOceanShipmentToEvents', () => {
  it('maps ocean movement codes onto the DCSA vocabulary with equipment reference', () => {
    const result = mapOceanShipmentToEvents(shipment())

    expect(result.events).toHaveLength(4)
    const byCode = Object.fromEntries(result.events.map((e) => [e.eventCode, e]))

    expect(byCode.GTIN.eventType).toBe('EQUIPMENT')
    expect(byCode.LOAD.eventType).toBe('EQUIPMENT')
    expect(byCode.DEPA.eventType).toBe('TRANSPORT')
    // ShipsGo ARRV → DCSA ARRI (transport arrival)
    expect(byCode.ARRI.eventType).toBe('TRANSPORT')

    for (const e of result.events) {
      expect(e.source).toBe('shipsgo')
      expect(e.equipmentReference).toBe('MSCU1234567')
    }
  })

  it('maps ShipsGo status EST/ACT onto the event classifier', () => {
    const result = mapOceanShipmentToEvents(shipment())
    const arri = result.events.find((e) => e.eventCode === 'ARRI')!
    const gtin = result.events.find((e) => e.eventCode === 'GTIN')!
    expect(arri.eventClassifierCode).toBe('EST')
    expect(gtin.eventClassifierCode).toBe('ACT')
  })

  it('extracts vessel + location details from movements', () => {
    const result = mapOceanShipmentToEvents(shipment())
    const depa = result.events.find((e) => e.eventCode === 'DEPA')!
    expect(depa.vesselName).toBe('MSC GULSUN')
    expect(depa.vesselImo).toBe('9839179')
    expect(depa.voyageNumber).toBe('FL512A')
    expect(depa.modeOfTransport).toBe('VESSEL')
    expect(depa.locationUnlocode).toBe('PLGDN')
    expect(depa.locationCountry).toBe('PL')
    // Result carries the latest vessel + top-level references
    expect(result.vesselName).toBe('MSC GULSUN')
    expect(result.vesselImo).toBe('9839179')
    expect(result.containerNumber).toBe('MSCU1234567')
    expect(result.bookingNumber).toBe('MEDUQY000000')
  })

  it('persists the local UTC offset from the ShipsGo timestamp (eventDateTimeOffset)', () => {
    const s = shipment({
      containers: [
        {
          number: 'MSCU1234567',
          status: 'SAILING',
          movements: [
            { event: 'LOAD', status: 'ACT', location: { code: 'CNYTN', name: 'Yantian' }, vessel: null, voyage: null, timestamp: '2026-07-29T12:00:00+08:00' },
            { event: 'DISC', status: 'ACT', location: { code: 'PLGDN', name: 'Gdańsk' }, vessel: null, voyage: null, timestamp: '2026-09-07T10:00:00Z' },
          ],
        },
      ],
    })
    const byCode = Object.fromEntries(mapOceanShipmentToEvents(s).events.map((e) => [e.eventCode, e]))
    expect(byCode['LOAD'].eventDateTimeOffset).toBe('+08:00')
    expect(byCode['DISC'].eventDateTimeOffset).toBeNull() // Z / UTC
  })

  it('maps container size + type onto isoEquipmentCode (readable equipment code)', () => {
    const s = shipment({
      containers: [
        {
          number: 'CSGU6009557',
          status: 'DISCHARGED',
          size: 40,
          type: 'HC',
          movements: [
            { event: 'LOAD', status: 'ACT', location: { code: 'CNYTN', name: 'Yantian' }, vessel: null, voyage: null, timestamp: '2026-07-29T04:00:00Z' },
          ],
        },
      ],
    })
    const result = mapOceanShipmentToEvents(s)
    expect(result.events[0].isoEquipmentCode).toBe('40HC')
  })

  it('captures the ShipsGo route summary into extra (POL/POD, transit, CO2)', () => {
    const s = shipment({
      route: {
        port_of_loading: { location: { code: 'CNYTN', name: 'YANTIAN (SHENZHEN)' }, date_of_loading: '2026-07-29T12:00:00+08:00' },
        port_of_discharge: { location: { code: 'PLGDN', name: 'GDANSK' }, date_of_discharge: '2026-09-07T12:00:00+02:00', date_of_discharge_predicted: null },
        transit_time: 40,
        transit_percentage: 100,
        co2_emission: 63.08,
        ts_count: 0,
      },
    })
    const extra = mapOceanShipmentToEvents(s).extra as any
    expect(extra.shipsgoRoute.portOfLoading).toEqual({ unlocode: 'CNYTN', name: 'YANTIAN (SHENZHEN)' })
    expect(extra.shipsgoRoute.portOfDischarge).toEqual({ unlocode: 'PLGDN', name: 'GDANSK' })
    expect(extra.shipsgoRoute.transitTimeDays).toBe(40)
    expect(extra.shipsgoRoute.co2Emission).toBe(63.08)
    expect(extra.shipsgoRoute.transshipmentCount).toBe(0)
  })

  it('leaves extra null when the shipment has no route', () => {
    expect(mapOceanShipmentToEvents(shipment()).extra).toBeNull()
  })

  it('produces deterministic, unique source event ids for dedup', () => {
    const a = mapOceanShipmentToEvents(shipment())
    const b = mapOceanShipmentToEvents(shipment())
    const idsA = a.events.map((e) => e.sourceEventId)
    const idsB = b.events.map((e) => e.sourceEventId)
    expect(idsA).toEqual(idsB) // deterministic across polls
    expect(new Set(idsA).size).toBe(idsA.length) // unique within a poll
  })

  it('skips unknown event codes and invalid timestamps', () => {
    const s = shipment({
      containers: [
        {
          number: 'MSCU7654321',
          movements: [
            { event: 'XXXX', status: 'ACT', timestamp: '2026-08-01T10:00:00Z' },
            { event: 'GTIN', status: 'ACT', timestamp: 'not-a-date' },
            { event: 'DISC', status: 'ACT', timestamp: '2026-08-21T10:00:00Z' },
          ],
        },
      ],
    })
    const result = mapOceanShipmentToEvents(s)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].eventCode).toBe('DISC')
    expect(result.events[0].equipmentReference).toBe('MSCU7654321')
  })

  it('handles a shipment with no containers', () => {
    const result = mapOceanShipmentToEvents(shipment({ containers: [], container_number: null }))
    expect(result.events).toEqual([])
    expect(result.containerNumber).toBeNull()
  })
})
