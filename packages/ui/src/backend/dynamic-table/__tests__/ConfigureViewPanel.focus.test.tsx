import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ConfigureViewPanel from '../components/ConfigureViewPanel'
import type { ColumnDef } from '../types/index'

/**
 * Regression: the drawer must not put the caret in the VIEW NAME box on open.
 *
 * Found by driving the drawer in a browser, not by reading the code. The name
 * input carried `autoFocus`, which was harmless when this panel was only a save
 * form. It is data corruption now that the panel is a multi-section editor: the
 * first thing typed into "Calculated columns" — or any section the user has not
 * yet clicked into — was appended to the view's NAME. A real saved view came
 * out called `Koszty teczekDlugosc notatkiLEN(notes)`, silently.
 */
const columns: ColumnDef[] = [
  { data: 'reference', title: 'Reference #' },
  { data: 'client', title: 'Client' },
]

function renderPanel() {
  return render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(ConfigureViewPanel, {
        isOpen: true,
        onOpenChange: jest.fn(),
        columns,
        visibleColumns: ['reference', 'client'],
        hiddenColumns: [],
        filters: [],
        sortRules: [],
        onColumnVisibilityChange: jest.fn(),
        onFiltersChange: jest.fn(),
        onSortRulesChange: jest.fn(),
        onSavePerspective: jest.fn(),
      } as any),
    ),
  )
}

describe('ConfigureViewPanel focus', () => {
  it('does not steal the caret into the view-name box when it opens', () => {
    renderPanel()
    const name = document.querySelector(
      '.hot-config-panel-save input',
    ) as HTMLInputElement | null
    expect(name).toBeTruthy()
    expect(name).not.toHaveAttribute('autofocus')
    expect(document.activeElement).not.toBe(name)
  })
})
