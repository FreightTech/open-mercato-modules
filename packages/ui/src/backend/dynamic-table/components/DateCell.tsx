'use client'

/**
 * DynamicTable — DATE CELL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Renders a compact date, or a planned/estimated/actual triplet, inside a grid
 * cell. All formatting logic lives in `../utils/formatDateCompact`; this file
 * is purely the DOM shape and the styling hooks.
 *
 * ── Two modes ──────────────────────────────────────────────────────────────
 *
 *   <DateCell value={row.eta} />                             single value
 *   <DateCell planned={ptd} estimated={etd} actual={atd} />  the A8(ii) triplet
 *
 * ── Why the parts are separate <span>s ─────────────────────────────────────
 * The density scale hides low-value decorations with CSS at `dense`
 * (`styles/dateCell.css`). CSS can only hide what has its own element, so the
 * time / week / variance are split out. Nothing is threaded as a prop and no
 * cell re-renders when the user changes density — the container attribute flips
 * and the browser recalculates style. Same contract as `styles/density.css`.
 *
 * ── Typography ─────────────────────────────────────────────────────────────
 * This component deliberately applies NO `text-*` typography token.
 *
 * That is not an oversight and it is not a bypass of the rules in
 * `.ai/typography-rules.md`. A token on this span would hard-set a font-size
 * ON the element, which out-specifies the density scale's ramp on `td`/`th` —
 * so a date cell would stay 12px while every neighbouring cell shrank to 11px
 * at `dense`. Inheriting IS the correct behaviour: the cell's type comes from
 * the density level, which is where the product decision lives.
 *
 * The one type-adjacent utility used is `tabular-nums`, which sets
 * `font-variant-numeric` only. It touches no size, weight, line-height or
 * tracking, so it cannot conflict with a token — and without it the digits in
 * a date column do not line up, which is most of the point of a date column.
 * No raw `text-[11px]`, no inline `fontSize`, anywhere in this file.
 *
 * ── Accessibility ──────────────────────────────────────────────────────────
 * The level glyph (○ ◐ ●) is a CERTAINTY RAMP: shape carries the meaning, so
 * it survives greyscale, colour blindness and a printed screenshot. Colour is
 * reinforcement only (WCAG 1.4.1). The glyph itself is `aria-hidden` because
 * screen readers announce "white circle" — the words live in the `title`,
 * which carries the full planned/estimated/actual breakdown.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import * as React from 'react'
import {
  getCompactDateFormatter,
  type CompactDateConfig,
  type CompactTimestamp,
  type DateInput,
  type TimestampLevel,
} from '../utils/formatDateCompact'

/**
 * Colour per level — REINFORCEMENT for the glyph, never the sole signal.
 * Matches the palette already used by the transport table's
 * `DepartureArrivalCell`, so the two tables do not disagree about what green
 * means for the same shipment.
 *
 * Written as whole literal class strings (not interpolated) so Tailwind's
 * scanner sees them in the source.
 */
const LEVEL_CLASS: Record<TimestampLevel, string> = {
  planned: 'text-m3-on-surface-variant',
  estimated: 'text-m3-on-surface',
  actual: 'text-green-600 dark:text-green-400',
}

/** An estimate whose time has passed with no actual recorded: it is now a risk. */
const OVERDUE_CLASS = 'text-amber-600 dark:text-amber-400'

const VARIANCE_LATE_CLASS = 'text-red-600 dark:text-red-400'
const VARIANCE_EARLY_CLASS = 'text-m3-on-surface-variant'

