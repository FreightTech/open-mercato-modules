"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import {
  subscribeProgressUpdate,
  subscribeProgressComplete,
} from '@open-mercato/shared/lib/frontend/progressEvents'

export type ProgressJobDto = {
  id: string
  jobType: string
  name: string
  description?: string | null
  meta?: Record<string, unknown> | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  etaSeconds?: number | null
  cancellable: boolean
  startedAt?: string | null
  finishedAt?: string | null
  errorMessage?: string | null
}

export type UseProgressPollResult = {
  activeJobs: ProgressJobDto[]
  recentlyCompleted: ProgressJobDto[]
  isLoading: boolean
  error: string | null
  refresh: () => void
  /** The user lacks `progress.view` (403): the lists stay empty and no further poll is made. */
  forbidden?: boolean
}

const POLL_INTERVAL = 5000
// Nothing running → check every 30 s. The top bar only shows something while a job runs, a job this tab
// starts announces itself through progress events (refresh below), and the 5 s poll every open tab ran
// all day was 10 % of the server's time under load (load test 2026-10-09).
const IDLE_POLL_INTERVAL = 30000

// GET /api/progress/active requires the `progress.view` feature. The top bar is mounted for every
// backend user, so without this header apiFetch would answer the 403 with a redirect to /login for
// everyone who simply cannot see progress. With it the 403 comes back as a result and we stop asking.
export const PROGRESS_REQUEST_INIT: RequestInit = { headers: { 'x-om-forbidden-redirect': '0' } }

function isVisibleProgressJob(job: ProgressJobDto): boolean {
  return job.meta?.hiddenFromTopBar !== true
}

export function useProgressPoll(): UseProgressPollResult {
  const [activeJobs, setActiveJobs] = React.useState<ProgressJobDto[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = React.useState<ProgressJobDto[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  const forbiddenRef = React.useRef(false)

  const fetchJobs = React.useCallback(async () => {
    if (forbiddenRef.current) return
    try {
      const result = await apiCall<{ active: ProgressJobDto[]; recentlyCompleted: ProgressJobDto[] }>(
        '/api/progress/active',
        PROGRESS_REQUEST_INIT,
      )
      if (result.status === 403) {
        forbiddenRef.current = true
        setForbidden(true)
        setActiveJobs([])
        setRecentlyCompleted([])
        setError(null)
        return
      }
      if (result.ok && result.result) {
        setActiveJobs(result.result.active.filter(isVisibleProgressJob))
        setRecentlyCompleted(result.result.recentlyCompleted.filter(isVisibleProgressJob))
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch progress')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = React.useCallback(() => {
    fetchJobs()
  }, [fetchJobs])

  const pollInterval = activeJobs.length > 0 ? POLL_INTERVAL : IDLE_POLL_INTERVAL

  React.useEffect(() => {
    if (forbidden) return
    fetchJobs()
    let interval: ReturnType<typeof setInterval> | null = setInterval(fetchJobs, pollInterval)

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (interval) {
          clearInterval(interval)
          interval = null
        }
      } else {
        fetchJobs()
        interval = setInterval(fetchJobs, pollInterval)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchJobs, pollInterval, forbidden])

  React.useEffect(() => {
    const unsubUpdate = subscribeProgressUpdate(() => refresh())
    const unsubComplete = subscribeProgressComplete(() => refresh())
    return () => {
      unsubUpdate()
      unsubComplete()
    }
  }, [refresh])

  return { activeJobs, recentlyCompleted, isLoading, error, refresh, forbidden }
}
