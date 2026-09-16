import type { CarrierAdapter, CarrierFetchResult, CarrierAdapterTestResult } from '../carrier-adapter'
import { extractDocumentReferences } from '../carrier-adapter'
import type { TrackingReferenceType } from '../../data/entities'
import { buildDcsaQueryParams } from '../dcsa-params'
import { parseDcsaEvents } from '../dcsa-event-parser'
import { withCarrierApiSpan } from '../logger'

const EVENTS_URL = 'https://apis.cma-cgm.net/operation/trackandtrace/v1/events'

type CmaCgmAuthConfig = {
  api_key: string
}

function getAuth(authConfig: Record<string, unknown> | null | undefined): CmaCgmAuthConfig {
  const apiKey = authConfig?.api_key as string | undefined
  if (!apiKey) {
    throw new Error('CMA CGM authConfig requires api_key')
  }
  return { api_key: apiKey }
}

export class CmaCgmAdapter implements CarrierAdapter {
  readonly carrierCode = 'cma-cgm'
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
            'keyId': auth.api_key,
          },
        })

        span.setAttribute('http.status_code', response.status)

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'unknown')
          throw new Error(`CMA CGM API error (${response.status}): ${errorText}`)
        }

        const data = await response.json()
        const events = parseDcsaEvents(data, 'CMA CGM')
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
      if (!auth.api_key) {
        throw new Error('Missing API key')
      }
      return { success: true, message: 'CMA CGM credentials validated', latencyMs: Date.now() - start }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, message: `CMA CGM connection failed: ${message}`, latencyMs: Date.now() - start }
    }
  }
}
