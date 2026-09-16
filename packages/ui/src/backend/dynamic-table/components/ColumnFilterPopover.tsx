import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { Button } from '../../../primitives-v2/Button';
import { Checkbox } from '../../../primitives-v2/Checkbox';
import { SearchInput } from '../../../primitives-v2/SearchInput';
import { useCellStore } from '../hooks/index';
import { useEscapeLayer } from '../hooks/useEscapeLayer';
import { useSuggestionFetch } from '../hooks/useSuggestionFetch';
import type { ColumnDef } from '../types/index';
import {
  FilterOperator,
  getOperatorsForType,
  isDateOperator,
  needsRangeValues,
  needsRelativeInput,
  needsValueInput,
  RELATIVE_DATE_UNITS,
} from '../types/filters';
import FilterDatePicker from './FilterDatePicker';
import SelectMenu from './SelectMenu';
import { computeAnchoredPosition } from '../utils/anchoredPosition';

/**
 * Excel's AutoFilter, literally.
 *
 * WHY THIS EXISTS: until now the ONLY route to a filter was the Configure View
 * drawer — the column menu's "Filter by this field" appended an empty rule and
 * opened the panel. From the INF workshop, verbatim: *"Tu musi być po prostu
 * dosadnie filtrowanie każdej kolumny osobno… nie w tym widoku, bo to jest
 * skomplikowane."* A funnel in the header, a search box, a list of ticks. That
 * is the whole product requirement, and it is the most-repeated one in the file.
 *
 * Two constraints that are NOT negotiable:
 *
 *  1. **This filter is never saved.** Workshop A2/D6 — the user rejected saving
 *     these herself ("takich ustawień to byśmy mieli po tygodniu dwadzieścia").
 *     The architecture already gives it: filters live in `useState` inside
 *     `DynamicTable` and only reach the server on an explicit perspective save.
 *     What this component adds is making the distinction VISIBLE — hence the
 *     transient footnote and the dashed treatment on the trigger.
 *  2. **A filtered column stays legible as filtered.** Workshop A13 — *"wolę
 *     mieć pewność, czy faktycznie ja wszystko widzę"*. The funnel glyph in the
 *     header persists while the rule is live; it is not a hover affordance.
 *
 * ## The type branch (workshop A14)
 *
 * A tick list of DISTINCT VALUES is the right editor for a carrier, a port or a
 * status. It is meaningless for a **date**: every row has its own timestamp, so
 * the loader has nothing useful to return and the popover rendered "Search
 * values… / No values" over a column nobody could filter. Dates therefore get
 * the SAME editor the Configure View drawer already shipped — the operator list
 * from `getOperatorsForType('date')`, presets first, then the explicit range —
 * because the two entry points must agree on what a date filter is.
 *
 * Both halves are required, and by different people. Klaudiusz lives on
 * "tomorrow"; Agnieszka declined more presets outright — *"szybciej mi jest
 * operować na zakresie dat"* — and wants `is_between`. Neither ships without
 * the other. `server/dateWindows.ts` resolves both to the same `[from, to]`
 * window server-side, which is what guarantees they cannot diverge.
 *
 * Values come from the module's `loadFilterSuggestions` loader (server-side,
 * needle-aware, capped) and degrade in two steps: a column that declares a
 * static `source` uses that enum directly, and a list with neither falls back to
 * the distinct values of the LOADED page — labelled as such, because a page's
 * distinct values are not the dataset's.
 */

const POPOVER_WIDTH = 268;
/** Room the value list needs below the header before it flips above it. */
const ESTIMATED_HEIGHT = 360;
/** The date body is a fixed-height form, not a scrolling list. */
const ESTIMATED_DATE_HEIGHT = 280;

/**
 * The header filter opens on an explicit RANGE, matching the Configure View
 * drawer's own default for a date column. Two reasons, in order: an empty range
 * is a no-op (Apply on it drops the rule) where an empty preset would silently
 * filter the table the moment the popover opens; and it puts Agnieszka's
 * date-first workflow one click from the funnel. The presets sit at the TOP of
 * the operator list, so Klaudiusz's "tomorrow" is one click further, not buried.
 */
