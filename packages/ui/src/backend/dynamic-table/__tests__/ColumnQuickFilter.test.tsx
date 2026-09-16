import * as React from 'react'
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ColumnHeaders from '../components/ColumnHeaders'
import { CellStoreContext } from '../hooks/index'
import { createCellStore } from '../store/index'
import type { ColumnDef, FilterRow } from '../types/index'

/**
 * A1 — THE PER-COLUMN HEADER QUICK FILTER.
 *
 * The most-repeated request across both INF workshop sessions. Agnieszka could
 * not complete a routine live query in session — her shipments, sailed in July,
 * to Lam Chabang and Penang, Maersk only — because the only route to a filter
 * was the Configure View drawer: *"Tu musi być po prostu dosadnie filtrowanie
 * każdej kolumny osobno… nie w tym widoku, bo to jest skomplikowane."*
 *
 * These tests are written from the user's side of the glass — click the funnel,
 * search, tick, apply — and they pin the two constraints that are not features:
 *
 *   • the rule written is an `is_any_of` over the TICKED values, handed to the
 *     host's `onFiltersChange` and NOWHERE else. Nothing here persists, which
 *     is the whole of A2/D6 ("takich ustawień to byśmy mieli po tygodniu
 *     dwadzieścia"). The reload half of that guarantee is pinned in the browser
 *     journey; what is pinned here is that no save path is ever touched;
 *   • a filtered column KEEPS a visible funnel (A13 — "wolę mieć pewność, czy
 *     faktycznie ja wszystko widzę").
 */

const columns: ColumnDef[] = [
  { data: 'carrier', title: 'Carrier' },
  { data: 'pod', title: 'Port of discharge' },
  { data: 'status', title: 'Status', type: 'dropdown', source: ['draft', 'sailed', 'arrived'] },
  { data: 'etd', title: 'ETD', type: 'date' },
  { data: 'formula__margin', title: 'Margin' },
]

const rows = [
  { id: 'r1', carrier: 'Maersk', pod: 'Penang', status: 'sailed' },
  { id: 'r2', carrier: 'MSC', pod: 'Lam Chabang', status: 'draft' },
  { id: 'r3', carrier: 'Maersk', pod: 'Penang', status: 'sailed' },
]

function renderHeaders(options: {
  filters?: FilterRow[]
  loadFilterSuggestions?: jest.Mock
  onFiltersChange?: jest.Mock
} = {}) {
  const onFiltersChange = options.onFiltersChange ?? jest.fn()
  const store = createCellStore(rows, columns)
  render(
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
          totalWidth: 800,
          sortState: { columnIndex: null, direction: null },
          actionsColumnWidth: 80,
          modernLayout: true,
          onSort: () => {},
          onResizeStart: () => {},
          onDoubleClick: () => {},
          onMouseDown: () => {},
          onMouseMove: () => {},
          filters: options.filters ?? [],
          onFiltersChange,
          loadFilterSuggestions: options.loadFilterSuggestions as any,
        }),
      ),
    ),
  )
  return { onFiltersChange, store }
}

const funnels = () => Array.from(document.querySelectorAll('.hot-col-funnel')) as HTMLElement[]
const funnelFor = (field: string) =>
  document.querySelector(`th[data-col="${columns.findIndex((c) => c.data === field)}"] .hot-col-funnel`) as HTMLElement
const popover = () => document.querySelector('.hot-quick-filter') as HTMLElement | null
const searchBox = () =>
  document.querySelector('.hot-quick-filter-search input') as HTMLInputElement
const valueBoxes = () =>
  Array.from(document.querySelectorAll('[data-quick-filter-value]')) as HTMLInputElement[]
const valueBox = (value: string) =>
  document.querySelector(`[data-quick-filter-value="${value}"]`) as HTMLInputElement
const valueLabels = () =>
  Array.from(document.querySelectorAll('.hot-quick-filter-option-label')).map((n) => n.textContent)
