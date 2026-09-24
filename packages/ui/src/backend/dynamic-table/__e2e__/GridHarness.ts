/**
 * GridHarness — a user-perspective driver for DynamicTable.
 *
 * WHY THIS EXISTS
 * The grid's value is keyboard-and-clipboard flow: land on a cell, tab across,
 * type, watch it save, drag-fill, undo, switch view. Existing specs reach into
 * the DOM (`td[data-row="0"][data-col="4"]`) which couples every test to
 * positional indices and to markup, and reads nothing about whether the *user*
 * would have believed the interaction worked.
 *
 * This harness speaks in user intentions instead — `editCell`, `tabForward`,
 * `expectSaved`, `copySelection`, `switchToView` — and resolves columns by their
 * visible header text so specs never hard-code an index. It is deliberately
 * assertion-light: it reports what the user can see and lets each spec assert.
 *
 * WHERE IT LIVES
 * Ships next to the component so the two evolve together. `build.mjs` ignores
 * every `__e2e__` directory so this never reaches the published bundle, but
 * tsconfig still covers it, so it stays type-checked. Import it from any
 * module's `__integration__` spec by relative path.
 *
 * DOM CONTRACT (as of @freighttech/ui 0.12.0 — update together with the component)
 *   .hot-container            outer shell, carries data-density / data-striped / …
 *   .hot-virtual-container    the scroller; tabIndex=0, receives all key events
 *   th[data-col]              column header
 *   td[data-row][data-col]    a cell; data-cell-selected / data-in-range /
 *                             data-range-{top,bottom,left,right} / data-save-state
 *   tr[data-row]              a row; data-is-new / data-row-checked / data-row-highlighted
 *   td[data-row-header=true]  the row-header (checkbox) cell
 *   .fill-handle              the drag-to-fill nub on a single active cell
 *   [role=tab][aria-selected] perspective (saved view) tabs
 *   .hot-bulk-bar             grouped-actions bar, shown when ≥1 row is checked
 *   .hot-empty-message        empty state
 *   th .hot-col-kebab         per-column "Column options" trigger (modern layout)
 *   .hot-col-menu             that menu, PORTALLED to document.body (outside .hot-container)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { expect, type Locator, type Page, type Request } from '@playwright/test'

/** A resolved column: its visible header and the `data-col` index behind it. */
export interface GridColumn {
  /** `data-col` attribute value — a string because that is how the DOM stores it. */
  index: string
  /** Header text as the user reads it. */
  header: string
}

export type SaveState = 'saving' | 'success' | 'error' | null

/**
 * The DOM event `applyCellWrites` emits once per multi-cell write.
 * Re-declared here rather than imported so the harness keeps no runtime
 * dependency on the component (it must be loadable from a Playwright process
 * that never renders React). Kept in sync with
 * `handlers/cellWrites.ts` → `CELL_BATCH_SAVE_RESULT_EVENT`.
 */
const BATCH_RESULT_EVENT = 'table:cell:batch:save:result'

/** Why a cell was refused — mirrors `CellWriteRejectReason`. */
export type BatchRejectReason =
  | 'readOnly'
  | 'notCoercible'
  | 'notInSource'
  | 'required'
  | 'outOfRange'

/** One multi-cell write's outcome, as the grid reports it. */
export interface BatchWriteReport {
  /** Cells whose value actually changed and were saved. */
  applied: number
  /** One entry per refused cell — never a silent drop. */
  rejected: Array<{ rowIndex: number; colIndex: number; reason: BatchRejectReason }>
}

/** A write the grid issued to the server, captured for request-count assertions. */
export interface RecordedWrite {
  method: string
  url: string
  /** Path only, query stripped — what you usually want to group by. */
  path: string
}

export interface GridHarnessOptions {
  /**
   * Scope the harness to one grid when a page renders several (drawers with
   * chained sub-tables). Defaults to the first `.hot-container` on the page.
   */
  root?: Locator
  /** Search-box placeholder. The component passes 'Search...' regardless of locale. */
  searchPlaceholder?: string
}

const SAVE_SETTLE_MS = 2_000 // component clears a success state after 2s

export class GridHarness {
  readonly page: Page
  readonly root: Locator
  /** The focusable scroller — every keyboard interaction must target this. */
  readonly grid: Locator
  private readonly searchPlaceholder: string
  private writes: RecordedWrite[] = []
  private recording = false

  constructor(page: Page, options: GridHarnessOptions = {}) {
    this.page = page
    this.root = options.root ?? page.locator('.hot-container').first()
    this.grid = this.root.locator('.hot-virtual-container')
    this.searchPlaceholder = options.searchPlaceholder ?? 'Search...'
  }

  /** Navigate to a list page and wait until its grid is interactive. */
  static async open(page: Page, url: string, options: GridHarnessOptions = {}): Promise<GridHarness> {
    await page.goto(url)
    const harness = new GridHarness(page, options)
    await harness.waitReady()
    return harness
  }

  /**
   * Ready = the grid shell exists and it has either rendered rows or an explicit
   * empty state. Without the empty-state branch this hangs on legitimately empty
   * lists instead of failing usefully.
   */
  async waitReady(timeout = 20_000): Promise<void> {
    await expect(this.grid).toBeVisible({ timeout })
    await expect
      .poll(async () => (await this.rowCount()) > 0 || (await this.isEmpty()), { timeout })
      .toBe(true)
  }

  /**
   * Ready AND populated. Use this whenever the spec is about to interact with
   * cells — `waitReady` deliberately accepts an empty grid, which then fails much
   * later inside `clickCell` with an unreadable selector error. Measured on a real
   * list that reported 66 records via its API but rendered no cells, where the
   * failure surfaced four steps downstream from the actual problem.
   */
  async waitForRows(minimum = 1, timeout = 20_000): Promise<number> {
    await expect(this.grid).toBeVisible({ timeout })
    try {
      await expect.poll(async () => this.rowCount(), { timeout }).toBeGreaterThanOrEqual(minimum)
    } catch {
      const empty = await this.isEmpty()
      throw new Error(
        `GridHarness: expected at least ${minimum} row(s) at ${this.page.url()} but the grid rendered ` +
          `${await this.rowCount()}${empty ? ' and is showing its empty state' : ''}. ` +
          `Check the list has data for the active organization scope, and that any search filter matches.`,
      )
    }
    return this.rowCount()
  }

