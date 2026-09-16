import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
} from '@freighttech/ui/primitives/sheet';
import { ChevronDown, ChevronUp, Eye, Filter, ArrowUpDown, Layers, Link2, CalendarClock, ListTree, Palette, Sigma, X } from 'lucide-react';
import { ColumnDef, FilterRow, FilterColor, LoadFilterSuggestions, LoadLookupSources } from '../types/index';
import type { LoadRollupSources, RollupColumnRef } from '../types/rollup';
import {
  SortRule,
  PerspectiveConfig,
  LookupColumnRef,
  generatePerspectiveId,
  BASE_VIEW_PERSPECTIVE_NAME,
  PERSPECTIVE_NAME_MAX_LENGTH,
} from '../types/perspective';
import type { TableViewMode } from '../types/perspective';
import type { GroupRule, AggregationRule } from '../types/grouping';
import ConfigureViewFields from './ConfigureViewFields';
import ConfigureViewFilters from './ConfigureViewFilters';
import ConfigureViewSorting from './ConfigureViewSorting';
import ConfigureViewGrouping from './ConfigureViewGrouping';
import ConfigureViewLinkedColumns from './ConfigureViewLinkedColumns';
import ConfigureViewRollups from './ConfigureViewRollups';
import ConfigureViewFormatting from './ConfigureViewFormatting';
import ConfigureViewFormulas from './ConfigureViewFormulas';
import SelectMenu from './SelectMenu';
import type { ConditionalFormatRule } from '../utils/conditionalFormat';
import type { FormulaColumnRef } from '../formula/types';
import { isFormulaColumnKey } from '../utils/formulaColumns';
import { Button, IconButton, Input } from '../../../primitives-v2';
import { useT } from '@open-mercato/shared/lib/i18n/context';

/**
 * Saved-view colour swatches — the ORDER only. The colour itself comes from
 * `.hot-config-color-<name>` in DynamicTable.v2.css, which resolves the
 * `--m3-view-color-*` tokens.
 *
 * This list used to carry a `bg` hex per entry and set it inline. That was dead
 * code: the CSS rule is `!important` and the v2 appearance is always on, so the
 * inline value never won — it was a second, quietly diverging copy of the
 * palette that no one could see was wrong.
 */
const COLOR_PALETTE: { color: FilterColor }[] = [
  { color: 'blue' },
  { color: 'green' },
  { color: 'teal' },
  { color: 'purple' },
  { color: 'pink' },
  { color: 'red' },
  { color: 'orange' },
  { color: 'yellow' },
];