const applyBtn = () => document.querySelector('[data-quick-filter-apply]') as HTMLButtonElement
const clearBtn = () => document.querySelector('[data-quick-filter-clear]') as HTMLButtonElement

async function openFunnel(field: string, load?: jest.Mock) {
  fireEvent.click(funnelFor(field))
  if (load) {
    await act(async () => {
      jest.advanceTimersByTime(250)
    })
  }
}

describe('A1 — the funnel in the header', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('puts a funnel on every filterable column — this is THE affordance the workshop asked for', () => {
    renderHeaders()
    // Every real column, and NOT the calculated one: a server-side `is_any_of`
    // on `formula__margin` matches nothing and would silently empty the grid.
    expect(funnels()).toHaveLength(4)
    expect(funnelFor('formula__margin')).toBeNull()
  })

  it('opens ANCHORED TO THAT HEADER, not the Configure View drawer', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk', 'MSC'])
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)

    expect(popover()).not.toBeNull()
    expect(popover()!.getAttribute('data-quick-filter')).toBe('carrier')
    // The drawer is a separate surface and must stay shut.
    expect(document.querySelector('.hot-config-panel')).toBeNull()
  })

  it('lists the module loader\'s distinct values and sends the typed needle to the SERVER', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk', 'MSC', 'CMA CGM'])
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)

    expect(load).toHaveBeenCalledWith('carrier', '')
    await waitFor(() => expect(valueLabels()).toEqual(['Maersk', 'MSC', 'CMA CGM']))

    load.mockResolvedValue(['Maersk'])
    fireEvent.change(searchBox(), { target: { value: 'mae' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
    })
    // Filtering a cached first page silently hides every value past the
    // server's cap — the needle must travel.
    expect(load).toHaveBeenLastCalledWith('carrier', 'mae')
  })

  it('writes an is_any_of rule with exactly the ticked values', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk', 'MSC'])
    const { onFiltersChange } = renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)
    await waitFor(() => expect(valueBoxes()).toHaveLength(2))

    fireEvent.click(valueBoxes()[0])
    expect(onFiltersChange).not.toHaveBeenCalled() // nothing until Apply
    fireEvent.click(applyBtn())

    expect(onFiltersChange).toHaveBeenCalledWith([
      { id: 'quick:carrier', field: 'carrier', operator: 'is_any_of', values: ['Maersk'] },
    ])
    expect(popover()).toBeNull()
  })

  it('replaces its own column\'s rule and leaves every other column\'s alone', async () => {
    const load = jest.fn().mockResolvedValue(['Penang', 'Lam Chabang'])
    const existing: FilterRow[] = [
      { id: 'quick:carrier', field: 'carrier', operator: 'is_any_of', values: ['Maersk'] },
      { id: 'quick:pod', field: 'pod', operator: 'is_any_of', values: ['Gdynia'] },
    ]
    const { onFiltersChange } = renderHeaders({ filters: existing, loadFilterSuggestions: load })
    await openFunnel('pod', load)
    await waitFor(() => expect(valueBoxes().length).toBeGreaterThan(0))

    // "Gdynia" leads the list because it arrived ticked — a value the user
    // selected must not vanish just because the server did not return it.
    expect(valueLabels()[0]).toBe('Gdynia')
    fireEvent.click(valueBox('Gdynia')) // untick
    // …and it must not MOVE either: unticking a row that then slides out from
    // under the cursor makes the next click land on the wrong value.
    expect(valueLabels()[0]).toBe('Gdynia')
    fireEvent.click(valueBox('Penang'))
    fireEvent.click(applyBtn())

    expect(onFiltersChange).toHaveBeenCalledWith([
      { id: 'quick:carrier', field: 'carrier', operator: 'is_any_of', values: ['Maersk'] },
      { id: 'quick:pod', field: 'pod', operator: 'is_any_of', values: ['Penang'] },
    ])
  })

  it('"Clear filter" DROPS the rule rather than leaving an empty one that still looks active', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk'])
    const existing: FilterRow[] = [
      { id: 'quick:carrier', field: 'carrier', operator: 'is_any_of', values: ['Maersk'] },
    ]
    const { onFiltersChange } = renderHeaders({ filters: existing, loadFilterSuggestions: load })
    await openFunnel('carrier', load)
    fireEvent.click(clearBtn())

    expect(onFiltersChange).toHaveBeenCalledWith([])
  })

  it('"Select all" acts on the SEARCHED list — "type Maersk, take them all" is the whole point', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk', 'Maersk Line'])
    const { onFiltersChange } = renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)
    await waitFor(() => expect(valueBoxes()).toHaveLength(2))

    fireEvent.click(document.querySelector('[data-quick-filter-all]') as HTMLElement)
    fireEvent.click(applyBtn())

    expect(onFiltersChange).toHaveBeenCalledWith([
      expect.objectContaining({ values: ['Maersk', 'Maersk Line'] }),
    ])
  })

  it('uses a column\'s static source instead of fetching — that enum is authoritative', async () => {
    const load = jest.fn().mockResolvedValue([])
    renderHeaders({ loadFilterSuggestions: load })
    fireEvent.click(funnelFor('status'))
    await act(async () => {
      jest.advanceTimersByTime(250)
    })

    // NB: the funnel still uses the server loader for the *field* only when the
    // column declares no options. `status` declares three.
    await waitFor(() => expect(valueLabels()).toEqual(['draft', 'sailed', 'arrived']))
  })

  it('falls back to the loaded page\'s distinct values when the module supplies no loader', async () => {
    renderHeaders() // no loadFilterSuggestions at all
    fireEvent.click(funnelFor('carrier'))

    await waitFor(() => expect(valueLabels()).toEqual(['Maersk', 'MSC']))
    // …and says so, so nobody reads a page sample as the whole dataset.
    expect(document.querySelector('.hot-quick-filter-transient')?.textContent).toContain('loaded page')
  })

  it('keeps the filter usable when the value loader is down', async () => {
    const load = jest.fn().mockRejectedValue(new Error('502'))
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)

    await waitFor(() =>
      expect(document.querySelector('.hot-quick-filter-list')?.getAttribute('data-suggestions-state')).toBe('error'),
    )
    // Loading, empty and error are three DIFFERENT strings — a silently blank
    // dropdown is what hid the missing suggestion loader for months.
    expect(document.querySelector('.hot-quick-filter-note')?.textContent).toContain('unavailable')
  })
})

