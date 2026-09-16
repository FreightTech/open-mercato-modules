/**
 * @jest-environment jsdom
 *
 * DENSITY PREFERENCE — persistence + the picker.
 *
 * The load-bearing tests in this file are the LEAK tests. Workshop item A3
 * recorded a user changing what she thought was her own view setting and
 * changing it for everybody ("Czyli jak tu porobiłam, to porobiłam wszystkim?"
 * — "Tak."), and that was received as a bug. Every assertion about scoping
 * below exists to make that specific defect impossible to reintroduce.
 */

import * as React from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import {
  DENSITY_SCOPE_CACHE_KEY,
  DENSITY_STORAGE_PREFIX,
  ensureDensityScope,
  getDensityPreference,
  getServerDensityPreference,
  resetDensityPreferenceStore,
  setDensityPreference,
  useDensityPreference,
} from '../hooks/useDensityPreference'
import DensityControl from '../components/DensityControl'
import { DEFAULT_DENSITY } from '../types/density'

jest.mock('@freighttech/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const mockApiCall = apiCall as unknown as jest.Mock

function keyFor(scope: string): string {
  return `${DENSITY_STORAGE_PREFIX}:${scope}`
}

beforeEach(() => {
  window.localStorage.clear()
  resetDensityPreferenceStore()
  mockApiCall.mockReset()
  // Default: identity is unknowable. Every code path must survive this.
  mockApiCall.mockResolvedValue({ ok: false })
})

afterEach(() => {
  resetDensityPreferenceStore()
  window.localStorage.clear()
})

/* ═══════════════════════════════════════════════════════════════════════════
   READING THE PREFERENCE
   ═══════════════════════════════════════════════════════════════════════════ */

describe('useDensityPreference — reading', () => {
  it('defaults to comfortable when nothing is stored', () => {
    const { result } = renderHook(() => useDensityPreference())
    expect(result.current.density).toBe('comfortable')
    expect(DEFAULT_DENSITY).toBe('comfortable')
  })

  it('restores a stored level for the signed-in user', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    window.localStorage.setItem(keyFor('user-a'), 'dense')
    const { result } = renderHook(() => useDensityPreference())
    expect(result.current.density).toBe('dense')
  })

  it('degrades a CORRUPT stored value to today’s rendering rather than throwing', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    window.localStorage.setItem(keyFor('user-a'), 'ultra-mega-dense')
    const { result } = renderHook(() => useDensityPreference())
    expect(result.current.density).toBe('comfortable')
  })

  it('hydrates server-side at the DEFAULT, so SSR cannot mismatch', () => {
    // The server has no access to the user's localStorage; any other answer
    // would be a hydration error rather than a nicety.
    expect(getServerDensityPreference()).toBe('comfortable')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   WRITING — AND THE SCOPE THE WRITE LANDS IN (workshop A3)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('useDensityPreference — persistence scope (A3: must never leak)', () => {
  it('persists under a USER-scoped key', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    const { result } = renderHook(() => useDensityPreference())
    act(() => result.current.setDensity('dense'))
    expect(window.localStorage.getItem(keyFor('user-a'))).toBe('dense')
  })

  it('does NOT leak one user’s choice to the next account on the same machine', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    const first = renderHook(() => useDensityPreference())
    act(() => first.result.current.setDensity('dense'))
    first.unmount()

    // Second account signs in on this browser.
    resetDensityPreferenceStore()
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-b')
    const second = renderHook(() => useDensityPreference())

    expect(second.result.current.density).toBe('comfortable')
    // …and user A's setting is still intact for when they come back.
    expect(window.localStorage.getItem(keyFor('user-a'))).toBe('dense')
  })

  it('writes ONE key with no table identity in it — the setting is global across grids', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    const { result } = renderHook(() => useDensityPreference())
    act(() => result.current.setDensity('compact'))

    const written = Object.keys(window.localStorage).filter((k) =>
      k.startsWith(DENSITY_STORAGE_PREFIX),
    )
    // Exactly one key, and it is scoped by user only. A tableId here would mean
    // Agnieszka setting the same preference once per grid she happens to open.
    expect(written).toEqual([keyFor('user-a')])
  })

  it('ignores an invalid level instead of blanking the grid', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    const { result } = renderHook(() => useDensityPreference())
    act(() => result.current.setDensity('gigantic' as never))
    expect(result.current.density).toBe('comfortable')
    expect(window.localStorage.getItem(keyFor('user-a'))).toBeNull()
  })

  it('still applies the choice for this session when storage is blocked (private mode)', () => {
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
    try {
      const { result } = renderHook(() => useDensityPreference())
      act(() => result.current.setDensity('dense'))
      // The click is honoured in memory even though it cannot survive a reload.
      expect(result.current.density).toBe('dense')
    } finally {
      setItem.mockRestore()
    }
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   IDENTITY CONFIRMATION — closing the last leak
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ensureDensityScope', () => {
  // These drive the store imperatively rather than through a mounted hook.
  // `ensureDensityScope` memoizes its promise (once per page, however many
  // grids mount), so a hook's mount effect would fire it before the test could
  // arrange the scenario — and the assertion would be racing the effect rather
  // than testing the reconciliation.

  it('carries a fallback-scoped choice forward on the user’s FIRST resolution', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { userId: 'user-a' } })

    // No uid cache yet: the choice lands under the shared fallback scope.
    setDensityPreference('compact')
    expect(window.localStorage.getItem(keyFor('shared'))).toBe('compact')

    await ensureDensityScope()

    expect(window.localStorage.getItem(DENSITY_SCOPE_CACHE_KEY)).toBe('user-a')
    expect(window.localStorage.getItem(keyFor('user-a'))).toBe('compact')
    // Losing a just-made setting on the next reload would read as a bug.
    expect(getDensityPreference()).toBe('compact')
  })

  it('does NOT inherit a previous account’s preference when the cached uid was stale', async () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    window.localStorage.setItem(keyFor('user-a'), 'dense')
    expect(getDensityPreference()).toBe('dense')

    // The session actually belongs to somebody else.
    mockApiCall.mockResolvedValue({ ok: true, result: { userId: 'user-b' } })
    await ensureDensityScope()

    expect(getDensityPreference()).toBe('comfortable')
    expect(window.localStorage.getItem(keyFor('user-b'))).toBeNull()
    expect(window.localStorage.getItem(keyFor('user-a'))).toBe('dense')
  })

  it('re-renders a mounted grid when the scope reconciles', async () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    window.localStorage.setItem(keyFor('user-a'), 'dense')
    window.localStorage.setItem(keyFor('user-b'), 'compact')
    mockApiCall.mockResolvedValue({ ok: true, result: { userId: 'user-b' } })

    const { result } = renderHook(() => useDensityPreference())
    expect(result.current.density).toBe('dense')

    await act(async () => {
      await ensureDensityScope()
    })

    expect(result.current.density).toBe('compact')
  })

  it('keeps the painted level when the auth endpoint fails', async () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    window.localStorage.setItem(keyFor('user-a'), 'dense')
    mockApiCall.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useDensityPreference())
    await act(async () => {
      await ensureDensityScope()
    })

    expect(result.current.density).toBe('dense')
  })

  it('resolves identity at most once per page however many grids mount', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { userId: 'user-a' } })
    renderHook(() => useDensityPreference())
    renderHook(() => useDensityPreference())
    renderHook(() => useDensityPreference())
    await act(async () => {
      await ensureDensityScope()
    })
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   ONE LEVEL, EVERY GRID
   ═══════════════════════════════════════════════════════════════════════════ */

