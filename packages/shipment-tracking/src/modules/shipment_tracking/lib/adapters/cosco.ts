import type { CarrierAdapter, CarrierFetchResult, CarrierFetchedEvent, CarrierAdapterTestResult } from '../carrier-adapter'
import type { TrackingReferenceType } from '../../data/entities'
import type { TrackingEventType, TrackingEventClassifierCode } from '../../data/entities'
import type {
  CoscoShipmentData,
  CoscoContainer,
  CoscoEvent,
  CoscoLocation,
  ExtractedVesselData,
  DcsaEventMapping,
} from './cosco-types'
import { withCarrierApiSpan } from '../logger'

const EVENTS_URL = 'https://apis.cargosmart.com/openapi/cs2/ctvc/COSU'

type CoscoAuthConfig = {
  app_key: string
  scac_code: string
  customer_id: string
}

function getAuth(authConfig: Record<string, unknown> | null | undefined): CoscoAuthConfig {
  const appKey = authConfig?.app_key as string | undefined
  const scacCode = (authConfig?.scac_code as string) ?? 'COSU'
  const customerId = authConfig?.customer_id as string | undefined
  if (!appKey || !customerId) {
    throw new Error('Cosco authConfig requires app_key and customer_id')
  }
  return { app_key: appKey, scac_code: scacCode, customer_id: customerId }
}

function buildCoscoPayload(referenceValue: string, referenceType: TrackingReferenceType): Record<string, string> {
  switch (referenceType) {
    case 'booking':
      return { bookingNumber: referenceValue }
    case 'bol':
      return { billOfLadingNumber: referenceValue }
    case 'container':
      return { cntrNumber: referenceValue }
    default:
      return { cntrNumber: referenceValue }
  }
}

const CS_TO_DCSA: Record<string, DcsaEventMapping> = {
  CS010: { eventType: 'EQUIPMENT', eventCode: 'PICK', eventClassification: 'ACT' },
  CS020: { eventType: 'EQUIPMENT', eventCode: 'INSP', eventClassification: 'ACT' },
  CS040: { eventType: 'EQUIPMENT', eventCode: 'ARRI', eventClassification: 'ACT' },
  CS060: { eventType: 'EQUIPMENT', eventCode: 'LOAD', eventClassification: 'ACT' },
  CS067: { eventType: 'TRANSPORT', eventCode: 'DEPA', eventClassification: 'EST' },
  CS068: { eventType: 'TRANSPORT', eventCode: 'DEPA', eventClassification: 'EST' },
  CS070: { eventType: 'TRANSPORT', eventCode: 'DEPA', eventClassification: 'ACT' },
  CS080: { eventType: 'TRANSPORT', eventCode: 'ARRI', eventClassification: 'ACT' },
  CS090: { eventType: 'EQUIPMENT', eventCode: 'LOAD', eventClassification: 'ACT' },
  CS100: { eventType: 'EQUIPMENT', eventCode: 'DISC', eventClassification: 'ACT' },
  CS110: { eventType: 'TRANSPORT', eventCode: 'DEPA', eventClassification: 'ACT' },
  CS120: { eventType: 'TRANSPORT', eventCode: 'ARRI', eventClassification: 'ACT' },
  CS130: { eventType: 'EQUIPMENT', eventCode: 'DISC', eventClassification: 'ACT' },
  CS190: { eventType: 'EQUIPMENT', eventCode: 'PICK', eventClassification: 'ACT' },
  CS210: { eventType: 'EQUIPMENT', eventCode: 'DLVR', eventClassification: 'ACT' },
  CS260: { eventType: 'EQUIPMENT', eventCode: 'AVAI', eventClassification: 'ACT' },
  CS277: { eventType: 'TRANSPORT', eventCode: 'ARRI', eventClassification: 'EST' },
  CS958: { eventType: 'TRANSPORT', eventCode: 'ARRI', eventClassification: 'EST' },
}

function mapCoscoToDcsa(csCode: string): DcsaEventMapping {
  return CS_TO_DCSA[csCode] ?? { eventType: 'SHIPMENT', eventCode: csCode, eventClassification: 'ACT' }
}

