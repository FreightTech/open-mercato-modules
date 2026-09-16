import type { ColumnDef } from '../types/index';
import type { CellStore } from '../store/index';

export type ExportFormat = 'csv' | 'xlsx';

export interface ExtractedTable {
  /** Column header labels, in view order. */
  headers: string[];
  /** Body rows; each is an array of cell strings aligned to `headers`. */
  rows: string[][];
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Pull the visible columns for the chosen rows out of the cell store — the same
 * extraction the Copy button uses (`store.getCellValue` over `cols` in view
 * order, which projects `rowData[col.data]`, the one value source the grid also
 * renders from). When `selectedRowIds` is non-empty, only those rows are
 * exported; otherwise every loaded (current-page) row is included.
 *
 * Columns may declare `exportValue(value, row)` to override the stringified raw
 * cell value (e.g. relation columns that store JSON in the cell).
 */
export function extractExportRows(
  store: CellStore,
  cols: ColumnDef[],
  selectedRowIds: Set<string>,
  selectionColumnName: string,
): ExtractedTable {
  const headers = cols.map((c) => c.title ?? c.data);
  const rows: string[][] = [];
  const rowCount = store.getRowCount();
  const exportSelectionOnly = selectedRowIds.size > 0;

  for (let r = 0; r < rowCount; r++) {
    const rowData = store.getRowData(r);
    if (!rowData) continue;
    if (exportSelectionOnly) {
      const id = String(rowData[selectionColumnName] ?? '');
      if (!id || !selectedRowIds.has(id)) continue;
    }
    rows.push(
      cols.map((col, c) => {
        const raw = store.getCellValue(r, c);
        if (col.exportValue) return cellToString(col.exportValue(raw, rowData));
        return cellToString(raw);
      }),
    );
  }

  return { headers, rows };
}

/**
 * Build an export table directly from plain row objects (not the cell store).
 * Used for the whole-table export, where rows are re-fetched from the server
 * across all pages and every column is included regardless of perspective
 * visibility. Reads `row[col.data]`, applying `col.exportValue` when present.
 */
export function extractExportRowsFromData(
  data: any[],
  cols: ColumnDef[],
): ExtractedTable {
  const headers = cols.map((c) => c.title ?? c.data);
  const rows = data.map((row) =>
    cols.map((col) => {
      const raw = row?.[col.data];
      if (col.exportValue) return cellToString(col.exportValue(raw, row));
      // Objects/arrays have no useful default string form — leave blank rather
      // than emit "[object Object]". Columns that store them must use exportValue.
      if (raw !== null && typeof raw === 'object') return '';
      return cellToString(raw);
    }),
  );
  return { headers, rows };
}

function escapeCsvField(field: string): string {
  // RFC 4180: quote fields containing comma, quote, CR or LF; double interior quotes.
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Serialize an extracted table to a CSV string. Prepends a UTF-8 BOM so Excel
 * opens it with the correct encoding (Polish characters survive).
 */
export function toCsv({ headers, rows }: ExtractedTable): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(','));
  return '﻿' + lines.join('\r\n');
}

/**
 * Serialize an extracted table to an .xlsx Blob via SheetJS. The `xlsx`
 * dependency is imported lazily by the caller and passed in, so CSV-only paths
 * never load it.
 */
export function toXlsxBlob(
  table: ExtractedTable,
  XLSX: typeof import('xlsx'),
): Blob {
  const aoa = [table.headers, ...table.rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Export');
  const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Slugify a table/file name into a safe file-name stem. */
export function slugifyFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'export';
}

/** Trigger a browser download of `blob` as `filename` (no-op when no document). */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
