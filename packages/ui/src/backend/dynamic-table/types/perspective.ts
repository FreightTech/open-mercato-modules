// types/perspective.ts

import { FilterRow, FilterColor } from './index';
import type { GroupRule, AggregationRule } from './grouping';
import type { ConditionalFormatRule } from '../utils/conditionalFormat';
// TYPE-ONLY IMPORT, deliberately NOT re-exported. `FormulaColumnRef` has exactly
// one export site — `formula/index.ts`, which the package barrel re-exports.
// Re-exporting it here too would give the barrel two `export *` sources for the
// same name; ES semantics then drops the name silently and consumers lose it.
import type { FormulaColumnRef } from '../formula/types';
// Same rule as `FormulaColumnRef`: ONE export site (`./rollup`, which
// `types/index.ts` re-exports). Imported type-only, never re-exported here.
import type { RollupColumnRef } from './rollup';

// ============================================
// PERSPECTIVE DATA STRUCTURES
// ============================================

export interface SortRule {
  id: string;
  field: string;
  direction: 'asc' | 'desc';
}

export interface ColumnConfig {
  /** Column data keys in display order (visible columns) */
  visible: string[];
  /** Hidden column data keys */
  hidden: string[];
}

/**
 * A read-only linked (lookup) column attached to a perspective. It surfaces
 * `field` of the record reached through the host table's foreign-key relationship
 * `source` (a code-declared lookup source). The grid renders it as a read-only
 * column keyed `lookup__<source>__<field>`, and the server enriches each row with
 * that value. View-scoped: different perspectives can show different linked columns.
 */
export interface LookupColumnRef {
  /** Registered lookup source key (a foreign-key relationship), e.g. `'contractor'`. */
  source: string;
  /** Whitelisted target field key surfaced by this column, e.g. `'tax_id'`. */
  field: string;
  /** Column header, captured when the column is added (defaulted from the field's
   *  translated label, user-editable in the Configure View drawer). */
  label: string;
}

/**
 * Where a copied view came from.
 *
 * The personalization decision (3 Aug 2026) accepts that a copy of a shared
 * template DRIFTS from the template — that is the point of copying rather than
 * subscribing. What it does NOT accept is drifting *invisibly*: a user must be
 * able to be told later "the shared template changed — update yours?".
 *
 * `version` is the template's `updatedAt` (falling back to `createdAt`) at the
 * moment of the copy. A plain ISO string rather than an integer on purpose:
 * the upstream `role_perspectives` row has no version column, and inventing one
 * would mean a migration on an entity this distribution does not own. Comparing
 * the stored stamp with the template's current stamp answers "has it changed?"
 * exactly, and needs no schema at all.
 */
export interface PerspectiveOrigin {
  /** Id of the shared template row this view was copied from. */
  templateId: string;
  /** The template's `updatedAt ?? createdAt` at copy time. */
  version: string;
  /** The template's name at copy time, so drift can be described without a refetch. */
  name: string;
  /** When the copy was taken. */
  copiedAt: string;
}

/**
 * Set on a PERSONAL view that its owner has published as a shared template.
 * Purely informational for the UI ("Update shared template" instead of
 * "Publish…"); the authoritative copy lives in the role-scoped template rows.
 */
export interface PerspectivePublication {
  /** Roles the view is currently published to. */
  roleIds: string[];
  /** ISO stamp of the last publish. */
  publishedAt: string;
}

/**
 * How a view draws its rows.
 *
 * A property of the VIEW, not of the session — the Notion borrow, and the
 * load-bearing one. Google Drive's list/grid toggle is global and remembers one
 * preference; making the mode belong to the view is what lets "Due for payment"
 * and "By counterparty" disagree about how they want to be drawn.
 *
 * Rides `settings.filters._viewMode` — see `parseViewMode`. Unknown values
 * degrade to `'table'`; they never throw.
 */
export type TableViewMode = 'table' | 'grid';

export const TABLE_VIEW_MODES: readonly TableViewMode[] = ['table', 'grid'] as const;

export function isTableViewMode(value: unknown): value is TableViewMode {
  return typeof value === 'string' && (TABLE_VIEW_MODES as readonly string[]).includes(value);
}