export type DateCellProps = {
  /** Single-value mode. Ignored when any of planned/estimated/actual is given. */
  value?: DateInput
  /** Triplet mode — workshop A8(ii). */
  planned?: DateInput
  estimated?: DateInput
  actual?: DateInput
  /**
   * Formatting rules. HOIST THIS — pass a module-level constant or a `useMemo`
   * result, never an object literal built inside a row map. A stable reference
   * is not required for correctness (the formatter is keyed by the config's
   * VALUES, not its identity) but a literal allocates on every cell.
   */
  config?: CompactDateConfig
  /**
   * Show the delta between the shown level and the previous one ("+2d").
   * Default `true` in triplet mode. Hidden by CSS at `dense`.
   */
  showVariance?: boolean
  /**
   * Flag an estimate that is already in the past with no actual. Default `true`
   * in triplet mode. `now` is injectable so tests are deterministic.
   */
  flagOverdue?: boolean
  now?: number
  /** Replaces the generated hover breakdown. Pass `false` for no title at all. */
  title?: string | false
  className?: string
}

function levelColour(
  level: TimestampLevel | null,
  overdue: boolean,
): string {
  if (overdue) return OVERDUE_CLASS
  return level ? LEVEL_CLASS[level] : 'text-m3-on-surface-variant'
}

/**
 * `React.memo` is worth it here specifically: a date column's props are
 * primitives plus one hoisted config object, so the equality check is cheap and
 * a scroll that re-renders `VirtualRow` skips the subtree entirely.
 */
export const DateCell = React.memo(function DateCell({
  value,
  planned,
  estimated,
  actual,
  config,
  showVariance = true,
  flagOverdue = true,
  now,
  title,
  className,
}: DateCellProps) {
  const formatter = React.useMemo(() => getCompactDateFormatter(config), [config])

  const isTriplet = planned !== undefined || estimated !== undefined || actual !== undefined

  const ts: CompactTimestamp | null = isTriplet
    ? formatter.formatLevels(planned, estimated, actual)
    : null
  const date = isTriplet ? ts!.date : formatter.format(value)

  // Time-dependence is deliberately OUTSIDE the memoised formatter: "is this
  // estimate overdue?" changes as the clock moves, so caching it would make the
  // grid show a stale answer until the value itself changed.
  const overdue =
    flagOverdue &&
    !!ts &&
    ts.level === 'estimated' &&
    !Number.isNaN(date.ms) &&
    date.ms < (now ?? Date.now())

  const resolvedTitle =
    title === false ? undefined : title ?? (ts && ts.title ? ts.title : date.text || undefined)

  if (date.kind === 'empty') {
    return (
      <span className={`dt-date dt-date-empty text-m3-on-surface-variant${className ? ` ${className}` : ''}`}>
        {date.text}
      </span>
    )
  }

  if (date.kind === 'invalid') {
    // A broken value must be visibly broken and reportable — never "Invalid
    // Date", never a crash, and never silently indistinguishable from empty.
    return (
      <span
        className={`dt-date dt-date-invalid text-m3-on-surface-variant${className ? ` ${className}` : ''}`}
        data-dt-date-invalid="true"
        title={typeof value === 'string' && value ? value : undefined}
      >
        {date.text}
      </span>
    )
  }

  const colour = levelColour(ts?.level ?? null, overdue)

  return (
    <span
      className={`dt-date tabular-nums ${colour}${className ? ` ${className}` : ''}`}
      data-dt-date-level={ts?.level || undefined}
      data-dt-date-overdue={overdue || undefined}
      title={resolvedTitle}
    >
      {ts?.glyph ? (
        <span className="dt-date-glyph" aria-hidden="true">
          {ts.glyph}
        </span>
      ) : null}
      {date.date ? <span className="dt-date-day">{date.date}</span> : null}
      {date.time ? <span className="dt-date-time">{date.time}</span> : null}
      {date.week ? <span className="dt-date-week">{date.week}</span> : null}
      {showVariance && ts?.variance ? (
        <span
          className={`dt-date-variance ${ts.varianceSign > 0 ? VARIANCE_LATE_CLASS : VARIANCE_EARLY_CLASS}`}
        >
          {ts.variance}
        </span>
      ) : null}
    </span>
  )
})

export default DateCell