const DEFAULT_DATE_OPERATOR: FilterOperator = 'is_between';

/**
 * `FilterDatePicker` and `SelectMenu` portal to `document.body` on their own, so
 * they need a z-index ABOVE this popover or the calendar paints behind the
 * dropdown that opened it.
 */
const NESTED_POPUP_Z = 10002;

/**
 * Roots of the popups this popover opens INSIDE itself.
 *
 * They are React children of the popover but DOM children of `document.body` —
 * every menu in this grid portals — so `popoverRef.contains(target)` is false
 * for a click on the calendar, and the outside-mousedown listener dismissed the
 * whole quick filter the instant a date picker was opened from it. The date
 * editor was unusable by exactly one click.
 *
 * A React `onMouseDownCapture` on the container would see them (synthetic events
 * follow the React tree), but it fires AFTER a document-capture listener, so the
 * popover is already closed by then. Matching the portal roots is what actually
 * runs first.
 */
const NESTED_POPUP_SELECTOR = '.hot-select-menu, .hot-editor-popup, .hot-calendar-popup';

export interface ColumnFilterOption {
  /** Stored value the filter matches on. */
  value: string;
  /** What the user reads. Equals `value` for server-suggested strings. */
  label: string;
}

/**
 * Extra commit detail. OPTIONAL, and absent for every value-list column — the
 * original `onApply(values)` contract is still the whole contract for them, and
 * a host typed `(values: string[]) => void` remains assignable.
 */
export interface ColumnFilterApplyOptions {
  /**
   * The operator the rule should carry. Omitted ⇒ `is_any_of`, i.e. the tick
   * list's behaviour, unchanged.
   */
  operator?: FilterOperator;
}

export interface ColumnFilterPopoverProps {
  column: ColumnDef;
  /**
   * The header cell itself, not a frozen rect. The grid scrolls horizontally
   * under a dropdown that is `position: fixed`, so the rect is re-read on every
   * scroll and resize — the same pattern `SelectMenu`, `FilterValueInput` and
   * `FilterDatePicker` already use, deliberately copied rather than reinvented.
   * Freezing the rect and closing on scroll instead looked equivalent and was
   * not: a stray resize (a devtools overlay, a mobile URL bar, a zoom) then
   * dismisses the dropdown the instant it opens.
   */
  anchorEl: HTMLElement;
  /**
   * Values the live rule already carries, VERBATIM — an `is_between` half-range
   * is stored as `['', '2026-08-10']` and the empty slot is positional, so it
   * must survive the trip. The tick list drops the blanks itself.
   */
  selectedValues: string[];
  /**
   * Operator the live rule carries, when it has one. Only the date editor reads
   * it; the tick list is always `is_any_of`.
   */
  selectedOperator?: FilterOperator;
  /** Server loader already bound to this column's field. */
  loadSuggestions?: (query: string) => Promise<string[]>;
  /**
   * Commit. Empty `values` with no value-taking operator ⇒ remove the rule.
   * The second argument is additive; hosts that ignore it keep the old
   * `is_any_of` behaviour.
   */
  onApply: (values: string[], options?: ColumnFilterApplyOptions) => void;
  onClose: () => void;
}

/** A column's declared `source` as {value,label}. `null` when it has none. */
function staticOptionsOf(column: ColumnDef): ColumnFilterOption[] | null {
  const src = column.source;
  if (!Array.isArray(src) || src.length === 0) return null;
  return src.map((o) =>
    o && typeof o === 'object'
      ? {
          value: String((o as Record<string, unknown>).value ?? (o as Record<string, unknown>).id ?? ''),
          label: String(
            (o as Record<string, unknown>).label ??
              (o as Record<string, unknown>).name ??
              (o as Record<string, unknown>).value ??
              '',
          ),
        }
      : { value: String(o), label: String(o) },
  );
}

