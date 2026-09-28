import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  ActivityComposer,
  ActivityFeed,
  ActivityFilterChips,
  InfoGrid,
  KpiWidget,
  ProcessSteps,
  TodoList,
  WidgetCard,
  WidgetLinkProvider,
  WidgetListRow,
  formatWidgetNumber,
} from '../index'

describe('WidgetCard', () => {
  it('renders title, subtitle, menu and a footer link to the parent place', () => {
    const onMenu = jest.fn()
    render(
      <WidgetCard title="Moje teczki" subtitle="Aktywne" onMenu={onMenu} menuLabel="Opcje" footer={{ label: 'Zobacz wszystkie', href: '/backend/crm' }}>
        body
      </WidgetCard>,
    )
    expect(screen.getByRole('region', { name: 'Moje teczki' })).toBeTruthy()
    expect(screen.getByText('Aktywne')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Opcje' }))
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Zobacz wszystkie' }).getAttribute('href')).toBe('/backend/crm')
  })

  it('omits the menu button when no handler is given and uses the provided link component', () => {
    const Custom = ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
      <a data-custom="1" href={href} className={className}>
        {children}
      </a>
    )
    render(
      <WidgetLinkProvider component={Custom}>
        <WidgetCard title="T" footer={{ label: 'Wszystkie', href: '/x' }}>
          body
        </WidgetCard>
      </WidgetLinkProvider>,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('link', { name: 'Wszystkie' }).getAttribute('data-custom')).toBe('1')
  })

  it('renders the TRIGGER primary action in the footer', () => {
    const onAction = jest.fn()
    render(<WidgetCard title="T" footer={{ label: 'Wszystkie', onClick: jest.fn(), action: { label: 'Zaplanuj', onClick: onAction } }}>b</WidgetCard>)
    fireEvent.click(screen.getByRole('button', { name: 'Zaplanuj' }))
    expect(onAction).toHaveBeenCalled()
  })
})

describe('formatWidgetNumber', () => {
  it('groups four-digit numbers the way the Figma shows them', () => {
    expect(formatWidgetNumber(1284).replace(/\s/g, ' ')).toBe('1 284')
    expect(formatWidgetNumber(128400, { minimumFractionDigits: 2 }).replace(/\s/g, ' ')).toBe('128 400,00')
  })
})

describe('KpiWidget', () => {
  it('renders the progress bar clamped to 0..100', () => {
    render(<KpiWidget title="Cel" value="140%" progress={{ ratio: 1.4, label: 'Realizacja' }} />)
    expect(screen.getByRole('progressbar', { name: 'Realizacja' }).getAttribute('aria-valuenow')).toBe('100')
  })

  it('renders the comparison and a down delta', () => {
    render(
      <KpiWidget
        title="Konwersja"
        value="1 284"
        comparison={{ currentLabel: 'teraz', previous: '1 391', previousLabel: 'wcześniej' }}
        delta={{ value: '−8%', direction: 'down' }}
      />,
    )
    expect(screen.getByText('1 391')).toBeTruthy()
    expect(screen.getByText('−8%')).toBeTruthy()
  })
})

describe('WidgetListRow', () => {
  it('colours warning rows and fires the trailing action', () => {
    const onClick = jest.fn()
    render(
      <ul>
        <WidgetListRow tone="warning" title="Baltic Agro" supporting="34 dni" action={{ label: 'Zaplanuj', onClick }} />
      </ul>,
    )
    expect(screen.getByText('Baltic Agro').className).toContain('text-m3ft-warning')
    fireEvent.click(screen.getByRole('button', { name: 'Zaplanuj' }))
    expect(onClick).toHaveBeenCalled()
  })
})

describe('TodoList', () => {
  it('toggles items and adds a new one inline', async () => {
    const onToggle = jest.fn()
    const onAdd = jest.fn()
    render(
      <TodoList
        items={[{ id: 'a', title: 'Zadzwoń', due: '−3 dni', dueTone: 'overdue' }]}
        onToggle={onToggle}
        onAdd={onAdd}
        addLabel="+ Dodaj"
        addPlaceholder="Nowe zadanie"
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zadzwoń' }))
    expect(onToggle).toHaveBeenCalledWith('a', true)
    expect(screen.getByText('−3 dni').className).toContain('text-m3ft-error')
    fireEvent.click(screen.getByRole('button', { name: '+ Dodaj' }))
    const input = screen.getByRole('textbox', { name: 'Nowe zadanie' })
    fireEvent.change(input, { target: { value: '  Oferta  ' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Oferta'))
  })

  it('cancels the add row with Escape', () => {
    render(<TodoList items={[]} onAdd={jest.fn()} addLabel="+ Dodaj" addPlaceholder="Nowe" />)
    fireEvent.click(screen.getByRole('button', { name: '+ Dodaj' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('Activity', () => {
  it('groups entries under one day separator and shows the empty state', () => {
    const { rerender } = render(
      <ActivityFeed
        entries={[
          { id: '1', kind: 'note', day: 'Poniedziałek', label: 'Notatka', body: 'A' },
          { id: '2', kind: 'call', day: 'Poniedziałek', label: 'Telefon', body: 'B' },
          { id: '3', kind: 'email', day: 'Wtorek', label: 'E-mail', body: 'C', links: [{ label: 'OF-1', href: '/o/1' }] },
        ]}
      />,
    )
    expect(screen.getAllByText('Poniedziałek')).toHaveLength(1)
    expect(screen.getByText('Wtorek')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'OF-1' }).getAttribute('href')).toBe('/o/1')
    rerender(<ActivityFeed entries={[]} empty={{ title: 'Brak aktywności' }} />)
    expect(screen.getByText('Brak aktywności')).toBeTruthy()
  })

  it('switches filters', () => {
    const onChange = jest.fn()
    render(<ActivityFilterChips active="all" onChange={onChange} filters={[{ id: 'all', label: 'Wszystko', count: 3 }, { id: 'notes', label: 'Notatki', count: 1 }]} />)
    expect(screen.getByRole('tab', { name: /Wszystko/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: /Notatki/ }))
    expect(onChange).toHaveBeenCalledWith('notes')
  })

  it('submits the composer with Ctrl+Enter and ignores blank text', async () => {
    const onSubmit = jest.fn()
    render(<ActivityComposer placeholder="Notatka" sendLabel="Wyślij" onSubmit={onSubmit} />)
    const box = screen.getByRole('textbox', { name: 'Notatka' })
    expect((screen.getByRole('button', { name: 'Wyślij' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'Rozmowa o Q4' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Rozmowa o Q4'))
  })
})

describe('InfoGrid and ProcessSteps', () => {
  it('renders labelled values with a copy button', () => {
    render(<InfoGrid copyLabel="Kopiuj" sections={[{ fields: [{ label: 'NIP', value: 'PL 5213017228', copy: '5213017228' }] }]} />)
    expect(screen.getByText('NIP')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kopiuj' })).toBeTruthy()
  })

  it('marks the current step', () => {
    render(
      <ProcessSteps
        steps={[
          { id: '1', label: 'RFQ', state: 'done' },
          { id: '2', label: 'Oferta', state: 'current' },
          { id: '3', label: 'Zlecenie', state: 'future' },
        ]}
      />,
    )
    expect(screen.getByText('Oferta').closest('li')?.getAttribute('aria-current')).toBe('step')
  })
})
