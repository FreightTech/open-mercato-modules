import type { CarrierAdapter, CarrierFetchResult, CarrierAdapterTestResult } from '../carrier-adapter'
import { extractDocumentReferences } from '../carrier-adapter'
import type { TrackingReferenceType } from '../../data/entities'
import { parseDcsaEvents } from '../dcsa-event-parser'
import { withCarrierApiSpan } from '../logger'

const BASE_URL = 'https://api.dockflow.com/v3'
const DCSA_FORMAT = 'dcsa-tnt-2.2'

const REGISTRATION_FIELD: Partial<Record<TrackingReferenceType, string>> = {
  container: 'container_reference',
  booking: 'booking_reference',
  bol: 'bill_of_lading_reference',
}

type UpstreamRecord = { events?: Record<string, unknown>[] }

function getApiKey(authConfig: Record<string, unknown> | null | undefined): string {
  const apiKey = authConfig?.api_key as string | undefined
  if (!apiKey) {
    throw new Error('Dockflow authConfig requires api_key')
  }
  return apiKey
}

async function dockflowRequest(url: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown')
    throw new Error(`Dockflow API error (${response.status}): ${errorText}`)
  }
  return response
}

export class DockflowAdapter implements CarrierAdapter {
  readonly carrierCode = 'dockflow'
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
        const apiKey = getApiKey(input.authConfig)
        const baseUrl = input.apiEndpoint || BASE_URL
        // Dockflow only returns tradeflows the key's entity tracks, so an unknown
        // reference is registered (an idempotent upsert) and stays empty until
        // Dockflow has events. The om- prefix keeps the upsert off tradeflows the
        // customer created themselves.
        const tradeflowReference = `om-${input.referenceType}-${input.referenceValue}`
        const params = new URLSearchParams({ format: DCSA_FORMAT, tradeflow: tradeflowReference, fields: 'events' })

        const response = await dockflowRequest(`${baseUrl}/upstream?${params}`, apiKey)
        span.setAttribute('http.status_code', response.status)
        const body = (await response.json()) as { data?: UpstreamRecord[] }
        const records = body.data ?? []

        if (records.length === 0) {
          const registrationField = REGISTRATION_FIELD[input.referenceType]
          if (!registrationField) {
            throw new Error(`Dockflow does not track ${input.referenceType} references`)
          }
          await dockflowRequest(`${baseUrl}/downstream/tradeflows`, apiKey, {
            method: 'POST',
            body: JSON.stringify({
              tradeflow_reference: tradeflowReference,
              [registrationField]: input.referenceValue,
            }),
          })
          span.setAttribute('dockflow.registered', true)
          return { events: [] }
        }

        const events = parseDcsaEvents(records.flatMap((record) => record.events ?? []), 'Dockflow')
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
      const apiKey = getApiKey(input.authConfig)
      const params = new URLSearchParams({ format: DCSA_FORMAT, per_page: '1', since: new Date().toISOString() })
      await dockflowRequest(`${input.apiEndpoint || BASE_URL}/upstream?${params}`, apiKey)
      return { success: true, message: 'Dockflow API key accepted', latencyMs: Date.now() - start }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, message: `Dockflow connection failed: ${message}`, latencyMs: Date.now() - start }
    }
  }
}
