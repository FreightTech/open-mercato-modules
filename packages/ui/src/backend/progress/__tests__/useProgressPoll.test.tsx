/**
 * @jest-environment jsdom
 *
 * The top bar is mounted for every backend user, and GET /api/progress/active needs `progress.view`.
 * A 403 answered by apiFetch's default redirect sent every user without that feature to /login as soon
 * as the shell rendered. The hooks must ask with the redirect switched off, read the 403 as "nothing to
 * show" and stop polling; 401 keeps its session-refresh redirect.
 */
jest.mock('../../FlashMessages', () => ({
  flash: jest.fn(),
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { flash } from '../../FlashMessages'
import { useProgressPoll } from '../useProgressPoll'
import { useProgressSse } from '../useProgressSse'
import { APP_EVENT_DOM_NAME } from '../../injection/useAppEvent'

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit | undefined]>

function createMockResponse(status: number, body: unknown): Response {
  const serializedBody = JSON.stringify(body ?? {})
  const build = () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => JSON.parse(serializedBody),
      text: async () => serializedBody,
      clone: () => build(),
    }) as unknown as Response
  return build()
}

const FORBIDDEN_BODY = { error: 'Forbidden', requiredFeatures: ['progress.view'] }
const JOBS_BODY = {
  active: [
    {
      id: 'job-1',
      jobType: 'import',
      name: 'Import',
      status: 'running',
      progressPercent: 10,
      processedCount: 1,
      cancellable: false,
    },
  ],
  recentlyCompleted: [],
}

function installFetch(respond: () => Response): FetchMock {
  const fetchMock = jest.fn(async () => respond()) as unknown as FetchMock
  ;(window as unknown as Record<string, unknown>).__omOriginalFetch = fetchMock
  return fetchMock
}

function sentHeader(fetchMock: FetchMock, name: string): string | null {
  const init = fetchMock.mock.calls[0]?.[1]
  return new Headers(init?.headers).get(name)
}

async function flushFetch() {
  // apiFetch awaits the response and its JSON body before the hook sees the result.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.useFakeTimers()
  window.history.pushState({}, '', '/backend')
})

afterEach(() => {
  ;(window as unknown as Record<string, unknown>).__omOriginalFetch = undefined
  jest.clearAllTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('useProgressPoll without progress.view', () => {
  it('asks with the forbidden redirect switched off and reads 403 as empty lists', async () => {
    const fetchMock = installFetch(() => createMockResponse(403, FORBIDDEN_BODY))

    const { result } = renderHook(() => useProgressPoll())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(sentHeader(fetchMock, 'x-om-forbidden-redirect')).toBe('0')
    expect(flash).not.toHaveBeenCalled()
    expect(result.current.forbidden).toBe(true)
    expect(result.current.activeJobs).toEqual([])
    expect(result.current.recentlyCompleted).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('stops polling after a 403: no interval tick, refresh or progress event asks again', async () => {
    const fetchMock = installFetch(() => createMockResponse(403, FORBIDDEN_BODY))

    const { result } = renderHook(() => useProgressPoll())
    await waitFor(() => expect(result.current.forbidden).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(120_000)
    })
    act(() => {
      result.current.refresh()
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flushFetch()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(flash).not.toHaveBeenCalled()
  })

  it('keeps polling for a user who may see progress', async () => {
    const fetchMock = installFetch(() => createMockResponse(200, JOBS_BODY))

    const { result } = renderHook(() => useProgressPoll())
    await waitFor(() => expect(result.current.activeJobs).toHaveLength(1))
    expect(result.current.forbidden).toBe(false)

    await act(async () => {
      jest.advanceTimersByTime(5_000)
    })
    await flushFetch()

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('leaves the 401 session-refresh redirect alone', async () => {
    installFetch(() => createMockResponse(401, { error: 'Unauthorized' }))

    const { result } = renderHook(() => useProgressPoll())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(flash).toHaveBeenCalledWith('Session expired. Redirecting to sign in…', 'warning')
    expect(result.current.forbidden).toBe(false)
    expect(result.current.error).toBeTruthy()
  })
})

describe('useProgressSse without progress.view', () => {
  it('reads 403 as empty lists and ignores later events, focus and refresh', async () => {
    const fetchMock = installFetch(() => createMockResponse(403, FORBIDDEN_BODY))

    const { result } = renderHook(() => useProgressSse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(sentHeader(fetchMock, 'x-om-forbidden-redirect')).toBe('0')
    expect(flash).not.toHaveBeenCalled()
    expect(result.current.forbidden).toBe(true)
    expect(result.current.activeJobs).toEqual([])
    expect(result.current.recentlyCompleted).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_EVENT_DOM_NAME, {
          detail: { id: 'progress.job.updated', payload: { jobId: 'job-9', status: 'running' } },
        }),
      )
      window.dispatchEvent(
        new CustomEvent(APP_EVENT_DOM_NAME, {
          detail: { id: 'progress.job.created', payload: {} },
        }),
      )
      window.dispatchEvent(new Event('focus'))
      result.current.refresh()
    })
    await flushFetch()

    expect(result.current.activeJobs).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(flash).not.toHaveBeenCalled()
  })

  it('still lists jobs for a user who may see progress', async () => {
    installFetch(() => createMockResponse(200, JOBS_BODY))

    const { result } = renderHook(() => useProgressSse())
    await waitFor(() => expect(result.current.activeJobs).toHaveLength(1))
    expect(result.current.forbidden).toBe(false)
  })
})
