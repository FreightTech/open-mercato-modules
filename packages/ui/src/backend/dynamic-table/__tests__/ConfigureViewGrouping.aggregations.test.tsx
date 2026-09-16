import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ConfigureViewGrouping from '../components/ConfigureViewGrouping'
import type { ColumnDef } from '../types/index'
import type { AggregationRule, GroupRule } from '../types/grouping'

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'grossAmount', title: 'Gross', type: 'numeric' },
  { data: 'issuedAt', title: 'Issued', type: 'date' },
]

const groupRules: GroupRule[] = [{ id: 'g1', field: 'client', direction: 'asc' }]

function renderPicker(aggregations: AggregationRule[]) {
  const onAggregationsChange = jest.fn()
  render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(ConfigureViewGrouping, {
        columns,
        groupRules,
        onGroupRulesChange: jest.fn(),
        aggregations,
        onAggregationsChange,
      }),
    ),
  )
  return { onAggregationsChange }
}

// The drawer's dropdowns are portal-rendered `SelectMenu`s (house rule: no
// native `<select>` anywhere in this product). Reading one is: click the
// trigger, then read the options off document.body. With an empty dict every
// label falls back to the function key, so labels ARE the values here.
const fnTrigger = (field: string) =>
  document.querySelector(`[data-agg-fn-select="${field}"]`) as HTMLButtonElement

const menuOptions = () =>
  Array.from(document.querySelectorAll('.hot-select-menu [role="option"]')) as HTMLElement[]

const optionValues = (trigger: HTMLElement) => {
  fireEvent.click(trigger)
  return menuOptions().map((el) => (el.textContent ?? '').trim())
}

const chooseOption = (trigger: HTMLElement, label: string) => {
  fireEvent.click(trigger)
  const option = menuOptions().find((el) => (el.textContent ?? '').trim() === label)
  if (!option) throw new Error(`No option "${label}"`)
  fireEvent.click(option)
}

describe('ConfigureViewGrouping — aggregation function picker', () => {
  it('offers every function on a numeric column', () => {
    renderPicker([{ id: 'agg-grossAmount', field: 'grossAmount', fn: 'sum' }])
    expect(optionValues(fnTrigger('grossAmount'))).toEqual([
      'sum',
      'avg',
      'min',
      'max',
      'count',
      'countDistinct',
    ])
  })

  it('offers only the meaningful functions on a date column (earliest / latest / counts)', () => {
    renderPicker([{ id: 'agg-issuedAt', field: 'issuedAt', fn: 'min' }])
    expect(optionValues(fnTrigger('issuedAt'))).toEqual(['min', 'max', 'count', 'countDistinct'])
  })

  it('offers only counts on a text column — SUM of a name is meaningless', () => {
    renderPicker([{ id: 'agg-client', field: 'client', fn: 'count' }])
    expect(optionValues(fnTrigger('client'))).toEqual(['count', 'countDistinct'])
  })

  it('changing the function emits the new rule', () => {
    const { onAggregationsChange } = renderPicker([
      { id: 'agg-grossAmount', field: 'grossAmount', fn: 'sum' },
    ])
    chooseOption(fnTrigger('grossAmount'), 'avg')
    expect(onAggregationsChange).toHaveBeenCalledWith([
      { id: 'agg-grossAmount', field: 'grossAmount', fn: 'avg' },
    ])
  })

  it('snaps the function when the rule is moved onto a column that cannot support it', () => {
    const { onAggregationsChange } = renderPicker([
      { id: 'agg-grossAmount', field: 'grossAmount', fn: 'sum' },
    ])
    const fieldTrigger = document.querySelectorAll(
      '.hot-config-aggregations .hot-config-sort-select',
    )[0] as HTMLElement
    chooseOption(fieldTrigger, 'Client')
    expect(onAggregationsChange).toHaveBeenCalledWith([
      { id: 'agg-client', field: 'client', fn: 'count' },
    ])
  })

  it('non-numeric columns can now be aggregated at all (count/countDistinct)', () => {
    const { onAggregationsChange } = renderPicker([])
    const addBtn = Array.from(document.querySelectorAll('.hot-config-aggregations button')).pop()!
    fireEvent.click(addBtn)
    expect(onAggregationsChange).toHaveBeenCalledWith([
      { id: 'agg-client', field: 'client', fn: 'count' },
    ])
  })
})

describe('ConfigureViewGrouping — the aggregation editor stays gated on grouping', () => {
  // Ungating this for an ungrouped footer total (TC-APP-420) is a deferred
  // product decision. Pinning it so the gate is not removed by accident.
  it('is hidden when there is no group rule', () => {
    render(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(ConfigureViewGrouping, {
          columns,
          groupRules: [],
          onGroupRulesChange: jest.fn(),
          aggregations: [],
          onAggregationsChange: jest.fn(),
        }),
      ),
    )
    expect(document.querySelector('.hot-config-aggregations')).toBeNull()
  })
})
