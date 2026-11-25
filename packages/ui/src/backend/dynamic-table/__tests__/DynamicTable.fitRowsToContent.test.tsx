/**
 * @jest-environment jsdom
 *
 * `fitRowsToContent` + `ColumnDef.wrap` — rows that grow to fit their content, asserted on the real grid.
 *
 * Why it exists: a customs app's items table cut goods descriptions of a thousand characters, and their translations,
 * to one line — unreadable. The product owner (25.11) asked for an opt-in flag on DynamicTable that lets a row grow to
 * its content.
 *
 * The load-bearing assertions:
 *
 *  • OFF IS A NO-OP. Without the flag a row keeps its one fixed inline height, is not measured, and no cell wraps —
 *    even on a column that says `wrap` — so not one existing table changes.
 *  • ON, ROWS STACK BY THEIR OWN HEIGHTS. A tall row pushes the next one down by exactly its height, and no row is
 *    shorter than the density's row height (a 0 px reading must not overlap the rows below).
 *  • AN OPEN EDITOR HOLDS THE ROW. The editor replaces the cell's text; the row keeps the height it was measured at
 *    until the edit ends, so typing never moves the rows below it.
 *  • A SORT CARRIES A ROW'S HEIGHT WITH IT. Heights are kept under the row's id, not its position.
 *
 * jsdom has no layout and no ResizeObserver, so a row's height is its stubbed `offsetHeight` (what the virtualiser
 * reads when it measures a row as it mounts).
 */

import * as React from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import { DENSITY_METRICS, ROW_FIT_STORAGE_PREFIX } from '../index'
import { resetDensityPreferenceStore } from '../hooks/useDensityPreference'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import type { ColumnDef } from '../types/index'

jest.mock('@freighttech/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))
const mockApiCall = apiCall as unknown as jest.Mock

const ROW = DENSITY_METRICS.dense.rowHeight // 34 — the default density's row height

const columns: ColumnDef[] = [
  { data: 'code', title: 'Code', width: 100 },
  { data: 'description', title: 'Description', width: 200, wrap: true },
  { data: 'note', title: 'Note', width: 120 },
]

const LONG = 'Steel beam for a working platform, galvanised, 1.5 m - 19 pcs. '.repeat(16) // ~1 000 characters

const makeRows = () =>
  Array.from({ length: 5 }, (_, r) => ({ id: `r${r}`, code: `C${r}`, description: r === 0 ? LONG : `short ${r}`, note: `n${r}` }))

/** The height each row's content takes, by row id — what a browser would lay out. */
let contentHeightById: Record<string, number> = {}

function Harness(props: Record<string, unknown>) {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  return React.createElement(
    I18nProvider as any,
    { locale: 'en', dict: {} },
    React.createElement(DynamicTable as any, {
      data: props.data ?? makeRows(),
      columns,
      tableRef,
      height: 400,
      ...props,
    }),
  )
}

beforeAll(() => {
  const rect = {
    width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0,
    toJSON() {},
  }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  })
  for (const [prop, value] of [
    ['clientHeight', 600],
    ['clientWidth', 1200],
    ['offsetWidth', 1200],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
  // A fitted row is as tall as its content; the content is looked up by the id the row shows.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.tagName === 'TR' && this.getAttribute('data-fit-row') === 'true') {
        const code = this.querySelector('td[data-col="0"]')?.textContent ?? ''
        const id = `r${code.replace(/^C/, '')}`
        return contentHeightById[id] ?? ROW
      }
      return 600
    },
  })
})

beforeEach(() => {
  window.localStorage.clear()
  resetDensityPreferenceStore()
  mockApiCall.mockReset()
  mockApiCall.mockResolvedValue({ ok: false })
  contentHeightById = {}
})

const rowAt = (index: number) => document.querySelector(`tbody tr[data-row="${index}"]`) as HTMLElement
const cellAt = (row: number, col: number) => rowAt(row).querySelector(`td[data-col="${col}"]`) as HTMLElement
const offsetOf = (index: number) => rowAt(index).style.transform

