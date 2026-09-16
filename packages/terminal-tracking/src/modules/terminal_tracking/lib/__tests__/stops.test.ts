import { describe, it, expect } from 'vitest'
import {
  parseTerminalStops,
  isRoadStopped,
  activeStopModes,
  stopsChanged,
  NO_STOPS,
} from '../stops'

describe('parseTerminalStops', () => {
  it('returns all-null when no STOP columns are present (pre-update payload)', () => {
    expect(parseTerminalStops({ 'Unit Nbr': 'ABCU1234567', Category: 'Import' })).toEqual(NO_STOPS)
    expect(parseTerminalStops(null)).toEqual(NO_STOPS)
    expect(parseTerminalStops(undefined)).toEqual(NO_STOPS)
  })

  it('reads the documented Stop-Vsl / Stop-Road / Stop-Rail headers', () => {
    expect(
      parseTerminalStops({ 'Stop-Vsl': 'Y', 'Stop-Road': 'Y', 'Stop-Rail': 'Y' }),
    ).toEqual({ vsl: true, road: true, rail: true })
  })

  it('distinguishes a present-but-empty column (false) from an absent one (null)', () => {
    // Stop-Road present with no value -> reported, not stopped; Stop-Vsl absent -> unknown.
    expect(parseTerminalStops({ 'Stop-Road': null, 'Stop-Rail': '' })).toEqual({
      vsl: null,
      road: false,
      rail: false,
    })
  })

  it('matches headers tolerant of casing and punctuation', () => {
    expect(parseTerminalStops({ 'STOP VSL': 'Y' }).vsl).toBe(true)
    expect(parseTerminalStops({ StopRoad: '1' }).road).toBe(true)
    expect(parseTerminalStops({ 'stop_rail': 'true' }).rail).toBe(true)
    expect(parseTerminalStops({ 'Stop-Vessel': 'Y' }).vsl).toBe(true)
  })

  it('treats explicit falsy tokens as no-stop', () => {
    expect(parseTerminalStops({ 'Stop-Road': 'N' }).road).toBe(false)
    expect(parseTerminalStops({ 'Stop-Road': 'No' }).road).toBe(false)
    expect(parseTerminalStops({ 'Stop-Road': '0' }).road).toBe(false)
    expect(parseTerminalStops({ 'Stop-Road': 'false' }).road).toBe(false)
    expect(parseTerminalStops({ 'Stop-Road': '-' }).road).toBe(false)
  })

  it('treats any other non-empty value as an active stop (e.g. a timestamp/reason)', () => {
    expect(parseTerminalStops({ 'Stop-Vsl': '2026-08-04 10:00' }).vsl).toBe(true)
    expect(parseTerminalStops({ 'Stop-Rail': 'CUSTOMS' }).rail).toBe(true)
  })
})

describe('isRoadStopped / activeStopModes', () => {
  it('isRoadStopped is true only on an explicit road stop', () => {
    expect(isRoadStopped({ vsl: null, road: true, rail: null })).toBe(true)
    expect(isRoadStopped({ vsl: null, road: false, rail: null })).toBe(false)
    expect(isRoadStopped({ vsl: null, road: null, rail: null })).toBe(false)
  })

  it('lists active modes in vsl -> road -> rail order', () => {
    expect(activeStopModes({ vsl: true, road: false, rail: true })).toEqual(['vsl', 'rail'])
    expect(activeStopModes(NO_STOPS)).toEqual([])
    expect(activeStopModes({ vsl: true, road: true, rail: true })).toEqual(['vsl', 'road', 'rail'])
  })
})

describe('stopsChanged', () => {
  it('detects an active-stop appearing or clearing on any mode', () => {
    expect(stopsChanged(NO_STOPS, { vsl: null, road: true, rail: null })).toBe(true)
    expect(stopsChanged({ vsl: null, road: false, rail: null }, { vsl: null, road: true, rail: null })).toBe(true)
    expect(stopsChanged({ vsl: true, road: null, rail: null }, { vsl: false, road: null, rail: null })).toBe(true)
  })

  it('treats null (unreported) and false (not stopped) as equivalent — no spurious change', () => {
    // null → false is NOT a change: neither is an active stop.
    expect(stopsChanged({ vsl: null, road: null, rail: null }, { vsl: false, road: false, rail: false })).toBe(false)
    expect(stopsChanged(NO_STOPS, { vsl: null, road: null, rail: null })).toBe(false)
    expect(stopsChanged({ vsl: true, road: false, rail: null }, { vsl: true, road: null, rail: false })).toBe(false)
  })
})
