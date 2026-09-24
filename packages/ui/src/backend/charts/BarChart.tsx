"use client"

import * as React from 'react'
import {
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { Spinner } from '@freighttech/ui/primitives/spinner'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'

export type BarChartDataItem = Record<string, string | number | null | undefined>

/** A target/zero plotLine parallel to one axis (e.g. margin target, zero baseline). */
export type BarChartReferenceLine = {
  axis: 'x' | 'y'
  value: number
  label?: string
  color?: string
  dashed?: boolean
}

export type BarChartProps = {
  title?: string
  data: BarChartDataItem[]
  index: string
  categories: string[]
  loading?: boolean
  error?: string | null
  colors?: string[]
  layout?: 'vertical' | 'horizontal'
  valueFormatter?: (value: number) => string
  showLegend?: boolean
  showGridLines?: boolean
  className?: string
  emptyMessage?: string
  categoryLabels?: Record<string, string>
  /**
   * Per-datum bar color. When provided, single-category bars render a `<Cell>`
   * per datum so colors can encode sign/threshold (e.g. loss red / profit green,
   * overdue-age buckets). Returning `undefined` falls back to the series color.
   */
  getBarColor?: (datum: BarChartDataItem, index: number) => string | undefined
  /** Stack the series via a shared stackId (e.g. margin-distribution histogram). */
  stacked?: boolean
  /** Axis-parallel reference lines (target / zero plotLine). */
  referenceLines?: BarChartReferenceLine[]
  /**
   * Fill the parent's height instead of the fixed 200px. For a chart inside a
   * sized box (a dashboard or workspace pane): a fixed height overflowed a
   * short pane and put a scrollbar over the chart.
   */
  fillHeight?: boolean
}

function defaultValueFormatter(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function BarChart({
  title,
  data,
  index,
  categories,
  loading,
  error,
  colors,
  layout = 'vertical',
  valueFormatter = defaultValueFormatter,
  showLegend = true,
  showGridLines = true,
  className = '',
  emptyMessage = 'No data available',
  categoryLabels,
  getBarColor,
  stacked = false,
  referenceLines,
  fillHeight = false,
}: BarChartProps) {
  const getSeriesColor = (idx: number): string => {
    return resolveChartColor(colors?.[idx], idx)
  }

  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className

  if (error) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className={fillHeight ? 'flex h-full min-h-[7rem] items-center justify-center' : 'flex h-40 sm:h-48 items-center justify-center'}>
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className={fillHeight ? 'flex h-full min-h-[7rem] items-center justify-center' : 'flex h-40 sm:h-48 items-center justify-center'}>
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className={fillHeight ? 'flex h-full min-h-[7rem] items-center justify-center' : 'flex h-40 sm:h-48 items-center justify-center'}>
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  const isHorizontal = layout === 'horizontal'
  const chartHeight = fillHeight ? '100%' : isHorizontal ? Math.max(200, data.length * 28) : 200

  const chartContent = (
    <ResponsiveContainer width="100%" height={chartHeight}>
        <RechartsBarChart
          data={data}
          layout={isHorizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          {showGridLines && (
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          )}
          <XAxis
            type={isHorizontal ? 'number' : 'category'}
            dataKey={isHorizontal ? undefined : index}
            tickFormatter={isHorizontal ? valueFormatter : undefined}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type={isHorizontal ? 'category' : 'number'}
            dataKey={isHorizontal ? index : undefined}
            tickFormatter={isHorizontal ? undefined : valueFormatter}
            width={isHorizontal ? 90 : 50}
            interval={0}
            tick={{ fontSize: 10 }}
          />
          <Tooltip
            content={
              <ChartTooltipContent
                valueFormatter={valueFormatter}
                categoryLabels={categoryLabels}
                labelFormatter={(label, payload) => {
                  const entry = payload?.[0] as { payload?: BarChartDataItem } | undefined
                  const item = entry?.payload
                  return item?.[index] ? String(item[index]) : label
                }}
              />
            }
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
          />
          {showLegend && categories.length > 1 && (
            <Legend verticalAlign="top" height={36} />
          )}
          {referenceLines?.map((ref, refIdx) => (
            <ReferenceLine
              key={`ref-${refIdx}`}
              {...(ref.axis === 'x' ? { x: ref.value } : { y: ref.value })}
              stroke={ref.color ?? 'hsl(var(--muted-foreground))'}
              strokeDasharray={ref.dashed ? '6 3' : undefined}
              label={ref.label ? { value: ref.label, fontSize: 10 } : undefined}
            />
          ))}
          {categories.map((category, idx) => (
            <Bar
              key={category}
              dataKey={category}
              fill={getSeriesColor(idx)}
              radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              {...(stacked ? { stackId: 'bar' } : {})}
            >
              {getBarColor &&
                data.map((datum, dIdx) => {
                  const color = getBarColor(datum, dIdx)
                  return (
                    <Cell key={`cell-${dIdx}`} fill={color ?? getSeriesColor(idx)} />
                  )
                })}
            </Bar>
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
  )

  return (
    <div className={fillHeight ? `flex h-full min-h-0 flex-col ${wrapperClass}` : wrapperClass}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      {fillHeight ? <div className="min-h-0 flex-1">{chartContent}</div> : chartContent}
    </div>
  )
}

export default BarChart
