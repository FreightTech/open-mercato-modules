import {
  mapDcsaEventToWebhookType,
  isSignificantMilestone,
  DCSA_EQUIPMENT_EVENT_CODES,
  DCSA_TRANSPORT_EVENT_CODES,
} from '../dcsa-event-mapping'
import { parseDcsaEvents } from '../dcsa-event-parser'
import { fixtures } from '../../__tests__/fixtures'

describe('dcsa-event-mapping', () => {
  describe('mapDcsaEventToWebhookType', () => {
    describe('TRANSPORT events', () => {
      it('should map DEPA ACT to transport.departed', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'TRANSPORT',
          eventCode: 'DEPA',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.transport.departed')
      })

      it('should map DEPA PLN to transport.etd_updated', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'TRANSPORT',
          eventCode: 'DEPA',
          eventClassifierCode: 'PLN',
        })
        expect(result).toBe('shipment_tracking.transport.etd_updated')
      })

      it('should map DEPA EST to transport.etd_updated', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'TRANSPORT',
          eventCode: 'DEPA',
          eventClassifierCode: 'EST',
        })
        expect(result).toBe('shipment_tracking.transport.etd_updated')
      })

      it('should map ARRI ACT to transport.arrived', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'TRANSPORT',
          eventCode: 'ARRI',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.transport.arrived')
      })

      it('should map ARRI PLN to transport.eta_updated', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'TRANSPORT',
          eventCode: 'ARRI',
          eventClassifierCode: 'PLN',
        })
        expect(result).toBe('shipment_tracking.transport.eta_updated')
      })

      it('should map ARRI EST to transport.eta_updated', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'TRANSPORT',
          eventCode: 'ARRI',
          eventClassifierCode: 'EST',
        })
        expect(result).toBe('shipment_tracking.transport.eta_updated')
      })

      it('should map OMIT to transport.omitted', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'TRANSPORT',
          eventCode: 'OMIT',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.transport.omitted')
      })
    })

    describe('EQUIPMENT events', () => {
      it('should map LOAD to equipment.loaded', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'LOAD',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.loaded')
      })

      it('should map DISC to equipment.discharged', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'DISC',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.discharged')
      })

      it('should map GTIN to equipment.gate_in', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'GTIN',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.gate_in')
      })

      it('should map GTOT to equipment.gate_out', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'GTOT',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.gate_out')
      })

      it('should map AVPU to equipment.available_pickup', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'AVPU',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.available_pickup')
      })

      it('should map CUSR to equipment.customs_released', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'CUSR',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.customs_released')
      })

      it('should map INSP to equipment.inspected', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'INSP',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.inspected')
      })

      it('should map CUSS/CUSI to equipment.inspected', () => {
        expect(
          mapDcsaEventToWebhookType({
            eventType: 'EQUIPMENT',
            eventCode: 'CUSS',
            eventClassifierCode: 'ACT',
          }),
        ).toBe('shipment_tracking.equipment.inspected')

        expect(
          mapDcsaEventToWebhookType({
            eventType: 'EQUIPMENT',
            eventCode: 'CUSI',
            eventClassifierCode: 'ACT',
          }),
        ).toBe('shipment_tracking.equipment.inspected')
      })

      it('should map DLVR ACT to shipment.delivered', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'DLVR',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.shipment.delivered')
      })

      it('should map PICK to equipment.gate_out', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'PICK',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.gate_out')
      })

      it('should map DROP to equipment.gate_in', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'DROP',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.gate_in')
      })

      it('should map CROS to equipment.discharged', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'CROS',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.discharged')
      })
    })

    describe('SHIPMENT events', () => {
      it('should map CONF to shipment.booked', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'SHIPMENT',
          eventCode: 'CONF',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.shipment.booked')
      })

      it('should map BOOK to shipment.booked', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'SHIPMENT',
          eventCode: 'BOOK',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.shipment.booked')
      })
    })

    describe('fallback behavior', () => {
      it('should return generic event for unknown codes', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'UNKNOWN',
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.tracking_event.created')
      })

      it('should return generic event for STUF/STRP', () => {
        expect(
          mapDcsaEventToWebhookType({
            eventType: 'EQUIPMENT',
            eventCode: 'STUF',
            eventClassifierCode: 'ACT',
          }),
        ).toBe('shipment_tracking.tracking_event.created')

        expect(
          mapDcsaEventToWebhookType({
            eventType: 'EQUIPMENT',
            eventCode: 'STRP',
            eventClassifierCode: 'ACT',
          }),
        ).toBe('shipment_tracking.tracking_event.created')
      })

      it('should handle case-insensitive event codes', () => {
        const result = mapDcsaEventToWebhookType({
          eventType: 'EQUIPMENT',
          eventCode: 'load', // lowercase
          eventClassifierCode: 'ACT',
        })
        expect(result).toBe('shipment_tracking.equipment.loaded')
      })
    })
  })

  describe('isSignificantMilestone', () => {
    it('should return true for LOAD', () => {
      expect(
        isSignificantMilestone({
          eventType: 'EQUIPMENT',
          eventCode: 'LOAD',
          eventClassifierCode: 'ACT',
        }),
      ).toBe(true)
    })

    it('should return true for DISC', () => {
      expect(
        isSignificantMilestone({
          eventType: 'EQUIPMENT',
          eventCode: 'DISC',
          eventClassifierCode: 'ACT',
        }),
      ).toBe(true)
    })

    it('should return true for DEPA ACT', () => {
      expect(
        isSignificantMilestone({
          eventType: 'TRANSPORT',
          eventCode: 'DEPA',
          eventClassifierCode: 'ACT',
        }),
      ).toBe(true)
    })

    it('should return true for ARRI ACT', () => {
      expect(
        isSignificantMilestone({
          eventType: 'TRANSPORT',
          eventCode: 'ARRI',
          eventClassifierCode: 'ACT',
        }),
      ).toBe(true)
    })

    it('should return false for STUF', () => {
      expect(
        isSignificantMilestone({
          eventType: 'EQUIPMENT',
          eventCode: 'STUF',
          eventClassifierCode: 'ACT',
        }),
      ).toBe(false)
    })

    it('should return false for unknown codes', () => {
      expect(
        isSignificantMilestone({
          eventType: 'EQUIPMENT',
          eventCode: 'UNKNOWN',
          eventClassifierCode: 'ACT',
        }),
      ).toBe(false)
    })
  })

  describe('with real MSC fixtures', () => {
    it('should map all direct voyage events to significant milestones', () => {
      const parsed = parseDcsaEvents(fixtures.direct.events, 'MSC')
      const milestones = parsed.filter((e) =>
        isSignificantMilestone({
          eventType: e.eventType,
          eventCode: e.eventCode,
          eventClassifierCode: e.eventClassifierCode,
        }),
      )

      // Direct voyage has: GTOT, GTIN, LOAD, DEPA, ARRI(EST)
      // Significant: GTOT (gate_out), GTIN (gate_in), LOAD (loaded), DEPA (departed/etd)
      expect(milestones.length).toBeGreaterThanOrEqual(4)

      const eventTypes = milestones.map((e) =>
        mapDcsaEventToWebhookType({
          eventType: e.eventType,
          eventCode: e.eventCode,
          eventClassifierCode: e.eventClassifierCode,
        }),
      )

      expect(eventTypes).toContain('shipment_tracking.equipment.loaded')
      expect(eventTypes).toContain('shipment_tracking.equipment.gate_in')
      expect(eventTypes).toContain('shipment_tracking.equipment.gate_out')
      expect(eventTypes).toContain('shipment_tracking.transport.departed')
    })

    it('should map transshipment events correctly', () => {
      const parsed = parseDcsaEvents(fixtures.transshipment.events, 'MSC')

      // Find discharge at transship port
      const discEvent = parsed.find(
        (e) => e.eventCode === 'DISC' && e.locationUnlocode === 'CNNGB',
      )
      expect(discEvent).toBeDefined()

      const discEventType = mapDcsaEventToWebhookType({
        eventType: discEvent!.eventType,
        eventCode: discEvent!.eventCode,
        eventClassifierCode: discEvent!.eventClassifierCode,
      })
      expect(discEventType).toBe('shipment_tracking.equipment.discharged')

      // Should have 2 LOAD events (origin + transship)
      const loadEvents = parsed.filter((e) => e.eventCode === 'LOAD')
      expect(loadEvents).toHaveLength(2)
    })
  })

  describe('DCSA code constants', () => {
    it('should have all equipment event codes documented', () => {
      expect(DCSA_EQUIPMENT_EVENT_CODES.LOAD).toBeDefined()
      expect(DCSA_EQUIPMENT_EVENT_CODES.DISC).toBeDefined()
      expect(DCSA_EQUIPMENT_EVENT_CODES.GTIN).toBeDefined()
      expect(DCSA_EQUIPMENT_EVENT_CODES.GTOT).toBeDefined()
      expect(DCSA_EQUIPMENT_EVENT_CODES.AVPU).toBeDefined()
      expect(DCSA_EQUIPMENT_EVENT_CODES.CUSR).toBeDefined()
      expect(DCSA_EQUIPMENT_EVENT_CODES.DLVR).toBeDefined()
    })

    it('should have all transport event codes documented', () => {
      expect(DCSA_TRANSPORT_EVENT_CODES.ARRI).toBeDefined()
      expect(DCSA_TRANSPORT_EVENT_CODES.DEPA).toBeDefined()
      expect(DCSA_TRANSPORT_EVENT_CODES.OMIT).toBeDefined()
    })
  })
})
