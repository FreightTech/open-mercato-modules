"use client"

import * as React from 'react'
import {
  ScatterChart as RechartsScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  ReferenceArea,
  LabelList,
  Customized,
} from 'recharts'
import { Spinner } from '@freighttech/ui/primitives/spinner'
import { resolveChartColor } from './ChartUtils'

export type ScatterChartDataItem = {
  x: number
  y: number
  /** Bubble size dimension (e.g. invoice value). */
  z?: number
  label?: string
  /** Force a specific color (e.g. red for a loss point). */
  color?: string
  /** Render an HTML pill callout next to this point (e.g. "Największa strata"). */
  pill?: string
  [key: string]: string | number | null | undefined
}

/**
 * Diagonal "plan = wykonanie" reference, drawn via Recharts
 * `<ReferenceLine segment={[{x,y},{x,y}]}/>`.
 */
export type ScatterReferenceSegment = {
  from: [number, number]
  to: [number, number]
  color?: string
  dashed?: boolean
  label?: string
}

/**
 * ±2σ band around the diagonal, given as a sigma offset applied along the
 * y-axis to a 45° plan=wykonanie diagonal. The band is the parallel strip
 * `y = x ± sigma`. Provide either this OR `bandBounds`.
 */
export type ScatterDiagonalBand = {
  sigma: number
  /** Diagonal anchor; defaults to the reference segment when present. */
  from?: [number, number]
  to?: [number, number]
  color?: string
}

/**
 * Explicit four-corner band: two parallel diagonals (lower + upper bound),
 * shaded between. Use when the band is not a symmetric ±sigma strip.
 */
export type ScatterBandBounds = {
  lowerFrom: [number, number]
  lowerTo: [number, number]
  upperFrom: [number, number]
  upperTo: [number, number]
  color?: string
}

/**
 * Optional multi-series mode (e.g. rozliczone solid vs koszt-w-toku hollow
 * ring; W normie / Poza normą buckets). When provided it takes precedence
 * over the single-`data` prop.
 */
export type ScatterMarkerShape = 'circle' | 'ring' | 'diamond' | 'square' | 'triangle' | 'triangleDown'

export type ScatterSeries = {
  name: string
  data: ScatterChartDataItem[]
  color?: string
  /**
   * Marker shape. 'ring' renders a hollow circle (transparent fill, colored
   * stroke); 'diamond' a hollow diamond (PoC "koszt w toku"); 'triangle' /
   * 'triangleDown' the up/down outlier markers (PoC "poza normą lepiej/gorzej").
   */
  shape?: ScatterMarkerShape
}

/** A labeled axis-parallel reference line (e.g. the median marża line). */
export type ScatterReferenceLine = {
  axis: 'x' | 'y'
  value: number
  label?: string
  color?: string
  dashed?: boolean
}

/** A shaded horizontal zone (e.g. the loss zone below y=0). */
export type ScatterShadedZone = {
  y1: number
  y2: number
  color?: string
  label?: string
}

export type ScatterChartProps = {
  title?: string
  data: ScatterChartDataItem[]
  xLabel?: string
  yLabel?: string
  loading?: boolean
  error?: string | null
  /** Default point color when an item doesn't set its own. */
  color?: string
  xFormatter?: (value: number) => string
  yFormatter?: (value: number) => string
  /** Optional reference lines (e.g. y=0 for the loss boundary, plan line). */
  referenceX?: number
  referenceY?: number
  zRange?: [number, number]
  onPointClick?: (item: ScatterChartDataItem) => void
  className?: string
  emptyMessage?: string
  /** Diagonal "plan = wykonanie" reference (two-point segment). */
  referenceSegment?: ScatterReferenceSegment
  /** ±2σ band around the diagonal (symmetric strip). */
  diagonalBand?: ScatterDiagonalBand
  /** Explicit four-corner band between two parallel diagonals. */
  bandBounds?: ScatterBandBounds
  /** Multi-series mode; when set, supersedes the single `data` prop for points. */
  series?: ScatterSeries[]
  /** Labeled axis-parallel reference lines (e.g. median marża). */
  referenceLines?: ScatterReferenceLine[]
  /** Shaded horizontal zone (e.g. loss zone y &lt; 0). */
  shadedZone?: ScatterShadedZone
  /** X-axis domain. Defaults to ['dataMin','dataMax'] so numeric/time points spread to the data range (not from 0). */
  xDomain?: [number | string, number | string]
  /** Y-axis domain. Defaults to ['dataMin','dataMax']. */
  yDomain?: [number | string, number | string]
}

