// perspectiveHandlers.ts

import React from 'react';
import { dispatch } from '../events/events';
import {
  ColumnDef,
  FilterRow,
  FilterColor,
  TableEvents,
} from '../types/index';
import {
  SortRule,
  PerspectiveConfig,
  TableViewMode,
  PerspectiveSaveEvent,
  PerspectiveSelectEvent,
  PerspectiveRenameEvent,
  PerspectiveDeleteEvent,
  PerspectiveChangeEvent,
  PerspectiveDuplicateEvent,
  PerspectiveSetDefaultEvent,
  PerspectivePublishEvent,
  PerspectiveTemplateCopyEvent,
  PerspectiveTemplate,
  generatePerspectiveId,
  ColumnConfig,
  LookupColumnRef,
} from '../types/perspective';
import type { GroupRule, AggregationRule } from '../types/grouping';
import type { RollupColumnRef } from '../types/rollup';
import type { ConditionalFormatRule } from '../utils/conditionalFormat';
import type { FormulaColumnRef } from '../formula/types';

// ============================================
// PERSPECTIVE STATE INTERFACE
// ============================================

export interface PerspectiveState {
  /** Visible columns in display order */
  visibleColumns: string[];
  /** Hidden columns */
  hiddenColumns: string[];
  /** Active filter rules */
  filters: FilterRow[];
  /** Active sort rules */
  sortRules: SortRule[];
  /** Active group rules */
  groupRules: GroupRule[];
  /** Active per-group aggregation rules */
  aggregations: AggregationRule[];
  /** Active read-only linked (lookup) columns */
  lookupColumns: LookupColumnRef[];
  /** Active read-only rollup ("summarised") columns over child records */
  rollupColumns: RollupColumnRef[];
  /** Active view-scoped calculated ("formula") columns */
  formulas: FormulaColumnRef[];
  /** Active view-scoped conditional-formatting ("Highlighting") rules */
  conditionalFormats: ConditionalFormatRule[];
  /** Columns pinned sticky-left in this view, in pin order (HEDGE-102) */
  frozenColumns: string[];
  /** How this view draws its rows. Undefined = never chosen ⇒ 'table'. */
  viewMode?: TableViewMode;
  /** Active view-scoped date/time format (opaque host token); undefined = default */
  dateFormat?: string;
}

// ============================================
// HANDLER DEPENDENCIES
// ============================================

export interface PerspectiveHandlersDeps {
  tableRef: React.RefObject<HTMLElement | null>;
  columns: ColumnDef[];
  savedPerspectives: PerspectiveConfig[];
  activePerspectiveId: string | null;
  /** The host's default view — see `resolvePerspectiveState`. Selecting the
   *  "Default view" tab must reproduce it, not a hand-rolled approximation. */
  defaultHiddenColumns?: string[];
  defaultGrouping?: GroupRule[];
  // State setters
  setVisibleColumns: React.Dispatch<React.SetStateAction<string[]>>;
  setHiddenColumns: React.Dispatch<React.SetStateAction<string[]>>;
  setFilters: React.Dispatch<React.SetStateAction<FilterRow[]>>;
  setSortRules: React.Dispatch<React.SetStateAction<SortRule[]>>;
  setGroupRules: React.Dispatch<React.SetStateAction<GroupRule[]>>;
  setAggregations: React.Dispatch<React.SetStateAction<AggregationRule[]>>;
  setLookupColumns: React.Dispatch<React.SetStateAction<LookupColumnRef[]>>;
  setRollupColumns: React.Dispatch<React.SetStateAction<RollupColumnRef[]>>;
  setFormulas: React.Dispatch<React.SetStateAction<FormulaColumnRef[]>>;
  setConditionalFormats: React.Dispatch<React.SetStateAction<ConditionalFormatRule[]>>;
  /** HEDGE-102 — the view's pinned columns, applied wherever the others are. */
  setFrozenColumns: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDateFormat: React.Dispatch<React.SetStateAction<string | undefined>>;
  setInternalActivePerspectiveId: React.Dispatch<React.SetStateAction<string | null>>;
}

// ============================================
// CREATE PERSPECTIVE HANDLERS
// ============================================

