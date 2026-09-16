import { deriveShipmentStatus, evaluatePreArrivalUpgrade, PRE_ARRIVAL_DAYS_THRESHOLD } from '../status-machine'
import { parseDcsaEvents } from '../dcsa-event-parser'
import { fixtures, sortEventsByTime, filterEventsByContainer } from '../../__tests__/fixtures'

describe('status-machine', () => {
  describe('deriveShipmentStatus', () => {
    describe('basic status progression', () => {
      it('should return PENDING when no events', () => {
        const status = deriveShipmentStatus([], {})
        expect(status).toBe('PENDING')
      })

      it('should derive BOOKED from planned DEPA', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'PLN' as const, locationUnlocode: 'CNYTN' },
        ]
        const status = deriveShipmentStatus(events, { originUnlocode: 'CNYTN' })
        expect(status).toBe('BOOKED')
      })

      it('should derive BOOKED from estimated DEPA', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'EST' as const, locationUnlocode: 'CNYTN' },
        ]
        const status = deriveShipmentStatus(events, { originUnlocode: 'CNYTN' })
        expect(status).toBe('BOOKED')
      })

      it('should derive DEPARTED from actual DEPA', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNYTN' },
        ]
        const status = deriveShipmentStatus(events, { originUnlocode: 'CNYTN' })
        expect(status).toBe('DEPARTED')
      })

      it('should derive IN_TRANSIT from actual ARRI at non-destination', () => {
        const events = [
          { eventCode: 'ARRI', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNNGB' },
        ]
        const status = deriveShipmentStatus(events, {
          originUnlocode: 'CNTAO',
          destinationUnlocode: 'PLGDN',
        })
        expect(status).toBe('IN_TRANSIT')
      })

      it('should derive ARRIVED from actual ARRI at destination', () => {
        const events = [
          { eventCode: 'ARRI', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const status = deriveShipmentStatus(events, { destinationUnlocode: 'PLGDN' })
        expect(status).toBe('ARRIVED')
      })

      it('should derive ARRIVED from actual DISC at destination', () => {
        const events = [
          { eventCode: 'DISC', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const status = deriveShipmentStatus(events, { destinationUnlocode: 'PLGDN' })
        expect(status).toBe('ARRIVED')
      })

      it('should derive DELIVERED from actual GTOT at destination', () => {
        const events = [
          { eventCode: 'GTOT', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const status = deriveShipmentStatus(events, { destinationUnlocode: 'PLGDN' })
        expect(status).toBe('DELIVERED')
      })

      it('should derive DELIVERED from actual PICK at destination', () => {
        const events = [
          { eventCode: 'PICK', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const status = deriveShipmentStatus(events, { destinationUnlocode: 'PLGDN' })
        expect(status).toBe('DELIVERED')
      })

      it('should derive DELIVERED from actual GTIN at destination (empty return)', () => {
        const events = [
          { eventCode: 'GTIN', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const status = deriveShipmentStatus(events, { destinationUnlocode: 'PLGDN' })
        expect(status).toBe('DELIVERED')
      })

      it('should derive ARRIVED from actual AVPU at destination', () => {
        const events = [
          { eventCode: 'AVPU', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const status = deriveShipmentStatus(events, { destinationUnlocode: 'PLGDN' })
        expect(status).toBe('ARRIVED')
      })

      it('should derive ARRIVED from actual CUSR at destination', () => {
        const events = [
          { eventCode: 'CUSR', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const status = deriveShipmentStatus(events, { destinationUnlocode: 'PLGDN' })
        expect(status).toBe('ARRIVED')
      })

      it('should derive DELIVERED from actual DLVR', () => {
        const events = [
          { eventCode: 'DLVR', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const status = deriveShipmentStatus(events, {})
        expect(status).toBe('DELIVERED')
      })
    })

    describe('status never downgrades', () => {
      it('should not downgrade from DEPARTED to BOOKED', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const }, // -> DEPARTED
          { eventCode: 'DEPA', eventClassifierCode: 'PLN' as const }, // would be BOOKED
        ]
        const status = deriveShipmentStatus(events, {}, 'PENDING')
        expect(status).toBe('DEPARTED')
      })

      it('should not downgrade from ARRIVED to IN_TRANSIT', () => {
        const status = deriveShipmentStatus(
          [{ eventCode: 'ARRI', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNNGB' }],
          { destinationUnlocode: 'PLGDN' },
          'ARRIVED', // Current status
        )
        expect(status).toBe('ARRIVED')
      })

      it('should not downgrade from DELIVERED', () => {
        const status = deriveShipmentStatus(
          [{ eventCode: 'ARRI', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' }],
          { destinationUnlocode: 'PLGDN' },
          'DELIVERED', // Current status
        )
        expect(status).toBe('DELIVERED')
      })
    })

    describe('with real MSC direct voyage fixture', () => {
      const parsed = parseDcsaEvents(fixtures.direct.events, 'MSC')
      const sorted = parsed
        .map((e) => ({
          eventCode: e.eventCode,
          eventClassifierCode: e.eventClassifierCode,
          locationUnlocode: e.locationUnlocode,
        }))
        .sort((a, b) => 0) // Keep original order (already sorted by time in fixture)

      const context = {
        originUnlocode: fixtures.direct.origin,
        destinationUnlocode: fixtures.direct.destination,
      }

      it('should derive IN_TRANSIT status (approaching destination)', () => {
        // The fixture shows: GTOT -> GTIN -> LOAD -> DEPA (ACT) -> ARRI (EST at destination)
        // Status is IN_TRANSIT because there's an estimated arrival at destination
        const status = deriveShipmentStatus(sorted, context)
        expect(status).toBe('IN_TRANSIT')
      })

      it('should show incremental status progression', () => {
        // Simulate events arriving incrementally
        const events = sortEventsByTime(fixtures.direct.events).map((e) => ({
          eventCode: e.equipmentEventTypeCode ?? e.transportEventTypeCode ?? '',
          eventClassifierCode: e.eventClassifierCode as 'ACT' | 'PLN' | 'EST',
          locationUnlocode: e.eventLocation?.unLocationCode ?? e.transportCall?.unLocationCode,
        }))

        // After GTOT (empty to shipper) - still PENDING
        let status = deriveShipmentStatus(events.slice(0, 1), context)
        expect(status).toBe('PENDING')

        // After GTIN (export received) - still PENDING (no booking event)
        status = deriveShipmentStatus(events.slice(0, 2), context)
        expect(status).toBe('PENDING')

        // After LOAD - still PENDING (LOAD at origin could indicate BOOKED)
        status = deriveShipmentStatus(events.slice(0, 3), context)
        expect(status).toBe('BOOKED') // LOAD at origin = BOOKED

        // After DEPA (ACT) - DEPARTED
        status = deriveShipmentStatus(events.slice(0, 4), context)
        expect(status).toBe('DEPARTED')

        // After ARRI (EST) at destination - IN_TRANSIT (approaching destination)
        status = deriveShipmentStatus(events.slice(0, 5), context)
        expect(status).toBe('IN_TRANSIT')
      })
    })

    describe('with real MSC transshipment fixture', () => {
      const parsed = parseDcsaEvents(fixtures.transshipment.events, 'MSC')
      const events = parsed.map((e) => ({
        eventCode: e.eventCode,
        eventClassifierCode: e.eventClassifierCode,
        locationUnlocode: e.locationUnlocode,
      }))

      const context = {
        originUnlocode: fixtures.transshipment.origin,
        destinationUnlocode: fixtures.transshipment.destination,
      }

      it('should derive IN_TRANSIT status (approaching destination)', () => {
        // The transshipment shows:
        // GTOT (CNTAO) -> GTIN (CNTAO) -> LOAD (CNTAO) -> DEPA (CNTAO) ->
        // ARRI (CNNGB) -> DISC (CNNGB) -> LOAD (CNNGB) -> DEPA (CNNGB) -> ARRI (EST PLGDN)
        // Status is IN_TRANSIT because there's an ARRI EST at destination (approaching)
        const status = deriveShipmentStatus(events, context)
        expect(status).toBe('IN_TRANSIT')
      })

      it('should track through transshipment as IN_TRANSIT', () => {
        // Get events up to arrival at transship port
        const sorted = sortEventsByTime(fixtures.transshipment.events)
        const arriAtTransshipIndex = sorted.findIndex(
          (e) =>
            e.eventType === 'TRANSPORT' &&
            e.transportEventTypeCode === 'ARRI' &&
            e.eventClassifierCode === 'ACT' &&
            e.transportCall?.unLocationCode === 'CNNGB',
        )

        const eventsUpToTransship = sorted.slice(0, arriAtTransshipIndex + 1).map((e) => ({
          eventCode: e.equipmentEventTypeCode ?? e.transportEventTypeCode ?? '',
          eventClassifierCode: e.eventClassifierCode as 'ACT' | 'PLN' | 'EST',
          locationUnlocode: e.eventLocation?.unLocationCode ?? e.transportCall?.unLocationCode,
        }))

        const status = deriveShipmentStatus(eventsUpToTransship, context)
        expect(status).toBe('IN_TRANSIT')
      })
    })

    describe('edge cases', () => {
      it('should handle unknown event codes gracefully', () => {
        const events = [
          { eventCode: 'UNKNOWN', eventClassifierCode: 'ACT' as const, locationUnlocode: 'TEST' },
        ]
        const status = deriveShipmentStatus(events, {})
        expect(status).toBe('PENDING')
      })

      it('should handle null eventClassifierCode', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: null, locationUnlocode: 'TEST' },
        ]
        const status = deriveShipmentStatus(events, {})
        expect(status).toBe('PENDING')
      })

      it('should handle DEPA without origin context', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNYTN' },
        ]
        // When no origin is known, DEPA ACT still indicates DEPARTED
        const status = deriveShipmentStatus(events, {})
        expect(status).toBe('DEPARTED')
      })

      it('should handle ARRI without destination context', () => {
        const events = [
          { eventCode: 'ARRI', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        // When no destination is known, any ARRI ACT indicates IN_TRANSIT
        const status = deriveShipmentStatus(events, {})
        expect(status).toBe('IN_TRANSIT')
      })
    })

    describe('PRE_ARRIVAL time-based status', () => {
      const now = new Date()

      function addDays(date: Date, days: number): Date {
        const result = new Date(date)
        result.setDate(result.getDate() + days)
        return result
      }

      it('should upgrade to PRE_ARRIVAL when ETA is within threshold and no ATA', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNYTN' },
        ]
        // ETA in 3 days (within 7-day threshold)
        const eta = addDays(now, 3)
        const status = deriveShipmentStatus(events, {}, 'IN_TRANSIT', { eta, ata: null })
        expect(status).toBe('PRE_ARRIVAL')
      })

      it('should upgrade from DEPARTED to PRE_ARRIVAL when ETA is within threshold', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNYTN' },
        ]
        // ETA in 5 days (within 7-day threshold)
        const eta = addDays(now, 5)
        const status = deriveShipmentStatus(events, {}, 'PENDING', { eta, ata: null })
        expect(status).toBe('PRE_ARRIVAL')
      })

      it('should stay IN_TRANSIT when ETA is beyond threshold', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNYTN' },
          { eventCode: 'ARRI', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNNGB' },
        ]
        // ETA in 10 days (beyond 7-day threshold)
        const eta = addDays(now, 10)
        const status = deriveShipmentStatus(events, {}, 'PENDING', { eta, ata: null })
        expect(status).toBe('IN_TRANSIT')
      })

      it('should NOT upgrade to PRE_ARRIVAL when ATA exists', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNYTN' },
        ]
        // Even though ETA is within threshold, ATA exists
        const eta = addDays(now, 3)
        const ata = addDays(now, -1) // Arrived yesterday
        const status = deriveShipmentStatus(events, {}, 'DEPARTED', { eta, ata })
        expect(status).toBe('DEPARTED')
      })

      it('should NOT upgrade to PRE_ARRIVAL when ETA is null', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNYTN' },
        ]
        const status = deriveShipmentStatus(events, {}, 'DEPARTED', { eta: null, ata: null })
        expect(status).toBe('DEPARTED')
      })

      it('should NOT upgrade to PRE_ARRIVAL when ETA is in the past', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNYTN' },
          { eventCode: 'ARRI', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNNGB' },
        ]
        // ETA was 2 days ago (past)
        const eta = addDays(now, -2)
        const status = deriveShipmentStatus(events, {}, 'PENDING', { eta, ata: null })
        expect(status).toBe('IN_TRANSIT') // Event-based status, not time-based upgrade
      })

      it('should NOT downgrade from ARRIVED to PRE_ARRIVAL', () => {
        const events = [
          { eventCode: 'ARRI', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const context = { destinationUnlocode: 'PLGDN' }
        // Even with timeContext, event-derived ARRIVED should not downgrade
        const eta = addDays(now, 3)
        const status = deriveShipmentStatus(events, context, 'PENDING', { eta, ata: null })
        expect(status).toBe('ARRIVED')
      })

      it('should handle exactly at threshold (7 days)', () => {
        const events = [
          { eventCode: 'DEPA', eventClassifierCode: 'ACT' as const, locationUnlocode: 'CNYTN' },
        ]
        // ETA exactly at threshold
        const eta = addDays(now, PRE_ARRIVAL_DAYS_THRESHOLD)
        const status = deriveShipmentStatus(events, {}, 'DEPARTED', { eta, ata: null })
        expect(status).toBe('PRE_ARRIVAL')
      })

      it('should NOT upgrade when event-derived status is higher than IN_TRANSIT', () => {
        const events = [
          { eventCode: 'ARRI', eventClassifierCode: 'ACT' as const, locationUnlocode: 'PLGDN' },
        ]
        const context = { destinationUnlocode: 'PLGDN' }
        // Event gives ARRIVED, time context should not downgrade to PRE_ARRIVAL
        const eta = addDays(now, 3)
        const status = deriveShipmentStatus(events, context, 'PENDING', { eta, ata: null })
        expect(status).toBe('ARRIVED')
      })
    })
  })

  describe('evaluatePreArrivalUpgrade', () => {
    const now = new Date()

    function addDays(date: Date, days: number): Date {
      const result = new Date(date)
      result.setDate(result.getDate() + days)
      return result
    }

    it('should upgrade IN_TRANSIT to PRE_ARRIVAL when conditions met', () => {
      const eta = addDays(now, 3)
      const result = evaluatePreArrivalUpgrade('IN_TRANSIT', { eta, ata: null })
      expect(result).toBe('PRE_ARRIVAL')
    })

    it('should NOT upgrade from PENDING', () => {
      const eta = addDays(now, 3)
      const result = evaluatePreArrivalUpgrade('PENDING', { eta, ata: null })
      expect(result).toBe('PENDING')
    })

    it('should NOT upgrade from BOOKED', () => {
      const eta = addDays(now, 3)
      const result = evaluatePreArrivalUpgrade('BOOKED', { eta, ata: null })
      expect(result).toBe('BOOKED')
    })

    it('should NOT upgrade from DEPARTED', () => {
      const eta = addDays(now, 3)
      const result = evaluatePreArrivalUpgrade('DEPARTED', { eta, ata: null })
      expect(result).toBe('DEPARTED')
    })

    it('should NOT upgrade from ARRIVED', () => {
      const eta = addDays(now, 3)
      const result = evaluatePreArrivalUpgrade('ARRIVED', { eta, ata: null })
      expect(result).toBe('ARRIVED')
    })

    it('should NOT upgrade from DELIVERED', () => {
      const eta = addDays(now, 3)
      const result = evaluatePreArrivalUpgrade('DELIVERED', { eta, ata: null })
      expect(result).toBe('DELIVERED')
    })

    it('should NOT upgrade from PRE_ARRIVAL (already upgraded)', () => {
      const eta = addDays(now, 3)
      const result = evaluatePreArrivalUpgrade('PRE_ARRIVAL', { eta, ata: null })
      expect(result).toBe('PRE_ARRIVAL')
    })

    it('should NOT upgrade when ATA exists', () => {
      const eta = addDays(now, 3)
      const ata = addDays(now, -1)
      const result = evaluatePreArrivalUpgrade('IN_TRANSIT', { eta, ata })
      expect(result).toBe('IN_TRANSIT')
    })

    it('should NOT upgrade when ETA is beyond threshold', () => {
      const eta = addDays(now, 10)
      const result = evaluatePreArrivalUpgrade('IN_TRANSIT', { eta, ata: null })
      expect(result).toBe('IN_TRANSIT')
    })

    it('should NOT upgrade when ETA is null', () => {
      const result = evaluatePreArrivalUpgrade('IN_TRANSIT', { eta: null, ata: null })
      expect(result).toBe('IN_TRANSIT')
    })
  })
})
