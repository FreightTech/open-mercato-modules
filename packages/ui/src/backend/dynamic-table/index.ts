// index.ts

export { default as DynamicTable } from './DynamicTable';
export { DynamicTableBadge } from './components/renderers';
export { default as TableSkeleton } from './components/TableSkeleton';
export { default as Debugger } from './components/Debugger';

// Perspective components
export { default as PerspectiveTabs } from './components/PerspectiveTabs';
export { default as PerspectiveTabMenu } from './components/PerspectiveTabMenu';
export type { PerspectiveTabMenuProps } from './components/PerspectiveTabMenu';
// Personal views + shared templates (personalization decision, 3 Aug 2026).
export { default as PerspectiveTemplateMenu } from './components/PerspectiveTemplateMenu';
export type { PerspectiveTemplateMenuProps } from './components/PerspectiveTemplateMenu';
export { default as PerspectivePublishDialog } from './components/PerspectivePublishDialog';
export type { PerspectivePublishDialogProps } from './components/PerspectivePublishDialog';

// Modern layout components
export { default as ColumnHeaderMenu } from './components/ColumnHeaderMenu';
export { default as ConfigureViewPanel } from './components/ConfigureViewPanel';
export { default as ConfigureViewFields } from './components/ConfigureViewFields';
export { default as ConfigureViewFilters } from './components/ConfigureViewFilters';
export { default as ConfigureViewSorting } from './components/ConfigureViewSorting';
export { default as ConfigureViewGrouping } from './components/ConfigureViewGrouping';
export { default as ConfigureViewRollups } from './components/ConfigureViewRollups';
export type { ConfigureViewRollupsProps } from './components/ConfigureViewRollups';
export { default as ConfigureViewFormatting } from './components/ConfigureViewFormatting';
export type { ConfigureViewFormattingProps } from './components/ConfigureViewFormatting';
export { default as ConfigureViewFormulas } from './components/ConfigureViewFormulas';
export type { ConfigureViewFormulasProps } from './components/ConfigureViewFormulas';
export { default as GroupHeaderRow } from './components/GroupHeaderRow';
export { default as FooterTotalsRow } from './components/FooterTotalsRow';
export type { FooterTotalsRowProps } from './components/FooterTotalsRow';

// The house dropdown + the filter value picker. Exported so a module building
// its own filter chrome composes these rather than reaching for a native
// `<select>`, which this product does not use anywhere.
export { SelectMenu } from './components/SelectMenu';
export type { SelectMenuProps, SelectMenuOption } from './components/SelectMenu';
export { FilterValueInput } from './components/FilterValueInput';
export type { FilterValueInputProps } from './components/FilterValueInput';
export { ColumnFilterPopover } from './components/ColumnFilterPopover';
export type { ColumnFilterPopoverProps, ColumnFilterOption } from './components/ColumnFilterPopover';
export { quickFilterId, isQuickFilterable } from './components/ColumnHeaders';
// The single filter-suggestion fetch contract (debounced, superseded, degrades
// to a usable free-text filter). Both value pickers consume it; a module
// building bespoke filter chrome should too, rather than re-implementing it.
export { useSuggestionFetch, useFieldSuggestionLoader, SUGGESTIONS_DEBOUNCE_MS } from './hooks/useSuggestionFetch';
export type { SuggestionFetchState } from './hooks/useSuggestionFetch';

// Conditional formatting ("Highlighting")
export {
  CONDITIONAL_FORMAT_OPERATORS,
  CONDITIONAL_FORMAT_STYLES,
  MAX_CONDITIONAL_FORMAT_RULES,
  compileConditionalFormats,
  conditionalFormatClassName,
  generateConditionalFormatRuleId,
  operatorNeedsCompareField,
  operatorNeedsValue,
  parseConditionalFormats,
} from './utils/conditionalFormat';
export type {
  CompiledConditionalFormats,
  ConditionalFormatOperator,
  ConditionalFormatRule,
  ConditionalFormatStyle,
} from './utils/conditionalFormat';

// Rollup ("summarised") columns — aggregates over the CHILD records that point
// at each row. The types (`RollupColumnRef`, `RollupFn`, `LoadRollupSources`, …)
// have exactly ONE export site, `./types/rollup`, which `./types/index` already
// re-exports through the `export * from './types/index'` below — so only the
// functions are named here.
export {
  buildRollupColumnDefs,
  isRollupColumnKey,
  parseRollupColumnKey,
  parseRollupColumns,
  rollupColumnDataKey,
  rollupColumnsToParam,
} from './utils/rollupColumns';
export type { BuildRollupColumnDefsOptions } from './utils/rollupColumns';

// Aggregate value formatting (group subtotals + the pinned footer)
export {
  AGGREGATE_EMPTY_PLACEHOLDER,
  coerceAggregateValue,
  formatAggregate,
} from './utils/formatAggregate';

