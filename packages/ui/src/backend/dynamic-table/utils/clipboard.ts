// utils/clipboard.ts
//
// Clipboard payload <-> rectangular grid. PURE: no `ClipboardEvent`, no store,
// no React. The caller reads `text/html` and `text/plain` off the event and
// hands the strings in; everything below is testable without a browser.
//
// Why HTML first: Excel, Google Sheets and LibreOffice all put a real
// `text/html` `<table>` on the clipboard AND a `text/plain` TSV. The HTML
// preserves cell boundaries unambiguously — a cell containing a tab or a
// newline is still one `<td>`, where the TSV has to quote it and hope the
// reader unquotes the same way. TSV stays as the fallback because plenty of
// sources (a text editor, a terminal, our own copy handler) emit only that.

/** Which clipboard flavour produced the grid. `'empty'` means nothing usable. */
export type ClipboardGridSource = 'html' | 'text' | 'empty';

export interface ClipboardGrid {
  /** Rectangular: every row has `colCount` entries, short rows padded with ''. */
  rows: string[][];
  rowCount: number;
  colCount: number;
  source: ClipboardGridSource;
}

export interface ClipboardPayload {
  html?: string | null;
  text?: string | null;
}

const EMPTY_GRID: ClipboardGrid = { rows: [], rowCount: 0, colCount: 0, source: 'empty' };

// ============================================
// TSV
// ============================================

/**
 * Parse a TSV block into a rectangular grid.
 *
 * Handles the three line endings (`\r\n`, `\n`, `\r`), one trailing newline
 * (Excel appends one), and RFC4180-style quoting — which Excel uses on the
 * `text/plain` flavour whenever a cell contains a tab, a newline or a quote:
 * the cell is wrapped in `"` and internal `"` are doubled.
 */
export function parseTsv(text: string): string[][] {
  if (!text) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '' && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
      continue;
    }
    if (ch === '\t') {
      endField();
      continue;
    }
    if (ch === '\r') {
      // `\r\n` counts once; a lone `\r` is an old-Mac line ending.
      if (text[i + 1] === '\n') i++;
      endRow();
      continue;
    }
    if (ch === '\n') {
      endRow();
      continue;
    }
    field += ch;
  }

  // Anything still buffered is the last row; a payload ending in a newline has
  // nothing buffered and must NOT gain a phantom empty row.
  if (field !== '' || fieldWasQuoted || row.length > 0) endRow();

  return padGrid(rows);
}

/**
 * Serialise a grid to TSV, quoting exactly the cells that need it. Round-trips
 * through `parseTsv`.
 */
export function serialiseTsv(rows: readonly (readonly unknown[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null || cell === undefined ? '' : String(cell);
          if (/[\t\r\n"]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
          return value;
        })
        .join('\t'),
    )
    .join('\n');
}

/**
 * Lay a flat list of selected cells back out as a rectangle and serialise it.
 *
 * THE serializer for everything that puts the grid's own selection on the
 * clipboard — `Ctrl+C`, the context-menu Copy and `Ctrl+X`. Cut must place
 * byte-identical text to Copy (a user who cuts, panics and pastes back has to
 * get exactly what was there), which is only guaranteed while there is one of
 * these.
 *
 * `cells` is `store.getCellsInSelection()`: already index-addressed and already
 * tolerant of unmounted columns. Missing cells stay empty rather than shifting
 * their neighbours left.
 */
export function selectionToTsv(
  cells: readonly { row: number; col: number; value: unknown }[],
  bounds: { startRow: number; endRow: number; startCol: number; endCol: number },
): string {
  const rowCount = bounds.endRow - bounds.startRow + 1;
  const colCount = bounds.endCol - bounds.startCol + 1;
  if (rowCount <= 0 || colCount <= 0) return '';
  const grid: unknown[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => ''),
  );
  for (const cell of cells) {
    const r = cell.row - bounds.startRow;
    const c = cell.col - bounds.startCol;
    if (r < 0 || r >= rowCount || c < 0 || c >= colCount) continue;
    grid[r][c] = cell.value ?? '';
  }
  return serialiseTsv(grid);
}

// ============================================
// HTML TABLE
// ============================================

