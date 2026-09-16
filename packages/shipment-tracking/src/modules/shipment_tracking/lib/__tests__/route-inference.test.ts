import { inferRouteFromEvents, isValidUnlocode } from '../route-inference'
import { parseDcsaEvents } from '../dcsa-event-parser'
import { fixtures } from '../../__tests__/fixtures'

describe('Route Inference', () => {
  describe('inferRouteFromEvents', () => {
    it('should return null values for empty events array', () => {
      const result = inferRouteFromEvents([])

      expect(result.originUnlocode).toBeNull()
      expect(result.destinationUnlocode).toBeNull()
      expect(result.confidence.origin).toBeNull()
      expect(result.confidence.destination).toBeNull()
    })

    describe('Direct voyage (CNYTN -> PLGDN)', () => {
      it('should infer destination from EST ARRI event', () => {
        const events = parseDcsaEvents(fixtures.direct.events, 'MSC')
        const result = inferRouteFromEvents(events)

        expect(result.destinationUnlocode).toBe('PLGDN')
        expect(result.confidence.destination).toBe('high')
      })

      it('should infer origin from first DEPA with exportVoyageNumber', () => {
        const events = parseDcsaEvents(fixtures.direct.events, 'MSC')
        const result = inferRouteFromEvents(events)

        expect(result.originUnlocode).toBe('CNYTN')
        expect(result.confidence.origin).toBe('high')
      })

      it('should match expected route from fixture metadata', () => {
        const events = parseDcsaEvents(fixtures.direct.events, 'MSC')
        const result = inferRouteFromEvents(events)

        expect(result.originUnlocode).toBe(fixtures.direct.origin)
        expect(result.destinationUnlocode).toBe(fixtures.direct.destination)
      })
    })

    describe('Transshipment voyage (CNTAO -> CNNGB -> PLGDN)', () => {
      it('should infer origin from first LOAD at port of loading', () => {
        const events = parseDcsaEvents(fixtures.transshipment.events, 'MSC')
        const result = inferRouteFromEvents(events)

        // Origin should be first port of loading, not transshipment port
        expect(result.originUnlocode).toBe(fixtures.transshipment.origin)
        expect(result.confidence.origin).toBe('high')
      })

      it('should infer destination correctly', () => {
        const events = parseDcsaEvents(fixtures.transshipment.events, 'MSC')
        const result = inferRouteFromEvents(events)

        expect(result.destinationUnlocode).toBe(fixtures.transshipment.destination)
      })
    })

    describe('Completed multi-container transshipment (CRMOB -> BEANR -> PLGDY)', () => {
      it('should infer destination from last ACT ARRI when no EST events', () => {
        const events = parseDcsaEvents(fixtures.multiTransshipCompleted.events, 'MSC')
        const result = inferRouteFromEvents(events)

        // This is a completed voyage - no EST events, should use last ACT ARRI
        expect(result.destinationUnlocode).toBe('PLGDY')
        expect(result.confidence.destination).toBe('high')
      })

      it('should infer origin from first DEPA with exportVoyageNumber', () => {
        const events = parseDcsaEvents(fixtures.multiTransshipCompleted.events, 'MSC')
        const result = inferRouteFromEvents(events)

        // Origin should be CRMOB (port of loading), not CRCAR (inland depot)
        expect(result.originUnlocode).toBe('CRMOB')
        expect(result.confidence.origin).toBe('high')
      })

      it('should match expected route from fixture metadata', () => {
        const events = parseDcsaEvents(fixtures.multiTransshipCompleted.events, 'MSC')
        const result = inferRouteFromEvents(events)

        expect(result.originUnlocode).toBe(fixtures.multiTransshipCompleted.origin)
        expect(result.destinationUnlocode).toBe(fixtures.multiTransshipCompleted.destination)
      })
    })

    describe('Multi-container booking (32 containers)', () => {
      it('should infer route correctly for large booking', () => {
        const events = parseDcsaEvents(fixtures.multiContainer.events, 'MSC')
        const result = inferRouteFromEvents(events)

        // Note: The fixture metadata says CNYTN but actual events show CNDLC (Dalian)
        // The inference correctly identifies the actual port of loading from events
        expect(result.originUnlocode).toBe('CNDLC')
        expect(result.destinationUnlocode).toBe(fixtures.multiContainer.destination)
        expect(result.confidence.origin).toBe('high')
        expect(result.confidence.destination).toBe('high')
      })
    })

    describe('Pre-departure tracking with only planned events', () => {
      it('should infer origin from PLN DEPA when no actual events exist', () => {
        // Shipment not yet departed - only planned events
        const events = [
          {
            source: 'dcsa' as const,
            sourceEventId: '1',
            eventType: 'TRANSPORT' as const,
            eventCode: 'DEPA',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2026-04-01T00:00:00Z'),
            locationUnlocode: 'CNSHA',
            locationName: 'SHANGHAI',
            modeOfTransport: 'VESSEL' as const,
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '2',
            eventType: 'TRANSPORT' as const,
            eventCode: 'ARRI',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2026-04-15T00:00:00Z'),
            locationUnlocode: 'SGSIN',
            locationName: 'SINGAPORE',
            modeOfTransport: 'VESSEL' as const,
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '3',
            eventType: 'TRANSPORT' as const,
            eventCode: 'ARRI',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2026-05-01T00:00:00Z'),
            locationUnlocode: 'NLRTM',
            locationName: 'ROTTERDAM',
            modeOfTransport: 'VESSEL' as const,
          },
        ]

        const result = inferRouteFromEvents(events)

        // Origin should be inferred from PLN DEPA
        expect(result.originUnlocode).toBe('CNSHA')
        expect(result.confidence.origin).toBe('medium') // Lower confidence for planned
        // Destination should be last PLN ARRI
        expect(result.destinationUnlocode).toBe('NLRTM')
        expect(result.confidence.destination).toBe('high')
      })

      it('should infer origin from EST DEPA when no actual events exist', () => {
        const events = [
          {
            source: 'dcsa' as const,
            sourceEventId: '1',
            eventType: 'TRANSPORT' as const,
            eventCode: 'DEPA',
            eventClassifierCode: 'EST' as const,
            eventDateTime: new Date('2026-04-01T00:00:00Z'),
            locationUnlocode: 'JPYOK',
            locationName: 'YOKOHAMA',
            modeOfTransport: 'VESSEL' as const,
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '2',
            eventType: 'TRANSPORT' as const,
            eventCode: 'ARRI',
            eventClassifierCode: 'EST' as const,
            eventDateTime: new Date('2026-04-20T00:00:00Z'),
            locationUnlocode: 'USLAX',
            locationName: 'LOS ANGELES',
            modeOfTransport: 'VESSEL' as const,
          },
        ]

        const result = inferRouteFromEvents(events)

        expect(result.originUnlocode).toBe('JPYOK')
        expect(result.confidence.origin).toBe('medium')
        expect(result.destinationUnlocode).toBe('USLAX')
        expect(result.confidence.destination).toBe('high')
      })

      it('should prefer ACT events over PLN events for origin', () => {
        // Mix of actual and planned events - actual should take priority
        const events = [
          {
            source: 'dcsa' as const,
            sourceEventId: '1',
            eventType: 'TRANSPORT' as const,
            eventCode: 'DEPA',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2026-03-01T00:00:00Z'),
            locationUnlocode: 'CNSHA',
            locationName: 'SHANGHAI',
            modeOfTransport: 'VESSEL' as const,
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '2',
            eventType: 'TRANSPORT' as const,
            eventCode: 'DEPA',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2026-03-02T00:00:00Z'),
            locationUnlocode: 'CNSHA',
            locationName: 'SHANGHAI',
            modeOfTransport: 'VESSEL' as const,
            carrierExportVoyageNumber: '100E',
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '3',
            eventType: 'TRANSPORT' as const,
            eventCode: 'ARRI',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2026-03-20T00:00:00Z'),
            locationUnlocode: 'NLRTM',
            locationName: 'ROTTERDAM',
            modeOfTransport: 'VESSEL' as const,
          },
        ]

        const result = inferRouteFromEvents(events)

        // Should pick ACT DEPA (high confidence) over PLN DEPA (medium confidence)
        expect(result.originUnlocode).toBe('CNSHA')
        expect(result.confidence.origin).toBe('high') // High because ACT event was used
      })

      it('should infer origin from PLN LOAD when no departure events exist', () => {
        const events = [
          {
            source: 'dcsa' as const,
            sourceEventId: '1',
            eventType: 'EQUIPMENT' as const,
            eventCode: 'LOAD',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2026-04-01T00:00:00Z'),
            locationUnlocode: 'KRPUS',
            locationName: 'BUSAN',
            modeOfTransport: 'VESSEL' as const,
            equipmentReference: 'TEMU1234567',
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '2',
            eventType: 'EQUIPMENT' as const,
            eventCode: 'DISC',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2026-04-20T00:00:00Z'),
            locationUnlocode: 'USOAK',
            locationName: 'OAKLAND',
            modeOfTransport: 'VESSEL' as const,
            equipmentReference: 'TEMU1234567',
          },
        ]

        const result = inferRouteFromEvents(events)

        expect(result.originUnlocode).toBe('KRPUS')
        expect(result.confidence.origin).toBe('medium')
      })
    })

    describe('Transshipment with EST ARRI at intermediate port and PLN ARRI at final destination', () => {
      it('should pick LAST arrival event as destination (not first EST ARRI)', () => {
        // Simulate a voyage: INNSA -> DEWVN (transship) -> PLGDY (final)
        // with EST ARRI at DEWVN and PLN ARRI at PLGDY
        const events = [
          {
            source: 'dcsa' as const,
            sourceEventId: '1',
            eventType: 'TRANSPORT' as const,
            eventCode: 'DEPA',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2026-02-05T09:01:00Z'),
            locationUnlocode: 'INNSA',
            locationName: 'NHAVA SHEVA',
            modeOfTransport: 'VESSEL' as const,
            carrierExportVoyageNumber: '123E',
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '2',
            eventType: 'TRANSPORT' as const,
            eventCode: 'ARRI',
            eventClassifierCode: 'EST' as const,
            eventDateTime: new Date('2026-03-15T21:00:00Z'),
            locationUnlocode: 'DEWVN',
            locationName: 'WILHELMSHAVEN',
            modeOfTransport: 'VESSEL' as const,
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '3',
            eventType: 'TRANSPORT' as const,
            eventCode: 'DEPA',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2026-03-27T13:00:00Z'),
            locationUnlocode: 'DEWVN',
            locationName: 'WILHELMSHAVEN',
            modeOfTransport: 'VESSEL' as const,
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '4',
            eventType: 'TRANSPORT' as const,
            eventCode: 'ARRI',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2026-03-30T04:00:00Z'),
            locationUnlocode: 'PLGDY',
            locationName: 'GDYNIA',
            modeOfTransport: 'VESSEL' as const,
          },
        ]

        const result = inferRouteFromEvents(events)

        // Should pick PLGDY (last arrival) not DEWVN (first EST ARRI)
        expect(result.destinationUnlocode).toBe('PLGDY')
        expect(result.confidence.destination).toBe('high')
        expect(result.originUnlocode).toBe('INNSA')
        expect(result.confidence.origin).toBe('high')
      })

      it('should pick last EST ARRI when multiple EST arrivals exist', () => {
        // Multiple EST ARRI events - should pick the last one chronologically
        const events = [
          {
            source: 'dcsa' as const,
            sourceEventId: '1',
            eventType: 'TRANSPORT' as const,
            eventCode: 'DEPA',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2026-02-01T00:00:00Z'),
            locationUnlocode: 'CNSHA',
            locationName: 'SHANGHAI',
            modeOfTransport: 'VESSEL' as const,
            carrierExportVoyageNumber: '100E',
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '2',
            eventType: 'TRANSPORT' as const,
            eventCode: 'ARRI',
            eventClassifierCode: 'EST' as const,
            eventDateTime: new Date('2026-02-15T00:00:00Z'),
            locationUnlocode: 'SGSIN',
            locationName: 'SINGAPORE',
            modeOfTransport: 'VESSEL' as const,
          },
          {
            source: 'dcsa' as const,
            sourceEventId: '3',
            eventType: 'TRANSPORT' as const,
            eventCode: 'ARRI',
            eventClassifierCode: 'EST' as const,
            eventDateTime: new Date('2026-03-01T00:00:00Z'),
            locationUnlocode: 'NLRTM',
            locationName: 'ROTTERDAM',
            modeOfTransport: 'VESSEL' as const,
          },
        ]

        const result = inferRouteFromEvents(events)

        // Should pick NLRTM (last EST ARRI) not SGSIN (first EST ARRI)
        expect(result.destinationUnlocode).toBe('NLRTM')
        expect(result.confidence.destination).toBe('high')
      })
    })
  })

  describe('isValidUnlocode', () => {
    it('should return true for valid UN/LOCODEs', () => {
      expect(isValidUnlocode('CNYTN')).toBe(true)
      expect(isValidUnlocode('PLGDN')).toBe(true)
      expect(isValidUnlocode('BEANR')).toBe(true)
      expect(isValidUnlocode('USNYC')).toBe(true)
      expect(isValidUnlocode('SGSIN')).toBe(true)
      expect(isValidUnlocode('DE123')).toBe(true) // 3 digits allowed
      expect(isValidUnlocode('USX1Y')).toBe(true) // mixed alphanumeric
    })

    it('should return false for invalid UN/LOCODEs', () => {
      expect(isValidUnlocode('')).toBe(false)
      expect(isValidUnlocode(null)).toBe(false)
      expect(isValidUnlocode(undefined)).toBe(false)
      expect(isValidUnlocode('CN')).toBe(false) // too short
      expect(isValidUnlocode('CNYTNX')).toBe(false) // too long
      expect(isValidUnlocode('12YTN')).toBe(false) // starts with digits
      expect(isValidUnlocode('C1YTN')).toBe(false) // second char is digit
      expect(isValidUnlocode('cn-ytn')).toBe(false) // invalid chars
    })

    it('should handle lowercase by converting to uppercase', () => {
      expect(isValidUnlocode('cnytn')).toBe(true)
      expect(isValidUnlocode('PlGdN')).toBe(true)
    })
  })
})
