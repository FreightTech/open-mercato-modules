import type { CarrierAdapter, CarrierFetchResult, CarrierAdapterTestResult } from '../carrier-adapter'
import { extractDocumentReferences } from '../carrier-adapter'
import type { TrackingReferenceType } from '../../data/entities'
import { fetchOAuthToken } from '../auth/oauth-client'
import { buildDcsaQueryParams } from '../dcsa-params'
import { parseDcsaEvents } from '../dcsa-event-parser'
import { withCarrierApiSpan } from '../logger'

const TOKEN_URL = 'https://api.maersk.com/customer-identity/oauth/v2/access_token'
const EVENTS_URL = 'https://api.maersk.com/track-and-trace-private/events'

type MaerskAuthConfig = {
  client_id: string
  client_secret: string
}

function getAuth(authConfig: Record<string, unknown> | null | undefined): MaerskAuthConfig {
  const clientId = authConfig?.client_id as string | undefined
  const clientSecret = authConfig?.client_secret as string | undefined
  if (!clientId || !clientSecret) {
    throw new Error('Maersk authConfig requires client_id and client_secret')
  }
  return { client_id: clientId, client_secret: clientSecret }
}

async function authenticate(auth: MaerskAuthConfig): Promise<string> {
  return withCarrierApiSpan(
    { carrierCode: 'maersk', operation: 'authenticate' },
    async (span) => {
      const token = await fetchOAuthToken({
        tokenUrl: TOKEN_URL,
        clientId: auth.client_id,
        clientSecret: auth.client_secret,
        authMethod: 'body',
        extraHeaders: { 'Consumer-Key': auth.client_id },
      })
      return token
    },
  )
}

export class MaerskAdapter implements CarrierAdapter {
  readonly carrierCode = 'maersk'
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
        const token = await authenticate(auth)
        const params = buildDcsaQueryParams(input.referenceValue, input.referenceType)
        const url = `${input.apiEndpoint || EVENTS_URL}?${params}`

        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Consumer-Key': auth.client_id,
            'Content-Type': 'application/json',
          },
        })

        span.setAttribute('http.status_code', response.status)

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'unknown')
          throw new Error(`Maersk API error (${response.status}): ${errorText}`)
        }

        const data = await response.json()
        const events = parseDcsaEvents(data, 'Maersk')
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
      await authenticate(auth)
      return { success: true, message: 'Maersk authentication successful', latencyMs: Date.now() - start }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, message: `Maersk connection failed: ${message}`, latencyMs: Date.now() - start }
    }
  }
}
