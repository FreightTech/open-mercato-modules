import type { TrackingEventClassifierCode } from '../data/entities'

type EventInput = {
  eventCode: string
  eventClassifierCode?: TrackingEventClassifierCode | null
  eventDateTime: Date
  eventDateTimeOffset?: string | null
  eventCreatedDateTime?: Date | null
  locationUnlocode?: string | null
}

type ShipmentContext = {
  originUnlocode?: string | null
  destinationUnlocode?: string | null
}

export type ExtractedTimes = {
  etd?: Date | null
  etdOffset?: string | null
  eta?: Date | null
  etaOffset?: string | null
  atd?: Date | null
  atdOffset?: string | null
  ata?: Date | null
  ataOffset?: string | null
}

function isAtLocation(eventLocation: string | null | undefined, target: string | null | undefined): boolean {
  if (!eventLocation || !target) return false
  return eventLocation.toUpperCase() === target.toUpperCase()
}

/**
 * Extracts ETD/ETA/ATD/ATA from cargo events.
 *
 * Logic:
 * - DEPA ACT at origin -> ATD
 * - DEPA PLN/EST at origin -> ETD
 * - ARRI ACT at destination -> ATA
 * - ARRI PLN/EST at destination -> ETA
 *
 * When multiple events match the same field, the latest one wins.
 * For EST/PLN events, we use eventCreatedDateTime (when estimate was published)
 * to ensure revised estimates supersede earlier ones.
 */
export function extractShipmentTimes(events: EventInput[], context: ShipmentContext): ExtractedTimes {
  const result: ExtractedTimes = {}

  // Sort events by createdDateTime (when published) if available, else eventDateTime
  // This ensures revised estimates (published later) supersede earlier ones
  const sorted = [...events].sort((eventA, eventB) => {
    const timeA = eventA.eventCreatedDateTime?.getTime() ?? eventA.eventDateTime.getTime()
    const timeB = eventB.eventCreatedDateTime?.getTime() ?? eventB.eventDateTime.getTime()
    return timeA - timeB
  })

  for (const event of sorted) {
    const code = event.eventCode.toUpperCase()
    const classifierCode = event.eventClassifierCode
    const atOrigin = isAtLocation(event.locationUnlocode, context.originUnlocode)
    const atDestination = isAtLocation(event.locationUnlocode, context.destinationUnlocode)

    if (code === 'DEPA') {
      if (classifierCode === 'ACT' && (atOrigin || !context.originUnlocode)) {
        result.atd = event.eventDateTime
        result.atdOffset = event.eventDateTimeOffset ?? null
      } else if ((classifierCode === 'PLN' || classifierCode === 'EST') && (atOrigin || !context.originUnlocode)) {
        result.etd = event.eventDateTime
        result.etdOffset = event.eventDateTimeOffset ?? null
      }
    }

    if (code === 'ARRI') {
      if (classifierCode === 'ACT' && (atDestination || !context.destinationUnlocode)) {
        result.ata = event.eventDateTime
        result.ataOffset = event.eventDateTimeOffset ?? null
      } else if ((classifierCode === 'PLN' || classifierCode === 'EST') && (atDestination || !context.destinationUnlocode)) {
        result.eta = event.eventDateTime
        result.etaOffset = event.eventDateTimeOffset ?? null
      }
    }
  }

  return result
}