  // ── What the user sees ────────────────────────────────────────────────

  async isEmpty(): Promise<boolean> {
    return (await this.root.locator('.hot-empty-message').count()) > 0
  }

  /** Rows currently rendered. Virtualised — this is what is on screen, not the dataset. */
  async rowCount(): Promise<number> {
    return this.grid.locator('tr[data-row]').count()
  }

  /**
   * Rows the grid HOLDS (its `aria-rowcount`), as opposed to rows it has
   * rendered. `rowCount()` counts the virtualiser's window, which depends on
   * the pane's height: a search that narrows 61 documents to 40 renders about
   * the same number of rows either way, and a pane that grows (its own search
   * row hidden) renders MORE. Use this to prove a dataset narrowed.
   * Falls back to the rendered count on a grid with a custom body.
   *
   * On a GROUPED view the count includes group header and summary rows (it is
   * the virtualiser's visual row count), so it is not a data-row count there —
   * compare like with like, or count data rows another way.
   */
  async loadedRowCount(): Promise<number> {
    const value = await this.root.locator('[aria-rowcount]').first().getAttribute('aria-rowcount').catch(() => null)
    const parsed = value === null ? Number.NaN : Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : this.rowCount()
  }

  /**
   * Resolve a column by its visible header. Accepts a regex so a spec can match
   * both locales at once (`/Nr faktury|Invoice no/i`) — the demo session's
   * language is not fixed, and hard-coding one locale makes tests flaky by design.
   */
  async column(header: RegExp | string): Promise<GridColumn> {
    const re = typeof header === 'string' ? new RegExp(escapeRegExp(header), 'i') : header
    const headers = this.root.locator('th[data-col]')
    const n = await headers.count()
    const seen: string[] = []
    for (let i = 0; i < n; i++) {
      const th = headers.nth(i)
      const text = ((await th.textContent()) ?? '').trim()
      seen.push(text)
      if (re.test(text)) {
        const index = await th.getAttribute('data-col')
        if (index != null) return { index, header: text }
      }
    }
    throw new Error(`GridHarness: no column header matched ${re}. Saw: ${seen.map((s) => JSON.stringify(s)).join(', ')}`)
  }

  cell(row: number, col: GridColumn | string): Locator {
    return this.grid.locator(`td[data-row="${row}"][data-col="${colIndexOf(col)}"]`)
  }

  row(row: number): Locator {
    return this.grid.locator(`tr[data-row="${row}"]`)
  }

  /** The text a user reads in a cell — renderer output included, trimmed. */
  async readCell(row: number, col: GridColumn | string): Promise<string> {
    return ((await this.cell(row, col).textContent()) ?? '').trim()
  }

  /** Every rendered value in a column, top to bottom. */
  async readColumn(col: GridColumn | string): Promise<string[]> {
    const cells = this.grid.locator(`td[data-col="${colIndexOf(col)}"]`)
    const n = await cells.count()
    const out: string[] = []
    for (let i = 0; i < n; i++) out.push(((await cells.nth(i).textContent()) ?? '').trim())
    return out
  }

  /** A row keyed by header text — how a user would describe what they see. */
  async readRowByHeader(row: number): Promise<Record<string, string>> {
    const headers = this.root.locator('th[data-col]')
    const n = await headers.count()
    const out: Record<string, string> = {}
    for (let i = 0; i < n; i++) {
      const th = headers.nth(i)
      const index = await th.getAttribute('data-col')
      if (index == null) continue
      const label = ((await th.textContent()) ?? '').trim()
      if (!label) continue
      out[label] = await this.readCell(row, index)
    }
    return out
  }

  // ── Navigating, the way a user does ───────────────────────────────────

  /**
   * True when the host passed `onRowClick`, i.e. clicking a cell NAVIGATES to the
   * record instead of selecting the cell. Measured on a real contrahents list,
   * where `clickCell` silently left the list for `/backend/contrahents/<id>` and
   * every later assertion failed for an unrelated-looking reason.
   */
  async hasClickableRows(): Promise<boolean> {
    return (await this.root.getAttribute('data-clickable-rows')) === 'true'
  }

  /**
   * Click a cell to select it. Refuses on clickable-row lists, where a click
   * navigates — use {@link focusCell} there instead.
   */
  async clickCell(row: number, col: GridColumn | string): Promise<void> {
    this.note(`clicked cell row ${row}, column ${describeCol(col)}`)
    const target = this.cell(row, col)
    if ((await target.count()) === 0) {
      throw new Error(
        `GridHarness: no cell at row ${row}, column ${describeCol(col)} — the grid has ` +
          `${await this.rowCount()} rendered row(s) at ${this.page.url()}. ` +
          `Call waitForRows() before interacting with cells.`,
      )
    }
    if (await this.hasClickableRows()) {
      throw new Error(
        `GridHarness: this list has clickable rows (onRowClick), so clicking a cell navigates to the ` +
          `record instead of selecting it. Use focusCell(${row}, ${describeCol(col)}) — keyboard ` +
          `selection — or call the navigation deliberately with cell(...).click().`,
      )
    }
    await target.click()
    await expect(target).toHaveAttribute('data-in-range', 'true')
  }