describe('fitRowsToContent off — the default changes nothing', () => {
  it('keeps the one fixed row height, measures nothing, and wraps no cell even on a wrap column', () => {
    contentHeightById = { r0: 220 }
    render(React.createElement(Harness))
    const first = rowAt(0)
    expect(first.style.height).toBe(`${ROW}px`)
    expect(first.style.minHeight).toBe('')
    expect(first.hasAttribute('data-index')).toBe(false)
    expect(first.hasAttribute('data-fit-row')).toBe(false)
    expect(document.querySelector('.cell-wrap')).toBeNull()
    expect(document.querySelector('.hot-container')!.hasAttribute('data-fit-rows')).toBe(false)
    expect(offsetOf(1)).toBe(`translateY(${ROW}px)`)
  })
})

describe('fitRowsToContent on — rows grow to their content', () => {
  it('stacks each row below the previous one by that row\'s measured height', () => {
    contentHeightById = { r0: 220, r1: 50 }
    render(React.createElement(Harness, { fitRowsToContent: true }))
    expect(document.querySelector('.hot-container')!.getAttribute('data-fit-rows')).toBe('true')
    const first = rowAt(0)
    expect(first.style.height).toBe('')
    expect(first.style.minHeight).toBe(`${ROW}px`)
    expect(first.getAttribute('data-index')).toBe('0')
    expect(offsetOf(0)).toBe('translateY(0px)')
    expect(offsetOf(1)).toBe('translateY(220px)')
    expect(offsetOf(2)).toBe('translateY(270px)')
    expect(offsetOf(3)).toBe(`translateY(${270 + ROW}px)`)
  })

  it('wraps only the columns that say wrap, and shows the whole text', () => {
    contentHeightById = { r0: 220 }
    render(React.createElement(Harness, { fitRowsToContent: true }))
    expect(cellAt(0, 1).classList.contains('cell-wrap')).toBe(true)
    expect(cellAt(0, 0).classList.contains('cell-wrap')).toBe(false)
    expect(cellAt(0, 2).classList.contains('cell-wrap')).toBe(false)
    expect(cellAt(0, 1).textContent).toBe(LONG)
  })

  it('keeps the measured heights after the grid re-measures (the timed re-measure, a density switch)', async () => {
    // the grid empties the virtualiser's size cache 50 ms after mount (and on a density or fullscreen switch); the
    // mounted rows must come back at their measured heights, not at the estimate (seen in Chrome: 301 px rows placed 34 px apart)
    contentHeightById = { r0: 220, r1: 50 }
    render(React.createElement(Harness, { fitRowsToContent: true }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(offsetOf(1)).toBe('translateY(220px)')
    expect(offsetOf(2)).toBe('translateY(270px)')
  })

  it('never makes a row shorter than the density row height — a 0 px reading does not overlap the next row', () => {
    contentHeightById = { r0: 0 }
    render(React.createElement(Harness, { fitRowsToContent: true }))
    expect(offsetOf(1)).toBe(`translateY(${ROW}px)`)
  })

  it('holds a row at its measured height while one of its cells has the editor open, and lets go after', () => {
    contentHeightById = { r0: 220 }
    render(React.createElement(Harness, { fitRowsToContent: true }))
    expect(rowAt(0).style.minHeight).toBe(`${ROW}px`)
    act(() => {
      fireEvent.doubleClick(cellAt(0, 1))
    })
    expect(cellAt(0, 1).getAttribute('data-cell-editing')).toBe('true')
    expect(rowAt(0).style.minHeight).toBe('220px')
    // the rows below do not move while the editor is open
    expect(offsetOf(1)).toBe('translateY(220px)')
    // another row is not held
    expect(rowAt(1).style.minHeight).toBe(`${ROW}px`)
    const editor = cellAt(0, 1).querySelector('textarea, input') as HTMLElement
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' })
    })
    expect(cellAt(0, 1).hasAttribute('data-cell-editing')).toBe(false)
    expect(rowAt(0).style.minHeight).toBe(`${ROW}px`)
  })

  it('carries a row\'s height with the row when the rows are reordered (a sort), not with its position', () => {
    contentHeightById = { r0: 220 }
    const { rerender } = render(React.createElement(Harness, { fitRowsToContent: true }))
    expect(offsetOf(1)).toBe('translateY(220px)')
    // the same rows, reversed: the tall row r0 is now last
    const reversed = makeRows().reverse()
    rerender(React.createElement(Harness, { fitRowsToContent: true, data: reversed }))
    expect(cellAt(4, 0).textContent).toBe('C0')
    // the first four rows are one row height each; the tall row starts after them
    expect(offsetOf(1)).toBe(`translateY(${ROW}px)`)
    expect(offsetOf(4)).toBe(`translateY(${4 * ROW}px)`)
  })
})

