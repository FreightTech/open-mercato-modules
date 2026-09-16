import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ConfigureViewFormulas from '../components/ConfigureViewFormulas'
import type { ColumnDef } from '../types/index'
import type { FormulaColumnRef } from '../formula/types'

// The editor's job is to make a bad formula un-saveable. Everything below is a
// variant of that: the save button is the gate, and the reason is on screen.

const columns: ColumnDef[] = [
  { data: 'revenue', title: 'Revenue', type: 'numeric' },
  { data: 'cost', title: 'Cost', type: 'numeric' },
  { data: 'ref_no', title: 'Reference', type: 'text' },
]

type Props = React.ComponentProps<typeof ConfigureViewFormulas>

function renderEditor(props: Partial<Props> = {}) {
  const onFormulasChange = props.onFormulasChange ?? jest.fn()
  const onColumnVisibilityChange = props.onColumnVisibilityChange ?? jest.fn()
  const utils = render(
    <I18nProvider locale="en" dict={{}}>
      <ConfigureViewFormulas
        formulas={props.formulas ?? []}
        onFormulasChange={onFormulasChange}
        columns={props.columns ?? columns}
        visibleColumns={props.visibleColumns ?? ['revenue', 'cost']}
        hiddenColumns={props.hiddenColumns ?? ['ref_no']}
        onColumnVisibilityChange={onColumnVisibilityChange}
        sampleRow={props.sampleRow}
        canManage={props.canManage}
      />
    </I18nProvider>,
  )
  return { ...utils, onFormulasChange, onColumnVisibilityChange }
}

function openEditor() {
  fireEvent.click(screen.getByTestId('formula-add'))
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } })
}

const margin: FormulaColumnRef = {
  key: 'formula__margin',
  label: 'Margin',
  expression: 'revenue - cost',
  resultType: 'number',
}

describe('ConfigureViewFormulas — honesty about the limits', () => {
  it('always states that calculated columns cannot be sorted or filtered', () => {
    renderEditor()
    expect(
      screen.getByText(/cannot be sorted or filtered/i),
    ).toBeTruthy()
  })
})

describe('ConfigureViewFormulas — authoring', () => {
  it('saves a valid definition and switches the new column on', () => {
    const { onFormulasChange, onColumnVisibilityChange } = renderEditor()
    openEditor()
    type('formula-label', 'Margin')
    type('formula-expression', 'revenue - cost')
    fireEvent.click(screen.getByTestId('formula-save'))

    expect(onFormulasChange).toHaveBeenCalledWith([
      { key: 'formula__margin', label: 'Margin', expression: 'revenue - cost', resultType: 'number' },
    ])
    // The user just authored it, so hiding it would read as the save failing.
    expect(onColumnVisibilityChange).toHaveBeenCalledWith(
      ['revenue', 'cost', 'formula__margin'],
      ['ref_no'],
    )
  })

  it('keeps the save disabled until there is both a name and an expression', () => {
    renderEditor()
    openEditor()
    const save = screen.getByTestId('formula-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    type('formula-label', 'Margin')
    expect((screen.getByTestId('formula-save') as HTMLButtonElement).disabled).toBe(true)
    type('formula-expression', 'revenue - cost')
    expect((screen.getByTestId('formula-save') as HTMLButtonElement).disabled).toBe(false)
  })

  it('records the chosen result type', () => {
    const { onFormulasChange } = renderEditor()
    openEditor()
    type('formula-label', 'Reference upper')
    type('formula-expression', 'UPPER(ref_no)')
    fireEvent.click(screen.getByTestId('formula-type-text'))
    fireEvent.click(screen.getByTestId('formula-save'))
    expect(onFormulasChange.mock.calls[0][0][0].resultType).toBe('text')
  })

  it('inserts a field reference when its chip is clicked', () => {
    renderEditor()
    openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }))
    expect((screen.getByTestId('formula-expression') as HTMLInputElement).value).toBe('revenue')
  })
})

