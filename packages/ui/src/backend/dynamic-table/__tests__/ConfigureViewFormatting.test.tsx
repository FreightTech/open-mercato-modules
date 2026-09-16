import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ConfigureViewFormatting from '../components/ConfigureViewFormatting'
import type { ColumnDef } from '../types/index'
import { MAX_CONDITIONAL_FORMAT_RULES, type ConditionalFormatRule } from '../utils/conditionalFormat'

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'grossAmount', title: 'Gross', type: 'numeric' },
  { data: 'eta', title: 'ETA', type: 'date' },
  { data: 'ata', title: 'ATA', type: 'date' },
]

function renderEditor(rules: ConditionalFormatRule[]) {
  const onRulesChange = jest.fn()
  render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(ConfigureViewFormatting, { columns, rules, onRulesChange }),
    ),
  )
  return { onRulesChange }
}

const q = <T extends Element>(sel: string) => document.querySelector(sel) as T

// The drawer's dropdowns are portal-rendered `SelectMenu`s, not native
// `<select>`s (house rule: this product ships no native select). Driving one is
// two steps — open the trigger, click the option — and the menu lives on
// document.body, so options are found globally rather than inside the trigger.
function openMenu(triggerSelector: string) {
  fireEvent.click(q<HTMLButtonElement>(triggerSelector))
}

function menuOptionValues(triggerSelector: string): string[] {
  openMenu(triggerSelector)
  return Array.from(document.querySelectorAll('.hot-select-menu [role="option"]')).map(
    (el) => (el.textContent ?? '').trim(),
  )
}

function chooseOption(triggerSelector: string, label: string) {
  openMenu(triggerSelector)
  const option = Array.from(document.querySelectorAll('.hot-select-menu [role="option"]')).find(
    (el) => (el.textContent ?? '').trim() === label,
  )
  if (!option) throw new Error(`No option "${label}" in ${triggerSelector}`)
  fireEvent.click(option)
}

describe('ConfigureViewFormatting', () => {
  it('adds a rule on the first column with a sensible default', () => {
    const { onRulesChange } = renderEditor([])
    fireEvent.click(q<HTMLButtonElement>('[data-cf-add]'))
    expect(onRulesChange).toHaveBeenCalledTimes(1)
    const [added] = onRulesChange.mock.calls[0][0]
    expect(added).toMatchObject({ field: 'client', style: 'yellow' })
    expect(added.id).toMatch(/^cf-/)
  })

  it('removes a rule', () => {
    const { onRulesChange } = renderEditor([
      { id: 'cf-1', field: 'client', operator: 'contains', value: 'x', style: 'red' },
    ])
    fireEvent.click(q<HTMLButtonElement>('.hot-config-filter-remove'))
    expect(onRulesChange).toHaveBeenCalledWith([])
  })

  it('offers numeric comparisons on a numeric column and text ones on a text column', () => {
    renderEditor([{ id: 'cf-1', field: 'grossAmount', operator: 'gt', value: 100, style: 'red' }])
    // Labels fall back to the operator key when the dict has no entry.
    const ops = menuOptionValues('[data-cf-operator]')
    expect(ops).toContain('gte')
    expect(ops).not.toContain('contains')
  })

  it('shows a compare-column picker for the ETA-vs-ATA case and no literal input', () => {
    renderEditor([
      { id: 'cf-1', field: 'ata', operator: 'afterField', compareField: 'eta', style: 'red' },
    ])
    expect(q('[data-cf-compare-field]')).toBeTruthy()
    expect(q('[data-cf-value]')).toBeNull()
  })

  it('drops the literal when switching to a unary operator', () => {
    const { onRulesChange } = renderEditor([
      { id: 'cf-1', field: 'client', operator: 'contains', value: 'acme', style: 'red' },
    ])
    chooseOption('[data-cf-operator]', 'isEmpty')
    expect(onRulesChange.mock.calls[0][0][0]).toMatchObject({
      operator: 'isEmpty',
      value: undefined,
    })
  })

  it('defaults a compare column when switching to a relative operator', () => {
    const { onRulesChange } = renderEditor([
      { id: 'cf-1', field: 'ata', operator: 'lt', value: '2026-01-01', style: 'red' },
    ])
    chooseOption('[data-cf-operator]', 'afterField')
    const next = onRulesChange.mock.calls[0][0][0]
    expect(next.operator).toBe('afterField')
    expect(next.compareField).toBeTruthy()
    expect(next.compareField).not.toBe('ata')
  })

  it('snaps the operator when the rule moves to an incompatible column type', () => {
    const { onRulesChange } = renderEditor([
      { id: 'cf-1', field: 'client', operator: 'contains', value: 'acme', style: 'red' },
    ])
    chooseOption('[data-cf-field]', 'Gross')
    expect(onRulesChange.mock.calls[0][0][0].operator).not.toBe('contains')
  })

  it('stops adding rules at the render-path cap', () => {
    const rules: ConditionalFormatRule[] = Array.from(
      { length: MAX_CONDITIONAL_FORMAT_RULES },
      (_, i) => ({ id: `cf-${i}`, field: 'client', operator: 'isEmpty', style: 'red' }),
    )
    renderEditor(rules)
    expect(q<HTMLButtonElement>('[data-cf-add]').disabled).toBe(true)
  })
})
