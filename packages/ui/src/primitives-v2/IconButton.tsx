import * as React from 'react'
import { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button'

/*
  Figma source: FMS-Componenets → IconButton (component-set 148:377).
  Matrix: state × size. Built as a thin wrapper around Button with
  `iconOnly` always true and the icon passed as the only content.
  This keeps the visual contract (radius, hover, focus ring, variants)
  in sync with Button — change one, change both.
*/

export type IconButtonProps = Omit<ButtonProps, 'iconOnly' | 'children' | 'icon' | 'iconPosition'> & {
  /** The icon to render. Required unless `asChild` is set (the child owns its content). */
  icon?: React.ReactNode
  /** Accessible label — required since the button has no visible text. */
  'aria-label': string
  variant?: ButtonVariant
  size?: ButtonSize
  /**
   * Render the square icon-button styling onto a single child element
   * (e.g. a Next.js `<Link>`) via Radix `Slot`. Pass the icon as the
   * child instead of the `icon` prop.
   */
  asChild?: boolean
  children?: React.ReactNode
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = 'ghost', size = 'md', asChild = false, children, ...props },
  ref,
) {
  if (asChild) {
    return (
      <Button ref={ref} variant={variant} size={size} iconOnly asChild {...props}>
        {children}
      </Button>
    )
  }
  return <Button ref={ref} variant={variant} size={size} iconOnly icon={icon} {...props} />
})
