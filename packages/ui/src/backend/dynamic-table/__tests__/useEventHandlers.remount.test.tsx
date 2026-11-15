/**
 * @jest-environment jsdom
 *
 * useEventHandlers FOLLOWS THE GRID ELEMENT IT IS GIVEN, EVEN WHEN THE GRID IS REPLACED WITHOUT ITS OWNER RENDERING
 * (0.14.34).
 *
 * gt-fms offer pricing grid on tms-ft (pc2 w1:p3): a host keyed the table on its rows, so the grid remounted while the
 * component that owned `useEventHandlers` did not render again. The hook only looked at `elementRef.current` when its
 * owner rendered, so its listeners stayed on the replaced element; the new grid's CELL_EDIT_SAVE reached no listener,
 * the typed value was lost and the host saved the old one.
 */

import * as React from 'react'
import { render, act } from '@testing-library/react'
import { dispatch, useEventHandlers } from '../events/events'
import { TableEvents } from '../types/index'

/** Stands in for the grid: its root element is the shared ref's element, and it is replaced when `generation` moves. */
function Grid({ tableRef, generation }: { tableRef: React.RefObject<HTMLDivElement | null>; generation: number }) {
  return React.createElement('div', { ref: tableRef, 'data-generation': generation, className: 'grid' },
    React.createElement('span', { className: 'cell' }, 'cell'))
}

/** Holds its own state, so it re-renders (and remounts the grid) WITHOUT the hook's owner rendering. */
const remountRef: { current: (() => void) | null } = { current: null }
function Keyed({ tableRef }: { tableRef: React.RefObject<HTMLDivElement | null> }) {
  const [generation, setGeneration] = React.useState(1)
  remountRef.current = () => setGeneration((g) => g + 1)
  return React.createElement(Grid, { key: generation, tableRef, generation })
}

let ownerRenders = 0
const received: Array<{ newValue: unknown }> = []
function Host() {
  ownerRenders++
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  useEventHandlers({
    [TableEvents.CELL_EDIT_SAVE]: (payload: any) => { received.push({ newValue: payload.newValue }) },
  } as never, tableRef as React.RefObject<HTMLElement>)
  return React.createElement(Keyed, { tableRef })
}

beforeEach(() => {
  ownerRenders = 0
  received.length = 0
})

it('a grid remounted under a host that does not render again still delivers CELL_EDIT_SAVE, with the new value', () => {
  const { container } = render(React.createElement(Host))
  const first = container.querySelector<HTMLElement>('.grid')!
  act(() => { dispatch(first, TableEvents.CELL_EDIT_SAVE, { newValue: 'old' }) })
  expect(received).toEqual([{ newValue: 'old' }])

  const rendersBefore = ownerRenders
  act(() => { remountRef.current!() })
  const second = container.querySelector<HTMLElement>('.grid')!
  expect(second).not.toBe(first)
  expect(second.getAttribute('data-generation')).toBe('2')
  expect(ownerRenders).toBe(rendersBefore) // the hook's owner did not render

  act(() => { dispatch(second, TableEvents.CELL_EDIT_SAVE, { newValue: '12,50' }) })
  expect(received).toEqual([{ newValue: 'old' }, { newValue: '12,50' }])
})

it('an event from inside the current grid still reaches it, and stops there (an outer grid\'s host does not get it)', () => {
  const outer: unknown[] = []
  function Outer() {
    const outerRef = React.useRef<HTMLDivElement | null>(null)
    useEventHandlers({ [TableEvents.CELL_EDIT_SAVE]: (p: any) => { outer.push(p) } } as never, outerRef as React.RefObject<HTMLElement>)
    return React.createElement('div', { ref: outerRef, className: 'outer' }, React.createElement(Host))
  }
  const { container } = render(React.createElement(Outer))
  act(() => { remountRef.current!() })
  const cell = container.querySelector<HTMLElement>('.grid .cell')!
  act(() => { dispatch(cell, TableEvents.CELL_EDIT_SAVE, { newValue: 'x' }) })
  expect(received).toEqual([{ newValue: 'x' }])
  expect(outer).toEqual([])
})

it('the grid\'s own listener on the same element still runs, before the host\'s, and only once per event', () => {
  const order: string[] = []
  function OwnGrid({ tableRef }: { tableRef: React.RefObject<HTMLDivElement | null> }) {
    useEventHandlers({ [TableEvents.CELL_SAVE_START]: () => { order.push('grid') } } as never, tableRef as React.RefObject<HTMLElement>)
    return React.createElement('div', { ref: tableRef, className: 'own' })
  }
  function OwnHost() {
    const tableRef = React.useRef<HTMLDivElement | null>(null)
    useEventHandlers({ [TableEvents.CELL_SAVE_START]: () => { order.push('host') } } as never, tableRef as React.RefObject<HTMLElement>)
    return React.createElement(OwnGrid, { tableRef })
  }
  const { container } = render(React.createElement(OwnHost))
  act(() => { dispatch(container.querySelector<HTMLElement>('.own')!, TableEvents.CELL_SAVE_START, {}) })
  expect(order).toEqual(['grid', 'host'])
})

it('nothing stays bound after the owner unmounts', () => {
  const { container, unmount } = render(React.createElement(Host))
  const grid = container.querySelector<HTMLElement>('.grid')!
  unmount()
  dispatch(grid, TableEvents.CELL_EDIT_SAVE, { newValue: 'late' })
  expect(received).toEqual([])
})
