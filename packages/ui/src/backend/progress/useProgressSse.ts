"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import { useAppEvent } from '../injection/useAppEvent'
import { PROGRESS_REQUEST_INIT, type ProgressJobDto, type UseProgressPollResult } from './useProgressPoll'

function isVisibleProgressJob(job: ProgressJobDto): boolean {
  return job.meta?.hiddenFromTopBar !== true
}

function upsertJob(list: ProgressJobDto[], job: ProgressJobDto): ProgressJobDto[] {
  if (!isVisibleProgressJob(job)) {
    return list.filter((item) => item.id !== job.id)
  }
  const next = [job, ...list.filter((item) => item.id !== job.id)]
  return next.sort(
    (a, b) =>
      new Date(b.startedAt ?? b.finishedAt ?? 0).getTime()
      - new Date(a.startedAt ?? a.finishedAt ?? 0).getTime(),
  )
}

export function useProgressSse(): UseProgressPollResult {
  const [activeJobs, setActiveJobs] = React.useState<ProgressJobDto[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = React.useState<ProgressJobDto[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [forbidden, setForbidden] = React.useState(false)
  // Once the server says 403 (no `progress.view`), every later trigger — focus, bridge events,
  // refresh — is a no-op; the user cannot see progress until a reload with new grants.
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
    void fetchJobs()
  }, [fetchJobs])

  React.useEffect(() => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent(
    'progress.job.updated',
    (event) => {
      if (forbiddenRef.current) return
      const payload = event.payload as Partial<ProgressJobDto> & { jobId?: string }
      const jobId = payload?.jobId
      if (!jobId) {
        void fetchJobs()
        return
      }
      setActiveJobs((prev) =>
        upsertJob(prev, {
          id: jobId,
          jobType: payload.jobType ?? 'progress',
          name: payload.name ?? payload.jobType ?? 'Progress job',
          description: payload.description ?? null,
          meta: (payload.meta && typeof payload.meta === 'object') ? payload.meta as Record<string, unknown> : null,
          status: (payload.status as ProgressJobDto['status']) ?? 'running',
          progressPercent: payload.progressPercent ?? 0,
          processedCount: payload.processedCount ?? 0,
          totalCount: payload.totalCount ?? null,
          etaSeconds: payload.etaSeconds ?? null,
          cancellable: payload.cancellable ?? false,
          startedAt: payload.startedAt ?? null,
          finishedAt: payload.finishedAt ?? null,
          errorMessage: payload.errorMessage ?? null,
        }),
      )
    },
    [fetchJobs],
  )

  useAppEvent('progress.job.created', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('progress.job.started', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('progress.job.completed', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('progress.job.failed', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('progress.job.cancelled', () => {
    void fetchJobs()
  }, [fetchJobs])

  useAppEvent('om:bridge:reconnected', () => {
    void fetchJobs()
  }, [fetchJobs])

  React.useEffect(() => {
    const onFocus = () => {
      void fetchJobs()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchJobs])

  return { activeJobs, recentlyCompleted, isLoading, error, refresh, forbidden }
}
