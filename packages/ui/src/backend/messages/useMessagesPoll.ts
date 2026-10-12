"use client"

import * as React from 'react'
import { apiCall } from '../utils/apiCall'

export type MessagePollItem = {
  id: string
  type: string
  subject: string
  bodyPreview: string
  senderUserId: string
  senderName?: string | null
  senderEmail?: string | null
  priority: string
  status: string
  hasObjects: boolean
  objectCount: number
  hasAttachments: boolean
  attachmentCount: number
  hasActions: boolean
  actionTaken?: string | null
  sentAt?: string | null
  readAt?: string | null
  threadId?: string | null
}

export type UseMessagesPollResult = {
  messages: MessagePollItem[]
  unreadCount: number
  hasNew: boolean
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const POLL_INTERVAL = 5000

export function useMessagesPoll(): UseMessagesPollResult {
  const requestInit = React.useMemo(
    () => ({
      headers: {
        'x-om-forbidden-redirect': '0',
      },
    }),
    [],
  )
  const [messages, setMessages] = React.useState<MessagePollItem[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [hasNew, setHasNew] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const lastMessageIdRef = React.useRef<string | null>(null)
  const lastCountRef = React.useRef<number | null>(null)
  const pulseTimeoutRef = React.useRef<number | null>(null)

  // Each tick asks only for the unread count; the inbox list is fetched on the first tick, when the count
  // changes, or on refresh(). Fetching both every 5 s in every tab was 19 % of the server's time under
  // load, almost all of it re-reading a list that had not changed (load test 2026-10-09).
  const fetchMessages = React.useCallback(async (force = false) => {
    try {
      const countResult = await apiCall<{ unreadCount?: number }>('/api/messages/unread-count', requestInit)
      const rawCount = countResult.ok ? Number(countResult.result?.unreadCount ?? 0) : null
      const nextCount = rawCount !== null && Number.isFinite(rawCount) ? Math.max(0, rawCount) : null
      const needsList = force || lastCountRef.current === null || (nextCount !== null && nextCount !== lastCountRef.current)
      if (nextCount !== null) lastCountRef.current = nextCount
      const listResult = needsList
        ? await apiCall<{ items?: MessagePollItem[] }>('/api/messages?folder=inbox&page=1&pageSize=20', requestInit)
        : null

      if (listResult?.ok) {
        const nextMessages = Array.isArray(listResult.result?.items) ? listResult.result?.items ?? [] : []
        const firstId = nextMessages[0]?.id ?? null

        if (lastMessageIdRef.current && firstId && firstId !== lastMessageIdRef.current) {
          setHasNew(true)
          if (pulseTimeoutRef.current) {
            window.clearTimeout(pulseTimeoutRef.current)
          }
          pulseTimeoutRef.current = window.setTimeout(() => {
            setHasNew(false)
            pulseTimeoutRef.current = null
          }, 3000)
        }

        lastMessageIdRef.current = firstId
        setMessages(nextMessages)
      }

      if (countResult.ok) {
        setUnreadCount(nextCount ?? 0)
      }

      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to poll messages'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [requestInit])

  // Polls only while the tab is visible, and catches up the moment it is shown again. Every open tab
  // used to poll (two requests every 5 s) even in the background, so a person with three tabs open
  // cost the server three times the polling of a person with one.
  React.useEffect(() => {
    void fetchMessages()
    let interval: number | null = window.setInterval(() => {
      void fetchMessages()
    }, POLL_INTERVAL)
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (interval !== null) window.clearInterval(interval)
        interval = null
      } else if (interval === null) {
        void fetchMessages()
        interval = window.setInterval(() => {
          void fetchMessages()
        }, POLL_INTERVAL)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (document.hidden) onVisibilityChange()

    return () => {
      if (interval !== null) window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (pulseTimeoutRef.current) {
        window.clearTimeout(pulseTimeoutRef.current)
      }
    }
  }, [fetchMessages])

  return {
    messages,
    unreadCount,
    hasNew,
    isLoading,
    error,
    refresh: () => fetchMessages(true),
  }
}
