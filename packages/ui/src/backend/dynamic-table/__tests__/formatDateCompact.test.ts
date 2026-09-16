/**
 * Tests for the compact date formatter (workshop items A8 and B14).
 *
 * The load-bearing blocks, in order of what would hurt most if it broke:
 *
 *   1. ISO WEEK ACROSS YEAR BOUNDARIES. The classic bug. 1 Jan and 31 Dec are
 *      asserted for a decade of years, against hand-checked expectations —
 *      including all four interesting shapes (week 1 starting in December,
 *      week 52/53 running into January, and a 53-week year).
 *   2. FORMAT CONSISTENCY (A8 i). Every value shape the migration actually
 *      left behind, including the UTC-midnight artefact and the broken values.
 *   3. THE LEVEL MODEL (A8 ii). Precedence and variance must agree with
 *      `resolveLegTimestamp` in the folders module or the transport table and
 *      the container table would report different delays for one shipment.
 *   4. MEMOISATION. Asserts the hot path really is a cache hit returning the
 *      SAME frozen object — the performance claim, pinned as behaviour.
 */

import {
  daysFromCivil,
  yearFromDays,
  isoWeekday,
  isoWeek,
  isoWeekYear,
  parseTimestamp,
  formatDateCompact,
  formatTimestampLevels,
  getCompactDateFormatter,
  LEVEL_GLYPHS,
  TIMESTAMP_LEVELS,
  __resetCompactDateCaches,
} from '../utils/formatDateCompact'

/** Pinned so the year-elision rule is deterministic regardless of when CI runs. */
const REF = { locale: 'pl', referenceYear: 2026 } as const

beforeEach(() => {
  __resetCompactDateCaches()
})

// ─────────────────────────────────────────────────────────────────────────────
// Calendar arithmetic
// ─────────────────────────────────────────────────────────────────────────────