describe('ConfigureViewFormulas — refusal at definition time', () => {
  it('refuses an unknown column reference and names it', () => {
    renderEditor()
    openEditor()
    type('formula-label', 'Margin')
    type('formula-expression', 'revenue - profit')
    expect(screen.getByTestId('formula-errors').textContent).toContain('Unknown column: profit')
    expect((screen.getByTestId('formula-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('refuses a self-referencing formula BEFORE it can be saved', () => {
    renderEditor()
    openEditor()
    type('formula-label', 'Margin')
    type('formula-expression', 'formula__margin + 1')
    const errors = screen.getByTestId('formula-errors')
    expect(errors.querySelector('[data-formula-error="cycle"]')).toBeTruthy()
    expect(errors.textContent).toContain('refers to itself')
    expect((screen.getByTestId('formula-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('refuses a formula that closes a cycle with an existing column', () => {
    renderEditor({
      formulas: [
        { key: 'formula__other', label: 'Other', expression: 'formula__margin * 2', resultType: 'number' },
      ],
    })
    openEditor()
    type('formula-label', 'Margin')
    type('formula-expression', 'formula__other - cost')
    expect(screen.getByTestId('formula-errors').querySelector('[data-formula-error="cycle"]')).toBeTruthy()
  })

  it('refuses a type mismatch', () => {
    renderEditor()
    openEditor()
    type('formula-label', 'Bad')
    type('formula-expression', 'revenue - ref_no')
    expect(screen.getByTestId('formula-errors').textContent).toContain('Reference is not a number')
  })

  it('shows no error while the expression is still empty', () => {
    renderEditor()
    openEditor()
    type('formula-label', 'Margin')
    expect(screen.queryByTestId('formula-errors')).toBeNull()
  })
})

describe('ConfigureViewFormulas — existing columns', () => {
  it('lists them with their expression', () => {
    renderEditor({ formulas: [margin] })
    expect(screen.getByTestId('formula-row-formula__margin')).toBeTruthy()
    expect(screen.getByTestId('formula-expression-formula__margin').textContent).toBe('revenue - cost')
  })

  it('edits one in place without treating it as a cycle with its own old version', () => {
    const { onFormulasChange } = renderEditor({ formulas: [margin] })
    fireEvent.click(screen.getByLabelText('Edit'))
    type('formula-expression', 'revenue - cost - 1')
    expect(screen.queryByTestId('formula-errors')).toBeNull()
    fireEvent.click(screen.getByTestId('formula-save'))
    expect(onFormulasChange).toHaveBeenCalledWith([{ ...margin, expression: 'revenue - cost - 1' }])
  })

  it('removes one and prunes it from both visibility groups', () => {
    const { onFormulasChange, onColumnVisibilityChange } = renderEditor({
      formulas: [margin],
      visibleColumns: ['revenue', 'formula__margin'],
      hiddenColumns: ['ref_no'],
    })
    fireEvent.click(screen.getByLabelText('Remove'))
    expect(onFormulasChange).toHaveBeenCalledWith([])
    expect(onColumnVisibilityChange).toHaveBeenCalledWith(['revenue'], ['ref_no'])
  })

  it('does not offer another calculated column as a field chip', () => {
    renderEditor({
      formulas: [margin],
      columns: [...columns, { data: 'formula__margin', title: 'Margin', type: 'numeric' }],
    })
    openEditor()
    const chips = screen.getByTestId('formula-fields').querySelectorAll('button')
    expect([...chips].map((c) => c.textContent)).toEqual(['Revenue', 'Cost', 'Reference'])
  })
})

describe('ConfigureViewFormulas — live preview', () => {
  it('shows the result for the first loaded row before the view is saved', () => {
    renderEditor({ sampleRow: { revenue: 1000, cost: 620 } })
    openEditor()
    type('formula-label', 'Margin')
    type('formula-expression', 'revenue - cost')
    expect(screen.getByTestId('formula-preview').textContent).toContain('380')
  })

  it('shows no preview while the formula is invalid', () => {
    renderEditor({ sampleRow: { revenue: 1000 } })
    openEditor()
    type('formula-expression', 'revenue - nope')
    expect(screen.queryByTestId('formula-preview')).toBeNull()
  })
})

describe('ConfigureViewFormulas — authoring gate', () => {
  it('is open by default: packages/ui ships no ACL of its own', () => {
    renderEditor()
    expect(screen.getByTestId('formula-add')).toBeTruthy()
  })

  it('hides every authoring control when the host opts into a restriction', () => {
    renderEditor({ formulas: [margin], canManage: false })
    expect(screen.queryByTestId('formula-add')).toBeNull()
    expect(screen.queryByLabelText('Edit')).toBeNull()
    expect(screen.queryByLabelText('Remove')).toBeNull()
    // The columns themselves stay visible — reading a view needs no extra right.
    expect(screen.getByTestId('formula-row-formula__margin')).toBeTruthy()
  })
})
