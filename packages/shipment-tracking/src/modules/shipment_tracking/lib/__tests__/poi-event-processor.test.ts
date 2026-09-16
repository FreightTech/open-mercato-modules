/**
 * POI Event Processor Tests
 *
 * Tests for processing AIS POI proximity events using real messages
 * captured from the NATS stream.
 */

import {
  generateSourceEventId,
  extractEventDateTime,
  getPoiCode,
  mapToOpenMercatoEventId,
  createTrackingEventFromPoi,
  resolvePoiLocationName,
} from '../poi-event-processor'
import {
  PROXIMITY_EVENT_CODES,
  PROXIMITY_EVENT_CATEGORY,
  type PoiProximityEvent,
  type ProximityEventType,
  type ProcessedPoiEvent,
} from '../poi-types'
import { poiFixtures, createTestScope } from '../../__tests__/fixtures'
import { TrackingJob } from '../../data/entities'

describe('poi-event-processor', () => {
  // ─── Event Code Mapping ────────────────────────────────────────────────────

  describe('PROXIMITY_EVENT_CODES', () => {
    it('should map all 7 event types to correct codes', () => {
      expect(PROXIMITY_EVENT_CODES.PORT_ARRIVAL).toBe('PARR')
      expect(PROXIMITY_EVENT_CODES.PORT_PROXIMITY_ARRIVAL).toBe('PPRA')
      expect(PROXIMITY_EVENT_CODES.PORT_PROXIMITY_DEPARTURE).toBe('PPRD')
      expect(PROXIMITY_EVENT_CODES.TERMINAL_ARRIVAL).toBe('TARR')
      expect(PROXIMITY_EVENT_CODES.TERMINAL_PROXIMITY_ARRIVAL).toBe('TPRA')
      expect(PROXIMITY_EVENT_CODES.TERMINAL_PROXIMITY_DEPARTURE).toBe('TPRD')
      expect(PROXIMITY_EVENT_CODES.WAYPOINT_REACHED).toBe('WAYR')
    })

    it('should have unique codes for each event type', () => {
      const codes = Object.values(PROXIMITY_EVENT_CODES)
      const uniqueCodes = new Set(codes)
      expect(uniqueCodes.size).toBe(codes.length)
    })
  })

  describe('PROXIMITY_EVENT_CATEGORY', () => {
    it('should categorize arrival events correctly', () => {
      expect(PROXIMITY_EVENT_CATEGORY.PORT_ARRIVAL).toBe('arrival')
      expect(PROXIMITY_EVENT_CATEGORY.TERMINAL_ARRIVAL).toBe('arrival')
    })

    it('should categorize proximity arrivals correctly', () => {
      expect(PROXIMITY_EVENT_CATEGORY.PORT_PROXIMITY_ARRIVAL).toBe('proximity')
      expect(PROXIMITY_EVENT_CATEGORY.TERMINAL_PROXIMITY_ARRIVAL).toBe('proximity')
    })

    it('should categorize departure events correctly', () => {
      expect(PROXIMITY_EVENT_CATEGORY.PORT_PROXIMITY_DEPARTURE).toBe('departure')
      expect(PROXIMITY_EVENT_CATEGORY.TERMINAL_PROXIMITY_DEPARTURE).toBe('departure')
    })

    it('should categorize waypoint events correctly', () => {
      expect(PROXIMITY_EVENT_CATEGORY.WAYPOINT_REACHED).toBe('waypoint')
    })
  })

  // ─── Source Event ID Generation ────────────────────────────────────────────

  describe('generateSourceEventId', () => {
    it('should generate unique IDs for different events', () => {
      const event1 = poiFixtures.waypointReached[0]
      const event2 = poiFixtures.waypointReached[1]

      const id1 = generateSourceEventId(event1)
      const id2 = generateSourceEventId(event2)

      expect(id1).not.toBe(id2)
    })

    it('should include mmsi in the ID', () => {
      const event = poiFixtures.waypointReached[0]
      const id = generateSourceEventId(event)

      expect(id).toContain(String(event.mmsi))
    })

    it('should include event type in the ID', () => {
      const event = poiFixtures.portArrival[0]
      const id = generateSourceEventId(event)

      expect(id).toContain('PORT_ARRIVAL')
    })

    it('should include timestamp in the ID', () => {
      const event = poiFixtures.terminalArrival[0]
      const id = generateSourceEventId(event)

      expect(id).toContain(event.ata!)
    })

    it('should use atd for departure events', () => {
      const event = poiFixtures.terminalProximityDeparture[0]
      const id = generateSourceEventId(event)

      expect(id).toContain(event.atd!)
    })

    it('should be deterministic for the same event', () => {
      const event = poiFixtures.portArrival[0]
      const id1 = generateSourceEventId(event)
      const id2 = generateSourceEventId(event)

      expect(id1).toBe(id2)
    })

    it('should be deterministic for timeless events (no ata/atd)', () => {
      // WAYPOINT/proximity events can arrive without ata/atd. The id must still be
      // stable across redeliveries — anchored on the POI code, never the wall clock.
      const event = { ...poiFixtures.waypointReached[0], ata: undefined, atd: undefined }

      const id1 = generateSourceEventId(event)
      const id2 = generateSourceEventId(event)

      expect(id1).toBe(id2)
      expect(id1).toContain(getPoiCode(event)!)
      // No embedded ISO timestamp (would indicate a wall-clock fallback)
      expect(id1).not.toMatch(/T\d{2}:\d{2}/)
    })

    it('should anchor on "unknown" when no ata/atd and no POI code', () => {
      const event = {
        ...poiFixtures.waypointReached[0],
        ata: undefined,
        atd: undefined,
        arrivedPoiCode: undefined,
        departedPoiCode: undefined,
      }

      const id = generateSourceEventId(event)

      expect(id).toContain('unknown')
      expect(generateSourceEventId(event)).toBe(id)
    })
  })

  // ─── DateTime Extraction ───────────────────────────────────────────────────

  describe('extractEventDateTime', () => {
    it('should extract ata for arrival events', () => {
      const event = poiFixtures.portArrival[0]
      const dateTime = extractEventDateTime(event)

      expect(dateTime.toISOString()).toBe(event.ata)
    })

    it('should extract atd for departure events', () => {
      const event = poiFixtures.terminalProximityDeparture[0]
      const dateTime = extractEventDateTime(event)

      expect(dateTime.toISOString()).toBe(event.atd)
    })

    it('should extract ata for waypoint events', () => {
      const event = poiFixtures.waypointReached[0]
      const dateTime = extractEventDateTime(event)

      expect(dateTime.toISOString()).toBe(event.ata)
    })

    it('should fallback to current time if no ata/atd', () => {
      const event = { ...poiFixtures.waypointReached[0], ata: undefined, atd: undefined }
      const before = new Date()
      const dateTime = extractEventDateTime(event)
      const after = new Date()

      expect(dateTime.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(dateTime.getTime()).toBeLessThanOrEqual(after.getTime())
    })
  })

  // ─── POI Code Extraction ───────────────────────────────────────────────────

  describe('getPoiCode', () => {
    it('should return arrivedPoiCode for arrival events', () => {
      const event = poiFixtures.portArrival[0]
      const code = getPoiCode(event)

      expect(code).toBe(event.arrivedPoiCode)
    })

    it('should return departedPoiCode for departure events', () => {
      const event = poiFixtures.terminalProximityDeparture[0]
      const code = getPoiCode(event)

      expect(code).toBe(event.departedPoiCode)
    })

    it('should return arrivedPoiCode for waypoint events', () => {
      const event = poiFixtures.waypointReached[0]
      const code = getPoiCode(event)

      expect(code).toBe(event.arrivedPoiCode)
    })

    it('should return null if no POI code present', () => {
      const event = { ...poiFixtures.waypointReached[0], arrivedPoiCode: undefined, departedPoiCode: undefined }
      const code = getPoiCode(event)

      expect(code).toBeNull()
    })
  })

  // ─── Open Mercato Event ID Mapping ─────────────────────────────────────────

  describe('mapToOpenMercatoEventId', () => {
    it('should map all event types to shipment_tracking.poi.* namespace', () => {
      const eventTypes: ProximityEventType[] = [
        'PORT_ARRIVAL',
        'PORT_PROXIMITY_ARRIVAL',
        'PORT_PROXIMITY_DEPARTURE',
        'TERMINAL_ARRIVAL',
        'TERMINAL_PROXIMITY_ARRIVAL',
        'TERMINAL_PROXIMITY_DEPARTURE',
        'WAYPOINT_REACHED',
      ]

      for (const type of eventTypes) {
        const eventId = mapToOpenMercatoEventId(type)
        expect(eventId).toMatch(/^shipment_tracking\.poi\./)
      }
    })

    it('should map PORT_ARRIVAL correctly', () => {
      expect(mapToOpenMercatoEventId('PORT_ARRIVAL')).toBe('shipment_tracking.poi.port_arrival')
    })

    it('should map TERMINAL_ARRIVAL correctly', () => {
      expect(mapToOpenMercatoEventId('TERMINAL_ARRIVAL')).toBe('shipment_tracking.poi.terminal_arrival')
    })

    it('should map WAYPOINT_REACHED correctly', () => {
      expect(mapToOpenMercatoEventId('WAYPOINT_REACHED')).toBe('shipment_tracking.poi.waypoint_reached')
    })

    it('should map proximity arrival events correctly', () => {
      expect(mapToOpenMercatoEventId('PORT_PROXIMITY_ARRIVAL')).toBe('shipment_tracking.poi.port_proximity_arrival')
      expect(mapToOpenMercatoEventId('TERMINAL_PROXIMITY_ARRIVAL')).toBe('shipment_tracking.poi.terminal_proximity_arrival')
    })

    it('should map departure events correctly', () => {
      expect(mapToOpenMercatoEventId('PORT_PROXIMITY_DEPARTURE')).toBe('shipment_tracking.poi.port_departure')
      expect(mapToOpenMercatoEventId('TERMINAL_PROXIMITY_DEPARTURE')).toBe('shipment_tracking.poi.terminal_departure')
    })
  })

  // ─── TrackingEvent Creation ────────────────────────────────────────────────

  describe('createTrackingEventFromPoi', () => {
    const scope = createTestScope()

    function createMockTrackingJob(): TrackingJob {
      const job = new TrackingJob()
      job.id = '00000000-0000-0000-0000-000000000003'
      job.organizationId = scope.organizationId
      job.tenantId = scope.tenantId
      return job
    }

    function createProcessedEvent(poiEvent: PoiProximityEvent): ProcessedPoiEvent {
      return {
        poiEvent,
        vesselImo: String(poiEvent.shipId),
        shipmentIds: ['shipment-1'],
        eventDateTime: extractEventDateTime(poiEvent),
        poiCode: getPoiCode(poiEvent),
        eventCode: PROXIMITY_EVENT_CODES[poiEvent.type],
        sourceEventId: generateSourceEventId(poiEvent),
      }
    }

    it('should create TrackingEvent with correct source', () => {
      const poiEvent = poiFixtures.portArrival[0]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.source).toBe('ais')
    })

    it('should set eventType to TRANSPORT', () => {
      const poiEvent = poiFixtures.terminalArrival[0]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.eventType).toBe('TRANSPORT')
    })

    it('should set eventClassifierCode to ACT (actual)', () => {
      const poiEvent = poiFixtures.waypointReached[0]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.eventClassifierCode).toBe('ACT')
    })

    it('should set correct event code', () => {
      const poiEvent = poiFixtures.portArrival[0]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.eventCode).toBe('PARR')
    })

    it('should set coordinates from POI event', () => {
      const poiEvent = poiFixtures.terminalProximityArrival[0]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.latitude).toBe(poiEvent.lat)
      expect(trackingEvent.longitude).toBe(poiEvent.lng)
    })

    it('should set vessel name from POI event', () => {
      const poiEvent = poiFixtures.waypointReached[0]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.vesselName).toBe('EXAMPLE VESSEL 14')
    })

    it('should set locationUnlocode to POI code', () => {
      const poiEvent = poiFixtures.portArrival[1]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.locationUnlocode).toBe('N044E008-03880')
    })

    it('should store raw data for debugging', () => {
      const poiEvent = poiFixtures.terminalProximityDeparture[0]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.rawData).toBeDefined()
      expect(trackingEvent.rawData?.poiEventType).toBe('TERMINAL_PROXIMITY_DEPARTURE')
      expect(trackingEvent.rawData?.mmsi).toBe(poiEvent.mmsi)
      expect(trackingEvent.rawData?.distanceToPoiMeters).toBe(poiEvent.distanceToPoiMeters)
    })

    it('should inherit organization and tenant from tracking job', () => {
      const poiEvent = poiFixtures.portArrival[0]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.organizationId).toBe(scope.organizationId)
      expect(trackingEvent.tenantId).toBe(scope.tenantId)
    })

    it('should set sourceEventId for deduplication', () => {
      const poiEvent = poiFixtures.waypointReached[1]
      const processed = createProcessedEvent(poiEvent)
      const trackingJob = createMockTrackingJob()

      const trackingEvent = createTrackingEventFromPoi(processed, trackingJob)

      expect(trackingEvent.sourceEventId).toBe(processed.sourceEventId)
      expect(trackingEvent.sourceEventId).toContain('poi-')
    })

    it('should resolve locationName from POI identity for port/terminal events', () => {
      const base = poiFixtures.terminalArrival[0]
      const poiEvent: PoiProximityEvent = {
        ...base,
        type: 'TERMINAL_ARRIVAL',
        terminalName: 'Qingdao New Qianwan Container Terminal (QQCTN)',
        portName: 'Port of Qingdao',
        city: 'Qingdao',
      }
      const trackingEvent = createTrackingEventFromPoi(createProcessedEvent(poiEvent), createMockTrackingJob())
      expect(trackingEvent.locationName).toBe('Qingdao New Qianwan Container Terminal (QQCTN)')
    })

    it('should leave locationName null for waypoints (region name used instead)', () => {
      const poiEvent: PoiProximityEvent = {
        ...poiFixtures.waypointReached[0],
        regionNamePl: 'Morze Północne',
        regionNameEn: 'North Sea',
      }
      const trackingEvent = createTrackingEventFromPoi(createProcessedEvent(poiEvent), createMockTrackingJob())
      expect(trackingEvent.locationName).toBeNull()
      expect(trackingEvent.regionNamePl).toBe('Morze Północne')
      expect(trackingEvent.regionNameEn).toBe('North Sea')
    })
  })

  describe('resolvePoiLocationName', () => {
    const base = poiFixtures.portArrival[0]

    it('terminal: prefers terminalName, then portName, then city', () => {
      expect(resolvePoiLocationName({ ...base, type: 'TERMINAL_ARRIVAL', terminalName: 'T', portName: 'P', city: 'C' })).toBe('T')
      expect(resolvePoiLocationName({ ...base, type: 'TERMINAL_ARRIVAL', terminalName: null, portName: 'P', city: 'C' })).toBe('P')
      expect(resolvePoiLocationName({ ...base, type: 'TERMINAL_PROXIMITY_ARRIVAL', terminalName: null, portName: null, city: 'C' })).toBe('C')
    })

    it('port: prefers city, then portName', () => {
      expect(resolvePoiLocationName({ ...base, type: 'PORT_ARRIVAL', city: 'Gdańsk', portName: 'Port of Gdańsk' })).toBe('Gdańsk')
      expect(resolvePoiLocationName({ ...base, type: 'PORT_PROXIMITY_ARRIVAL', city: null, portName: 'Port of Gdańsk' })).toBe('Port of Gdańsk')
    })

    it('returns null for waypoints and when no identity is present', () => {
      expect(resolvePoiLocationName({ ...base, type: 'WAYPOINT_REACHED' })).toBeNull()
      expect(resolvePoiLocationName({ ...base, type: 'PORT_ARRIVAL', city: null, portName: null })).toBeNull()
    })
  })

  // ─── Real NATS Message Tests ───────────────────────────────────────────────

  describe('with real NATS messages', () => {
    describe('WAYPOINT_REACHED events', () => {
      it('should parse EXAMPLE VESSEL 14 waypoint event', () => {
        const event = poiFixtures.waypointReached[0]

        expect(event.type).toBe('WAYPOINT_REACHED')
        expect(event.mmsi).toBe(111000001)
        expect(event.shipId).toBe(8100001)
        expect(event.shipName).toBe('EXAMPLE VESSEL 14')
        expect(event.arrivedPoiCode).toBe('N051E002-00772')
        expect(event.distanceToPoiMeters).toBeCloseTo(4926.73, 0)
        expect(event.lat).toBeCloseTo(51.346, 2)
        expect(event.lng).toBeCloseTo(2.118, 2)
      })

      it('should parse EXAMPLE VESSEL 15 waypoint event', () => {
        const event = poiFixtures.waypointReached[1]

        expect(event.type).toBe('WAYPOINT_REACHED')
        expect(event.mmsi).toBe(111000002)
        expect(event.shipName).toBe('EXAMPLE VESSEL 15')
        expect(event.arrivedPoiCode).toBe('N001E103-00217')
      })

      it('should have valid timestamps for all waypoint events', () => {
        for (const event of poiFixtures.waypointReached) {
          expect(event.ata).toBeDefined()
          const date = new Date(event.ata!)
          expect(date.getTime()).not.toBeNaN()
        }
      })
    })

    describe('PORT_ARRIVAL events', () => {
      it('should parse EXAMPLE VESSEL 17 port arrival', () => {
        const event = poiFixtures.portArrival[0]

        expect(event.type).toBe('PORT_ARRIVAL')
        expect(event.mmsi).toBe(111000004)
        expect(event.shipName).toBe('EXAMPLE VESSEL 17')
        expect(event.arrivedPoiCode).toBe('N035E139-03434')
        expect(event.sequenceOrder).toBe(2)
      })

      it('should parse EXAMPLE VESSEL 18 port arrival with very close distance', () => {
        const event = poiFixtures.portArrival[1]

        expect(event.type).toBe('PORT_ARRIVAL')
        expect(event.mmsi).toBe(111000005)
        expect(event.shipName).toBe('EXAMPLE VESSEL 18')
        expect(event.distanceToPoiMeters).toBeCloseTo(27.25, 1) // Very close - actual arrival
        expect(event.arrivedPoiCode).toBe('N044E008-03880')
      })
    })

    describe('TERMINAL_ARRIVAL events', () => {
      it('should parse EXAMPLE VESSEL 17 terminal arrival (same vessel as port arrival)', () => {
        const event = poiFixtures.terminalArrival[0]

        expect(event.type).toBe('TERMINAL_ARRIVAL')
        expect(event.mmsi).toBe(111000004)
        expect(event.shipName).toBe('EXAMPLE VESSEL 17')
        expect(event.sequenceOrder).toBe(3) // Comes after PORT_ARRIVAL
      })

      it('should parse EXAMPLE VESSEL 19 terminal arrival in Sydney', () => {
        const event = poiFixtures.terminalArrival[2]

        expect(event.type).toBe('TERMINAL_ARRIVAL')
        expect(event.shipName).toBe('EXAMPLE VESSEL 19')
        expect(event.lat).toBeLessThan(0) // Southern hemisphere
        expect(event.arrivedPoiCode).toBe('S034E151-00941')
      })
    })

    describe('proximity arrival events', () => {
      it('should parse EXAMPLE VESSEL 20 port proximity arrival', () => {
        const event = poiFixtures.portProximityArrival[0]

        expect(event.type).toBe('PORT_PROXIMITY_ARRIVAL')
        expect(event.mmsi).toBe(111000007)
        expect(event.shipName).toBe('EXAMPLE VESSEL 20')
        expect(event.distanceToPoiMeters).toBeCloseTo(136.13, 1)
      })

      it('should parse EXAMPLE VESSEL 21 terminal proximity arrival', () => {
        const event = poiFixtures.terminalProximityArrival[0]

        expect(event.type).toBe('TERMINAL_PROXIMITY_ARRIVAL')
        expect(event.mmsi).toBe(111000008)
        expect(event.shipName).toBe('EXAMPLE VESSEL 21')
        expect(event.distanceToPoiMeters).toBeCloseTo(964.82, 1)
      })

      it('should have ata (arrival time) for all proximity arrivals', () => {
        const allProximityArrivals = [
          ...poiFixtures.portProximityArrival,
          ...poiFixtures.terminalProximityArrival,
        ]

        for (const event of allProximityArrivals) {
          expect(event.ata).toBeDefined()
          expect(event.atd).toBeUndefined()
        }
      })
    })

    describe('proximity departure events', () => {
      it('should parse EXAMPLE VESSEL 23 port proximity departure', () => {
        const event = poiFixtures.portProximityDeparture[0]

        expect(event.type).toBe('PORT_PROXIMITY_DEPARTURE')
        expect(event.mmsi).toBe(111000010)
        expect(event.shipName).toBe('EXAMPLE VESSEL 23')
        expect(event.departedPoiCode).toBe('N037W001-03965')
      })

      it('should parse EXAMPLE VESSEL 24 terminal proximity departure', () => {
        const event = poiFixtures.terminalProximityDeparture[2]

        expect(event.type).toBe('TERMINAL_PROXIMITY_DEPARTURE')
        expect(event.shipName).toBe('EXAMPLE VESSEL 24')
        expect(event.departedPoiCode).toBe('N051W009-03379')
      })

      it('should have atd (departure time) for all departures', () => {
        const allDepartures = [
          ...poiFixtures.portProximityDeparture,
          ...poiFixtures.terminalProximityDeparture,
        ]

        for (const event of allDepartures) {
          expect(event.atd).toBeDefined()
          expect(event.ata).toBeUndefined()
        }
      })
    })

    describe('all valid events', () => {
      it('should have all required fields', () => {
        for (const event of poiFixtures.allValidEvents) {
          expect(event.type).toBeDefined()
          expect(event.mmsi).toBeDefined()
          expect(typeof event.mmsi).toBe('number')
          expect(event.shipId).toBeDefined()
          expect(event.shipName).toBeDefined()
          expect(event.lat).toBeDefined()
          expect(event.lng).toBeDefined()
          expect(event.sequenceOrder).toBeDefined()
        }
      })

      it('should have valid coordinates', () => {
        for (const event of poiFixtures.allValidEvents) {
          expect(event.lat).toBeGreaterThanOrEqual(-90)
          expect(event.lat).toBeLessThanOrEqual(90)
          expect(event.lng).toBeGreaterThanOrEqual(-180)
          expect(event.lng).toBeLessThanOrEqual(180)
        }
      })

      it('should have valid MMSI (9 digits)', () => {
        for (const event of poiFixtures.allValidEvents) {
          const mmsiStr = String(event.mmsi)
          expect(mmsiStr.length).toBe(9)
        }
      })

      it('should map all events to valid event codes', () => {
        for (const event of poiFixtures.allValidEvents) {
          const code = PROXIMITY_EVENT_CODES[event.type]
          expect(code).toBeDefined()
          expect(code.length).toBe(4) // All codes are 4 characters
        }
      })
    })
  })

  // ─── Invalid Message Handling ──────────────────────────────────────────────

  describe('invalid message handling', () => {
    it('should identify messages without type', () => {
      for (const msg of poiFixtures.invalidMessages) {
        const typedMsg = msg as Partial<PoiProximityEvent>
        // Most invalid messages don't have type
        if (!typedMsg.type) {
          expect(typedMsg.type).toBeUndefined()
        }
      }
    })

    it('should identify messages without mmsi', () => {
      const msgsWithoutMmsi = poiFixtures.invalidMessages.filter(
        (msg) => !(msg as Partial<PoiProximityEvent>).mmsi
      )
      expect(msgsWithoutMmsi.length).toBeGreaterThan(0)
    })

    it('should identify empty test messages', () => {
      const emptyMsg = poiFixtures.invalidMessages.find(
        (msg) => Object.keys(msg as object).length === 0
      )
      expect(emptyMsg).toBeDefined()
    })

    it('should identify messages with test payload', () => {
      const testMsgs = poiFixtures.invalidMessages.filter(
        (msg) => (msg as { test?: string }).test
      )
      expect(testMsgs.length).toBeGreaterThan(0)
    })

    it('should validate that invalid messages are missing required fields', () => {
      for (const msg of poiFixtures.invalidMessages) {
        const typedMsg = msg as Partial<PoiProximityEvent>
        const hasRequiredFields = typedMsg.type && typedMsg.mmsi && typedMsg.shipName
        expect(hasRequiredFields).toBeFalsy()
      }
    })
  })

  // ─── POI Code Format Tests ─────────────────────────────────────────────────

  describe('POI code format', () => {
    it('should follow grid-based format (e.g., N051E002-00772)', () => {
      const poiCodePattern = /^[NS]\d{3}[EW]\d{3}-\d{5}$/

      for (const event of poiFixtures.allValidEvents) {
        const code = getPoiCode(event)
        if (code) {
          expect(code).toMatch(poiCodePattern)
        }
      }
    })

    it('should encode latitude in the code', () => {
      const event = poiFixtures.waypointReached[0] // lat: 51.346...
      const code = getPoiCode(event)

      expect(code?.startsWith('N051')).toBe(true) // North 51 degrees
    })

    it('should encode longitude in the code', () => {
      const event = poiFixtures.waypointReached[0] // lng: 2.117...
      const code = getPoiCode(event)

      expect(code).toContain('E002') // East 2 degrees
    })

    it('should use S for southern latitudes', () => {
      const event = poiFixtures.terminalArrival[2] // EXAMPLE VESSEL 19 in Sydney
      const code = getPoiCode(event)

      expect(code?.startsWith('S034')).toBe(true)
    })

    it('should use W for western longitudes', () => {
      const event = poiFixtures.terminalProximityArrival[0] // EXAMPLE VESSEL 21 at -118...
      const code = getPoiCode(event)

      expect(code).toContain('W119')
    })
  })
})
