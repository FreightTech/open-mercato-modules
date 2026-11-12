"use client"

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@open-mercato/shared/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider

export const Tooltip = TooltipPrimitive.Root

export const TooltipTrigger = TooltipPrimitive.Trigger

/**
 * One tooltip look for the app (FMS UX 03.11): the inverse of the page — the reading colour as the surface, the page
 * colour as the text — radius 8, 12/16 text, the M3 menu motion. `TooltipContent` and the `title` layer
 * (`TitleTooltips`) both wear it, so a hover hint looks the same wherever it comes from.
 */
export const tooltipSurfaceClass =
  'z-[var(--z-tooltip,60)] max-w-xs break-words rounded-[var(--m3-shape-sm)] bg-[var(--foreground-v2)] px-2.5 py-1.5 text-body-regular-xs text-[var(--background-v2)] shadow-[var(--m3-elevation-2)]'

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        tooltipSurfaceClass,
        'overflow-hidden',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export type TooltipProps = {
  content: React.ReactNode
  children: React.ReactNode
  delayDuration?: number
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
}

/**
 * Simple tooltip wrapper component for common use cases.
 *
 * @example
 * <SimpleTooltip content="Full text here">
 *   <span>Truncated...</span>
 * </SimpleTooltip>
 */
export function SimpleTooltip({
  content,
  children,
  delayDuration = 300,
  side = 'top',
  align = 'center',
  open,
  onOpenChange,
  disabled = false,
}: TooltipProps) {
  // If disabled or no content, just render children without tooltip
  const isDisabled = disabled || !content

  if (isDisabled) {
    return <>{children}</>
  }

  return (
    <Tooltip
      open={open}
      onOpenChange={onOpenChange}
      delayDuration={delayDuration}
    >
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
