import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '../utils'
import { useWidgetLink } from './WidgetCard'

/*
  Figma "V5 · Lista to-do" (586:754). Rows edge to edge (`<WidgetCard bleed>`).
    row        40 high, padding 0 / 24 / 0 / 12, list gap 4
    checkbox   40×40 target, 18px box radius 2; checked = primary fill +
               white check; unchecked = 2px on-surface-variant stroke
    title      Regular 14/20 on-surface; done = on-surface-variant + strike
    due        Regular 11/16: neutral variant, `soon` amber, `overdue` red
    add row    "+ …" Medium 14 on-surface, padding-left 24 — turns into an
               inline input (inline add-rows, never a modal)
*/

export type TodoDueTone = 'neutral' | 'soon' | 'overdue'

export type TodoItem = {
  id: string
  title: React.ReactNode
  done?: boolean
  due?: React.ReactNode
  dueTone?: TodoDueTone
  href?: string
}

export type TodoListProps = {
  items: TodoItem[]
  onToggle?: (id: string, done: boolean) => void
  /** Per-row trailing slot (reschedule / reject menu). */
  renderActions?: (item: TodoItem) => React.ReactNode
  /** Enables the inline add row. */
  onAdd?: (title: string) => void | Promise<void>
  addLabel?: string
  addPlaceholder?: string
  /** Accessible label for each checkbox, e.g. (title) => `Zakończ: ${title}`. */
  toggleLabel?: (item: TodoItem) => string
  className?: string
}

const DUE_TONE: Record<TodoDueTone, string> = {
  neutral: 'text-m3ft-on-surface-variant',
  soon: 'text-m3ft-warning',
  overdue: 'text-m3ft-error',
}

export function TodoList({
  items,
  onToggle,
  renderActions,
  onAdd,
  addLabel = '+',
  addPlaceholder,
  toggleLabel,
  className,
}: TodoListProps) {
  const Link = useWidgetLink()
  const [adding, setAdding] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const submit = async () => {
    const title = draft.trim()
    if (!title || !onAdd) return
    setBusy(true)
    try {
      await onAdd(title)
      setDraft('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const label = toggleLabel ? toggleLabel(item) : typeof item.title === 'string' ? item.title : item.id
          const titleClass = cn(
            'min-w-0 flex-1 truncate text-body-regular-sm',
            item.done ? 'text-m3ft-on-surface-variant line-through' : 'text-m3ft-on-surface',
          )
          return (
            <li key={item.id} className="group flex h-10 items-center pr-6 pl-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={!!item.done}
                aria-label={label}
                disabled={!onToggle}
                onClick={() => onToggle?.(item.id, !item.done)}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-m3ft-surface-container focus-visible:bg-m3ft-surface-container focus-visible:outline-none"
              >
                <span
                  className={cn(
                    'inline-flex size-[18px] items-center justify-center rounded-[2px]',
                    item.done ? 'bg-m3ft-primary text-m3ft-on-primary' : 'border-2 border-m3ft-on-surface-variant',
                  )}
                >
                  {item.done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
                </span>
              </button>
              {item.href ? (
                <Link href={item.href} className={cn(titleClass, 'hover:underline')}>
                  {item.title}
                </Link>
              ) : (
                <span className={titleClass}>{item.title}</span>
              )}
              {item.due ? (
                <span className={cn('ml-3 shrink-0 text-body-regular-2xs tabular-nums', DUE_TONE[item.dueTone ?? 'neutral'])}>
                  {item.due}
                </span>
              ) : null}
              {renderActions ? <span className="ml-1 shrink-0">{renderActions(item)}</span> : null}
            </li>
          )
        })}
      </ul>
      {onAdd ? (
        adding ? (
          <form
            className="flex items-center gap-2 px-6"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <input
              autoFocus
              value={draft}
              disabled={busy}
              placeholder={addPlaceholder}
              aria-label={addPlaceholder ?? addLabel}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDraft('')
                  setAdding(false)
                }
              }}
              onBlur={() => {
                if (!draft.trim()) setAdding(false)
              }}
              className="h-8 min-w-0 flex-1 rounded-[8px] border border-m3ft-outline-variant bg-m3ft-surface px-3 text-body-regular-sm text-m3ft-on-surface placeholder:text-m3ft-on-surface-variant focus:border-m3ft-primary focus:outline-none"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="self-start px-6 text-body-medium-sm text-m3ft-on-surface hover:underline"
          >
            {addLabel}
          </button>
        )
      ) : null}
    </div>
  )
}
