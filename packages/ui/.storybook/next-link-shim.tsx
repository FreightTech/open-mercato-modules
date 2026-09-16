// Static shim for `next/link` used by Storybook. The real `Link`
// requires the Next.js App Router context, which doesn't exist under
// Vite. Stories don't actually navigate — they only need the visual
// surface — so rendering a plain `<a>` is sufficient.
import * as React from 'react'

type Props = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string }
  /** Accepted to mirror the real API; ignored here. */
  prefetch?: boolean
  /** Accepted to mirror the real API; ignored here. */
  replace?: boolean
  /** Accepted to mirror the real API; ignored here. */
  scroll?: boolean
  /** Accepted to mirror the real API; ignored here. */
  shallow?: boolean
}

const Link = React.forwardRef<HTMLAnchorElement, Props>(function Link(
  { href, prefetch: _p, replace: _r, scroll: _s, shallow: _sh, children, ...rest },
  ref,
) {
  const stringHref = typeof href === 'string' ? href : href?.pathname ?? '#'
  return (
    <a ref={ref} href={stringHref} onClick={(e) => e.preventDefault()} {...rest}>
      {children}
    </a>
  )
})

export default Link
