import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { BicApiClient } from '../../../lib/bic-api-client'
import { bicConfigTestSchema } from '../../../data/validators'

// ─── Metadata ────────────────────────────────────────────────

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['shipment_tracking.carrier_configs.manage'] },
}

// ─── OpenAPI ─────────────────────────────────────────────────

export const openApi = {
  POST: {
    operationId: 'testBicConfig',
    summary: 'Test BIC API connection',
    description: 'Tests the BIC API credentials by attempting to authenticate.',
    tags: ['Shipment Tracking'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            properties: {
              username: { type: 'string' as const },
              password: { type: 'string' as const },
              baseUrl: { type: 'string' as const },
            },
            required: ['username', 'password'],
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Connection test result',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const },
                message: { type: 'string' as const },
              },
            },
          },
        },
      },
    },
  },
}

// ─── POST - Test BIC API credentials ─────────────────────────

export async function POST(request: NextRequest) {
  const auth = await getAuthFromRequest(request)

  if (!auth?.orgId || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Parse without requiring scope fields since this is just a test
  const parseResult = z.object({
    username: z.string().trim().min(1),
    password: z.string().trim().min(1),
    baseUrl: z.string().trim().url().default('https://api.bic-code.org'),
  }).safeParse(body)

  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parseResult.error.flatten() },
      { status: 400 }
    )
  }

  const { username, password, baseUrl } = parseResult.data

  try {
    const client = new BicApiClient({
      baseUrl,
      username,
      password,
    })

    await client.testConnection()

    return NextResponse.json({
      success: true,
      message: 'BIC API connection successful',
    })
  } catch (err) {
    console.error('[bic-configs/test] error:', err)
    const message = err instanceof Error ? err.message : 'BIC API connection failed'
    return NextResponse.json({
      success: false,
      message,
    })
  }
}