// Calculated ("formula") columns. `FormulaColumnRef` and friends have exactly
// ONE export site — `./formula/index` — so `types/perspective.ts` imports the
// type without re-exporting it.
export * from './formula/index';
export {
  buildFormulaColumnDefs,
  formatFormulaValue,
  formulaColumnDataKey,
  formulaErrorToken,
  isFormulaColumnKey,
  parseFormulaColumns,
  slugifyFormulaLabel,
  uniqueFormulaColumnKey,
} from './utils/formulaColumns';
export type { BuildFormulaColumnDefsOptions } from './utils/formulaColumns';

// Multi-cell writes (paste / cut / clear / fill / replace / import) and the
// clipboard + fill-series primitives they are built from.
export { applyCellWrites, createCellWriter, isCellValueUnchanged } from './handlers/cellWrites';
export { coerceCellValue } from './utils/coerceCellValue';
export {
  padGrid,
  parseClipboardGrid,
  parseClipboardHtml,
  parseTsv,
  serialiseTsv,
} from './utils/clipboard';
export type { ClipboardGrid, ClipboardGridSource, ClipboardPayload } from './utils/clipboard';
export {
  detectFillPattern,
  generateFill,
  invertFillMode,
} from './utils/fillPatterns';
// Rectangle fill geometry — axis lock, back-drag and the per-line seed split,
// as pure functions so the rules a user notices are testable without a browser.
export {
  buildFillLines,
  cellsInRect,
  computeFillPreview,
  isCellInRect,
  rectSize,
} from './utils/fillGeometry';
export type { FillLine, FillPointer, ComputeFillPreviewOptions } from './utils/fillGeometry';

// In-grid Find & Replace. The projection is the SAME one export uses, so Find
// and Export can never disagree about what a relation column contains.

// File import (preview → commit → revert)
export { default as ImportPanel } from './components/ImportPanel';
export type { ImportPanelProps } from './components/ImportPanel';
export { default as ImportPreviewGrid } from './components/ImportPreviewGrid';
export * from './types/import';

// The list / grid view switcher, and the escape hatch it switches to.
//
// `DynamicTable` stays mounted in every mode — the switcher changes only the
// region between the toolbar and the footer — so an alternative renderer cannot
// own filters, sort, search, selection, grouping or pagination. That is the
// whole design: divergence is structurally impossible rather than discouraged.
// See `TableBodyRenderContext` for what a renderer is handed.
export { ViewModeSwitch } from './components/ViewModeSwitch';
export type { ViewModeSwitchProps } from './components/ViewModeSwitch';

// Grouping hook
export { useGrouping, EMPTY_GROUP_VALUE } from './hooks/useGrouping';
export type { UseGroupingResult } from './hooks/useGrouping';

// Active-perspective date/time format (published to cell renderers)
export { TableDateFormatContext, useTableDateFormat } from './hooks/useTableDateFormat';

// Cell comments
export { default as CellCommentDialog } from './components/CellCommentDialog';
export { useAnnotations, annotationKey } from './hooks/useAnnotations';
export type {
  CellAnnotationInfo,
  AnnotationMap,
  AnnotationTarget,
  AnnotationComment,
  CellCommentAudience,
} from './hooks/useAnnotations';

export { createCellStore } from './store/index';
export type { CellStore } from './store/index';
export {
  CellStoreContext,
  useCellStore,
  useCellState,
  useStoreRevision,
  useSelectionRevision,
  useSelection,
  useDragHandling,
  useKeyboardNavigation,
  useCopyHandler,
  useStickyOffsets,
  computeStickyOffsets,
  useFilterSuggestions,
  useRowActionShortcuts,
} from './hooks/index';
export type { UseFilterSuggestionsOptions, StickyOffsets } from './hooks/index';
// Grid-spine internals that column virtualization consumes. Both are pure and
// model-only by construction — see their module docs for why that matters.
export {
  badgeFitWidth,
  recordBadgeFit,
  planBadgeWidths,
  BADGE_FIT_MAX_WIDTH,
} from './utils/badgeAutoFit';
export type { BadgeWidthWrite } from './utils/badgeAutoFit';
export { computeColorAdjacency, NO_COLOR_ADJACENCY } from './utils/colorAdjacency';
export type { ColorAdjacency } from './utils/colorAdjacency';

