'use client'

import * as React from 'react'
import { createContext, useContext } from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

type TabsContextValue = {
  value: string
  onValueChange: (value: string) => void
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined)

function useTabsContext() {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs provider')
  }
  return context
}

export type TabsProps = {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
  className?: string
}

export function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  children,
  className,
}: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? '')
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : uncontrolledValue

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      if (!isControlled) {
        setUncontrolledValue(newValue)
      }
      onValueChange?.(newValue)
    },
    [isControlled, onValueChange],
  )

  return (
    <TabsContext.Provider value={{ value, onValueChange: handleValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export type TabsListProps = {
  children: React.ReactNode
  className?: string
}

// FMS UX 03.11: chip tabs, no segmented/underline — no track; the selected
// trigger takes `--m3-secondary-container`, the others are plain text with the
// hover state layer (the ChipTabs look in primitives-v2).
export function TabsList({ children, className }: TabsListProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-start gap-1 bg-transparent text-[var(--m3-on-surface-variant)]',
        className,
      )}
      role="tablist"
    >
      {children}
    </div>
  )
}

export type TabsTriggerProps = {
  value: string
  children: React.ReactNode
  className?: string
  disabled?: boolean
}

export function TabsTrigger({ value, children, className, disabled }: TabsTriggerProps) {
  const { value: selectedValue, onValueChange } = useTabsContext()
  const isSelected = selectedValue === value

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      data-state={isSelected ? 'active' : 'inactive'}
      disabled={disabled}
      onClick={() => onValueChange(value)}
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--m3-shape-full)] px-3 text-body-medium-sm',
        'transition-[background-color,color] duration-[var(--m3-duration-short2)] ease-[var(--m3-ease-standard)]',
        'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--field-v2-stroke-focus,#666)] disabled:pointer-events-none disabled:opacity-40',
        'text-[var(--m3-on-surface-variant)] data-[state=inactive]:hover:bg-[var(--m3-state-layer-hover)] data-[state=inactive]:hover:text-[var(--m3-on-surface)]',
        'data-[state=active]:bg-[var(--m3ft-v2-surface-container-high,var(--m3-surface-container-high))] data-[state=active]:text-[var(--m3ft-v2-on-surface,var(--m3-on-surface))]',
        className,
      )}
    >
      {children}
    </button>
  )
}

export type TabsContentProps = {
  value: string
  children: React.ReactNode
  className?: string
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { value: selectedValue } = useTabsContext()

  if (selectedValue !== value) {
    return null
  }

  return (
    <div
      role="tabpanel"
      className={cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)}
    >
      {children}
    </div>
  )
}
