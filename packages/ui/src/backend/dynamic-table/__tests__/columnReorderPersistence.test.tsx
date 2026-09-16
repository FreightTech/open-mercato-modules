import * as React from 'react'
import { render, act } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import { TableEvents } from '../types/index'
import type { ColumnDef } from '../types/index'
import type { PerspectiveConfig, PerspectiveSaveEvent } from '../types/perspective'
import { BASE_VIEW_PERSPECTIVE_NAME } from '../types/perspective'

/**
 * Ledger 7.11 — A HEADER DRAG MUST SURVIVE A RELOAD.
 *
 * The drag moved `visibleColumns`, which is in-memory state, so the new order
 * was gone on the next load and the only way to keep it was to reopen the
 * Configure View drawer and press Save. Column order is per-user personalization
 * (decision of 2026-08-03) and the drag IS the user's explicit act.
 *
 * What is pinned here is WHAT gets written, not that something does:
 *   • the payload is built from the SAVED row with only `columns` replaced, so
 *     an ad-hoc quick filter (A2/D6: never saved) cannot ride along;
 *   • the save is `silent`, so dragging four columns is not four toasts;
 *   • on the base tab with no saved row yet, one is minted under the reserved
 *     base-view name rather than nothing being written at all.
 */

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'amount', title: 'Amount' },
  { data: 'status', title: 'Status' },
]

const rows = [{ id: '1', client: 'Acme', amount: 100, status: 'draft' }]

function renderGrid(props: Record<string, unknown>) {
  const saves: PerspectiveSaveEvent[] = []
  const ref = React.createRef<HTMLDivElement>()
  function Harness() {
    const tableRef = React.useRef<HTMLDivElement | null>(null)
    React.useEffect(() => {
      const el = tableRef.current
      if (!el) return
      const onSave = (e: Event) => saves.push((e as CustomEvent<PerspectiveSaveEvent>).detail)
      el.addEventListener(TableEvents.PERSPECTIVE_SAVE, onSave)
      return () => el.removeEventListener(TableEvents.PERSPECTIVE_SAVE, onSave)
    }, [])
    return React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(DynamicTable as any, {
        data: rows,
        columns,
        tableRef,
        height: 400,
        ...props,
      }),
    )
  }
  const utils = render(React.createElement(Harness))
  return { ...utils, saves, ref }
}

/**
 * Drive the reorder through the same public entry point the header drag ends
 * at — the "Move left/right" menu action — so the test exercises the real
 * handler instead of a hand-rolled copy of its arithmetic. Header geometry
 * belongs in a browser test; jsdom has none.
 */
function moveColumn(container: HTMLElement, colIndex: number, direction: -1 | 1) {
  const th = container.querySelector<HTMLElement>(`th.hot-col-header[data-col="${colIndex}"]`)
  if (!th) throw new Error(`no header at ${colIndex}`)
  const kebab = th.querySelector<HTMLElement>('.hot-col-kebab')
  if (!kebab) throw new Error('no column menu trigger')
  act(() => { kebab.click() })
  const label = direction === -1 ? /move left/i : /move right/i
  const item = [...document.querySelectorAll('.hot-col-menu-item')].find((b) =>
    label.test(b.textContent ?? ''),
  ) as HTMLElement | undefined
  if (!item) throw new Error('no move action in the column menu')
  act(() => { item.click() })
}

const savedView: PerspectiveConfig = {
  id: 'view-1',
  name: 'Mine',
  columns: { visible: ['client', 'amount', 'status'], hidden: [] },
  // The saved view has NO filters; the live grid will.
  filters: [],
  sorting: [{ id: 's', field: 'client', direction: 'asc' }],
  grouping: [],
}

it('writes the new order into the active view, silently', () => {
  const { container, saves } = renderGrid({
    savedPerspectives: [savedView],
    activePerspectiveId: 'view-1',
  })

  moveColumn(container, 1, -1) // Amount → left of Client

  expect(saves).toHaveLength(1)
  expect(saves[0].silent).toBe(true)
  expect(saves[0].perspective.id).toBe('view-1')
  expect(saves[0].perspective.columns.visible).toEqual(['amount', 'client', 'status'])
  // Untouched fields come from the SAVED row, not from live grid state.
  expect(saves[0].perspective.sorting).toEqual(savedView.sorting)
})

it('mints the base-view row when the Default tab has none yet', () => {
  const { container, saves } = renderGrid({
    savedPerspectives: [],
    activePerspectiveId: null,
  })

  moveColumn(container, 0, 1) // Client → right of Amount

  expect(saves).toHaveLength(1)
  expect(saves[0].silent).toBe(true)
  expect(saves[0].perspective.isBaseView).toBe(true)
  expect(saves[0].perspective.name).toBe(BASE_VIEW_PERSPECTIVE_NAME)
  expect(saves[0].perspective.columns.visible).toEqual(['amount', 'client', 'status'])
})

it('an uncontrolled grid (no perspective host) writes nothing', () => {
  const { container, saves } = renderGrid({})
  moveColumn(container, 0, 1)
  expect(saves).toHaveLength(0)
})
