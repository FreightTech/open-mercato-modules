import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DENSITY_LEVELS,
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_METRICS,
  isDensityLevel,
  resolveDensityAttribute,
  resolveDensityRowHeight,
  type DensityLevel,
} from '../types/density'

const CSS_PATH = resolve(__dirname, '../styles/density.css')
const css = readFileSync(CSS_PATH, 'utf8')

/**
 * Pull the value of a custom property out of a level's variable block.
 * Deliberately a dumb text scan, not a CSS parser: the point is to fail loudly
 * when the two sources of truth drift, and a parser dependency would be a
 * bigger liability than the regex.
 */
function readVar(level: DensityLevel, prop: string): string | null {
  const blockMatch = css.match(
    new RegExp(String.raw`\[data-density-level="${level}"\]\s*\{([\s\S]*?)\}`),
  )
  if (!blockMatch) return null
  const declMatch = blockMatch[1].match(new RegExp(String.raw`${prop}\s*:\s*([^;]+);`))
  return declMatch ? declMatch[1].trim() : null
}

describe('density scale — the setting', () => {
  it('defaults to Tight — the designer\'s decision of 02.09', () => {
    expect(DEFAULT_DENSITY).toBe('dense')
  })

  it('exposes exactly three levels, coarsest first', () => {
    expect(DENSITY_LEVELS).toEqual(['comfortable', 'compact', 'dense'])
  })

  it('does NOT reuse the legacy `data-density` attribute', () => {
    // `data-density` already carries the developer-facing 'sm' | 'md' prop, and
    // DynamicTable.v2.css has `:not([data-density])` rules that define part of
    // today's DEFAULT rendering. Reusing it would switch those off the moment a
    // user picked `comfortable`.
    expect(DENSITY_ATTRIBUTE).toBe('data-density-level')
    expect(DENSITY_ATTRIBUTE).not.toBe('data-density')
  })
})

describe('resolveDensityAttribute', () => {
  it('maps each level to its own attribute value', () => {
    for (const level of DENSITY_LEVELS) {
      expect(resolveDensityAttribute(level)).toBe(level)
    }
  })

  it('falls back to the default for a corrupt stored preference', () => {
    // A bad value in localStorage must not break the grid.
    expect(resolveDensityAttribute(undefined)).toBe(DEFAULT_DENSITY)
    expect(resolveDensityAttribute(null)).toBe(DEFAULT_DENSITY)
    expect(resolveDensityAttribute('cosy' as unknown as DensityLevel)).toBe(DEFAULT_DENSITY)
  })

  it('is pure — same input, same interned output, no allocation', () => {
    expect(resolveDensityAttribute('dense')).toBe(resolveDensityAttribute('dense'))
  })
})

describe('isDensityLevel', () => {
  it('accepts only the three levels', () => {
    expect(isDensityLevel('comfortable')).toBe(true)
    expect(isDensityLevel('compact')).toBe(true)
    expect(isDensityLevel('dense')).toBe(true)
    for (const bad of ['', 'DENSE', 'sm', 'md', 0, null, undefined, {}]) {
      expect(isDensityLevel(bad)).toBe(false)
    }
  })
})