export function createPerspectiveHandlers({
  tableRef,
  columns,
  savedPerspectives,
  activePerspectiveId,
  setVisibleColumns,
  setHiddenColumns,
  setFilters,
  setSortRules,
  setGroupRules,
  setAggregations,
  setLookupColumns,
  setRollupColumns,
  setFormulas,
  setConditionalFormats,
  setFrozenColumns,
  setDateFormat,
  setInternalActivePerspectiveId,
  defaultHiddenColumns,
  defaultGrouping,
}: PerspectiveHandlersDeps) {
  // -------------------- Column Handlers --------------------

  const handleColumnVisibilityChange = (visible: string[], hidden: string[]) => {
    setVisibleColumns(visible);
    setHiddenColumns(hidden);

    // Dispatch change event
    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: {
          columns: { visible, hidden },
        },
      }
    );
  };

  const handleColumnOrderChange = (newOrder: string[]) => {
    setVisibleColumns(newOrder);

    // Dispatch change event
    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: {
          columns: {
            visible: newOrder,
            hidden: [], // Will be filled by the component
          },
        },
      }
    );
  };

  // -------------------- Filter Handlers --------------------

  const handleFiltersChange = (filters: FilterRow[]) => {
    setFilters(filters);

    // Dispatch change event
    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { filters },
      }
    );
  };

  // -------------------- Sort Handlers --------------------

  const handleSortRulesChange = (rules: SortRule[]) => {
    setSortRules(rules);

    // Dispatch change event
    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { sorting: rules },
      }
    );
  };

  // -------------------- Group Handlers --------------------

  const handleGroupRulesChange = (rules: GroupRule[]) => {
    setGroupRules(rules);

    // Dispatch change event
    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { grouping: rules },
      }
    );
  };

  // -------------------- Aggregation Handlers --------------------

  const handleAggregationsChange = (rules: AggregationRule[]) => {
    setAggregations(rules);

    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { aggregations: rules },
      }
    );
  };

  // -------------------- Lookup (Linked) Column Handlers --------------------

  const handleLookupColumnsChange = (lookupColumns: LookupColumnRef[]) => {
    setLookupColumns(lookupColumns);

    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { lookupColumns },
      }
    );
  };

  // -------------------- Rollup (Summarised) Column Handlers --------------------

  const handleRollupColumnsChange = (rollupColumns: RollupColumnRef[]) => {
    setRollupColumns(rollupColumns);

    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { rollupColumns },
      }
    );
  };

  // -------------------- Calculated (Formula) Column Handlers --------------------

  const handleFormulasChange = (formulas: FormulaColumnRef[]) => {
    setFormulas(formulas);

    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { formulas },
      }
    );
  };

  // -------------------- Conditional-format (Highlighting) Handlers --------------------

  const handleConditionalFormatsChange = (conditionalFormats: ConditionalFormatRule[]) => {
    setConditionalFormats(conditionalFormats);

    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { conditionalFormats },
      }
    );
  };

  // -------------------- Date-format Handler --------------------

  const handleDateFormatChange = (dateFormat: string | undefined) => {
    setDateFormat(dateFormat);

    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { dateFormat },
      }
    );
  };

  // -------------------- Perspective Save/Select/Delete --------------------

  /**
   * `silent` suppresses only the host's success toast — see
   * `PerspectiveSaveEvent.silent`. It exists for the column order written back
   * after a header drag, where one "Perspective saved" per dragged column would
   * be noise rather than feedback.
   */
  const handleSavePerspective = (perspective: PerspectiveConfig, silent = false) => {
    // Dispatch save event with full perspective data ready for API
    dispatch<PerspectiveSaveEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_SAVE,
      { perspective, silent }
    );

    // Set as active
    setInternalActivePerspectiveId(perspective.id);
  };

  const handlePerspectiveSelect = (id: string | null) => {
    setInternalActivePerspectiveId(id);

    if (id === null) {
      /**
       * Back to the DEFAULT view — resolved by `resolvePerspectiveState`, not
       * rebuilt here.
       *
       * This branch used to compute the default itself: every column visible,
       * nothing filtered, nothing grouped. That was a SECOND definition of "the
       * default view", and it disagreed with the real one in two ways that both
       * reached users:
       *
       *  - it ignored `defaultHiddenColumns`, so returning to the default tab
       *    revealed columns the table declares hidden;
       *  - it hard-coded `setGroupRules([])`, so a table that OPENS grouped
       *    (`defaultGrouping`) lost its grouping the moment this ran — measured
       *    on the documents list, where the grid drew one ungrouped section
       *    while the props carried a perfectly good `caseNumber` rule.
       *
       * The file already says there must be one place a perspective becomes
       * table state. The default view is a perspective like any other; this is
       * it obeying that rule.
       */
      const next = resolvePerspectiveState({
        baseColumns: columns,
        perspective: null,
        defaultHiddenColumns,
        defaultGrouping,
      });
      setVisibleColumns(next.visibleColumns);
      setHiddenColumns(next.hiddenColumns);
      setFilters(next.filters);
      setSortRules(next.sortRules);
      setGroupRules(next.groupRules);
      setAggregations(next.aggregations);
      setLookupColumns(next.lookupColumns);
      setRollupColumns(next.rollupColumns);
      setFormulas(next.formulas);
      setConditionalFormats(next.conditionalFormats);
      setFrozenColumns(new Set(next.frozenColumns));
      setDateFormat(next.dateFormat);

      dispatch<PerspectiveSelectEvent>(
        tableRef.current as HTMLElement,
        TableEvents.PERSPECTIVE_SELECT,
        { id: null, config: null }
      );
    } else {
      const perspective = savedPerspectives.find(p => p.id === id);
      if (perspective) {
        setVisibleColumns(perspective.columns.visible);
        setHiddenColumns(perspective.columns.hidden);
        setFilters(perspective.filters);
        setSortRules(perspective.sorting);
        setGroupRules(perspective.grouping ?? []);
        setAggregations(perspective.aggregations ?? []);
        setLookupColumns(perspective.lookupColumns ?? []);
        setRollupColumns(perspective.rollupColumns ?? []);
        setFormulas(perspective.formulas ?? []);
        setConditionalFormats(perspective.conditionalFormats ?? []);
        setFrozenColumns(new Set(perspective.frozenColumns ?? []));
        setDateFormat(perspective.dateFormat);

        dispatch<PerspectiveSelectEvent>(
          tableRef.current as HTMLElement,
          TableEvents.PERSPECTIVE_SELECT,
          { id, config: perspective }
        );
      }
    }
  };

  const handlePerspectiveRename = (id: string, newName: string) => {
    dispatch<PerspectiveRenameEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_RENAME,
      { id, newName }
    );
  };

  /**
   * A6 — copy a saved view under a new name. The whole source config travels
   * with the event so the host writes one POST and never has to reconstruct
   * settings from the live grid state (which may have drifted).
   */
  const handlePerspectiveDuplicate = (id: string, newName: string) => {
    const source = savedPerspectives.find(p => p.id === id);
    if (!source) return;
    dispatch<PerspectiveDuplicateEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_DUPLICATE,
      { sourceId: id, newName, perspective: { ...source, name: newName, isDefault: false } }
    );
  };

  /**
   * A4 — make a view THIS USER's default. Per-user by construction: the
   * upstream perspectives service scopes `isDefault` by `userId`.
   */
  const handlePerspectiveSetDefault = (id: string) => {
    dispatch<PerspectiveSetDefaultEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_SET_DEFAULT,
      { id, isDefault: true }
    );
  };

  /**
   * Publish one of MY views as a shared template others can copy. Explicit and
   * additive: it creates a copyable template and changes nobody's active view.
   */
  const handlePerspectivePublish = (id: string, roleIds: string[]) => {
    const source = savedPerspectives.find(p => p.id === id);
    if (!source || !roleIds.length) return;
    dispatch<PerspectivePublishEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_PUBLISH,
      { id, roleIds, name: source.name }
    );
  };

  /** Copy a shared template into this user's own space. The template is untouched. */
  const handlePerspectiveTemplateCopy = (template: PerspectiveTemplate, newName: string) => {
    dispatch<PerspectiveTemplateCopyEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_TEMPLATE_COPY,
      { template, newName }
    );
  };

  const handlePerspectiveDelete = (id: string, hardDelete?: boolean) => {
    dispatch<PerspectiveDeleteEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_DELETE,
      { id, hardDelete }
    );

    // If deleting active perspective, reset
    if (activePerspectiveId === id) {
      setInternalActivePerspectiveId(null);
      const allColumnKeys = columns.map(c => c.data);
      setVisibleColumns(allColumnKeys);
      setHiddenColumns([]);
      setFilters([]);
      setSortRules([]);
      setGroupRules([]);
      setAggregations([]);
      setLookupColumns([]);
      setRollupColumns([]);
      setFormulas([]);
      setConditionalFormats([]);
      setFrozenColumns(new Set());
      setDateFormat(undefined);
    }
  };

  return {
    // Column handlers
    handleColumnVisibilityChange,
    handleColumnOrderChange,
    // Filter handlers
    handleFiltersChange,
    // Sort handlers
    handleSortRulesChange,
    // Group handlers
    handleGroupRulesChange,
    // Aggregation handlers
    handleAggregationsChange,
    // Lookup (linked) column handlers
    handleLookupColumnsChange,
    // Rollup (summarised) column handlers
    handleRollupColumnsChange,
    // Calculated (formula) column handlers
    handleFormulasChange,
    // Conditional-format (Highlighting) handlers
    handleConditionalFormatsChange,
    // Date-format handler
    handleDateFormatChange,
    // Perspective management
    handleSavePerspective,
    handlePerspectiveSelect,
    handlePerspectiveRename,
    handlePerspectiveDelete,
    handlePerspectiveDuplicate,
    handlePerspectiveSetDefault,
    handlePerspectivePublish,
    handlePerspectiveTemplateCopy,
  };
}

