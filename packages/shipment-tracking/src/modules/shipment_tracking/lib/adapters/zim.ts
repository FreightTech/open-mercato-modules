import type { CarrierAdapter, CarrierFetchResult, CarrierAdapterTestResult } from '../carrier-adapter'
import { extractDocumentReferences } from '../carrier-adapter'
import type { TrackingReferenceType } from '../../data/entities'
import { fetchOAuthToken } from '../auth/oauth-client'
import { buildDcsaQueryParams } from '../dcsa-params'
import { parseDcsaEvents } from '../dcsa-event-parser'
import { withCarrierApiSpan } from '../logger'

const TOKEN_URL = 'https://apigw.zim.com/authorize/v1'
const EVENTS_URL = 'https://apigw.zim.com/trackAndTrace/v1'

type ZimAuthConfig = {
  client_id: string
  client_secret: string
  subscription_key: string
}

function getAuth(authConfig: Record<string, unknown> | null | undefined): ZimAuthConfig {
  const clientId = authConfig?.client_id as string | undefined
  const clientSecret = authConfig?.client_secret as string | undefined
  const subscriptionKey = authConfig?.subscription_key as string | undefined
  if (!clientId || !clientSecret || !subscriptionKey) {
    throw new Error('ZIM authConfig requires client_id, client_secret, and subscription_key')
  }
  return { client_id: clientId, client_secret: clientSecret, subscription_key: subscriptionKey }
}

async function authenticate(auth: ZimAuthConfig): Promise<string> {
  return withCarrierApiSpan(
    { carrierCode: 'zim', operation: 'authenticate' },
    async (span) => {
      const token = await fetchOAuthToken({
        tokenUrl: TOKEN_URL,
        clientId: auth.client_id,
        clientSecret: auth.client_secret,
        authMethod: 'body',
        extraBody: { scope: 'tracing' },
      })
      return token
    },
  )
}

export class ZimAdapter implements CarrierAdapter {
  readonly carrierCode = 'zim'
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
            'Ocp-Apim-Subscription-Key': auth.subscription_key,
            'Content-Type': 'application/json',
          },
        })

        span.setAttribute('http.status_code', response.status)

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'unknown')
          throw new Error(`ZIM API error (${response.status}): ${errorText}`)
        }

        const data = await response.json()
        const events = parseDcsaEvents(data, 'ZIM')
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
      return { success: true, message: 'ZIM authentication successful', latencyMs: Date.now() - start }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, message: `ZIM connection failed: ${message}`, latencyMs: Date.now() - start }
    }
  }
}
