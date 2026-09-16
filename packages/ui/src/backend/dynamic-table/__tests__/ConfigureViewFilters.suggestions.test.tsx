import * as React from 'react'
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ConfigureViewFilters from '../components/ConfigureViewFilters'
import type { ColumnDef, FilterRow } from '../types/index'

/**
 * A7 — "the Assignee filter is a text box that never matches".
 *
 * `ConfigureViewFilters` declared `loadFilterSuggestions`, destructured it and
 * never called it. Eight module lists shipped a suggestion endpoint that
 * nothing ever hit. These tests are written from that symptom: the user opens
 * a filter on a relation column and expects to CHOOSE a value.
 */

const columns: ColumnDef[] = [
  { data: 'assigneeName', title: 'Assignee' },
  { data: 'status', title: 'Status', type: 'dropdown', source: ['draft', 'sent'] },
]

function renderFilters(filters: FilterRow[], loadFilterSuggestions?: jest.Mock) {
  const onFiltersChange = jest.fn()
  render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(ConfigureViewFilters, {
        columns,
        filters,
        onFiltersChange,
        loadFilterSuggestions: loadFilterSuggestions as any,
      }),
    ),
  )
  return { onFiltersChange }
}

const textFilter: FilterRow = {
  id: 'f1',
  field: 'assigneeName',
  operator: 'contains',
  values: [],
}

const anyOfFilter: FilterRow = {
  id: 'f2',
  field: 'assigneeName',
  operator: 'is_any_of',
  values: [],
}

const input = () => document.querySelector('input.hot-config-filter-input') as HTMLInputElement
const options = () =>
  Array.from(document.querySelectorAll('.hot-filter-suggestions [role="option"]')) as HTMLElement[]
const note = () =>
  document.querySelector('.hot-filter-suggestions [data-suggestions-state]') as HTMLElement | null

describe('ConfigureViewFilters — server-backed value picker', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('CALLS the host loader when the value box is focused — the defect was that it never did', async () => {
    const load = jest.fn().mockResolvedValue(['Anna Kowalska', 'Marek Nowak'])
    renderFilters([textFilter], load)

    fireEvent.focus(input())
    await act(async () => {
      jest.advanceTimersByTime(250)
    })

    expect(load).toHaveBeenCalledWith('assigneeName', '')
    await waitFor(() => expect(options().map((o) => o.textContent)).toEqual([
      'Anna Kowalska',
      'Marek Nowak',
    ]))
  })

  it('sends the typed needle to the SERVER rather than filtering a cached page', async () => {
    // A cached first page silently hides every value past the server's cap.
    const load = jest.fn().mockResolvedValue(['Marek Nowak'])
    renderFilters([textFilter], load)

    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: 'mar' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
    })

    expect(load).toHaveBeenLastCalledWith('assigneeName', 'mar')
  })

  it('commits the picked value as BOTH the label and the stored value', async () => {
    const load = jest.fn().mockResolvedValue(['Anna Kowalska'])
    const { onFiltersChange } = renderFilters([textFilter], load)

    fireEvent.focus(input())
    await act(async () => {
      jest.advanceTimersByTime(250)
    })
    await waitFor(() => expect(options()).toHaveLength(1))
    fireEvent.click(options()[0])

    expect(onFiltersChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'f1', values: ['Anna Kowalska'] }),
    ])
  })

  it('renders the picker for the multi-value operators too — "show only mine" is is_any_of', async () => {
    const load = jest.fn().mockResolvedValue(['Anna Kowalska'])
    const { onFiltersChange } = renderFilters([anyOfFilter], load)

    fireEvent.focus(input())
    await act(async () => {
      jest.advanceTimersByTime(250)
    })
    await waitFor(() => expect(options()).toHaveLength(1))
    fireEvent.click(options()[0])

    expect(onFiltersChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'f2', values: ['Anna Kowalska'] }),
    ])
  })

  it('tells loading and empty apart — a silently blank dropdown is what hid this for months', async () => {
    let resolve!: (v: string[]) => void
    const load = jest.fn().mockImplementation(() => new Promise<string[]>((r) => { resolve = r }))
    renderFilters([textFilter], load)

    fireEvent.focus(input())
    await act(async () => {
      jest.advanceTimersByTime(250)
    })
    expect(note()?.getAttribute('data-suggestions-state')).toBe('loading')

    await act(async () => {
      resolve([])
    })
    await waitFor(() => expect(note()?.getAttribute('data-suggestions-state')).toBe('empty'))
  })

  it('leaves the free-text input usable when the loader rejects', async () => {
    const load = jest.fn().mockRejectedValue(new Error('502'))
    const { onFiltersChange } = renderFilters([textFilter], load)

    fireEvent.focus(input())
    await act(async () => {
      jest.advanceTimersByTime(250)
    })
    await waitFor(() => expect(note()?.getAttribute('data-suggestions-state')).toBe('error'))

    // Filtering must never be blocked by a broken suggestion endpoint.
    fireEvent.change(input(), { target: { value: 'kowalska' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onFiltersChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'f1', values: ['kowalska'] }),
    ])
  })

  it('does not fetch for a column that carries a static source — that enum is authoritative', async () => {
    const load = jest.fn().mockResolvedValue([])
    renderFilters(
      [{ id: 'f3', field: 'status', operator: 'is_any_of', values: [] }],
      load,
    )
    await act(async () => {
      jest.advanceTimersByTime(250)
    })
    expect(load).not.toHaveBeenCalled()
    // …and the user gets the option picker, not a text box.
    expect(document.querySelector('input.hot-config-filter-input')).toBeNull()
  })
})