function extractLocation(location?: CoscoLocation): {
  locationName: string | null
  locationUnlocode: string | null
  locationCountry: string | null
} {
  if (!location) return { locationName: null, locationUnlocode: null, locationCountry: null }

  const cityDetails = location.cityDetails
  const csStandardCity = location.CSStandardCity

  return {
    locationName: location.locationName ?? cityDetails?.city ?? null,
    locationUnlocode: cityDetails?.locationCode?.UNLocationCode ?? null,
    locationCountry: csStandardCity?.CSCountryCode ?? cityDetails?.country ?? null,
  }
}

function extractVessels(containerData: CoscoContainer[]): ExtractedVesselData[] {
  const vessels = containerData
    .flatMap((container) => container.route?.shipmentLeg ?? [])
    .filter((leg) => leg.SVVD)
    .flatMap((leg) => {
      const svvd = leg.SVVD
      if (!svvd) return []

      const results: ExtractedVesselData[] = []

      if (svvd.loading) {
        results.push({
          vesselName: svvd.loading.vesselName,
          vesselIMONumber: svvd.loading.lloydsNumber,
          vesselCallSign: svvd.loading.callSign,
          vesselCode: svvd.loading.vessel,
          voyage: svvd.loading.voyage,
          service: svvd.loading.service,
          direction: svvd.loading.direction,
          legType: 'loading',
          legSequence: leg.legSeq,
          pol: leg.POL?.port?.portName,
          pod: leg.POD?.port?.portName,
        })
      }

      if (svvd.discharge && svvd.discharge.vesselName !== svvd.loading?.vesselName) {
        results.push({
          vesselName: svvd.discharge.vesselName,
          vesselIMONumber: svvd.discharge.lloydsNumber,
          vesselCallSign: svvd.discharge.callSign,
          vesselCode: svvd.discharge.vessel,
          voyage: svvd.discharge.voyage,
          service: svvd.discharge.service,
          direction: svvd.discharge.direction,
          legType: 'discharge',
          legSequence: leg.legSeq,
          pol: leg.POL?.port?.portName,
          pod: leg.POD?.port?.portName,
        })
      }

      return results
    })

  // Deduplicate by IMO number
  return vessels.filter(
    (vessel, index, self) => index === self.findIndex((other) => other.vesselIMONumber === vessel.vesselIMONumber),
  )
}

function matchVesselToEvent(event: CoscoEvent, vessels: ExtractedVesselData[]): ExtractedVesselData | null {
  const mode = event.mode?.toLowerCase()
  if (mode !== 'vessel') return null

  const eventLocation = event.location?.cityDetails?.city
  const eventPort = event.location?.cityDetails?.portName

  if (!eventLocation && !eventPort) return null

  return vessels.find((vessel) => {
    const polMatch = vessel.pol === eventLocation || eventPort === vessel.pol
    const podMatch = vessel.pod === eventLocation || eventPort === vessel.pod
    return polMatch || podMatch
  }) ?? null
}

