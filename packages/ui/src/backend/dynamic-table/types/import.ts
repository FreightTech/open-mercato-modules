/**
 * Wire types for the reversible file-import pipeline (Spec 3, Phases 1-3).
 *
 * This module is deliberately **dependency-free** — no `xlsx`, no React, no
 * server APIs — so both the browser panel (`components/ImportPanel.tsx`) and
 * the server parser (`utils/importParse.ts`) can share one vocabulary without
 * the client ever pulling the spreadsheet reader into its bundle.
 *
 * The parse itself is SERVER-SIDE ONLY. A client+server double parse is
 * exactly how a preview and its commit drift apart, so the browser never sees
 * a workbook — it uploads bytes and renders whatever the server made of them.
 */

/** Hard caps enforced BEFORE parsing (see spec A6 / "Memory blow-up" risk). */
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** v1 import modes. `upsert_key` is per-module opt-in and not offered here. */
export type ImportMode = 'create' | 'upsert_id';

/** What a preview decided to do with one source row. */
export type ImportRowAction = 'created' | 'updated' | 'skipped' | 'failed';

/**
 * One importable target field, declared by the adopting module.
 *
 * `labels` carries EVERY header spelling that should auto-map onto this field:
 * the export's own column title (per locale), the field key, and any legacy
 * spelling. Round-tripping an export must need zero manual mapping, and the
 * export header is locale-dependent, so a single label is not enough.
 */
export interface ImportFieldDef {
  /** Target field key on the module's create/update input. */
  field: string;
  /** Primary human label, shown in the mapping UI. */
  label: string;
  /** Additional accepted header spellings (locales, snake_case, aliases). */
  labels?: string[];
  type?: 'text' | 'numeric' | 'date' | 'boolean';
  /** Required for a `create`; a blank value fails the row. */
  required?: boolean;
  /**
   * True when the field points at another record. Relation fields are REFUSED
   * on the generic path rather than silently mis-resolved (spec A1): a header
   * mapping onto one produces `relation_unsupported`, never a lookup guess.
   */
  relation?: boolean;
  /** Marks the field used to match an existing record in `upsert_id` mode. */
  matchKey?: boolean;
}

/** File header → target field key. Headers absent from the map are ignored. */
export type ImportMapping = Record<string, string>;

export type ImportMappingIssueCode =
  | 'relation_unsupported'
  | 'unknown_field'
  | 'duplicate_field'
  | 'missing_required';

export interface ImportMappingIssue {
  code: ImportMappingIssueCode;
  /** The file header at fault, when the issue is header-shaped. */
  header?: string;
  /** The target field at fault, when the issue is field-shaped. */
  field?: string;
  /** Human label for whichever of the two the message should name. */
  label: string;
}

/** A per-cell validation failure on a previewed row. */
export interface ImportCellError {
  field: string;
  message: string;
}

/** One row of the dry-run preview. Nothing here has been written. */
export interface ImportPreviewRow {
  /** 1-based data row in the uploaded file (header row excluded). */
  sourceRowNumber: number;
  action: ImportRowAction;
  /** Mapped + coerced values, keyed by target field. */
  values: Record<string, unknown>;
  /** Existing record this row would update (`upsert_id` only). */
  recordId: string | null;
  errors: ImportCellError[];
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

/** `POST …/import/preview` response. */
export interface ImportPreviewResponse {
  importBatchId: string;
  mode: ImportMode;
  sourceFileName: string;
  /** The mapping actually applied — echoed so the panel can show + edit it. */
  mapping: ImportMapping;
  /** Headers found in the file, in file order. */
  headers: string[];
  /** Target fields the module accepts, for the mapping UI. */
  fields: ImportFieldDef[];
  mappingIssues: ImportMappingIssue[];
  rows: ImportPreviewRow[];
  summary: ImportSummary;
}

/** `POST …/import/:id/commit` response. */
export interface ImportCommitResponse {
  importBatchId: string;
  created: number;
  updated: number;
  failed: number;
  rows: Array<{
    sourceRowNumber: number;
    action: ImportRowAction;
    recordId: string | null;
    errorMessage: string | null;
  }>;
}

/** `POST …/import/:id/revert` response. */
export interface ImportRevertResponse {
  importBatchId: string;
  restored: number;
  deleted: number;
  refused: Array<{ sourceRowNumber: number; reason: string }>;
}
