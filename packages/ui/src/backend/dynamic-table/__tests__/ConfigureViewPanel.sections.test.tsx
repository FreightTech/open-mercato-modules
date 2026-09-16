import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ConfigureViewPanel from '../components/ConfigureViewPanel'
import type { ColumnDef } from '../types/index'

/**
 * The Configure View drawer is the only route a user has to the highlighting
 * and calculated-column editors. Both were built and left unreferenced, so
 * these assert that the drawer OFFERS them, and that saving a view carries
 * what they produced.
 */

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'amount', title: 'Amount', type: 'numeric' },
]

const noop = () => {}

function renderPanel(props: Record<string, unknown> = {}) {
  const onSavePerspective = jest.fn()
  render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(ConfigureViewPanel as any, {
        isOpen: true,
        onOpenChange: noop,
        columns,
        visibleColumns: ['client', 'amount'],
        hiddenColumns: [],
        filters: [],
        sortRules: [],
        onColumnVisibilityChange: noop,
        onFiltersChange: noop,
        onSortRulesChange: noop,
        onSavePerspective,
        ...props,
      }),
    ),
  )
  return { onSavePerspective }
}

const sectionTitles = () =>
  Array.from(document.querySelectorAll('.hot-config-section-title')).map((el) => el.textContent)

function openSection(title: string) {
  const header = Array.from(document.querySelectorAll('.hot-config-section-header')).find((el) =>
    (el.textContent ?? '').includes(title),
  ) as HTMLElement | undefined
  if (!header) throw new Error(`No "${title}" section in the drawer`)
  fireEvent.click(header)
}

describe('ConfigureViewPanel — sections the wave-1 editors need', () => {
  it('offers Highlighting once the host can persist the rules', () => {
    renderPanel({ onConditionalFormatsChange: noop })
    expect(sectionTitles()).toContain('Highlighting')
    openSection('Highlighting')
    expect(document.querySelector('[data-conditional-format-editor]')).toBeTruthy()
  })

  it('offers Calculated columns once the host can persist them', () => {
    renderPanel({ onFormulasChange: noop })
    expect(sectionTitles()).toContain('Calculated columns')
    openSection('Calculated columns')
    expect(document.querySelector('[data-testid="formula-section"]')).toBeTruthy()
  })

  it('hides both when the host wires neither — no dead section headers', () => {
    renderPanel()
    expect(sectionTitles()).not.toContain('Highlighting')
    expect(sectionTitles()).not.toContain('Calculated columns')
  })

  it('badges each section with how much is configured', () => {
    renderPanel({
      onConditionalFormatsChange: noop,
      onFormulasChange: noop,
      conditionalFormats: [
        { id: 'cf-1', field: 'client', operator: 'isEmpty', style: 'red' },
        { id: 'cf-2', field: 'client', operator: 'isNotEmpty', style: 'green' },
      ],
      formulas: [
        { key: 'formula__x', label: 'X', expression: 'amount * 2', resultType: 'number' },
      ],
    })
    const badges = Array.from(document.querySelectorAll('.hot-config-section-badge')).map(
      (el) => el.textContent,
    )
    // Bare count: '2 rules' rendered '1 rules' at count 1, and this i18n layer
    // has no plural forms. Every section badge is now just the number.
    expect(badges).toContain('2')
    expect(badges).toContain('1')
  })

  it('carries highlighting and calculated columns into the saved view', () => {
    const rules = [{ id: 'cf-1', field: 'client', operator: 'isEmpty', style: 'red' }]
    const formulas = [
      { key: 'formula__x', label: 'X', expression: 'amount * 2', resultType: 'number' },
    ]
    const { onSavePerspective } = renderPanel({
      onConditionalFormatsChange: noop,
      onFormulasChange: noop,
      conditionalFormats: rules,
      formulas,
    })

    const nameInput = document.querySelector('.hot-config-panel-save input') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'My view' } })
    // The primary button now NAMES the outcome: with a typed name and no view
    // being edited, saving creates a new view.
    const saveBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save as new view',
    )!
    fireEvent.click(saveBtn)

    expect(onSavePerspective).toHaveBeenCalledTimes(1)
    const saved = onSavePerspective.mock.calls[0][0]
    expect(saved.conditionalFormats).toEqual(rules)
    expect(saved.formulas).toEqual(formulas)
  })

  it('keeps calculated columns out of their own field picker, so a formula cannot reference itself', () => {
    renderPanel({
      onFormulasChange: noop,
      columns: [...columns, { data: 'formula__x', title: 'X' }],
      formulas: [
        { key: 'formula__x', label: 'X', expression: 'amount * 2', resultType: 'number' },
      ],
    })
    openSection('Calculated columns')
    // The field picker lives inside the inline add-row editor (never a modal).
    fireEvent.click(document.querySelector('[data-testid="formula-add"]') as HTMLElement)
    const fieldButtons = Array.from(
      document.querySelectorAll('[data-testid="formula-fields"] button'),
    ).map((el) => el.textContent)
    expect(fieldButtons).toEqual(['Client', 'Amount'])
  })
})