  /**
   * Select a cell using the keyboard only — safe on every list, including those
   * whose rows navigate on click. Seeds a selection by focusing the grid and
   * pressing an arrow (the component selects the first cell on directional entry),
   * then walks to the target.
   */
  async focusCell(row: number, col: GridColumn | string): Promise<void> {
    this.note(`keyboard-selected row ${row}, column ${describeCol(col)}`)
    const targetCol = Number(colIndexOf(col))
    if (Number.isNaN(targetCol)) {
      throw new Error(`GridHarness: focusCell needs a numeric column index, got ${colIndexOf(col)}`)
    }
    await this.grid.focus()
    // Directional entry seeds the selection at the first cell.
    await this.press('ArrowDown')
    const seeded = await this.selectedRange()
    if (!seeded) {
      throw new Error(
        `GridHarness: the grid did not take keyboard focus at ${this.page.url()} — ` +
          `it may not be interactive yet (call waitForRows() first).`,
      )
    }
    let currentRow = Math.min(...seeded.rows)
    let currentCol = Math.min(...seeded.cols.map(Number))
    if (row > currentRow) await this.arrow('Down', row - currentRow)
    else if (row < currentRow) await this.arrow('Up', currentRow - row)
    if (targetCol > currentCol) await this.arrow('Right', targetCol - currentCol)
    else if (targetCol < currentCol) await this.arrow('Left', currentCol - targetCol)
    await expect(
      this.cell(row, col),
      `keyboard navigation should have landed on row ${row}, column ${describeCol(col)}`,
    ).toHaveAttribute('data-in-range', 'true')
  }

  /** Which cell is selected right now, or null. Reads the component's own markers. */
  async selectedCell(): Promise<{ row: number; col: string } | null> {
    const selected = this.grid.locator('td[data-cell-selected="true"]').first()
    if ((await selected.count()) === 0) return null
    const row = await selected.getAttribute('data-row')
    const col = await selected.getAttribute('data-col')
    return row != null && col != null ? { row: Number(row), col } : null
  }

  /** The selected rectangle in cell coordinates, or null when nothing is selected. */
  async selectedRange(): Promise<{ rows: number[]; cols: string[] } | null> {
    const inRange = this.grid.locator('td[data-in-range="true"]')
    const n = await inRange.count()
    if (n === 0) return null
    const rows = new Set<number>()
    const cols = new Set<string>()
    for (let i = 0; i < n; i++) {
      const td = inRange.nth(i)
      const r = await td.getAttribute('data-row')
      const c = await td.getAttribute('data-col')
      if (r != null) rows.add(Number(r))
      if (c != null) cols.add(c)
    }
    return { rows: [...rows].sort((a, b) => a - b), cols: [...cols] }
  }

  /**
   * Send a key to the grid.
   *
   * CRITICAL: when an editor is open the keystroke must go to the FOCUSED element,
   * not the container. `locator.press()` focuses its target first, so pressing on
   * the container blurs the open editor — the editor's blur handler then saves and
   * clears the editing state, and the container's keydown handler consequently sees
   * `editing === null` and takes the wrong branch.
   *
   * That bug made Enter-commit look like it never moved down a row, and made the
   * two-step Escape look like a one-step clear. Both were harness artifacts; the
   * grid behaves correctly when the keystroke reaches the editor, as it does for a
   * real user. Verified by hand: Enter at (0,0) → editor at (0,0); Enter again →
   * selection AND editor at (1,0). Escape → editor closes, selection survives;
   * Escape again → selection clears.
   */
  async press(key: string): Promise<void> {
    if (await this.isAnyEditorOpen()) {
      // Goes to document.activeElement — the editor — without stealing focus.
      await this.page.keyboard.press(key)
      return
    }
    await this.grid.press(key)
  }

  async tabForward(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await this.press('Tab')
  }

  async tabBackward(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await this.press('Shift+Tab')
  }

  /** Walk with arrow keys only — real traversal, not a click shortcut. */
  async arrow(direction: 'Up' | 'Down' | 'Left' | 'Right', times = 1): Promise<void> {
    this.note(`pressed Arrow${direction} x${times}`)
    for (let i = 0; i < times; i++) await this.press(`Arrow${direction}`)
  }

  /**
   * Extend the current selection with Shift+Arrow — the spreadsheet way to grow a
   * range from the keyboard.
   */
  async shiftArrow(direction: 'Up' | 'Down' | 'Left' | 'Right', times = 1): Promise<void> {
    this.note(`pressed Shift+Arrow${direction} x${times}`)
    for (let i = 0; i < times; i++) await this.press(`Shift+Arrow${direction}`)
  }

  /** Right-click a cell to open its context menu. */
  async rightClickCell(row: number, col: GridColumn | string): Promise<void> {
    this.note(`right-clicked row ${row}, column ${describeCol(col)}`)
    await this.cell(row, col).click({ button: 'right' })
  }

  /**
   * Labels currently offered by an open context menu. `ContextMenu` portals to the
   * body, so this queries the page rather than the grid container.
   */
  async contextMenuLabels(): Promise<string[]> {
    const menu = this.page.locator('.hot-context-menu, .context-menu').last()
    if ((await menu.count()) === 0) return []
    const texts = await menu.locator('button, [role="menuitem"], li').allTextContents()
    return texts.map((t) => t.trim()).filter(Boolean)
  }

  /**
   * Coordinates of the cell whose editor is currently open, or null. Distinct from
   * `selectedCell` — Tab and Enter both move the selection AND (when
   * `autoEditOnTab` is on) open an editor, and those two can legitimately diverge.
   */
  async editingCellCoords(): Promise<{ row: number; col: string } | null> {
    // Every editor variant renders an in-cell element classed `hot-cell-editor`
    // (text, numeric, date, dropdown, multiselect) — matching on `input` alone
    // misses the variants that render a div/button and their portalled popups.
    const editing = this.grid.locator('td:has(.hot-cell-editor)').first()
    if ((await editing.count()) === 0) return null
    const row = await editing.getAttribute('data-row')
    const col = await editing.getAttribute('data-col')
    return row != null && col != null ? { row: Number(row), col } : null
  }

  /** True while any editor is open — including one whose popup is portalled out. */
  async isAnyEditorOpen(): Promise<boolean> {
    if ((await this.grid.locator('.hot-cell-editor').count()) > 0) return true
    return (await this.page.locator('.hot-editor-popup').count()) > 0
  }

