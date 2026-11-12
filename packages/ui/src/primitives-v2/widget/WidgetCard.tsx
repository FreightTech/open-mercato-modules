import * as React from 'react'
import { MoreVertical } from 'lucide-react'
import { cn } from '../utils'

/*
  Figma source: FMS-Widget-architecture → "Typologia widżetów" (page 549:542).
  Every widget family (charts, lists, activity, info, business card, process,
  KPI, table) shares ONE shell, measured node-by-node:

    Card        #FFFFFF · radius 12 · no border
                frame  1 px outline-variant, radius 16, no shadow (FMS card standard, 05.11)
    Content     vertical, padding 24 / 0 / 16 / 0, gap 16
      Header    padding-x 24, gap 8
                title    Roboto Medium 14/20  on-surface          (text-body-medium-sm)
                subtitle Roboto Regular 14/20 on-surface-variant  (text-body-regular-sm)
                ⋮        32×32 round, surface-container fill, 20px icon
      Banner    optional insight banner, padding-x 24 (see InsightBanner)
      Body      padding-x 24 by default; `bleed` removes it for full-width rows
    separator   1px outline-variant
    Footer-CTA  height 48, padding 0 / 16 / 0 / 24, right-aligned text button
                (Medium 14/20, on-surface) = "see all" → the parent place.

  Colours come from the `--m3ft-v2-*` tokens (m3-freighttech.css). All copy
  is passed in by the consumer — this component holds no strings.
*/

export type WidgetLinkProps = {
  href: string
  className?: string
  children: React.ReactNode
}

/**
 * Link renderer used by every widget footer / row link. Defaults to a plain
 * `<a>`; a Next.js host provides `next/link` once through
 * `<WidgetLinkProvider>` so widget links navigate client-side.
 */
const WidgetLinkContext = React.createContext<React.ComponentType<WidgetLinkProps>>(
  function PlainLink({ href, className, children }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    )
  },
)

export function WidgetLinkProvider({
  component,
  children,
}: {
  component: React.ComponentType<WidgetLinkProps>
  children: React.ReactNode
}) {
  return <WidgetLinkContext.Provider value={component}>{children}</WidgetLinkContext.Provider>
}

export function useWidgetLink() {
  return React.useContext(WidgetLinkContext)
}

export type WidgetFooter = {
  /** Text-button label — "Zobacz wszystkie", "Przejdź do listy", … */
  label: string
  /** Parent place; rendered through the WidgetLinkProvider link. */
  href?: string
  onClick?: () => void
  /** Optional filled primary action on the left of the footer (TRIGGER state). */
  action?: { label: string; onClick: () => void }
}

export type WidgetCardProps = Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Opens the widget menu. The ⋮ button renders only when this is set. */
  onMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void
  menuLabel?: string
  /** Replaces the ⋮ button (e.g. a segmented period switch). */
  actions?: React.ReactNode
  /** Slot between header and body — usually an `<InsightBanner>`. */
  banner?: React.ReactNode
  /** Extra header content under the title (e.g. activity filter chips). */
  headerExtra?: React.ReactNode
  footer?: WidgetFooter
  /** Body without horizontal padding — list rows run edge to edge. */
  bleed?: boolean
  /** Content under the body, above the footer, full-width (e.g. a composer). */
  bottom?: React.ReactNode
  bodyClassName?: string
}

export const WidgetCard = React.forwardRef<HTMLElement, WidgetCardProps>(function WidgetCard(
  {
    title,
    subtitle,
    onMenu,
    menuLabel = 'Menu',
    actions,
    banner,
    headerExtra,
    footer,
    bleed = false,
    bottom,
    className,
    bodyClassName,
    children,
    ...props
  },
  ref,
) {
  const Link = useWidgetLink()
  const titleId = React.useId()
  return (
    <section
      ref={ref}
      aria-labelledby={titleId}
      className={cn(
        // FMS card standard (owner 05.11, one frame for every widget — Pulpit panes, CRM, Finanse): radius 16, a 1 px
        // outline-variant line, no shadow, 16 px inset.
        'flex min-w-0 flex-col overflow-hidden rounded-[16px] border border-m3ft-outline-variant bg-m3ft-surface text-m3ft-on-surface',
        className,
      )}
      {...props}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 pt-4 pb-4">
        <header className="flex flex-col gap-3 px-4">
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 id={titleId} className="truncate text-body-medium-sm font-semibold text-m3ft-on-surface">
                {title}
              </h3>
              {subtitle ? (
                <p className="truncate text-body-regular-sm text-m3ft-on-surface-variant">{subtitle}</p>
              ) : null}
            </div>
            {actions ??
              (onMenu ? (
                <button
                  type="button"
                  aria-label={menuLabel}
                  onClick={onMenu}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-m3ft-surface-container text-m3ft-on-surface-variant transition-colors hover:bg-m3ft-surface-container-high focus-visible:outline-2 focus-visible:outline-m3ft-primary"
                >
                  <MoreVertical className="size-5" aria-hidden />
                </button>
              ) : null)}
          </div>
          {headerExtra}
        </header>
        {banner ? <div className="px-4">{banner}</div> : null}
        <div className={cn('min-h-0 flex-1', !bleed && 'px-4', bodyClassName)}>{children}</div>
      </div>
      {bottom ? <div className="border-t border-m3ft-outline-variant">{bottom}</div> : null}
      {footer ? (
        <footer className="flex h-12 shrink-0 items-center justify-end gap-1 px-4">
          {footer.action ? (
            <button
              type="button"
              onClick={footer.action.onClick}
              className="mr-auto inline-flex h-8 items-center rounded-full bg-m3ft-primary px-3 text-body-medium-sm text-m3ft-on-primary transition-opacity hover:opacity-90"
            >
              {footer.action.label}
            </button>
          ) : null}
          {footer.href ? (
            <Link href={footer.href} className={FOOTER_BUTTON}>
              {footer.label}
            </Link>
          ) : (
            <button type="button" onClick={footer.onClick} className={FOOTER_BUTTON}>
              {footer.label}
            </button>
          )}
        </footer>
      ) : null}
    </section>
  )
})

const FOOTER_BUTTON =
  'inline-flex h-8 items-center rounded-full px-3 text-body-medium-sm text-m3ft-on-surface transition-colors hover:bg-m3ft-surface-container'
