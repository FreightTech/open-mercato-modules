/**
 * `CompactLabelCell` — renders a folded label with the full value on hover.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TYPOGRAPHY: WHY THIS COMPONENT SETS NO FONT SIZE BY DEFAULT
 *
 * `.ai/typography-rules.md` forbids raw utilities (`text-sm font-medium`,
 * `text-[13px]`) because the named tokens carry bespoke line-height and
 * letter-spacing. This component obeys that rule in the strongest available
 * form: it emits NO type utility at all on the hot path, and the one escape
 * hatch it offers is typed to a closed union of token names, so passing a raw
 * utility is a COMPILE ERROR rather than a review finding.
 *
 * Inheriting is not a dodge — it is the only correct behaviour here. The
 * density scale (`styles/density.css`) sets `font-size` / `line-height` /
 * `letter-spacing` on the cell element itself from `--dt-cell-*`, which resolve
 * to named tokens per level:
 *
 *     comfortable → text-body-regular-xs   (12/16)
 *     compact     → text-body-regular-xs   (12/16)
 *     dense       → text-body-regular-2xs  (11/14)
 *
 * A token class on this inner span would be MORE specific than the cell rule
 * and would therefore pin one size across all three levels — silently opting
 * these cells out of the very density preference this wave exists to serve. So
 * the default renders at whatever the user's density says, which is what
 * "respects the density scale" has to mean.
 *
 * Monospace is likewise inherited: it comes from `.cell-mono`, driven by
 * `ColumnDef.mono`, and density scales it through `--dt-mono-*`. Do not add
 * `font-mono` here — set `mono: true` on the column instead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERFORMANCE
 *
 * `VirtualRow` does a plain `columns.map`, so this renders once per column per
 * mounted row per pass. Two consequences shaped the design:
 *
 *   - The renderers below return a PLAIN STRING whenever the value was not
 *     shortened. No element, no props object, no React node — the common case
 *     costs nothing beyond the format call. `Cell.tsx` already wraps rendered
 *     output in `<span class="cell-content" title={cellValue}>` for string
 *     values, so an unshortened value even keeps its tooltip for free.
 *   - The component is `React.memo`'d on three primitive props, so a re-render
 *     of the row that does not change the label does not re-render the label.
 */

import * as React from 'react'

import {
  formatLabelCompact,
  toDisplayString,
  type CompactLabel,
  type CompactLabelSpec,
  type FitMode,
} from '../utils/formatLabelCompact'
import { ABBREV_FACILITY, type AbbreviationNamespace } from '../utils/abbreviations'

/**
 * The ONLY type utilities this component will accept — every one a named token
 * from `.ai/typography-rules.md`.
 *
 * Closed on purpose. `className: string` would let `text-[11px]` in through the
 * front door; this union makes the rule mechanical instead of aspirational.
 *
 * Use it only when a compact label plays a role the surrounding cell does not
 * already describe. If you find yourself reaching for it to make grid text
 * bigger or smaller, the answer is the density preference, not this prop.
 */
export type CompactLabelTypography =
  | 'text-body-regular-sm'
  | 'text-body-regular-xs'
  | 'text-body-medium-sm'
  | 'text-label-semibold-xs'
  | 'text-label-medium-md'
  | 'text-caption-medium-md'
  | 'text-code-regular-sm'
  | 'text-code-regular-md'
  // The restricted `2xs` micro ramp. Permitted here — and only here — because
  // this file lives under `packages/ui/src/backend/dynamic-table/`, which is
  // the fence the typography rules draw around those three tokens.
  | 'text-body-regular-2xs'
  | 'text-label-semibold-2xs'
  | 'text-code-regular-2xs'

export type CompactLabelCellProps = {
  /** The folded text to display. */
  text: string
  /** The complete value, shown on hover. Omit when identical to `text`. */
  title?: string
  /**
   * Opt into an explicit named token. Omit — the default — to inherit the
   * density-driven type ramp from the cell, which is almost always right.
   */
  typography?: CompactLabelTypography
  /** Extra non-typographic classes (colour, alignment). No type utilities. */
  className?: string
}

/**
 * The rendered label.
 *
 * `title` is set only when it differs from `text`; an identical tooltip is a
 * pointless attribute on every cell of a large grid, and browsers still pay to
 * hit-test it.
 */
export const CompactLabelCell = React.memo(function CompactLabelCell({
  text,
  title,
  typography,
  className,
}: CompactLabelCellProps) {
  const showTitle = title && title !== text ? title : undefined
  const cls = typography
    ? className
      ? `${typography} ${className}`
      : typography
    : className
  return (
    <span className={cls} title={showTitle}>
      {text}
    </span>
  )
})

/**
 * Turn a `CompactLabel` into the cheapest renderable form.
 *
 * The string fast path is the point of this helper: an unshortened value needs
 * no element and no tooltip of its own, because `Cell.tsx` already supplies
 * one from the raw cell value.
 */
export function renderCompactLabel(
  label: CompactLabel,
  typography?: CompactLabelTypography,
  className?: string,
): React.ReactNode {
  if (!label.text) return ''
  if (!label.shortened && !typography && !className) return label.text
  return (
    <CompactLabelCell
      text={label.text}
      title={label.title}
      typography={typography}
      className={className}
    />
  )
}

