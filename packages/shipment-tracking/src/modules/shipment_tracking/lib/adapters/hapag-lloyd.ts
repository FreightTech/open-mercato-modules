import type { CarrierAdapter, CarrierFetchResult, CarrierAdapterTestResult } from '../carrier-adapter'
import { extractDocumentReferences } from '../carrier-adapter'
import type { TrackingReferenceType } from '../../data/entities'
import { buildDcsaQueryParams } from '../dcsa-params'
import { parseDcsaEvents } from '../dcsa-event-parser'
import { withCarrierApiSpan } from '../logger'

const EVENTS_URL = 'https://api.hlag.com/hlag/external/v2/events'

type HapagLloydAuthConfig = {
  client_id: string
  client_secret: string
}

function getAuth(authConfig: Record<string, unknown> | null | undefined): HapagLloydAuthConfig {
  const clientId = authConfig?.client_id as string | undefined
  const clientSecret = authConfig?.client_secret as string | undefined
  if (!clientId || !clientSecret) {
    throw new Error('Hapag-Lloyd authConfig requires client_id and client_secret')
  }
  return { client_id: clientId, client_secret: clientSecret }
}

export class HapagLloydAdapter implements CarrierAdapter {
  readonly carrierCode = 'hapag-lloyd'
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
        const params = buildDcsaQueryParams(input.referenceValue, input.referenceType)
        const url = `${input.apiEndpoint || EVENTS_URL}?${params}`

        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            'X-IBM-Client-Id': auth.client_id,
            'X-IBM-Client-Secret': auth.client_secret,
          },
        })

        span.setAttribute('http.status_code', response.status)

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'unknown')
          throw new Error(`Hapag-Lloyd API error (${response.status}): ${errorText}`)
        }

        const data = await response.json()
        const events = parseDcsaEvents(data, 'Hapag-Lloyd')
        const { bookingNumber, bolNumber } = extractDocumentReferences(events)

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
      // Hapag-Lloyd has no separate auth step; validate config shape
      if (!auth.client_id || !auth.client_secret) {
        throw new Error('Missing credentials')
      }
      return { success: true, message: 'Hapag-Lloyd credentials validated', latencyMs: Date.now() - start }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, message: `Hapag-Lloyd connection failed: ${message}`, latencyMs: Date.now() - start }
    }
  }
}
