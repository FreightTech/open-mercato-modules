/**
 * File → rows. **SERVER-SIDE ONLY.**
 *
 * The browser uploads bytes; this runs in the route handler. Parsing in both
 * places is how a preview and its commit drift apart, so there is deliberately
 * no client entry point — `components/ImportPanel.tsx` does not import this
 * file, and a test asserts that it never starts to.
 *
 * `xlsx` (vendored as `@freighttech/xlsx@0.20.3`) reads BOTH formats: `XLSX.read`
 * sniffs a CSV buffer just as happily as a ZIP workbook, and `sheet_to_json`
 * flattens either into rows. No second CSV parser is needed.
 *
 * Precedent: `packages/facilities/.../services/excel-parse.service.ts`.
 */
import * as XLSX from 'xlsx';
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_ROWS } from '../types/import';

export type ImportParseErrorCode =
  | 'file_too_large'
  | 'too_many_rows'
  | 'empty_file'
  | 'no_headers'
  | 'unreadable';

/**
 * A parse failure the user can act on. Route handlers map `code` onto a
 * message; nothing here is localized, because `packages/ui` server code has no
 * request locale.
 */
export class ImportParseError extends Error {
  readonly code: ImportParseErrorCode;
  /** Interpolation values for the caller's i18n string (e.g. `{ count, limit }`). */
  readonly details: Record<string, unknown>;

  constructor(code: ImportParseErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ImportParseError';
    this.code = code;
    this.details = details;
  }
}

export interface ParsedImportFile {
  /** Header labels in file order, blanks dropped, duplicates suffixed. */
  headers: string[];
  /** Data rows keyed by header. `sourceRowNumber` is the 1-based data row. */
  rows: Array<{ sourceRowNumber: number; values: Record<string, string> }>;
  sheetName: string;
}

export interface ParseImportFileOptions {
  /** Max data rows accepted. Defaults to `IMPORT_MAX_ROWS` (1,000). */
  maxRows?: number;
  /** Max byte length accepted. Defaults to `IMPORT_MAX_FILE_BYTES` (10 MB). */
  maxBytes?: number;
  /** Sheet to read. Defaults to the first. */
  sheetIndex?: number;
}

type ParseInput = ArrayBuffer | Uint8Array | string;

function byteLength(input: ParseInput): number {
  if (typeof input === 'string') {
    // A rough upper bound is fine — the cap exists to stop pathological files,
    // not to be byte-exact on a string that was already fully materialized.
    return input.length * 2;
  }
  if (input instanceof Uint8Array) return input.byteLength;
  return input.byteLength;
}

/**
 * Turn a SheetJS cell value into the string the mapper works with.
 *
 * Everything downstream is string-shaped because that is what a spreadsheet
 * cell *is* to the user, and because the module's own zod validators already
 * own coercion. Dates are the one exception worth normalizing here: SheetJS
 * hands back a `Date` for a real date cell, and `String(date)` would produce a
 * locale-dependent blob that no validator accepts.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // ISO date (no time) — the shape every date validator in the codebase takes.
    const iso = value.toISOString();
    return Number.isNaN(value.getTime()) ? '' : iso.slice(0, 10);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
}

/**
 * Normalize the header row: trim, drop trailing blanks, and suffix duplicates
 * so `{ header: field }` mapping stays a total function. Two columns both
 * called "Amount" become "Amount" and "Amount (2)".
 */
function normalizeHeaders(raw: unknown[]): string[] {
  const trimmed = raw.map((h) => cellToString(h));
  // Drop trailing empties — spreadsheets routinely carry phantom columns.
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === '') end -= 1;

  const seen = new Map<string, number>();
  const headers: string[] = [];
  for (let i = 0; i < end; i++) {
    const base = trimmed[i] || `Column ${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    headers.push(count === 1 ? base : `${base} (${count})`);
  }
  return headers;
}

/**
 * Parse an uploaded `.xlsx` or `.csv` into headers + string-valued rows.
 *
 * Caps are checked BEFORE and immediately AFTER the read: the byte cap stops a
 * 50 MB workbook from expanding into 400 MB of heap, and the row cap is
 * enforced on the parsed sheet because a small file can still declare a huge
 * range.
 *
 * @throws {ImportParseError}
 */
export function parseImportFile(
  input: ParseInput,
  options: ParseImportFileOptions = {},
): ParsedImportFile {
  const maxRows = options.maxRows ?? IMPORT_MAX_ROWS;
  const maxBytes = options.maxBytes ?? IMPORT_MAX_FILE_BYTES;
  const sheetIndex = options.sheetIndex ?? 0;

  const size = byteLength(input);
  if (size > maxBytes) {
    throw new ImportParseError('file_too_large', 'File exceeds the size limit', {
      bytes: size,
      limit: maxBytes,
    });
  }
  if (size === 0) {
    throw new ImportParseError('empty_file', 'File is empty');
  }

  let workbook: XLSX.WorkBook;
  try {
    if (typeof input === 'string') {
      // Strip a UTF-8 BOM — our own CSV export writes one so Excel picks the
      // encoding up, and SheetJS would otherwise fold it into header one.
      const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
      // `raw: true` on a CSV read stops SheetJS type-sniffing every cell:
      // without it an invoice number like `FV/1/2026` is helpfully turned into
      // a date. Everything arrives as a string, which is what a CSV cell is.
      workbook = XLSX.read(text, { type: 'string', raw: true });
    } else {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      // A real XLSX carries typed cells, so `cellDates` gives us `Date`
      // objects rather than serial numbers; `cellToString` renders them ISO.
      workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    }
  } catch (err) {
    throw new ImportParseError('unreadable', 'File could not be read as CSV or Excel', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  const sheetName = workbook.SheetNames[sheetIndex];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new ImportParseError('empty_file', 'Workbook contains no readable sheet');
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
    // Raw values, NOT the display text: a date cell must reach us as a `Date`
    // (so it becomes `2026-08-03`) rather than as whatever `8/3/26` format the
    // author happened to apply.
    raw: true,
  });

  if (!matrix.length) {
    throw new ImportParseError('empty_file', 'Sheet contains no rows');
  }

  const headers = normalizeHeaders(matrix[0] ?? []);
  if (!headers.length) {
    throw new ImportParseError('no_headers', 'First row carries no column headers');
  }

  const body = matrix.slice(1);
  const rows: ParsedImportFile['rows'] = [];
  for (const line of body) {
    const values: Record<string, string> = {};
    let hasData = false;
    for (let c = 0; c < headers.length; c++) {
      const cell = cellToString((line as unknown[])[c]);
      values[headers[c]] = cell;
      if (cell !== '') hasData = true;
    }
    // A wholly blank line is spreadsheet padding, not a record.
    if (!hasData) continue;
    rows.push({ sourceRowNumber: rows.length + 1, values });

    if (rows.length > maxRows) {
      throw new ImportParseError('too_many_rows', 'File exceeds the row limit', {
        // Report what the file actually holds so "split it in parts" is actionable.
        count: body.filter((l) =>
          (l as unknown[]).some((v) => cellToString(v) !== ''),
        ).length,
        limit: maxRows,
      });
    }
  }

  if (!rows.length) {
    throw new ImportParseError('empty_file', 'File has headers but no data rows');
  }

  return { headers, rows, sheetName: sheetName as string };
}
