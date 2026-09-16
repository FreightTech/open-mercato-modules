import { parseDcsaEvents, extractDcsaEventArray } from '../dcsa-event-parser'
import { fixtures, sortEventsByTime } from '../../__tests__/fixtures'

describe('dcsa-event-parser', () => {
  describe('extractDcsaEventArray', () => {
    it('should extract events from array format', () => {
      const data = [{ eventId: '1' }, { eventId: '2' }]
      const result = extractDcsaEventArray(data)
      expect(result).toHaveLength(2)
      expect(result[0].eventId).toBe('1')
    })

    it('should extract events from { events: [] } format', () => {
      const data = { events: [{ eventId: '1' }, { eventId: '2' }] }
      const result = extractDcsaEventArray(data)
      expect(result).toHaveLength(2)
    })

    it('should return empty array for invalid data', () => {
      expect(extractDcsaEventArray(null)).toEqual([])
      expect(extractDcsaEventArray(undefined)).toEqual([])
      expect(extractDcsaEventArray({})).toEqual([])
      expect(extractDcsaEventArray('string')).toEqual([])
    })
  })

  describe('parseDcsaEvents', () => {
    describe('with real MSC direct voyage fixture', () => {
      const parsed = parseDcsaEvents(fixtures.direct.events, 'MSC')

      it('should parse all events', () => {
        expect(parsed).toHaveLength(5)
      })

      it('should extract source event IDs', () => {
        const sourceIds = parsed.map((e) => e.sourceEventId)
        expect(sourceIds).toContain('1725677169') // LOAD event
        expect(sourceIds).toContain('1722140291') // GTIN event
      })

      it('should set source to dcsa', () => {
        for (const event of parsed) {
          expect(event.source).toBe('dcsa')
        }
      })

      it('should parse EQUIPMENT events correctly', () => {
        const loadEvent = parsed.find(
          (e) => e.eventType === 'EQUIPMENT' && e.eventCode === 'LOAD',
        )
        expect(loadEvent).toBeDefined()
        expect(loadEvent!.equipmentReference).toBe('MSCU1000001')
        expect(loadEvent!.isoEquipmentCode).toBe('4510')
        expect(loadEvent!.emptyIndicatorCode).toBe('LADEN')
        expect(loadEvent!.eventClassifierCode).toBe('ACT')
        expect(loadEvent!.locationUnlocode).toBe('CNYTN')
        expect(loadEvent!.locationName).toBe('YANTIAN')
        expect(loadEvent!.vesselName).toBe('EXAMPLE VESSEL 01')
        expect(loadEvent!.vesselImo).toBe('8000001')
      })

      it('should parse TRANSPORT events correctly', () => {
        const depaEvent = parsed.find(
          (e) => e.eventType === 'TRANSPORT' && e.eventCode === 'DEPA',
        )
        expect(depaEvent).toBeDefined()
        expect(depaEvent!.eventClassifierCode).toBe('ACT')
        expect(depaEvent!.locationUnlocode).toBe('CNYTN')
        expect(depaEvent!.vesselName).toBe('EXAMPLE VESSEL 01')
        expect(depaEvent!.voyageNumber).toBe('GA551W')
      })

      it('should parse estimated arrival events', () => {
        const arriEstEvent = parsed.find(
          (e) => e.eventType === 'TRANSPORT' && e.eventCode === 'ARRI' && e.eventClassifierCode === 'EST',
        )
        expect(arriEstEvent).toBeDefined()
        expect(arriEstEvent!.locationUnlocode).toBe('PLGDN')
        expect(arriEstEvent!.description).toBe('Estimated Time of Arrival')
      })

      it('should parse seals', () => {
        const loadEvent = parsed.find(
          (e) => e.eventType === 'EQUIPMENT' && e.eventCode === 'LOAD',
        )
        expect(loadEvent!.seals).toHaveLength(1)
        expect(loadEvent!.seals![0].number).toBe('FJ26631610')
        expect(loadEvent!.seals![0].source).toBe('TER')
      })

      it('should parse document references', () => {
        const loadEvent = parsed.find(
          (e) => e.eventType === 'EQUIPMENT' && e.eventCode === 'LOAD',
        )
        expect(loadEvent!.relatedDocumentReferences).toHaveLength(2)
        expect(loadEvent!.relatedDocumentReferences).toContainEqual({
          type: 'BKG',
          value: '100AA00A0000001S1',
        })
        expect(loadEvent!.relatedDocumentReferences).toContainEqual({
          type: 'TRD',
          value: 'MEDUAA000004',
        })
      })

      it('should parse event datetime correctly', () => {
        const gtinEvent = parsed.find(
          (e) => e.eventType === 'EQUIPMENT' && e.eventCode === 'GTIN',
        )
        expect(gtinEvent!.eventDateTime).toBeInstanceOf(Date)
        // 2025-12-30T17:34:00+08:00
        expect(gtinEvent!.eventDateTime.toISOString()).toBe('2025-12-30T09:34:00.000Z')
      })

      it('should parse mode of transport', () => {
        const loadEvent = parsed.find(
          (e) => e.eventType === 'EQUIPMENT' && e.eventCode === 'LOAD',
        )
        expect(loadEvent!.modeOfTransport).toBe('VESSEL')

        const gtinEvent = parsed.find(
          (e) => e.eventType === 'EQUIPMENT' && e.eventCode === 'GTIN',
        )
        expect(gtinEvent!.modeOfTransport).toBe('TRUCK')
      })
    })

    describe('with real MSC transshipment fixture', () => {
      const parsed = parseDcsaEvents(fixtures.transshipment.events, 'MSC')

      it('should parse all 9 events', () => {
        expect(parsed).toHaveLength(9)
      })

      it('should track multiple vessels', () => {
        const vesselNames = new Set(parsed.map((e) => e.vesselName).filter(Boolean))
        expect(vesselNames.has('EXAMPLE VESSEL 03')).toBe(true)
        expect(vesselNames.has('EXAMPLE VESSEL 04')).toBe(true)
      })

      it('should have multiple LOAD/DISC cycles (transshipment)', () => {
        const loadEvents = parsed.filter((e) => e.eventCode === 'LOAD')
        const discEvents = parsed.filter((e) => e.eventCode === 'DISC')

        // Transshipment: LOAD at origin, DISC at transship, LOAD at transship
        expect(loadEvents).toHaveLength(2)
        expect(discEvents).toHaveLength(1)
      })

      it('should have multiple DEPA events (transshipment)', () => {
        const depaEvents = parsed.filter(
          (e) => e.eventType === 'TRANSPORT' && e.eventCode === 'DEPA',
        )
        // DEPA from origin (CNTAO), DEPA from transship (CNNGB)
        expect(depaEvents).toHaveLength(2)
      })

      it('should track different voyage numbers', () => {
        const voyageNumbers = new Set(parsed.map((e) => e.voyageNumber).filter(Boolean))
        expect(voyageNumbers.has('GL602W')).toBe(true) // First leg
        expect(voyageNumbers.has('GA602W')).toBe(true) // Second leg
      })
    })

    describe('with real MSC multi-container fixture', () => {
      const parsed = parseDcsaEvents(fixtures.multiContainer.events, 'MSC')

      it('should parse all 98 events', () => {
        expect(parsed).toHaveLength(98)
      })

      it('should have 32 unique containers', () => {
        const containers = new Set(
          parsed
            .filter((e) => e.eventType === 'EQUIPMENT')
            .map((e) => e.equipmentReference)
            .filter(Boolean),
        )
        expect(containers.size).toBe(32)
      })

      it('should have events for each container', () => {
        const containerEventCounts = new Map<string, number>()
        for (const event of parsed) {
          if (event.eventType === 'EQUIPMENT' && event.equipmentReference) {
            const count = containerEventCounts.get(event.equipmentReference) || 0
            containerEventCounts.set(event.equipmentReference, count + 1)
          }
        }

        // Each container should have at least GTOT, GTIN, LOAD events
        for (const [container, count] of containerEventCounts) {
          expect(count).toBeGreaterThanOrEqual(2) // At minimum GTIN + LOAD
        }
      })
    })

    describe('edge cases', () => {
      it('should handle empty events array', () => {
        const result = parseDcsaEvents([], 'TEST')
        expect(result).toEqual([])
      })

      it('should generate UUID for missing eventId', () => {
        const events = [
          {
            eventType: 'EQUIPMENT',
            equipmentEventTypeCode: 'GTIN',
            eventDateTime: '2025-01-01T00:00:00Z',
            // No eventId
          },
        ]
        const result = parseDcsaEvents(events, 'TEST')
        expect(result[0].sourceEventId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        )
      })

      it('should handle missing optional fields gracefully', () => {
        const events = [
          {
            eventType: 'EQUIPMENT',
            equipmentEventTypeCode: 'LOAD',
            eventId: 'test-1',
            eventDateTime: '2025-01-01T00:00:00Z',
            // No transportCall, eventLocation, seals, etc.
          },
        ]
        const result = parseDcsaEvents(events, 'TEST')
        expect(result[0].vesselName).toBeNull()
        expect(result[0].locationUnlocode).toBeNull()
        expect(result[0].seals).toBeNull()
        expect(result[0].relatedDocumentReferences).toBeNull()
      })

      it('should use carrier name as default publisher', () => {
        const events = [
          {
            eventType: 'EQUIPMENT',
            equipmentEventTypeCode: 'LOAD',
            eventId: 'test-1',
            eventDateTime: '2025-01-01T00:00:00Z',
          },
        ]
        const result = parseDcsaEvents(events, 'TestCarrier')
        expect(result[0].publisherName).toBe('TestCarrier')
      })
    })

    describe('facility code extraction', () => {
      it('should extract facilityCode from transportCall level', () => {
        const parsed = parseDcsaEvents(fixtures.maerskTransshipInTransit.events, 'Maersk')
        const event = parsed[0]

        expect(event.facilityCode).toBe('TPCT1')
        expect(event.facilityCodeListProvider).toBe('SMDG')
        expect(event.facilityTypeCode).toBe('POTE')
      })

      it('should extract otherFacility as facilityAddress', () => {
        const parsed = parseDcsaEvents(fixtures.maerskTransshipInTransit.events, 'Maersk')
        const event = parsed[0]

        expect(event.facilityAddress).toContain('Tianjin PAC Intl Cntr Terminal')
        expect(event.facilityAddress).toContain('America Road')
      })

      it('should parse coordinates from location (string format)', () => {
        const parsed = parseDcsaEvents(fixtures.maerskTransshipInTransit.events, 'Maersk')
        const event = parsed[0]

        expect(event.latitude).toBeCloseTo(38.562, 2)
        expect(event.longitude).toBeCloseTo(117.56, 2)
      })

      it('should extract facility data from all Maersk fixture events', () => {
        const parsed = parseDcsaEvents(fixtures.maerskMultiTransshipCompleted.events, 'Maersk')

        // Check that events with transportCall have facility data
        const eventsWithFacility = parsed.filter((e) => e.facilityCode)
        expect(eventsWithFacility.length).toBeGreaterThan(0)

        // All events should have coordinates (Maersk provides them)
        const eventsWithCoords = parsed.filter((e) => e.latitude && e.longitude)
        expect(eventsWithCoords.length).toBeGreaterThan(0)

        // Verify specific facilities from the fixture
        const gdanskEvent = parsed.find((e) => e.locationUnlocode === 'PLGDN')
        expect(gdanskEvent).toBeDefined()
        expect(gdanskEvent?.facilityCode).toBe('DCT')
        expect(gdanskEvent?.facilityAddress).toContain('Gdansk')
      })

      it('should handle events without facility data gracefully', () => {
        const events = [
          {
            eventType: 'TRANSPORT',
            transportEventTypeCode: 'DEPA',
            eventId: 'test-no-facility',
            eventDateTime: '2025-01-01T00:00:00Z',
            // No transportCall or eventLocation
          },
        ]
        const result = parseDcsaEvents(events, 'TEST')

        expect(result[0].facilityCode).toBeNull()
        expect(result[0].facilityCodeListProvider).toBeNull()
        expect(result[0].facilityAddress).toBeNull()
        expect(result[0].latitude).toBeNull()
        expect(result[0].longitude).toBeNull()
      })

      it('should prefer transportCall.facilityCode over location.facilityCode', () => {
        const events = [
          {
            eventType: 'TRANSPORT',
            transportEventTypeCode: 'ARRI',
            eventId: 'test-priority',
            eventDateTime: '2025-01-01T00:00:00Z',
            transportCall: {
              facilityCode: 'TC_CODE',
              facilityCodeListProvider: 'SMDG',
              location: {
                facilityCode: 'LOC_CODE', // Should be ignored
                locationName: 'Test Port',
              },
            },
          },
        ]
        const result = parseDcsaEvents(events, 'TEST')

        expect(result[0].facilityCode).toBe('TC_CODE')
      })

      it('should fallback to location.facilityCode if transportCall.facilityCode is missing', () => {
        const events = [
          {
            eventType: 'TRANSPORT',
            transportEventTypeCode: 'ARRI',
            eventId: 'test-fallback',
            eventDateTime: '2025-01-01T00:00:00Z',
            eventLocation: {
              facilityCode: 'LOC_CODE',
              facilityCodeListProvider: 'BIC',
              locationName: 'Test Port',
            },
          },
        ]
        const result = parseDcsaEvents(events, 'TEST')

        expect(result[0].facilityCode).toBe('LOC_CODE')
        expect(result[0].facilityCodeListProvider).toBe('BIC')
      })

      it('should parse coordinates from both string and number formats', () => {
        // String format (common in Maersk responses)
        const stringCoordEvents = [
          {
            eventType: 'TRANSPORT',
            transportEventTypeCode: 'ARRI',
            eventId: 'test-str-coords',
            eventDateTime: '2025-01-01T00:00:00Z',
            transportCall: {
              location: {
                locationName: 'Test Port',
                latitude: '54.381628',
                longitude: '18.712876',
              },
            },
          },
        ]
        const strResult = parseDcsaEvents(stringCoordEvents, 'TEST')
        expect(strResult[0].latitude).toBeCloseTo(54.38, 2)
        expect(strResult[0].longitude).toBeCloseTo(18.71, 2)

        // Number format
        const numCoordEvents = [
          {
            eventType: 'TRANSPORT',
            transportEventTypeCode: 'ARRI',
            eventId: 'test-num-coords',
            eventDateTime: '2025-01-01T00:00:00Z',
            transportCall: {
              location: {
                locationName: 'Test Port',
                latitude: 54.381628,
                longitude: 18.712876,
              },
            },
          },
        ]
        const numResult = parseDcsaEvents(numCoordEvents, 'TEST')
        expect(numResult[0].latitude).toBeCloseTo(54.38, 2)
        expect(numResult[0].longitude).toBeCloseTo(18.71, 2)
      })
    })
  })
})