  /**
   * `data-col` indices of every read-only column, resolved from the rendered cells.
   * Tab skips these, so a spec that wants to predict where Tab lands must know them
   * rather than assume the next column is editable.
   */
  async readOnlyColumnIndices(): Promise<string[]> {
    return this.grid.evaluate((gridEl) => {
      const seen = new Map<string, boolean>()
      gridEl.querySelectorAll('td[data-col]').forEach((td) => {
        const col = td.getAttribute('data-col')
        if (col == null || seen.has(col)) return
        seen.set(col, td.classList.contains('read-only'))
      })
      return [...seen.entries()].filter(([, ro]) => ro).map(([col]) => col)
    })
  }

  /** True when this column is declared read-only (cells carry `.read-only`). */
  async isColumnReadOnly(col: GridColumn | string): Promise<boolean> {
    const first = this.grid.locator(`td[data-col="${colIndexOf(col)}"]`).first()
    const cls = (await first.getAttribute('class')) ?? ''
    return cls.includes('read-only')
  }

  // ── Editing ───────────────────────────────────────────────────────────

  /**
   * Edit a cell the way a user does: double-click to open the editor, replace the
   * text, commit with Enter. Does NOT wait for persistence — call `expectSaved`
   * or assert against the API, so the spec stays explicit about what it trusts.
   */
  async editCell(row: number, col: GridColumn | string, text: string): Promise<void> {
    this.note(`typed ${JSON.stringify(text)} into row ${row}, column ${describeCol(col)}`)
    const target = this.cell(row, col)
    await target.dblclick()
    const editor = target.locator('input, textarea').first()
    await expect(editor).toBeVisible({ timeout: 5_000 })
    await editor.fill(text)
    await editor.press('Enter')
  }

  /** True while an editor is open in this cell. */
  async isEditing(row: number, col: GridColumn | string): Promise<boolean> {
    return (await this.cell(row, col).locator('input, textarea').count()) > 0
  }

  /** The cell's save indicator: 'saving' → 'success' | 'error', then cleared. */
  async saveState(row: number, col: GridColumn | string): Promise<SaveState> {
    const value = await this.cell(row, col).getAttribute('data-save-state')
    return (value as SaveState) ?? null
  }

  /**
   * Wait until the grid itself says the cell saved. This is the signal the *user*
   * sees, which is the point — a spec that only checks the API can pass while the
   * user is still staring at a spinner.
   *
   * Note the success state self-clears after 2s, so a slow assertion can miss it;
   * this polls for success-or-cleared and fails loudly on 'error'.
   */
  async expectSaved(row: number, col: GridColumn | string, timeout = 15_000): Promise<void> {
    await expect
      .poll(async () => this.saveState(row, col), { timeout })
      .not.toBe('saving')
    const final = await this.saveState(row, col)
    if (final === 'error') {
      throw new Error(`GridHarness: cell (${row}, ${colIndexOf(col)}) reported a save error to the user`)
    }
  }

  // ── Selection & clipboard ─────────────────────────────────────────────

  /** Drag from the cell BODY to select a range (never touches the fill nub). */
  async selectRange(
    from: { row: number; col: GridColumn | string },
    to: { row: number; col: GridColumn | string },
  ): Promise<void> {
    this.note(`drag-selected from row ${from.row} to row ${to.row} in column ${describeCol(to.col)}`)
    await this.cell(from.row, from.col).dragTo(this.cell(to.row, to.col))
  }

  /** Tick a row's checkbox via the row header — drives the bulk-actions bar. */
  async checkRow(row: number): Promise<void> {
    this.note(`ticked the checkbox on row ${row}`)
    await this.row(row).locator('td[data-row-header="true"] input[type="checkbox"]').first().check()
    await expect(this.row(row)).toHaveAttribute('data-row-checked', 'true')
  }

  async checkedRowCount(): Promise<number> {
    return this.grid.locator('tr[data-row-checked="true"]').count()
  }

  async isBulkBarVisible(): Promise<boolean> {
    return this.root.locator('.hot-bulk-bar-wrap.is-open').count().then((n) => n > 0)
  }

  /**
   * Copy the current selection with Ctrl/Cmd+C and return what landed on the
   * clipboard. Requires clipboard permissions on the context — see
   * `grantClipboard()`.
   */
  async copySelection(): Promise<string> {
    this.note('pressed Copy on the selection')
    await this.press(modifier() + '+c')
    return this.readClipboard()
  }

  async readClipboard(): Promise<string> {
    return this.page.evaluate(() => navigator.clipboard.readText())
  }

