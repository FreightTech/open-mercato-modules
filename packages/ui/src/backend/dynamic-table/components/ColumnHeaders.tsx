import React, { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Filter, MoreVertical } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { useCellStore, useSelection } from '../hooks/index';
import { useFieldSuggestionLoader } from '../hooks/useSuggestionFetch';
import { ColumnDef, SortState, ContextMenuAction, FilterRow, LoadFilterSuggestions } from '../types/index';
import {
  getOperatorsForType,
  needsRangeValues,
  needsRelativeInput,
  needsValueInput,
  type FilterOperator,
} from '../types/filters';
import ColumnHeaderMenu from './ColumnHeaderMenu';
import ColumnFilterPopover from './ColumnFilterPopover';
import { isFormulaColumnKey } from '../utils/formulaColumns';
import type { ColumnWindow } from '../utils/columnWindow';
import { columnSpacerKey, columnSpacerStyle } from '../utils/columnSpacerStyle';

/** Stable id for a header-authored rule, so it is recognisable as one. */
export const quickFilterId = (field: string): string => `quick:${field}`;

/**
 * Columns the header funnel is offered on. Calculated columns are excluded: they
 * are evaluated in the browser after the page arrives, so a server-side
 * `is_any_of` on `formula__x` matches nothing and would silently empty the grid.
 */
export function isQuickFilterable(column: ColumnDef | undefined): boolean {
  if (!column?.data) return false;
  return !isFormulaColumnKey(column.data);
}

export interface ColumnHeadersProps {
  columns: ColumnDef[];
  rowHeaders: boolean;
  leftOffsets: (number | undefined)[];
  rightOffsets: (number | undefined)[];
  totalWidth: number;
  sortState: SortState;
  actionsColumnWidth: number;
  showActionsColumn?: boolean;
  onSort: (colIndex: number) => void;
  onResizeStart: (e: React.MouseEvent, colIndex: number) => void;
  onDoubleClick: (e: React.MouseEvent, colIndex: number) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  /** Modern layout: enable built-in column header click menu */
  modernLayout?: boolean;
  /** Modern layout: callback for sort ascending */
  onSortAsc?: (colIndex: number) => void;
  /** Modern layout: callback for sort descending */
  onSortDesc?: (colIndex: number) => void;
  /** Remove the sort — offered in the column menu when this column is sorted. */
  onSortClear?: (colIndex: number) => void;
  /** Modern layout: callback for "Advanced filter…" (opens the Configure View panel) */
  onFilterByField?: (colIndex: number) => void;
  /**
   * Live filter rules. EPHEMERAL by contract (workshop A2/D6) — they live in
   * `DynamicTable`'s `useState` and only reach the server on an explicit
   * perspective save, which is exactly why the header funnel is allowed to
   * write them freely.
   */
  filters?: FilterRow[];
  /** Commit a changed rule set. Omit to disable the header quick filter. */
  onFiltersChange?: (filters: FilterRow[]) => void;
  /** Per-module distinct-value loader powering the quick filter's tick list. */
  loadFilterSuggestions?: LoadFilterSuggestions;
  /** Modern layout: callback for freeze/unfreeze column */
  onFreezeToggle?: (colIndex: number) => void;
  /** Modern layout: callback for hiding a column */
  onHideField?: (colIndex: number) => void;
  /**
   * A16 — move a column by dragging its header.
   *
   * Both arguments are ABSOLUTE indices into the full `columns` array, never
   * DOM positions: under column virtualization the columns between source and
   * target may not be mounted at all, and the header row renders spacers where
   * they would be. `toIndex` is the index the column must OCCUPY once moved
   * (i.e. already accounts for the source being lifted out first).
   *
   * Omit to disable header reordering.
   */
  onColumnReorder?: (fromIndex: number, toIndex: number) => void;
  /**
   * A16, keyboard/menu route — move one column one step left (`-1`) or right
   * (`+1`). Surfaced as "Move left" / "Move right" in the column menu so the
   * reorder is reachable without a mouse drag.
   */
  onColumnMove?: (colIndex: number, direction: -1 | 1) => void;
  /** Set of frozen column data keys */
  frozenColumns?: Set<string>;
  /** Data key of the rightmost pinned column — gets the float-edge shadow. */
  lastFrozenColumnKey?: string | null;
  /** Column actions provider for extra menu items */
  columnActions?: (column: ColumnDef, colIndex: number) => ContextMenuAction[];
  /** Callback when an extra column action is clicked */
  onColumnAction?: (actionId: string, colIndex: number) => void;
  /** v2: render a select-all checkbox in the row-header cell. */
  selectable?: boolean;
  allSelected?: boolean;
  someSelected?: boolean;
  onToggleSelectAll?: () => void;
  /**
   * Mounted column window — MUST be the same instance the body rows consume,
   * or header spacers and body spacers drift apart during horizontal scroll and
   * the columns visibly misalign. Omit for the unvirtualized render.
   */
  columnWindow?: ColumnWindow;
}

