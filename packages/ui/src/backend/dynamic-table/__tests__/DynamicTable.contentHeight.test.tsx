import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import { CONTENT_MAX_HEIGHT, DynamicTableSizingProvider, PANE_CONTENT_SIZING } from '../sizing'
import { Sheet, SheetContent } from '../../../primitives/sheet'
import type { ColumnDef } from '../types/index'

/**
 * A table as tall as its rows. Widgets on a board or a record page used the default `'auto'`
 * height — a fixed 600 px body — so a table with two rows stood 600 px tall. `'content'` gives the
 * rows region no height of its own (its header and rows give it one) and caps it at `maxHeight`,
 * past which the rows scroll. jsdom lays nothing out, so this pins the styles the browser sizes by.
 */

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'amount', title: 'Amount' },
]
const rows = [
  { id: '1', client: 'Acme', amount: 100 },
  { id: '2', client: 'Globex', amount: 200 },
]

function body(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.hot-virtual-container') as HTMLElement | null
  if (!el) throw new Error('no rows region')
  return el
}

function renderGrid(props: Record<string, unknown>, wrap?: (node: React.ReactElement) => React.ReactElement) {
  function Harness() {
    const tableRef = React.useRef<HTMLDivElement | null>(null)
    const table = React.createElement(DynamicTable as any, { data: rows, columns, tableRef, ...props })
    return React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, wrap ? wrap(table) : table)
  }
  return render(React.createElement(Harness))
}

describe('DynamicTable height="content"', () => {
  it('the default stays a fixed 600 px body', () => {
    const { container } = renderGrid({})
    expect(body(container).style.height).toBe('600px')
    expect(body(container).style.maxHeight).toBe('')
    expect((container.querySelector('.hot-container') as HTMLElement).dataset.contentHeight).toBeUndefined()
  })

  it('a content table has no body height of its own, only the cap', () => {
    const { container } = renderGrid({ height: 'content', maxHeight: 320 })
    expect(body(container).style.height).toBe('')
    expect(body(container).style.maxHeight).toBe('320px')
    expect(body(container).style.overflow).toBe('auto')
    // Nor does the frame around it carry a height; it says it is content-sized (the empty state reads it).
    const frame = container.querySelector('.hot-container') as HTMLElement
    expect(frame.style.height).toBe('')
    expect(frame.dataset.contentHeight).toBe('true')
  })

  it('without a cap it stops at CONTENT_MAX_HEIGHT', () => {
    const { container } = renderGrid({ height: 'content' })
    expect(body(container).style.maxHeight).toBe(`${CONTENT_MAX_HEIGHT}px`)
  })

  it('a host sizes the tables inside it — over the table\'s own "fill"', () => {
    const { container } = renderGrid(
      { height: 'fill' },
      (node) => React.createElement(DynamicTableSizingProvider, { value: { height: 'content', maxHeight: '40vh' } }, node),
    )
    expect(body(container).style.height).toBe('')
    expect(body(container).style.maxHeight).toBe('40vh')
    expect((container.querySelector('.hot-container') as HTMLElement).className).not.toContain('flex-1')
  })

  it('a split-view pane caps the whole table at its scroll pane, the rows region giving way', () => {
    const { container } = renderGrid({ height: 'fill' }, (node) => React.createElement(DynamicTableSizingProvider, { value: PANE_CONTENT_SIZING }, node))
    const frame = container.querySelector('.hot-container') as HTMLElement
    // jsdom: no scroll pane above it, so the cap is the window's bottom less the table's top (0).
    expect(frame.style.maxHeight).toBe(`${window.innerHeight}px`)
    expect(frame.style.height).toBe('')
    expect(frame.className).toContain('flex-col')
    expect(frame.dataset.paneCapped).toBe('true')
    expect(body(container).style.maxHeight).toBe('')
    expect(body(container).style.flex).toBe('0 1 auto')
    expect(parseFloat(body(container).style.minHeight)).toBe(0)
  })

  it('a Sheet opened from a widget gives its tables their own height back', () => {
    renderGrid({ height: '300px' }, (node) =>
      React.createElement(
        DynamicTableSizingProvider,
        { value: { height: 'content', maxHeight: 120 } },
        React.createElement(Sheet, { open: true }, React.createElement(SheetContent, null, node)),
      ),
    )
    const inSheet = document.body.querySelector('[role="dialog"] .hot-virtual-container') as HTMLElement
    expect(inSheet.style.height).toBe('300px')
    expect(inSheet.style.maxHeight).toBe('')
  })
})
