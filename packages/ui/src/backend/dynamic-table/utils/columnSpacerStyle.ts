import type * as React from 'react';

/**
 * Geometry for the placeholder box that stands in for a run of unmounted
 * columns under horizontal virtualization.
 *
 * One function, four render sites (`ColumnHeaders`, `VirtualRow`,
 * `GroupSummaryRow`, `FooterTotalsRow`). If header spacers and body spacers can
 * drift by a pixel, sticky offsets and column alignment drift with them, so the
 * numbers are stated exactly once.
 *
 * HARD RULES, all of which are about correctness rather than looks:
 *
 *  1. `flexShrink: 0` / `flexGrow: 0` ALWAYS — a spacer that stretched would
 *     make the mounted columns land at the wrong x. Nothing in this grid
 *     stretches any more (`utils/columnFill.ts` resolves the fill-to-container
 *     surplus to PIXELS precisely so that spacer widths stay honest), and this
 *     is the belt to that braces.
 *  2. `pointerEvents: 'none'` — nothing may hit-test onto a spacer.
 *  3. NEVER `position: sticky`. A spacer that stuck would occlude real cells.
 *  4. No padding, no border. NOTE what is deliberately ABSENT: `background`.
 *     A striped, checkbox-selected or range-selected row paints its fill on the
 *     CELLS (`td.hot-cell`), not on the `<tr>`, so an inline `transparent` here
 *     would punch a visible hole through the middle of a highlighted row. The
 *     fill is handed to spacers by `styles/DynamicTable.v2.css` instead, which
 *     is the only place that knows what each row state is painted with.
 *
 * The two rules a style object cannot carry are stated here because they belong
 * with the same decision, and every call site obeys them:
 *
 *  5. A spacer element must NEVER carry `data-row` or `data-col`. Every pointer
 *     hit-test does `closest('td[data-row][data-col]')`, so a matching spacer
 *     would silently retarget writes to a column the user never clicked.
 *  6. It must be `aria-hidden` so it is not counted as a cell.
 */
export function columnSpacerStyle(width: number): React.CSSProperties {
  return {
    width,
    flexBasis: width,
    minWidth: width,
    maxWidth: width,
    flexShrink: 0,
    flexGrow: 0,
    padding: 0,
    border: 0,
    pointerEvents: 'none',
  };
}

/** Stable React key for a spacer, derived from the run it covers. */
export function columnSpacerKey(fromIndex: number, toIndex: number): string {
  return `__spacer_${fromIndex}_${toIndex}`;
}
