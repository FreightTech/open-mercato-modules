import { createHmac } from 'node:crypto'

export type WebhookDispatchResult = {
  success: boolean
  responseStatus?: number
  responseBody?: string
  errorMessage?: string
  durationMs: number
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Dispatches a webhook HTTP POST with HMAC-SHA256 signing.
 *
 * Headers sent:
 * - Content-Type: application/json
 * - X-Webhook-Timestamp: Unix timestamp in seconds
 * - X-Webhook-Signature: HMAC-SHA256 of `{timestamp}.{body}` (only if hmacSecret provided)
 */
export async function dispatchWebhook(input: {
  url: string
  payload: Record<string, unknown>
  hmacSecret?: string | null
  timeoutMs?: number
}): Promise<WebhookDispatchResult> {
  const { url, payload, hmacSecret, timeoutMs = 10000 } = input
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Timestamp': timestamp,
  }

  if (hmacSecret) {
    const signaturePayload = `${timestamp}.${body}`
    headers['X-Webhook-Signature'] = signPayload(signaturePayload, hmacSecret)
  }

  const startTime = Date.now()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const durationMs = Date.now() - startTime
    let responseBody: string | undefined

    try {
      responseBody = await response.text()
    } catch {
      // Body read failure is non-critical
    }

    if (response.ok) {
      return {
        success: true,
        responseStatus: response.status,
        responseBody,
        durationMs,
      }
    }

    return {
      success: false,
      responseStatus: response.status,
      responseBody,
      errorMessage: `HTTP ${response.status}: ${response.statusText}`,
      durationMs,
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const message = error instanceof Error ? error.message : 'Unknown error'

    return {
      success: false,
      errorMessage: message,
      durationMs,
    }
  }
}