export interface PerspectiveConfig {
  id: string;
  name: string;
  color?: FilterColor;
  columns: ColumnConfig;
  filters: FilterRow[];
  sorting: SortRule[];
  grouping?: GroupRule[];
  /** Per-group numeric aggregations (e.g. SUM of a cost column). */
  aggregations?: AggregationRule[];
  /** Read-only linked (lookup) columns surfaced from FK-related records. */
  lookupColumns?: LookupColumnRef[];
  /**
   * Read-only aggregate ("summarised") columns over linked CHILD records —
   * the one-to-many direction. Rides the `filters._rollups` passthrough on the
   * wire, for the same reason `_lookups` does.
   */
  rollupColumns?: RollupColumnRef[];
  /** View-scoped calculated ("formula") columns. Display-only; not persisted per row. */
  formulas?: FormulaColumnRef[];
  /**
   * View-scoped conditional formatting ("Highlighting") rules. Rides the
   * `filters._conditionalFormats` passthrough on the wire — see
   * `utils/perspectiveTransforms.ts` for why a top-level key would vanish.
   */
  conditionalFormats?: ConditionalFormatRule[];
  /**
   * Columns frozen (sticky-left) in this view, in the order they were pinned.
   *
   * Declared by the upstream fork and marked "Not persisted by default" for as
   * long as nothing read or wrote it — freezing a column changed a `useState`
   * Set and reached neither the server nor the browser, so it was gone on the
   * next reload (HEDGE-102).
   *
   * Rides `filters._frozenColumns` on the wire, like every other view-scoped
   * extra here. A top-level key would look right and be dropped in transit:
   * the upstream settings schema is a bare `z.object` and Zod strips what it
   * does not name. See `utils/perspectiveTransforms.ts`.
   */
  frozenColumns?: string[];
  /**
   * View-scoped date/time display format. An opaque token owned by the host
   * (e.g. a preset key its renderers understand); the table stores and
   * round-trips it but never interprets it. Undefined = no explicit choice, so
   * renderers keep their own default.
   */
  dateFormat?: string;
  /**
   * This user's default view — the one that opens when the page is entered
   * fresh. PER-USER by contract (workshop A4): `isDefault` is a first-class
   * column on the upstream `Perspective` entity, scoped to `userId`, so
   * setting it never changes what anyone else sees.
   */
  isDefault?: boolean;
  /**
   * This user's saved personalization of the BASE ("Default view") tab.
   *
   * Before this existed there was no save path for the base view at all —
   * `ConfigureViewPanel` refused to save without a name and always minted a new
   * id — so hiding a column on the default tab survived exactly until the next
   * reload. That is the other half of workshop A5 ("my changes disappeared").
   *
   * It is an ordinary personal perspective row, so it is per-user by the same
   * construction as every other view; it is simply not rendered as its own tab,
   * because the tab it personalizes is already on screen.
   */
  isBaseView?: boolean;
  /**
   * Columns this view has never expressed an opinion about — present in the
   * table's config, absent from everything this view stored about columns.
   *
   * Distinct from `columns.hidden`, which is derived and therefore cannot tell
   * "the user hid this" from "this column did not exist when the view was
   * saved". Populated by `apiToDynamicTable`, which is the last place the raw
   * `columnOrder` / `columnVisibility` maps are still available.
   */
  unseenColumns?: string[];
  /** Set when this view was copied from a shared template. See `PerspectiveOrigin`. */
  origin?: PerspectiveOrigin;
  /** Set when this view has been published as a shared template. */
  publication?: PerspectivePublication;
  /**
   * How this view draws its rows. Rides `settings.filters._viewMode` for the
   * same reason `_aggregations` does — the upstream settings schema strips
   * unknown TOP-LEVEL keys, so a `viewMode` field alongside `columnOrder` would
   * be silently dropped on the way to the database and the view would forget
   * its own shape on the very first reload.
   *
   * Undefined = never chosen, which renders as `'table'`. Absence and an
   * explicit `'table'` are deliberately NOT distinguished: there is nothing a
   * user could do differently if they were.
   */
  viewMode?: TableViewMode;
}