  /**
   * Paste a TSV block at the current selection, simulating a real Excel paste:
   * a `paste` ClipboardEvent carrying both `text/plain` and an HTML table, which
   * is what Excel and Google Sheets actually put on the clipboard.
   *
   * Ships on every DynamicTable page via a document-level handler; the grid
   * reads the HTML flavour first because Excel's `text/plain` mangles any cell
   * containing a tab or a newline.
   */
  async pasteTsv(tsv: string): Promise<void> {
    this.note(`pasted a ${tsv.split('\n').length}x${(tsv.split('\n')[0] ?? '').split('\t').length} block from the clipboard`)
    const html =
      '<table>' +
      tsv
        .split('\n')
        .map((line) => '<tr>' + line.split('\t').map((c) => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>')
        .join('') +
      '</table>'
    await this.grid.evaluate(
      (el, payload) => {
        const dt = new DataTransfer()
        dt.setData('text/plain', payload.tsv)
        dt.setData('text/html', payload.html)
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      },
      { tsv, html },
    )
  }

  /**
   * `Ctrl/⌘+X` on the current selection: copy to the clipboard, then clear the
   * source — ONE undo entry.
   *
   * Dispatches a real `cut` ClipboardEvent rather than pressing the key
   * combination, for the same reason `pasteTsv` does: Chromium only turns
   * `Ctrl+X` into a clipboard event when the keystroke comes from the OS, and a
   * synthesised one never reaches the renderer's editing commands. The grid
   * listens for the DOM event, so this exercises the real handler.
   *
   * Returns what the grid put on the clipboard, so a test can assert that a cut
   * and a copy place byte-identical text.
   */
  async cut(): Promise<string> {
    this.note('pressed Cut (Ctrl/⌘+X)')
    return this.grid.evaluate((el) => {
      const dt = new DataTransfer()
      el.dispatchEvent(new ClipboardEvent('cut', { clipboardData: dt, bubbles: true, cancelable: true }))
      return dt.getData('text/plain')
    })
  }

  /**
   * `Delete` on the current selection: clear cell CONTENTS. The row is never
   * deleted — that stays on `Ctrl/⌘+D` and the grouped-actions bar.
   */
  async clearSelectionContents(key: 'Delete' | 'Backspace' = 'Delete'): Promise<void> {
    this.note(`pressed ${key} to clear the selected cells`)
    await this.press(key)
  }

  async undo(): Promise<void> {
    this.note('pressed Undo')
    await this.press(modifier() + '+z')
  }

  async redo(): Promise<void> {
    this.note('pressed Redo')
    await this.press(modifier() + '+Shift+z')
  }

  // ── Fill handle ───────────────────────────────────────────────────────

  /** Is the drag-to-fill nub offered on the currently selected cell? */
  async hasFillHandle(): Promise<boolean> {
    return (await this.root.locator('.fill-handle').count()) > 0
  }

  /** Select the source cell, then drag its nub to `toRow` (up or down). */
  async fillFrom(fromRow: number, toRow: number, col: GridColumn | string): Promise<void> {
    this.note(`dragged the fill nub from row ${fromRow} to row ${toRow} in column ${describeCol(col)}`)
    await this.clickCell(fromRow, col)
    const nub = this.root.locator('.fill-handle')
    await expect(nub, 'fill nub should be offered on an editable single-cell selection').toBeVisible({
      timeout: 5_000,
    })
    await nub.dragTo(this.cell(toRow, col))
  }

  /**
   * Drag the nub to an arbitrary CELL — the rectangle model, so `to` may be in a
   * different column, above, or back inside the source (which clears).
   *
   * `steps` matters: a single-jump drag can miss the intermediate `mousemove`
   * the preview is computed on, so the release would commit a stale rectangle.
   */
  async fillTo(
    to: { row: number; col: GridColumn | string },
    options: { modifier?: boolean } = {},
  ): Promise<void> {
    this.note(`dragged the fill nub to row ${to.row}, column ${describeCol(to.col)}`)
    const nub = this.root.locator('.fill-handle')
    await expect(nub, 'fill nub should be offered on a fillable selection').toBeVisible({ timeout: 5_000 })
    const from = await nub.boundingBox()
    const target = await this.cell(to.row, to.col).boundingBox()
    if (!from || !target) throw new Error('GridHarness: could not measure the fill drag endpoints')
    await this.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await this.page.mouse.down()
    if (options.modifier) await this.page.keyboard.down('Alt')
    await this.page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
    await this.page.mouse.up()
    if (options.modifier) await this.page.keyboard.up('Alt')
  }

  /**
   * The fill preview rectangle, read from the PER-CELL attributes rather than a
   * marquee element — the attributes are deliberately the test surface.
   */
  async readFillPreview(): Promise<{
    cells: Array<{ row: number; col: number }>
    targets: Array<{ row: number; col: number }>
    clearing: Array<{ row: number; col: number }>
    edges: { top: number; bottom: number; left: number; right: number }
  }> {
    return this.root.evaluate((root) => {
      const read = (selector: string) =>
        Array.from(root.querySelectorAll<HTMLElement>(selector)).map((td) => ({
          row: Number(td.getAttribute('data-row')),
          col: Number(td.getAttribute('data-col')),
        }))
      return {
        cells: read('td[data-fill-preview="true"]'),
        targets: read('td[data-fill-target="true"]'),
        clearing: read('td[data-fill-clear="true"]'),
        edges: {
          top: root.querySelectorAll('td[data-fill-preview="true"][data-fill-top="true"]').length,
          bottom: root.querySelectorAll('td[data-fill-preview="true"][data-fill-bottom="true"]').length,
          left: root.querySelectorAll('td[data-fill-preview="true"][data-fill-left="true"]').length,
          right: root.querySelectorAll('td[data-fill-preview="true"][data-fill-right="true"]').length,
        },
      }
    })
  }

  // ── Search, sort, views ───────────────────────────────────────────────

  /**
   * Type into the list search and wait until the row count settles at `expected`.
   * The standard way to isolate a spec's own fixtures from demo data.
   */
  async searchFor(text: string, expected?: number): Promise<void> {
    this.note(`searched for ${JSON.stringify(text)}`)
    const box = this.root.getByPlaceholder(this.searchPlaceholder)
    await box.fill('')
    await box.fill(text)
    if (expected != null) {
      await expect.poll(async () => this.rowCount(), { timeout: 20_000 }).toBe(expected)
    }
  }

  /**
   * Click a column header directly. NOTE: in the default (modern) layout this does
   * NOT sort — the header renders only a label and a kebab; the click-to-sort code
   * path belongs to the legacy layout. Use {@link sortViaColumnMenu} for the real
   * user path. Kept because embedded tables may opt into the legacy layout via
   * `uiConfig.disableBuiltinColumnMenu`.
   */
  async clickHeader(col: GridColumn): Promise<void> {
    this.note(`clicked the "${col.header}" header`)
    await this.root.locator(`th[data-col="${col.index}"]`).click()
  }

  /**
   * Sort a column the way a user actually does in the shipped UI: open the
   * column's kebab ("Column options") and choose a sort direction.
   *
   * Verified against @freighttech/ui 0.12.0, where the menu offers
   * "Sort A → Z" / "Sort Z → A" (labels vary by column data type — see
   * `getSortDirectionLabels`, e.g. "Old → New" for dates), so the direction is
   * matched positionally rather than by label text.
   */
  async sortViaColumnMenu(col: GridColumn, direction: 'asc' | 'desc'): Promise<void> {
    this.note(`sorted "${col.header}" ${direction} via the column menu`)
    await this.root.locator(`th[data-col="${col.index}"] .hot-col-kebab`).click()
    // ColumnHeaderMenu portals to document.body as `.hot-col-menu`, so it is
    // outside `this.root` — query it from the page, not the grid container.
    const items = this.page.locator('.hot-col-menu .hot-col-menu-item')
    await expect(items.first(), 'the column options menu should open').toBeVisible({ timeout: 5_000 })
    // Sort asc / desc are the menu's first two entries; their labels vary with
    // the column's data type (A→Z, Old→New, 1→9), so match positionally.
    await items.nth(direction === 'asc' ? 0 : 1).click()
  }

  /**
   * Whether ANY header communicates a sort to the user — glyph or `aria-sort`.
   *
   * As of 0.12.0 this is `false` even immediately after sorting: the ↑/↓/⇅ glyphs
   * live in the legacy header branch, and nothing renders an indicator for the
   * modern layout's `sortRules`. No `aria-sort` is emitted either, so the state is
   * invisible to sighted and screen-reader users alike. Kept as a first-class
   * query so a spec can pin the gap and fail loudly when it is closed.
   */
  async sortIndicatorShownAnywhere(): Promise<{ glyph: boolean; ariaSort: boolean }> {
    return this.root.evaluate((rootEl) => {
      const headers = Array.from(rootEl.querySelectorAll('th[data-col]'))
      const text = headers.map((h) => h.textContent ?? '').join('')
      return {
        glyph: text.includes('\u2191') || text.includes('\u2193'),
        ariaSort: headers.some((h) => h.getAttribute('aria-sort')),
      }
    })
  }

  /**
   * The sort direction the header is *showing* the user (↑ / ↓ / neither).
   * Reads the glyph rather than internal state, which is the point: this is what
   * makes the two-sources-of-truth sort defect observable from outside.
   */
  async shownSortDirection(col: GridColumn): Promise<'asc' | 'desc' | null> {
    const text = ((await this.root.locator(`th[data-col="${col.index}"]`).textContent()) ?? '')
    if (text.includes('↑')) return 'asc'
    if (text.includes('↓')) return 'desc'
    return null
  }

  // ── Per-column quick filter (Excel AutoFilter — workshop A1) ──────────
  //
  // The funnel in the column header. This is the route the workshop asked for
  // by name; the Configure View drawer is the "advanced" route and is NOT what
  // these verbs drive. The dropdown portals to `document.body`, so it is
  // queried from the PAGE, not from `this.root`.

  /** Open a column's funnel dropdown and wait for it to be on screen. */
  async openColumnFilter(col: GridColumn): Promise<void> {
    this.note(`opened the "${col.header}" column filter`)
    await this.root.locator(`th[data-col="${col.index}"] .hot-col-funnel`).click()
    await expect(
      this.page.locator('.hot-quick-filter'),
      'the column quick filter should open',
    ).toBeVisible({ timeout: 5_000 })
  }

  /** Values the funnel is offering, in the order they are listed. */
  async columnFilterValues(): Promise<string[]> {
    // Settle the debounced suggestion fetch before reading the list, otherwise
    // a fast assertion reads the loading state as "no values".
    await expect
      .poll(
        async () =>
          this.page.locator('.hot-quick-filter-list').getAttribute('data-suggestions-state'),
        { timeout: 10_000 },
      )
      .not.toBe('loading')
    return this.page.locator('.hot-quick-filter-option-label').allTextContents()
  }

  /** Type into the funnel's search box. The needle goes to the server. */
  async searchColumnFilter(text: string): Promise<void> {
    this.note(`searched the column filter for ${JSON.stringify(text)}`)
    await this.page.locator('.hot-quick-filter-search input').fill(text)
  }

  /** Tick one value by its visible label. */
  async tickColumnFilterValue(value: string): Promise<void> {
    this.note(`ticked ${JSON.stringify(value)}`)
    await this.page.locator(`[data-quick-filter-value="${value}"]`).click()
  }

  /** Tick / untick everything currently listed ("Select all"). */
  async tickAllColumnFilterValues(): Promise<void> {
    await this.page.locator('[data-quick-filter-all]').click()
  }

  /** Commit the ticked values as an `is_any_of` rule and close the dropdown. */
  async applyColumnFilter(): Promise<void> {
    this.note('applied the column filter')
    await this.page.locator('[data-quick-filter-apply]').click()
    await expect(this.page.locator('.hot-quick-filter')).toBeHidden({ timeout: 5_000 })
  }

  /** Drop this column's rule entirely. */
  async clearColumnFilter(): Promise<void> {
    this.note('cleared the column filter')
    await this.page.locator('[data-quick-filter-clear]').click()
    await expect(this.page.locator('.hot-quick-filter')).toBeHidden({ timeout: 5_000 })
  }

  /**
   * Headers the grid is SHOWING as filtered — workshop A13, "wolę mieć pewność,
   * czy faktycznie ja wszystko widzę". Read from the rendered header, not from
   * internal state, because being visible is the whole requirement.
   */
  async filteredColumnHeaders(): Promise<string[]> {
    const ths = this.root.locator('th[data-filtered]')
    const n = await ths.count()
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      out.push(((await ths.nth(i).textContent()) ?? '').replace(/\s+/g, ' ').trim())
    }
    return out
  }

  /** The count in the toolbar's "Clear all filters (n)" pill; 0 when absent. */
  async activeFilterCount(): Promise<number> {
    const chip = this.root.locator('[data-clear-all-filters]')
    if ((await chip.count()) === 0) return 0
    const match = /\((\d+)\)/.exec((await chip.textContent()) ?? '')
    return match ? Number(match[1]) : 0
  }

  /** Click the toolbar's "Clear all filters (n)". */
  async clearAllFilters(): Promise<void> {
    this.note('cleared all filters from the toolbar')
    await this.root.locator('[data-clear-all-filters]').click()
  }

  /** Saved-view tabs, in the order the user sees them. */
  async viewNames(): Promise<string[]> {
    const tabs = this.root.locator('[role="tab"]')
    const n = await tabs.count()
    const names: string[] = []
    for (let i = 0; i < n; i++) {
      const label = ((await tabs.nth(i).textContent()) ?? '').replace(/×|\s+/g, ' ').trim()
      if (label && label !== '+') names.push(label)
    }
    return names
  }

  async activeViewName(): Promise<string | null> {
    const active = this.root.locator('[role="tab"][aria-selected="true"]').first()
    if ((await active.count()) === 0) return null
    return ((await active.textContent()) ?? '').replace(/×|\s+/g, ' ').trim()
  }

  async switchToView(name: RegExp | string): Promise<void> {
    const re = typeof name === 'string' ? new RegExp(escapeRegExp(name), 'i') : name
    const tabs = this.root.locator('[role="tab"]')
    const n = await tabs.count()
    for (let i = 0; i < n; i++) {
      const label = ((await tabs.nth(i).textContent()) ?? '').trim()
      if (re.test(label)) {
        this.note(`switched to the "${label}" saved view`)
        await tabs.nth(i).click()
        return
      }
    }
    throw new Error(`GridHarness: no saved view matched ${re}. Saw: ${(await this.viewNames()).join(', ')}`)
  }

  // ── Column widths (persistence across reloads) ────────────────────────

  async columnWidth(col: GridColumn): Promise<number> {
    const box = await this.root.locator(`th[data-col="${col.index}"]`).boundingBox()
    return Math.round(box?.width ?? 0)
  }

  /** Drag a column's resize grip by `deltaX` pixels, as a user would. */
  async resizeColumn(col: GridColumn, deltaX: number): Promise<void> {
    this.note(`dragged the "${col.header}" column edge by ${deltaX}px`)
    const th = this.root.locator(`th[data-col="${col.index}"]`)
    const box = await th.boundingBox()
    if (!box) throw new Error(`GridHarness: header ${col.header} has no box to drag`)
    const startX = box.x + box.width - 2
    const y = box.y + box.height / 2
    await this.page.mouse.move(startX, y)
    await this.page.mouse.down()
    await this.page.mouse.move(startX + deltaX, y, { steps: 8 })
    await this.page.mouse.up()
  }

  // ── Observing what the grid asked the server to do ─────────────────────

  /**
   * Start recording mutating requests. Lets a spec assert the *cost* of an
   * interaction — "editing one cell issued exactly one PATCH" — which is the
   * measurement the Tier-1 paste-batching decision will be made on.
   */
  startRecordingWrites(): void {
    if (this.recording) return
    this.recording = true
    this.writes = []
    this.page.on('request', this.onRequest)
  }

  stopRecordingWrites(): RecordedWrite[] {
    if (this.recording) {
      this.page.off('request', this.onRequest)
      this.recording = false
    }
    return this.writes
  }

  /** Mutating writes seen so far, optionally filtered by URL substring. */
  recordedWrites(urlContains?: string): RecordedWrite[] {
    return urlContains ? this.writes.filter((w) => w.path.includes(urlContains)) : [...this.writes]
  }

  private onRequest = (request: Request): void => {
    const method = request.method()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
    const url = request.url()
    this.writes.push({ method, url, path: url.split('?')[0] })
  }

  // ── Observing the grid's own multi-cell write reports ──────────────────

  /**
   * Start recording `table:cell:batch:save:result` — the report every multi-cell
   * write (paste, cut, clear, fill, replace, import) emits through
   * `applyCellWrites`.
   *
   * WHY NOT ASSERT THE FLASH: the report is also shown to the user as a flash
   * message, but that string is translated and the demo session's locale is not
   * fixed, so asserting on it makes a test locale-flaky. The event carries the
   * same facts — how many cells were applied, and one entry per REJECTED cell
   * with its machine-readable reason — in a form that reads the same in every
   * language.
   *
   * Listens on `document` in the CAPTURE phase so it sees the event before the
   * grid's own mediator, which calls `stopPropagation()`.
   */
  async startRecordingBatchResults(): Promise<void> {
    await this.page.evaluate((eventName) => {
      const w = window as unknown as {
        __gridBatchResults?: unknown[]
        __gridBatchListener?: EventListener
      }
      if (w.__gridBatchListener) document.removeEventListener(eventName, w.__gridBatchListener, true)
      w.__gridBatchResults = []
      w.__gridBatchListener = (event: Event) => {
        w.__gridBatchResults!.push((event as CustomEvent).detail)
      }
      document.addEventListener(eventName, w.__gridBatchListener, true)
    }, BATCH_RESULT_EVENT)
  }

  /** Every batch report seen since `startRecordingBatchResults()`, in order. */
  async recordedBatchResults(): Promise<BatchWriteReport[]> {
    return this.page.evaluate(() => {
      const w = window as unknown as { __gridBatchResults?: unknown[] }
      return (w.__gridBatchResults ?? []) as BatchWriteReport[]
    })
  }

  /** Wait until `count` batch reports have arrived, then return them. */
  async waitForBatchResults(count: number, timeout = 10_000): Promise<BatchWriteReport[]> {
    await expect
      .poll(async () => (await this.recordedBatchResults()).length, { timeout })
      .toBeGreaterThanOrEqual(count)
    return this.recordedBatchResults()
  }

  /** Let the in-flight save settle and its success indicator clear. */
  async settle(): Promise<void> {
    await this.page.waitForTimeout(SAVE_SETTLE_MS + 250)
  }

  // ── Semi-automatic: handing control to a human or an agent ─────────────

  /**
   * Every user-level action this harness performed, in order. Recorded so a run
   * can explain itself in the vocabulary the test was written in ("edited row 0
   * / Cost type") rather than as a Playwright call stack.
   */
  readonly journal: string[] = []

  private note(step: string): void {
    this.journal.push(step)
  }

  /**
   * Emit an agent-browser script that lands a live browser in this same state,
   * so an agent (or a person) can take over and poke at whatever the automated
   * run found. agent-browser is the project's standard interactive driver — see
   * `.claude/skills/browser-verify`.
   *
   * Deliberately reproduces NAVIGATION and FILTERING only, not the mutations: the
   * point of taking over is to explore the state the failure happened in, and
   * silently replaying writes would change the data underneath the investigation.
   */
  takeoverRecipe(): string[] {
    const url = this.page.url()
    const origin = safeOrigin(url)
    return [
      '# Verified sequence (agent-browser 0.31.1). The auth + wait steps are NOT',
      '# optional: without auth you land on /login, and without the wait the grid',
      '# has not rendered yet and every selector returns 0.',
      'export AGENT_BROWSER_IDLE_TIMEOUT_MS=60000',
      '',
      '# One-time per machine — stores credentials in agent-browser\'s auth vault,',
      '# so no secret is ever written into this briefing:',
      `#   agent-browser auth save fms-local --url "${origin}/login" --username <email> --password-stdin`,
      '',
      'agent-browser auth login fms-local',
      `agent-browser open "${url}"`,
      'agent-browser wait "td[data-row]"     # REQUIRED — grid renders after navigation',
      'agent-browser snapshot -i             # refs go stale after any change — re-snapshot',
      '',
      '# Drive it: agent-browser click @eN | fill @eN "text" | dblclick @eN | press Tab',
      '# Grid-specific reads:',
      `agent-browser eval "document.querySelectorAll('tr[data-row]').length"   # rendered rows`,
      `agent-browser eval "Array.from(document.querySelectorAll('th[data-col]')).map(h=>h.getAttribute('data-col')+':'+h.textContent.trim()).join(' | ')"`,
      `agent-browser eval "Array.from(document.querySelectorAll('td[data-save-state]')).map(c=>c.getAttribute('data-row')+','+c.getAttribute('data-col')+'='+c.getAttribute('data-save-state')).join(' ')"`,
      `agent-browser eval "Array.from(document.querySelectorAll('td[data-in-range=true]')).map(c=>c.getAttribute('data-row')+','+c.getAttribute('data-col')).join(' ')"   # current selection`,
      '',
      '# Watch what the grid asks the server to do while you poke at it:',
      'agent-browser network requests --clear',
      'agent-browser network requests --filter "/api/"',
      '',
      'agent-browser close --all',
    ]
  }

  /**
   * Write a takeover briefing to `apps/web/.ai/qa/test-results/takeover/<label>.md`
   * — the live URL, what the run did, what the grid looked like, the writes it
   * issued, and a ready-to-paste agent-browser script.
   *
   * Call it from a failure hook (see `attachTakeoverOnFailure`) to make every red
   * run immediately investigable instead of just reported.
   */
  async dumpTakeover(label: string, extra?: Record<string, unknown>): Promise<string> {
    const safe = label.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120)
    const file = resolve(process.cwd(), '.ai/qa/test-results/takeover', `${safe}.md`)
    let headers: string[] = []
    let rows = -1
    try {
      rows = await this.rowCount()
      const ths = this.root.locator('th[data-col]')
      const n = await ths.count()
      for (let i = 0; i < n; i++) {
        const th = ths.nth(i)
        headers.push(`${await th.getAttribute('data-col')}: ${((await th.textContent()) ?? '').trim()}`)
      }
    } catch {
      headers = ['(page was not readable at dump time)']
    }
    const body = [
      `# Takeover briefing — ${label}`,
      '',
      `- **URL**: ${this.page.url()}`,
      `- **Rendered rows**: ${rows}`,
      '',
      '## Columns the grid was showing',
      '',
      ...headers.map((h) => `- \`${h}\``),
      '',
      '## What the automated run did',
      '',
      ...(this.journal.length ? this.journal.map((s, i) => `${i + 1}. ${s}`) : ['_(nothing recorded)_']),
      '',
      '## Writes it issued',
      '',
      ...(this.writes.length
        ? this.writes.map((w) => `- \`${w.method} ${w.path}\``)
        : ['_(none recorded — call `startRecordingWrites()` to capture them)_']),
      '',
      ...(extra
        ? ['## Context passed by the spec', '', '```json', JSON.stringify(extra, null, 2), '```', '']
        : []),
      '## Take over in a live browser',
      '',
      '```bash',
      ...this.takeoverRecipe(),
      '```',
      '',
    ].join('\n')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body, 'utf8')
    return file
  }
}