/**
 * A14 — THE DATE COLUMN GETS A DATE FILTER.
 *
 * The funnel on `Utworzono` / `ETD` opened the tick list and offered "Search
 * values… / No values": every row has its own timestamp, so a distinct-value
 * loader has nothing to return and the column simply could not be filtered from
 * the header at all.
 *
 * Both halves below are load-bearing and belong to DIFFERENT users. Klaudiusz
 * works off "tomorrow"; Agnieszka refused more presets outright — *"szybciej mi
 * jest operować na zakresie dat"* — and works off an explicit range. Shipping
 * one without the other fails one of them, so both are pinned here.
 */
const operatorTrigger = () =>
  document.querySelector('[data-quick-filter-operator]') as HTMLButtonElement
const operatorOptions = () =>
  Array.from(document.querySelectorAll('.hot-select-menu-option')).map((n) => n.textContent)
const chooseOperator = (label: string) => {
  fireEvent.click(operatorTrigger())
  const option = Array.from(document.querySelectorAll('.hot-select-menu-option')).find(
    (n) => n.textContent === label,
  ) as HTMLElement
  if (!option) throw new Error(`no operator option "${label}" — got ${operatorOptions().join(' | ')}`)
  fireEvent.click(option)
}
const dateTrigger = (slot: 'from' | 'to' | 'single') =>
  document.querySelector(
    `[data-quick-filter-range="${slot}"] .hot-config-filter-date-trigger`,
  ) as HTMLButtonElement
