import * as React from 'react'
import {
  Bell,
  CalendarCheck,
  CheckSquare,
  FileText,
  Link2,
  Mail,
  MessageSquare,
  Mic,
  Paperclip,
  Phone,
  Send,
  Settings2,
  StickyNote,
  Users,
} from 'lucide-react'
import { cn } from '../utils'
import { useWidgetLink } from './WidgetCard'

/*
  Figma "Czat / Aktywność" (597:696) — five states: all, notes,
  notifications, messages, empty.

  Filter chips (header, under the title)
    32 high, radius full, padding 6/12 (active) · 6/8, gap 4, row gap 8
    active   secondary-container fill, on-secondary-container Medium 14,
             white count badge
    idle     on-surface-variant Medium 14, surface-container count badge
    badge    20 high, padding 2/8, Medium 11
  Feed      gap 12; day separator Regular 11/16 on-surface-variant
  Event card surface-container-low fill, 1px outline-variant, radius 8,
             padding 12/16, gap 4
    meta     16px icon + type label Medium 12 on-surface + "· who · 11:40"
             Regular 11 variant
    body     indented 20, Regular 14/20; warning/error tone colours it
    link     14px link icon + Medium 11 primary ("FV-123")
  Message   24px avatar + name Medium 12 + time; bubble 12 padding,
             radius 4/12/12/12, surface-container; own message right-aligned,
             primary-container bubble, radius 12/4/12/12
  Composer  padding 12/24, gap 8: outlined field radius 8 · attach 40 round ·
             send 40 round primary
  Empty     padding 32/0, gap 8: 64 circle surface-container + icon,
             title Medium 14, text Regular 14 variant
*/

export type ActivityKind =
  | 'note'
  | 'notification'
  | 'email'
  | 'call'
  | 'meeting'
  | 'task'
  | 'document'
  | 'transcript'
  | 'system'
  | 'message'

const KIND_ICON: Record<ActivityKind, typeof Bell> = {
  note: StickyNote,
  notification: Bell,
  email: Mail,
  call: Phone,
  meeting: Users,
  task: CheckSquare,
  document: FileText,
  transcript: Mic,
  system: Settings2,
  message: MessageSquare,
}

export type ActivityEntry = {
  id: string
  kind: ActivityKind
  /** Day separator label; consecutive entries with the same day share one. */
  day?: string
  /** Type label shown in the meta line ("Notatka", "E-mail"). */
  label: string
  author?: string
  authorInitials?: string
  time?: string
  body: React.ReactNode
  tone?: 'default' | 'warning' | 'error'
  links?: Array<{ label: string; href: string }>
  /** Messages only: `out` = own message (right-aligned). */
  direction?: 'in' | 'out'
  /** Trailing slot on the meta line (e.g. a ⋮ menu). */
  actions?: React.ReactNode
}

export type ActivityFilter = { id: string; label: string; count?: number }

