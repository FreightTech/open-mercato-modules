import { describe, it, expect, vi, afterEach } from 'vitest'
import { CoscoAdapter } from '../lib/adapters/cosco'

/**
 * COSCO equipmentReference mapping.
 *
 * CargoSmart carries the container number per event as a top-level `containerNumber`
 * (nested on the container as `containerNumber.containerNumber`). The service builds
 * one Shipment per unique `equipmentReference` on EQUIPMENT events (trackingService
 * auto-discovery), so an adapter that drops the container number yields events but
 * ZERO containers — nothing on the shipment-tracking page. Regression guard.
 *
 * TC-TRACK-COSCO-EQUIP-001 — adapter emits equipmentReference = CargoSmart containerNumber.
 * TC-TRACK-COSCO-EQUIP-002 — an EQUIPMENT event with a container survives discovery (≥1 container).
 */

const auth = { app_key: 'k', customer_id: 'c', scac_code: 'COSU' }

const CARGOSMART_RESPONSE = {
  shipmentContent: {
    queryCriteria: { bookingNumber: '6507384150' },
    billOfLadingNumber: ['6507384150'],
    containerDetail: [
      {
        // CargoSmart splits the ISO check digit into its own field (spec v2.0 p.27):
        // the canonical container number is `${containerNumber}${containerCheckDigit}`.
        containerNumber: { containerNumber: 'CSNU123456', containerCheckDigit: '7' },
        event: [
          {
            mode: 'Truck',
            CSEvent: { CSEventCode: 'CS010' },
            carrEventCode: 'EG',
            eventDescription: 'Empty equipment dispatched',
            eventDT: { GMT: { text: '2026-07-20T18:03:00Z' }, locDT: { text: '2026-07-21T01:03:00' } },
            location: { facility: { facilityCode: 'CHB85', facilityName: 'KCD (Thailand) LTD.' }, cityDetails: { city: 'Chon Buri' } },
          },
          {
            mode: 'Vessel',
            CSEvent: { CSEventCode: 'CS030' },
            carrEventCode: 'LD',
            eventDescription: 'Loaded on vessel',
            eventDT: { GMT: { text: '2026-07-24T06:00:00Z' }, locDT: { text: '2026-07-24T13:00:00' } },
            location: { facility: { facilityCode: 'THLCH', facilityName: 'Laem Chabang' }, cityDetails: { city: 'Laem Chabang' } },
          },
        ],
      },
    ],
  },
}

afterEach(() => vi.restoreAllMocks())

describe('CoscoAdapter equipmentReference mapping', () => {
  it('TC-TRACK-COSCO-EQUIP-001: emits equipmentReference from CargoSmart containerNumber', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CARGOSMART_RESPONSE,
      text: async () => '',
    })) as unknown as typeof fetch)

    const { events } = await new CoscoAdapter().fetchEvents({
      referenceType: 'booking',
      referenceValue: '6507384150',
      authConfig: auth,
    })

    expect(events.length).toBe(2)
    // Every event must carry the container number the page's discovery keys on.
    for (const e of events) {
      expect(e.equipmentReference).toBe('CSNU1234567')
    }
  })

  it('TC-TRACK-COSCO-EQUIP-002: ≥1 container is discoverable from EQUIPMENT events', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CARGOSMART_RESPONSE,
      text: async () => '',
    })) as unknown as typeof fetch)

    const { events } = await new CoscoAdapter().fetchEvents({
      referenceType: 'booking',
      referenceValue: '6507384150',
      authConfig: auth,
    })

    // Mirror trackingService container auto-discovery: unique equipmentReference on EQUIPMENT events.
    const containers = new Set(
      events.filter((e) => e.eventType === 'EQUIPMENT' && e.equipmentReference).map((e) => e.equipmentReference),
    )
    expect(containers.size).toBeGreaterThanOrEqual(1)
    expect(containers.has('CSNU1234567')).toBe(true)
  })
})
