/**
 * Headers → fields. Pure, dependency-free, shared by the server (which builds
 * the default mapping) and the panel (which lets a user override it).
 *
 * The default mapping is what makes **export → edit → re-import** work with
 * zero configuration: `utils/exportTable.ts` writes `col.title ?? col.data` as
 * the header, so a field whose `labels` include that title round-trips without
 * the user touching the mapping UI.
 */
import type {
  ImportFieldDef,
  ImportMapping,
  ImportMappingIssue,
} from '../types/import';
import type { ColumnDef } from '../types/index';

/**
 * Fold a header down to a comparison key: lowercase, diacritics stripped,
 * punctuation and whitespace collapsed. "Numer faktury", "numer_faktury" and
 * "Numer Faktury " all land on `numerfaktury`, which is the tolerance a user
 * pasting a colleague's spreadsheet actually needs.
 */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    // Combining marks — ł has no decomposition, so it is handled below.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Every accepted spelling of a field, normalized. */
function fieldKeys(field: ImportFieldDef): string[] {
  const raw = [field.field, field.label, ...(field.labels ?? [])];
  const keys = new Set<string>();
  for (const value of raw) {
    const key = normalizeHeader(value);
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * Auto-map file headers onto target fields by normalized label.
 *
 * First match wins per field: a file with both "Net amount" and "netAmount"
 * maps the first and leaves the second unmapped rather than silently letting
 * the later column overwrite the earlier one.
 */
export function buildDefaultMapping(
  headers: string[],
  fields: ImportFieldDef[],
): ImportMapping {
  const index = new Map<string, string>();
  for (const field of fields) {
    for (const key of fieldKeys(field)) {
      if (!index.has(key)) index.set(key, field.field);
    }
  }

  const mapping: ImportMapping = {};
  const claimed = new Set<string>();
  for (const header of headers) {
    const target = index.get(normalizeHeader(header));
    if (!target || claimed.has(target)) continue;
    mapping[header] = target;
    claimed.add(target);
  }
  return mapping;
}

/**
 * Check a mapping against the file's headers and the module's fields.
 *
 * Relation fields are reported as `relation_unsupported` rather than resolved:
 * the generic path cannot know whether "Maersk" is contractor `a1b2…` and a
 * wrong guess writes the wrong record (spec A1).
 */
export function validateMapping(
  mapping: ImportMapping,
  headers: string[],
  fields: ImportFieldDef[],
  options: { requireRequired?: boolean } = {},
): ImportMappingIssue[] {
  const byField = new Map(fields.map((f) => [f.field, f]));
  const headerSet = new Set(headers);
  const issues: ImportMappingIssue[] = [];
  const usedFields = new Map<string, number>();

  for (const [header, target] of Object.entries(mapping)) {
    if (!headerSet.has(header)) continue;
    const field = byField.get(target);
    if (!field) {
      issues.push({ code: 'unknown_field', header, field: target, label: header });
      continue;
    }
    if (field.relation) {
      issues.push({
        code: 'relation_unsupported',
        header,
        field: field.field,
        label: header,
      });
      continue;
    }
    usedFields.set(target, (usedFields.get(target) ?? 0) + 1);
  }

  for (const [target, count] of usedFields) {
    if (count > 1) {
      const field = byField.get(target);
      issues.push({
        code: 'duplicate_field',
        field: target,
        label: field?.label ?? target,
      });
    }
  }

  if (options.requireRequired !== false) {
    for (const field of fields) {
      if (!field.required || field.relation) continue;
      if (!usedFields.has(field.field)) {
        issues.push({ code: 'missing_required', field: field.field, label: field.label });
      }
    }
  }

  return issues;
}

/**
 * Drop mappings that `validateMapping` rejected, so a preview can still run on
 * the columns that ARE sound. A relation column being refused must not take the
 * other forty columns down with it.
 */
export function pruneMapping(
  mapping: ImportMapping,
  issues: ImportMappingIssue[],
): ImportMapping {
  const badHeaders = new Set(
    issues.filter((i) => i.header && i.code !== 'missing_required').map((i) => i.header as string),
  );
  const pruned: ImportMapping = {};
  for (const [header, target] of Object.entries(mapping)) {
    if (badHeaders.has(header)) continue;
    pruned[header] = target;
  }
  return pruned;
}

/**
 * Apply a mapping to one parsed row. Unmapped headers are dropped; an empty
 * cell yields `null` so "the user cleared this" is distinguishable from "the
 * column was not in the file at all" (absent key).
 */
export function applyMapping(
  values: Record<string, string>,
  mapping: ImportMapping,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [header, target] of Object.entries(mapping)) {
    if (!(header in values)) continue;
    const raw = values[header];
    out[target] = raw === '' ? null : raw;
  }
  return out;
}

/**
 * Derive importable field defs from a table's own `ColumnDef`s.
 *
 * This is the generic path's default: whatever the grid shows and exports is
 * what it can read back. Columns that carry an `exportValue` hook are treated
 * as relation-shaped — a column whose stored cell value needs a projection to
 * become text cannot be reversed by parsing that text back (spec A1).
 */
export function fieldsFromColumns(
  columns: ColumnDef[],
  options: { idColumn?: string } = {},
): ImportFieldDef[] {
  const idColumn = options.idColumn ?? 'id';
  const fields: ImportFieldDef[] = [];
  for (const col of columns) {
    const label = col.title ?? col.data;
    const type: ImportFieldDef['type'] =
      col.type === 'numeric' ? 'numeric'
      : col.type === 'date' ? 'date'
      : col.type === 'boolean' ? 'boolean'
      : 'text';
    fields.push({
      field: col.data,
      label,
      labels: label === col.data ? undefined : [col.data],
      type,
      relation: Boolean(col.exportValue),
      matchKey: col.data === idColumn,
    });
  }
  return fields;
}