/** Shared shape of the options every factory below accepts. */
type RendererOptions = {
  typography?: CompactLabelTypography
  className?: string
}

/**
 * A `ColumnDef.renderer`-compatible function.
 *
 * Matches the existing `CellRendererFunction` signature in `renderers.tsx`, so
 * the output of every factory here drops straight into a column definition with
 * NO change to `Cell.tsx`, `VirtualRow.tsx` or `types/index.ts`. That was a
 * design goal, not a coincidence — see the wiring notes at the bottom.
 */
export type CompactCellRenderer = (
  value: any,
  rowData: any,
  columnConfig: any,
  rowIndex?: number,
  colIndex?: number,
) => React.ReactNode

/**
 * Build a renderer for any compact strategy.
 *
 * The returned closure is created ONCE per column (memoize it alongside your
 * column definitions) and is pure thereafter.
 */
export function createCompactLabelRenderer(
  spec: CompactLabelSpec,
  options?: RendererOptions,
): CompactCellRenderer {
  return (value) =>
    renderCompactLabel(formatLabelCompact(value, spec), options?.typography, options?.className)
}

/**
 * ASSIGNEE → INITIALS. Workshop A9.
 *
 * `index` MUST come from `buildInitialsIndex(roster)`, memoized on the roster.
 * Without it initials are computed per name in isolation and two colleagues can
 * collide on the same letters — and a wrong initial is worse than a long name.
 *
 * Pass the same roster you already fetch for the column's filter suggestions or
 * its dropdown `source`; no extra request is needed.
 */
export function createInitialsRenderer(
  index?: ReadonlyMap<string, string> | null,
  options?: RendererOptions & { maxChars?: number },
): CompactCellRenderer {
  const spec: CompactLabelSpec = { kind: 'assignee', index, maxChars: options?.maxChars }
  return createCompactLabelRenderer(spec, options)
}

/**
 * PORT / TERMINAL → CODE. Workshop A9: "Port Gdansk" → "GDN", "Baltic Hub" →
 * "BHCT".
 *
 * Takes no mapping argument BY DESIGN. The dictionary is central — registered
 * once at app boot from the `facilities` table (see `abbreviations.ts`) — so a
 * column never declares, and never can drift from, the mapping. This is
 * Agnieszka's *"nie zebysmy co fajl zmieniali"* expressed in the API shape:
 * there is no per-file knob to get wrong.
 */
export function createFacilityRenderer(
  options?: RendererOptions & { maxChars?: number },
): CompactCellRenderer {
  return createCompactLabelRenderer({ kind: 'facility', maxChars: options?.maxChars }, options)
}

/**
 * CONTRACTOR → SHORT NAME.
 *
 * Reads the EXISTING `contractors.short_name` through the registry. Nothing is
 * derived here: that column is already curated, already live, and already has
 * `deriveContractorShortName` behind it for the gaps.
 */
export function createContractorRenderer(
  options?: RendererOptions & { maxChars?: number },
): CompactCellRenderer {
  return createCompactLabelRenderer({ kind: 'contractor', maxChars: options?.maxChars }, options)
}

/**
 * Any other centrally-registered dictionary (vessel names, service codes, …).
 */
export function createDictionaryRenderer(
  namespace: AbbreviationNamespace = ABBREV_FACILITY,
  options?: RendererOptions & { maxChars?: number },
): CompactCellRenderer {
  return createCompactLabelRenderer(
    { kind: 'dictionary', namespace, maxChars: options?.maxChars },
    options,
  )
}

/**
 * GENERAL TEXT FITTING.
 *
 * `mode: 'identifier'` middle-clips — use it for container, booking, invoice
 * and B/L numbers, where the TAIL is what distinguishes one value from the
 * next and tail-clipping would leave a column of identical-looking prefixes.
 *
 * `mode: 'prose'` tail-clips — descriptions, notes, addresses.
 *
 * Omitting `mode` auto-detects, conservatively defaulting to prose. Declare it
 * explicitly when you know the column.
 */
export function createFittedTextRenderer(
  maxChars: number,
  mode?: FitMode,
  options?: RendererOptions,
): CompactCellRenderer {
  return createCompactLabelRenderer({ kind: 'text', maxChars, mode }, options)
}

/**
 * Escape hatch for columns whose value needs unwrapping before formatting
 * (a relation object, a JSON blob). Exposed so callers do not reimplement the
 * coercion rules that `formatLabelCompact` applies internally.
 */
export { toDisplayString }

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRATION — and why no forbidden file has to change for the common case
 *
 * `ColumnDef` ALREADY has a `renderer` hook, and `getCellRenderer` in
 * `renderers.tsx` gives it precedence over every built-in. So a column opts in
 * today with no core edit at all:
 *
 *     {
 *       data: 'portOfLoading',
 *       title: 'POL',
 *       mono: true,                        // monospace + density-scaled
 *       renderer: createFacilityRenderer(),
 *     }
 *
 * A first-class DECLARATIVE flag (`compact: 'facility'` on `ColumnDef`, routed
 * through `getCellRenderer`) is nicer for consumers and is written up as a
 * wiring contract, because it needs `types/index.ts` — which is forbidden this
 * wave. Nothing here waits on it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