/** Columns whose values are a domain to tick, rather than a quantity to bound. */
export function usesValueListFilter(column: ColumnDef | undefined): boolean {
  return column?.type !== 'date';
}

interface BodyProps {
  column: ColumnDef;
  selectedValues: string[];
  selectedOperator?: FilterOperator;
  loadSuggestions?: (query: string) => Promise<string[]>;
  onApply: (values: string[], options?: ColumnFilterApplyOptions) => void;
  onClose: () => void;
}

// ─── Date body ───────────────────────────────────────────────────────────────

/**
 * A14. Operator chooser + the editor that operator needs, and nothing else:
 * presets take no value at all, `is_between` takes two calendar dates, the
 * moving windows (`is_in_next` / `is_in_last`) take a count and a unit — NOT a
 * date, which is why they get the relative editor rather than a picker.
 *
 * Deliberately the same three branches `ConfigureViewFilters` renders, keyed off
 * the same predicates in `types/filters.ts`, so the drawer and the header cannot
 * disagree about what an operator means.
 */
const QuickFilterDateBody: React.FC<BodyProps> = ({
  selectedValues,
  selectedOperator,
  onApply,
  onClose,
}) => {
  const t = useT();
  const operators = useMemo(() => getOperatorsForType('date'), []);

  /** A live rule authored elsewhere (the drawer) is adopted only if a date editor can express it. */
  const adopted = useMemo(
    () =>
      selectedOperator && operators.some((o) => o.value === selectedOperator)
        ? selectedOperator
        : null,
    [selectedOperator, operators],
  );

  const [operator, setOperator] = useState<FilterOperator>(adopted ?? DEFAULT_DATE_OPERATOR);
  const [values, setValues] = useState<string[]>(() => (adopted ? selectedValues.map(String) : []));

  const isRange = needsRangeValues(operator);
  const isRelative = needsRelativeInput(operator);
  const isPicker = !isRange && isDateOperator(operator);
  const takesValue = needsValueInput(operator);

  // Switching operator resets the values so the editor's shape and the stored
  // pair never disagree (range → single, single → count+unit, → none).
  const changeOperator = useCallback((next: string) => {
    setOperator(next as FilterOperator);
    setValues([]);
  }, []);

  const setSlot = useCallback((index: 0 | 1, value: string) => {
    setValues((prev) => {
      const next = [prev[0] ?? '', prev[1] ?? ''];
      next[index] = value;
      return next;
    });
  }, []);

  /**
   * What actually gets stored. A half-filled range is a legitimate filter
   * (`resolveDateWindow` leaves the missing side unbounded), so only a range
   * with BOTH ends blank collapses to "no rule".
   */
  const commitValues = useCallback((): string[] => {
    if (!takesValue) return [];
    if (isRange) {
      const from = (values[0] ?? '').trim();
      const to = (values[1] ?? '').trim();
      return from || to ? [from, to] : [];
    }
    if (isRelative) {
      const count = (values[0] ?? '').trim();
      return count ? [count, values[1] || 'days'] : [];
    }
    const single = (values[0] ?? '').trim();
    return single ? [single] : [];
  }, [takesValue, isRange, isRelative, values]);

  const apply = useCallback(() => {
    onApply(commitValues(), { operator });
    onClose();
  }, [commitValues, operator, onApply, onClose]);

  // No operator handed over ⇒ the host drops the rule. Same shape the tick
  // list's Clear uses, so "clear" means one thing on both bodies.
  const clear = useCallback(() => {
    onApply([]);
    onClose();
  }, [onApply, onClose]);

  const hasLiveRule = adopted != null;
  const canClear = hasLiveRule || commitValues().length > 0;

  return (
    <>
      <div className="hot-quick-filter-date" data-quick-filter-date="">
        <label className="hot-quick-filter-date-field">
          <span className="hot-quick-filter-date-label text-body-medium-sm">
            {t('dynamicTable.quickFilter.condition', 'Condition')}
          </span>
          <SelectMenu
            value={operator}
            onChange={changeOperator}
            options={operators.map((op) => ({
              value: op.value,
              label: t(`dynamicTable.filter.operator.${op.value}`, op.label),
            }))}
            className="hot-config-filter-select hot-quick-filter-control"
            ariaLabel={t('dynamicTable.quickFilter.condition', 'Condition')}
            dataAttributes={{ 'data-quick-filter-operator': operator }}
          />
        </label>

        {isRange && (
          <>
            <label className="hot-quick-filter-date-field" data-quick-filter-range="from">
              <span className="hot-quick-filter-date-label text-body-medium-sm">
                {t('dynamicTable.quickFilter.from', 'From')}
              </span>
              <FilterDatePicker
                value={values[0] ?? ''}
                onChange={(v) => setSlot(0, v)}
                ariaLabel={t('dynamicTable.quickFilter.from', 'From')}
                placeholder={t('dynamicTable.quickFilter.pickDate', 'Pick date')}
                className="hot-quick-filter-control"
                zIndex={NESTED_POPUP_Z}
              />
            </label>
            <label className="hot-quick-filter-date-field" data-quick-filter-range="to">
              <span className="hot-quick-filter-date-label text-body-medium-sm">
                {t('dynamicTable.quickFilter.to', 'To')}
              </span>
              <FilterDatePicker
                value={values[1] ?? ''}
                onChange={(v) => setSlot(1, v)}
                ariaLabel={t('dynamicTable.quickFilter.to', 'To')}
                placeholder={t('dynamicTable.quickFilter.pickDate', 'Pick date')}
                className="hot-quick-filter-control"
                zIndex={NESTED_POPUP_Z}
              />
            </label>
          </>
        )}

        {isPicker && (
          <label className="hot-quick-filter-date-field" data-quick-filter-range="single">
            <span className="hot-quick-filter-date-label text-body-medium-sm">
              {t('dynamicTable.quickFilter.date', 'Date')}
            </span>
            <FilterDatePicker
              value={values[0] ?? ''}
              onChange={(v) => setSlot(0, v)}
              ariaLabel={t('dynamicTable.quickFilter.date', 'Date')}
              placeholder={t('dynamicTable.quickFilter.pickDate', 'Pick date')}
              className="hot-quick-filter-control"
              zIndex={NESTED_POPUP_Z}
            />
          </label>
        )}

        {isRelative && (
          // A moving window, not a calendar date: "next 7 days" has to keep
          // meaning that tomorrow, so what is stored is [count, unit].
          <div className="hot-quick-filter-date-field hot-quick-filter-relative">
            <span className="hot-quick-filter-date-label text-body-medium-sm">
              {t('dynamicTable.quickFilter.window', 'Window')}
            </span>
            <div className="hot-quick-filter-relative-row">
              <input
                type="number"
                min={1}
                step={1}
                className="hot-config-filter-input hot-quick-filter-control hot-quick-filter-count"
                value={values[0] ?? ''}
                onChange={(e) => setSlot(0, e.target.value)}
                placeholder={t('dynamicTable.quickFilter.count', 'count')}
                aria-label={t('dynamicTable.quickFilter.count', 'count')}
                data-quick-filter-count=""
              />
              <SelectMenu
                value={values[1] || 'days'}
                onChange={(next) => setSlot(1, next)}
                options={RELATIVE_DATE_UNITS.map((u) => ({
                  value: u,
                  label: t(`dynamicTable.filter.unit.${u}`, u),
                }))}
                className="hot-config-filter-select hot-quick-filter-control"
                ariaLabel={t('dynamicTable.quickFilter.unit', 'Unit')}
                dataAttributes={{ 'data-quick-filter-unit': values[1] || 'days' }}
              />
            </div>
          </div>
        )}

        {!takesValue && (
          // A preset carries no editor at all — say what it will do rather than
          // leaving a blank panel that reads as "still loading".
          <p className="hot-quick-filter-note text-body-regular-xs" data-quick-filter-preset="">
            {t('dynamicTable.quickFilter.presetHint', 'Applies to {condition}, recalculated every time.', {
              condition: t(`dynamicTable.filter.operator.${operator}`, operator),
            })}
          </p>
        )}
      </div>

      {/* A2/D6 made visible. The user must never mistake this for a saved view. */}
      <p className="hot-quick-filter-transient text-body-regular-xs">
        {t('dynamicTable.quickFilter.transient', 'Temporary — not saved with the view.')}
      </p>

      <div className="hot-quick-filter-footer">
        <Button
          variant="ghost"
          size="xs"
          onClick={clear}
          disabled={!canClear}
          data-quick-filter-clear=""
        >
          {t('dynamicTable.quickFilter.clear', 'Clear filter')}
        </Button>
        <Button variant="primary" size="xs" onClick={apply} data-quick-filter-apply="">
          {t('dynamicTable.quickFilter.apply', 'Apply')}
        </Button>
      </div>
    </>
  );
};

