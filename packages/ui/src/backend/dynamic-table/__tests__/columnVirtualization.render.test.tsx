import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import VirtualRow from '../components/VirtualRow'
import ColumnHeaders from '../components/ColumnHeaders'
import GroupSummaryRow from '../components/GroupSummaryRow'
import FooterTotalsRow from '../components/FooterTotalsRow'
import { CellStoreContext } from '../hooks/index'
import { createCellStore } from '../store/index'
import { buildColumnWindow, computeColumnGeometry, createFullColumnWindow } from '../utils/columnWindow'
import type { ColumnWindow } from '../utils/columnWindow'
import type { ColumnDef } from '../types/index'

/**
 * COLUMN VIRTUALIZATION — what the user actually sees.
 *
 * These tests exist because the failure modes of a windowed grid are all
 * INVISIBLE to the pure window arithmetic (already covered by
 * `columnWindow.test.ts`) and all catastrophic in the DOM:
 *
 *   • a spacer that carries `data-row`/`data-col` silently retargets every
 *     write, because every pointer hit-test does `closest('td[data-row][data-col]')`
 *   • an actions-cell sentinel derived from the WINDOW length collides with a
 *     real column index in those same hit-tests
 *   • `aria-colcount` taken from the mounted subset tells a screen-reader user
 *     the table has 12 columns when it has 57 — and tells the perf harness the
 *     change LOST columns, which is the one regression the product owner
 *     explicitly forbade
 *   • a column that is unmounted must still be addressable: `data-col` stays
 *     the absolute index, never a position among rendered cells
 *
 * jsdom reports every box as 0×0 and stubs ResizeObserver, so the virtualizer
 * inside `DynamicTable` correctly FAILS OPEN there (mount everything). The
 * window is therefore built here from the pure builder and handed to the four
 * render sites directly — which is also the only way to assert that all four
 * agree, since disagreement is what makes columns visibly misalign.
 */

const columns: ColumnDef[] = Array.from({ length: 20 }, (_, i) => ({
  data: `c${i}`,
  title: `Col ${i}`,
  width: 100,
}))

const rows = Array.from({ length: 3 }, (_, r) => {
  const row: Record<string, unknown> = { id: `r${r}` }
  for (let c = 0; c < 20; c++) row[`c${c}`] = `v${r}-${c}`
  return row
})

/** A window mounting columns 5..9 plus pinned 0 and forced 18. */
function makeWindow(overrides: {
  pinnedLeft?: number[]
  pinnedRight?: number[]
  forced?: number[]
  start?: number
  end?: number
} = {}): ColumnWindow {
  const geometry = computeColumnGeometry(columns.length, () => 100, {
    leadingWidth: 0,
    trailingWidth: 0,
  })
  return buildColumnWindow({
    geometry,
    range: { startIndex: overrides.start ?? 5, endIndex: overrides.end ?? 9 },
    overscan: 0,
    pinnedLeftIndices: overrides.pinnedLeft,
    pinnedRightIndices: overrides.pinnedRight,
    forcedIndices: overrides.forced,
    getColumnKey: (i) => columns[i].data,
  })
}

function fullWindow(): ColumnWindow {
  const geometry = computeColumnGeometry(columns.length, () => 100)
  return createFullColumnWindow(geometry, { getColumnKey: (i) => columns[i].data })
}

function renderRow(columnWindow?: ColumnWindow, extra: Record<string, unknown> = {}) {
  const store = createCellStore(rows, columns)
  const result = render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(
        CellStoreContext.Provider as any,
        { value: store },
        React.createElement(
          'table',
          null,
          React.createElement(
            'tbody',
            null,
            React.createElement(VirtualRow as any, {
              rowIndex: 0,
              columns,
              virtualRow: { index: 0, start: 0, size: 32, end: 32, key: 0, lane: 0 },
              rowHeaders: false,
              leftOffsets: [],
              rightOffsets: [],
              actionsColumnWidth: 80,
              showActionsColumn: true,
              totalWidth: 2000,
              storeRevision: 0,
              onSaveNewRow: () => {},
              onCancelNewRow: () => {},
              onRowHeaderDoubleClick: () => {},
              onCellSave: () => {},
              columnWindow,
              ...extra,
            }),
          ),
        ),
      ),
    ),
  )
  return { store, ...result }
}

