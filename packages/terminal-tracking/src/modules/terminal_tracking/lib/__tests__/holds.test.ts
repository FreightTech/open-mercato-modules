import { describe, it, expect } from 'vitest'
import {
  normalizeHoldCode,
  getHoldInfo,
  resolveHolds,
  highestHoldSeverity,
} from '../holds'

describe('normalizeHoldCode', () => {
  it('strips the leading "!" and upper-cases', () => {
    expect(normalizeHoldCode('!dgd hold')).toBe('DGD HOLD')
  })

  it('treats underscore- and space-delimited codes identically', () => {
    expect(normalizeHoldCode('!TECHNICAL_FULL_CONTAINER')).toBe('TECHNICAL FULL CONTAINER')
    expect(normalizeHoldCode('TECHNICAL FULL CONTAINER')).toBe('TECHNICAL FULL CONTAINER')
  })
})

describe('getHoldInfo', () => {
  it('resolves a known critical hold with its explanation', () => {
    const info = getHoldInfo('!CUSTOMS EXPORT HOLD')
    expect(info.unknown).toBe(false)
    expect(info.severity).toBe('critical')
    expect(info.blocksMovement).toBe(true)
    expect(info.category).toBe('export')
    expect(info.rawCode).toBe('!CUSTOMS EXPORT HOLD')
    expect(info.resolution).toMatch(/customs officer/i)
  })

  it('classifies OCR technical holds as non-blocking info', () => {
    const info = getHoldInfo('!TECHNICAL_FULL_CONTAINER')
    expect(info.severity).toBe('info')
    expect(info.blocksMovement).toBe(false)
  })

  it('falls back to a visible warning for unknown codes and shows the raw hold', () => {
    const info = getHoldInfo('!SOME_NEW_HOLD')
    expect(info.unknown).toBe(true)
    expect(info.severity).toBe('warning')
    expect(info.i18nKey).toBe('unknown')
    // Label echoes the raw hold (minus the `!`), not a normalized form.
    expect(info.label).toBe('SOME_NEW_HOLD')
    expect(info.rawCode).toBe('!SOME_NEW_HOLD')
  })
})

describe('resolveHolds', () => {
  it('sorts most-urgent first and drops empties', () => {
    const holds = resolveHolds([
      '!TECHNICAL_FULL_CONTAINER',
      '',
      '!CUSTOMS EXPORT PERMISSION',
      '!DGD HOLD',
    ])
    expect(holds.map((h) => h.severity)).toEqual(['critical', 'warning', 'info'])
  })

  it('returns an empty array for null/empty input', () => {
    expect(resolveHolds(null)).toEqual([])
    expect(resolveHolds([])).toEqual([])
  })
})

describe('highestHoldSeverity', () => {
  it('returns the top severity', () => {
    expect(highestHoldSeverity(['!TECHNICAL_FULL_CONTAINER', '!DGD HOLD'])).toBe('critical')
  })

  it('returns null when there are no holds', () => {
    expect(highestHoldSeverity([])).toBeNull()
  })
})
