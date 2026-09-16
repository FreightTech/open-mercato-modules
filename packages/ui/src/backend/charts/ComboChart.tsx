"use client"

import * as React from 'react'
import {
  ComposedChart,
  Bar,
  Cell,
  Line,
  Area,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts'
import { Spinner } from '@freighttech/ui/primitives/spinner'
import { ChartTooltipContent, resolveChartColor } from './ChartUtils'

/**
 * Maps a Highcharts-style dashStyle onto a Recharts strokeDasharray. `solid`
 * (and anything unknown) yields `undefined` so the stroke renders continuous.
 */
export type ComboDashStyle = 'solid' | 'ShortDash' | 'Dash' | 'Dot'

const DASH_MAP: Record<ComboDashStyle, string | undefined> = {
  solid: undefined,
  ShortDash: '6 3',
  Dash: '8 5',
  Dot: '2 4',
}

export type ComboSeries = {
  /** dataKey present on each datum */
  key: string
  /** legend/tooltip label (already-translated) */
  name: string
  /** 'line' = monotone spline */
  type: 'bar' | 'line'
  color?: string
  /** default 'left' */
  yAxis?: 'left' | 'right'
  /** for line series */
  dashStyle?: ComboDashStyle
  /** bars sharing a stackId stack */
  stackId?: string
  /**
   * Bar-only: colour each datum by the sign of its value, so negative months
   * render in `negativeColor` (PoC "Wykonanie" behaviour). When absent the bar
   * uses a single `color` fill for every datum.
   */
  signColor?: boolean
  /** Bar-only: fill for negative data when `signColor` is true (default loss red #C0392B) */
  negativeColor?: string
}

/** forecast band Area(min..max), nulls in past => no band */
export type ComboBand = { minKey: string; maxKey: string; color?: string; name?: string }

/** e.g. "Teraz" scatter dot */
export type ComboMarker = { xValue: string | number; yValue: number; label?: string; color?: string }

export type ComboChartProps = {
  title?: string
  data: Array<Record<string, number | string | null>>
  /** x-axis category dataKey */
  index: string
  series: ComboSeries[]
  band?: ComboBand
  markers?: ComboMarker[]
  leftFormatter?: (v: number) => string
  rightFormatter?: (v: number) => string
  /** e.g. [0,100] for % overlay */
  rightDomain?: [number, number]
  /** zero plotLine */
  referenceY?: number
  showLegend?: boolean
  loading?: boolean
  error?: string | null
  emptyMessage?: string
  className?: string
  categoryLabels?: Record<string, string>
}

const BAND_BASE_KEY = '__bandBase__'
const BAND_SPAN_KEY = '__bandSpan__'

function defaultFormatter(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function ComboChart({
  title,
  data,
  index,
  series,
  band,
  markers,
  leftFormatter = defaultFormatter,
  rightFormatter = defaultFormatter,
  rightDomain,
  referenceY,
  showLegend = true,
  loading,
  error,
  emptyMessage = 'No data available',
  className = '',
  categoryLabels,
}: ComboChartProps) {
  const wrapperClass = `rounded-lg border bg-card p-4 ${className}`

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

  const hasRightAxis = series.some((s) => s.yAxis === 'right')

  // Build the forecast band as a transparent base Area (0 → min) plus a shaded
  // span Area (min → max) stacked on top. Where min/max are null (past months)
  // both derived keys stay null, so Recharts draws no band there.
  const chartData = React.useMemo(() => {
    if (!band) return data
    return data.map((d) => {
      const min = d[band.minKey]
      const max = d[band.maxKey]
      if (typeof min === 'number' && typeof max === 'number') {
        return { ...d, [BAND_BASE_KEY]: min, [BAND_SPAN_KEY]: max - min }
      }
      return { ...d, [BAND_BASE_KEY]: null, [BAND_SPAN_KEY]: null }
    })
  }, [data, band])

  const bandColor = band ? resolveChartColor(band.color, 1) : undefined

  // The "Teraz"-style markers ride on the SAME categorical x-axis. We must NOT
  // give the <Scatter> its own `data` prop: in a ComposedChart with
  // `allowDuplicatedCategory={false}`, a nested series carrying separate data
  // collapses the whole category axis onto just that series' categories (so a
  // single-point "Teraz" marker would flatten all 12 month bars into one). So
  // instead we merge the marker y-values into the parent chart data under a
  // private key at the matching x category, and the Scatter reads from there.
  const markerColor = React.useMemo(
    () => markers?.[0]?.color ?? resolveChartColor(undefined, 0),
    [markers],
  )
  const hasMarkers = !!markers && markers.length > 0
  const chartDataWithMarkers = React.useMemo(() => {
    if (!hasMarkers) return chartData
    const byX = new Map(markers!.map((m) => [String(m.xValue), m.yValue]))
    return chartData.map((d) => {
      const x = String((d as Record<string, unknown>)[index])
      return byX.has(x) ? { ...d, __markerY__: byX.get(x)! } : d
    })
  }, [chartData, markers, hasMarkers, index])

  return (
    <div className={wrapperClass}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartDataWithMarkers} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
            <defs>
              {band && (
                <linearGradient id="combo-band" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={bandColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={bandColor} stopOpacity={0.1} />
                </linearGradient>
              )}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey={index}
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              allowDuplicatedCategory={false}
            />
            <YAxis
              yAxisId="left"
              tickFormatter={leftFormatter}
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            {hasRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={rightDomain}
                tickFormatter={rightFormatter}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
            )}
            <Tooltip
              content={<ChartTooltipContent valueFormatter={leftFormatter} categoryLabels={categoryLabels} />}
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
            />
            {showLegend && (
              <Legend
                verticalAlign="top"
                height={36}
                formatter={(value) => (
                  <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '12px' }}>{value}</span>
                )}
              />
            )}

            {referenceY !== undefined && (
              <ReferenceLine
                yAxisId="left"
                y={referenceY}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1}
              />
            )}

            {/* Forecast band: transparent base lifts the shaded span to its floor. */}
            {band && (
              <Area
                yAxisId="left"
                dataKey={BAND_BASE_KEY}
                stackId="combo-band"
                stroke="none"
                fill="transparent"
                isAnimationActive={false}
                connectNulls={false}
                legendType="none"
                tooltipType="none"
                activeDot={false}
              />
            )}
            {band && (
              <Area
                yAxisId="left"
                dataKey={BAND_SPAN_KEY}
                name={band.name}
                stackId="combo-band"
                stroke="none"
                fill="url(#combo-band)"
                isAnimationActive={false}
                connectNulls={false}
                legendType={band.name ? 'rect' : 'none'}
                tooltipType="none"
                activeDot={false}
              />
            )}

            {series.map((s, idx) => {
              const color = resolveChartColor(s.color, idx)
              const yAxisId = s.yAxis === 'right' ? 'right' : 'left'
              if (s.type === 'bar') {
                const negativeColor = s.negativeColor ?? '#C0392B'
                return (
                  <Bar
                    key={s.key}
                    yAxisId={yAxisId}
                    dataKey={s.key}
                    name={s.name}
                    fill={color}
                    stackId={s.stackId}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  >
                    {s.signColor &&
                      data.map((d, i) => {
                        const v = d[s.key]
                        return (
                          <Cell
                            key={`${s.key}-${i}`}
                            fill={typeof v === 'number' && v < 0 ? negativeColor : color}
                          />
                        )
                      })}
                  </Bar>
                )
              }
              return (
                <Line
                  key={s.key}
                  yAxisId={yAxisId}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={DASH_MAP[s.dashStyle ?? 'solid']}
                  connectNulls
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              )
            })}

            {hasMarkers && (
              <Scatter
                yAxisId="left"
                dataKey="__markerY__"
                name={markers?.[0]?.label}
                fill={markerColor}
                isAnimationActive={false}
                shape="circle"
                legendType="none"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default ComboChart