/** Map our shape token to a Recharts Scatter `shape` value (ring/triangleDown handled separately). */
const RECHARTS_SHAPE: Record<string, 'circle' | 'diamond' | 'square' | 'triangle'> = {
  circle: 'circle',
  ring: 'circle',
  diamond: 'diamond',
  square: 'square',
  triangle: 'triangle',
  triangleDown: 'triangle',
}

function defaultFmt(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const DEFAULT_BAND_COLOR = 'hsl(var(--muted-foreground))'

// Recharts injects the full chart state (axis maps + scales) into a <Customized>
// child at runtime; these props are not in the public d.ts, so type them locally.
type AxisEntry = { scale?: (value: number) => number }
type AxisMap = Record<string, AxisEntry>
type CustomizedAxisProps = {
  xAxisMap?: AxisMap
  yAxisMap?: AxisMap
}

function firstScale(map: AxisMap | undefined): ((value: number) => number) | undefined {
  if (!map) return undefined
  const first = Object.values(map)[0]
  return first?.scale
}

/**
 * SVG polygon shading the ±2σ band between two parallel diagonals.
 * Rendered through <Customized>, reading the live x/y scales so the band
 * tracks the rendered axes exactly. This is a real filled polygon (not the
 * dashed-bounds fallback).
 */
function makeBandPolygon(bounds: {
  lowerFrom: [number, number]
  lowerTo: [number, number]
  upperFrom: [number, number]
  upperTo: [number, number]
  color: string
}) {
  return function BandPolygon(props: CustomizedAxisProps) {
    const xScale = firstScale(props.xAxisMap)
    const yScale = firstScale(props.yAxisMap)
    if (!xScale || !yScale) return null
    const pt = (p: [number, number]) => `${xScale(p[0])},${yScale(p[1])}`
    // lowerFrom -> lowerTo -> upperTo -> upperFrom closes the parallel strip.
    const points = [
      pt(bounds.lowerFrom),
      pt(bounds.lowerTo),
      pt(bounds.upperTo),
      pt(bounds.upperFrom),
    ].join(' ')
    return (
      <g>
        <polygon points={points} fill={bounds.color} fillOpacity={0.12} stroke="none" />
        <polyline
          points={`${pt(bounds.lowerFrom)} ${pt(bounds.lowerTo)}`}
          fill="none"
          stroke={bounds.color}
          strokeOpacity={0.5}
          strokeDasharray="4 4"
        />
        <polyline
          points={`${pt(bounds.upperFrom)} ${pt(bounds.upperTo)}`}
          fill="none"
          stroke={bounds.color}
          strokeOpacity={0.5}
          strokeDasharray="4 4"
        />
      </g>
    )
  }
}

/** Resolve a band spec (sigma strip or explicit bounds) to four corners. */
function resolveBandBounds(
  diagonalBand: ScatterDiagonalBand | undefined,
  bandBounds: ScatterBandBounds | undefined,
  referenceSegment: ScatterReferenceSegment | undefined,
): { lowerFrom: [number, number]; lowerTo: [number, number]; upperFrom: [number, number]; upperTo: [number, number]; color: string } | null {
  if (bandBounds) {
    return {
      lowerFrom: bandBounds.lowerFrom,
      lowerTo: bandBounds.lowerTo,
      upperFrom: bandBounds.upperFrom,
      upperTo: bandBounds.upperTo,
      color: bandBounds.color ?? DEFAULT_BAND_COLOR,
    }
  }
  if (diagonalBand) {
    const from = diagonalBand.from ?? referenceSegment?.from
    const to = diagonalBand.to ?? referenceSegment?.to
    if (!from || !to) return null
    const s = diagonalBand.sigma
    return {
      lowerFrom: [from[0], from[1] - s],
      lowerTo: [to[0], to[1] - s],
      upperFrom: [from[0], from[1] + s],
      upperTo: [to[0], to[1] + s],
      color: diagonalBand.color ?? DEFAULT_BAND_COLOR,
    }
  }
  return null
}

/** HTML-styled pill label for callout points (e.g. Największa strata/teczka). */
function PillLabel(props: {
  x?: number
  y?: number
  value?: string | number
}) {
  const { x, y, value } = props
  if (value == null || value === '' || x == null || y == null) return null
  const text = String(value)
  const width = Math.max(28, text.length * 6.2 + 14)
  // Concrete colors (NOT hsl(var(--token)) — CSS var() is not substituted in SVG
  // presentation attributes, which rendered the pills as solid black). White
  // rounded pill, light border, dark navy text — readable on any chart bg.
  return (
    <g transform={`translate(${x + 10}, ${y - 10})`} style={{ pointerEvents: 'none' }}>
      <rect
        width={width}
        height={18}
        rx={9}
        ry={9}
        fill="#ffffff"
        fillOpacity={0.96}
        stroke="#cbd5e1"
        strokeWidth={1}
      />
      <text
        x={width / 2}
        y={13}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill="#1f2937"
      >
        {text}
      </text>
    </g>
  )
}

export function ScatterChart({
  title,
  data,
  xLabel,
  yLabel,
  loading,
  error,
  color,
  xFormatter = defaultFmt,
  yFormatter = defaultFmt,
  referenceX,
  referenceY,
  zRange = [40, 400],
  onPointClick,
  className = '',
  emptyMessage = 'No data available',
  referenceSegment,
  diagonalBand,
  bandBounds,
  series,
  referenceLines,
  shadedZone,
  xDomain = ['dataMin', 'dataMax'],
  yDomain = ['dataMin', 'dataMax'],
}: ScatterChartProps) {
  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className

  const hasSeries = !!series && series.length > 0
  const isEmpty = hasSeries
    ? series!.every((s) => !s.data || s.data.length === 0)
    : !data || data.length === 0

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
  if (isEmpty) {
    return (
      <div className={wrapperClass}>
        {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  const resolvedBand = resolveBandBounds(diagonalBand, bandBounds, referenceSegment)

  const handleScatterClick = (point: unknown) => {
    if (onPointClick && point && typeof point === 'object' && 'payload' in point) {
      onPointClick((point as { payload: ScatterChartDataItem }).payload)
    }
  }

  const renderCells = (items: ScatterChartDataItem[], seriesColor: string, ring: boolean) =>
    items.map((item, idx) => (
      <Cell
        key={idx}
        fill={ring ? 'transparent' : (item.color ?? seriesColor)}
        stroke={ring ? (item.color ?? seriesColor) : undefined}
        strokeWidth={ring ? 1.5 : undefined}
        cursor={onPointClick ? 'pointer' : 'default'}
        fillOpacity={ring ? 1 : 0.7}
      />
    ))

  const chartContent = (
    <ResponsiveContainer width="100%" height={260}>
      <RechartsScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel}
          domain={xDomain}
          allowDataOverflow
          tickFormatter={xFormatter}
          tick={{ fontSize: 10 }}
          label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -10, fontSize: 10 } : undefined}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          domain={yDomain}
          allowDataOverflow
          tickFormatter={yFormatter}
          tick={{ fontSize: 10 }}
          width={50}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: 10 } : undefined}
        />
        <ZAxis type="number" dataKey="z" range={zRange} />
        {shadedZone && (
          <ReferenceArea
            y1={shadedZone.y1}
            y2={shadedZone.y2}
            fill={shadedZone.color ?? 'hsl(var(--destructive))'}
            fillOpacity={0.06}
            stroke="none"
            label={shadedZone.label ? { value: shadedZone.label, position: 'insideTopLeft', fontSize: 10, fill: shadedZone.color ?? 'hsl(var(--destructive))' } : undefined}
          />
        )}
        {resolvedBand && <Customized component={makeBandPolygon(resolvedBand)} />}
        {(referenceLines ?? []).map((rl, i) =>
          rl.axis === 'y' ? (
            <ReferenceLine
              key={`rl-${i}`}
              y={rl.value}
              stroke={rl.color ?? 'hsl(var(--muted-foreground))'}
              strokeDasharray={rl.dashed === false ? undefined : '4 4'}
              label={rl.label ? { value: rl.label, position: 'right', fontSize: 10, fill: rl.color ?? 'hsl(var(--muted-foreground))' } : undefined}
            />
          ) : (
            <ReferenceLine
              key={`rl-${i}`}
              x={rl.value}
              stroke={rl.color ?? 'hsl(var(--muted-foreground))'}
              strokeDasharray={rl.dashed === false ? undefined : '4 4'}
              label={rl.label ? { value: rl.label, position: 'top', fontSize: 10, fill: rl.color ?? 'hsl(var(--muted-foreground))' } : undefined}
            />
          ),
        )}
        {referenceY != null && (
          <ReferenceLine y={referenceY} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
        )}
        {referenceX != null && (
          <ReferenceLine x={referenceX} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
        )}
        {referenceSegment && (
          <ReferenceLine
            segment={[
              { x: referenceSegment.from[0], y: referenceSegment.from[1] },
              { x: referenceSegment.to[0], y: referenceSegment.to[1] },
            ]}
            stroke={referenceSegment.color ?? 'hsl(var(--muted-foreground))'}
            strokeDasharray={referenceSegment.dashed === false ? undefined : '6 4'}
            label={referenceSegment.label ? { value: referenceSegment.label, fontSize: 10, position: 'insideTopRight' } : undefined}
          />
        )}
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as ScatterChartDataItem
            return (
              <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
                {p.label && <div className="mb-1 text-sm font-medium">{p.label}</div>}
                <div className="text-xs text-muted-foreground">
                  {xLabel ?? 'x'}: <span className="tabular-nums">{xFormatter(p.x)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {yLabel ?? 'y'}: <span className="tabular-nums">{yFormatter(p.y)}</span>
                </div>
              </div>
            )
          }}
        />
        {hasSeries
          ? series!.map((s, sIdx) => {
              const seriesColor = s.color ?? resolveChartColor(undefined, sIdx)
              const hollow = s.shape === 'ring' || s.shape === 'diamond'
              return (
                <Scatter key={s.name} name={s.name} data={s.data} shape={RECHARTS_SHAPE[s.shape ?? 'circle']} onClick={handleScatterClick}>
                  {renderCells(s.data, seriesColor, hollow)}
                  <LabelList dataKey="pill" content={(p) => <PillLabel {...(p as { x?: number; y?: number; value?: string | number })} />} />
                </Scatter>
              )
            })
          : (
            <Scatter data={data} onClick={handleScatterClick}>
              {renderCells(data, resolveChartColor(color, 0), false)}
              <LabelList dataKey="pill" content={(p) => <PillLabel {...(p as { x?: number; y?: number; value?: string | number })} />} />
            </Scatter>
          )}
      </RechartsScatterChart>
    </ResponsiveContainer>
  )

  return (
    <div className={wrapperClass}>
      {title && <h3 className="mb-4 text-base font-medium text-card-foreground">{title}</h3>}
      {chartContent}
    </div>
  )
}

export default ScatterChart
