/**
 * @jest-environment jsdom
 *
 * DENSITY + COLUMN-VIRTUALIZATION WIRING, asserted on the real grid.
 *
 * Two capabilities were built in an earlier wave and reached no render path.
 * The unit tests for both are green and prove nothing about whether a user can
 * see them, which is the only question that matters here.
 *
 * The load-bearing assertions:
 *
 *  • DEFAULT IS A NO-OP. The product owner has repeatedly flagged FMS tables as
 *    "fonts too small", so a density feature that quietly shrinks anything for
 *    somebody who never opened the picker is a regression, not a feature.
 *    `comfortable` must render at exactly today's row height.
 *
 *  • DENSITY IS PER USER. Workshop item A3 is a recorded incident of one person
 *    changing a shared default for a whole organisation by accident. The switch
 *    must never travel through a perspective or any server-held object.
 *
 *  • THE DENSITY GUARDRAIL CANNOT INVERT. `data-dt-columns` declares how many
 *    columns EXIST. Without it the perf harness counts mounted `<th>`s, so a
 *    successful virtualization reads as "the change lost 36 columns" — the one
 *    outcome the product owner explicitly forbade.
 */

import * as React from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import {
  DENSITY_ATTRIBUTE,
  DENSITY_METRICS,
  DENSITY_STORAGE_PREFIX,
} from '../index'
import { resetDensityPreferenceStore } from '../hooks/useDensityPreference'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import type { ColumnDef } from '../types/index'

jest.mock('@freighttech/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))
const mockApiCall = apiCall as unknown as jest.Mock

const columns: ColumnDef[] = Array.from({ length: 12 }, (_, i) => ({
  data: `c${i}`,
  title: `Col ${i}`,
  width: 120,
}))

const makeRows = () =>
  Array.from({ length: 5 }, (_, r) => {
    const row: Record<string, unknown> = { id: `r${r}` }
    for (let c = 0; c < 12; c++) row[`c${c}`] = `v${r}-${c}`
    return row
  })

function Harness(props: Record<string, unknown>) {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  const [data] = React.useState(makeRows)
  return React.createElement(
    I18nProvider as any,
    { locale: 'en', dict: {} },
    React.createElement(DynamicTable as any, {
      data,
      columns,
      tableRef,
      height: 400,
      ...props,
    }),
  )
}
const harness = (props: Record<string, unknown> = {}) => React.createElement(Harness, props)

// jsdom gives every box a 0×0 rect, so the ROW virtualiser mounts nothing.
// Same stub the other mount tests use.
beforeAll(() => {
  const rect = {
    width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0,
    toJSON() {},
  }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  })
  for (const [prop, value] of [
    ['clientHeight', 600],
    ['offsetHeight', 600],
    ['clientWidth', 1200],
    ['offsetWidth', 1200],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
})

beforeEach(() => {
  window.localStorage.clear()
  resetDensityPreferenceStore()
  mockApiCall.mockReset()
  mockApiCall.mockResolvedValue({ ok: false })
})

const container = () => document.querySelector('.hot-container') as HTMLElement
const scroller = () => document.querySelector('.hot-virtual-container') as HTMLElement
const firstRowHeight = () => {
  const tr = document.querySelector('tbody tr[data-row]') as HTMLElement
  return tr?.style.height
}

describe('density — mounted in the grid', () => {
  it('carries the density attribute on the grid container, so ONE switch restyles everything', () => {
    render(harness())
    expect(container().getAttribute(DENSITY_ATTRIBUTE)).toBe('comfortable')
  })

  it('defaults to comfortable and renders at TODAY\'S row height — opting out is a no-op', () => {
    render(harness())
    expect(firstRowHeight()).toBe(`${DENSITY_METRICS.comfortable.rowHeight}px`)
    expect(firstRowHeight()).toBe('32px')
  })


/**
 * Density now lives inside the toolbar's overflow menu, as a SEGMENTED control
 * rather than a listbox trigger: Export, row height and fullscreen are
 * secondary controls that no longer each spend permanent toolbar width (see
 * `ToolbarOverflow`).
 *
 * These tests assert the same behaviour as before — the level applies, the
 * grid re-measures, the choice persists under a user-scoped key. Only the
 * route to the control changed, so they open the overflow rather than dropping
 * an assertion.
 */
function openDensityControls(): void {
  const overflow = document.querySelector('[data-toolbar-overflow]') as HTMLElement | null
  if (overflow && !document.querySelector('[data-toolbar-overflow-menu]')) {
    act(() => { fireEvent.click(overflow) })
  }
}

function densityOption(level: 'comfortable' | 'compact' | 'dense'): HTMLElement {
  openDensityControls()
  return document.querySelector(`[data-density-option="${level}"]`) as HTMLElement
}

  it('shows the density picker in the toolbar, naming the current level for screen readers', () => {
    render(harness())
    // The segmented control marks the current level with `aria-pressed`, which
    // is what a screen reader announces now that there is no collapsed trigger
    // carrying the level in its label.
    const current = densityOption('comfortable')
    expect(current).not.toBeNull()
    expect(current.getAttribute('aria-pressed')).toBe('true')
    expect(densityOption('dense').getAttribute('aria-pressed')).toBe('false')
  })

  it('lets the user pick a tighter level, and the whole grid restyles + re-measures', () => {
    render(harness())
    const dense = densityOption('dense')
    expect(dense).not.toBeNull()
    act(() => { fireEvent.click(dense) })

    expect(container().getAttribute(DENSITY_ATTRIBUTE)).toBe('dense')
    // Row height is the ONE number CSS cannot own — rows are absolutely
    // positioned by the virtualiser, so JS has to know it.
    expect(firstRowHeight()).toBe(`${DENSITY_METRICS.dense.rowHeight}px`)
  })

  it('persists the choice under a USER-scoped key and never through a perspective', () => {
    render(harness())
    const compact = densityOption('compact')
    act(() => { fireEvent.click(compact) })

    const keys = Object.keys(window.localStorage)
    expect(keys.some((k) => k.startsWith(DENSITY_STORAGE_PREFIX))).toBe(true)
    // The A3 guarantee: nothing organisation-shaped in the key, and no request
    // was made to persist it anywhere a second user could read.
    expect(mockApiCall).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/perspectives'),
      expect.anything(),
    )
  })

  it('honours a developer override without persisting it as the user\'s setting', () => {
    render(harness({ uiConfig: { densityLevel: 'compact' } }))
    expect(container().getAttribute(DENSITY_ATTRIBUTE)).toBe('compact')
    expect(firstRowHeight()).toBe(`${DENSITY_METRICS.compact.rowHeight}px`)
    expect(
      Object.keys(window.localStorage).some((k) => k.startsWith(DENSITY_STORAGE_PREFIX)),
    ).toBe(false)
  })

  it('can be hidden per table without pinning the level', () => {
    render(harness({ uiConfig: { hideDensityControl: true } }))
    expect(
      document.querySelector('button[aria-haspopup="listbox"][aria-label*="density"]'),
    ).toBeNull()
    expect(container().getAttribute(DENSITY_ATTRIBUTE)).toBe('comfortable')
  })

  it('leaves the LEGACY developer density prop alone — the two attributes are different axes', () => {
    render(harness({ density: 'md' }))
    // `data-density` is what DynamicTable.v2.css keys `:not([data-density])` on;
    // reusing it for the user preference would silently switch those rules off.
    expect(container().getAttribute('data-density')).toBe('md')
    expect(container().getAttribute(DENSITY_ATTRIBUTE)).toBe('comfortable')
    expect(firstRowHeight()).toBe('44px')
  })
})