/* ── The person's switch (owner 25.11: „przełącznik w Dynamic Table, który pozwoliłby przełączać wysokość rzędów”) ── */

function openMenu(): void {
  const trigger = document.querySelector('[data-toolbar-overflow]') as HTMLElement | null
  expect(trigger).not.toBeNull()
  if (!document.querySelector('[data-toolbar-overflow-menu]')) {
    act(() => {
      fireEvent.click(trigger!)
    })
  }
}
const option = (mode: 'line' | 'fit') => document.querySelector(`[data-row-fit-option="${mode}"]`) as HTMLElement | null
function choose(mode: 'line' | 'fit'): void {
  openMenu()
  act(() => {
    fireEvent.click(option(mode)!)
  })
}
const storedMode = () =>
  Object.keys(window.localStorage)
    .filter((key) => key.startsWith(`${ROW_FIT_STORAGE_PREFIX}:`) && key.endsWith(':fit-test'))
    .map((key) => window.localStorage.getItem(key))

describe('fitRowsToContent — the switch in the table menu', () => {
  it('is offered only by a table that opts in, fitting by default', () => {
    const { unmount } = render(React.createElement(Harness, { tableId: 'fit-test' }))
    const trigger = document.querySelector('[data-toolbar-overflow]') as HTMLElement | null
    if (trigger) {
      act(() => {
        fireEvent.click(trigger)
      })
    }
    expect(option('line')).toBeNull()
    expect(option('fit')).toBeNull()
    unmount()

    render(React.createElement(Harness, { tableId: 'fit-test', fitRowsToContent: true }))
    openMenu()
    expect(option('fit')!.getAttribute('aria-checked')).toBe('true')
    expect(option('line')!.getAttribute('aria-checked')).toBe('false')
  })

  it('flips off -> on -> off and re-lays the rows out at once', async () => {
    contentHeightById = { r0: 220, r1: 50 }
    render(React.createElement(Harness, { tableId: 'fit-test', fitRowsToContent: true }))
    expect(offsetOf(1)).toBe('translateY(220px)')

    choose('line')
    expect(rowAt(0).style.height).toBe(`${ROW}px`)
    expect(rowAt(0).hasAttribute('data-fit-row')).toBe(false)
    expect(document.querySelector('.cell-wrap')).toBeNull()
    expect(document.querySelector('.hot-container')!.hasAttribute('data-fit-rows')).toBe(false)
    expect(offsetOf(1)).toBe(`translateY(${ROW}px)`)
    expect(storedMode()).toEqual(['line'])

    choose('fit')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(rowAt(0).getAttribute('data-fit-row')).toBe('true')
    expect(cellAt(0, 1).classList.contains('cell-wrap')).toBe(true)
    expect(offsetOf(1)).toBe('translateY(220px)')
    expect(offsetOf(2)).toBe('translateY(270px)')
    expect(storedMode()).toEqual(['fit'])

    choose('line')
    expect(offsetOf(1)).toBe(`translateY(${ROW}px)`)
    expect(offsetOf(2)).toBe(`translateY(${2 * ROW}px)`)
  })

  it('is remembered across a reload, per table', () => {
    contentHeightById = { r0: 220 }
    const { unmount } = render(React.createElement(Harness, { tableId: 'fit-test', fitRowsToContent: true }))
    choose('line')
    unmount()
    // a reload: the in-memory store is gone, localStorage stays
    resetDensityPreferenceStore()
    render(React.createElement(Harness, { tableId: 'fit-test', fitRowsToContent: true }))
    expect(rowAt(0).style.height).toBe(`${ROW}px`)
    expect(offsetOf(1)).toBe(`translateY(${ROW}px)`)
    openMenu()
    expect(option('line')!.getAttribute('aria-checked')).toBe('true')
  })

  it('a stored choice changes nothing on a table that does not opt in', () => {
    contentHeightById = { r0: 220 }
    window.localStorage.setItem(`${ROW_FIT_STORAGE_PREFIX}:shared:fit-test`, 'fit')
    render(React.createElement(Harness, { tableId: 'fit-test' }))
    expect(rowAt(0).style.height).toBe(`${ROW}px`)
    expect(rowAt(0).hasAttribute('data-index')).toBe(false)
    expect(document.querySelector('.cell-wrap')).toBeNull()
  })
})
