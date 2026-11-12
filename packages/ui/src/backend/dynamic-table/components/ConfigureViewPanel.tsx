import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
} from '@freighttech/ui/primitives/sheet';
import { ChevronDown, ChevronUp, Eye, Filter, ArrowUpDown, Layers, Link2, CalendarClock, ListTree, Palette, RotateCcw, Search, Sigma, X } from 'lucide-react';
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
import { ColumnCatalog, ColumnSlots } from './ConfigureViewColumns';
import type { PerspectiveState } from '../handlers/perspectiveHandlers';
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
import { useT } from '@open-mercato/shared/lib/i18n/context';

/*
 * FMS UX 03.11 — footer and chip buttons follow the app's look (view-grid's
 * GridEditor buttons, visual-language §4–§6): one near-black pill CTA, the rest
 * ghost; named typography tokens, never `text-sm font-semibold`.
 */
const btnBase =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-body-medium-sm ' +
  'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3ft-outline';
const btnPrimary = `${btnBase} bg-m3ft-primary text-m3ft-on-primary enabled:hover:opacity-90`;
const btnGhost = `${btnBase} text-m3ft-on-surface enabled:hover:bg-[var(--m3-state-layer-hover)]`;
const btnTonal = `${btnBase} bg-m3ft-surface-container-high text-m3ft-on-surface enabled:hover:bg-m3ft-surface-container`;
/** Starter-set chip: borderless, filled, pill (badges/chips carry no border — owner 03.11). */
const chipCls =
  'inline-flex h-8 max-w-full items-center rounded-full bg-[var(--m3-surface-container-high)] px-3 text-label-medium-md text-[var(--m3-on-surface)] ' +
  'hover:[background-image:linear-gradient(var(--m3-state-layer-hover),var(--m3-state-layer-hover))] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3ft-outline';

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

/** Sections shown as always-open wizard steps rather than accordions. */
const STEP_SECTIONS = new Set(['fields', 'filters', 'sorting', 'grouping']);

/**
 * FMS UX 03.11 — a plain section heading (visual-language §7: `text-body-medium-sm`,
 * sentence case). The drawer is not a stepper (§6): the labels carry no "1 · " numbering.
 */
function StepLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="m-0 text-body-medium-sm text-[var(--m3-on-surface)]">{children}</h4>;
}

/**
 * FMS UX 04.11 — a section that starts folded (Columns, Starter sets): its header carries the title and a one-line
 * summary, so the drawer opens on what is used most (filters, sorting, grouping) instead of a wall of open lists.
 */