const dataCells = (root: ParentNode = document) =>
  Array.from(root.querySelectorAll('td.hot-cell[data-col]:not(.hot-actions-cell)'))
const spacers = (root: ParentNode = document) =>
  Array.from(root.querySelectorAll('.hot-cell-spacer, .hot-header-spacer'))

describe('VirtualRow — the mounted column set', () => {
  it('renders EVERY column when no window is supplied (today\'s behaviour, unchanged)', () => {
    renderRow(undefined)
    expect(dataCells()).toHaveLength(20)
    expect(spacers()).toHaveLength(0)
  })

  it('renders every column when the window is not virtualized (the fail-open path)', () => {
    renderRow(fullWindow())
    expect(dataCells()).toHaveLength(20)
    expect(spacers()).toHaveLength(0)
  })

  it('mounts only the window, and stands the rest in with spacers', () => {
    renderRow(makeWindow())
    const cols = dataCells().map((td) => Number(td.getAttribute('data-col')))
    expect(cols).toEqual([5, 6, 7, 8, 9])
    // Leading run 0..4 and trailing run 10..19 — one box each.
    expect(spacers()).toHaveLength(2)
  })

  it('keeps data-col as the ABSOLUTE index, so a hit-test still addresses the right column', () => {
    renderRow(makeWindow())
    const first = dataCells()[0] as HTMLElement
    // Position among rendered cells is 0; the column it stands for is 5.
    expect(first.getAttribute('data-col')).toBe('5')
    expect(first.textContent).toContain('v0-5')
  })

  it('force-mounts pinned columns wherever they sit, without double-counting their width', () => {
    renderRow(makeWindow({ pinnedLeft: [0], pinnedRight: [19] }))
    const cols = dataCells().map((td) => Number(td.getAttribute('data-col')))
    expect(cols).toEqual([0, 5, 6, 7, 8, 9, 19])
    // Interior gaps become their own spacers: 1..4 and 10..18.
    const widths = spacers().map((el) => (el as HTMLElement).style.width)
    expect(widths).toEqual(['400px', '900px'])
  })

  it('force-mounts the edited / selected column even when it is far outside the window', () => {
    renderRow(makeWindow({ forced: [18] }))
    const cols = dataCells().map((td) => Number(td.getAttribute('data-col')))
    expect(cols).toContain(18)
  })

  it('NEVER puts data-row or data-col on a spacer — a matching spacer would retarget writes', () => {
    renderRow(makeWindow())
    for (const el of spacers()) {
      expect(el.hasAttribute('data-row')).toBe(false)
      expect(el.hasAttribute('data-col')).toBe(false)
      expect(el.closest('td[data-row][data-col]')).toBeNull()
    }
  })

  it('makes spacers inert and invisible to assistive tech', () => {
    renderRow(makeWindow())
    for (const el of spacers()) {
      const style = (el as HTMLElement).style
      expect(el.getAttribute('aria-hidden')).toBe('true')
      expect(style.pointerEvents).toBe('none')
      expect(style.position).not.toBe('sticky')
      expect(style.flexShrink).toBe('0')
      expect(style.flexGrow).toBe('0')
    }
  })

  it('leaves NO background on a spacer — the row state paints it, so a highlighted row has no hole', () => {
    renderRow(makeWindow())
    for (const el of spacers()) {
      expect((el as HTMLElement).style.background).toBe('')
      expect((el as HTMLElement).style.backgroundColor).toBe('')
    }
  })

  it('keeps the actions-cell sentinel at the FULL column count, not the window length', () => {
    renderRow(makeWindow())
    const actions = document.querySelector('td.hot-actions-cell') as HTMLElement
    expect(actions.getAttribute('data-col')).toBe('20')
    // 20 is past every real index, so no pointer hit-test can confuse them.
    expect(dataCells().map((td) => td.getAttribute('data-col'))).not.toContain('20')
  })

  it('spacer widths plus mounted widths reconstruct the full table width exactly', () => {
    renderRow(makeWindow({ pinnedLeft: [0] }))
    const spacerPx = spacers().reduce(
      (sum, el) => sum + parseFloat((el as HTMLElement).style.width || '0'),
      0,
    )
    const cellPx = dataCells().reduce(
      (sum, el) => sum + parseFloat((el as HTMLElement).style.width || '0'),
      0,
    )
    expect(spacerPx + cellPx).toBe(20 * 100)
  })

  it('declares each cell\'s real position with aria-colindex, counted from the absolute index', () => {
    renderRow(makeWindow(), { rowHeaders: true })
    const first = dataCells()[0] as HTMLElement
    // column 5, 1-based, plus one for the row-header gutter.
    expect(first.getAttribute('aria-colindex')).toBe('7')
  })
})

