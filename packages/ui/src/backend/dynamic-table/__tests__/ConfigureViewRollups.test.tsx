import * as React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ConfigureViewRollups from '../components/ConfigureViewRollups'
import type { RollupColumnRef, RollupSourceOption } from '../types/rollup'

/**
 * The real `fms-files` registry, as the sources endpoint returns it. It is the
 * interesting shape on purpose: one source multiplies 3 fields × up to 4
 * functions (ten aggregates in total), the other is count-only.
 */
const SOURCES: RollupSourceOption[] = [
  {
    key: 'lines',
    label: 'Cost lines',
    countLabel: 'Lines',
    sortable: true,
    filterable: true,
    aggregatable: true,
    fields: [
      { key: 'estimated_cost', label: 'Estimated cost', type: 'numeric', fns: ['sum', 'avg', 'min', 'max'] },
      { key: 'actual_cost', label: 'Actual cost', type: 'numeric', fns: ['sum', 'avg', 'min', 'max'] },
      { key: 'sold_amount', label: 'Sold', type: 'numeric', fns: ['sum'] },
    ],
  },
  {
    key: 'documents',
    label: 'Documents',
    countLabel: 'Documents',
    sortable: true,
    filterable: true,
    aggregatable: true,
    fields: [],
  },
]

type Harness = {
  onRollupColumnsChange: jest.Mock
  onColumnVisibilityChange: jest.Mock
}

async function renderPicker(
  rollupColumns: RollupColumnRef[],
  opts: { visible?: string[]; hidden?: string[]; sources?: RollupSourceOption[] } = {},
): Promise<Harness> {
  const onRollupColumnsChange = jest.fn()
  const onColumnVisibilityChange = jest.fn()
  const loadRollupSources = jest.fn().mockResolvedValue(opts.sources ?? SOURCES)
  render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(ConfigureViewRollups, {
        rollupColumns,
        onRollupColumnsChange,
        loadRollupSources,
        visibleColumns: opts.visible ?? ['id', 'referenceNumber'],
        hiddenColumns: opts.hidden ?? [],
        onColumnVisibilityChange,
      }),
    ),
  )
  // The section loads its sources lazily; wait for the spinner text to clear
  // rather than for the editor, so the empty state is testable through the same
  // harness.
  await waitFor(() => expect(document.body.textContent).not.toContain('Loading…'))
  return { onRollupColumnsChange, onColumnVisibilityChange }
}

const q = <T extends Element>(sel: string) => document.querySelector(sel) as T

function openMenu(sel: string) {
  fireEvent.click(q<HTMLButtonElement>(sel))
}

function menuOptions(sel: string): string[] {
  openMenu(sel)
  return Array.from(document.querySelectorAll('.hot-select-menu [role="option"]')).map((el) =>
    (el.textContent ?? '').trim(),
  )
}

function chooseOption(sel: string, label: string) {
  openMenu(sel)
  const option = Array.from(document.querySelectorAll('.hot-select-menu [role="option"]')).find(
    (el) => (el.textContent ?? '').trim() === label,
  )
  if (!option) throw new Error(`No option "${label}" in ${sel}`)
  fireEvent.click(option)
}

const COUNT: RollupColumnRef = {
  source: 'lines',
  field: 'id',
  fn: 'count',
  label: 'Cost lines · Lines',
}