/**
 * A view someone published for other people to COPY.
 *
 * Persisted as an upstream role-scoped perspective (`role_perspectives`), which
 * already carries `organization_id` + `tenant_id`, is already returned by
 * `GET /api/perspectives/:tableId` for the caller's own roles, and is already
 * guarded by real ACL features (`perspectives.use` to read,
 * `perspectives.role_defaults` to write). No new entity, endpoint or migration.
 *
 * A template is NEVER applied to anyone automatically — it is a thing you copy,
 * and the copy is yours. That is what makes "no shared thing a user can silently
 * mutate" true: publishing is explicit, and it changes nobody's active view.
 */
export interface PerspectiveTemplate extends PerspectiveConfig {
  /** Role this template is published to. */
  roleId: string;
  /** Human-readable role name, when the server could resolve one. */
  roleName?: string | null;
  /** `updatedAt ?? createdAt` — the version stamp a copy records. */
  version: string;
}

/** The reserved name of the personal base-view row. Never shown in the UI. */
export const BASE_VIEW_PERSPECTIVE_NAME = '__base__';

/**
 * Longest name the perspectives API will accept.
 *
 * Mirrors `z.string().min(1).max(120)` in the upstream perspectives validator
 * (`@open-mercato/core/modules/perspectives/data/validators`). The server
 * answers a longer name with a 400 that carries no field-level detail, so the
 * UI used to close the drawer as if the view had been created and simply not
 * create one. Enforced on the INPUT instead: the field stops accepting
 * characters at the limit and says why, which is a thing the user can act on.
 *
 * If upstream ever raises the limit this constant is the only place to change —
 * over-reporting here is safe (a shorter name always saves), under-reporting is
 * not.
 */
export const PERSPECTIVE_NAME_MAX_LENGTH = 120;

// ============================================
// PERSPECTIVE EVENT TYPES
// ============================================

export interface PerspectiveSaveEvent {
  perspective: PerspectiveConfig;
  /**
   * Suppresses the host's success toast. Set for saves the USER did not ask for
   * explicitly — today that is the column order written back after a header
   * drag. The write still happens and a FAILURE is still reported; only the
   * "Perspective saved" confirmation is dropped, because one toast per dragged
   * column is noise, not feedback. Never set it for a Save the user clicked.
   */
  silent?: boolean;
}

export interface PerspectiveSelectEvent {
  id: string | null;
  config: PerspectiveConfig | null;
}

export interface PerspectiveRenameEvent {
  id: string;
  newName: string;
}

export interface PerspectiveDeleteEvent {
  id: string;
  hardDelete?: boolean;
}

export interface PerspectiveChangeEvent {
  /** Partial config - only changed fields */
  config: Partial<Omit<PerspectiveConfig, 'id' | 'name'>>;
}

/**
 * Copy an existing view under a new name (workshop A6 — "duplicate" is the
 * safe alternative to editing a view you rely on). The source's whole config
 * travels with the event so the host does not have to re-read it.
 */
export interface PerspectiveDuplicateEvent {
  sourceId: string;
  newName: string;
  perspective: PerspectiveConfig;
}

/**
 * Make this view the user's own default (workshop A4). PER-USER: the upstream
 * service demotes the caller's other views in one `nativeUpdate` and never
 * touches another user's rows.
 */
export interface PerspectiveSetDefaultEvent {
  id: string;
  isDefault: boolean;
}

/**
 * Publish one of MY views so colleagues can copy it. Explicit by design: a view
 * is private until its owner takes this action, and even then nobody's screen
 * changes until they copy it.
 */
export interface PerspectivePublishEvent {
  /** The personal view being published. */
  id: string;
  /** Roles that should see the template. */
  roleIds: string[];
  /** Template name (defaults to the view's own name, editable before publishing). */
  name: string;
}

/** Copy a shared template into my own space. The copy is mine; the template is untouched. */
export interface PerspectiveTemplateCopyEvent {
  template: PerspectiveTemplate;
  /** De-duplicated name for the copy. */
  newName: string;
}

// ============================================
// TABLE EVENTS EXTENSION
// ============================================

export const PerspectiveEvents = {
  PERSPECTIVE_SAVE: 'table:perspective:save',
  PERSPECTIVE_SELECT: 'table:perspective:select',
  PERSPECTIVE_RENAME: 'table:perspective:rename',
  PERSPECTIVE_DELETE: 'table:perspective:delete',
  PERSPECTIVE_CHANGE: 'table:perspective:change',
  PERSPECTIVE_DUPLICATE: 'table:perspective:duplicate',
  PERSPECTIVE_SET_DEFAULT: 'table:perspective:setDefault',
  PERSPECTIVE_PUBLISH: 'table:perspective:publish',
  PERSPECTIVE_TEMPLATE_COPY: 'table:perspective:templateCopy',
} as const;

