"use client"
import * as React from 'react'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { redirectToSessionRefresh, UnauthorizedError, ForbiddenError, apiFetch, setAuthRedirectConfig } from '../backend/utils/api'
import { flash } from '../backend/FlashMessages'

// Ensure global fetch calls also respect our redirect-on-401/403 policy.
function ensureGlobalFetchInterception() {
  if (typeof window === 'undefined') return
  const w = window as any
  if (w.__omFetchPatched) return
  w.__omFetchPatched = true
  w.__omOriginalFetch = window.fetch
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => apiFetch(input, init)) as any
}

/**
 * What a failed query or mutation does about auth.
 *
 * 401 — the session expired: refresh it (unchanged).
 *
 * 403 — never a logout from here. `apiFetch` has already redirected to the login page when the call
 * wanted that (a 403 naming the missing features, no `x-om-forbidden-redirect: 0`). What reaches this
 * handler is a call that opted out, or a 403 that named nothing — a widget or drawer reading something
 * the role may not see. Redirecting here sent such users to `/login?requireRole=admin` a few seconds
 * after the page loaded, overriding the opt-out (FMS GT 07.10: the rfs role was logged out of every
 * folder page by the tasks widget's background read). A failed READ is left to the component's error
 * state; a failed ACTION says so in a flash message.
 */
export function handleQueryAuthError(error: unknown): void {
  if (error instanceof UnauthorizedError || (error as any)?.status === 401) {
    redirectToSessionRefresh()
    return
  }
  if (error instanceof ForbiddenError || (error as any)?.status === 403) {
    console.warn('[query] forbidden — not redirecting; the component shows its own state', error)
  }
}

export function handleMutationAuthError(error: unknown): void {
  if (error instanceof UnauthorizedError || (error as any)?.status === 401) {
    redirectToSessionRefresh()
    return
  }
  if (error instanceof ForbiddenError || (error as any)?.status === 403) {
    flash("You don't have permission for this action.", 'error')
  }
}

const client = new QueryClient({
  queryCache: new QueryCache({ onError: handleQueryAuthError }),
  mutationCache: new MutationCache({ onError: handleMutationAuthError }),
})

type QueryProviderProps = { children: React.ReactNode; defaultForbiddenRoles?: string[] }

export function QueryProvider({ children, defaultForbiddenRoles }: QueryProviderProps) {
  React.useEffect(() => {
    ensureGlobalFetchInterception()
    if (defaultForbiddenRoles && defaultForbiddenRoles.length) {
      setAuthRedirectConfig({ defaultForbiddenRoles })
    }
  }, [])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