describe('ConfigureViewRollups — the three-step picker', () => {
  it('shows nothing to configure when the table has no rollup sources', async () => {
    await renderPicker([], { sources: [] })
    expect(document.body.textContent).toContain('Nothing on this table can be summarised yet')
    expect(document.querySelector('[data-rollup-add]')).toBeNull()
  })

  it('adds ONE column, not the whole cross-product', async () => {
    // The reason this picker exists: `lines` alone is ten aggregates. Clicking
    // "Add" must not dump ten columns into the field list.
    const { onRollupColumnsChange, onColumnVisibilityChange } = await renderPicker([])
    fireEvent.click(q<HTMLButtonElement>('[data-rollup-add]'))
    expect(onRollupColumnsChange).toHaveBeenCalledTimes(1)
    const next = onRollupColumnsChange.mock.calls[0][0]
    expect(next).toHaveLength(1)
    expect(next[0]).toEqual(COUNT)
    // …and the user sees it immediately — they named this exact aggregate.
    expect(onColumnVisibilityChange).toHaveBeenCalledWith(
      ['id', 'referenceNumber', 'rollup__lines__id__count'],
      [],
    )
  })

  it('never adds the same aggregate twice — Add moves on to the next one', async () => {
    const { onRollupColumnsChange } = await renderPicker([COUNT])
    fireEvent.click(q<HTMLButtonElement>('[data-rollup-add]'))
    const next = onRollupColumnsChange.mock.calls[0][0]
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ source: 'lines', field: 'estimated_cost', fn: 'sum' })
  })

  it('offers the record count plus each aggregatable field, and only legal functions', async () => {
    await renderPicker([COUNT])
    expect(menuOptions('[data-rollup-field]')).toEqual([
      'Number of records',
      'Estimated cost',
      'Actual cost',
      'Sold',
    ])
    // COUNT is the only function over records — the control stays visible so
    // the row does not change shape, but there is nothing else to pick.
    expect(q<HTMLButtonElement>('[data-rollup-fn]').disabled).toBe(true)
  })

  it('snaps the function to a legal one when the field changes', async () => {
    const { onRollupColumnsChange, onColumnVisibilityChange } = await renderPicker([COUNT], {
      visible: ['id', 'rollup__lines__id__count'],
    })
    chooseOption('[data-rollup-field]', 'Estimated cost')
    const [next] = onRollupColumnsChange.mock.calls[0]
    expect(next[0]).toMatchObject({ field: 'estimated_cost', fn: 'sum' })
    // The label follows, so the header says what the column now is.
    expect(next[0].label).toBe('Cost lines · Sum of Estimated cost')
    // The column keeps its POSITION — it must not jump to the end because the
    // user changed the function on a column they already placed.
    expect(onColumnVisibilityChange).toHaveBeenCalledWith(
      ['id', 'rollup__lines__estimated_cost__sum'],
      [],
    )
  })

  it('resets to the count when the source changes, because fields do not carry over', async () => {
    const sum: RollupColumnRef = {
      source: 'lines',
      field: 'estimated_cost',
      fn: 'sum',
      label: 'Cost lines · Sum of Estimated cost',
    }
    const { onRollupColumnsChange } = await renderPicker([sum])
    chooseOption('[data-rollup-source]', 'Documents')
    const [next] = onRollupColumnsChange.mock.calls[0]
    expect(next[0]).toMatchObject({ source: 'documents', field: 'id', fn: 'count' })
    // "Documents · Documents" would read as a stutter.
    expect(next[0].label).toBe('Documents')
  })

  it('refuses a change that would duplicate a column already in the view', async () => {
    const sum: RollupColumnRef = {
      source: 'lines',
      field: 'estimated_cost',
      fn: 'sum',
      label: 'Cost lines · Sum of Estimated cost',
    }
    const { onRollupColumnsChange } = await renderPicker([COUNT, sum])
    // Row 2 → "Number of records" would collide with row 1.
    const fieldTriggers = document.querySelectorAll('[data-rollup-field]')
    fireEvent.click(fieldTriggers[1])
    const option = Array.from(document.querySelectorAll('.hot-select-menu [role="option"]')).find(
      (el) => (el.textContent ?? '').trim() === 'Number of records',
    )!
    fireEvent.click(option)
    expect(onRollupColumnsChange).not.toHaveBeenCalled()
  })

  it('removing a column also takes it out of the grid', async () => {
    const { onRollupColumnsChange, onColumnVisibilityChange } = await renderPicker([COUNT], {
      visible: ['id', 'rollup__lines__id__count'],
    })
    fireEvent.click(q<HTMLButtonElement>('.hot-config-filter-remove'))
    expect(onRollupColumnsChange).toHaveBeenCalledWith([])
    expect(onColumnVisibilityChange).toHaveBeenCalledWith(['id'], [])
  })

  it('clear all empties both the refs and the grid', async () => {
    const { onRollupColumnsChange, onColumnVisibilityChange } = await renderPicker([COUNT], {
      visible: ['id', 'rollup__lines__id__count'],
    })
    fireEvent.click(q<HTMLButtonElement>('.hot-config-clear-btn'))
    expect(onRollupColumnsChange).toHaveBeenCalledWith([])
    expect(onColumnVisibilityChange).toHaveBeenCalledWith(['id'], [])
  })

  it('disables Add once every aggregate the table offers is in the view', async () => {
    const all: RollupColumnRef[] = [
      COUNT,
      ...['estimated_cost', 'actual_cost'].flatMap((field) =>
        (['sum', 'avg', 'min', 'max'] as const).map((fn) => ({
          source: 'lines',
          field,
          fn,
          label: `${field} ${fn}`,
        })),
      ),
      { source: 'lines', field: 'sold_amount', fn: 'sum', label: 'Sold' },
      { source: 'documents', field: 'id', fn: 'count', label: 'Documents' },
    ]
    await renderPicker(all)
    expect(q<HTMLButtonElement>('[data-rollup-add]').disabled).toBe(true)
  })
})