export function ActivityFilterChips({
  filters,
  active,
  onChange,
  label,
}: {
  filters: ActivityFilter[]
  active: string
  onChange: (id: string) => void
  label?: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
      {filters.map((f) => {
        const on = f.id === active
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(f.id)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1 rounded-full py-1.5 text-body-medium-sm transition-colors',
              on
                ? 'bg-m3ft-secondary-container px-3 text-m3ft-on-secondary-container'
                : 'px-2 text-m3ft-on-surface-variant hover:bg-m3ft-surface-container-low',
            )}
          >
            {f.label}
            {f.count != null ? (
              <span
                className={cn(
                  'inline-flex h-5 items-center rounded-full px-2 text-caption-medium-md tabular-nums',
                  on ? 'bg-m3ft-surface text-m3ft-on-secondary-container' : 'bg-m3ft-surface-container',
                )}
              >
                {f.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

const TONE_TEXT = {
  default: 'text-m3ft-on-surface',
  warning: 'text-m3ft-warning',
  error: 'text-m3ft-error',
} as const

function EventCard({ entry }: { entry: ActivityEntry }) {
  const Link = useWidgetLink()
  const Icon = KIND_ICON[entry.kind]
  const tone = entry.tone ?? 'default'
  return (
    <article className="flex flex-col gap-1 rounded-[8px] border border-m3ft-outline-variant bg-m3ft-surface-container-low px-4 py-3">
      <div className="flex items-center gap-1">
        <Icon className={cn('size-4 shrink-0', tone === 'default' ? 'text-m3ft-on-surface-variant' : TONE_TEXT[tone])} aria-hidden />
        <span className="text-caption-medium-md text-m3ft-on-surface">{entry.label}</span>
        <span className="min-w-0 flex-1 truncate text-body-regular-2xs text-m3ft-on-surface-variant">
          {[entry.author, entry.time].filter(Boolean).map((s) => ` · ${s}`).join('')}
        </span>
        {entry.actions}
      </div>
      <div className="flex flex-col gap-0.5 pl-5">
        <div className={cn('text-body-regular-sm whitespace-pre-line', TONE_TEXT[tone])}>{entry.body}</div>
        {entry.links?.length ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {entry.links.map((l) => (
              <Link key={l.href + l.label} href={l.href} className="inline-flex items-center gap-1 text-caption-medium-md text-m3ft-primary hover:underline">
                <Link2 className="size-3.5" aria-hidden />
                {l.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function MessageBubble({ entry }: { entry: ActivityEntry }) {
  const out = entry.direction === 'out'
  return (
    <div className={cn('flex gap-2', out && 'justify-end')}>
      {!out ? (
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-m3ft-outline bg-m3ft-outline-variant text-label-semibold-2xs text-m3ft-on-surface-variant">
          {entry.authorInitials}
        </span>
      ) : null}
      <div className={cn('flex max-w-[85%] flex-col gap-1', out && 'items-end')}>
        <div className="flex items-center gap-2">
          {!out && entry.author ? <span className="text-caption-medium-md text-m3ft-on-surface">{entry.author}</span> : null}
          {entry.time ? <span className="text-body-regular-2xs text-m3ft-on-surface-variant">{entry.time}</span> : null}
        </div>
        <div
          className={cn(
            'p-3 text-body-regular-sm',
            out
              ? 'rounded-[12px_4px_12px_12px] bg-m3ft-primary-container text-m3ft-on-primary-container'
              : 'rounded-[4px_12px_12px_12px] bg-m3ft-surface-container text-m3ft-on-surface',
          )}
        >
          {entry.body}
        </div>
      </div>
    </div>
  )
}

export function ActivityFeed({
  entries,
  empty,
  className,
}: {
  entries: ActivityEntry[]
  empty?: { title: string; text?: string; icon?: React.ReactNode }
  className?: string
}) {
  if (!entries.length && empty) return <WidgetEmptyState {...empty} icon={empty.icon ?? <MessageSquare aria-hidden />} />
  let lastDay: string | undefined
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {entries.map((e) => {
        const showDay = e.day && e.day !== lastDay
        lastDay = e.day ?? lastDay
        return (
          <React.Fragment key={e.id}>
            {showDay ? <p className="text-body-regular-2xs text-m3ft-on-surface-variant">{e.day}</p> : null}
            {e.kind === 'message' ? <MessageBubble entry={e} /> : <EventCard entry={e} />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export function ActivityComposer({
  placeholder,
  sendLabel,
  attachLabel,
  onSubmit,
  onAttach,
  disabled,
}: {
  placeholder: string
  sendLabel: string
  attachLabel?: string
  onSubmit: (text: string) => void | Promise<void>
  onAttach?: () => void
  disabled?: boolean
}) {
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const send = async () => {
    const value = text.trim()
    if (!value) return
    setBusy(true)
    try {
      await onSubmit(value)
      setText('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="flex items-center gap-2 px-6 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <textarea
        value={text}
        rows={1}
        disabled={disabled || busy}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void send()
          }
        }}
        className="min-h-14 min-w-0 flex-1 resize-none rounded-[8px] border border-m3ft-outline-variant bg-m3ft-surface px-4 py-4 text-body-regular-md text-m3ft-on-surface placeholder:text-m3ft-on-surface-variant focus:border-m3ft-primary focus:outline-none"
      />
      {onAttach ? (
        <button
          type="button"
          aria-label={attachLabel}
          onClick={onAttach}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-m3ft-on-surface-variant transition-colors hover:bg-m3ft-surface-container"
        >
          <Paperclip className="size-5" aria-hidden />
        </button>
      ) : null}
      <button
        type="submit"
        aria-label={sendLabel}
        disabled={disabled || busy || !text.trim()}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-m3ft-primary text-m3ft-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <Send className="size-5" aria-hidden />
      </button>
    </form>
  )
}

export function WidgetEmptyState({
  title,
  text,
  icon,
  action,
}: {
  title: string
  text?: string
  icon?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="mb-1 inline-flex size-16 items-center justify-center rounded-full bg-m3ft-surface-container text-m3ft-on-surface-variant [&>svg]:size-6">
        {icon ?? <CalendarCheck aria-hidden />}
      </span>
      <p className="text-body-medium-sm text-m3ft-on-surface">{title}</p>
      {text ? <p className="max-w-80 text-body-regular-sm text-m3ft-on-surface-variant">{text}</p> : null}
      {action}
    </div>
  )
}