describe('density metrics ↔ density.css', () => {
  it('is the designer\'s scale: Roomy 48 / Medium 44 / Tight 34', () => {
    // gt-demo tokens/material.css: --md-table-row-comfortable / -medium / -compact.
    expect(DENSITY_METRICS.comfortable.rowHeight).toBe(48)
    expect(DENSITY_METRICS.compact.rowHeight).toBe(44)
    expect(DENSITY_METRICS.dense.rowHeight).toBe(34)
    for (const level of DENSITY_LEVELS) {
      expect(DENSITY_METRICS[level].headerHeight).toBeNull()
      expect(readVar(level, '--dt-header-height')).toBe('auto')
    }
  })

  it('row heights strictly decrease across the scale', () => {
    const heights = DENSITY_LEVELS.map((l) => DENSITY_METRICS[l].rowHeight)
    expect(heights).toEqual([...heights].sort((a, b) => b - a))
    expect(new Set(heights).size).toBe(heights.length)
  })

  it.each(DENSITY_LEVELS)(
    '%s: --dt-row-height in CSS equals DENSITY_METRICS (the virtualizer reads the TS one)',
    (level) => {
      // The virtualizer positions rows with translateY from the TS number while
      // the box model comes from the CSS one. Drift = overlapping rows.
      expect(readVar(level, '--dt-row-height')).toBe(`${DENSITY_METRICS[level].rowHeight}px`)
    },
  )

  it('every level declares the full variable set — a missing var silently inherits', () => {
    const required = [
      '--dt-row-height',
      '--dt-row-gap-top',
      '--dt-row-gap-bottom',
      '--dt-row-rule-color',
      '--dt-cell-pad-y',
      '--dt-cell-pad-x',
      '--dt-header-height',
      '--dt-header-pad-y',
      '--dt-header-pad-x',
      '--dt-header-gap',
      '--dt-cell-font-size',
      '--dt-cell-line-height',
      '--dt-cell-letter-spacing',
      '--dt-mono-font-size',
      '--dt-mono-line-height',
      '--dt-mono-letter-spacing',
      '--dt-header-font-size',
      '--dt-header-line-height',
      '--dt-header-letter-spacing',
      '--dt-header-font-weight',
      '--dt-badge-pad-y',
      '--dt-badge-pad-x',
      '--dt-badge-font-size',
      '--dt-badge-line-height',
      '--dt-editor-inset-y',
      '--dt-editor-inset-x',
      '--dt-editor-pad-x',
      '--dt-editor-line-height',
    ]
    // Collect first, assert once — a missing var then names itself in the diff
    // instead of failing as an anonymous `null`.
    const missing: string[] = []
    for (const level of DENSITY_LEVELS) {
      for (const prop of required) {
        if (readVar(level, prop) === null) missing.push(`${level} ${prop}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('the box model closes: padding + borders + line-height fit inside the row', () => {
    const px = (v: string | null) => Number.parseFloat(v ?? 'NaN')
    // Resolved line-heights, in px, of the token each level points its data
    // cells at (comfortable/compact → body/regular/xs 16px, dense → 2xs 14px).
    const lineHeightPx: Record<DensityLevel, number> = {
      comfortable: 16,
      compact: 16,
      dense: 16,
    }
    const overflowing = DENSITY_LEVELS.filter((level) => {
      const chrome =
        px(readVar(level, '--dt-row-gap-top')) +
        px(readVar(level, '--dt-row-gap-bottom')) +
        2 * px(readVar(level, '--dt-cell-pad-y'))
      return DENSITY_METRICS[level].rowHeight - chrome < lineHeightPx[level]
    })
    expect(overflowing).toEqual([])
  })

  it('every level keeps the rounded-pill rows — no hairline rules', () => {
    for (const level of DENSITY_LEVELS) {
      expect(readVar(level, '--dt-row-gap-top')).toBe('2px')
      expect(readVar(level, '--dt-row-rule-color')).toBe('transparent')
    }
  })

  it.each(['--dt-cell-font-size', '--dt-cell-line-height', '--dt-mono-font-size', '--dt-header-font-size', '--dt-badge-font-size'])(
    'the same type at every level (%s) — density changes the air, not the data',
    (name) => {
      const values = new Set(DENSITY_LEVELS.map((level) => readVar(level, name)))
      expect(values.size).toBe(1)
    },
  )
})

describe('every level goes through the variables', () => {
  it('no consuming rule skips a level', () => {
    // The designer's scale owns the geometry of all three levels, so nothing
    // may exclude one — an excluded level would silently fall back to the
    // v2 stylesheet's 32px-row box model inside a 48px row.
    expect(css).not.toContain(':not([data-density-level')
  })
})

describe('resolveDensityRowHeight', () => {
  it('returns the level height, or the default height for junk', () => {
    expect(resolveDensityRowHeight('dense')).toBe(DENSITY_METRICS.dense.rowHeight)
    expect(resolveDensityRowHeight('nope' as unknown as DensityLevel)).toBe(
      DENSITY_METRICS[DEFAULT_DENSITY].rowHeight,
    )
  })
})