// ─── Value-list body ─────────────────────────────────────────────────────────

const QuickFilterValueListBody: React.FC<BodyProps> = ({
  column,
  selectedValues,
  loadSuggestions,
  onApply,
  onClose,
}) => {
  const t = useT();
  const store = useCellStore();
  const [query, setQuery] = useState('');
  // Working copy. Nothing reaches the table until Apply — a live-applying tick
  // list would fire one server query per checkbox.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(selectedValues.filter((v) => v !== '')),
  );
  /**
   * The values the column ARRIVED filtered by. Frozen at open, deliberately:
   * leading the list with the *live* tick set makes a row jump out from under
   * the cursor the moment it is unticked, and the next click lands on whatever
   * slid into its place.
   */
  const pinnedRef = useRef<string[]>(selectedValues.filter((v) => v !== ''));

  const staticOptions = useMemo(() => staticOptionsOf(column), [column]);
  /**
   * A column that declares its own option set is authoritative — don't ask the
   * server for values it already knows, and never show a raw value where the
   * grid shows a label.
   */
  const effectiveLoader = staticOptions ? undefined : loadSuggestions;

  /**
   * Last-resort value source: the distinct values of the rows currently loaded.
   * Honest but partial — the footnote says so rather than pretending it is the
   * whole domain.
   */
  const pageOptions = useMemo<ColumnFilterOption[] | null>(() => {
    if (staticOptions || effectiveLoader) return null;
    const seen = new Set<string>();
    const rowCount = store.getRowCount();
    for (let row = 0; row < rowCount; row++) {
      const rowData = store.getRowData(row) as Record<string, unknown> | undefined;
      const raw = rowData?.[column.data];
      if (raw == null) continue;
      const value = String(raw).trim();
      if (value) seen.add(value);
    }
    return Array.from(seen)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [staticOptions, effectiveLoader, store, column.data]);

  const { values: fetched, loading, failed } = useSuggestionFetch(effectiveLoader, query, true);

  /**
   * The rendered list. Ticked values ALWAYS lead, even when the server did not
   * return them for this needle — otherwise a value the user just ticked
   * vanishes as soon as they type, and they cannot tell what is still selected.
   */
  const options = useMemo<ColumnFilterOption[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (o: ColumnFilterOption) => !needle || o.label.toLowerCase().includes(needle);

    const source: ColumnFilterOption[] = effectiveLoader
      ? // The server already applied the needle AND the cap; re-filtering here
        // would drop values it deliberately returned.
        fetched.map((v) => ({ value: v, label: v }))
      : (staticOptions ?? pageOptions ?? []).filter(matches);

    const out: ColumnFilterOption[] = [];
    const seen = new Set<string>();
    for (const value of pinnedRef.current) {
      const known =
        staticOptions?.find((o) => o.value === value) ?? pageOptions?.find((o) => o.value === value);
      const option = known ?? { value, label: value };
      if (matches(option) && !seen.has(value)) {
        out.push(option);
        seen.add(value);
      }
    }
    for (const option of source) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      out.push(option);
    }
    return out;
  }, [query, effectiveLoader, fetched, staticOptions, pageOptions]);

  const visibleValues = useMemo(() => options.map((o) => o.value), [options]);
  const allVisibleChecked = visibleValues.length > 0 && visibleValues.every((v) => checked.has(v));
  const someVisibleChecked = !allVisibleChecked && visibleValues.some((v) => checked.has(v));

  const toggle = useCallback((value: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (visibleValues.every((v) => next.has(v))) visibleValues.forEach((v) => next.delete(v));
      else visibleValues.forEach((v) => next.add(v));
      return next;
    });
  }, [visibleValues]);

  const apply = useCallback(() => {
    onApply(Array.from(checked));
    onClose();
  }, [checked, onApply, onClose]);

  const clear = useCallback(() => {
    onApply([]);
    onClose();
  }, [onApply, onClose]);

  const emptyState = loading
    ? t('dynamicTable.quickFilter.loading', 'Loading…')
    : failed
      ? t('dynamicTable.quickFilter.failed', 'Values unavailable — the filter still applies')
      : query.trim()
        ? t('dynamicTable.quickFilter.noMatches', 'No matching values')
        : t('dynamicTable.quickFilter.noValues', 'No values');

  return (
    <>
      <div className="hot-quick-filter-search">
        <SearchInput
          autoFocus
          /* NOT `type="search"` (the primitive's default): Chrome paints its own
             native cancel "×" on a search input, which lands right beside the
             primitive's clear button — two crosses, one box. */
          type="text"
          inputSize="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
          placeholder={t('dynamicTable.quickFilter.search', 'Search values…')}
          aria-label={t('dynamicTable.quickFilter.search', 'Search values…')}
          data-quick-filter-search=""
        />
      </div>

      <div className="hot-quick-filter-list" data-suggestions-state={loading ? 'loading' : failed ? 'error' : options.length ? 'ready' : 'empty'}>
        {options.length > 0 ? (
          <>
            <label className="hot-quick-filter-option hot-quick-filter-select-all">
              <Checkbox
                checked={allVisibleChecked}
                indeterminate={someVisibleChecked}
                onChange={toggleAllVisible}
                data-quick-filter-all=""
              />
              <span className="text-body-medium-sm">
                {t('dynamicTable.quickFilter.selectAll', 'Select all')}
              </span>
            </label>
            {options.map((option) => (
              // `data-selected` carries the M3 selected treatment (the
              // `secondary-container` swap in ContextMenu.css) so a ticked
              // value reads the same way a selected row and a selected menu
              // item do, instead of being announced by the checkbox alone.
              <label
                key={option.value}
                className="hot-quick-filter-option"
                title={option.label}
                data-selected={checked.has(option.value) || undefined}
              >
                <Checkbox
                  checked={checked.has(option.value)}
                  onChange={() => toggle(option.value)}
                  data-quick-filter-value={option.value}
                />
                <span className="text-body-regular-sm hot-quick-filter-option-label">{option.label}</span>
              </label>
            ))}
          </>
        ) : (
          <span className="hot-quick-filter-note text-body-regular-xs">{emptyState}</span>
        )}
      </div>

      {/* A2/D6 made visible. The user must never mistake this for a saved view. */}
      <p className="hot-quick-filter-transient text-body-regular-xs">
        {pageOptions
          ? t(
              'dynamicTable.quickFilter.transientPage',
              'Temporary — not saved. Values from the loaded page.',
            )
          : t('dynamicTable.quickFilter.transient', 'Temporary — not saved with the view.')}
      </p>

      <div className="hot-quick-filter-footer">
        <Button
          variant="ghost"
          size="xs"
          onClick={clear}
          disabled={selectedValues.length === 0 && checked.size === 0}
          data-quick-filter-clear=""
        >
          {t('dynamicTable.quickFilter.clear', 'Clear filter')}
        </Button>
        <Button variant="primary" size="xs" onClick={apply} data-quick-filter-apply="">
          {t('dynamicTable.quickFilter.apply', 'Apply')}
        </Button>
      </div>
    </>
  );
};

