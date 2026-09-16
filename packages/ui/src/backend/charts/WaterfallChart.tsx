"use client"

import * as React from 'react'
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts'
import { Spinner } from '@freighttech/ui/primitives/spinner'

export type WaterfallStep = {
  label: string
  /** Signed delta for a step, or the absolute value for a total/start bar. */
  value: number
  /** A total/subtotal bar starts from zero rather than the running cumulative. */
  isTotal?: boolean
}

export type WaterfallChartProps = {
  title?: string
  data: WaterfallStep[]
  loading?: boolean
  error?: string | null
  valueFormatter?: (value: number) => string
  /** Colors for increases / decreases / totals. */
  colorUp?: string
  colorDown?: string
  colorTotal?: string
  /**
   * Render a small value "pill" on every bar (PoC "Mostek EBITDA" style),
   * formatted via {@link valueFormatter}. Defaults to `false` to preserve
   * the current label-free behavior.
   */
  showValues?: boolean
  className?: string
  emptyMessage?: string
}

type Computed = {
  label: string
  base: number
  bar: number
  display: number
  fill: string
}

function defaultFmt(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/**
 * Build the transparent-base + visible-bar pairs for a waterfall. A total bar
 * starts at zero; a step bar starts at the running cumulative and moves by its
 * (possibly negative) delta. Exported for unit testing the geometry.
 */
export function computeWaterfall(
  data: WaterfallStep[],
  colors: { up: string; down: string; total: string },
): Computed[] {
  let cumulative = 0
  return data.map((step) => {
    if (step.isTotal) {
      const out: Computed = {
        label: step.label,
        base: 0,
        bar: Math.abs(step.value),
        display: step.value,
        fill: colors.total,
      }
      cumulative = step.value
      return out
    }
    const next = cumulative + step.value
    const base = Math.min(cumulative, next)
    const bar = Math.abs(step.value)
    const fill = step.value >= 0 ? colors.up : colors.down
    cumulative = next
    return { label: step.label, base, bar, display: step.value, fill }
  })
}

export function WaterfallChart({
  title,
  data,
  loading,
  error,
  valueFormatter = defaultFmt,
  colorUp = 'hsl(var(--chart-2, 160 84% 39%))',
  colorDown = 'hsl(var(--destructive))',
  colorTotal = 'hsl(var(--chart-1, 221 83% 53%))',
  showValues = false,
  className = '',
  emptyMessage = 'No data available',
}: WaterfallChartProps) {
  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className

  if (error) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }
  if (loading) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
    )
  }
  if (!data || data.length === 0) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  const computed = computeWaterfall(data, { up: colorUp, down: colorDown, total: colorTotal })

  const chartContent = (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={computed} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
        <YAxis tickFormatter={valueFormatter} tick={{ fontSize: 10 }} width={50} />
        <Tooltip
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as Computed
            return (
              <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
                <div className="mb-1 text-sm font-medium">{p.label}</div>
                <div className="text-sm tabular-nums">{valueFormatter(p.display)}</div>
              </div>
            )
          }}
        />
        {/* Transparent base lifts each visible bar to its starting height. */}
        <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="bar" stackId="wf" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {computed.map((c, idx) => (
            <Cell key={idx} fill={c.fill} />
          ))}
          {showValues && (
            <LabelList
              dataKey="display"
              content={(props) => {
                const { x, y, width } = props as {
                  x?: number
                  y?: number
                  width?: number
                  value?: number | string
                }
                const value = (props as { value?: number | string }).value
                if (
                  typeof x !== 'number' ||
                  typeof y !== 'number' ||
                  typeof width !== 'number' ||
                  typeof value !== 'number'
                ) {
                  return null
                }
                // Center the pill on the bar; sit it 6px above the bar's top edge.
                return (
                  <text
                    x={x + width / 2}
                    y={y - 6}
                    textAnchor="middle"
                    dominantBaseline="auto"
                    fontSize={10}
                    fontWeight={600}
                    fill="hsl(var(--foreground))"
                  >
                    {valueFormatter(value)}
                  </text>
                )
              }}
            />
          )}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  )

  return (
    <div className={wrapperClass}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      {chartContent}
    </div>
  )
}

export default WaterfallChart