/** Commit today through the calendar's own footer — the same route a user takes. */
const pickToday = (slot: 'from' | 'to' | 'single') => {
  fireEvent.click(dateTrigger(slot))
  fireEvent.mouseDown(document.querySelector('.hot-calendar-today-btn') as HTMLElement)
}
const todayIso = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

describe('A14 — a date column gets operators and ranges, not a value list', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('renders the DATE editor, never the "Search values… / No values" tick list', async () => {
    const load = jest.fn().mockResolvedValue([])
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('etd', load)

    expect(popover()!.getAttribute('data-quick-filter-kind')).toBe('date')
    // The reported defect, literally: a search box and an empty value list over
    // a column whose values are all distinct.
    expect(searchBox()).toBeNull()
    expect(document.querySelector('.hot-quick-filter-list')).toBeNull()
    expect(operatorTrigger()).not.toBeNull()
  })

  it('offers the now-relative presets FIRST and the explicit range with them', async () => {
    renderHeaders()
    await openFunnel('etd')
    fireEvent.click(operatorTrigger())

    const options = operatorOptions()
    // Presets lead — "due today / this week" is the most-used shape…
    expect(options.slice(0, 5)).toEqual(['today', 'tomorrow', 'this week', 'next week', 'overdue'])
    // …and the range is right behind them, because the other half of the
    // workshop refused presets and wants dates.
    expect(options[5]).toBe('is between')
  })

  it('a preset writes a VALUE-LESS rule and the rule survives — this is where it used to be dropped', async () => {
    const { onFiltersChange } = renderHeaders()
    await openFunnel('etd')
    chooseOperator('tomorrow')
    fireEvent.click(applyBtn())

    // `values: []` with a value-taking operator means "drop me"; with a preset
    // it means "there is nothing to type". Getting that wrong is exactly how a
    // filter silently returns the whole table.
    expect(onFiltersChange).toHaveBeenCalledWith([
      { id: 'quick:etd', field: 'etd', operator: 'is_tomorrow', values: [] },
    ])
  })

  it('defaults to the explicit range, and a range with neither end is NOT a filter', async () => {
    const { onFiltersChange } = renderHeaders()
    await openFunnel('etd')

    expect(operatorTrigger().textContent).toContain('is between')
    expect(dateTrigger('from')).not.toBeNull()
    expect(dateTrigger('to')).not.toBeNull()

    fireEvent.click(applyBtn())
    expect(onFiltersChange).toHaveBeenCalledWith([])
  })

  it('writes is_between as a POSITIONAL [from, to] pair — a half-open range keeps its empty slot', async () => {
    const { onFiltersChange } = renderHeaders()
    await openFunnel('etd')
    pickToday('to')
    fireEvent.click(applyBtn())

    // "everything up to today" is a legitimate filter. Compacting the values
    // would slide the date into the FROM slot and invert the meaning.
    expect(onFiltersChange).toHaveBeenCalledWith([
      { id: 'quick:etd', field: 'etd', operator: 'is_between', values: ['', todayIso()] },
    ])
  })

  it('a single-date operator gets ONE calendar', async () => {
    const { onFiltersChange } = renderHeaders()
    await openFunnel('etd')
    chooseOperator('is before')

    expect(dateTrigger('single')).not.toBeNull()
    expect(dateTrigger('from')).toBeNull()
    pickToday('single')
    fireEvent.click(applyBtn())

    expect(onFiltersChange).toHaveBeenCalledWith([
      { id: 'quick:etd', field: 'etd', operator: 'is_before', values: [todayIso()] },
    ])
  })

  it('a moving window gets count + unit, NOT a calendar — "next 7 days" is not a date', async () => {
    const { onFiltersChange } = renderHeaders()
    await openFunnel('etd')
    chooseOperator('next')

    expect(document.querySelector('.hot-calendar-popup')).toBeNull()
    expect(dateTrigger('single')).toBeNull()
    const count = document.querySelector('[data-quick-filter-count]') as HTMLInputElement
    expect(count).not.toBeNull()
    fireEvent.change(count, { target: { value: '7' } })
    fireEvent.click(applyBtn())

    expect(onFiltersChange).toHaveBeenCalledWith([
      { id: 'quick:etd', field: 'etd', operator: 'is_in_next', values: ['7', 'days'] },
    ])
  })

  it('switching operator resets the values so the editor and the stored pair never disagree', async () => {
    const { onFiltersChange } = renderHeaders()
    await openFunnel('etd')
    pickToday('to')
    chooseOperator('next')
    fireEvent.click(applyBtn())

    // A leftover ISO date in slot 0 would be read as a relative COUNT.
    expect(onFiltersChange).toHaveBeenCalledWith([])
  })

  it('reopens on the live rule instead of resetting it', async () => {
    renderHeaders({
      filters: [
        { id: 'quick:etd', field: 'etd', operator: 'is_between', values: ['2026-05-01', '2026-05-31'] },
      ],
    })
    await openFunnel('etd')

    expect(operatorTrigger().textContent).toContain('is between')
    expect(dateTrigger('from').textContent).toContain('2026')
    expect(dateTrigger('to').textContent).toContain('2026')
  })

  it('"Clear filter" drops a preset rule too', async () => {
    const { onFiltersChange } = renderHeaders({
      filters: [{ id: 'quick:etd', field: 'etd', operator: 'is_tomorrow', values: [] }],
    })
    await openFunnel('etd')
    fireEvent.click(clearBtn())

    expect(onFiltersChange).toHaveBeenCalledWith([])
  })

  it('names the CONDITION in the funnel tooltip when the rule carries no values', () => {
    renderHeaders({
      filters: [{ id: 'quick:etd', field: 'etd', operator: 'is_tomorrow', values: [] }],
    })
    // "ETD: " reads as a bug. "ETD: tomorrow" reads as the filter it is.
    expect(funnelFor('etd').getAttribute('title')).toBe('ETD: tomorrow')
    expect(funnelFor('etd').getAttribute('data-filtered')).toBe('true')
  })

  it('reads the funnel tooltip as a sentence for a range and a moving window', () => {
    renderHeaders({
      filters: [
        { id: 'quick:etd', field: 'etd', operator: 'is_between', values: ['2026-04-01', ''] },
      ],
    })
    // Not "ETD: 2026-04-01" — that hides which END of the range was filled.
    expect(funnelFor('etd').getAttribute('title')).toBe('ETD: is between 2026-04-01 – …')
  })

  it('spells out a moving window instead of leaking the stored pair', () => {
    renderHeaders({
      filters: [{ id: 'quick:etd', field: 'etd', operator: 'is_in_last', values: ['2', 'months'] }],
    })
    // The defect this replaces read "ETD: 2, months".
    expect(funnelFor('etd').getAttribute('title')).toBe('ETD: last 2 months')
  })

  it('leaves every non-date column on the tick list', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk'])
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)
    expect(popover()!.getAttribute('data-quick-filter-kind')).toBe('values')
    expect(searchBox()).not.toBeNull()
  })
})