interface ConfigureViewPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  columns: ColumnDef[];
  visibleColumns: string[];
  hiddenColumns: string[];
  filters: FilterRow[];
  sortRules: SortRule[];
  groupRules?: GroupRule[];
  aggregations?: AggregationRule[];
  lookupColumns?: LookupColumnRef[];
  /** View-scoped rollup ("summarised") columns over child records. */
  rollupColumns?: RollupColumnRef[];
  /** View-scoped calculated ("formula") columns. */
  formulas?: FormulaColumnRef[];
  /** View-scoped conditional-formatting ("Highlighting") rules. */
  conditionalFormats?: ConditionalFormatRule[];
  /** One loaded row, so the formula editor can show a live first-row preview. */
  sampleRow?: Record<string, unknown>;
  /** Active view-scoped date/time format (opaque host token); undefined = default. */
  dateFormat?: string;
  /** Host-supplied date-format presets. When non-empty, the "Date format"
   *  selector is shown. */
  dateFormatOptions?: { value: string; label: string }[];
  onColumnVisibilityChange: (visible: string[], hidden: string[]) => void;
  onFiltersChange: (filters: FilterRow[]) => void;
  onSortRulesChange: (rules: SortRule[]) => void;
  onGroupRulesChange?: (rules: GroupRule[]) => void;
  onAggregationsChange?: (rules: AggregationRule[]) => void;
  onLookupColumnsChange?: (refs: LookupColumnRef[]) => void;
  onRollupColumnsChange?: (refs: RollupColumnRef[]) => void;
  onFormulasChange?: (refs: FormulaColumnRef[]) => void;
  onConditionalFormatsChange?: (rules: ConditionalFormatRule[]) => void;
  onDateFormatChange?: (dateFormat: string | undefined) => void;
  /**
   * The table's CURRENT drawing mode, carried into the saved view.
   *
   * The drawer does not edit it — the switcher in the toolbar does — but it has
   * to travel with a Save, or saving a view while looking at the grid would
   * quietly write `viewMode: undefined` and the view would open as a table
   * forever after. Every other view property this drawer does not edit
   * (`origin`, `publication`) is carried forward for the same reason.
   */
  viewMode?: TableViewMode;
  onSavePerspective: (perspective: PerspectiveConfig) => void;
  activePerspectiveId?: string | null;
  /** When set, the panel was opened to edit this saved perspective: its name and
   *  color pre-populate the save form so saving updates it in place (the save
   *  upserts by name). Null/undefined when creating a brand-new view. */
  editingPerspective?: PerspectiveConfig | null;
  /**
   * This user's existing personalization of the base ("Default view") tab, if
   * they have one. Passing it is what lets a second save UPDATE that row rather
   * than insert a duplicate.
   */
  baseViewPerspective?: PerspectiveConfig | null;
  /**
   * True when the drawer was opened to configure the BASE ("Default view") tab.
   * Explicit rather than inferred from "no active view": "Add view" opens from
   * the same state and must still demand a name.
   */
  isBaseViewMode?: boolean;
  loadFilterSuggestions?: LoadFilterSuggestions;
  /** When set, the panel shows a "Linked columns" section that lists the table's
   *  FK lookup sources so the user can attach read-only related-record columns. */
  loadLookupSources?: LoadLookupSources;
  /** When set, the panel shows a "Summarised columns" section listing the
   *  table's one-to-many rollup sources. */
  loadRollupSources?: LoadRollupSources;
  /** Section to auto-expand when opening (e.g., 'filters' from column menu "Filter by this field") */
  initialExpandedSection?: string | null;
}