function Fold({ id, title, summary, open, onToggle, children }: {
  id: string; title: React.ReactNode; summary?: React.ReactNode; open: boolean; onToggle: (id: string) => void; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="-mx-2 flex h-9 items-center gap-2 rounded-[var(--m3-shape-sm)] px-2 text-left hover:bg-[var(--m3-state-layer-hover)]"
        data-wizard-fold={id}
      >
        <StepLabel>{title}</StepLabel>
        {summary ? <span className="text-body-regular-xs text-[var(--m3-on-surface-variant)]">{summary}</span> : null}
        <ChevronDown className={`ml-auto size-4 shrink-0 text-[var(--m3-on-surface-variant)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? children : null}
    </div>
  );
}

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
  /** The rows the grid has loaded — Highlighting offers their values when the server has none. */
  loadedRows?: Record<string, unknown>[];
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
  /**
   * "Zestawy startowe" — complete view states the user can start from (the
   * table's default, their saved views, templates shared with their role).
   * Picking one loads it into the drawer as a live preview; nothing is saved
   * until Save. The FIRST entry is the table's default and also backs
   * "Restore default".
   */
  starterSets?: Array<{ id: string; name: string; state: PerspectiveState }>;
  /** The tab being configured, shown under the title ("Default view", a saved view's name). */
  viewLabel?: string;
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
  loadedRows,
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
  starterSets = [],
  viewLabel,
}) => {
  const t = useT();
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState('');
  // Folded sections (FMS UX 04.11) and the one column search.
  const [folds, setFolds] = useState<Set<string>>(new Set());
  const toggleFold = (id: string) => setFolds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [columnQuery, setColumnQuery] = useState('');
  const [saveColor, setSaveColor] = useState<FilterColor | null>(null);

  useEffect(() => {
    if (!isOpen || !initialExpandedSection) return;
    // The wizard's steps (columns, filters, sorting, grouping) are always open:
    // bring the asked-for one into view. The rest are "More" accordions.
    if (STEP_SECTIONS.has(initialExpandedSection)) {
      const id = window.setTimeout(() => {
        document
          .querySelector(`[data-wizard-step="${initialExpandedSection}"]`)
          ?.scrollIntoView({ block: 'start' });
      }, 50);
      return () => window.clearTimeout(id);
    }
    setOpenSections(new Set([initialExpandedSection]));
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

  /**
   * Load a starter set into the drawer. Same handlers as every control here, so
   * it is a live preview and Cancel rolls it back from the snapshot.
   */
  const applyStarterSet = (state: PerspectiveState) => {
    onColumnVisibilityChange(state.visibleColumns, state.hiddenColumns);
    onFiltersChange(state.filters);
    onSortRulesChange(state.sortRules);
    onGroupRulesChange?.(state.groupRules);
    onAggregationsChange?.(state.aggregations);
    onLookupColumnsChange?.(state.lookupColumns);
    onRollupColumnsChange?.(state.rollupColumns);
    onFormulasChange?.(state.formulas);
    onConditionalFormatsChange?.(state.conditionalFormats);
    onDateFormatChange?.(state.dateFormat);
  };
  const defaultSet = starterSets[0];

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
  const hasAdvanced =
    (loadLookupSources && onLookupColumnsChange) ||
    (loadRollupSources && onRollupColumnsChange) ||
    onFormulasChange ||
    onConditionalFormatsChange ||
    (onDateFormatChange && dateFormatOptions.length > 0);

  /*
   * "Dostosuj widok" — a wide, two-column wizard, the DynamicTable's sibling of
   * the kartoteka / teczka "Dostosuj widok" (contractors `CustomizeSheet`,
   * owner 2026-10-09: "the dynamic table should have a very similar wizard to
   * set the view"):
   *
   *   left   Kolumny            the columns on the view, in order (drag, ×)
   *          Filtry · Sortowanie · Grupowanie
   *   right  Zestawy startowe       the default, saved views, role templates
   *          Katalog kolumn         every hidden column, + to add
   *          Więcej                 linked / summarised / calculated columns,
   *                                 highlighting, date format (accordions)
   *
   * Everything edits the grid live behind the drawer; Cancel rolls back to the
   * snapshot taken on open; Save writes the view.
   */
  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        ariaTitle={t('dynamicTable.configureView.title', 'Customize view')}
        hideCloseButton={true}
        className={`hot-config-panel hot-config-panel--wizard ${v2cls}`.trim()}
        style={{ maxWidth: 980, width: '100%' }}
        overlayClassName="hot-config-overlay !backdrop-blur-none"
        // Opening must not park focus on ✕ — it drew its focus ring as if the user had tabbed to it (owner 04.11).
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-testid="dynamic-table-customize-view"
        // The grid behind is a live preview, not "outside" — see the note this
        // replaced in git history: clicking a cell must not close the drawer.
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.hot-container')) {
            e.preventDefault();
          }
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave) {
            e.preventDefault();
            handleSave();
          }
        }}
      >
        <div className="hot-config-panel-inner">
          <div className="hot-config-panel-header">
            <div className="hot-config-panel-header-row">
              <div className="min-w-0">
                <h3 className="hot-config-panel-title">{t('dynamicTable.configureView.title', 'Customize view')}</h3>
                {/* FMS UX 03.11 — the header carries context only (which view),
                    not a second descriptive line (visual-language §3/§6). */}
                {viewLabel ? <p className="hot-config-panel-subtitle">{viewLabel}</p> : null}
              </div>
              {/* FMS UX 03.11 — 36px round ghost icon button; ring on keyboard focus only. */}
              <button
                type="button"
                className="hot-config-panel-close"
                aria-label={t('dynamicTable.configureView.cancel', 'Cancel')}
                onClick={() => handleOpenChange(false)}
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
          </div>

          {/* FMS UX 04.11 — ONE column in task order (name & colour → starter sets → columns → catalogue → filters → sorting →
              grouping → more). The two-column grid left half the drawer empty and split one job across two reading
              paths. The section wrappers are `contents` so `order-*` places each section. */}
          {/* FMS UX 05.11 — two panes: the view's rules on the left; the COLUMNS as their own pane on the right, always
              open, with their own search and scroll (owner: folded, 17 of 51 columns "disappeared"). */}
          <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
            {/* Name and colour first — what this view is, before what it shows (FMS UX 04.11). */}
          <div className="hot-config-panel-save order-7 mt-auto">
            <div className="flex w-full max-w-[420px] flex-col gap-1">
              <label className="hot-config-save-label">{t('dynamicTable.configureView.viewName', 'View name')}</label>
              {/* FMS UX 03.11 — the app's field (filled, radius 10, no outline;
                  styled by `.hot-config-save-input`), not the bordered primitive. */}
              <input
                type="text"
                aria-label={t('dynamicTable.configureView.viewName', 'View name')}
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
                className="hot-config-save-input w-full"
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
            </div>
              {/* A base-view save has no colour — the tab it personalizes is a
                  fixed part of the strip. The row is removed rather than
                  disabled: a dead control is a question the user has to answer. */}
              {!savesBaseView && (
                <div className="flex flex-col gap-1">
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
                </div>
              )}
          </div>
            {/* ── The view itself ── */}
            <div className="contents">

              <section className="order-1 flex flex-col gap-2" data-wizard-step="filters">
                <StepLabel>{t('dynamicTable.configureView.step.filters', 'Filters')}</StepLabel>
                <ConfigureViewFilters
                  columns={filterableColumns}
                  filters={filters}
                  onFiltersChange={onFiltersChange}
                  loadFilterSuggestions={loadFilterSuggestions}
                />
              </section>

              <section className="order-2 flex flex-col gap-2" data-wizard-step="sorting">
                <StepLabel>{t('dynamicTable.configureView.step.sorting', 'Sorting')}</StepLabel>
                <ConfigureViewSorting
                  columns={columns}
                  sortRules={sortRules}
                  onSortRulesChange={onSortRulesChange}
                />
              </section>

              {onGroupRulesChange && (
                <section className="order-3 flex flex-col gap-2" data-wizard-step="grouping">
                  <StepLabel>{t('dynamicTable.configureView.step.grouping', 'Grouping')}</StepLabel>
                  <ConfigureViewGrouping
                    columns={columns}
                    groupRules={groupRules}
                    onGroupRulesChange={onGroupRulesChange}
                    aggregations={aggregations}
                    onAggregationsChange={onAggregationsChange}
                  />
                </section>
              )}
            </div>

            {/* ── Where to start from, and what to add ── */}
            <div className="contents">
              {starterSets.length > 0 && (
                <section className="order-5 flex flex-col gap-2" data-wizard-step="starter-sets">
                  <Fold
                    id="starter"
                    open={folds.has('starter')}
                    onToggle={toggleFold}
                    title={t('dynamicTable.configureView.step.starterSets', 'Starter sets')}
                    summary={String(starterSets.length)}
                  >
                  <div className="flex flex-wrap gap-1.5">
                    {starterSets.map((set) => (
                      <button
                        key={set.id}
                        type="button"
                        className={chipCls}
                        onClick={() => applyStarterSet(set.state)}
                        title={set.state.visibleColumns
                          .map((key) => columns.find((c) => c.data === key)?.title || key)
                          .join(' · ')}
                        data-wizard-starter-set={set.id}
                      >
                        <span className="truncate">{set.name}</span>
                      </button>
                    ))}
                  </div>
                  </Fold>
                </section>
              )}



              {hasAdvanced && (
                <section className="order-6 flex flex-col gap-2" data-wizard-step="more">
                  <StepLabel>{t('dynamicTable.configureView.step.more', 'More')}</StepLabel>
                  {/* FMS UX 03.11 — the accordions below are one filled surface
                      (radius 16) with quiet rows and dividers, not outlined boxes. */}
                  <div className="hot-config-more-list">
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
                          loadFilterSuggestions={loadFilterSuggestions}
                          loadedRows={loadedRows}
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
                </section>
              )}
            </div>
          </div>

          <aside className="flex min-h-0 w-[340px] shrink-0 flex-col border-l border-[var(--m3-outline-variant)]" data-wizard-step="fields">
            <div className="flex flex-col gap-3 px-5 pb-3 pt-5">
              <div className="flex items-center gap-2">
                <StepLabel>{t('dynamicTable.configureView.step.columns', 'Columns')}</StepLabel>
                <span className="ml-auto text-body-regular-xs text-[var(--m3-on-surface-variant)]">
                  {t('dynamicTable.configureView.fieldsVisible', '{visible} of {total} visible', {
                    visible: visibleCount,
                    total: visibleCount + hiddenCount,
                  })}
                </span>
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--m3-on-surface-variant)]" aria-hidden />
                <input
                  value={columnQuery}
                  onChange={(e) => setColumnQuery(e.target.value)}
                  placeholder={t('dynamicTable.configureView.catalogSearch', 'Search columns')}
                  className="h-9 w-full pl-9 pr-3 text-body-regular-sm"
                  data-wizard-column-search=""
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              <div className="-mx-1.5">
                <ColumnSlots
                  columns={columns}
                  visibleColumns={visibleColumns}
                  hiddenColumns={hiddenColumns}
                  onColumnVisibilityChange={onColumnVisibilityChange}
                  query={columnQuery}
                />
              </div>
              {hiddenColumns.length > 0 ? (
                <>
                  <p className="m-0 mb-1 mt-3 text-body-regular-xs text-[var(--m3-on-surface-variant)]">
                    {t('dynamicTable.configureView.hiddenColumns', 'Hidden columns — click to add')}
                  </p>
                  <ColumnCatalog
                    columns={columns}
                    visibleColumns={visibleColumns}
                    hiddenColumns={hiddenColumns}
                    onColumnVisibilityChange={onColumnVisibilityChange}
                    query={columnQuery}
                  />
                </>
              ) : null}
            </div>
          </aside>
          </div>

          <div className="hot-config-panel-footer">
            {/* FMS UX 03.11 — Restore as a ghost text button on the left, Cancel
                tonal, and ONE near-black primary CTA on the right. */}
            {defaultSet && (
              <button
                type="button"
                className={btnGhost}
                onClick={() => applyStarterSet(defaultSet.state)}
                data-testid="dynamic-table-customize-reset"
              >
                <RotateCcw className="w-4 h-4" aria-hidden />
                {t('dynamicTable.configureView.restoreDefault', 'Restore default')}
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              className={btnTonal}
              onClick={() => handleOpenChange(false)}
            >
              {t('dynamicTable.configureView.cancel', 'Cancel')}
            </button>
            {/* One button, and its label states exactly what will happen — the
                base view, an update in place, or a brand-new view. */}
            <button
              type="button"
              className={btnPrimary}
              disabled={!canSave}
              onClick={handleSave}
            >
              {savesBaseView
                ? t('dynamicTable.configureView.saveBaseView', 'Save Default view')
                : editingPerspective
                  ? t('dynamicTable.configureView.saveView', 'Save view')
                  : t('dynamicTable.configureView.saveAsNewView', 'Save as new view')}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ConfigureViewPanel;