describe('ColumnHeaders — same window, same boundaries', () => {
  function renderHeaders(columnWindow?: ColumnWindow) {
    const store = createCellStore(rows, columns)
    return render(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(
          CellStoreContext.Provider as any,
          { value: store },
          React.createElement(ColumnHeaders as any, {
            columns,
            rowHeaders: false,
            leftOffsets: [],
            rightOffsets: [],
            totalWidth: 2000,
            sortState: { columnIndex: null, direction: null },
            actionsColumnWidth: 80,
            showActionsColumn: true,
            onSort: () => {},
            onResizeStart: () => {},
            onDoubleClick: () => {},
            onMouseDown: () => {},
            onMouseMove: () => {},
            columnWindow,
          }),
        ),
      ),
    )
  }

  it('renders every header when unvirtualized', () => {
    renderHeaders(undefined)
    expect(document.querySelectorAll('th.hot-col-header[data-col]')).toHaveLength(20)
  })

  it('mounts the SAME columns the body row does, with matching spacer widths', () => {
    const win = makeWindow({ pinnedLeft: [0] })
    const { container: headerRoot } = renderHeaders(win)
    const headerCols = Array.from(
      headerRoot.querySelectorAll('th.hot-col-header[data-col]'),
    ).map((th) => Number(th.getAttribute('data-col')))
    const headerSpacerWidths = Array.from(
      headerRoot.querySelectorAll('.hot-header-spacer'),
    ).map((el) => (el as HTMLElement).style.width)

    document.body.innerHTML = ''
    const { container: rowRoot } = renderRow(win)
    const rowCols = Array.from(
      rowRoot.querySelectorAll('td.hot-cell[data-col]:not(.hot-actions-cell)'),
    ).map((td) => Number(td.getAttribute('data-col')))
    const rowSpacerWidths = Array.from(rowRoot.querySelectorAll('.hot-cell-spacer')).map(
      (el) => (el as HTMLElement).style.width,
    )

    expect(headerCols).toEqual(rowCols)
    expect(headerSpacerWidths).toEqual(rowSpacerWidths)
  })

  it('keeps the resize handle on every mounted header (Defect 6 must stay measurable)', () => {
    renderHeaders(makeWindow())
    expect(document.querySelectorAll('.hot-col-resize-handle')).toHaveLength(5)
  })

  it('marks header spacers aria-hidden and gives them no data-col', () => {
    renderHeaders(makeWindow())
    for (const el of document.querySelectorAll('.hot-header-spacer')) {
      expect(el.getAttribute('aria-hidden')).toBe('true')
      expect(el.hasAttribute('data-col')).toBe(false)
    }
  })
})