// ============================================
// UTILITY: Initialize State from Perspective
// ============================================

/**
 * Drop duplicate column keys, keeping the first occurrence and its order.
 * Warns in development so the offending table config gets fixed at the source.
 */
export function dedupeColumnKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const dupes: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) {
      dupes.push(key);
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  if (dupes.length > 0 && process.env.NODE_ENV !== 'production') {
    console.warn(
      `[DynamicTable] Duplicate column key(s) in table config: ${[...new Set(dupes)].join(', ')}. ` +
        'Keeping the first definition of each; remove the duplicates from the column config.',
    );
  }
  return out;
}

/**
 * Everything the resolver needs to turn "which saved view is active?" into the
 * table's column / filter / sort state.
 *
 * Deliberately a SINGLE OBJECT rather than positional parameters: the Excel-platform
 * specs each add one more input to perspective resolution (conditional formatting,
 * import mappings, formula columns). With an object they add a field; with
 * positional parameters every call site would be rewritten each time.
 */
export interface ResolvePerspectiveStateInput {
  /** Every column the table can show, in declaration order. */
  baseColumns: ColumnDef[];
  /** The saved view to apply. `null` / omitted resolves the default view. */
  perspective?: PerspectiveConfig | null;
  /** Columns the host hides when no saved view is active. */
  defaultHiddenColumns?: string[];
  /**
   * How the host groups rows when no saved view is active.
   *
   * The DEFAULT VIEW, not a floor. It seeds the default state exactly the way
   * `defaultHiddenColumns` does, and a saved perspective replaces it wholesale —
   * including a perspective that deliberately groups by nothing, which must be
   * able to say so. Merging the two would make "ungrouped" unsayable.
   */
  defaultGrouping?: GroupRule[];
}

