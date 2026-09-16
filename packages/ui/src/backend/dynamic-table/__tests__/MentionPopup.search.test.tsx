/**
 * @mention user lookup — ledger 8.7.
 *
 * Typing "Daria" for the listed user "Daria Nowak" returned "No users found".
 * The cause was not the popup at all: `/api/auth/users?search=` matches
 * search_tokens (encrypted email), organization names and role names — never
 * the user's own display name. `?name=` is the parameter that does. Verified
 * against the live API before changing anything: `search=Daria` → 0 items,
 * `name=Daria` → Daria Nowak.
 *
 * The route lives in `@open-mercato/core` and is read-only here, and the two
 * params are ANDed when both are sent, so the popup has to pick one.
 */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import MentionPopup from '../components/MentionPopup'

jest.mock('../../utils/api', () => ({
  apiFetch: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiFetch } = require('../../utils/api') as { apiFetch: jest.Mock }

const USERS = [
  { id: 'u1', name: 'Łukasz Kowalski', email: 'seed-rep-1@offdock.test' },
  { id: 'u2', name: 'Daria Nowak', email: 'seed-rep-2@offdock.test' },
  { id: 'u3', name: 'Karol Wiśniewski', email: 'seed-rep-3@offdock.test' },
]

function ok(items: typeof USERS) {
  return { ok: true, json: async () => ({ items }) }
}

/** Stands in for the upstream route: `name=` ILIKEs, `search=` never matches a name. */
function serveLikeTheRealRoute(url: string) {
  const q = new URL(url, 'http://localhost').searchParams
  const name = q.get('name')
  if (name) {
    // Case-insensitive but NOT diacritic-insensitive — Postgres ILIKE.
    const needle = name.toLowerCase()
    return ok(USERS.filter((u) => u.name.toLowerCase().includes(needle)))
  }
  if (q.get('search')) return ok([])
  return ok(USERS)
}

function renderPopup(query: string) {
  const anchor = document.createElement('div')
  document.body.appendChild(anchor)
  return render(
    <MentionPopup
      query={query}
      anchorEl={anchor}
      visible
      onSelect={() => {}}
      onClose={() => {}}
    />,
  )
}

describe('MentionPopup — searching by a human name (8.7)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiFetch.mockReset()
    apiFetch.mockImplementation((url: string) => Promise.resolve(serveLikeTheRealRoute(url)))
  })
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  // The popup debounces 250 ms and then resolves promises; both the timer and
  // the microtask drain have to run inside `act` or React warns about the
  // state updates that land after them.
  const flush = async () => {
    await act(async () => {
      jest.advanceTimersByTime(300)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(apiFetch).toHaveBeenCalled()
  }

  it('queries `name=`, not `search=` — the param that matches a display name', async () => {
    renderPopup('Daria')
    await flush()
    const url = apiFetch.mock.calls[0][0] as string
    expect(url).toContain('name=Daria')
    expect(url).not.toContain('search=')
    await waitFor(() => expect(screen.getByText('Daria Nowak')).toBeTruthy())
  })

  it('matches a surname, not only the first name', async () => {
    renderPopup('Kowal')
    await flush()
    await waitFor(() => expect(screen.getByText('Łukasz Kowalski')).toBeTruthy())
  })

  it('falls back to a diacritic-folded local match: "Lukasz" finds "Łukasz"', async () => {
    renderPopup('Lukasz')
    await flush()
    // Server ILIKE misses it, so the popup pulls one page and folds locally.
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('Łukasz Kowalski')).toBeTruthy())
  })

  it('the fallback also matches an email, which `search=` did not', async () => {
    renderPopup('seed-rep-3')
    await flush()
    await waitFor(() => expect(screen.getByText('Karol Wiśniewski')).toBeTruthy())
  })

  it('costs ONE request when the server already found someone', async () => {
    renderPopup('Nowak')
    await flush()
    await waitFor(() => expect(screen.getByText('Daria Nowak')).toBeTruthy())
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('still says so when nobody matches at all', async () => {
    renderPopup('Zzzz')
    await flush()
    await waitFor(() => expect(screen.getByText('No users found')).toBeTruthy())
  })
})
