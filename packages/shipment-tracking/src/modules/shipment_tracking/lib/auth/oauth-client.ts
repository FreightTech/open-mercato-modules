type OAuthConfig = {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope?: string
  extraHeaders?: Record<string, string>
  extraBody?: Record<string, string>
  authMethod?: 'body' | 'basic'
}

export async function fetchOAuthToken(config: OAuthConfig): Promise<string> {
  const { tokenUrl, clientId, clientSecret, scope, extraHeaders, extraBody, authMethod = 'body' } = config

  const body = new URLSearchParams({ grant_type: 'client_credentials' })

  if (authMethod === 'body') {
    body.set('client_id', clientId)
    body.set('client_secret', clientSecret)
  }

  if (scope) {
    body.set('scope', scope)
  }

  if (extraBody) {
    for (const [key, value] of Object.entries(extraBody)) {
      body.set(key, value)
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...extraHeaders,
  }

  if (authMethod === 'basic') {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown')
    throw new Error(`OAuth token request failed (${response.status}): ${errorText}`)
  }

  const data = await response.json() as { access_token: string }
  return data.access_token
}
