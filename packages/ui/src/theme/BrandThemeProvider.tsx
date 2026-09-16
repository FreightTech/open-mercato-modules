'use client'

import * as React from 'react'
import { useTheme } from './ThemeProvider'

/**
 * Theme color overrides that map to CSS custom properties.
 * Used for brand-specific theming (e.g., FreightTech, INF).
 */
export interface ThemeColors {
  background?: string
  foreground?: string
  primary?: string
  primaryForeground?: string
  secondary?: string
  secondaryForeground?: string
  accent?: string
  accentForeground?: string
  muted?: string
  mutedForeground?: string
  border?: string
  card?: string
  cardForeground?: string
  sidebar?: string
  sidebarForeground?: string
  sidebarPrimary?: string
  sidebarPrimaryForeground?: string
  sidebarAccent?: string
  sidebarAccentForeground?: string
  sidebarBorder?: string
}

export interface BrandThemeProviderProps {
  children: React.ReactNode
  /** Base theme color overrides (applied to both modes unless overridden) */
  colors?: ThemeColors
  /** Light mode specific colors (merged on top of base colors) */
  light?: ThemeColors
  /** Dark mode specific colors (merged on top of base colors) */
  dark?: ThemeColors
}

/**
 * Maps theme color keys to CSS custom property names
 */
const colorToCssVar: Record<keyof ThemeColors, string> = {
  background: '--background',
  foreground: '--foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  border: '--border',
  card: '--card',
  cardForeground: '--card-foreground',
  sidebar: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
}

/**
 * Brand theme provider that applies custom CSS variables for brand theming.
 * Colors are applied as CSS custom properties on a wrapper element.
 *
 * Supports separate light/dark mode color sets:
 * - `colors`: Base colors applied to both modes
 * - `light`: Light mode specific colors (merged on top of base)
 * - `dark`: Dark mode specific colors (merged on top of base)
 *
 * This component is designed to be used within a ThemeProvider to access
 * the current resolved theme (light/dark).
 *
 * @example
 * ```tsx
 * <ThemeProvider>
 *   <BrandThemeProvider
 *     colors={brandConfig?.theme?.colors}
 *     light={brandConfig?.theme?.light}
 *     dark={brandConfig?.theme?.dark}
 *   >
 *     <App />
 *   </BrandThemeProvider>
 * </ThemeProvider>
 * ```
 */
export function BrandThemeProvider({ children, colors, light, dark }: BrandThemeProviderProps) {
  const { resolvedTheme } = useTheme()

  const style = React.useMemo(() => {
    // Merge: base colors + mode-specific colors (mode takes precedence)
    const modeColors = resolvedTheme === 'dark' ? dark : light
    const merged = { ...colors, ...modeColors }

    if (!Object.keys(merged).length) return undefined

    const cssVars: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
      if (value && key in colorToCssVar) {
        cssVars[colorToCssVar[key as keyof ThemeColors]] = value
      }
    }
    return Object.keys(cssVars).length > 0 ? cssVars : undefined
  }, [colors, light, dark, resolvedTheme])

  if (!style) {
    return <>{children}</>
  }

  return (
    <div style={style as React.CSSProperties} className="contents">
      {children}
    </div>
  )
}
