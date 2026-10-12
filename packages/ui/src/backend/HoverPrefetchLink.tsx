'use client'

import * as React from 'react'
import Link from 'next/link'

type LinkProps = React.ComponentProps<typeof Link>

/**
 * `next/link` that prefetches a route only when the user points at it (hover, focus or touch), not when
 * it scrolls into view. Used for the app chrome: the sidebar, the top bar and the footer render every
 * module's link on every page, and the default viewport prefetch asked the server for ~55 route
 * prefetches on each full page load — as much server work as the page's own API calls (load test
 * 2026-10-09). A link the user is about to click is still prefetched, so navigation stays instant.
 */
const HoverPrefetchLink = React.forwardRef<HTMLAnchorElement, LinkProps>(function HoverPrefetchLink(
  { prefetch, onMouseEnter, onFocus, onTouchStart, ...props },
  ref,
) {
  const [active, setActive] = React.useState(false)
  if (prefetch === false) return <Link ref={ref} prefetch={false} onMouseEnter={onMouseEnter} onFocus={onFocus} onTouchStart={onTouchStart} {...props} />
  return (
    <Link
      ref={ref}
      {...props}
      prefetch={active ? (prefetch ?? null) : false}
      onMouseEnter={(e) => { setActive(true); onMouseEnter?.(e) }}
      onFocus={(e) => { setActive(true); onFocus?.(e) }}
      onTouchStart={(e) => { setActive(true); onTouchStart?.(e) }}
    />
  )
})

export default HoverPrefetchLink
