/**
 * Tests for compact label rendering — workshop item A9 plus general text
 * fitting.
 *
 * The load-bearing cases here are the ones where getting it wrong is WORSE than
 * not shortening at all:
 *   - two colleagues collapsing to the same initials,
 *   - a middle name stealing a character from the surname,
 *   - a container number tail-clipped down to its shared prefix,
 *   - a dictionary guessing at a facility nobody curated.
 */

import {
  ABBREV_CONTRACTOR,
  ABBREV_FACILITY,
  abbreviate,
  contractorToAbbreviation,
  facilityToAbbreviation,
  getAbbreviationSnapshot,
  lookupAbbreviation,
  normalizeAbbreviationKey,
  registerAbbreviations,
  registerAbbreviationSeed,
  resetAbbreviations,
  abbreviationsVersion,
} from '../utils/abbreviations'
import {
  buildInitialsIndex,
  detectFitMode,
  fitText,
  formatAssignee,
  formatContractor,
  formatFacility,
  formatInitials,
  formatLabelCompact,
  nameTokens,
  toDisplayString,
  truncateMiddle,
  truncateTail,
  ELLIPSIS,
} from '../utils/formatLabelCompact'

beforeEach(() => {
  resetAbbreviations()
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. ASSIGNEE → INITIALS
// ─────────────────────────────────────────────────────────────────────────────

describe('formatInitials — the basics', () => {
  it('takes the first and last token, not every token', () => {
    // A middle name is not what distinguishes colleagues; spending a third
    // character on it costs column width for information nobody reads.
    expect(formatInitials('Anna Maria Kowalska')).toBe('AK')
    expect(formatInitials('Anna Kowalska')).toBe('AK')
  })

  it('uppercases regardless of input casing', () => {
    expect(formatInitials('anna kowalska')).toBe('AK')
  })

  it('returns a single letter for a mononym', () => {
    expect(formatInitials('Szymon')).toBe('S')
  })

  it('is empty for input with no letters at all', () => {
    expect(formatInitials('???')).toBe('')
    expect(formatInitials('')).toBe('')
    expect(formatInitials(null)).toBe('')
    expect(formatInitials(undefined)).toBe('')
  })
})

describe('formatInitials — Polish names', () => {
  it('keeps BOTH parts of a hyphenated surname', () => {
    // The compound is exactly what identifies the person. "AN" would collide
    // with every other Nowak in the office.
    expect(formatInitials('Agnieszka Nowak-Kowalska')).toBe('ANK')
  })

  it('handles a hyphenated surname with a middle name present', () => {
    expect(formatInitials('Agnieszka Maria Nowak-Kowalska')).toBe('ANK')
  })

  it('handles three-part compound surnames', () => {
    expect(formatInitials('Jan Nowak-Kowalski-Wisniewski')).toBe('JNKW')
  })

  it('preserves Polish diacritics in the initial', () => {
    // Ł stays Ł. The dictionary FOLDS diacritics for matching, but an initial is
    // read, not matched — "LZ" for Łukasz Żółć would look like a mojibake bug.
    expect(formatInitials('Łukasz Żółć')).toBe('ŁŻ')
    expect(formatInitials('Ćwikła Śliwa')).toBe('ĆŚ')
  })

  it('uppercases a Polish lowercase initial correctly', () => {
    expect(formatInitials('łukasz świątek')).toBe('ŁŚ')
  })

  it('accepts the en-dash used in some directory exports', () => {
    expect(formatInitials('Agnieszka Nowak–Kowalska')).toBe('ANK')
  })
})

describe('formatInitials — inputs that would produce a WRONG initial', () => {
  it('ignores honorifics', () => {
    // "DK" identifies nobody.
    expect(formatInitials('Dr Anna Kowalska')).toBe('AK')
    expect(formatInitials('mgr inż. Piotr Zieliński')).toBe('PZ')
  })

  it('ignores name particles', () => {
    expect(formatInitials('Ludwig van Beethoven')).toBe('LB')
    expect(formatInitials('Charles de Gaulle')).toBe('CG')
  })

  it('re-orders "Surname, Given" before initialling', () => {
    // Directory exports use this order; initialling it verbatim gives "KA",
    // which is a wrong initial rather than merely an ugly one.
    expect(formatInitials('Kowalska, Anna')).toBe('AK')
    expect(formatInitials('Nowak-Kowalska, Agnieszka')).toBe('ANK')
  })

  it('derives initials from an email address', () => {
    // An un-onboarded assignee shows up as their email; "AK" beats "a".
    expect(formatInitials('anna.kowalska@example.com')).toBe('AK')
    expect(formatInitials('a_kowalska@example.com')).toBe('AK')
  })

  it('collapses irregular whitespace', () => {
    expect(formatInitials('  Anna   Kowalska  ')).toBe('AK')
  })
})

describe('nameTokens', () => {
  it('splits compounds and drops noise', () => {
    expect(nameTokens('Dr Agnieszka Nowak-Kowalska')).toEqual(['Agnieszka', 'Nowak', 'Kowalska'])
  })

  it('returns an empty list when nothing usable survives', () => {
    expect(nameTokens('   ')).toEqual([])
    expect(nameTokens('van de')).toEqual([])
  })
})

describe('buildInitialsIndex — collision resolution', () => {
  it('leaves non-colliding names at plain initials', () => {
    const index = buildInitialsIndex(['Anna Kowalska', 'Piotr Zieliński'])
    expect(index.get('Anna Kowalska')).toBe('AK')
    expect(index.get('Piotr Zieliński')).toBe('PZ')
  })

  it('ESCALATES a colliding pair rather than showing the same initials twice', () => {
    // The whole reason the index exists: "AK" for both would send work to the
    // wrong person with nothing in the UI to reveal it.
    const index = buildInitialsIndex(['Anna Kowalska', 'Adam Kowalski'])
    expect(index.get('Anna Kowalska')).not.toBe(index.get('Adam Kowalski'))
  })

  it('escalates to the full surname when three characters are not enough', () => {
    // "AKow" is identical for both, so level 2 cannot separate them and the
    // resolver must go to level 3.
    const index = buildInitialsIndex(['Anna Kowalska', 'Adam Kowalski'])
    expect(index.get('Anna Kowalska')).toBe('A.Kowalska')
    expect(index.get('Adam Kowalski')).toBe('A.Kowalski')
  })

  it('separates at level 2 when three surname characters suffice', () => {
    const index = buildInitialsIndex(['Anna Kowalska', 'Adam Kaczmarek'])
    expect(index.get('Anna Kowalska')).toBe('AKow')
    expect(index.get('Adam Kaczmarek')).toBe('AKac')
  })

  it('escalates the WHOLE colliding group to one level, for visual consistency', () => {
    const index = buildInitialsIndex(['Anna Kowalska', 'Adam Kaczmarek', 'Alicja Kubiak'])
    expect(index.get('Anna Kowalska')).toBe('AKow')
    expect(index.get('Adam Kaczmarek')).toBe('AKac')
    expect(index.get('Alicja Kubiak')).toBe('AKub')
  })

  it('does NOT escalate an unrelated name because someone else collided', () => {
    // One unlucky pair must not widen the column for everybody.
    const index = buildInitialsIndex(['Anna Kowalska', 'Adam Kowalski', 'Piotr Zieliński'])
    expect(index.get('Piotr Zieliński')).toBe('PZ')
  })

  it('falls back to the full name when two people are genuinely identical', () => {
    const index = buildInitialsIndex(['Jan Nowak', 'Jan Nowak '])
    // Dedupe collapses them — one entry, plain initials.
    expect(index.get('Jan Nowak')).toBe('JN')
  })

  it('gives up on shortening rather than being ambiguous', () => {
    // Two distinct people whose escalation forms all coincide.
    const index = buildInitialsIndex(['Jan Nowak', 'Jan Nowak-'])
    const values = [...index.values()]
    expect(new Set(values).size).toBe(values.length)
  })

  it('treats duplicates in the roster as ONE person, not a collision', () => {
    // A roster derived from row data repeats an assignee once per row.
    const index = buildInitialsIndex(['Anna Kowalska', 'Anna Kowalska', 'Anna Kowalska'])
    expect(index.get('Anna Kowalska')).toBe('AK')
  })

  it('is deterministic regardless of roster order', () => {
    const forward = buildInitialsIndex(['Anna Kowalska', 'Adam Kaczmarek', 'Piotr Zieliński'])
    const reverse = buildInitialsIndex(['Piotr Zieliński', 'Adam Kaczmarek', 'Anna Kowalska'])
    expect([...forward.entries()].sort()).toEqual([...reverse.entries()].sort())
  })

  it('ignores null and blank roster entries', () => {
    const index = buildInitialsIndex(['Anna Kowalska', null, undefined, '   '])
    expect(index.size).toBe(1)
  })

  it('maps an un-initialisable name to itself rather than to a blank cell', () => {
    const index = buildInitialsIndex(['???'])
    expect(index.get('???')).toBe('???')
  })
})

describe('formatAssignee', () => {
  it('uses the index when supplied', () => {
    const index = buildInitialsIndex(['Anna Kowalska', 'Adam Kowalski'])
    const label = formatAssignee('Anna Kowalska', index)
    expect(label.text).toBe('A.Kowalska')
    expect(label.title).toBe('Anna Kowalska')
    expect(label.shortened).toBe(true)
  })

  it('degrades to uncollided initials without an index', () => {
    // Correct in a single-name context, and acceptable before the roster loads:
    // the full name is always in the tooltip.
    expect(formatAssignee('Anna Kowalska').text).toBe('AK')
  })

  it('always carries the full name as the title', () => {
    expect(formatAssignee('Agnieszka Nowak-Kowalska').title).toBe('Agnieszka Nowak-Kowalska')
  })

  it('reports not-shortened when the name cannot be folded', () => {
    const label = formatAssignee('S')
    expect(label.text).toBe('S')
    expect(label.shortened).toBe(false)
  })

  it('is empty for blank input', () => {
    expect(formatAssignee(null).text).toBe('')
    expect(formatAssignee('   ').text).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. PORTS / TERMINALS — the CENTRAL dictionary
// ─────────────────────────────────────────────────────────────────────────────

describe('abbreviations — normalization', () => {
  it('folds case, Polish diacritics and whitespace into one key', () => {
    expect(normalizeAbbreviationKey('Port  Gdańsk ')).toBe('port gdansk')
    expect(normalizeAbbreviationKey('PORT GDANSK')).toBe('port gdansk')
    expect(normalizeAbbreviationKey('Świnoujście')).toBe('swinoujscie')
  })

  it('folds Ł, which NFD alone would miss', () => {
    // `ł` is a distinct letter, not `l` plus a combining mark — the single most
    // common Polish case, and the reason this is a table rather than normalize().
    expect(normalizeAbbreviationKey('Łódź')).toBe('lodz')
  })
})

describe('abbreviations — the shipped seed', () => {
  it('resolves the terminals from workshop A9', () => {
    expect(abbreviate(ABBREV_FACILITY, 'Baltic Container Terminal')).toBe('BCT')
    expect(abbreviate(ABBREV_FACILITY, 'Gdynia Container Terminal')).toBe('GCT')
    expect(abbreviate(ABBREV_FACILITY, 'Baltic Hub')).toBe('BHCT')
  })

  it('turns "Port Gdansk" into a code — the exact complaint in A9', () => {
    expect(abbreviate(ABBREV_FACILITY, 'Port Gdansk')).toBe('GDN')
    expect(abbreviate(ABBREV_FACILITY, 'Port Gdańsk')).toBe('GDN')
  })

  it('resolves aliases and LOCODEs to the same label', () => {
    expect(abbreviate(ABBREV_FACILITY, 'DCT Gdansk')).toBe('BHCT')
    expect(abbreviate(ABBREV_FACILITY, 'PLGDY')).toBe('GDY')
  })

  it('returns null for an uncurated facility rather than guessing', () => {
    // A wrong abbreviation is worse than a long name: the operator can no
    // longer tell two terminals apart.
    expect(abbreviate(ABBREV_FACILITY, 'Some Unknown Terminal')).toBeNull()
  })

  it('returns null for blank input', () => {
    expect(abbreviate(ABBREV_FACILITY, null)).toBeNull()
    expect(abbreviate(ABBREV_FACILITY, '')).toBeNull()
  })
})

describe('abbreviations — precedence: the DATABASE outranks the shipped seed', () => {
  it('lets a registered runtime entry override the seed', () => {
    // This is how a deployment "configures centrally": it edits the facilities
    // admin screen, and layer 1 supersedes anything in code.
    registerAbbreviations(ABBREV_FACILITY, [
      { match: ['Baltic Hub'], short: 'HUB', full: 'Baltic Hub Container Terminal' },
    ])
    expect(abbreviate(ABBREV_FACILITY, 'Baltic Hub')).toBe('HUB')
  })

  it('still falls back to the seed for entries the runtime layer lacks', () => {
    registerAbbreviations(ABBREV_FACILITY, [{ match: ['Baltic Hub'], short: 'HUB' }])
    expect(abbreviate(ABBREV_FACILITY, 'Port Gdynia')).toBe('GDY')
  })

  it('REPLACES the runtime layer by default, leaving no tombstones', () => {
    // A refetch after a deletion in the admin screen must not keep serving the
    // deleted label.
    registerAbbreviations(ABBREV_FACILITY, [{ match: ['Terminal X'], short: 'TX' }])
    expect(abbreviate(ABBREV_FACILITY, 'Terminal X')).toBe('TX')
    registerAbbreviations(ABBREV_FACILITY, [{ match: ['Terminal Y'], short: 'TY' }])
    expect(abbreviate(ABBREV_FACILITY, 'Terminal X')).toBeNull()
  })

  it('merges when asked, for paged dictionary loads', () => {
    registerAbbreviations(ABBREV_FACILITY, [{ match: ['Terminal X'], short: 'TX' }])
    registerAbbreviations(ABBREV_FACILITY, [{ match: ['Terminal Y'], short: 'TY' }], { merge: true })
    expect(abbreviate(ABBREV_FACILITY, 'Terminal X')).toBe('TX')
    expect(abbreviate(ABBREV_FACILITY, 'Terminal Y')).toBe('TY')
  })

  it('lets a deployment extend the seed layer without forking the file', () => {
    registerAbbreviationSeed(
      ABBREV_FACILITY,
      [{ match: ['Rotterdam World Gateway'], short: 'RWG' }],
      { merge: true },
    )
    expect(abbreviate(ABBREV_FACILITY, 'Rotterdam World Gateway')).toBe('RWG')
    expect(abbreviate(ABBREV_FACILITY, 'Port Gdansk')).toBe('GDN')
  })

  it('keeps namespaces from colliding', () => {
    // A contractor called "Baltic Hub" must not be abbreviated by a port rule.
    registerAbbreviations(ABBREV_CONTRACTOR, [{ match: ['Baltic Hub'], short: 'BH SP' }])
    expect(abbreviate(ABBREV_FACILITY, 'Baltic Hub')).toBe('BHCT')
    expect(abbreviate(ABBREV_CONTRACTOR, 'Baltic Hub')).toBe('BH SP')
  })

  it('ignores entries with no label or an empty match key', () => {
    registerAbbreviations(ABBREV_FACILITY, [
      { match: ['   '], short: 'NOPE' },
      { match: ['Valid'], short: '' },
    ])
    expect(abbreviate(ABBREV_FACILITY, '   ')).toBeNull()
    expect(abbreviate(ABBREV_FACILITY, 'Valid')).toBeNull()
  })
})

describe('abbreviations — cache correctness', () => {
  it('invalidates a cached MISS when the dictionary later loads', () => {
    // The grid renders before the dictionary arrives; without this the column
    // would keep showing long names forever.
    expect(abbreviate(ABBREV_FACILITY, 'Terminal Z')).toBeNull()
    registerAbbreviations(ABBREV_FACILITY, [{ match: ['Terminal Z'], short: 'TZ' }])
    expect(abbreviate(ABBREV_FACILITY, 'Terminal Z')).toBe('TZ')
  })

  it('caches repeated lookups of the same raw string', () => {
    // The hot path: the same ~20 ports across thousands of rows.
    abbreviate(ABBREV_FACILITY, 'Port Gdansk')
    abbreviate(ABBREV_FACILITY, 'Port Gdansk')
    expect(getAbbreviationSnapshot(ABBREV_FACILITY).cached).toBe(1)
  })

  it('bumps the version on every registration, so memos can invalidate', () => {
    const before = abbreviationsVersion()
    registerAbbreviations(ABBREV_FACILITY, [{ match: ['A'], short: 'B' }])
    expect(abbreviationsVersion()).toBeGreaterThan(before)
  })
})

describe('facilityToAbbreviation — adapting a DB row', () => {
  it('prefers the curated short_name', () => {
    const entry = facilityToAbbreviation({
      name: 'Baltic Container Terminal Gdynia',
      code: 'BCT',
      shortName: 'BCT Gdynia',
    })
    expect(entry?.short).toBe('BCT Gdynia')
  })

  it("falls back to the facility's own code — which IS the terminal code", () => {
    const entry = facilityToAbbreviation({ name: 'Baltic Container Terminal', code: 'BCT' })
    expect(entry?.short).toBe('BCT')
  })

  it('falls back to the LOCODE last', () => {
    const entry = facilityToAbbreviation({ name: 'Port of Somewhere', locode: 'PLXYZ' })
    expect(entry?.short).toBe('PLXYZ')
  })

  it('SKIPS a row with nothing curated rather than inventing a label', () => {
    expect(facilityToAbbreviation({ name: 'Port of Somewhere' })).toBeNull()
  })

  it('matches on name, code and LOCODE alike, so any bound column folds', () => {
    const entry = facilityToAbbreviation({
      name: 'Baltic Hub',
      code: 'BHCT',
      locode: 'PLGDN',
      shortName: 'BHCT',
    })!
    registerAbbreviations(ABBREV_FACILITY, [entry])
    expect(abbreviate(ABBREV_FACILITY, 'Baltic Hub')).toBe('BHCT')
    expect(abbreviate(ABBREV_FACILITY, 'PLGDN')).toBe('BHCT')
  })

  it('uses the full name as the tooltip', () => {
    const entry = facilityToAbbreviation({ name: 'Baltic Hub', code: 'BHCT' })
    expect(entry?.full).toBe('Baltic Hub')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. CONTRACTORS — reuse the field that already exists
// ─────────────────────────────────────────────────────────────────────────────

describe('contractorToAbbreviation', () => {
  it('uses the existing curated short_name', () => {
    const entry = contractorToAbbreviation({
      name: 'Przedsiębiorstwo Transportowe Kowalski Sp. z o.o.',
      shortName: 'PT Kowalski',
    })!
    expect(entry.short).toBe('PT Kowalski')
    expect(entry.full).toBe('Przedsiębiorstwo Transportowe Kowalski Sp. z o.o.')
  })

  it('DERIVES NOTHING when short_name is absent', () => {
    // `packages/contractors/.../lib/short-name.ts` already owns derivation. A
    // second scheme here would drift from the one staff maintain.
    expect(contractorToAbbreviation({ name: 'Kowalski Sp. z o.o.' })).toBeNull()
  })

  it('skips a short name identical to the full name — no gain', () => {
    expect(contractorToAbbreviation({ name: 'Kowalski', shortName: 'Kowalski' })).toBeNull()
  })

  it('folds a registered contractor in a grid cell', () => {
    registerAbbreviations(ABBREV_CONTRACTOR, [
      contractorToAbbreviation({
        name: 'Przedsiębiorstwo Transportowe Kowalski Sp. z o.o.',
        shortName: 'PT Kowalski',
      })!,
    ])
    const label = formatContractor('Przedsiębiorstwo Transportowe Kowalski Sp. z o.o.')
    expect(label.text).toBe('PT Kowalski')
    expect(label.title).toBe('Przedsiębiorstwo Transportowe Kowalski Sp. z o.o.')
    expect(label.shortened).toBe(true)
  })

  it('leaves an unregistered contractor at its full name', () => {
    const label = formatContractor('Nieznana Firma Sp. z o.o.')
    expect(label.text).toBe('Nieznana Firma Sp. z o.o.')
    expect(label.shortened).toBe(false)
  })
})

describe('formatFacility', () => {
  it('prefers the dictionary full name for the tooltip over the raw alias', () => {
    const label = formatFacility('DCT Gdansk')
    expect(label.text).toBe('BHCT')
    expect(label.title).toBe('Baltic Hub Container Terminal (ex DCT Gdańsk)')
  })

  it('leaves an uncurated facility untouched', () => {
    const label = formatFacility('Terminal Nieznany')
    expect(label.text).toBe('Terminal Nieznany')
    expect(label.shortened).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. GENERAL TEXT FITTING
// ─────────────────────────────────────────────────────────────────────────────

describe('truncateTail — prose', () => {
  it('keeps the head, which is where prose carries its meaning', () => {
    // 18-char budget = 17 characters of text plus the one-glyph ellipsis.
    expect(truncateTail('Uszkodzenie plomby przy rozladunku', 18)).toBe(`Uszkodzenie plomb${ELLIPSIS}`)
  })

  it('returns the input untouched when it already fits', () => {
    const value = 'Short'
    expect(truncateTail(value, 10)).toBe(value)
  })

  it('respects the budget exactly', () => {
    expect(truncateTail('abcdefghij', 5)).toHaveLength(5)
  })

  it('degrades safely at absurd budgets', () => {
    expect(truncateTail('abcdef', 1)).toBe(ELLIPSIS)
    expect(truncateTail('abcdef', 0)).toBe('')
  })

  it('uses a ONE-GLYPH ellipsis, not three dots', () => {
    // In an 8-character budget, "..." spends 25% on characters carrying no
    // information at all.
    expect(truncateTail('abcdefghij', 8)).not.toContain('...')
    expect(ELLIPSIS).toHaveLength(1)
  })
})

describe('truncateMiddle — identifiers', () => {
  it('KEEPS THE TAIL, which is what distinguishes container numbers', () => {
    // Tail-clipping "MSCU7234561" gives "MSCU72…" — and MSCU is on 4 000 other
    // rows. The serial is the informative part.
    const clipped = truncateMiddle('MSCU7234561', 8)
    expect(clipped).toContain(ELLIPSIS)
    expect(clipped.endsWith('561')).toBe(true)
    expect(clipped).toHaveLength(8)
  })

  it('makes two container numbers with a shared prefix distinguishable', () => {
    const a = truncateMiddle('MSCU7234561', 8)
    const b = truncateMiddle('MSCU7234599', 8)
    expect(a).not.toBe(b)
    // …whereas tail-clipping would collapse them to the same string.
    expect(truncateTail('MSCU7234561', 8)).toBe(truncateTail('MSCU7234599', 8))
  })

  it('gives the extra character to the TAIL on an odd budget', () => {
    // 9-char budget → 8 kept → head 4, tail 4. 8-char → 7 kept → head 3, tail 4.
    expect(truncateMiddle('ABCDEFGHIJKL', 8)).toBe(`ABC${ELLIPSIS}IJKL`)
  })

  it('returns the input untouched when it already fits', () => {
    expect(truncateMiddle('MSCU723', 11)).toBe('MSCU723')
  })

  it('respects the budget exactly', () => {
    expect(truncateMiddle('ABCDEFGHIJKLMNOP', 7)).toHaveLength(7)
  })

  it('degrades safely at absurd budgets', () => {
    expect(truncateMiddle('abcdef', 2)).toBe(ELLIPSIS)
    expect(truncateMiddle('abcdef', 0)).toBe('')
  })
})

describe('detectFitMode', () => {
  it('calls an alphanumeric, space-free token an identifier', () => {
    expect(detectFitMode('MSCU7234561')).toBe('identifier')
    expect(detectFitMode('FV/2026/08/0123')).toBe('identifier')
  })

  it('calls anything containing a space prose', () => {
    expect(detectFitMode('Baltic Container Terminal')).toBe('prose')
  })

  it('DEFAULTS TO PROSE when unsure', () => {
    // Middle-clipping prose is actively unreadable ("Uszkodz…ładunku");
    // tail-clipping an identifier is merely unhelpful. So the safe default is
    // prose, and identifier columns should declare themselves.
    expect(detectFitMode('Kowalski')).toBe('prose')
    expect(detectFitMode('12345')).toBe('prose')
    expect(detectFitMode('')).toBe('prose')
  })
})

describe('fitText', () => {
  it('auto-detects and middle-clips an identifier', () => {
    expect(fitText('MSCU7234561', 8).text.endsWith('561')).toBe(true)
  })

  it('auto-detects and tail-clips prose', () => {
    expect(fitText('Baltic Container Terminal', 12).text.endsWith(ELLIPSIS)).toBe(true)
  })

  it('honours an explicit mode over the heuristic', () => {
    const forced = fitText('Kowalski Wisniewski', 10, 'identifier')
    expect(forced.text).toContain(ELLIPSIS)
    expect(forced.text.endsWith('ski')).toBe(true)
  })

  it('ALWAYS carries the full value as the title', () => {
    // The rule that makes aggressive shortening safe: nothing is destroyed.
    expect(fitText('MSCU7234561', 6).title).toBe('MSCU7234561')
  })

  it('reports not-shortened and allocates nothing when the value fits', () => {
    const label = fitText('MSCU7234561', 40)
    expect(label.shortened).toBe(false)
    expect(label.text).toBe(label.title)
  })

  it('is empty for blank input', () => {
    expect(fitText(null, 10).text).toBe('')
    expect(fitText('', 10).text).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

describe('formatLabelCompact', () => {
  it('dispatches to the assignee strategy', () => {
    const index = buildInitialsIndex(['Agnieszka Nowak-Kowalska'])
    expect(formatLabelCompact('Agnieszka Nowak-Kowalska', { kind: 'assignee', index }).text).toBe('ANK')
  })

  it('dispatches to the facility strategy', () => {
    expect(formatLabelCompact('Port Gdansk', { kind: 'facility' }).text).toBe('GDN')
  })

  it('dispatches to a named dictionary namespace', () => {
    registerAbbreviations('vessel', [{ match: ['MSC Gulsun'], short: 'GULSUN' }])
    expect(formatLabelCompact('MSC Gulsun', { kind: 'dictionary', namespace: 'vessel' }).text).toBe(
      'GULSUN',
    )
  })

  it('applies maxChars ON TOP of a dictionary fold, so a budget is a guarantee', () => {
    registerAbbreviations(ABBREV_FACILITY, [
      { match: ['Rotterdam World Gateway'], short: 'ROTTERDAM-WG' },
    ])
    const label = formatLabelCompact('Rotterdam World Gateway', { kind: 'facility', maxChars: 6 })
    expect(label.text).toHaveLength(6)
    // …and the ORIGINAL value is still the tooltip, not the intermediate fold.
    expect(label.title).toBe('Rotterdam World Gateway')
  })

  it('unwraps a relation object', () => {
    expect(formatLabelCompact({ id: 'x', name: 'Port Gdansk' }, { kind: 'facility' }).text).toBe('GDN')
  })

  it('is empty for a value it cannot honestly render', () => {
    expect(formatLabelCompact({ id: 'x' }, { kind: 'facility' }).text).toBe('')
    expect(formatLabelCompact(undefined, { kind: 'facility' }).text).toBe('')
  })
})

describe('toDisplayString', () => {
  it('handles the shapes relation columns actually store', () => {
    expect(toDisplayString('Port Gdansk')).toBe('Port Gdansk')
    expect(toDisplayString({ name: 'Port Gdansk' })).toBe('Port Gdansk')
    expect(toDisplayString({ label: 'Port Gdansk' })).toBe('Port Gdansk')
    expect(toDisplayString({ shortName: 'GDN' })).toBe('GDN')
    expect(toDisplayString({ code: 'BCT' })).toBe('BCT')
    expect(toDisplayString(42)).toBe('42')
    expect(toDisplayString(null)).toBe('')
    expect(toDisplayString({ id: 'x' })).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE INVARIANTS
//
// These pin the properties the hot path depends on. They are cheap to break by
// accident (one regex literal moved inside a function body would do it) and
// expensive to notice, because the symptom is a slow grid, not a failing test.
// ─────────────────────────────────────────────────────────────────────────────

describe('performance invariants', () => {
  it('compiles no regex inside a function body', () => {
    const sources = [
      require('fs').readFileSync(require.resolve('../utils/formatLabelCompact'), 'utf8'),
      require('fs').readFileSync(require.resolve('../utils/abbreviations'), 'utf8'),
    ].join('\n')
    expect(sources).not.toMatch(/new RegExp\(/)
  })

  it('returns the SAME string reference when nothing was shortened', () => {
    // Proof there is no allocation on the overwhelmingly common path.
    const value = 'Terminal Nieznany'
    expect(formatFacility(value).text).toBe(value)
    expect(truncateTail(value, 100)).toBe(value)
    expect(truncateMiddle(value, 100)).toBe(value)
  })

  it('resolves a repeated dictionary value without re-normalizing', () => {
    // 5 000 rows, ~20 distinct ports: the cache must hold 20 entries, not 5 000.
    for (let i = 0; i < 500; i += 1) {
      abbreviate(ABBREV_FACILITY, 'Port Gdansk')
      abbreviate(ABBREV_FACILITY, 'Port Gdynia')
    }
    expect(getAbbreviationSnapshot(ABBREV_FACILITY).cached).toBe(2)
  })

  it('bounds the memo cache against a high-cardinality column', () => {
    for (let i = 0; i < 5000; i += 1) abbreviate(ABBREV_FACILITY, `MSCU${i}`)
    expect(getAbbreviationSnapshot(ABBREV_FACILITY).cached).toBeLessThanOrEqual(4096)
  })

  it('is a pure function of its inputs', () => {
    const index = buildInitialsIndex(['Anna Kowalska'])
    const a = formatAssignee('Anna Kowalska', index)
    const b = formatAssignee('Anna Kowalska', index)
    expect(a).toEqual(b)
  })

  it('never throws on hostile input', () => {
    const hostile: unknown[] = [null, undefined, '', '   ', 0, NaN, {}, [], true, Symbol('x')]
    for (const value of hostile) {
      expect(() => formatLabelCompact(value, { kind: 'facility' })).not.toThrow()
      expect(() => formatLabelCompact(value, { kind: 'assignee' })).not.toThrow()
      expect(() => formatLabelCompact(value, { kind: 'text', maxChars: 5 })).not.toThrow()
    }
  })

  it('lookupAbbreviation distinguishes "never asked" from "genuinely absent"', () => {
    expect(lookupAbbreviation(ABBREV_FACILITY, 'Nope')).toBeNull()
    expect(lookupAbbreviation('no-such-namespace', 'Nope')).toBeNull()
  })
})
