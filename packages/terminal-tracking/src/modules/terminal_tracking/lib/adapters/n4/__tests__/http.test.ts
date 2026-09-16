import { describe, it, expect, vi, afterEach } from 'vitest'

// `n4Request` drives requests with undici's `fetch` (same instance as the
// dispatcher), so the mock targets the undici module, not the global fetch.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('undici', async (orig) => {
  const actual = await orig<typeof import('undici')>()
  return { ...actual, fetch: fetchMock }
})

import { n4Request, isTransientNetworkError } from '../http'

function socketClose(): TypeError {
  // Mirrors undici's mid-flight peer close: `TypeError: terminated` with an
  // UND_ERR_SOCKET cause — the exact error that crashed the queue worker.
  return Object.assign(new TypeError('terminated'), {
    cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
  })
}

afterEach(() => fetchMock.mockReset())

describe('isTransientNetworkError', () => {
  it('treats undici socket close / terminated as transient', () => {
    expect(isTransientNetworkError(socketClose())).toBe(true)
    expect(isTransientNetworkError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true)
  })

  it('does not treat a generic error or an HTTP status as transient', () => {
    expect(isTransientNetworkError(new TypeError('bad argument'))).toBe(false)
    expect(isTransientNetworkError(new Error('Unit request failed (403)'))).toBe(false)
  })
})

describe('n4Request', () => {
  it('returns status + fully-read body on success', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    const res = await n4Request('https://t/unit', { method: 'GET' }, { retries: 0 })
    expect(res).toEqual({ status: 200, ok: true, text: '{"ok":true}' })
  })

  it('ALWAYS drains the body, even on a non-ok status (no dangling stream)', async () => {
    // The crash root cause: a non-ok response whose body was never read left a
    // stream undrained on a keep-alive socket. Assert the body is consumed.
    const resp = new Response('403 forbidden', { status: 403 })
    fetchMock.mockResolvedValue(resp)

    const out = await n4Request('https://t/unit', { method: 'GET' }, { retries: 0 })
    expect(out).toEqual({ status: 403, ok: false, text: '403 forbidden' })
    expect(resp.bodyUsed).toBe(true)
  })

  it('retries a transient socket close, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(socketClose())
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))

    const res = await n4Request('https://t/unit', { method: 'GET' }, { retries: 2, retryBackoffMs: 0 })
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retries and rethrows the transient error', async () => {
    fetchMock.mockRejectedValue(socketClose())

    await expect(
      n4Request('https://t/unit', { method: 'GET' }, { retries: 2, retryBackoffMs: 0 }),
    ).rejects.toThrow(/terminated/)
    expect(fetchMock).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it('does NOT retry a non-transient error', async () => {
    fetchMock.mockRejectedValue(new TypeError('bad argument'))

    await expect(
      n4Request('https://t/unit', { method: 'GET' }, { retries: 3, retryBackoffMs: 0 }),
    ).rejects.toThrow(/bad argument/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry an HTTP error status (a real answer, not a drop)', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))

    const res = await n4Request('https://t/unit', { method: 'GET' }, { retries: 3, retryBackoffMs: 0 })
    expect(res.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('passes a proxy dispatcher and an abort signal to fetch', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    await n4Request('https://t/unit', { method: 'GET' }, { proxyUrl: 'http://127.0.0.1:8888', retries: 0 })
    const init = fetchMock.mock.calls[0]?.[1] as { dispatcher?: unknown; signal?: unknown }
    expect(init?.dispatcher).toBeDefined()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
