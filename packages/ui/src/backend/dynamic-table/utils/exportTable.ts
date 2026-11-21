import type { ColumnDef } from '../types/index';
import type { CellStore } from '../store/index';

export type ExportFormat = 'csv' | 'xlsx';

/** A cell as a spreadsheet gets it: a number stays a number, everything else is its text. */
export type ExportCell = string | number;

export interface ExtractedTable {
  /** Column header labels, in view order. */
  headers: string[];
  /** Body rows; each is an array of cell strings aligned to `headers` (what CSV writes). */
  rows: string[][];
  /**
   * The same cells for an .xlsx file, a number kept a number (GEPARD-343: "kwoty mają kropki zamiast przecinków …
   * formuła Suma nie działa" — "4556.52" written as text is not a number to a Polish Excel; a number cell is, and it
   * prints with the reader's own decimal comma). Absent on a table built by hand: `rows` is written as it is.
   */
  values?: ExportCell[][];
  /** Per column, the Excel number format of its number cells (`'#,##0.00'`), from the column's `numericFormat`. */
  numberFormats?: Array<string | undefined>;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** A plain decimal as JavaScript writes it ("4556.52", "-588.8") — what a numeric column's string holds. */
const PLAIN_DECIMAL = /^\s*-?\d+(?:\.\d+)?\s*$/;

/**
 * The cell for a spreadsheet: in a `numeric` column (amounts, rollups, number formulas) a finite number is a number,
 * and so is a plain-decimal string (an API amount kept as text). Anything else is its text, as CSV writes it — a
 * formatted "1 234,56 PLN", and every value of a text column, a number too: an identifier held as a number
 * ("7564321098") would otherwise show in Excel as "7,56E+09" (CHECK omm #55, N1).
 */
function exportCell(col: ColumnDef, value: unknown, text: string): ExportCell {
  if (col.type !== 'numeric') return text;
  if (typeof value === 'number') return Number.isFinite(value) ? value : text;
  if (typeof value === 'string' && PLAIN_DECIMAL.test(value)) return Number(value);
  return text;
}

/**
 * The Excel number format a `numeric` column's cells are written with, so the file shows what the grid shows
 * ("155,20", not "155,2"): fixed decimals from `numericFormat.minimumFractionDigits`, grouping unless it is off.
 * None (Excel's General) when the column has no fixed decimals or is not a plain decimal (percent, currency).
 */
export function xlsxNumberFormat(col: ColumnDef): string | undefined {
  if (col.type !== 'numeric') return undefined;
  const nf = col.numericFormat;
  if (!nf || (nf.style !== undefined && nf.style !== 'decimal')) return undefined;
  const min = Math.min(nf.minimumFractionDigits ?? 0, 20);
  if (min <= 0) return undefined;
  const max = Math.min(Math.max(nf.maximumFractionDigits ?? min, min), 20);
  const whole = nf.useGrouping === false ? '0' : '#,##0';
  return `${whole}.${'0'.repeat(min)}${'#'.repeat(max - min)}`;
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
  const values: ExportCell[][] = [];
  const rowCount = store.getRowCount();
  const exportSelectionOnly = selectedRowIds.size > 0;

  for (let r = 0; r < rowCount; r++) {
    const rowData = store.getRowData(r);
    if (!rowData) continue;
    if (exportSelectionOnly) {
      const id = String(rowData[selectionColumnName] ?? '');
      if (!id || !selectedRowIds.has(id)) continue;
    }
    const cells = cols.map((col, c) => {
      const raw = store.getCellValue(r, c);
      const value = col.exportValue ? col.exportValue(raw, rowData) : raw;
      const text = cellToString(value);
      return { text, cell: exportCell(col, value, text) };
    });
    rows.push(cells.map((x) => x.text));
    values.push(cells.map((x) => x.cell));
  }

  return { headers, rows, values, numberFormats: cols.map(xlsxNumberFormat) };
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
  const extracted = data.map((row) =>
    cols.map((col) => {
      const raw = row?.[col.data];
      const value = col.exportValue ? col.exportValue(raw, row) : raw;
      // Objects/arrays have no useful default string form — leave blank rather
      // than emit "[object Object]". Columns that store them must use exportValue.
      const text = !col.exportValue && raw !== null && typeof raw === 'object' ? '' : cellToString(value);
      return { text, cell: exportCell(col, value, text) };
    }),
  );
  return {
    headers,
    rows: extracted.map((cells) => cells.map((x) => x.text)),
    values: extracted.map((cells) => cells.map((x) => x.cell)),
    numberFormats: cols.map(xlsxNumberFormat),
  };
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
  const body: ExportCell[][] = table.values ?? table.rows;
  const sheet = XLSX.utils.aoa_to_sheet([table.headers, ...body]);
  // A number cell shows as the column shows it in the grid; the header row is row 0.
  table.numberFormats?.forEach((format, c) => {
    if (!format) return;
    body.forEach((cells, i) => {
      if (typeof cells[c] !== 'number') return;
      const cell = sheet[XLSX.utils.encode_cell({ r: i + 1, c })];
      if (cell) cell.z = format;
    });
  });
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
