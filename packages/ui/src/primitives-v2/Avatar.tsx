import * as React from 'react'
import { User } from 'lucide-react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Avatar (component-set 46:67).
  Note: Figma rate limit prevented re-walking the variants in this
  revision. Colours follow the v2 neutral palette:

    bg:    --secondary-v2  (#F4F4F5)
    text:  --muted-v2-foreground (#A0A0AA — for initials when image fails)

  Matrix: size × type (image / initials / icon / placeholder). Image
  load failures degrade gracefully to derived initials, then to the
  passed `icon`, then to a generic user placeholder.
*/

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export type AvatarProps = React.HTMLAttributes<HTMLSpanElement> & {
  size?: AvatarSize
  /** Image source. Falls back to initials/icon on error. */
  src?: string
  /** Alt text — also used as the source for derived initials when `initials` is not set. */
  name?: string
  /** Explicit initials (up to 2 characters). Wins over `name`-derived ones. */
  initials?: string
  /** Optional glyph. Renders when there's no image and no initials. */
  icon?: React.ReactNode
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
}

function deriveInitials(input: string | undefined): string {
  if (!input) return ''
  const parts = input.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { size = 'md', src, name, initials, icon, className, ...props },
  ref,
) {
  const [imageOk, setImageOk] = React.useState(true)
  React.useEffect(() => {
    setImageOk(true)
  }, [src])

  const resolvedInitials = initials ?? deriveInitials(name)
  const showImage = !!src && imageOk
  const showInitials = !showImage && !!resolvedInitials
  const showIcon = !showImage && !showInitials && !!icon

  return (
    <span
      ref={ref}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-secondary-v2 text-muted-v2-foreground font-semibold uppercase',
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name ?? ''}
          className="h-full w-full object-cover"
          onError={() => setImageOk(false)}
        />
      ) : showInitials ? (
        <span aria-hidden="true">{resolvedInitials}</span>
      ) : showIcon ? (
        <span aria-hidden="true" className="inline-flex h-1/2 w-1/2 items-center justify-center [&>svg]:h-full [&>svg]:w-full">
          {icon}
        </span>
      ) : (
        <User aria-hidden="true" className="h-1/2 w-1/2" />
      )}
      {!showImage && name ? <span className="sr-only">{name}</span> : null}
    </span>
  )
})

/*
  Stack of avatars used for "showing N participants" patterns. Trailing
  +N pill is added automatically when `max` is exceeded.
*/

export type AvatarStackProps = {
  size?: AvatarSize
  /** Maximum avatars to render before collapsing into a +N pill. */
  max?: number
  children: React.ReactNode
}

export function AvatarStack({ size = 'md', max = 4, children }: AvatarStackProps) {
  const items = React.Children.toArray(children)
  const visible = items.slice(0, max)
  const overflow = items.length - visible.length
  return (
    <div className="inline-flex">
      {visible.map((child, i) => (
        <span
          key={i}
          className={cn(
            'relative inline-flex',
            i > 0 ? '-ml-2' : null,
            'ring-2 ring-background-v2 rounded-full',
          )}
        >
          {React.isValidElement<{ size?: AvatarSize }>(child)
            ? React.cloneElement(child, { size })
            : child}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            '-ml-2 ring-2 ring-background-v2',
            'relative inline-flex shrink-0 select-none items-center justify-center rounded-full bg-secondary-v2 text-muted-v2-foreground font-semibold',
            SIZE_CLASSES[size],
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