// Type mapping for perspective event payloads
export type PerspectiveEventPayloads = {
  [PerspectiveEvents.PERSPECTIVE_SAVE]: PerspectiveSaveEvent;
  [PerspectiveEvents.PERSPECTIVE_SELECT]: PerspectiveSelectEvent;
  [PerspectiveEvents.PERSPECTIVE_RENAME]: PerspectiveRenameEvent;
  [PerspectiveEvents.PERSPECTIVE_DELETE]: PerspectiveDeleteEvent;
  [PerspectiveEvents.PERSPECTIVE_CHANGE]: PerspectiveChangeEvent;
  [PerspectiveEvents.PERSPECTIVE_DUPLICATE]: PerspectiveDuplicateEvent;
  [PerspectiveEvents.PERSPECTIVE_SET_DEFAULT]: PerspectiveSetDefaultEvent;
  [PerspectiveEvents.PERSPECTIVE_PUBLISH]: PerspectivePublishEvent;
  [PerspectiveEvents.PERSPECTIVE_TEMPLATE_COPY]: PerspectiveTemplateCopyEvent;
};

// Type for perspective event handler map
export type PerspectiveEventHandlers = {
  [K in keyof PerspectiveEventPayloads]?: (payload: PerspectiveEventPayloads[K]) => void;
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Creates a default perspective config from column definitions
 */
export function createDefaultPerspective(
  columns: { data: string }[],
  hiddenColumns: string[] = []
): Omit<PerspectiveConfig, 'id' | 'name'> {
  const allColumnKeys = columns.map(col => col.data);
  const visible = allColumnKeys.filter(key => !hiddenColumns.includes(key));
  const hidden = hiddenColumns.filter(key => allColumnKeys.includes(key));

  return {
    columns: { visible, hidden },
    filters: [],
    sorting: [],
    grouping: [],
    aggregations: [],
    lookupColumns: [],
    rollupColumns: [],
    formulas: [],
    conditionalFormats: [],
  };
}

/**
 * Merges a partial perspective config with defaults
 */
export function mergePerspectiveConfig(
  base: Omit<PerspectiveConfig, 'id' | 'name'>,
  partial: Partial<Omit<PerspectiveConfig, 'id' | 'name'>>
): Omit<PerspectiveConfig, 'id' | 'name'> {
  return {
    columns: partial.columns ?? base.columns,
    filters: partial.filters ?? base.filters,
    sorting: partial.sorting ?? base.sorting,
    grouping: partial.grouping ?? base.grouping,
    aggregations: partial.aggregations ?? base.aggregations,
    lookupColumns: partial.lookupColumns ?? base.lookupColumns,
    rollupColumns: partial.rollupColumns ?? base.rollupColumns,
    formulas: partial.formulas ?? base.formulas,
    conditionalFormats: partial.conditionalFormats ?? base.conditionalFormats,
    dateFormat: partial.dateFormat ?? base.dateFormat,
    viewMode: partial.viewMode ?? base.viewMode,
  };
}

/**
 * Generates a unique ID for new perspective items
 */
export function generatePerspectiveId(): string {
  return `perspective-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generates a unique ID for sort rules
 */
export function generateSortRuleId(): string {
  return `sort-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sort direction labels keyed to the column's data type. The default A→Z labels
 * read as text-only and led users to think date columns weren't actually being
 * sorted chronologically.
 */
export type ColumnDataType = 'text' | 'numeric' | 'date' | 'dropdown' | 'boolean' | 'multiselect';

export function getSortDirectionLabels(type?: ColumnDataType): { asc: string; desc: string } {
  switch (type) {
    case 'date':
      return { asc: 'Old → New', desc: 'New → Old' };
    case 'numeric':
      return { asc: '1 → 9', desc: '9 → 1' };
    case 'boolean':
      return { asc: 'False → True', desc: 'True → False' };
    default:
      return { asc: 'A → Z', desc: 'Z → A' };
  }
}