/**
 * Parse the `text/html` flavour Excel/Sheets put on the clipboard.
 *
 * Returns `null` — never an empty grid — when there is no usable table, so the
 * caller can fall through to TSV rather than pasting nothing.
 *
 * Merged cells: a `colspan`/`rowspan` cell contributes its text to its
 * top-left position and empty strings to the rest of the span, which is what
 * Excel itself pastes out of a merged block.
 */
export function parseClipboardHtml(html: string | null | undefined): string[][] | null {
  if (!html || !html.trim()) return null;
  // Server-side rendering and non-DOM test environments have no parser; the
  // TSV fallback covers them.
  if (typeof DOMParser === 'undefined') return null;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }

  const table = doc.querySelector('table');
  if (!table) return null;

  const trs = Array.from(
    table.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr'),
  );
  if (trs.length === 0) return null;

  const grid: string[][] = [];
  // Cells claimed by a rowspan from an earlier row, keyed `row:col`.
  const spanned = new Map<string, string>();

  trs.forEach((tr, r) => {
    const out: string[] = grid[r] ?? (grid[r] = []);
    const cells = Array.from(tr.querySelectorAll(':scope > td, :scope > th'));
    let c = 0;
    for (const cell of cells) {
      while (spanned.has(`${r}:${c}`)) {
        out[c] = spanned.get(`${r}:${c}`) ?? '';
        spanned.delete(`${r}:${c}`);
        c++;
      }
      const text = cellText(cell);
      const colSpan = spanCount(cell.getAttribute('colspan'));
      const rowSpan = spanCount(cell.getAttribute('rowspan'));
      for (let dc = 0; dc < colSpan; dc++) {
        out[c + dc] = dc === 0 ? text : '';
        for (let dr = 1; dr < rowSpan; dr++) {
          spanned.set(`${r + dr}:${c + dc}`, '');
        }
      }
      c += colSpan;
    }
    // Trailing cells claimed by a rowspan with no `td` after them.
    while (spanned.has(`${r}:${c}`)) {
      out[c] = spanned.get(`${r}:${c}`) ?? '';
      spanned.delete(`${r}:${c}`);
      c++;
    }
  });

  const filled = grid.map((row) => Array.from(row, (cell) => cell ?? ''));
  if (filled.length === 0) return null;
  return padGrid(filled);
}

function spanCount(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  // Excel writes real spans; anything absurd is a malformed payload, and
  // allocating for it would be a denial-of-service on a paste.
  return Math.min(n, 1000);
}

/**
 * A cell's text as a spreadsheet sees it: `<br>` becomes a newline, non-breaking
 * spaces become ordinary ones (Excel fills empty cells with `&nbsp;`), and the
 * source's pretty-printing whitespace is trimmed off the ends.
 */
function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => {
    br.replaceWith(clone.ownerDocument!.createTextNode('\n'));
  });
  return (clone.textContent ?? '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
}

// ============================================
// ENTRY POINT
// ============================================

/**
 * Turn a clipboard payload into a rectangular grid: HTML table first, TSV
 * fallback, `source: 'empty'` when neither yields anything.
 *
 * A grid of exactly one empty cell counts as empty — pasting it would clear a
 * cell the user did not ask to clear.
 */
export function parseClipboardGrid(payload: ClipboardPayload): ClipboardGrid {
  const fromHtml = parseClipboardHtml(payload.html);
  if (fromHtml && !isBlankGrid(fromHtml)) return toGrid(fromHtml, 'html');

  const fromText = payload.text ? parseTsv(payload.text) : [];
  if (fromText.length > 0 && !isBlankGrid(fromText)) return toGrid(fromText, 'text');

  return EMPTY_GRID;
}

function toGrid(rows: string[][], source: ClipboardGridSource): ClipboardGrid {
  return { rows, rowCount: rows.length, colCount: rows[0]?.length ?? 0, source };
}

function isBlankGrid(rows: string[][]): boolean {
  return rows.length === 0 || rows.every((row) => row.every((cell) => cell === ''));
}

/** Pad every row out to the widest, so callers can index without holes. */
export function padGrid(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    if (row.length === width) return row;
    const padded = row.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });
}
