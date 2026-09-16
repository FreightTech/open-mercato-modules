import { describe, it, expect } from 'vitest'
import {
  blockingHoldCount,
  impedimentsChanged,
  isEmptyReady,
  isImportHoldsCleared,
  type AvailabilityInput,
} from '../availability'

// Catalogue references (see ../holds.ts):
// - blocking:     CUSTOMS IMPORT PERMISSION, LINE IMPORT PERMISSION, EMPTY PERMISSION
// - non-blocking: TECHNICAL FULL CONTAINER, MISSING AGENT PERMISSION
const BLOCKING = '!CUSTOMS IMPORT PERMISSION'
const BLOCKING_2 = '!LINE IMPORT PERMISSION'
const EMPTY_PERMISSION = '!EMPTY PERMISSION'
const NON_BLOCKING = '!TECHNICAL_FULL_CONTAINER'

function evt(
  category: string,
  frghtKind: 'MTY' | 'Empty' | 'FCL',
  transitState: string,
  impediments: string[] | null,
  extraRaw: Record<string, unknown> = {},
): AvailabilityInput {
  return {
    transitState,
    impediments,
    rawData: { Category: category, 'Frght Kind': frghtKind, ...extraRaw },
  }
}

describe('blockingHoldCount', () => {
  it('counts only movement-blocking holds', () => {
    expect(blockingHoldCount([BLOCKING, NON_BLOCKING])).toBe(1)
    expect(blockingHoldCount([BLOCKING, BLOCKING_2])).toBe(2)
    expect(blockingHoldCount([NON_BLOCKING])).toBe(0)
    expect(blockingHoldCount([])).toBe(0)
    expect(blockingHoldCount(null)).toBe(0)
  })
})

describe('isEmptyReady', () => {
  it('fires for an empty in the yard with no blocking holds', () => {
    expect(isEmptyReady(evt('Export', 'MTY', 'S40_YARD', null))).toBe(true)
  })

  it('recognises the real Baltic Hub empty value "Empty" (not just "MTY")', () => {
    expect(isEmptyReady(evt('Storage', 'Empty', 'S40_YARD', null))).toBe(true)
  })

  it('fires regardless of category (empties sit under N4 "Storage")', () => {
    expect(isEmptyReady(evt('Storage', 'MTY', 'S40_YARD', null))).toBe(true)
    expect(isEmptyReady(evt('Import', 'MTY', 'S40_YARD', null))).toBe(true)
  })

  it('fires when only non-blocking holds are present (incl. the real REFFER spelling)', () => {
    expect(isEmptyReady(evt('Storage', 'MTY', 'S40_YARD', [NON_BLOCKING]))).toBe(true)
    expect(isEmptyReady(evt('Storage', 'MTY', 'S40_YARD', ['!TECHNICAL LIVE REFFER']))).toBe(true)
  })

  it('does not fire while EMPTY PERMISSION (or any blocking hold) is present', () => {
    expect(isEmptyReady(evt('Storage', 'MTY', 'S40_YARD', [EMPTY_PERMISSION]))).toBe(false)
  })

  it('does not fire for a full container', () => {
    expect(isEmptyReady(evt('Export', 'FCL', 'S40_YARD', null))).toBe(false)
  })

  it('does not fire when not yet in the yard', () => {
    expect(isEmptyReady(evt('Storage', 'MTY', 'S20_INBOUND', null))).toBe(false)
  })

  it('does not fire while road pickup is explicitly stopped (Stop-Road)', () => {
    expect(isEmptyReady(evt('Storage', 'MTY', 'S40_YARD', null, { 'Stop-Road': 'Y' }))).toBe(false)
  })

  it('still fires when Stop-Road is present but not active, or an unrelated stop is set', () => {
    expect(isEmptyReady(evt('Storage', 'MTY', 'S40_YARD', null, { 'Stop-Road': 'N' }))).toBe(true)
    expect(isEmptyReady(evt('Storage', 'MTY', 'S40_YARD', null, { 'Stop-Vsl': 'Y' }))).toBe(true)
  })
})

describe('isImportHoldsCleared', () => {
  it('fires on the blocked → clear transition for an import in the yard', () => {
    const e = evt('Import', 'FCL', 'S40_YARD', [])
    expect(isImportHoldsCleared(e, [BLOCKING])).toBe(true)
  })

  it('does not fire for a container that was never blocked', () => {
    const e = evt('Import', 'FCL', 'S40_YARD', [])
    expect(isImportHoldsCleared(e, [])).toBe(false)
    expect(isImportHoldsCleared(e, [NON_BLOCKING])).toBe(false)
  })

  it('does not fire while a blocking hold remains', () => {
    const e = evt('Import', 'FCL', 'S40_YARD', [BLOCKING_2])
    expect(isImportHoldsCleared(e, [BLOCKING])).toBe(false)
  })

  it('does not fire when not in the yard', () => {
    const e = evt('Import', 'FCL', 'S20_INBOUND', [])
    expect(isImportHoldsCleared(e, [BLOCKING])).toBe(false)
  })

  it('does not fire for an export leg', () => {
    const e = evt('Export', 'FCL', 'S40_YARD', [])
    expect(isImportHoldsCleared(e, [BLOCKING])).toBe(false)
  })

  it('still fires under a road stop — the transition event is not gated (would be lost, not delayed)', () => {
    const e = evt('Import', 'FCL', 'S40_YARD', [], { 'Stop-Road': 'Y' })
    expect(isImportHoldsCleared(e, [BLOCKING])).toBe(true)
  })
})

describe('impedimentsChanged', () => {
  it('detects an added hold', () => {
    expect(impedimentsChanged([BLOCKING], [BLOCKING, BLOCKING_2])).toBe(true)
  })

  it('detects a removed hold', () => {
    expect(impedimentsChanged([BLOCKING, BLOCKING_2], [BLOCKING])).toBe(true)
  })

  it('treats a null/absent prior with current holds as a change (first appearance)', () => {
    expect(impedimentsChanged(null, [BLOCKING])).toBe(true)
    expect(impedimentsChanged(undefined, [BLOCKING])).toBe(true)
  })

  it('is false when nothing changed (order- and duplicate-insensitive)', () => {
    expect(impedimentsChanged([BLOCKING, BLOCKING_2], [BLOCKING_2, BLOCKING])).toBe(false)
    expect(impedimentsChanged([BLOCKING, BLOCKING], [BLOCKING])).toBe(false)
    expect(impedimentsChanged(null, [])).toBe(false)
    expect(impedimentsChanged([], null)).toBe(false)
  })
})