// Column (horizontal) virtualization. The grid wires this itself behind
// `uiConfig.enableColumnVirtualization`; the exports exist for the perf harness
// and for range operations that need to ask "is column i mounted?" without
// touching the DOM.
export { useColumnVirtualizer } from './hooks/useColumnVirtualizer';
export type { UseColumnVirtualizerOptions, ColumnVirtualizer } from './hooks/useColumnVirtualizer';
export {
  DEFAULT_COLUMN_OVERSCAN,
  buildColumnWindow,
  computeColumnGeometry,
  computeScrollLeftToReveal,
  createFullColumnWindow,
  getPinnedColumnIndices,
  columnIndexToVisualIndex,
  visualIndexToColumnIndex,
  isColumnMounted,
} from './utils/columnWindow';
export type {
  ColumnWindow,
  ColumnRenderSegment,
  VirtualColumn,
  ColumnGeometry,
} from './utils/columnWindow';
export { columnSpacerStyle, columnSpacerKey } from './utils/columnSpacerStyle';

export * from './types/index';
// Grouping types. Exported because `defaultGrouping` put `GroupRule` on the
// public prop surface — a host that declares its opening grouping needs to be
// able to name the type it is declaring.
export type {
  GroupRule,
  AggregationRule,
  AggregationFn,
  AggregateResult,
  VisualRow,
} from './types/grouping';
export { generateGroupRuleId, AGGREGATION_FNS, isAggregationFn } from './types/grouping';
// Density scale (user-settable row/type density). Exported from its own module
// rather than folded into ./types/index so the density feature owns one file.
export {
  DENSITY_LEVELS,
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_METRICS,
  isDensityLevel,
  resolveDensityAttribute,
  resolveDensityRowHeight,
} from './types/density';
export type { DensityLevel, DensityMetrics } from './types/density';

// Density preference — PER USER, global across every grid, persisted in
// localStorage. See the header of useDensityPreference.ts for why it is not on
// the perspective API (workshop A3: a shared setting changed for everyone, and
// that was received as a bug).
export {
  DENSITY_STORAGE_PREFIX,
  DENSITY_SCOPE_CACHE_KEY,
  useDensityPreference,
  getDensityPreference,
  getServerDensityPreference,
  setDensityPreference,
  subscribeDensityPreference,
  ensureDensityScope,
  resetDensityPreferenceStore,
} from './hooks/useDensityPreference';
export type { UseDensityPreferenceResult } from './hooks/useDensityPreference';

// The user-facing picker. Uncontrolled by default — drop it in the toolbar and
// it reads/writes the preference itself.
export { DensityControl } from './components/DensityControl';
export type { DensityControlProps } from './components/DensityControl';

// Compact date rendering (workshop A8 — format + the planned/estimated/actual
// model — and B14 — ISO week numbers). The formatter is memoised per config;
// hoist it rather than building one per cell.
export { default as DateCell, DateCell as DynamicTableDateCell } from './components/DateCell';
export type { DateCellProps } from './components/DateCell';
export {
  formatDateCompact,
  formatTimestampLevels,
  getCompactDateFormatter,
  parseTimestamp,
  isoWeek,
  isoWeekYear,
  isoWeekday,
  daysFromCivil,
  yearFromDays,
  LEVEL_GLYPHS,
  TIMESTAMP_LEVELS,
} from './utils/formatDateCompact';
export type {
  CompactDate,
  CompactDateConfig,
  CompactDateFormatter,
  CompactTimestamp,
  DateInput,
  TimestampLevel,
  TimestampParts,
} from './utils/formatDateCompact';

export * from './validators';
export { dispatch, useMediator, useListener, useEventHandlers } from './events/events';

// Perspective handlers
export {
  createPerspectiveHandlers,
  resolvePerspectiveState,
} from './handlers/perspectiveHandlers';
export type {
  PerspectiveState,
  PerspectiveHandlersDeps,
  ResolvePerspectiveStateInput,
} from './handlers/perspectiveHandlers';

// Entity search editor for connected entities
export {
  EntitySearchEditor,
  createEntitySearchEditor,
} from './components/EntitySearchEditor';
export type {
  EntitySearchEditorConfig,
  SearchResult as EntitySearchResult,
  DynamicTableEditorFn,
} from './components/EntitySearchEditor';

// DateTime editor for inline datetime editing with calendar + clock
export {
  createDateTimeEditor,
} from './components/editors';

// Multi-select entity search editor (new, follows DateEditor pattern)
export {
  MultiSelectEntitySearchEditor,
  createMultiSelectEntitySearchEditor,
} from './components/editors';
export type {
  EntitySearchEditorConfig as MultiSelectEntitySearchEditorConfig,
  SelectedItem as MultiSelectEntitySelectedItem,
  SelectedItem as MultiSelectSelectedItem,
} from './components/editors';

// DynamicTable page hook (frontend factory)
export { useDynamicTablePage } from './hooks/useDynamicTablePage';
export type {
  DynamicTablePageConfig,
  DynamicTablePageResult,
  DynamicTablePageDeleteConfig,
  DynamicTablePageCellEditConfig,
  DynamicTablePageCreateConfig,
  DynamicTableCreateHandlerContext,
  DynamicTablePageHooks,
} from './hooks/useDynamicTablePage';

