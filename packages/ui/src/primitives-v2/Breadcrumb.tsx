import * as React from 'react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Breadcrumb (component-set 148:411).
  Variants by depth — we expose it via the items array length rather
  than discrete variant props. Long trails auto-collapse with an
  ellipsis when `maxItems` is exceeded.

  Composition over magic: callers pass an array of `BreadcrumbItem`s
  describing each crumb (`href`, `label`, optional `onClick`). The
  final crumb (current page) is automatically styled as non-link and
  marked `aria-current="page"`.
*/

export type BreadcrumbItem = {
  label: string
  href?: string
  onClick?: (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => void
}

export type BreadcrumbProps = React.HTMLAttributes<HTMLElement> & {
  items: BreadcrumbItem[]
  /** Beyond this number, intermediate crumbs collapse into "…". Default: 4. */
  maxItems?: number
  /** Custom separator. Defaults to a "/" slash (matches Figma). */
  separator?: React.ReactNode
}

export function Breadcrumb({
  items,
  maxItems = 4,
  separator,
  className,
  ...props
}: BreadcrumbProps) {
  const collapsed = items.length > maxItems
  const visibleItems: Array<BreadcrumbItem | 'ellipsis'> = collapsed
    ? [items[0]!, 'ellipsis', ...items.slice(items.length - (maxItems - 2))]
    : items

  const sep = separator ?? (
    <span className="text-muted-v2-foreground/70 select-none" aria-hidden="true">
      /
    </span>
  )

  return (
    <nav aria-label="Breadcrumb" className={cn('w-full', className)} {...props}>
      <ol className="flex flex-wrap items-center gap-1.5 text-body-regular-sm">
        {visibleItems.map((item, idx) => {
          const last = idx === visibleItems.length - 1
          if (item === 'ellipsis') {
            return (
              <li key={`ellipsis-${idx}`} className="flex items-center gap-1.5">
                <span
                  className="text-muted-v2-foreground"
                  aria-label={`${items.length - (maxItems - 1)} ukrytych elementów`}
                >
                  …
                </span>
                {!last ? sep : null}
              </li>
            )
          }
          return (
            <li key={`${item.label}-${idx}`} className="flex items-center gap-1.5">
              {last ? (
                <span aria-current="page" className="text-foreground-v2 font-medium">
                  {item.label}
                </span>
              ) : item.href ? (
                <a
                  href={item.href}
                  onClick={item.onClick}
                  className="rounded-sm text-muted-v2-foreground transition-colors hover:text-foreground-v2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-v2 focus-visible:ring-offset-1"
                >
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="rounded-sm text-muted-v2-foreground transition-colors hover:text-foreground-v2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-v2 focus-visible:ring-offset-1"
                >
                  {item.label}
                </button>
              )}
              {!last ? sep : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