// ─── Shell ───────────────────────────────────────────────────────────────────

export const ColumnFilterPopover: React.FC<ColumnFilterPopoverProps> = ({
  column,
  anchorEl,
  selectedValues,
  selectedOperator,
  loadSuggestions,
  onApply,
  onClose,
}) => {
  const t = useT();
  const popoverRef = useRef<HTMLDivElement>(null);
  const valueList = usesValueListFilter(column);

  // ── Dismissal ──────────────────────────────────────────────────────────────
  // CAPTURE on mousedown: the grid's own handlers call stopPropagation, so a
  // bubbling listener never sees a click on the table and the popover sticks.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      // …and the popups this popover itself opened, which portal to <body>.
      if (target instanceof Element && target.closest(NESTED_POPUP_SELECTOR)) return;
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [onClose]);

  /**
   * Escape closes THIS popover — and, while a calendar or an operator menu is
   * open INSIDE it, closes that instead. A plain document-capture listener
   * could not express the nesting (and a surrounding Sheet's Radix layer
   * outranks it anyway); `useEscapeLayer` keeps a stack so only the innermost
   * layer consumes the key. The grid's own Escape (clear selection) and the
   * drawer's still never see it.
   */
  useEscapeLayer(true, onClose);

  // ── Placement ──────────────────────────────────────────────────────────────
  const preferredHeight = valueList ? ESTIMATED_HEIGHT : ESTIMATED_DATE_HEIGHT;
  const [position, setPosition] = useState(() => ({
    top: -9999,
    left: -9999,
    maxHeight: preferredHeight,
    flipAbove: false,
  }));

  const reposition = useCallback(() => {
    if (!anchorEl.isConnected) {
      // The header was unmounted under us — a column-virtualization scroll, a
      // hidden column, a perspective switch. A dropdown anchored to nothing is
      // worse than no dropdown.
      onClose();
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    setPosition(
      computeAnchoredPosition(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        { width: POPOVER_WIDTH, preferredHeight, minHeight: 200 },
      ),
    );
  }, [anchorEl, onClose, preferredHeight]);

  useLayoutEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    // Capture phase so the GRID's own horizontal scroll is seen, not just the
    // window's. The dropdown tracks its header instead of detaching from it.
    const onScroll = (e: Event) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      reposition();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', reposition);
    };
  }, [reposition]);

  const style: React.CSSProperties = {
    position: 'fixed',
    top: position.top,
    left: position.left,
    width: POPOVER_WIDTH,
    // Capping the height is what makes `translateY(-100%)` safe — see
    // utils/anchoredPosition. The value list is the flexible section, so a
    // short viewport shortens the list rather than clipping the search box or
    // the Apply button.
    maxHeight: position.maxHeight,
    zIndex: 10001,
    ...(position.flipAbove ? { transform: 'translateY(-100%)' } : {}),
  };

  const bodyProps: BodyProps = {
    column,
    selectedValues,
    selectedOperator,
    loadSuggestions,
    onApply,
    onClose,
  };

  const content = (
    <div
      ref={popoverRef}
      className="hot-quick-filter hot-appearance-v2"
      style={style}
      role="dialog"
      aria-label={t('dynamicTable.quickFilter.title', 'Filter {column}', {
        column: column.title || column.data,
      })}
      data-quick-filter={column.data}
      /* Which editor the column got. The tick list is meaningless for a date,
         so the branch is worth asserting on from a test or the harness. */
      data-quick-filter-kind={valueList ? 'values' : 'date'}
    >
      {valueList ? (
        <QuickFilterValueListBody {...bodyProps} />
      ) : (
        <QuickFilterDateBody {...bodyProps} />
      )}
    </div>
  );

  if (typeof document === 'undefined') return content;
  return ReactDOM.createPortal(content, document.body);
};

export default ColumnFilterPopover;