/**
 * Wire a grid up so any failing test leaves behind a takeover briefing. Put this
 * in an `afterEach`:
 *
 *   test.afterEach(async ({}, testInfo) => {
 *     await attachTakeoverOnFailure(activeGrid, testInfo)
 *   })
 *
 * Keeps the suite fully automatic on green and hands off to an interactive driver
 * on red — which is the whole point of a semi-automatic harness.
 */
export async function attachTakeoverOnFailure(
  grid: GridHarness | null,
  testInfo: { status?: string; expectedStatus?: string; title: string; attach: (name: string, options: { path: string; contentType: string }) => Promise<void> },
): Promise<void> {
  if (!grid) return
  if (testInfo.status === testInfo.expectedStatus) return
  try {
    const file = await grid.dumpTakeover(testInfo.title)
    await testInfo.attach('takeover-briefing', { path: file, contentType: 'text/markdown' })
    console.log(`\n[GridHarness] takeover briefing → ${file}\n`)
  } catch (error) {
    console.log(`[GridHarness] could not write takeover briefing: ${String(error)}`)
  }
}

/**
 * Grant clipboard read/write so `copySelection()` can verify what the user would
 * actually paste elsewhere. Chromium-only; call before navigating.
 */
export async function grantClipboard(page: Page): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
}

/** Ctrl everywhere except WebKit/macOS, where the grid also accepts Meta. */
function modifier(): 'Control' | 'Meta' {
  return process.platform === 'darwin' ? 'Meta' : 'Control'
}

/** Human-readable column label for the journal — header text when we have it. */
function describeCol(col: GridColumn | string): string {
  return typeof col === 'string' ? `#${col}` : `"${col.header}"`
}

function colIndexOf(col: GridColumn | string): string {
  return typeof col === 'string' ? col : col.index
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Origin of a URL, falling back to the raw string if it will not parse. */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