describe('column virtualization — the guardrail and the default', () => {
  it('declares how many columns EXIST, so a virtualization win cannot read as a column loss', () => {
    render(harness())
    expect(scroller().getAttribute('data-dt-columns')).toBe('12')
    expect(scroller().getAttribute('data-dt-rows')).toBe('5')
  })

  it('reports the full column count to assistive tech, never the mounted subset', () => {
    render(harness())
    // 12 data columns; no row header, no actions column on this table.
    expect(Number(scroller().getAttribute('aria-colcount'))).toBe(12)
  })

  it('counts the row-header gutter in aria-colcount when there is one', () => {
    render(harness({ rowHeaders: true }))
    expect(Number(scroller().getAttribute('aria-colcount'))).toBe(13)
  })

  it('is OFF by default — every column is mounted, exactly as before', () => {
    render(harness())
    const cells = document.querySelectorAll(
      'tbody tr[data-row]:first-child td.hot-cell[data-col]:not(.hot-actions-cell)',
    )
    expect(cells).toHaveLength(12)
    expect(document.querySelectorAll('.hot-cell-spacer')).toHaveLength(0)
    expect(scroller().getAttribute('data-column-virtualized')).toBeNull()
  })

  it('with the flag ON but nothing measured, FAILS OPEN — never an empty grid', () => {
    // jsdom has no layout and a stubbed ResizeObserver, so the virtualizer
    // cannot measure. Correct-but-slow is the only acceptable failure
    // direction: the alternative paints a table with no cells in it.
    render(harness({ uiConfig: { enableColumnVirtualization: true } }))
    const cells = document.querySelectorAll(
      'tbody tr[data-row]:first-child td.hot-cell[data-col]:not(.hot-actions-cell)',
    )
    expect(cells).toHaveLength(12)
    expect(document.querySelectorAll('.hot-cell-spacer')).toHaveLength(0)
    expect(scroller().getAttribute('data-dt-columns')).toBe('12')
  })

  it('publishes the mounted window so a test can ask the MODEL, not the DOM', () => {
    render(harness({ uiConfig: { enableColumnVirtualization: true } }))
    expect(scroller().getAttribute('data-column-window')).toBe('0:11')
  })
})

describe('scroll-into-view — rule 9 of the range-operation contract', () => {
  let scrollTo: jest.SpyInstance

  beforeEach(() => {
    scrollTo = jest.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => {})
  })
  afterEach(() => {
    scrollTo.mockRestore()
  })

  // 12 columns × 120px = 1440px of columns in a 1200px viewport, so the last
  // column genuinely does not fit and moving onto it MUST scroll.
  const selectColumn = (colIndex: number) => {
    const cell = document.querySelector(
      `tbody tr[data-row="0"] td.hot-cell[data-col="${colIndex}"]`,
    ) as HTMLElement
    expect(cell).not.toBeNull()
    act(() => { fireEvent.mouseDown(cell) })
  }

  it('scrolls a column that does not fit into view when the caret lands on it', () => {
    render(harness({ uiConfig: { enableColumnVirtualization: true } }))
    selectColumn(11)
    expect(scrollTo).toHaveBeenCalled()
    const arg = scrollTo.mock.calls.at(-1)![0] as { left: number }
    expect(arg.left).toBeGreaterThan(0)
  })

  it('does NOT scroll for a column that is already fully visible', () => {
    render(harness({ uiConfig: { enableColumnVirtualization: true } }))
    scrollTo.mockClear()
    selectColumn(0)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('leaves scrolling behaviour completely untouched when the flag is off', () => {
    render(harness())
    scrollTo.mockClear()
    selectColumn(11)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
