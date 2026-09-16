/**
 * The abbreviation registry's CHANGE NOTIFICATION.
 *
 * Why this is worth its own test file: the dictionary is fetched once at app
 * boot, which routinely resolves AFTER a grid has already painted every cell
 * with the long names. Registration therefore has to do two things — fill the
 * registry, and tell somebody — and only the first of those is obvious. A
 * regression here is silent and looks exactly like "the abbreviations feature
 * doesn't work": cells keep showing "Port Gdańsk" until the user happens to
 * sort or page, and nothing errors.
 */

import {
  ABBREV_FACILITY,
  abbreviate,
  abbreviationsVersion,
  contractorToAbbreviation,
  facilityToAbbreviation,
  registerAbbreviations,
  registerAbbreviationSeed,
  resetAbbreviations,
  subscribeAbbreviations,
} from '../utils/abbreviations'

const NS = 'test-namespace'

afterEach(() => {
  resetAbbreviations()
})

describe('subscribeAbbreviations', () => {
  it('notifies subscribers when a runtime dictionary is registered', () => {
    const seen: number[] = []
    const stop = subscribeAbbreviations(() => seen.push(abbreviationsVersion()))

    registerAbbreviations(NS, [{ match: ['Port Gdansk'], short: 'GDN' }])

    expect(seen).toHaveLength(1)
    stop()
  })

  it('notifies on seed registration too — a seed changes what cells render', () => {
    const listener = jest.fn()
    const stop = subscribeAbbreviations(listener)

    registerAbbreviationSeed(NS, [{ match: ['Baltic Hub'], short: 'BHCT' }])

    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('bumps the version monotonically so memo dependencies actually change', () => {
    const before = abbreviationsVersion()
    registerAbbreviations(NS, [{ match: ['a'], short: 'A' }])
    const mid = abbreviationsVersion()
    registerAbbreviations(NS, [{ match: ['b'], short: 'B' }])

    expect(mid).toBeGreaterThan(before)
    expect(abbreviationsVersion()).toBeGreaterThan(mid)
  })

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn()
    const stop = subscribeAbbreviations(listener)
    stop()

    registerAbbreviations(NS, [{ match: ['a'], short: 'A' }])

    expect(listener).not.toHaveBeenCalled()
  })

  it('a throwing subscriber does not prevent the others being told', () => {
    // One broken consumer must not cost every OTHER grid on the page its
    // dictionary — the failure would be invisible and asymmetric.
    const good = jest.fn()
    const stopBad = subscribeAbbreviations(() => {
      throw new Error('subscriber blew up')
    })
    const stopGood = subscribeAbbreviations(good)

    expect(() => registerAbbreviations(NS, [{ match: ['a'], short: 'A' }])).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)

    stopBad()
    stopGood()
  })

  it('registration invalidates cached MISSES, not just cached hits', () => {
    // The common case by far: the grid rendered and asked for a value before
    // the dictionary arrived, so the registry cached `null` for it. If that
    // negative result survived registration the cell would never fold.
    expect(abbreviate(NS, 'Port Gdansk')).toBeNull()

    registerAbbreviations(NS, [{ match: ['Port Gdansk'], short: 'GDN' }])

    expect(abbreviate(NS, 'Port Gdansk')).toBe('GDN')
  })
})

describe('the boot payload adapters', () => {
  it('facilityToAbbreviation prefers the curated short name over code and locode', () => {
    expect(
      facilityToAbbreviation({ name: 'Baltic Hub', shortName: 'BHCT', code: 'DCT', locode: 'PLGDN' })?.short,
    ).toBe('BHCT')
  })

  it('falls back to the code, then the locode', () => {
    expect(facilityToAbbreviation({ name: 'X', code: 'BCT', locode: 'PLGDY' })?.short).toBe('BCT')
    expect(facilityToAbbreviation({ name: 'X', locode: 'PLGDY' })?.short).toBe('PLGDY')
  })

  it('skips a facility with nothing to abbreviate to rather than guessing', () => {
    expect(facilityToAbbreviation({ name: 'Some Unnamed Depot' })).toBeNull()
  })

  // Found in the browser against the live table: 1738 facilities whose
  // `short_name` is null and whose `code` is a generated geohash key. The
  // original precedence preferred `code`, which rendered "Port Gdańsk" as
  // "N031E031-04…" — longer than the LOCODE and truncated in an 84px column.
  it('rejects a machine-generated code and falls through to the LOCODE', () => {
    expect(
      facilityToAbbreviation({ name: 'Aalborg Container Terminal', code: 'N057E010-02981', locode: 'DKAAL' })?.short,
    ).toBe('DKAAL')
    expect(
      facilityToAbbreviation({ name: 'Some Depot', code: 'ADDR-1BF4-9C3E', locode: 'PLGDN' })?.short,
    ).toBe('PLGDN')
  })

  it('still prefers a genuine short trade code over the LOCODE', () => {
    expect(facilityToAbbreviation({ name: 'Baltic CT', code: 'BCT', locode: 'PLGDY' })?.short).toBe('BCT')
  })

  it('emits no entry at all when every candidate is an internal id', () => {
    // The full name is the honest rendering — never a truncated machine key.
    expect(facilityToAbbreviation({ name: 'Nowhere Terminal', code: 'ADDR-1BF4-9C3E' })).toBeNull()
  })

  it('never length-checks a CURATED short name — staff intent wins', () => {
    expect(
      facilityToAbbreviation({ name: 'X', shortName: 'Gdansk North Quay', code: 'BCT' })?.short,
    ).toBe('Gdansk North Quay')
  })

  it('contractorToAbbreviation derives nothing — it only delivers a curated short name', () => {
    expect(contractorToAbbreviation({ name: 'Maersk Polska Sp. z o.o.', shortName: 'MAERSK' })?.short).toBe('MAERSK')
    // No short name → no entry, so the grid keeps the full legal name. A second
    // derivation scheme here would drift from the one staff maintain.
    expect(contractorToAbbreviation({ name: 'Maersk Polska Sp. z o.o.' })).toBeNull()
    // Identical short and full is not an abbreviation; shipping it would only
    // add a registry entry that resolves to the value it replaced.
    expect(contractorToAbbreviation({ name: 'DHL', shortName: 'DHL' })).toBeNull()
  })
})

describe('the shipped seed keeps a fresh deployment readable', () => {
  it('folds the Polish terminals INF names out loud, diacritics and all', () => {
    expect(abbreviate(ABBREV_FACILITY, 'Port Gdańsk')).toBe('GDN')
    expect(abbreviate(ABBREV_FACILITY, 'port gdansk')).toBe('GDN')
    expect(abbreviate(ABBREV_FACILITY, 'Baltic Hub')).toBe('BHCT')
    expect(abbreviate(ABBREV_FACILITY, 'DCT Gdańsk')).toBe('BHCT')
  })

  it('a database registration outranks the seed', () => {
    registerAbbreviations(ABBREV_FACILITY, [{ match: ['Port Gdansk'], short: 'GDA' }])
    expect(abbreviate(ABBREV_FACILITY, 'Port Gdańsk')).toBe('GDA')
  })

  it('leaves an uncurated value alone rather than inventing one', () => {
    expect(abbreviate(ABBREV_FACILITY, 'Some Regional Depot')).toBeNull()
  })
})
