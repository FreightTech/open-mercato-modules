import * as React from 'react'
import { Check, Copy, Mail, MessageSquare, Phone } from 'lucide-react'
import { cn } from '../utils'
import { useWidgetLink } from './WidgetCard'

/*
  ContactCard — Figma "T9 · Wizytówka" (674:1406). Rows edge to edge.
    row      padding 16 / 16 / 16 / 24, gap 12, separator between rows
    avatar   32 round, outline-variant fill, 1px outline stroke, initials
             Medium 14 on-surface-variant
    name     Medium 14/20 · role Regular 11/16 variant
    phone    20px icon variant + Regular 14 on-surface
    email    20px icon variant + Regular 14 primary (mailto)
    action   20px chat icon, top-right
*/

export type ContactCardPerson = {
  id: string
  name: string
  initials: string
  role?: React.ReactNode
  phone?: string
  email?: string
  /** Extra chips/lines under the role (decision-map attributes). */
  extra?: React.ReactNode
  href?: string
}

export function ContactList({
  people,
  onAction,
  actionLabel,
  renderAction,
}: {
  people: ContactCardPerson[]
  onAction?: (person: ContactCardPerson) => void
  actionLabel?: string
  renderAction?: (person: ContactCardPerson) => React.ReactNode
}) {
  const Link = useWidgetLink()
  return (
    <ul className="flex flex-col">
      {people.map((p) => (
        <li key={p.id} className="flex gap-3 border-b border-m3ft-outline-variant py-4 pr-4 pl-6 last:border-b-0">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-m3ft-outline bg-m3ft-outline-variant text-body-medium-sm text-m3ft-on-surface-variant">
            {p.initials}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-col">
              {p.href ? (
                <Link href={p.href} className="truncate text-body-medium-sm text-m3ft-on-surface hover:underline">
                  {p.name}
                </Link>
              ) : (
                <span className="truncate text-body-medium-sm text-m3ft-on-surface">{p.name}</span>
              )}
              {p.role ? <span className="text-body-regular-2xs text-m3ft-on-surface-variant">{p.role}</span> : null}
            </div>
            {p.extra}
            {p.phone ? (
              <span className="flex items-center gap-2 text-body-regular-sm text-m3ft-on-surface">
                <Phone className="size-4 shrink-0 text-m3ft-on-surface-variant" aria-hidden />
                <span className="tabular-nums">{p.phone}</span>
              </span>
            ) : null}
            {p.email ? (
              <a href={`mailto:${p.email}`} className="flex min-w-0 items-center gap-2 text-body-regular-sm text-m3ft-primary hover:underline">
                <Mail className="size-4 shrink-0 text-m3ft-on-surface-variant" aria-hidden />
                <span className="truncate">{p.email}</span>
              </a>
            ) : null}
          </div>
          {renderAction ? (
            renderAction(p)
          ) : onAction ? (
            <button
              type="button"
              aria-label={actionLabel}
              onClick={() => onAction(p)}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-m3ft-on-surface-variant transition-colors hover:bg-m3ft-surface-container"
            >
              <MessageSquare className="size-5" aria-hidden />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/*
  InfoGrid — Figma "Informacje · 4 wersje" (670:1364).
    V1 key-value   2 columns, column gap 24, pair gap 16; label Regular 11/16
                   variant, gap 4, value Regular 14/20 on-surface; IDs get a
                   copy button and mono type
    V2 sections    section title Medium 12 variant; sections split by a
                   full-width 1px outline-variant rule
    V3 hero fact   surface-container-low box radius 8, padding 12/16:
                   caption 11 + value Regular 24 + meta 11
    value tones    warning → amber (e.g. "2 dni")
*/

export type InfoField = {
  label: string
  value: React.ReactNode
  /** Copyable identifier (NIP, file number) — rendered mono with a copy button. */
  copy?: string
  tone?: 'default' | 'warning' | 'error'
  /** Span both columns. */
  wide?: boolean
}

export type InfoSection = { title?: string; fields: InfoField[] }

const VALUE_TONE = {
  default: 'text-m3ft-on-surface',
  warning: 'text-m3ft-warning',
  error: 'text-m3ft-error',
} as const

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [done, setDone] = React.useState(false)
  return (
    <button
      type="button"
      aria-label={done ? copiedLabel : label}
      title={done ? copiedLabel : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          window.setTimeout(() => setDone(false), 1500)
        } catch {
          /* clipboard refused — the value stays selectable */
        }
      }}
      className="inline-flex size-6 items-center justify-center rounded-full text-m3ft-on-surface-variant transition-colors hover:bg-m3ft-surface-container"
    >
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  )
}

export function InfoGrid({
  sections,
  hero,
  copyLabel = 'Copy',
  copiedLabel = 'Copied',
  className,
}: {
  sections: InfoSection[]
  hero?: { caption: string; value: React.ReactNode; meta?: React.ReactNode }
  copyLabel?: string
  copiedLabel?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {hero ? (
        <div className="flex flex-col gap-1 rounded-[8px] bg-m3ft-surface-container-low px-4 py-3">
          <span className="text-body-regular-2xs text-m3ft-on-surface-variant">{hero.caption}</span>
          <span className="text-heading-semibold-2xl tabular-nums text-m3ft-on-surface">{hero.value}</span>
          {hero.meta ? <span className="text-body-regular-2xs text-m3ft-on-surface-variant">{hero.meta}</span> : null}
        </div>
      ) : null}
      {sections.map((s, i) => (
        <div
          key={s.title ?? i}
          className={cn('flex flex-col gap-3', i > 0 && '-mx-6 border-t border-m3ft-outline-variant px-6 pt-4')}
        >
          {s.title ? <p className="text-caption-medium-md text-m3ft-on-surface-variant">{s.title}</p> : null}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            {s.fields.map((f) => (
              <div key={f.label} className={cn('flex min-w-0 flex-col gap-1', f.wide && 'col-span-2')}>
                <dt className="text-body-regular-2xs text-m3ft-on-surface-variant">{f.label}</dt>
                <dd className={cn('flex min-w-0 items-center gap-1 text-body-regular-sm', VALUE_TONE[f.tone ?? 'default'])}>
                  <span className={cn('min-w-0 break-words', f.copy && 'tabular-nums')}>{f.value}</span>
                  {f.copy ? <CopyButton value={f.copy} label={copyLabel} copiedLabel={copiedLabel} /> : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}