describe('useDensityPreference — shared store', () => {
  it('updates every mounted grid from a single change', () => {
    const a = renderHook(() => useDensityPreference())
    const b = renderHook(() => useDensityPreference())

    act(() => setDensityPreference('dense'))

    // A list page and its drawer sub-table must not end up at different
    // densities because only one of them owns the toolbar control.
    expect(a.result.current.density).toBe('dense')
    expect(b.result.current.density).toBe('dense')
  })

  it('follows a change made in another browser tab', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    const { result } = renderHook(() => useDensityPreference())
    expect(result.current.density).toBe('comfortable')

    act(() => {
      window.localStorage.setItem(keyFor('user-a'), 'compact')
      window.dispatchEvent(
        new StorageEvent('storage', { key: keyFor('user-a'), newValue: 'compact' }),
      )
    })

    expect(result.current.density).toBe('compact')
  })

  it('exposes the level outside React for imperative callers', () => {
    act(() => setDensityPreference('compact'))
    expect(getDensityPreference()).toBe('compact')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   DEVELOPER OVERRIDE — a pinned table is not a preference
   ═══════════════════════════════════════════════════════════════════════════ */

describe('useDensityPreference — override', () => {
  it('wins for that table and is never written to storage', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    const { result } = renderHook(() => useDensityPreference('dense'))

    expect(result.current.density).toBe('dense')
    expect(result.current.isOverridden).toBe(true)

    act(() => result.current.setDensity('compact'))
    // A structural, developer-chosen level must not silently become the user's
    // setting on every other grid they open.
    expect(window.localStorage.getItem(keyFor('user-a'))).toBeNull()
    expect(result.current.density).toBe('dense')
  })

  it('falls through to the user preference for an invalid override', () => {
    const { result } = renderHook(() => useDensityPreference('huge' as never))
    expect(result.current.density).toBe('comfortable')
    expect(result.current.isOverridden).toBe(false)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   THE CONTROL
   ═══════════════════════════════════════════════════════════════════════════ */

function renderControl(props: Partial<React.ComponentProps<typeof DensityControl>> = {}) {
  return render(
    React.createElement(
      I18nProvider as unknown as React.ComponentType<Record<string, unknown>>,
      { locale: 'en', dict: {} },
      React.createElement(DensityControl, props),
    ),
  )
}

function openControl() {
  fireEvent.click(screen.getByRole('button', { name: /row density/i }))
}

describe('DensityControl', () => {
  it('is NEVER a native <select>', () => {
    const { container } = renderControl()
    openControl()
    expect(container.querySelector('select')).toBeNull()
    expect(document.body.querySelector('select')).toBeNull()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('states the CURRENT density in the trigger’s accessible name', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    window.localStorage.setItem(keyFor('user-a'), 'dense')
    renderControl()
    // The toolbar variant is icon-only, so without this a screen-reader user
    // could open the menu and still not know what is selected.
    expect(screen.getByRole('button', { name: 'Row density: Dense' })).toBeInTheDocument()
  })

  it('renders the panel in a PORTAL on document.body, not inside the toolbar', () => {
    const { container } = renderControl()
    openControl()
    const listbox = screen.getByRole('listbox')
    // An absolutely-positioned panel would be clipped by the grid's
    // overflow:auto scroll containers.
    expect(container.contains(listbox)).toBe(false)
    expect(document.body.contains(listbox)).toBe(true)
    // Fixed positioning anchored to the trigger's rect. jsdom applies no
    // stylesheets, so assert the class plus the inline anchor coordinates that
    // only the portal path writes.
    expect(listbox.className).toContain('fixed')
    expect(listbox.style.top).not.toBe('')
    expect(listbox.style.left).not.toBe('')
    expect(listbox.style.width).toBe('264px')
  })

  it('offers all three levels and check-marks the current one', () => {
    renderControl()
    openControl()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
  })

  it('persists the chosen level and closes', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    renderControl()
    openControl()
    fireEvent.click(screen.getByText('Compact'))

    expect(window.localStorage.getItem(keyFor('user-a'))).toBe('compact')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('reports the choice through onChange without persisting when controlled', () => {
    const onChange = jest.fn()
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    renderControl({ value: 'comfortable', onChange })
    openControl()
    fireEvent.click(screen.getByText('Dense'))

    expect(onChange).toHaveBeenCalledWith('dense')
    expect(window.localStorage.getItem(keyFor('user-a'))).toBeNull()
  })

  it('is operable from the keyboard: ArrowDown then Enter', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    renderControl()
    const trigger = screen.getByRole('button', { name: /row density/i })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })

    expect(window.localStorage.getItem(keyFor('user-a'))).toBe('compact')
  })

  it('closes on outside click without choosing anything', () => {
    window.localStorage.setItem(DENSITY_SCOPE_CACHE_KEY, 'user-a')
    renderControl()
    openControl()
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(keyFor('user-a'))).toBeNull()
  })

  it('closes on Escape and STOPS the event reaching page-level handlers', () => {
    const pageEscape = jest.fn()
    document.addEventListener('keydown', pageEscape)
    try {
      renderControl()
      openControl()
      fireEvent.keyDown(document.body, { key: 'Escape' })

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      // The grid's own ESC handler clears the cell selection. Dismissing a
      // dropdown must not also throw away what the user had selected.
      expect(pageEscape).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', pageEscape)
    }
  })

  it('closes on scroll, because a fixed panel does not follow its anchor', () => {
    renderControl()
    openControl()
    fireEvent.scroll(window)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not open when disabled', () => {
    renderControl({ disabled: true })
    fireEvent.click(screen.getByRole('button', { name: /row density/i }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows the current level in words in the labelled variant', () => {
    renderControl({ variant: 'labelled' })
    expect(screen.getByRole('button', { name: /row density/i })).toHaveTextContent('Comfortable')
  })
})