function calculateTimezoneOffset(localTime: string, gmtTime: string): string {
  const localDate = new Date(localTime)
  const gmtDate = new Date(gmtTime)
  const diffMinutes = (localDate.getTime() - gmtDate.getTime()) / 1000 / 60

  if (diffMinutes === 0) return '+00:00'

  const sign = diffMinutes >= 0 ? '+' : '-'
  const absMinutes = Math.abs(diffMinutes)
  const hours = Math.floor(absMinutes / 60)
  const minutes = absMinutes % 60

  return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

function generateEventId(event: CoscoEvent, eventDatetime: string): string {
  const csCode = event.CSEvent?.CSEventCode ?? 'unknown'
  const location = event.location?.cityDetails?.city ?? 'unknown'
  const timestamp = new Date(eventDatetime).getTime()
  return `cosco-${csCode}-${location}-${timestamp}`
}

function processCoscoResponse(
  data: { shipmentContent?: string | CoscoShipmentData; errors?: { errorDescription: string }[] },
): CarrierFetchedEvent[] {
  if (data.errors?.length) {
    throw new Error(`Cosco API error: ${data.errors[0].errorDescription}`)
  }

  let shipmentData: CoscoShipmentData | null = null
  try {
    shipmentData = typeof data.shipmentContent === 'string'
      ? JSON.parse(data.shipmentContent)
      : (data.shipmentContent as CoscoShipmentData) ?? null
  } catch {
    throw new Error('Failed to parse Cosco shipmentContent')
  }

  if (!shipmentData?.containerDetail) {
    return []
  }

  const containerData = Array.isArray(shipmentData.containerDetail)
    ? shipmentData.containerDetail
    : [shipmentData.containerDetail]

  const allEvents: CoscoEvent[] = containerData
    .flatMap((container) =>
      (container.event ?? []).map((event) => ({
        ...event,
        containerNumber: container.containerNumber?.containerNumber,
      })),
    )
    .filter(Boolean)

  if (allEvents.length === 0) return []

  const allVessels = extractVessels(containerData)

  return allEvents.map((event) => {
    const dcsaMapping = mapCoscoToDcsa(event.CSEvent?.CSEventCode ?? 'UNKNOWN')
    const gmtDatetime = event.eventDT?.GMT?.text ?? event.eventDT?.locDT?._value?.time ?? new Date().toISOString()
    const localDatetime = event.eventDT?.locDT?.text ?? gmtDatetime
    const locationData = extractLocation(event.location)
    const vessel = matchVesselToEvent(event, allVessels)

    const offset = calculateTimezoneOffset(localDatetime, gmtDatetime)
    const sourceEventId = generateEventId(event, gmtDatetime)

    return {
      source: 'dcsa' as const,
      sourceEventId,
      eventType: dcsaMapping.eventType as TrackingEventType,
      eventCode: dcsaMapping.eventCode,
      eventClassifierCode: (dcsaMapping.eventClassification as TrackingEventClassifierCode) ?? null,
      eventDateTime: new Date(gmtDatetime),
      eventDateTimeOffset: offset !== '+00:00' ? offset : null,
      description: event.eventDescription ?? event.carrEventCode ?? null,
      locationName: locationData.locationName,
      locationUnlocode: locationData.locationUnlocode,
      locationCountry: locationData.locationCountry,
      vesselName: vessel?.vesselName ?? null,
      vesselImo: vessel?.vesselIMONumber ?? null,
      voyageNumber: vessel?.voyage ?? null,
      rawData: event as unknown as Record<string, unknown>,
    }
  })
}

export class CoscoAdapter implements CarrierAdapter {
  readonly carrierCode = 'cosco'
  readonly supportedReferenceTypes: TrackingReferenceType[] = ['container', 'booking', 'bol']

  async fetchEvents(input: {
    referenceType: TrackingReferenceType
    referenceValue: string
    apiEndpoint?: string | null
    authConfig?: Record<string, unknown> | null
  }): Promise<CarrierFetchResult> {
    return withCarrierApiSpan(
      {
        carrierCode: this.carrierCode,
        operation: 'fetchEvents',
        referenceType: input.referenceType,
        referenceValue: input.referenceValue,
      },
      async (span) => {
        const auth = getAuth(input.authConfig)
        const payload = {
          ...buildCoscoPayload(input.referenceValue, input.referenceType),
          scacCode: auth.scac_code,
          customerID: auth.customer_id,
        }

        const response = await fetch(input.apiEndpoint ?? EVENTS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'appKey': auth.app_key,
          },
          body: JSON.stringify(payload),
        })

        span.setAttribute('http.status_code', response.status)

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'unknown')
          throw new Error(`Cosco API error (${response.status}): ${errorText}`)
        }

        const data = await response.json()
        const events = processCoscoResponse(data)

        // Extract booking/BOL from COSCO response structure
        const shipmentData = data as CoscoShipmentData | undefined
        const bookingNumber = shipmentData?.queryCriteria?.bookingNumber ?? null
        const bolNumber = shipmentData?.billOfLadingNumber?.[0] ?? null

        span.setAttribute('events.count', events.length)
        return { events, bookingNumber, bolNumber }
      },
    )
  }

  async testConnection(input: {
    apiEndpoint?: string | null
    authConfig?: Record<string, unknown> | null
  }): Promise<CarrierAdapterTestResult> {
    const start = Date.now()
    try {
      const auth = getAuth(input.authConfig)
      if (!auth.app_key || !auth.customer_id) {
        throw new Error('Missing credentials')
      }
      return { success: true, message: 'Cosco credentials validated', latencyMs: Date.now() - start }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, message: `Cosco connection failed: ${message}`, latencyMs: Date.now() - start }
    }
  }
}