const ConfigureViewPanel: React.FC<ConfigureViewPanelProps> = ({
  isOpen,
  onOpenChange,
  columns,
  visibleColumns,
  hiddenColumns,
  filters,
  sortRules,
  onColumnVisibilityChange,
  onFiltersChange,
  onSortRulesChange,
  groupRules = [],
  aggregations = [],
  lookupColumns = [],
  rollupColumns = [],
  formulas = [],
  conditionalFormats = [],
  sampleRow,
  dateFormat,
  dateFormatOptions = [],
  onGroupRulesChange,
  onAggregationsChange,
  onLookupColumnsChange,
  onRollupColumnsChange,
  onFormulasChange,
  onConditionalFormatsChange,
  onDateFormatChange,
  viewMode,
  onSavePerspective,
  activePerspectiveId,
  editingPerspective,
  baseViewPerspective,
  isBaseViewMode = false,
  loadFilterSuggestions,
  loadLookupSources,
  loadRollupSources,
  initialExpandedSection,
}) => {
  const t = useT();
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState('');
  const [saveColor, setSaveColor] = useState<FilterColor | null>(null);

  useEffect(() => {
    if (isOpen && initialExpandedSection) {
      setOpenSections(new Set([initialExpandedSection]));
    }
  }, [isOpen, initialExpandedSection]);

  // Pre-populate the save form when opening to edit an existing perspective;
  // reset to empty when opening to create a new view.
  useEffect(() => {
    if (isOpen) {
      setSaveName(editingPerspective?.name ?? '');
      setSaveColor(editingPerspective?.color ?? null);
    }
  }, [isOpen, editingPerspective]);

  /**
   * CANCEL MUST UNDO THE LIVE PREVIEW.
   *
   * Every control in this drawer edits the grid THROUGH the host: changing a
   * group rule calls `onGroupRulesChange` immediately so the user sees the
   * result behind the panel. That live preview is the point. What was missing
   * is the other half of the contract — Cancel only closed the drawer, so a
   * grouping the user explicitly cancelled stayed on screen (72 group-header
   * rows, in the recorded case). It was never persisted, so a reload cleared it;
   * the user was simply left staring at a change they had just rejected.
   *
   * So: snapshot every controlled value the moment the drawer opens, and on any
   * dismissal that is NOT a save, push the snapshot back through the same
   * handlers. Cancel, the X, Escape and an outside click are all dismissals and
   * all revert — that is the standard contract for a panel with an explicit
   * Save/Cancel pair, and having one of them silently keep the edits is exactly
   * the inconsistency being fixed.
   */
  type PanelSnapshot = {
    visibleColumns: string[];
    hiddenColumns: string[];
    filters: FilterRow[];
    sortRules: SortRule[];
    groupRules: GroupRule[];
    aggregations: AggregationRule[];
    lookupColumns: LookupColumnRef[];
    rollupColumns: RollupColumnRef[];
    formulas: FormulaColumnRef[];
    conditionalFormats: ConditionalFormatRule[];
    dateFormat: string | undefined;
  };

  const snapshotRef = useRef<PanelSnapshot | null>(null);
  const wasOpenRef = useRef(false);
  // Set by `handleSave` so the close it triggers keeps the edits instead of
  // rolling them back.
  const savingRef = useRef(false);

  // Deps are `[isOpen]` ONLY, on purpose: the effect must capture the props as
  // they were on the render that opened the drawer. Re-running it whenever a
  // prop changes would overwrite the snapshot with the edited value and make
  // Cancel a no-op again.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      snapshotRef.current = {
        visibleColumns,
        hiddenColumns,
        filters,
        sortRules,
        groupRules,
        aggregations,
        lookupColumns,
        rollupColumns,
        formulas,
        conditionalFormats,
        dateFormat,
      };
    }
    wasOpenRef.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const revertToSnapshot = useCallback(() => {
    const snap = snapshotRef.current;
    if (!snap) return;
    // Only fire a handler whose value actually moved. Calling all of them
    // unconditionally would push a fresh array identity into the host on every
    // cancel and re-run its effects (re-fetch, re-index) for nothing.
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

    if (!same(snap.visibleColumns, visibleColumns) || !same(snap.hiddenColumns, hiddenColumns)) {
      onColumnVisibilityChange(snap.visibleColumns, snap.hiddenColumns);
    }
    if (!same(snap.filters, filters)) onFiltersChange(snap.filters);
    if (!same(snap.sortRules, sortRules)) onSortRulesChange(snap.sortRules);
    if (onGroupRulesChange && !same(snap.groupRules, groupRules)) onGroupRulesChange(snap.groupRules);
    if (onAggregationsChange && !same(snap.aggregations, aggregations)) {
      onAggregationsChange(snap.aggregations);
    }
    if (onLookupColumnsChange && !same(snap.lookupColumns, lookupColumns)) {
      onLookupColumnsChange(snap.lookupColumns);
    }
    if (onRollupColumnsChange && !same(snap.rollupColumns, rollupColumns)) {
      onRollupColumnsChange(snap.rollupColumns);
    }
    if (onFormulasChange && !same(snap.formulas, formulas)) onFormulasChange(snap.formulas);
    if (onConditionalFormatsChange && !same(snap.conditionalFormats, conditionalFormats)) {
      onConditionalFormatsChange(snap.conditionalFormats);
    }
    if (onDateFormatChange && snap.dateFormat !== dateFormat) onDateFormatChange(snap.dateFormat);
  }, [
    visibleColumns, hiddenColumns, filters, sortRules, groupRules, aggregations,
    lookupColumns, rollupColumns, formulas, conditionalFormats, dateFormat,
    onColumnVisibilityChange, onFiltersChange, onSortRulesChange, onGroupRulesChange,
    onAggregationsChange, onLookupColumnsChange, onRollupColumnsChange, onFormulasChange,
    onConditionalFormatsChange, onDateFormatChange,
  ]);

  /** Single close path, so no dismissal can skip the rollback by accident. */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (savingRef.current) {
          savingRef.current = false;
        } else {
          revertToSnapshot();
        }
        snapshotRef.current = null;
      }
      onOpenChange(open);
    },
    [onOpenChange, revertToSnapshot],
  );

  const toggleSection = (section: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Only let users filter on columns that are actually visible in the view —
  // filtering on a hidden column is confusing (no column to see the effect on).
  // Keep any column already referenced by an existing filter row so that filter
  // stays editable even if its column was later hidden.
  const filterableColumns = useMemo(() => {
    const visible = new Set(visibleColumns);
    const referenced = new Set(filters.map((f) => f.field));
    return columns.filter((c) => visible.has(c.data) || referenced.has(c.data));
  }, [columns, visibleColumns, filters]);

  const hiddenCount = hiddenColumns.length;
  const visibleCount = visibleColumns.length;
  const filterCount = filters.length;
  const sortCount = sortRules.length;
  const groupCount = groupRules.length;
  // Count distinct linked sources (tables), not individual field columns.
  const linkedCount = new Set(lookupColumns.map((r) => r.source)).size;
  const rollupCount = rollupColumns.length;
  const formulaCount = formulas.length;
  const formattingCount = conditionalFormats.length;
  // A formula may reference native and linked columns, never another formula —
  // offering calculated columns in its own field picker invites cycles.
  const formulaSourceColumns = useMemo(
    () => columns.filter((c) => !isFormulaColumnKey(c.data)),
    [columns],
  );
  const activeDateFormatLabel = dateFormat
    ? dateFormatOptions.find((o) => o.value === dateFormat)?.label
    : undefined;

  /**
   * Section badge: the bare count.
   *
   * It used to read "{count} rules", which rendered "1 rules" — this i18n layer
   * has no plural forms, and every locale file carried the plural noun
   * (`{count} reguł`, `{count} Regeln`). It also made three sibling sections
   * disagree: Summarised columns and Calculated columns already badge a bare
   * number. One idiom, and no grammar to get wrong in four languages.
   */
  const rulesLabel = (count: number) => String(count);

  /**
   * True when the drawer is configuring the BASE ("Default view") tab rather
   * than a named saved view. The host says so explicitly; the state check is a
   * safety net so an "edit this view" open can never be mistaken for it.
   */
  const onBaseView =
    isBaseViewMode &&
    !editingPerspective &&
    (!activePerspectiveId || activePerspectiveId === baseViewPerspective?.id);

  /**
   * With no name typed while on the base tab, Save personalizes the DEFAULT
   * VIEW instead of refusing.
   *
   * Before this, `handleSave` was gated on `if (saveName.trim())` and always
   * minted a fresh id, so the base view had no save path at all — hiding a
   * column on the "Default view" tab survived exactly until the next reload,
   * and the only way to keep anything was to invent a name for it. That is half
   * of why workshop A5 read as data loss.
   */
  const savesBaseView = onBaseView && !saveName.trim();
  const canSave = savesBaseView || !!saveName.trim();

  const handleSave = () => {
    if (!canSave) return;
    const perspective: PerspectiveConfig = {
      // Preserve the id of the row being edited. Minting a new one every time
      // meant the host could only match the save back to a row BY NAME — so
      // renaming a view in this drawer cloned it instead of renaming it.
      id: savesBaseView
        ? baseViewPerspective?.id ?? generatePerspectiveId()
        : editingPerspective?.id ?? generatePerspectiveId(),
      name: savesBaseView ? BASE_VIEW_PERSPECTIVE_NAME : saveName.trim(),
      color: savesBaseView ? undefined : saveColor || undefined,
      columns: {
        visible: visibleColumns,
        hidden: hiddenColumns,
      },
      filters,
      sorting: sortRules,
      grouping: groupRules,
      aggregations,
      lookupColumns,
      rollupColumns,
      formulas,
      conditionalFormats,
      dateFormat,
      viewMode,
      // Carry the origin forward: a view copied from a shared template keeps
      // knowing which template and version it came from across every later edit.
      origin: savesBaseView ? undefined : editingPerspective?.origin,
      publication: savesBaseView ? undefined : editingPerspective?.publication,
      ...(savesBaseView ? { isBaseView: true } : {}),
    };
    savingRef.current = true;
    onSavePerspective(perspective);
    setSaveName('');
    setSaveColor(null);
    handleOpenChange(false);
  };

  const sectionIcon = (section: string) => {
    switch (section) {
      case 'fields': return <Eye className="w-4 h-4" />;
      case 'filters': return <Filter className="w-4 h-4" />;
      case 'sorting': return <ArrowUpDown className="w-4 h-4" />;
      case 'grouping': return <Layers className="w-4 h-4" />;
      case 'linked': return <Link2 className="w-4 h-4" />;
      case 'rollups': return <ListTree className="w-4 h-4" />;
      case 'formulas': return <Sigma className="w-4 h-4" />;
      case 'formatting': return <Palette className="w-4 h-4" />;
      case 'dateFormat': return <CalendarClock className="w-4 h-4" />;
      default: return null;
    }
  };

  const v2cls = 'hot-appearance-v2';

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        ariaTitle={t('dynamicTable.configureView.title', 'Configure View')}
        hideCloseButton={true}
        className={`hot-config-panel ${v2cls}`.trim()}
        overlayClassName="hot-config-overlay !backdrop-blur-none"
        /**
         * The grid itself is deliberately NOT "outside" this drawer: the drawer
         * is a live editor for the table behind it, so clicking a cell must not
         * tear it down.
         *
         * The drawer's OWN dropdowns need no exemption here even though they
         * render through `createPortal(…, document.body)`. Radix decides
         * "outside" from the REACT tree, not the DOM tree, and a portal's
         * content still belongs to the React subtree that rendered it — so a
         * click on a dropdown option is already inside. Verified in a browser
         * after the pointer-events fix below made those options clickable at
         * all: committing a group/filter/sort option leaves the drawer open,
         * while a click on the page outside it still dismisses it.
         */
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.hot-container')) {
            e.preventDefault();
          }
        }}
      >
        <div className="hot-config-panel-inner">
          {/* Header */}
          <div className="hot-config-panel-header">
            <div className="hot-config-panel-header-row">
              <h3 className="hot-config-panel-title">{t('dynamicTable.configureView.title', 'Configure View')}</h3>
              <IconButton
                size="sm"
                aria-label="Close"
                icon={<X className="w-4 h-4" />}
                onClick={() => handleOpenChange(false)}
              />
            </div>
            <p className="hot-config-panel-subtitle">
              {t('dynamicTable.configureView.subtitle', 'Customize the fields, filters and sorting of this view.')}
            </p>
          </div>

          {/* Sections */}
          <div className="hot-config-panel-body">
            {/* Fields Section */}
            <div className={`hot-config-section ${openSections.has('fields') ? 'is-open' : ''}`}>
              <button
                className="hot-config-section-header"
                onClick={() => toggleSection('fields')}
              >
                {sectionIcon('fields')}
                <span className="hot-config-section-title">{t('dynamicTable.configureView.hideFields', 'Hide fields')}</span>
                <span className="hot-config-section-badge">
                  {t('dynamicTable.configureView.fieldsVisible', '{visible} of {total} visible', {
                    visible: visibleCount,
                    total: visibleCount + hiddenCount,
                  })}
                </span>
                {openSections.has('fields') ? (
                  <ChevronUp className="w-4 h-4 hot-config-section-chevron" />
                ) : (
                  <ChevronDown className="w-4 h-4 hot-config-section-chevron" />
                )}
              </button>
              {openSections.has('fields') && (
                <ConfigureViewFields
                  columns={columns}
                  visibleColumns={visibleColumns}
                  hiddenColumns={hiddenColumns}
                  onColumnVisibilityChange={onColumnVisibilityChange}
                />
              )}
            </div>

            {/* Filter Section */}
            <div className={`hot-config-section ${openSections.has('filters') ? 'is-open' : ''}`}>
              <button
                className="hot-config-section-header"
                onClick={() => toggleSection('filters')}
              >
                {sectionIcon('filters')}
                <span className="hot-config-section-title">{t('dynamicTable.configureView.filter', 'Filter')}</span>
                {filterCount > 0 && (
                  <span className="hot-config-section-badge">
                    {rulesLabel(filterCount)}
                  </span>
                )}
                {openSections.has('filters') ? (
                  <ChevronUp className="w-4 h-4 hot-config-section-chevron" />
                ) : (
                  <ChevronDown className="w-4 h-4 hot-config-section-chevron" />
                )}
              </button>
              {openSections.has('filters') && (
                <ConfigureViewFilters
                  columns={filterableColumns}
                  filters={filters}
                  onFiltersChange={onFiltersChange}
                  loadFilterSuggestions={loadFilterSuggestions}
                />
              )}
            </div>

            {/* Sort Section */}
            <div className={`hot-config-section ${openSections.has('sorting') ? 'is-open' : ''}`}>
              <button
                className="hot-config-section-header"
                onClick={() => toggleSection('sorting')}
              >
                {sectionIcon('sorting')}
                <span className="hot-config-section-title">{t('dynamicTable.configureView.sort', 'Sort')}</span>
                {sortCount > 0 && (
                  <span className="hot-config-section-badge">
                    {rulesLabel(sortCount)}
                  </span>
                )}
                {openSections.has('sorting') ? (
                  <ChevronUp className="w-4 h-4 hot-config-section-chevron" />
                ) : (
                  <ChevronDown className="w-4 h-4 hot-config-section-chevron" />
                )}
              </button>
              {openSections.has('sorting') && (
                <ConfigureViewSorting
                  columns={columns}
                  sortRules={sortRules}
                  onSortRulesChange={onSortRulesChange}
                />
              )}
            </div>

            {/* Linked Columns Section — only when the host provides FK sources. */}
            {loadLookupSources && onLookupColumnsChange && (
              <div className={`hot-config-section ${openSections.has('linked') ? 'is-open' : ''}`}>
                <button
                  className="hot-config-section-header"
                  onClick={() => toggleSection('linked')}
                >
                  {sectionIcon('linked')}
                  <span className="hot-config-section-title">{t('dynamicTable.configureView.linkedSources', 'Linked sources')}</span>
                  {linkedCount > 0 && (
                    <span className="hot-config-section-badge">
                      {linkedCount}
                    </span>
                  )}
                  {openSections.has('linked') ? (
                    <ChevronUp className="w-4 h-4 hot-config-section-chevron" />
                  ) : (
                    <ChevronDown className="w-4 h-4 hot-config-section-chevron" />
                  )}
                </button>
                {openSections.has('linked') && (
                  <ConfigureViewLinkedColumns
                    lookupColumns={lookupColumns}
                    onLookupColumnsChange={onLookupColumnsChange}
                    loadLookupSources={loadLookupSources}
                    visibleColumns={visibleColumns}
                    hiddenColumns={hiddenColumns}
                    onColumnVisibilityChange={onColumnVisibilityChange}
                  />
                )}
              </div>
            )}

            {/* Summarised columns Section — the one-to-many sibling of
                "Linked sources": aggregates over the records that point AT
                each row. */}
            {loadRollupSources && onRollupColumnsChange && (
              <div className={`hot-config-section ${openSections.has('rollups') ? 'is-open' : ''}`}>
                <button
                  className="hot-config-section-header"
                  onClick={() => toggleSection('rollups')}
                >
                  {sectionIcon('rollups')}
                  <span className="hot-config-section-title">{t('dynamicTable.configureView.rollupColumns', 'Summarised columns')}</span>
                  {rollupCount > 0 && (
                    <span className="hot-config-section-badge">{rollupCount}</span>
                  )}
                  {openSections.has('rollups') ? (
                    <ChevronUp className="w-4 h-4 hot-config-section-chevron" />
                  ) : (
                    <ChevronDown className="w-4 h-4 hot-config-section-chevron" />
                  )}
                </button>
                {openSections.has('rollups') && (
                  <ConfigureViewRollups
                    rollupColumns={rollupColumns}
                    onRollupColumnsChange={onRollupColumnsChange}
                    loadRollupSources={loadRollupSources}
                    visibleColumns={visibleColumns}
                    hiddenColumns={hiddenColumns}
                    onColumnVisibilityChange={onColumnVisibilityChange}
                  />
                )}
              </div>
            )}

            {/* Calculated columns Section — follows the "linked" pattern:
                another kind of view-scoped virtual column. */}
            {onFormulasChange && (
              <div className={`hot-config-section ${openSections.has('formulas') ? 'is-open' : ''}`}>
                <button
                  className="hot-config-section-header"
                  onClick={() => toggleSection('formulas')}
                >
                  {sectionIcon('formulas')}
                  <span className="hot-config-section-title">{t('dynamicTable.configureView.formulas', 'Calculated columns')}</span>
                  {formulaCount > 0 && (
                    <span className="hot-config-section-badge">{formulaCount}</span>
                  )}
                  {openSections.has('formulas') ? (
                    <ChevronUp className="w-4 h-4 hot-config-section-chevron" />
                  ) : (
                    <ChevronDown className="w-4 h-4 hot-config-section-chevron" />
                  )}
                </button>
                {openSections.has('formulas') && (
                  <ConfigureViewFormulas
                    formulas={formulas}
                    onFormulasChange={onFormulasChange}
                    columns={formulaSourceColumns}
                    visibleColumns={visibleColumns}
                    hiddenColumns={hiddenColumns}
                    onColumnVisibilityChange={onColumnVisibilityChange}
                    sampleRow={sampleRow}
                  />
                )}
              </div>
            )}

            {/* Highlighting (conditional formatting) Section */}
            {onConditionalFormatsChange && (
              <div className={`hot-config-section ${openSections.has('formatting') ? 'is-open' : ''}`}>
                <button
                  className="hot-config-section-header"
                  onClick={() => toggleSection('formatting')}
                >
                  {sectionIcon('formatting')}
                  <span className="hot-config-section-title">{t('dynamicTable.conditionalFormat.title', 'Highlighting')}</span>
                  {formattingCount > 0 && (
                    <span className="hot-config-section-badge">{rulesLabel(formattingCount)}</span>
                  )}
                  {openSections.has('formatting') ? (
                    <ChevronUp className="w-4 h-4 hot-config-section-chevron" />
                  ) : (
                    <ChevronDown className="w-4 h-4 hot-config-section-chevron" />
                  )}
                </button>
                {openSections.has('formatting') && (
                  <ConfigureViewFormatting
                    columns={filterableColumns}
                    rules={conditionalFormats}
                    onRulesChange={onConditionalFormatsChange}
                  />
                )}
              </div>
            )}

            {/* Grouping Section */}
            {onGroupRulesChange && (
              <div className={`hot-config-section ${openSections.has('grouping') ? 'is-open' : ''}`}>
                <button
                  className="hot-config-section-header"
                  onClick={() => toggleSection('grouping')}
                >
                  {sectionIcon('grouping')}
                  <span className="hot-config-section-title">{t('dynamicTable.configureView.group', 'Group')}</span>
                  {groupCount > 0 && (
                    <span className="hot-config-section-badge">
                      {rulesLabel(groupCount)}
                    </span>
                  )}
                  {openSections.has('grouping') ? (
                    <ChevronUp className="w-4 h-4 hot-config-section-chevron" />
                  ) : (
                    <ChevronDown className="w-4 h-4 hot-config-section-chevron" />
                  )}
                </button>
                {openSections.has('grouping') && (
                  <ConfigureViewGrouping
                    columns={columns}
                    groupRules={groupRules}
                    onGroupRulesChange={onGroupRulesChange}
                    aggregations={aggregations}
                    onAggregationsChange={onAggregationsChange}
                  />
                )}
              </div>
            )}

            {/* Date-format Section — only when the host supplies presets. */}
            {onDateFormatChange && dateFormatOptions.length > 0 && (
              <div className={`hot-config-section ${openSections.has('dateFormat') ? 'is-open' : ''}`}>
                <button
                  className="hot-config-section-header"
                  onClick={() => toggleSection('dateFormat')}
                >
                  {sectionIcon('dateFormat')}
                  <span className="hot-config-section-title">{t('dynamicTable.configureView.dateFormat', 'Date format')}</span>
                  {activeDateFormatLabel && (
                    <span className="hot-config-section-badge">{activeDateFormatLabel}</span>
                  )}
                  {openSections.has('dateFormat') ? (
                    <ChevronUp className="w-4 h-4 hot-config-section-chevron" />
                  ) : (
                    <ChevronDown className="w-4 h-4 hot-config-section-chevron" />
                  )}
                </button>
                {openSections.has('dateFormat') && (
                  <div className="hot-config-section-body">
                    <SelectMenu
                      className="hot-config-filter-select w-full"
                      value={dateFormat ?? ''}
                      onChange={(next) => onDateFormatChange(next || undefined)}
                      options={dateFormatOptions}
                      emptyOptionLabel={t('dynamicTable.configureView.dateFormatDefault', 'Default')}
                      ariaLabel={t('dynamicTable.configureView.dateFormat', 'Date format')}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Save form: always visible (matches Figma). */}
          {(
            <div className="hot-config-panel-save">
              <label className="hot-config-save-label">{t('dynamicTable.configureView.viewName', 'View name')}</label>
              <Input
                inputSize="md"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                // The API caps the name at 120 characters and answers a longer
                // one with a bare 400 — so a long name used to close the drawer
                // as though it had saved and create nothing. Stopping at the
                // limit here is the honest version of the same rule, and the
                // hint below only appears once it actually bites.
                maxLength={PERSPECTIVE_NAME_MAX_LENGTH}
                placeholder={t('dynamicTable.configureView.viewNamePlaceholder', 'e.g. Active contractors')}
                // NO autoFocus. It was harmless when this panel was only a save
                // form; it is a data-corruption bug now that the panel is a
                // multi-section editor. Opening the drawer put the caret in the
                // NAME box, so the first thing typed into "Calculated columns"
                // — or any other section the user had not yet clicked into —
                // was appended to the view's name instead. Hit live: a saved
                // view came out named `Koszty teczekDlugosc notatkiLEN(notes)`,
                // silently, with the formula editor visibly on screen.
                className="w-full"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave) {
                    handleSave();
                  }
                }}
              />
              {saveName.length >= PERSPECTIVE_NAME_MAX_LENGTH && (
                <p className="hot-config-save-hint hot-config-save-hint-limit" role="status">
                  {t(
                    'dynamicTable.configureView.viewNameTooLong',
                    'A view name can be at most {max} characters.',
                    { max: String(PERSPECTIVE_NAME_MAX_LENGTH) },
                  )}
                </p>
              )}
              {onBaseView && (
                <p className="hot-config-save-hint">
                  {t(
                    'dynamicTable.configureView.baseViewHint',
                    'Leave the name empty to keep these settings on your Default view. They are yours alone — nobody else sees the change.',
                  )}
                </p>
              )}
              {/* A base-view save has no colour — the tab it personalizes is a
                  fixed part of the strip. The row is removed rather than
                  disabled: a dead control is a question the user has to answer. */}
              {!savesBaseView && (
                <>
                  <label className="hot-config-save-label">{t('dynamicTable.configureView.color', 'Color')}</label>
                  <div className="hot-config-save-colors">
                    {COLOR_PALETTE.map((item) => (
                      <button
                        key={item.color}
                        onClick={() => setSaveColor(item.color)}
                        className={`hot-config-save-color-btn hot-config-color-${item.color} ${saveColor === item.color ? 'selected' : ''}`}
                        title={item.color}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Footer buttons */}
          <div className="hot-config-panel-footer">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleOpenChange(false)}
            >
              {t('dynamicTable.configureView.cancel', 'Cancel')}
            </Button>
            {/* One button, and its label states exactly what will happen — the
                base view, an update in place, or a brand-new view. */}
            <Button
              variant="primary"
              className="flex-1"
              disabled={!canSave}
              onClick={handleSave}
            >
              {savesBaseView
                ? t('dynamicTable.configureView.saveBaseView', 'Save Default view')
                : editingPerspective
                  ? t('dynamicTable.configureView.saveView', 'Save view')
                  : t('dynamicTable.configureView.saveAsNewView', 'Save as new view')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ConfigureViewPanel;