describe('the editing channel — what makes scroll-into-view reachable from EVERY call site', () => {
  /**
   * `setEditingCell` bumps only the two affected cells' revisions, so a
   * selection subscriber cannot see the editor move. Without a channel of its
   * own, the grid would have to patch every `setEditingCell` call site by hand
   * (keyboard nav, Tab, double-click, add-row, the context menu, and anything a
   * consumer calls directly) and a future one would be missed. Widening
   * `setEditingCell` to bump the SELECTION revision instead was rejected: it
   * would re-render every mounted row on every edit start.
   */
  it('fires when the editor opens, moves and closes — and not otherwise', () => {
    const store = createCellStore(rows, columns)
    const seen: (string | null)[] = []
    const off = store.subscribeToEditing(() => {
      const e = store.getEditingCell()
      seen.push(e ? `${e.row}:${e.col}` : null)
    })

    store.setEditingCell(0, 17)
    store.setEditingCell(0, 17) // same cell — nothing moved
    store.setEditingCell(1, 3)
    store.clearEditing()
    store.clearEditing() // already closed

    expect(seen).toEqual(['0:17', '1:3', null])
    off()
    store.setEditingCell(0, 0)
    expect(seen).toHaveLength(3)
  })

  it('does NOT fire on a plain selection move — the two channels stay separate', () => {
    const store = createCellStore(rows, columns)
    let calls = 0
    store.subscribeToEditing(() => { calls += 1 })
    store.setSelection({
      type: 'range',
      anchor: { row: 0, col: 9 },
      focus: { row: 0, col: 9 },
    })
    expect(calls).toBe(0)
  })
})

describe('GroupSummaryRow / FooterTotalsRow — the other two render sites', () => {
  it('a group subtotal row windows exactly like a data row', () => {
    const store = createCellStore(rows, columns)
    render(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(
          CellStoreContext.Provider as any,
          { value: store },
          React.createElement(
            'table',
            null,
            React.createElement(
              'tbody',
              null,
              React.createElement(GroupSummaryRow as any, {
                visualRow: {
                  type: 'groupSummary',
                  groupKey: 'g',
                  depth: 0,
                  scope: 'page',
                  rowsCovered: 3,
                  values: { c6: 42 },
                  fns: { c6: 'sum' },
                },
                virtualItem: { index: 0, start: 0, size: 32, end: 32, key: 0, lane: 0 },
                columns,
                rowHeaders: false,
                leftOffsets: [],
                rightOffsets: [],
                actionsColumnWidth: 80,
                totalWidth: 2000,
                aggregations: [{ id: 'a', field: 'c6', fn: 'sum' }],
                label: 'Sum',
                locale: 'en',
                storeRevision: 0,
                columnWindow: makeWindow(),
              }),
            ),
          ),
        ),
      ),
    )
    const cells = Array.from(document.querySelectorAll('[data-group-summary-cell]'))
    expect(cells.map((c) => c.getAttribute('data-group-summary-cell'))).toEqual([
      'c5', 'c6', 'c7', 'c8', 'c9',
    ])
    // The aggregated column is inside the window, so its value must be there.
    expect(document.querySelector('[data-group-summary-cell="c6"]')!.textContent).toContain('42')
    expect(document.querySelectorAll('.hot-cell-spacer')).toHaveLength(2)
  })

  it('the pinned totals row windows too, so the totals stay under their columns', () => {
    render(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(FooterTotalsRow as any, {
          columns,
          aggregations: [{ id: 'a', field: 'c6', fn: 'sum' }],
          pageValues: { c6: 42 },
          pageRowCount: 3,
          getColumnWidth: () => 100,
          actionsColumnWidth: 80,
          totalWidth: 2000,
          locale: 'en',
          columnWindow: makeWindow(),
        }),
      ),
    )
    const cells = Array.from(document.querySelectorAll('[data-footer-cell]'))
    expect(cells.map((c) => c.getAttribute('data-footer-cell'))).toEqual([
      'c5', 'c6', 'c7', 'c8', 'c9',
    ])
    expect(document.querySelector('[data-footer-cell="c6"]')!.textContent).toContain('42')
  })
})
