"use client"

import * as React from 'react'
import { createContext, useContext } from 'react'

export type ChartConfig = {
  [key: string]: {
    label?: string
    color?: string
  }
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = createContext<ChartContextProps | null>(null)

export function useChart() {
  const context = useContext(ChartContext)
  if (!context) {
    throw new Error('useChart must be used within a ChartContainer')
  }
  return context
}

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig
  children: React.ReactNode
}

export function ChartContainer({
  config,
  children,
  className,
  ...props
}: ChartContainerProps) {
  const configId = React.useId()

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={configId}
        className={className}
        {...props}
        style={
          {
            ...props.style,
            '--color-chart-1': 'var(--chart-v2-1)',
            '--color-chart-2': 'var(--chart-v2-2)',
            '--color-chart-3': 'var(--chart-v2-3)',
            '--color-chart-4': 'var(--chart-v2-4)',
            '--color-chart-5': 'var(--chart-v2-5)',
            ...Object.entries(config).reduce(
              (acc, [key, value]) => {
                if (value.color) {
                  acc[`--color-${key}`] = value.color
                }
                return acc
              },
              {} as Record<string, string>
            ),
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </ChartContext.Provider>
  )
}

interface ChartTooltipContentProps {
  active?: boolean
  payload?: Array<{
    name: string
    value: number
    color?: string
    dataKey?: string
    payload?: Record<string, unknown>
  }>
  label?: string
  labelFormatter?: (label: string, payload: unknown[]) => React.ReactNode
  valueFormatter?: (value: number) => string
  hideLabel?: boolean
  indicator?: 'line' | 'dot' | 'dashed'
  nameKey?: string
  categoryLabels?: Record<string, string>
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (value) => value.toLocaleString(),
  hideLabel = false,
  indicator = 'dot',
  nameKey,
  categoryLabels,
}: ChartTooltipContentProps) {
  if (!active || !payload?.length) {
    return null
  }

  return (
    <div className="rounded-[var(--menu-v2-radius,12px)] border border-[var(--menu-v2-stroke)] bg-[var(--menu-v2-bg)] px-3 py-2 text-body-regular-xs text-[var(--field-v2-text)] shadow-[var(--menu-v2-shadow)]">
      {!hideLabel && label && (
        <div className="mb-1 text-sm font-medium">
          {labelFormatter ? labelFormatter(label, payload) : label}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {payload
          // Hide internal helper series (e.g. ComboChart's forecast-band base/span
          // carriers keyed "__bandBase__"/"__bandSpan__") from the tooltip.
          .filter((item) => {
            const key = String((item as { dataKey?: unknown }).dataKey ?? '')
            return !key.startsWith('__')
          })
          .map((item, index) => {
          const rawName = nameKey && item.payload ? String(item.payload[nameKey]) : item.name
          const name = categoryLabels?.[rawName] ?? rawName
          return (
            <div key={index} className="flex items-center justify-between gap-8">
              <div className="flex items-center gap-2">
                {indicator === 'dot' && (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                {indicator === 'line' && (
                  <span
                    className="h-0.5 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                {indicator === 'dashed' && (
                  <span
                    className="h-0.5 w-3 shrink-0 rounded-full border-t-2 border-dashed"
                    style={{ borderColor: item.color }}
                  />
                )}
                <span className="text-sm text-muted-foreground">{name}</span>
              </div>
              <span className="text-sm font-medium tabular-nums">
                {valueFormatter(item.value)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// FMS UX 05.11 — one palette from the design-system tokens (`--chart-v2-*`, theme/tokens.v2.css), not shadcn's
// `--chart-1…5` (orange-first, defined per app). Signs use the roles: `--chart-v2-positive` / `--chart-v2-negative`.
export const CHART_COLORS = [
  'var(--chart-v2-1)',
  'var(--chart-v2-2)',
  'var(--chart-v2-3)',
  'var(--chart-v2-4)',
  'var(--chart-v2-5)',
  'var(--chart-v2-6)',
] as const

export const NAMED_COLORS: Record<string, string> = {
  // Named colours resolve to the token palette too, so a caller's "emerald" means "positive", not a Tailwind hue.
  blue: 'var(--chart-v2-1)',
  indigo: 'var(--chart-v2-3)',
  cyan: 'var(--chart-v2-2)',
  teal: 'var(--chart-v2-4)',
  amber: 'var(--chart-v2-5)',
  orange: 'var(--chart-v2-5)',
  violet: 'var(--chart-v2-6)',
  pink: 'var(--chart-v2-6)',
  emerald: 'var(--chart-v2-positive)',
  green: 'var(--chart-v2-positive)',
  rose: 'var(--chart-v2-negative)',
  red: 'var(--chart-v2-negative)',
  gray: 'var(--chart-v2-muted)',
  slate: 'var(--chart-v2-muted)',
}

export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}

export function resolveChartColor(color: string | undefined, index: number): string {
  if (color) {
    if (NAMED_COLORS[color]) {
      return NAMED_COLORS[color]
    }
    // Honor a literal CSS color (hex, rgb/rgba, hsl/hsla, or a var() token) so
    // callers can pass bespoke palette colors (e.g. the PoC navy/plan-grey)
    // instead of only the named-token set. Without this a raw hex falls through
    // to the default palette and the caller's color is silently ignored.
    if (/^(#|rgb|hsl|var\()/i.test(color)) {
      return color
    }
  }
  return CHART_COLORS[index % CHART_COLORS.length]
}
