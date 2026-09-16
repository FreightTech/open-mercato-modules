'use client';

/**
 * The dry-run preview, rendered in a DynamicTable.
 *
 * Deliberately the same grid the user already reads their data in: an import
 * preview is a table of rows, and inventing a bespoke preview widget would
 * mean a second set of column, scroll and selection behaviours to learn.
 * `options.root` on `GridHarness` exists precisely so a nested grid like this
 * one can be driven independently of the page's main table.
 */
import React, { useMemo, useRef } from 'react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import DynamicTable from '../DynamicTable';
import type { ColumnDef, DynamicTableBadgeVariant } from '../types/index';
import type {
  ImportFieldDef,
  ImportMapping,
  ImportPreviewRow,
} from '../types/import';

export interface ImportPreviewGridProps {
  rows: ImportPreviewRow[];
  fields: ImportFieldDef[];
  /** The mapping actually applied — decides which field columns are shown. */
  mapping: ImportMapping;
  height?: number;
}

/** Internal row shape: the grid needs flat, string-keyed data. */
const ROW_NUMBER_KEY = '__sourceRowNumber';
const ACTION_KEY = '__action';
const ERRORS_KEY = '__errors';

const ACTION_BADGES: Record<string, DynamicTableBadgeVariant> = {
  created: 'success',
  updated: 'info',
  skipped: 'neutral',
  failed: 'error',
};

const ImportPreviewGrid: React.FC<ImportPreviewGridProps> = ({
  rows,
  fields,
  mapping,
  height = 360,
}) => {
  const t = useT();
  const tableRef = useRef<HTMLDivElement | null>(null);

  // Only the fields this file actually maps onto get a column. Showing all
  // forty importable fields for a three-column CSV buries the three that matter.
  const mappedFields = useMemo(() => {
    const targets = new Set(Object.values(mapping));
    return fields.filter((f) => targets.has(f.field));
  }, [fields, mapping]);

  const data = useMemo(
    () =>
      rows.map((row) => {
        const errorsByField = new Map(row.errors.map((e) => [e.field, e.message]));
        const flat: Record<string, unknown> = {
          id: String(row.sourceRowNumber),
          [ROW_NUMBER_KEY]: row.sourceRowNumber,
          [ACTION_KEY]: row.action,
          [ERRORS_KEY]: row.errors.map((e) => e.message).join('; '),
        };
        for (const field of mappedFields) {
          flat[field.field] = row.values[field.field] ?? '';
        }
        // Per-cell error lookup, consumed by `cellClassName` below.
        flat.__errorFields = errorsByField;
        return flat;
      }),
    [rows, mappedFields],
  );

  const columns = useMemo<ColumnDef[]>(() => {
    const cols: ColumnDef[] = [
      {
        data: ROW_NUMBER_KEY,
        title: t('dynamicTable.import.columnRow', 'Row'),
        type: 'numeric',
        width: 70,
        align: 'right',
        mono: true,
        readOnly: true,
      },
      {
        data: ACTION_KEY,
        title: t('dynamicTable.import.columnOutcome', 'Outcome'),
        type: 'text',
        width: 110,
        badge: true,
        badgeVariant: (value: unknown) => ACTION_BADGES[String(value)] ?? 'neutral',
        readOnly: true,
      },
    ];

    for (const field of mappedFields) {
      cols.push({
        data: field.field,
        title: field.label,
        type: field.type === 'numeric' ? 'numeric' : 'text',
        align: field.type === 'numeric' ? 'right' : 'left',
        mono: field.type === 'numeric' || field.type === 'date',
        readOnly: true,
        // A failing cell is marked where the failure is, not just on the row —
        // "row 43 is invalid" sends the user hunting across forty columns.
        cellClassName: (_value: unknown, rowData: any) =>
          (rowData?.__errorFields as Map<string, string> | undefined)?.has(field.field)
            ? 'bg-destructive/10'
            : undefined,
      });
    }

    cols.push({
      data: ERRORS_KEY,
      title: t('dynamicTable.import.columnProblem', 'Problem'),
      type: 'text',
      width: 280,
      readOnly: true,
    });

    return cols;
  }, [mappedFields, t]);

  return (
    <div data-testid="import-preview-grid">
      <DynamicTable
        tableRef={tableRef}
        data={data}
        // Rows are the in-memory import preview the caller already parsed —
        // there is no fetch here that could fail. HEDGE-123.
        loadError={false}
        columns={columns}
        colHeaders
        idColumnName="id"
        tableName={t('dynamicTable.import.previewTableName', 'Import preview')}
        height={height}
        emptyMessage={t('dynamicTable.import.previewEmpty', 'No rows to preview')}
        uiConfig={{
          hideToolbar: true,
          hidePerspectiveTabs: true,
          hidePagination: true,
          hideActionsColumn: true,
          hideAddRowButton: true,
          hideExportButton: true,
        }}
      />
    </div>
  );
};

export default ImportPreviewGrid;