describe('civil-date arithmetic', () => {
  it('anchors on the epoch', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0)
    expect(yearFromDays(0)).toBe(1970)
  })

  it('round-trips the year across four centuries', () => {
    for (let y = 1800; y <= 2200; y += 7) {
      expect(yearFromDays(daysFromCivil(y, 6, 15))).toBe(y)
      expect(yearFromDays(daysFromCivil(y, 1, 1))).toBe(y)
      expect(yearFromDays(daysFromCivil(y, 12, 31))).toBe(y)
    }
  })

  it('handles leap-year rules including the 100/400 exceptions', () => {
    // 2000 is a leap year, 1900 and 2100 are not.
    expect(daysFromCivil(2000, 3, 1) - daysFromCivil(2000, 2, 1)).toBe(29)
    expect(daysFromCivil(1900, 3, 1) - daysFromCivil(1900, 2, 1)).toBe(28)
    expect(daysFromCivil(2100, 3, 1) - daysFromCivil(2100, 2, 1)).toBe(28)
    expect(daysFromCivil(2024, 3, 1) - daysFromCivil(2024, 2, 1)).toBe(29)
  })

  it('reports ISO weekdays with Monday = 0', () => {
    expect(isoWeekday(1970, 1, 1)).toBe(3) // Thursday
    expect(isoWeekday(2026, 8, 3)).toBe(0) // Monday — the workshop date
    expect(isoWeekday(2026, 8, 9)).toBe(6) // Sunday
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B14 — ISO week numbers
// ─────────────────────────────────────────────────────────────────────────────

describe('isoWeek — 1 January across years (the classic boundary bug)', () => {
  // Hand-checked against the ISO-8601 definition: the week belongs to the year
  // containing its Thursday.
  const cases: Array<[year: number, week: number, weekYear: number]> = [
    [2015, 1, 2015], // Thu → week 1 of its own year
    [2016, 53, 2015], // Fri → last week of the PREVIOUS year
    [2017, 52, 2016], // Sun → previous year
    [2018, 1, 2018], // Mon → week 1
    [2019, 1, 2019], // Tue
    [2020, 1, 2020], // Wed
    [2021, 53, 2020], // Fri → 2020 had 53 weeks
    [2022, 52, 2021], // Sat
    [2023, 52, 2022], // Sun
    [2024, 1, 2024], // Mon
    [2025, 1, 2025], // Wed
    [2026, 1, 2026], // Thu
    [2027, 53, 2026], // Fri → 2026 has 53 weeks
    [2028, 52, 2027], // Sat
  ]

  it.each(cases)('1 Jan %i is week %i of %i', (year, week, weekYear) => {
    expect(isoWeek(year, 1, 1)).toBe(week)
    expect(isoWeekYear(year, 1, 1)).toBe(weekYear)
  })
})

describe('isoWeek — 31 December across years', () => {
  const cases: Array<[year: number, week: number, weekYear: number]> = [
    [2015, 53, 2015], // Thu
    [2016, 52, 2016], // Sat
    [2017, 52, 2017], // Sun
    [2018, 1, 2019], // Mon → already week 1 of the NEXT year
    [2019, 1, 2020], // Tue → next year
    [2020, 53, 2020], // Thu
    [2021, 52, 2021], // Fri
    [2022, 52, 2022], // Sat
    [2023, 52, 2023], // Sun
    [2024, 1, 2025], // Tue → next year
    [2025, 1, 2026], // Wed → next year
    [2026, 53, 2026], // Thu
    [2027, 52, 2027], // Fri
  ]

  it.each(cases)('31 Dec %i is week %i of %i', (year, week, weekYear) => {
    expect(isoWeek(year, 12, 31)).toBe(week)
    expect(isoWeekYear(year, 12, 31)).toBe(weekYear)
  })
})

describe('isoWeek — dates that belong to a week in the other year', () => {
  it('29 Dec 2008 (Mon) starts week 1 of 2009', () => {
    expect(isoWeek(2008, 12, 29)).toBe(1)
    expect(isoWeekYear(2008, 12, 29)).toBe(2009)
  })

  it('30 Dec 2019 (Mon) starts week 1 of 2020', () => {
    expect(isoWeek(2019, 12, 30)).toBe(1)
    expect(isoWeekYear(2019, 12, 30)).toBe(2020)
  })

  it('3 Jan 2021 (Sun) still closes week 53 of 2020', () => {
    expect(isoWeek(2021, 1, 3)).toBe(53)
    expect(isoWeekYear(2021, 1, 3)).toBe(2020)
  })

  it('4 Jan 2021 (Mon) opens week 1 of 2021', () => {
    expect(isoWeek(2021, 1, 4)).toBe(1)
    expect(isoWeekYear(2021, 1, 4)).toBe(2021)
  })

  it('never produces a week outside 1..53 for a decade of every-day scanning', () => {
    for (let y = 2019; y <= 2029; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 28; d++) {
          const w = isoWeek(y, m, d)
          expect(w).toBeGreaterThanOrEqual(1)
          expect(w).toBeLessThanOrEqual(53)
        }
      }
    }
  })

  it('advances by exactly one week every 7 days, wrapping at the year edge', () => {
    // 21 Dec 2026 (Mon) → weeks 52, 53, then 1 of 2027.
    expect(isoWeek(2026, 12, 21)).toBe(52)
    expect(isoWeek(2026, 12, 28)).toBe(53)
    expect(isoWeek(2027, 1, 4)).toBe(1)
    expect(isoWeekYear(2027, 1, 4)).toBe(2027)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Parsing — every shape the migration left behind (A8 i)
// ─────────────────────────────────────────────────────────────────────────────

describe('parseTimestamp', () => {
  it('reads a date-only value without inventing a time', () => {
    const p = parseTimestamp('2026-12-31')!
    expect(p).toMatchObject({ year: 2026, month: 12, day: 31, hasTime: false, isMidnight: false })
  })

  it('reads a naive local date-time without constructing a Date', () => {
    expect(parseTimestamp('2026-12-31T14:30')).toMatchObject({ hours: 14, minutes: 30, hasTime: true })
    expect(parseTimestamp('2026-12-31T14:30:00')).toMatchObject({ hours: 14, minutes: 30, hasTime: true })
  })

  it('reads the Postgres space-separated form', () => {
    expect(parseTimestamp('2026-12-31 08:05:00')).toMatchObject({ hours: 8, minutes: 5, hasTime: true })
  })

  it('flags a naive midnight as a time that happens to be 00:00', () => {
    expect(parseTimestamp('2026-12-31T00:00:00')).toMatchObject({ hasTime: true, isMidnight: true })
  })

  it('treats an exact UTC midnight as a date-only value of its UTC day', () => {
    // The migration artefact: a date column moved into a timestamptz. Rendering
    // it as an instant fabricates a time and, west of Greenwich, the wrong day.
    for (const raw of ['2026-12-31T00:00:00Z', '2026-12-31T00:00:00.000Z', '2026-12-31T00:00Z']) {
      expect(parseTimestamp(raw)).toMatchObject({
        year: 2026, month: 12, day: 31, hasTime: false, wasInstant: false,
      })
    }
  })

  it('treats a non-midnight UTC instant as a real instant', () => {
    const p = parseTimestamp('2026-12-31T14:30:00Z')!
    expect(p.hasTime).toBe(true)
    expect(p.wasInstant).toBe(true)
  })

  it('accepts Date and epoch-ms inputs', () => {
    const d = new Date(2026, 11, 31, 14, 30)
    expect(parseTimestamp(d)).toMatchObject({ year: 2026, month: 12, day: 31, hours: 14, minutes: 30 })
    expect(parseTimestamp(d.getTime())).toMatchObject({ year: 2026, month: 12, day: 31 })
  })

  it('returns null for everything that is not a timestamp', () => {
    const rubbish: unknown[] = [
      null, undefined, '', 'not a date', '31/12/2026', '2026-13-01', '2026-12-32',
      '2026-12-31T25:00:00', '2026-12-31T14:60', '2026-12', 'NaN', {}, [], true, NaN, Infinity,
      new Date('nope'),
    ]
    for (const value of rubbish) {
      expect(parseTimestamp(value as never)).toBeNull()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A8 (i) — ONE deterministic rule set
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDateCompact — the rule set', () => {
  it('elides the year in the reference year and shows two digits otherwise', () => {
    expect(formatDateCompact('2026-12-31', REF).date).toBe('31.12')
    expect(formatDateCompact('2027-01-04', REF).date).toBe('04.01.27')
    expect(formatDateCompact('2025-11-02', REF).date).toBe('02.11.25')
  })

  it('honours the yearMode and yearDigits overrides', () => {
    expect(formatDateCompact('2026-12-31', { ...REF, yearMode: 'always' }).date).toBe('31.12.26')
    expect(formatDateCompact('2026-12-31', { ...REF, yearMode: 'always', yearDigits: 4 }).date).toBe('31.12.2026')
    expect(formatDateCompact('2027-01-04', { ...REF, yearMode: 'never' }).date).toBe('04.01')
  })

  it('shows a time only when the value carries one', () => {
    expect(formatDateCompact('2026-12-31', REF).time).toBe('')
    expect(formatDateCompact('2026-12-31T14:30:00', REF).time).toBe('14:30')
  })

  it('suppresses midnight by default and shows it on request', () => {
    expect(formatDateCompact('2026-12-31T00:00:00', REF).time).toBe('')
    expect(formatDateCompact('2026-12-31T00:00:00', { ...REF, midnight: 'show' }).time).toBe('00:00')
  })

  it('never shows a time when showTime is never', () => {
    expect(formatDateCompact('2026-12-31T14:30:00', { ...REF, showTime: 'never' }).time).toBe('')
  })

  it('renders the same day for the same instant regardless of how it was stored', () => {
    // The A8(i) complaint in one assertion: three encodings of "31 December"
    // that used to render three different ways.
    const a = formatDateCompact('2026-12-31', REF)
    const b = formatDateCompact('2026-12-31T00:00:00Z', REF)
    const c = formatDateCompact('2026-12-31T00:00:00', REF)
    expect(a.text).toBe('31.12')
    expect(b.text).toBe('31.12')
    expect(c.text).toBe('31.12')
  })

  it('uses a non-breaking space between date and time', () => {
    expect(formatDateCompact('2026-12-31T14:30:00', REF).text).toBe('31.12 14:30')
  })

  it('follows the locale for order and separator', () => {
    expect(formatDateCompact('2026-12-31', { locale: 'pl', referenceYear: 2026 }).date).toBe('31.12')
    expect(formatDateCompact('2026-12-31', { locale: 'en-GB', referenceYear: 2026 }).date).toBe('31/12')
    expect(formatDateCompact('2026-12-31', { locale: 'en-US', referenceYear: 2026 }).date).toBe('12/31')
    expect(formatDateCompact('2026-12-31', { locale: 'de', referenceYear: 2026 }).date).toBe('31.12')
  })

  it('falls back to the primary locale shape for a broken locale tag', () => {
    expect(formatDateCompact('2026-12-31', { locale: 'not a locale!!', referenceYear: 2026 }).date).toBe('31.12')
  })

  it('renders distinct, non-crashing placeholders for empty and broken values', () => {
    const empty = formatDateCompact(null, REF)
    expect(empty.kind).toBe('empty')
    expect(empty.text).toBe('–')

    for (const broken of ['not a date', '2026-13-45', '31/12/2026']) {
      const r = formatDateCompact(broken, REF)
      expect(r.kind).toBe('invalid')
      expect(r.text).toBe('?')
      expect(r.text).not.toMatch(/Invalid/i)
    }
    expect(formatDateCompact(null, REF).text).not.toBe(formatDateCompact('rubbish', REF).text)
  })

  it('never throws, whatever it is handed', () => {
    const hostile: unknown[] = [
      undefined, null, '', 0, -1, NaN, Infinity, {}, [], () => {}, Symbol('x'),
      new Date('nope'), '2026-12-31T', '2026-12-31T14', ' ',
    ]
    for (const value of hostile) {
      expect(() => formatDateCompact(value as never, REF)).not.toThrow()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B14 — week display
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDateCompact — ISO week display', () => {
  it('is off by default but still computes the number', () => {
    const r = formatDateCompact('2026-12-31', REF)
    expect(r.week).toBe('')
    expect(r.weekNumber).toBe(53)
    expect(r.weekYear).toBe(2026)
  })

  it('appends the week as a suffix', () => {
    const r = formatDateCompact('2026-12-31', { ...REF, week: 'suffix' })
    expect(r.week).toBe('W53')
    expect(r.text).toBe('31.12 W53')
  })

  it('replaces the date entirely in week-only mode', () => {
    const r = formatDateCompact('2026-12-31T14:30:00', { ...REF, week: 'only' })
    expect(r.date).toBe('')
    expect(r.time).toBe('')
    expect(r.text).toBe('W53')
  })

  it('shows the week of the ISO year, not the calendar year, at the boundary', () => {
    expect(formatDateCompact('2027-01-01', { ...REF, week: 'only' }).text).toBe('W53')
    expect(formatDateCompact('2027-01-04', { ...REF, week: 'only' }).text).toBe('W1')
  })

  it('honours a custom prefix', () => {
    expect(formatDateCompact('2026-12-31', { ...REF, week: 'only', weekPrefix: 'T' }).text).toBe('T53')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A8 (ii) — the three-level model
// ─────────────────────────────────────────────────────────────────────────────

describe('formatTimestampLevels — precedence and glyphs', () => {
  const P = '2026-12-20T08:00:00'
  const E = '2026-12-22T09:00:00'
  const A = '2026-12-24T10:00:00'

  it('resolves actual > estimated > planned, matching resolveLegTimestamp', () => {
    expect(formatTimestampLevels(P, E, A, REF).level).toBe('actual')
    expect(formatTimestampLevels(P, E, null, REF).level).toBe('estimated')
    expect(formatTimestampLevels(P, null, null, REF).level).toBe('planned')
    expect(formatTimestampLevels(null, null, null, REF).level).toBeNull()
  })

  it('carries the level in a glyph, forming a hollow → half → solid ramp', () => {
    expect(formatTimestampLevels(P, null, null, REF).glyph).toBe(LEVEL_GLYPHS.planned)
    expect(formatTimestampLevels(P, E, null, REF).glyph).toBe(LEVEL_GLYPHS.estimated)
    expect(formatTimestampLevels(P, E, A, REF).glyph).toBe(LEVEL_GLYPHS.actual)
    // Distinct shapes — the accessibility requirement. Colour is reinforcement.
    expect(new Set(TIMESTAMP_LEVELS.map((l) => LEVEL_GLYPHS[l])).size).toBe(3)
  })

  it('the glyph costs exactly one character of width', () => {
    for (const level of TIMESTAMP_LEVELS) {
      expect(Array.from(LEVEL_GLYPHS[level])).toHaveLength(1)
    }
  })

  it('accepts custom glyphs', () => {
    const r = formatTimestampLevels(P, E, A, { ...REF, glyphs: { actual: '*' } })
    expect(r.glyph).toBe('*')
  })

  it('shows the resolved level date, not a merged one', () => {
    expect(formatTimestampLevels(P, E, A, REF).date.date).toBe('24.12')
    expect(formatTimestampLevels(P, E, null, REF).date.date).toBe('22.12')
  })

  it('reports empty when all three are absent, and invalid when one is broken', () => {
    expect(formatTimestampLevels(null, null, null, REF).isEmpty).toBe(true)
    expect(formatTimestampLevels(null, null, null, REF).date.text).toBe('–')

    const broken = formatTimestampLevels(null, 'rubbish', null, REF)
    expect(broken.isEmpty).toBe(false)
    expect(broken.date.kind).toBe('invalid')
  })
})

describe('formatTimestampLevels — variance', () => {
  it('measures actual against estimate first', () => {
    const r = formatTimestampLevels('2026-12-20', '2026-12-22', '2026-12-24', REF)
    expect(r.variance).toBe('+2d')
    expect(r.varianceSign).toBe(1)
  })

  it('falls back to actual vs plan, then estimate vs plan', () => {
    expect(formatTimestampLevels('2026-12-20', null, '2026-12-24', REF).variance).toBe('+4d')
    expect(formatTimestampLevels('2026-12-20', '2026-12-22', null, REF).variance).toBe('+2d')
  })

  it('renders early as a minus and on-time as nothing', () => {
    const early = formatTimestampLevels(null, '2026-12-24', '2026-12-22', REF)
    expect(early.variance).toBe('−2d')
    expect(early.varianceSign).toBe(-1)

    const onTime = formatTimestampLevels(null, '2026-12-24', '2026-12-24', REF)
    expect(onTime.variance).toBe('')
    expect(onTime.varianceSign).toBe(0)
  })

  it('uses ONE unit — the most significant — to save width', () => {
    expect(formatTimestampLevels(null, '2026-12-22T08:00:00', '2026-12-24T11:00:00', REF).variance).toBe('+2d')
    expect(formatTimestampLevels(null, '2026-12-22T08:00:00', '2026-12-22T13:30:00', REF).variance).toBe('+5h')
    expect(formatTimestampLevels(null, '2026-12-22T08:00:00', '2026-12-22T08:45:00', REF).variance).toBe('+45m')
  })

  it('measures in whole days when either side carries no time', () => {
    // Matches computeDelay in the folders module: a date-only value must never
    // produce spurious hours.
    const r = formatTimestampLevels(null, '2026-12-22', '2026-12-23T23:00:00', REF)
    expect(r.variance).toBe('+1d')
  })
})

describe('formatTimestampLevels — hover breakdown', () => {
  it('lists every known level in words, most-real first', () => {
    const r = formatTimestampLevels('2026-12-20', '2026-12-22', '2026-12-24', REF)
    expect(r.title).toBe('Actual: 24.12\nEstimated: 22.12\nPlanned: 20.12')
  })

  it('omits absent levels and accepts translated labels', () => {
    const r = formatTimestampLevels(null, '2026-12-22', null, {
      ...REF,
      levelLabels: { estimated: 'Szacowany' },
    })
    expect(r.title).toBe('Szacowany: 22.12')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE — the claims, pinned as behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('memoisation', () => {
  it('returns the SAME frozen object for a repeated value', () => {
    const f = getCompactDateFormatter(REF)
    const a = f.format('2026-12-31T14:30:00')
    const b = f.format('2026-12-31T14:30:00')
    expect(b).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
  })

  it('returns the SAME frozen object for a repeated triplet', () => {
    const f = getCompactDateFormatter(REF)
    const a = f.formatLevels('2026-12-20', '2026-12-22', '2026-12-24')
    const b = f.formatLevels('2026-12-20', '2026-12-22', '2026-12-24')
    expect(b).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
  })

  it('reuses one formatter per config value, not per call site', () => {
    expect(getCompactDateFormatter(REF)).toBe(getCompactDateFormatter({ ...REF }))
    expect(getCompactDateFormatter(REF)).not.toBe(getCompactDateFormatter({ ...REF, week: 'suffix' }))
  })

  it('bounds the cache instead of growing forever', () => {
    const f = getCompactDateFormatter(REF)
    for (let i = 0; i < 12000; i++) {
      // Cycle through distinct valid dates.
      const y = 2000 + (i % 60)
      const m = 1 + (i % 12)
      const d = 1 + (i % 28)
      f.format(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    }
    // Two generations of at most CACHE_MAX (4096) each.
    expect(f._cacheSize()).toBeLessThanOrEqual(8192)
  })

  it('does not fabricate results across differently-configured formatters', () => {
    const off = getCompactDateFormatter(REF)
    const on = getCompactDateFormatter({ ...REF, week: 'suffix' })
    expect(off.format('2026-12-31').text).toBe('31.12')
    expect(on.format('2026-12-31').text).toBe('31.12 W53')
  })
})