describe('A13 — a filtered column has to LOOK filtered', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('marks the header and the funnel of every column carrying a rule', () => {
    renderHeaders({
      filters: [{ id: 'quick:carrier', field: 'carrier', operator: 'is_any_of', values: ['Maersk'] }],
    })
    const carrierTh = document.querySelector('th[data-col="0"]') as HTMLElement
    const podTh = document.querySelector('th[data-col="1"]') as HTMLElement

    expect(carrierTh.getAttribute('data-filtered')).toBe('true')
    expect(funnelFor('carrier').getAttribute('data-filtered')).toBe('true')
    expect(podTh.getAttribute('data-filtered')).toBeNull()
    expect(funnelFor('pod').getAttribute('data-filtered')).toBeNull()
  })

  it('names the active values in the funnel\'s tooltip — "am I really seeing everything?"', () => {
    renderHeaders({
      filters: [
        { id: 'quick:pod', field: 'pod', operator: 'is_any_of', values: ['Penang', 'Lam Chabang'] },
      ],
    })
    expect(funnelFor('pod').getAttribute('title')).toBe('Port of discharge: Penang, Lam Chabang')
  })

  it('marks a column filtered by a rule the Configure View drawer authored too', () => {
    // The header does not care WHERE the rule came from; the question it answers
    // is "is this column constrained", and a drawer rule constrains it just as
    // much as a funnel one.
    renderHeaders({
      filters: [{ id: 'filter-1', field: 'pod', operator: 'contains', values: ['Pen'] }],
    })
    expect(funnelFor('pod').getAttribute('data-filtered')).toBe('true')
  })
})

