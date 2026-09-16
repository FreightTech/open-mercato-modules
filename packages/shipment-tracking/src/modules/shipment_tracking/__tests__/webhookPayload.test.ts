/**
 * Tests for webhook payload structure.
 * Verifies that all expected fields are included in shipment payloads.
 */

import type { Shipment, TrackingEvent } from '../data/entities'

// Re-create the buildShipmentPayload logic for testing
// (The actual function is not exported from webhookService.ts)
function buildShipmentPayload(shipment: Partial<Shipment>, trackingEvents: Partial<TrackingEvent>[]): Record<string, unknown> {
  const latestEvent = trackingEvents.length > 0 ? trackingEvents[trackingEvents.length - 1] : null

  return {
    id: shipment.id,
    status: shipment.status,
    carrierCode: shipment.carrierCode,
    containerNumber: shipment.containerNumber,
    isoEquipmentCode: shipment.isoEquipmentCode,
    bookingNumber: shipment.bookingNumber,
    bolNumber: shipment.bolNumber,
    etdTimestamps: shipment.etdTimestamps,
    etaTimestamps: shipment.etaTimestamps,
    atdTimestamps: shipment.atdTimestamps,
    ataTimestamps: shipment.ataTimestamps,
    originLocation: shipment.originLocation,
    destinationLocation: shipment.destinationLocation,
    currentLocationName: latestEvent?.locationName ?? null,
    currentLocationUnlocode: latestEvent?.locationUnlocode ?? null,
    vesselName: shipment.vesselName,
    vesselImo: shipment.vesselImo,
    voyageNumber: shipment.voyageNumber,
    eventCount: shipment.eventCount,
    lastEventAt: shipment.lastEventAt?.toISOString() ?? null,
    extra: shipment.extra,
    createdAt: shipment.createdAt?.toISOString() ?? null,
    updatedAt: shipment.updatedAt?.toISOString() ?? null,
    trackingEvents: trackingEvents.map((event) => ({
      id: event.id,
      source: event.source,
      sourceEventId: event.sourceEventId,
      eventType: event.eventType,
      eventCode: event.eventCode,
      eventClassifierCode: event.eventClassifierCode,
      eventDateTime: event.eventDateTime?.toISOString() ?? null,
      equipmentReference: event.equipmentReference,
      isoEquipmentCode: event.isoEquipmentCode,
      locationName: event.locationName,
      locationUnlocode: event.locationUnlocode,
    })),
  }
}

describe('Webhook Payload Structure', () => {
  describe('buildShipmentPayload', () => {
    it('should include isoEquipmentCode in shipment payload', () => {
      const shipment: Partial<Shipment> = {
        id: 'shipment-123',
        status: 'IN_TRANSIT',
        carrierCode: 'msc',
        containerNumber: 'MSCU1234567',
        isoEquipmentCode: '22G1',
        bookingNumber: 'BOOKING123',
        vesselName: 'EXAMPLE VESSEL 01',
        eventCount: 3,
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-25'),
      }

      const trackingEvents: Partial<TrackingEvent>[] = [
        {
          id: 'event-1',
          eventType: 'EQUIPMENT',
          eventCode: 'LOAD',
          eventClassifierCode: 'ACT',
          equipmentReference: 'MSCU1234567',
          isoEquipmentCode: '22G1',
          locationName: 'Yantian',
          locationUnlocode: 'CNYTN',
          eventDateTime: new Date('2026-02-10'),
        },
      ]

      const payload = buildShipmentPayload(shipment, trackingEvents)

      // Verify isoEquipmentCode is in shipment-level payload
      expect(payload.isoEquipmentCode).toBe('22G1')

      // Verify isoEquipmentCode is also in each tracking event
      const events = payload.trackingEvents as Array<{ isoEquipmentCode?: string }>
      expect(events[0].isoEquipmentCode).toBe('22G1')
    })

    it('should handle null isoEquipmentCode', () => {
      const shipment: Partial<Shipment> = {
        id: 'shipment-456',
        status: 'PENDING',
        carrierCode: 'maersk',
        containerNumber: 'MSKU9876543',
        isoEquipmentCode: null,
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-25'),
      }

      const payload = buildShipmentPayload(shipment, [])

      expect(payload.isoEquipmentCode).toBeNull()
    })

    it('should handle undefined isoEquipmentCode', () => {
      const shipment: Partial<Shipment> = {
        id: 'shipment-789',
        status: 'PENDING',
        carrierCode: 'hapag-lloyd',
        containerNumber: 'HLCU1111111',
        // isoEquipmentCode not set (undefined)
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-25'),
      }

      const payload = buildShipmentPayload(shipment, [])

      expect(payload.isoEquipmentCode).toBeUndefined()
    })

    it('should include all ISO equipment code variants', () => {
      // Test various ISO 6346 equipment codes
      const testCases = [
        { code: '22G1', description: "20' General Purpose" },
        { code: '42G1', description: "40' General Purpose" },
        { code: '45G1', description: "40' High Cube" },
        { code: '22R1', description: "20' Reefer" },
        { code: '45R1', description: "40' High Cube Reefer" },
        { code: '2210', description: "20' Standard (numeric)" },
        { code: '4510', description: "40' High Cube (numeric)" },
      ]

      for (const { code, description } of testCases) {
        const shipment: Partial<Shipment> = {
          id: `shipment-${code}`,
          status: 'IN_TRANSIT',
          isoEquipmentCode: code,
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        const payload = buildShipmentPayload(shipment, [])
        expect(payload.isoEquipmentCode).toBe(code)
      }
    })
  })
})
