'use client'

import * as React from 'react'
import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark' | 'system'

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const THEME_STORAGE_KEY = 'om-theme'

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch (error) {
    // localStorage may be unavailable in private browsing, iframes, or restricted contexts
    // Theme will default to system preference - this is expected graceful degradation
    if (process.env.NODE_ENV === 'development') {
      console.warn('[ThemeProvider] localStorage read failed:', error)
    }
  }
  return 'system'
}

function applyTheme(resolvedTheme: 'light' | 'dark') {
  const root = document.documentElement
  if (resolvedTheme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>('system')
  const [resolvedTheme, setResolvedTheme] = React.useState<'light' | 'dark'>('light')

  // Initialize theme from localStorage on mount
  React.useEffect(() => {
    const stored = getStoredTheme()
    setThemeState(stored)
    const resolved = stored === 'system' ? getSystemTheme() : stored
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [])

  // Listen for system theme changes
  React.useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') {
        const newResolved = getSystemTheme()
        setResolvedTheme(newResolved)
        applyTheme(newResolved)
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const setTheme = React.useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme)
    } catch (error) {
      // localStorage may be unavailable - theme still works for this session, just won't persist
      if (process.env.NODE_ENV === 'development') {
        console.warn('[ThemeProvider] localStorage write failed:', error)
      }
    }
    const resolved = newTheme === 'system' ? getSystemTheme() : newTheme
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [])

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  // Always the Provider, from the first render. Rendering a bare fragment until mount and the Provider
  // after it changed the element at the root of the tree, so React unmounted and remounted the whole
  // app once on every page load — every effect and every fetch ran twice. Before the mount effect the
  // value is the same as useTheme()'s outside-provider default ('system' / 'light'), and the theme class
  // is set before paint by the root layout's inline script, so nothing flashes.
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    // Return safe defaults when not in provider (e.g., server render)
    return {
      theme: 'system',
      resolvedTheme: 'light',
      setTheme: () => {},
    }
  }
  return context
}