/**
 * The ONE place a perspective becomes table state.
 *
 * There used to be two: a `initializePerspectiveState` effect that honoured
 * `defaultHiddenColumns`, and a second "sync controlled props" effect that copied
 * the perspective's raw fields and did not. Both ran on the same commit and raced,
 * so whether a host's hidden columns survived depended on effect ordering. Anything
 * that applies a perspective now goes through here.
 */
export function resolvePerspectiveState({
  baseColumns,
  perspective,
  defaultHiddenColumns = [],
  defaultGrouping = [],
}: ResolvePerspectiveStateInput): PerspectiveState {
  if (perspective) {
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * A BASE VIEW IS A PERSONALIZATION, NOT A FROZEN SNAPSHOT
     * ═══════════════════════════════════════════════════════════════════════
     *
     * The `__base__` row records what a user changed about the DEFAULT view —
     * see `isBaseView` in types/perspective.ts. But it is stored as a complete
     * snapshot of the columns, and it is written on the user's first visit. So
     * once anyone has opened a table, a column added to that table's default
     * config afterwards is INVISIBLE to them, for ever, with nothing on screen
     * explaining the absence.
     *
     * Measured, not theorised: adding a `caseNumber` column to the documents
     * list and reloading produced the old ten headers on an account whose
     * `__base__` row was written before the column existed.
     *
     * A NAMED view is a different thing and is left alone — a user who built
     * "Due for payment" chose its columns, and a new column appearing in it
     * uninvited would be a real intrusion.
     *
     * The rule is narrow on purpose: a column the base view has NO OPINION
     * about — absent from both its visible and its hidden list — is new, and
     * takes the default's answer. A column the user hid stays hidden.
     */
    const isBase = perspective.isBaseView === true;
    // `columns.hidden` cannot answer "has this view seen the column?" — it is
    // derived from the table's own column list, so a newcomer lands in it
    // looking exactly like one the user hid. `unseenColumns` is computed where
    // the raw stored maps still exist; see `apiToDynamicTable`.
    const unseen = isBase ? (perspective.unseenColumns ?? []) : [];
    const visibleColumns = unseen.length > 0
      // Declaration order, not appended at the end: a column's position in the
      // table config is a design decision, and dropping every newcomer at the
      // far right would put "Case" after "Actions".
      ? dedupeColumnKeys(baseColumns.map(c => c.data)).filter(
          k => perspective.columns.visible.includes(k)
            || (unseen.includes(k) && !defaultHiddenColumns.includes(k)),
        )
      : perspective.columns.visible;
    // The incoming `hidden` list ALREADY contains every unseen column, because
    // it is derived as "the table's columns minus the visible ones". So the
    // unseen keys are stripped out first and only those the table itself hides
    // by default are put back — otherwise a newcomer would appear in the visible
    // list AND the hidden one at the same time.
    const hiddenColumns = unseen.length > 0
      ? [
          ...perspective.columns.hidden.filter(k => !unseen.includes(k)),
          ...unseen.filter(k => defaultHiddenColumns.includes(k)),
        ]
      : perspective.columns.hidden;

    /**
     * Grouping follows the SAME "no opinion" test, and nothing looser.
     *
     * A stored `grouping: []` cannot distinguish "I ungrouped this deliberately"
     * from "this table had no default grouping when my row was written" — so an
     * empty grouping is NOT simply replaced by the default. It is replaced only
     * when the default groups by a column this view has never seen, because
     * then the view demonstrably has no opinion about it. Once `caseNumber` is
     * in the user's column set, ungrouping it sticks.
     */
    const storedGrouping = perspective.grouping ?? [];
    const groupRules = isBase
      && storedGrouping.length === 0
      && defaultGrouping.length > 0
      && defaultGrouping.every(r => unseen.includes(r.field))
      ? defaultGrouping
      : storedGrouping;

    return {
      visibleColumns,
      hiddenColumns,
      filters: perspective.filters,
      sortRules: perspective.sorting,
      groupRules,
      aggregations: perspective.aggregations ?? [],
      lookupColumns: perspective.lookupColumns ?? [],
      rollupColumns: perspective.rollupColumns ?? [],
      formulas: perspective.formulas ?? [],
      conditionalFormats: perspective.conditionalFormats ?? [],
      frozenColumns: perspective.frozenColumns ?? [],
      dateFormat: perspective.dateFormat,
      viewMode: perspective.viewMode,
    };
  }

  // Default state. Column keys are de-duplicated first: a table config that
  // declares the same `data` key twice (once visible, once hidden) would
  // otherwise drop BOTH copies here — `defaultHiddenColumns` contains the key,
  // so the filter below removes every occurrence and the column vanishes from
  // the default view entirely. `cols` in DynamicTable resolves a key to the
  // first matching definition anyway, so keeping the first is the honest match.
  const allColumnKeys = dedupeColumnKeys(baseColumns.map(c => c.data));
  const visibleColumns = allColumnKeys.filter(k => !defaultHiddenColumns.includes(k));
  const hiddenColumns = defaultHiddenColumns.filter(k => allColumnKeys.includes(k));

  return {
    visibleColumns,
    hiddenColumns,
    filters: [],
    sortRules: [],
    // Only rules naming a column this table actually has. A default that points
    // at a key the host did not declare would group every row under `undefined`
    // and give the user one section called "Ungrouped" with no way to see why.
    groupRules: defaultGrouping.filter(rule => allColumnKeys.includes(rule.field)),
    aggregations: [],
    lookupColumns: [],
    rollupColumns: [],
    formulas: [],
    conditionalFormats: [],
    // Nothing pinned until the user pins something. A table's own config pins
    // via `ColumnDef.sticky`, which is separate and not user-editable.
    frozenColumns: [],
  };
}