// Perspective transforms
export {
  apiToDynamicTable,
  apiTemplateToDynamicTable,
  dynamicTableToApi,
  parsePerspectiveOrigin,
  parsePerspectivePublication,
  templateVersionOf,
} from './utils/perspectiveTransforms';

// Delete dialog
export { default as TableDeleteDialog } from './components/TableDeleteDialog';
export type { TableDeleteDialogProps } from './components/TableDeleteDialog';

// Compact label rendering (workshop A9: assignee → initials, port → terminal
// code, contractor → short name, plus general text fitting).
//
// The abbreviation dictionary is CENTRAL by construction — registered once at
// app boot from the `facilities` / `contractors` tables, never declared per
// table. See utils/abbreviations.ts for why the database, not this code, is the
// source of truth.
export {
  ABBREV_CONTRACTOR,
  ABBREV_FACILITY,
  abbreviate,
  abbreviationsVersion,
  contractorToAbbreviation,
  facilityToAbbreviation,
  getAbbreviationSnapshot,
  // Exported so a picker outside the grid can apply the SAME "is this an
  // abbreviation or an internal id?" rule instead of inventing a second one —
  // the offers carrier picker is the first such caller.
  looksLikeHumanCode,
  lookupAbbreviation,
  normalizeAbbreviationKey,
  registerAbbreviationSeed,
  registerAbbreviations,
  resetAbbreviations,
  subscribeAbbreviations,
  BALTIC_TERMINAL_SEED,
} from './utils/abbreviations';
// Turns the registry's change notifications into a React subscription. Without
// it a grid that mounted before the boot fetch resolved keeps showing the long
// names until something else happens to re-render it.
export { useAbbreviationsVersion } from './hooks/useAbbreviations';
export type { AbbreviationEntry, AbbreviationNamespace } from './utils/abbreviations';

export {
  ELLIPSIS,
  buildInitialsIndex,
  detectFitMode,
  fitText,
  formatAssignee,
  formatContractor,
  formatFacility,
  formatFromDictionary,
  formatInitials,
  formatLabelCompact,
  nameTokens,
  toDisplayString,
  truncateMiddle,
  truncateTail,
} from './utils/formatLabelCompact';
export type { CompactLabel, CompactLabelSpec, FitMode } from './utils/formatLabelCompact';

export {
  CompactLabelCell,
  createCompactLabelRenderer,
  createContractorRenderer,
  createDictionaryRenderer,
  createFacilityRenderer,
  createFittedTextRenderer,
  createInitialsRenderer,
  renderCompactLabel,
} from './components/CompactLabelCell';
export type {
  CompactCellRenderer,
  CompactLabelCellProps,
  CompactLabelTypography,
} from './components/CompactLabelCell';

// ── Module table registry ──
// Lets a module declare the tables it owns so a table has an identity beyond
// "the body of one page.tsx". Spec: .ai/specs/2026-08-04-module-table-registry.md
export {
  lazyTable,
  filterAccessibleTables,
  findTableDefinition,
  TableRegistryProvider,
  useTableRegistry,
  useAccessibleTables,
  useTableById,
} from './registry/index';
export type {
  TableDefinition,
  TableDefinitionMetadata,
  TableHostContext,
  TableLoader,
  TableRegistryValue,
} from './registry/index';

// ── Content registry ──
// Wraps the table registry and adds the dashboard-widget catalogue, so one
// resolver, one ACL path and one picker cover both kinds of pane content.
// `ContentRegistryBootstrap` mounts once in the backend layout.
export {
  ContentRegistryProvider,
  ContentRegistryBootstrap,
  useContentRegistry,
  useAccessibleContent,
  useContentById,
  useWidgetRenderContext,
  useWidgetCatalog,
  widgetLoaderKeyExists,
} from './registry/index';
export type {
  ContentRegistryValue,
  ContentStatus,
  PaneContentItem,
  TableContentItem,
  WidgetContentItem,
  WidgetCatalog,
  WidgetCatalogEntry,
} from './registry/index';

// ── Split view ──
// A composable workspace: a tree of slots, each holding a registered table or
// nothing yet. Specs: .ai/specs/2026-08-04-dynamic-table-split-view.md,
// .ai/specs/2026-08-17-split-view-workspace-composition.md
export { SplitViewHost, EmptySlot, GRID_TEMPLATES, GRID_TEMPLATE_LIST } from './split-view/index';
export type {
  SplitViewHostProps,
  SplitLayout,
  LayoutNode,
  PaneNode,
  EmptyNode,
  SplitNode,
  SplitDirection,
  PaneContentRef,
  GridTemplate,
  GridTemplateId,
} from './split-view/index';