interface HeaderMenuState {
  colIndex: number;
  anchorRect: DOMRect;
}

/**
 * A16 — live state of a header reorder drag. Everything here is an INDEX into
 * the full `columns` array; nothing is an element. `insertAt` is a slot in the
 * pre-move array (0 … columns.length), i.e. "land before the column currently
 * at this index".
 */
interface ReorderState {
  from: number;
  insertAt: number;
  /** False until the pointer has moved past the threshold — a click is not a drag. */
  active: boolean;
  /** Set when the drop would interleave a pinned column with an unpinned one. */
  invalid: boolean;
}

/** Pixels the pointer must travel before a header press becomes a reorder. */
const REORDER_THRESHOLD_PX = 4;
/** Distance from the viewport edge of the scroller that starts auto-scrolling. */
const REORDER_EDGE_PX = 56;
const REORDER_EDGE_SPEED_PX = 18;

/**
 * The quick filter anchors to the header ELEMENT, not to a frozen rect: the
 * grid scrolls horizontally underneath a `position: fixed` dropdown, so the
 * rect has to be re-read rather than captured once.
 */
interface QuickFilterState {
  colIndex: number;
  anchorEl: HTMLElement;
}

const ColumnHeaders: React.FC<ColumnHeadersProps> = memo(
  ({
    columns,
    rowHeaders,
    leftOffsets,
    rightOffsets,
    totalWidth,
    sortState,
    actionsColumnWidth,
    showActionsColumn = true,
    onSort,
    onResizeStart,
    onDoubleClick,
    onMouseDown,
    onMouseMove,
    modernLayout = false,
    onSortAsc,
    onSortDesc,
    onSortClear,
    onFilterByField,
    filters,
    onFiltersChange,
    loadFilterSuggestions,
    onFreezeToggle,
    onHideField,
    onColumnReorder,
    onColumnMove,
    frozenColumns,
    lastFrozenColumnKey,
    columnActions,
    onColumnAction,
    selectable,
    allSelected,
    someSelected,
    onToggleSelectAll,
    columnWindow,
  }) => {
    const t = useT();
    const store = useCellStore();
    const selection = useSelection();
    const [headerMenu, setHeaderMenu] = useState<HeaderMenuState | null>(null);
    const [quickFilter, setQuickFilter] = useState<QuickFilterState | null>(null);
    const getSuggestionLoader = useFieldSuggestionLoader(loadFilterSuggestions);

    const quickFilterEnabled = modernLayout && typeof onFiltersChange === 'function';

    /**
     * field → its live rule. The WHOLE rule, not just the values: a date filter
     * carries its meaning in the OPERATOR ("tomorrow" has no right-hand side at
     * all), so a values-only map cannot describe what the column is filtered by.
     * A presence rule (is_empty) is the same shape — value-less but IS a filter,
     * or A13 ("am I really seeing everything?") is only half answered.
     */
    const filteredFields = useMemo(() => {
      const map = new Map<string, FilterRow>();
      for (const rule of filters ?? []) map.set(rule.field, rule);
      return map;
    }, [filters]);

    const openQuickFilter = useCallback((colIndex: number, th: HTMLElement | null) => {
      if (!th) return;
      setHeaderMenu(null);
      setQuickFilter({ colIndex, anchorEl: th });
    }, []);

    /**
     * Replace this column's rule with what the popover committed.
     *
     * The tick list hands over values only, and gets `is_any_of` — unchanged.
     * The date editor also hands over its OPERATOR, because a date filter is
     * meaningless without one, and half of them (`is_today`, `is_overdue`, …)
     * carry no values at all. So "is this rule worth keeping" is a question
     * about the operator, not about the value count: a value-taking operator
     * with nothing filled is dropped, a value-less one is kept, and no operator
     * at all (either Clear button) is always a drop.
     */
    const applyQuickFilter = useCallback(
      (field: string, values: string[], options?: { operator?: FilterOperator }) => {
        if (!onFiltersChange) return;
        const operator = options?.operator;
        const keep = operator ? values.length > 0 || !needsValueInput(operator) : values.length > 0;
        const rest = (filters ?? []).filter((f) => f.field !== field);
        onFiltersChange(
          keep
            ? [...rest, { id: quickFilterId(field), field, operator: operator ?? 'is_any_of', values }]
            : rest,
        );
      },
      [filters, onFiltersChange],
    );

    const sortLabel = useCallback(
      (direction: 'asc' | 'desc' | null) => {
        if (direction === 'asc') return t('dynamicTable.sort.ascending', 'Sorted ascending');
        if (direction === 'desc') return t('dynamicTable.sort.descending', 'Sorted descending');
        return t('dynamicTable.sort.none', 'Click to sort');
      },
      [t],
    );

    // ── A16: drag a header to reorder ────────────────────────────────────────
    // Pointer-driven rather than HTML5 drag-and-drop: the grid's own header
    // mousedown calls `preventDefault()` (it starts a column-range selection),
    // which suppresses `dragstart` outright. Pointer events also let the drop
    // indicator live on a column that is only PARTLY scrolled into view.
    const [reorder, setReorder] = useState<ReorderState | null>(null);
    const reorderRef = useRef<ReorderState | null>(null);
    const headersElRef = useRef<HTMLDivElement>(null);
    const setReorderState = useCallback((next: ReorderState | null) => {
      reorderRef.current = next;
      setReorder(next);
    }, []);

    /**
     * Which pinned block a column belongs to. Reordering is only allowed WITHIN
     * a block: `position: sticky` offsets are prefix sums over the pinned run,
     * so slipping an unpinned column into the middle of it would paint the
     * frozen block with a hole in it.
     */
    const pinKindOf = useCallback(
      (index: number): 'left' | 'right' | null => {
        if (leftOffsets[index] !== undefined) return 'left';
        if (rightOffsets[index] !== undefined) return 'right';
        return null;
      },
      [leftOffsets, rightOffsets],
    );

    /** The contiguous run of same-pin columns `index` may move inside. */
    const pinRunOf = useCallback(
      (index: number): { start: number; end: number } => {
        const kind = pinKindOf(index);
        let start = index;
        let end = index;
        while (start > 0 && pinKindOf(start - 1) === kind) start -= 1;
        while (end < columns.length - 1 && pinKindOf(end + 1) === kind) end += 1;
        return { start, end };
      },
      [pinKindOf, columns.length],
    );

    const beginReorder = useCallback(
      (e: React.MouseEvent, colIndex: number) => {
        if (!onColumnReorder || e.button !== 0) return;
        // The resize grip, the funnel and the `⋯` all live inside the same
        // `<th>`; grabbing one of those is not a reorder.
        const target = e.target as HTMLElement;
        if (target.closest('.hot-col-resize-handle, .hot-col-funnel, .hot-col-kebab, .hot-col-sort-btn')) return;
        const startX = e.clientX;
        const startY = e.clientY;
        setReorderState({ from: colIndex, insertAt: colIndex, active: false, invalid: false });

        const scroller = headersElRef.current?.closest<HTMLElement>('.hot-virtual-container') ?? null;
        let rafId = 0;
        let pointerX = startX;

        /** Edge auto-scroll: without it a 57-column table can only be reordered
         *  within one screenful, and column virtualization means the target may
         *  not even be mounted yet. */
        const step = () => {
          if (scroller) {
            const box = scroller.getBoundingClientRect();
            if (pointerX < box.left + REORDER_EDGE_PX) scroller.scrollLeft -= REORDER_EDGE_SPEED_PX;
            else if (pointerX > box.right - REORDER_EDGE_PX) scroller.scrollLeft += REORDER_EDGE_SPEED_PX;
          }
          rafId = window.requestAnimationFrame(step);
        };
        rafId = window.requestAnimationFrame(step);

        const onMove = (ev: MouseEvent) => {
          pointerX = ev.clientX;
          const current = reorderRef.current;
          if (!current) return;
          const moved =
            Math.abs(ev.clientX - startX) > REORDER_THRESHOLD_PX ||
            Math.abs(ev.clientY - startY) > REORDER_THRESHOLD_PX;
          if (!moved && !current.active) return;

          // Pixels → indices, on an element the pointer is physically over. The
          // only direction of DOM read the range contract permits.
          const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
          const th = el?.closest<HTMLElement>('th.hot-col-header');
          let insertAt = current.insertAt;
          if (th && th.getAttribute('data-actions-cell') !== 'true') {
            const overIndex = parseInt(th.getAttribute('data-col') || '', 10);
            if (!Number.isNaN(overIndex)) {
              const rect = th.getBoundingClientRect();
              insertAt = ev.clientX < rect.left + rect.width / 2 ? overIndex : overIndex + 1;
            }
          }

          const run = pinRunOf(current.from);
          const invalid = insertAt < run.start || insertAt > run.end + 1;
          if (
            current.active &&
            current.insertAt === insertAt &&
            current.invalid === invalid
          ) {
            return;
          }
          setReorderState({ from: current.from, insertAt, active: true, invalid });
        };

        const finish = (commit: boolean) => {
          window.cancelAnimationFrame(rafId);
          document.removeEventListener('mousemove', onMove, true);
          document.removeEventListener('mouseup', onUp, true);
          document.removeEventListener('keydown', onKey, true);
          const current = reorderRef.current;
          setReorderState(null);
          if (!commit || !current || !current.active || current.invalid) return;
          // `insertAt` is a slot in the PRE-move array; lifting the source out
          // shifts every later slot down by one.
          const target = current.insertAt > current.from ? current.insertAt - 1 : current.insertAt;
          if (target === current.from) return;
          onColumnReorder(current.from, target);
        };

        const onUp = () => finish(true);
        const onKey = (ev: KeyboardEvent) => {
          if (ev.key === 'Escape') finish(false);
        };

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
        document.addEventListener('keydown', onKey, true);
      },
      [onColumnReorder, pinRunOf, setReorderState],
    );

    // A drag that outlives its component (perspective switch mid-drag) must not
    // leave the document listeners behind.
    useEffect(() => () => { reorderRef.current = null; }, []);

    const handleHeaderClick = useCallback((e: React.MouseEvent, colIndex: number) => {
      if (!modernLayout) return;
      // Don't open menu if clicking on resize handle
      if ((e.target as HTMLElement).classList.contains('hot-col-resize-handle')) return;
      e.preventDefault();
      e.stopPropagation();
      const th = (e.currentTarget as HTMLElement);
      setHeaderMenu({ colIndex, anchorRect: th.getBoundingClientRect() });
    }, [modernLayout]);

    // One header renderer, two callers. `colIndex` is ALWAYS the absolute
    // index into `columns`, so `data-col` keeps carrying the full-array index
    // that every pointer hit-test in handlers/index.ts depends on.
    const renderHeader = (colIndex: number) => {
      const col = columns[colIndex];
      if (!col) return null;

      const isInColRange =
        selection.type === 'colRange' &&
        selection.anchor &&
        selection.focus &&
        colIndex >= Math.min(selection.anchor.col, selection.focus.col) &&
        colIndex <= Math.max(selection.anchor.col, selection.focus.col);

      const colWidth = store.getColumnWidth(colIndex);

      // Sorted column: emit the ARIA state alongside the ↑/↓ glyph so the
      // sort is perceivable by screen readers, not just sighted users.
      // Only the sorted column carries the attribute — a table where every
      // header announces `aria-sort="none"` is noise, not information.
      const sortDirection =
        sortState.columnIndex === colIndex ? sortState.direction : null;

      const showFunnel = quickFilterEnabled && isQuickFilterable(col);
      const filterRule = filteredFields.get(col.data);
      const isFiltered = filterRule != null;
      const rawFilterValues = (filterRule?.values ?? []).map(String);
      const filteredValues = rawFilterValues.filter((v) => v !== '');
      /**
       * What the funnel says the column is filtered BY — A13's question ("wolę
       * mieć pewność, czy faktycznie ja wszystko widzę") answered from the
       * header alone.
       *
       * A list of values answers it for a tick-list column. It does NOT for a
       * date: "Created: " (a preset, which has no values) reads as a bug, and
       * "Created: 2, months" is the stored pair leaking rather than a sentence.
       * So the operator label leads whenever the operator is what carries the
       * meaning, and the plain value join stays exactly as it was otherwise.
       */
      const operatorLabel = filterRule
        ? t(
            `dynamicTable.filter.operator.${filterRule.operator}`,
            // The English label from the operator table, never the raw id.
            getOperatorsForType(col.type).find((o) => o.value === filterRule.operator)?.label ??
              filterRule.operator,
          )
        : '';
      const filterSummary = !filterRule
        ? ''
        : needsRelativeInput(filterRule.operator as FilterOperator)
          ? // [count, unit] → "last 2 months"
            `${operatorLabel} ${rawFilterValues[0] ?? ''} ${t(
              `dynamicTable.filter.unit.${rawFilterValues[1] || 'days'}`,
              rawFilterValues[1] || 'days',
            )}`.trim()
          : needsRangeValues(filterRule.operator as FilterOperator)
            ? // [from, to] → "is between 2026-04-01 – 2026-05-31", with "…" for
              // the open end of a half-range so the gap is deliberate-looking.
              `${operatorLabel} ${rawFilterValues[0] || '…'} – ${rawFilterValues[1] || '…'}`
            : filteredValues.length
              ? filteredValues.join(', ')
              : operatorLabel;

      // ── Too narrow to hold a label AND its chrome (ledger 6.11) ──────────
      //
      // The funnel and the kebab are ~20px each plus gaps, and the cell's own
      // padding takes the rest: on a 70-80px column that is the ENTIRE header,
      // and columns like "Type" and "Ship" rendered with no title at all — two
      // icons and nothing to say which column they belong to. `dense` already
      // solved this by hiding the chrome at rest and revealing it on hover; the
      // defect was that the treatment was keyed to the DENSITY rather than to
      // the thing that actually causes it, which is the WIDTH.
      //
      // So the same reveal now applies at any density once the column is too
      // narrow for both. `data-narrow` is the hook; density.css owns the rules
      // and its guarantees (an active filter is never hidden, `opacity`/`width`
      // never `display:none`) carry over unchanged. The `:focus-within` half of
      // that list is NOT a keyboard guarantee and never was — see HEDGE-146 in
      // density.css; this comment repeated the claim before it was checked.
      //
      // 104px = 40 chrome + 16 padding + ~48 for five characters and an
      // ellipsis. Below that a title is not truncated, it is absent.
      //
      // HEDGE-141: only the KEBAB collapses now — the funnel is never hidden,
      // because on the default view it was reading as "this column cannot be
      // filtered" (3 of 13 funnels visible on Files). The threshold is
      // deliberately unchanged: it still marks "too narrow for a label plus
      // BOTH controls", which is exactly when the kebab should get out of the
      // way. Halving the chrome is what returns the label. See density.css.
      const NARROW_HEADER_PX = 104;
      const isNarrow = (showFunnel || modernLayout) && colWidth < NARROW_HEADER_PX;

      // ── The floor below which the funnel cannot be shown either ──────────
      //
      // HEDGE-141 keeps the funnel at rest on narrow columns, and on most of
      // them the label survives because collapsing the kebab hands back ~22px.
      // It does not survive everywhere. Measured in the browser at 58px —
      // 8 padding + 16 funnel + 4 padding leaves 30px — `Ship` rendered as
      // `S...` and `Type` as `Ty...`, which is the exact one-or-two-character
      // failure ledger 6.11 was written to prevent.
      //
      // A column whose header reads `S...` has traded its identity for an
      // icon, and that is the wrong way round: the user cannot filter a column
      // they can no longer name. So below this floor the funnel goes back to
      // hover-reveal, with every 6.11 guarantee intact (an ACTIVE filter is
      // still never hidden, focus-within still reveals, nothing is
      // `display:none`).
      //
      // A width alone cannot decide this, which a first attempt got wrong: at
      // the same 62px `Who` renders in full beside the funnel while `Cnt Type`
      // collapses to `Cn...`. What matters is the width AND the label.
      //
      // So: the funnel yields only when it would cut the label below roughly
      // five characters. A label shorter than that keeps its funnel (there is
      // nothing left to lose), and a long label keeps its funnel too as long as
      // a five-character stem survives — `Destin…` and `Creat…` still name
      // their column, `Cn…` and `S…` do not.
      //
      // The 7px/char and 33px overhead are calibrated against this grid's own
      // header font, measured in the browser: at 58px the title box is 25px,
      // at 62px it is 29px, at 76px it is 43px. They are approximations on
      // purpose — the consequence of being a pixel out is one column's funnel,
      // and the user can drag the column to change the answer either way.
      const HEADER_CHAR_PX = 7;
      const HEADER_CHROME_PX = 33; // padding + funnel + resize handle
      const MIN_LEGIBLE_STEM_PX = 5 * HEADER_CHAR_PX;
      const labelText = String(col.title || col.data);
      const labelNaturalPx = labelText.length * HEADER_CHAR_PX;
      const titleSpacePx = colWidth - HEADER_CHROME_PX;
      const funnelTooTight =
        showFunnel && titleSpacePx < Math.min(labelNaturalPx, MIN_LEGIBLE_STEM_PX);

      const headerStyle: React.CSSProperties = {
        width: colWidth,
        flexBasis: colWidth,
        minWidth: colWidth,
        flexShrink: 0,
        flexGrow: 0,
        position: 'relative',
      };

      if (leftOffsets[colIndex] !== undefined) {
        headerStyle.position = 'sticky';
        headerStyle.left = leftOffsets[colIndex];
        headerStyle.zIndex = 3;
      } else if (rightOffsets[colIndex] !== undefined) {
        headerStyle.position = 'sticky';
        headerStyle.right = rightOffsets[colIndex];
        headerStyle.zIndex = 3;
      }

      // A16 drop feedback. Both edges are derived from `reorder.insertAt`, an
      // index — a column that is unmounted while the pointer passes over it
      // simply never paints an indicator, and the arithmetic stays correct.
      const dropBefore = !!reorder?.active && !reorder.invalid && reorder.insertAt === colIndex;
      const dropAfter =
        !!reorder?.active &&
        !reorder.invalid &&
        reorder.insertAt === colIndex + 1 &&
        colIndex === columns.length - 1;

      return (
        <th
          key={col.data}
          className={`hot-col-header ${modernLayout ? 'hot-col-header-modern' : ''}`}
          onDoubleClick={modernLayout ? (e) => handleHeaderClick(e, colIndex) : (e) => onDoubleClick(e, colIndex)}
          onMouseDown={onColumnReorder ? (e) => beginReorder(e, colIndex) : undefined}
          style={headerStyle}
          data-col={colIndex}
          data-reorderable={onColumnReorder ? true : undefined}
          data-reorder-source={reorder?.active && reorder.from === colIndex ? true : undefined}
          data-drop-before={dropBefore || undefined}
          data-drop-after={dropAfter || undefined}
          aria-colindex={colIndex + 1 + (rowHeaders ? 1 : 0)}
          aria-sort={
            sortDirection === 'asc'
              ? 'ascending'
              : sortDirection === 'desc'
                ? 'descending'
                : undefined
          }
          data-sort-direction={sortDirection ?? undefined}
          data-in-col-range={isInColRange}
          /* 6.11 — the column is narrower than a label plus BOTH its controls,
             so the kebab hides at rest and reveals on hover/focus, giving the
             label its space back. The funnel stays: see HEDGE-141 in
             density.css for why it is never part of this collapse. */
          data-narrow={isNarrow || undefined}
          /* Narrower than a label plus even the funnel alone — see
             FUNNEL_FLOOR_PX above. density.css hides the funnel only here. */
          data-funnel-tight={funnelTooTight || undefined}
          data-sticky-left={leftOffsets[colIndex] !== undefined}
          data-sticky-right={rightOffsets[colIndex] !== undefined}
          data-frozen-edge={(lastFrozenColumnKey != null && col.data === lastFrozenColumnKey) || undefined}
          /* A13 — "wolę mieć pewność, czy faktycznie ja wszystko widzę."
             A filtered column has to LOOK filtered at a glance, from the header
             row alone, without opening anything. */
          data-filtered={isFiltered || undefined}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
                flex: 1,
              }}
              title={col.headerTooltip || col.title || col.data}
            >
              {col.title || col.data}
            </span>
            {/* Classic layout: sort button. Modern layout: sort indicator only (no button) */}
            {!modernLayout ? (
              <button
                className="hot-col-sort-btn"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onSort(colIndex);
                }}
                title={sortLabel(sortDirection)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 'var(--text-body-regular-xs)',
                  // Tokens, not hex. `#3b82f6`/`#9ca3af` were fixed light-mode
                  // values, so the idle glyph sat at the same grey in dark mode
                  // where it needs to be lighter than the surface, not darker.
                  color: sortDirection ? 'var(--m3-accent)' : 'var(--m3-on-surface-variant)',
                  transition: 'var(--m3-transition-state)',
                }}
              >
                {sortDirection === 'asc' && '↑'}
                {sortDirection === 'desc' && '↓'}
                {!sortDirection && '⇅'}
              </button>
            ) : (
              sortDirection && (
                <span
                  className="hot-col-sort-indicator"
                  title={sortLabel(sortDirection)}
                  aria-hidden="true"
                >
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )
            )}
            {/* A1 — the funnel. Excel's AutoFilter affordance, one click from
                the header, never behind the Configure View drawer. Always
                visible (not hover-revealed): discoverability IS the feature. */}
            {showFunnel && (
              <button
                type="button"
                className="hot-col-funnel"
                tabIndex={-1}
                data-filtered={isFiltered || undefined}
                aria-label={
                  isFiltered
                    ? filteredValues.length
                      ? t('dynamicTable.quickFilter.filteredBy', 'Filtered — {count} values selected', {
                          count: filteredValues.length,
                        })
                      : t('dynamicTable.quickFilter.filteredByCondition', 'Filtered — {condition}', {
                          condition: filterSummary,
                        })
                    : t('dynamicTable.quickFilter.open', 'Filter this column')
                }
                title={
                  isFiltered
                    ? `${col.title || col.data}: ${filterSummary}`
                    : t('dynamicTable.quickFilter.open', 'Filter this column')
                }
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  openQuickFilter(colIndex, e.currentTarget.closest('th'));
                }}
              >
                <Filter size={13} />
              </button>
            )}
            {/* v2: visible per-column options trigger (opens the modern column menu) */}
            {modernLayout && (
              <button
                type="button"
                className="hot-col-kebab"
                tabIndex={-1}
                title={t('dynamicTable.columnMenu.title', 'Column options')}
                /* The funnel next to it names the column's filter state for a
                   screen reader; this one carried only a `title`, which is not
                   a reliable accessible name on a button with no text. */
                aria-label={t('dynamicTable.columnMenu.openFor', 'Column options: {name}', {
                  name: col.title || col.data,
                })}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const th = e.currentTarget.closest('th');
                  if (th) setHeaderMenu({ colIndex, anchorRect: th.getBoundingClientRect() });
                }}
              >
                <MoreVertical size={14} />
              </button>
            )}
          </div>
          <div
            className="hot-col-resize-handle"
            onMouseDown={(e) => onResizeStart(e, colIndex)}
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: '5px',
              cursor: 'col-resize',
              zIndex: 10,
            }}
          />
        </th>
      );
    };

    return (
      <div
        ref={headersElRef}
        className="hot-headers-sticky"
        data-reordering={reorder?.active || undefined}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
      >
        <table className="hot-table" style={{ width: `${totalWidth}px` }}>
          <thead>
            <tr style={{ display: 'flex', width: `${totalWidth}px` }}>
              {rowHeaders && (
                <th
                  className="hot-row-header"
                  style={{
                    width: 50,
                    flexBasis: 50,
                    flexShrink: 0,
                    flexGrow: 0,
                    position: 'sticky',
                    left: 0,
                    zIndex: 4,
                  }}
                >
                  {selectable && (
                    <input
                      type="checkbox"
                      className="hot-row-select hot-row-select-all"
                      checked={!!allSelected}
                      ref={(el) => { if (el) el.indeterminate = !allSelected && !!someSelected; }}
                      onChange={() => onToggleSelectAll?.()}
                      aria-label={t('dynamicTable.selection.all', 'Select all rows')}
                    />
                  )}
                </th>
              )}

              {columnWindow?.virtualized
                ? columnWindow.segments.map((seg) =>
                    seg.type === 'spacer' ? (
                      <th
                        key={columnSpacerKey(seg.fromIndex, seg.toIndex)}
                        className="hot-header-spacer"
                        aria-hidden="true"
                        style={columnSpacerStyle(seg.width)}
                      />
                    ) : (
                      renderHeader(seg.column.index)
                    ))
                : columns.map((_, colIndex) => renderHeader(colIndex))}

              {/* Actions header */}
              {showActionsColumn && (
                <th
                  className="hot-col-header"
                  data-actions-cell="true"
                  // No visible label: the design's trailing column is the row
                  // kebab alone. Screen readers still get its name.
                  aria-label={t('dynamicTable.actions.header', 'Actions')}
                  style={{
                    width: actionsColumnWidth,
                    flexBasis: actionsColumnWidth,
                    flexShrink: 0,
                    flexGrow: 0,
                    position: 'sticky',
                    right: 0,
                    zIndex: 3,
                  }}
                >
                </th>
              )}
            </tr>
          </thead>
        </table>

        {/* Modern layout: Column Header Menu */}
        {headerMenu && modernLayout && (
          <ColumnHeaderMenu
            column={columns[headerMenu.colIndex]}
            colIndex={headerMenu.colIndex}
            anchorRect={headerMenu.anchorRect}
            isFrozen={frozenColumns?.has(columns[headerMenu.colIndex].data) ?? false}
            onSortAsc={() => onSortAsc?.(headerMenu.colIndex)}
            onSortDesc={() => onSortDesc?.(headerMenu.colIndex)}
            onSortClear={
              onSortClear && sortState.columnIndex === headerMenu.colIndex && sortState.direction
                ? () => onSortClear(headerMenu.colIndex)
                : undefined
            }
            /* "Filter by this field" now lands on the quick filter — the
               workshop complaint was precisely that it opened the Configure
               View drawer instead. The drawer stays reachable one item below. */
            onQuickFilter={
              quickFilterEnabled && isQuickFilterable(columns[headerMenu.colIndex])
                ? () => {
                    const colIndex = headerMenu.colIndex;
                    const th = document.querySelector<HTMLElement>(
                      `th.hot-col-header[data-col="${colIndex}"]`,
                    );
                    setHeaderMenu(null);
                    if (th) setQuickFilter({ colIndex, anchorEl: th });
                  }
                : undefined
            }
            onFilterByField={() => onFilterByField?.(headerMenu.colIndex)}
            onFreezeToggle={() => onFreezeToggle?.(headerMenu.colIndex)}
            onHideField={() => onHideField?.(headerMenu.colIndex)}
            /* A16 keyboard route. Disabled at the ends of the pinned run the
               column belongs to, for the same reason the drag refuses there. */
            onMoveLeft={
              onColumnMove && headerMenu.colIndex > pinRunOf(headerMenu.colIndex).start
                ? () => onColumnMove(headerMenu.colIndex, -1)
                : undefined
            }
            onMoveRight={
              onColumnMove && headerMenu.colIndex < pinRunOf(headerMenu.colIndex).end
                ? () => onColumnMove(headerMenu.colIndex, 1)
                : undefined
            }
            onClose={() => setHeaderMenu(null)}
            extraActions={columnActions?.(columns[headerMenu.colIndex], headerMenu.colIndex)}
            onExtraAction={(actionId) => onColumnAction?.(actionId, headerMenu.colIndex)}
          />
        )}

        {/* A1: the per-column quick filter, anchored to ITS header cell. */}
        {quickFilter && columns[quickFilter.colIndex] && (
          <ColumnFilterPopover
            key={columns[quickFilter.colIndex].data}
            column={columns[quickFilter.colIndex]}
            anchorEl={quickFilter.anchorEl}
            selectedValues={(filteredFields.get(columns[quickFilter.colIndex].data)?.values ?? []).map(String)}
            selectedOperator={
              filteredFields.get(columns[quickFilter.colIndex].data)?.operator as FilterOperator | undefined
            }
            loadSuggestions={getSuggestionLoader(columns[quickFilter.colIndex].data)}
            onApply={(values, options) =>
              applyQuickFilter(columns[quickFilter.colIndex].data, values, options)
            }
            onClose={() => setQuickFilter(null)}
          />
        )}
      </div>
    );
  }
);

ColumnHeaders.displayName = 'ColumnHeaders';

export default ColumnHeaders;
