'use client'

/**
 * "Udostępnij" for a saved layout — pick colleagues, send them a COPY.
 *
 * The designer's ask (recording 02:51): "I can send someone this view, so they
 * can import it on their side." A copy rather than a live link, on purpose:
 * the recipient gets a layout of their own that they can rename, re-arrange or
 * delete without reaching into the sender's; and a later edit by the sender
 * cannot silently rearrange someone else's screen. The copy records who sent
 * it, which is what the list shows ("od: Anna K.").
 *
 * People come from `/api/auth/users` with `name=` — the endpoint and the
 * parameter the @mention popup already uses, for the reason it documents:
 * `search=` does not look at the display name at all.
 */

import * as React from 'react'
import { Check, Loader2, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiFetch } from '../../utils/api'
import { Button } from '../../../primitives-v2'
import { useWidgetRenderContext } from '../registry/ContentRegistryContext'
import { AnchoredPanel } from './AnchoredMenu'
import { M3_MENU_CAPTION } from './chrome'

type Person = { id: string; name: string; email: string }

function toPeople(data: unknown): Person[] {
  const items = (data as { items?: unknown[] } | null)?.items ?? []
  return items
    .map((raw) => raw as Record<string, unknown>)
    .filter((row) => typeof row.id === 'string')
    .map((row) => ({
      id: row.id as string,
      name: typeof row.name === 'string' ? row.name : '',
      email: typeof row.email === 'string' ? row.email : '',
    }))
}

export function SharePanel({
  anchor,
  layoutName,
  onShare,
  onClose,
}: {
  anchor: HTMLElement
  layoutName: string
  onShare: (userIds: string[]) => Promise<number>
  onClose: () => void
}) {
  const t = useT()
  const context = useWidgetRenderContext()
  const [query, setQuery] = React.useState('')
  const [people, setPeople] = React.useState<Person[]>([])
  const [loading, setLoading] = React.useState(false)
  const [picked, setPicked] = React.useState<Map<string, Person>>(new Map())
  const [sending, setSending] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // A frame late: the panel is hidden for its first (measuring) frame.
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ pageSize: '20' })
        const needle = query.trim()
        if (needle) params.set('name', needle)
        const response = await apiFetch(`/api/auth/users?${params}`)
        const rows = response.ok ? toPeople(await response.json()) : []
        if (!cancelled) setPeople(rows.filter((person) => person.id !== context?.userId))
      } catch {
        if (!cancelled) setPeople([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, context?.userId])

  const toggle = (person: Person) => {
    setPicked((current) => {
      const next = new Map(current)
      if (next.has(person.id)) next.delete(person.id)
      else next.set(person.id, person)
      return next
    })
  }

  const send = async () => {
    if (picked.size === 0 || sending) return
    setSending(true)
    const count = await onShare(Array.from(picked.keys()))
    setSending(false)
    if (count > 0) onClose()
  }

  return (
    <AnchoredPanel
      anchor={anchor}
      placement={{ width: 300, preferredHeight: 400, align: 'end' }}
      onClose={onClose}
      role="dialog"
      aria-label={t('splitView.share.title', 'Share “{name}”', { name: layoutName })}
      className="!flex !flex-col !p-2"
      data-split-share=""
    >
      <div className="px-1 pb-1.5 text-body-medium-sm text-[var(--m3-on-surface)]">
        {t('splitView.share.title', 'Share “{name}”', { name: layoutName })}
      </div>
      <p className="px-1 pb-2 text-body-regular-xs text-[var(--m3-on-surface-variant)]">
        {t('splitView.share.hint', 'Each person gets their own copy to apply, rename or delete.')}
      </p>
      <div className="mb-1 flex h-8 shrink-0 items-center gap-2 rounded-m3-sm bg-[var(--m3-surface-container-high)] px-2 focus-within:bg-[var(--m3-surface-container-highest)] focus-within:shadow-[var(--m3-focus-ring-inset)]">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--m3-on-surface-variant)]" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('splitView.share.search', 'Search people…')}
          aria-label={t('splitView.share.search', 'Search people…')}
          className="min-w-0 flex-1 bg-transparent text-body-regular-xs text-[var(--m3-on-surface)] outline-none placeholder:text-[var(--m3-on-surface-variant)]"
          data-split-share-search=""
        />
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--m3-on-surface-variant)]" aria-hidden="true" />}
      </div>

      {picked.size > 0 && (
        <div className={`px-1 pb-0.5 pt-1 ${M3_MENU_CAPTION}`}>
          {t('splitView.share.selected', 'Selected: {count}', { count: String(picked.size) })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-multiselectable="true">
        {!loading && people.length === 0 && (
          <div className="px-2 py-4 text-center text-body-regular-xs text-[var(--m3-on-surface-variant)]">
            {t('splitView.share.none', 'No people found')}
          </div>
        )}
        {people.map((person) => {
          const on = picked.has(person.id)
          return (
            <button
              key={person.id}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => toggle(person)}
              className={`flex w-full items-center gap-2 rounded-m3-xs px-1.5 py-1 text-left transition-colors ${
                on
                  ? 'bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]'
                  : 'text-[var(--m3-on-surface)] hover:bg-[var(--m3-state-layer-hover)]'
              }`}
              data-split-share-person={person.email || person.id}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                  on ? 'border-transparent bg-[var(--m3-accent)] text-white' : 'border-[var(--m3-outline)]'
                }`}
                aria-hidden="true"
              >
                {on && <Check className="h-3 w-3" />}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body-regular-xs">{person.name || person.email}</span>
                {person.name && person.email && (
                  <span className={`truncate text-body-regular-2xs ${on ? 'opacity-80' : 'text-[var(--m3-on-surface-variant)]'}`}>
                    {person.email}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex justify-end gap-2 border-t border-[var(--m3-outline-variant)] pt-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('splitView.share.cancel', 'Cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={picked.size === 0 || sending}
          onClick={() => void send()}
          data-split-share-send=""
        >
          {t('splitView.share.action', 'Share')}
        </Button>
      </div>
    </AnchoredPanel>
  )
}

export default SharePanel
