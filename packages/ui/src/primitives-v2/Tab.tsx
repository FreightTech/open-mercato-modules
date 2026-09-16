import * as React from 'react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Tab (component-set 45:90) and
  TabBar (component-set 183:453).

  Built from Tier 3 endpoints only — Tier 1 was rate-limited when this
  was added. Visual reference: per-variant thumbnails downloaded via
  `GET /v1/files/:key/components` + each component's `thumbnail_url`.
  See `.ai/figma-rules.md` "Rate limit" section.

  Variant matrix (verified by thumbnail + user correction):
    | State    | Text color           | Underline
    |----------|----------------------|---------------------------
    | default  | --status-v2-neutral- | —
    |          |   text (#71717A)     |
    | active   | --foreground-v2      | 2px --tab-v2-indicator
    |          |   (#18181A) + medium |   (Figma blue/500)
    | disabled | --muted-v2-foreground| —
    |          |   (#A0A0AA)          |

  Underline color was updated from `--accent-v2-bright` (teal-400) to
  the brand blue (`--tab-v2-indicator`) per FMS Teczka design — the
  teal Figma value read too cold against the navy primary CTAs in this
  app.

  Figma's `Tab` variant axis is just `state`. The `hasBadge` / `count`
  are **configurable component properties** (text + boolean), not
  variants — we expose them as React props (`badge`).

  `TabBar` provides context so multiple Tab children share a single
  `value` / `onChange` pair. Tabs can also be controlled by passing
  `isActive` directly when used outside a TabBar.
*/

// ── Context ──────────────────────────────────────────────────────

type TabBarContextValue = {
  value?: string
  onChange?: (next: string) => void
}

const TabBarContext = React.createContext<TabBarContextValue | null>(null)

// ── TabBar ───────────────────────────────────────────────────────

export type TabBarProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  /** Currently active tab `value`. */
  value?: string
  /** Called when a child Tab is clicked. */
  onChange?: (next: string) => void
  /** Optional aria-label for the tablist landmark. */
  ariaLabel?: string
}

export function TabBar({
  value,
  onChange,
  ariaLabel,
  className,
  children,
  ...props
}: TabBarProps) {
  const ctx = React.useMemo<TabBarContextValue>(() => ({ value, onChange }), [value, onChange])
  return (
    <TabBarContext.Provider value={ctx}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          'flex items-end gap-6 border-b border-border-v2',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </TabBarContext.Provider>
  )
}

// ── Tab ──────────────────────────────────────────────────────────

export type TabProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> & {
  /** Identifier used by the parent TabBar to track which tab is active. */
  value?: string
  /** Use this if the Tab is rendered outside a TabBar. Inside a TabBar the
   *  active state is derived from the bar's `value` prop. */
  isActive?: boolean
  /** Optional numeric/text badge rendered after the label. */
  badge?: React.ReactNode
}

export const Tab = React.forwardRef<HTMLButtonElement, TabProps>(function Tab(
  { value, isActive, badge, className, children, disabled, onClick, ...props },
  ref,
) {
  const ctx = React.useContext(TabBarContext)
  const active =
    isActive !== undefined ? isActive : ctx && value !== undefined && ctx.value === value

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) return
    if (ctx?.onChange && value !== undefined) ctx.onChange(value)
  }

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={active || undefined}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        'relative inline-flex items-center gap-1.5 pb-2 pt-1 text-body-medium-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-v2 focus-visible:ring-offset-1',
        active
          ? // active: dark text + --tab-v2-indicator underline (offset to overlap the TabBar's border-bottom)
            cn(
              'text-foreground-v2 font-medium cursor-pointer',
              'after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:bg-tab-v2-indicator after:content-[""]',
            )
          : disabled
            ? 'text-muted-v2-foreground cursor-not-allowed'
            : 'text-status-v2-neutral-text hover:text-foreground-v2 cursor-pointer',
        className,
      )}
      {...props}
    >
      {children}
      {badge != null ? (
        <span
          className={cn(
            'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-label-semibold-xs',
            active
              ? 'bg-accent-v2/10 text-accent-v2'
              : 'bg-status-v2-neutral-bg text-status-v2-neutral-text',
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
})
