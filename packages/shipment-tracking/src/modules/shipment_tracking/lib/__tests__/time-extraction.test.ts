import { extractShipmentTimes } from '../time-extraction'
import { parseDcsaEvents } from '../dcsa-event-parser'
import { fixtures, sortEventsByTime } from '../../__tests__/fixtures'

describe('time-extraction', () => {
  describe('extractShipmentTimes', () => {
    describe('basic extraction', () => {
      it('should extract ETD from planned DEPA at origin', () => {
        const events = [
          {
            eventCode: 'DEPA',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2025-01-10T10:00:00Z'),
            eventDateTimeOffset: '+08:00',
            locationUnlocode: 'CNYTN',
          },
        ]
        const result = extractShipmentTimes(events, { originUnlocode: 'CNYTN' })

        expect(result.etd).toEqual(new Date('2025-01-10T10:00:00Z'))
        expect(result.etdOffset).toBe('+08:00')
      })

      it('should extract ETD from estimated DEPA at origin', () => {
        const events = [
          {
            eventCode: 'DEPA',
            eventClassifierCode: 'EST' as const,
            eventDateTime: new Date('2025-01-10T10:00:00Z'),
            eventDateTimeOffset: '+08:00',
            locationUnlocode: 'CNYTN',
          },
        ]
        const result = extractShipmentTimes(events, { originUnlocode: 'CNYTN' })

        expect(result.etd).toEqual(new Date('2025-01-10T10:00:00Z'))
      })

      it('should extract ATD from actual DEPA at origin', () => {
        const events = [
          {
            eventCode: 'DEPA',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2025-01-10T10:00:00Z'),
            eventDateTimeOffset: '+08:00',
            locationUnlocode: 'CNYTN',
          },
        ]
        const result = extractShipmentTimes(events, { originUnlocode: 'CNYTN' })

        expect(result.atd).toEqual(new Date('2025-01-10T10:00:00Z'))
        expect(result.atdOffset).toBe('+08:00')
      })

      it('should extract ETA from planned ARRI at destination', () => {
        const events = [
          {
            eventCode: 'ARRI',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2025-02-15T08:00:00Z'),
            eventDateTimeOffset: '+01:00',
            locationUnlocode: 'PLGDN',
          },
        ]
        const result = extractShipmentTimes(events, { destinationUnlocode: 'PLGDN' })

        expect(result.eta).toEqual(new Date('2025-02-15T08:00:00Z'))
        expect(result.etaOffset).toBe('+01:00')
      })

      it('should extract ETA from estimated ARRI at destination', () => {
        const events = [
          {
            eventCode: 'ARRI',
            eventClassifierCode: 'EST' as const,
            eventDateTime: new Date('2025-02-15T08:00:00Z'),
            locationUnlocode: 'PLGDN',
          },
        ]
        const result = extractShipmentTimes(events, { destinationUnlocode: 'PLGDN' })

        expect(result.eta).toEqual(new Date('2025-02-15T08:00:00Z'))
      })

      it('should extract ATA from actual ARRI at destination', () => {
        const events = [
          {
            eventCode: 'ARRI',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2025-02-15T08:00:00Z'),
            eventDateTimeOffset: '+01:00',
            locationUnlocode: 'PLGDN',
          },
        ]
        const result = extractShipmentTimes(events, { destinationUnlocode: 'PLGDN' })

        expect(result.ata).toEqual(new Date('2025-02-15T08:00:00Z'))
        expect(result.ataOffset).toBe('+01:00')
      })
    })

    describe('latest event wins', () => {
      it('should use later ETD when multiple planned DEPA events exist', () => {
        const events = [
          {
            eventCode: 'DEPA',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2025-01-10T10:00:00Z'),
            locationUnlocode: 'CNYTN',
          },
          {
            eventCode: 'DEPA',
            eventClassifierCode: 'PLN' as const,
            eventDateTime: new Date('2025-01-12T10:00:00Z'), // Later
            locationUnlocode: 'CNYTN',
          },
        ]
        const result = extractShipmentTimes(events, { originUnlocode: 'CNYTN' })

        expect(result.etd).toEqual(new Date('2025-01-12T10:00:00Z'))
      })

      it('should use later ETA when multiple estimated ARRI events exist', () => {
        const events = [
          {
            eventCode: 'ARRI',
            eventClassifierCode: 'EST' as const,
            eventDateTime: new Date('2025-02-15T08:00:00Z'),
            locationUnlocode: 'PLGDN',
          },
          {
            eventCode: 'ARRI',
            eventClassifierCode: 'EST' as const,
            eventDateTime: new Date('2025-02-18T08:00:00Z'), // Updated ETA
            locationUnlocode: 'PLGDN',
          },
        ]
        const result = extractShipmentTimes(events, { destinationUnlocode: 'PLGDN' })

        expect(result.eta).toEqual(new Date('2025-02-18T08:00:00Z'))
      })
    })

    describe('without location context', () => {
      it('should extract ATD from DEPA ACT when origin unknown', () => {
        const events = [
          {
            eventCode: 'DEPA',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2025-01-10T10:00:00Z'),
            locationUnlocode: 'CNYTN',
          },
        ]
        // No origin specified
        const result = extractShipmentTimes(events, {})

        expect(result.atd).toEqual(new Date('2025-01-10T10:00:00Z'))
      })

      it('should extract ATA from ARRI ACT when destination unknown', () => {
        const events = [
          {
            eventCode: 'ARRI',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2025-02-15T08:00:00Z'),
            locationUnlocode: 'PLGDN',
          },
        ]
        // No destination specified
        const result = extractShipmentTimes(events, {})

        expect(result.ata).toEqual(new Date('2025-02-15T08:00:00Z'))
      })
    })

    describe('ignores non-matching locations', () => {
      it('should not extract ATD from DEPA at non-origin port', () => {
        const events = [
          {
            eventCode: 'DEPA',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2025-01-10T10:00:00Z'),
            locationUnlocode: 'CNNGB', // Transship port, not origin
          },
        ]
        const result = extractShipmentTimes(events, {
          originUnlocode: 'CNYTN',
          destinationUnlocode: 'PLGDN',
        })

        // Should not extract as it's not at origin
        expect(result.atd).toBeUndefined()
      })

      it('should not extract ATA from ARRI at non-destination port', () => {
        const events = [
          {
            eventCode: 'ARRI',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2025-01-15T08:00:00Z'),
            locationUnlocode: 'CNNGB', // Transship port, not destination
          },
        ]
        const result = extractShipmentTimes(events, {
          originUnlocode: 'CNYTN',
          destinationUnlocode: 'PLGDN',
        })

        // Should not extract as it's not at destination
        expect(result.ata).toBeUndefined()
      })
    })

    describe('with real MSC direct voyage fixture', () => {
      it('should extract ATD and ETA from events', () => {
        const parsed = parseDcsaEvents(fixtures.direct.events, 'MSC')
        const events = parsed.map((e) => ({
          eventCode: e.eventCode,
          eventClassifierCode: e.eventClassifierCode,
          eventDateTime: e.eventDateTime,
          eventDateTimeOffset: e.eventDateTimeOffset,
          locationUnlocode: e.locationUnlocode,
        }))

        const result = extractShipmentTimes(events, {
          originUnlocode: fixtures.direct.origin,
          destinationUnlocode: fixtures.direct.destination,
        })

        // Should have ATD from DEPA ACT at origin
        expect(result.atd).toBeDefined()
        expect(result.atd!.toISOString()).toBe('2026-01-06T02:18:00.000Z') // DEPA at CNYTN

        // Should have ETA from ARRI EST at destination
        expect(result.eta).toBeDefined()
        expect(result.eta!.toISOString()).toBe('2026-02-20T05:00:00.000Z') // EST ARRI at PLGDN
      })
    })

    describe('with real MSC transshipment fixture', () => {
      it('should extract times correctly with transshipment', () => {
        const parsed = parseDcsaEvents(fixtures.transshipment.events, 'MSC')
        const events = parsed.map((e) => ({
          eventCode: e.eventCode,
          eventClassifierCode: e.eventClassifierCode,
          eventDateTime: e.eventDateTime,
          eventDateTimeOffset: e.eventDateTimeOffset,
          locationUnlocode: e.locationUnlocode,
        }))

        const result = extractShipmentTimes(events, {
          originUnlocode: fixtures.transshipment.origin,
          destinationUnlocode: fixtures.transshipment.destination,
        })

        // ATD should be from first DEPA at origin (CNTAO)
        expect(result.atd).toBeDefined()

        // ETA should be from EST ARRI at destination (PLGDN)
        expect(result.eta).toBeDefined()

        // Should NOT have ATA yet (shipment not arrived)
        expect(result.ata).toBeUndefined()
      })

      it('should extract ATD from origin not transship port', () => {
        const parsed = parseDcsaEvents(fixtures.transshipment.events, 'MSC')
        const events = parsed.map((e) => ({
          eventCode: e.eventCode,
          eventClassifierCode: e.eventClassifierCode,
          eventDateTime: e.eventDateTime,
          eventDateTimeOffset: e.eventDateTimeOffset,
          locationUnlocode: e.locationUnlocode,
        }))

        const result = extractShipmentTimes(events, {
          originUnlocode: fixtures.transshipment.origin,
          destinationUnlocode: fixtures.transshipment.destination,
        })

        // ATD location should be origin
        const depaAtOrigin = parsed.find(
          (e) =>
            e.eventCode === 'DEPA' &&
            e.eventClassifierCode === 'ACT' &&
            e.locationUnlocode === fixtures.transshipment.origin,
        )

        expect(depaAtOrigin).toBeDefined()
        expect(result.atd).toEqual(depaAtOrigin!.eventDateTime)
      })
    })

    describe('edge cases', () => {
      it('should return empty object when no events', () => {
        const result = extractShipmentTimes([], {})
        expect(result).toEqual({})
      })

      it('should handle events with null offset', () => {
        const events = [
          {
            eventCode: 'DEPA',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2025-01-10T10:00:00Z'),
            eventDateTimeOffset: null,
            locationUnlocode: 'CNYTN',
          },
        ]
        const result = extractShipmentTimes(events, {})

        expect(result.atd).toBeDefined()
        expect(result.atdOffset).toBeNull()
      })

      it('should handle case-insensitive location matching', () => {
        const events = [
          {
            eventCode: 'ARRI',
            eventClassifierCode: 'ACT' as const,
            eventDateTime: new Date('2025-02-15T08:00:00Z'),
            locationUnlocode: 'plgdn', // lowercase
          },
        ]
        const result = extractShipmentTimes(events, { destinationUnlocode: 'PLGDN' })

        expect(result.ata).toBeDefined()
      })
    })
  })
})