describe('A2/D6 — these filters are TRANSIENT and the UI says so', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('renders the transient note, not a "saved" affordance', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk'])
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)

    const note = document.querySelector('.hot-quick-filter-transient')
    expect(note?.textContent).toContain('not saved')
    // No save/persist control anywhere in this surface.
    expect(document.querySelector('.hot-quick-filter [data-save]')).toBeNull()
  })

  it('hands the rule set to the host and calls nothing else — there is no persist path to reach', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk'])
    const onFiltersChange = jest.fn()
    renderHeaders({ loadFilterSuggestions: load, onFiltersChange })
    await openFunnel('carrier', load)
    await waitFor(() => expect(valueBoxes()).toHaveLength(1))
    fireEvent.click(valueBoxes()[0])
    fireEvent.click(applyBtn())

    expect(onFiltersChange).toHaveBeenCalledTimes(1)
    // `onFiltersChange` writes DynamicTable's `useState`. Persistence happens
    // only on an explicit PERSPECTIVE_SAVE, which this surface cannot trigger.
    expect(load).not.toHaveBeenCalledWith(expect.stringContaining('save'), expect.anything())
  })
})

describe('dismissal — house rules for a portal dropdown', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('closes on Escape WITHOUT letting the grid or a surrounding drawer see it', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk'])
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)

    const seenByOthers = jest.fn()
    document.addEventListener('keydown', seenByOthers)
    fireEvent.keyDown(document, { key: 'Escape' })
    document.removeEventListener('keydown', seenByOthers)

    expect(popover()).toBeNull()
    expect(seenByOthers).not.toHaveBeenCalled()
  })

  it('closes on an outside mousedown even though the grid stops propagation', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk'])
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)

    const outside = document.createElement('div')
    outside.addEventListener('mousedown', (e) => e.stopPropagation())
    document.body.appendChild(outside)
    fireEvent.mouseDown(outside)

    expect(popover()).toBeNull()
    outside.remove()
  })

  it('TRACKS its header through a grid scroll instead of detaching or dismissing', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk', 'MSC'])
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)
    await waitFor(() => expect(valueBoxes()).toHaveLength(2))

    // Scrolling its own value list must not move or close it…
    fireEvent.scroll(document.querySelector('.hot-quick-filter-list') as HTMLElement)
    expect(popover()).not.toBeNull()

    // …and the grid scrolling horizontally underneath must reposition it, not
    // dismiss it. Closing on scroll reads the same until a stray resize (a
    // devtools overlay, a zoom, a mobile URL bar) dismisses the dropdown the
    // instant it opens — which is exactly what it did.
    fireEvent.scroll(document.body)
    fireEvent(window, new Event('resize'))
    expect(popover()).not.toBeNull()
  })

  it('closes when its header is UNMOUNTED under it (column virtualization, hide field)', async () => {
    const load = jest.fn().mockResolvedValue(['Maersk'])
    renderHeaders({ loadFilterSuggestions: load })
    await openFunnel('carrier', load)
    expect(popover()).not.toBeNull()

    // A dropdown anchored to a detached node is worse than no dropdown.
    document.querySelector('th[data-col="0"]')!.remove()
    fireEvent.scroll(document.body)
    expect(popover()).toBeNull()
  })
})
