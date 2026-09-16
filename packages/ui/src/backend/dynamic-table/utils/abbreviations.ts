/**
 * Central abbreviation registry for dense grid labels.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, AND WHAT IT IS DELIBERATELY *NOT*
 *
 * Workshop item A9 (3 Aug 2026): labels must shorten — ports must render as
 * terminal codes ("BCT", "GCT", "BHCT") rather than "Port Gdansk". Agnieszka's
 * hard constraint was recorded verbatim: *"nie zebysmy co fajl zmieniali"* —
 * the mapping must be configured CENTRALLY, in ONE place, not re-declared per
 * table, per page, or per column.
 *
 * So the first question is: where does the mapping actually LIVE?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ALREADY LIVES IN THE DATABASE. THIS FILE IS NOT THE SOURCE OF TRUTH.
 *
 * Searching before building found that FMS already has the curated data and
 * already has the admin screen:
 *
 *   - `facilities.short_name`  — text, nullable, added by
 *     `Migration20260722120000_facility_short_name`. Its own doc comment says
 *     it is the "curated abbreviation shown in dense list views". Editable at
 *     `/backend/facilities` (`packages/facilities/.../backend/facilities/page.tsx`)
 *     and through the terminal/port drawers.
 *   - `facilities.code` / `facilities.locode` — the terminal's own identifier
 *     (this is literally where "BCT" is stored).
 *   - `contractors.short_name` — same idea, and the workshop notes confirm it
 *     is already live and working.
 *
 * There is therefore NO case for a second, code-owned mapping table, and no
 * case for building a new admin UI. Answering the question the task asks
 * directly: **yes, the mapping should be database-backed with an admin screen,
 * and it already is.** The gap is not storage and not administration — it is
 * *delivery*: nothing currently carries those curated strings into the grid's
 * render path, so cells still show the long `name`.
 *
 * This file is that delivery mechanism, and nothing more: a process-local,
 * O(1) lookup that the app populates ONCE from the existing tables.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SMALLEST v1 THAT IS CENTRAL WITHOUT NEEDING NEW ADMIN UI
 *
 *   1. On app boot (one call site — see the wiring contract), fetch the
 *      facility dictionary (`/api/facilities/unified`, projecting
 *      `{ id, name, code, shortName, locode }`) and call
 *      `registerAbbreviations(ABBREV_FACILITY, …)` once.
 *   2. Same for contractors, from `contractors.short_name`.
 *   3. Every grid on every page then abbreviates identically, because they all
 *      read this one registry. Changing a label is an edit in the facilities
 *      admin screen — not a code change, and not a per-file change.
 *
 * That is central by Agnieszka's definition, requires no new screen, no new
 * table, and no new migration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRECEDENCE — three layers, highest first
 *
 *   1. RUNTIME   — registered from the DB. Curated by staff. Always wins.
 *   2. SEED      — the small static table at the bottom of this file. Covers
 *                  the Polish terminals everyone at INF says out loud, so a
 *                  fresh/unseeded deployment is still readable on day one.
 *   3. (none)    — caller falls back to the full value. A missing abbreviation
 *                  renders the long name; it never renders blank.
 *
 * A deployment "overrides or extends" the mapping by editing the DATABASE
 * (layer 1), which by construction outranks anything shipped in code. The seed
 * exists only so that layer 1 being empty is not a blank-screen scenario. No
 * deployment should ever need to fork this file — if one does, that is the bug.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERFORMANCE — this runs in thousands of cells per render pass
 *
 * The grid virtualizes ROWS ONLY (`VirtualRow` does a plain `columns.map`), so
 * every column of every mounted row calls into here on every pass. Two rules
 * follow, and both are load-bearing:
 *
 *   - NEVER scan an array per cell. Lookups are `Map.get`, built once at
 *     registration time.
 *   - NEVER normalize per cell in steady state. Normalization (case-folding,
 *     diacritic-folding, whitespace collapse) allocates strings, so every raw
 *     input string is normalized AT MOST ONCE and the *resolved answer* is
 *     memoized against the raw input. A freight grid shows the same ~20 ports
 *     across 5 000 rows, so the hit rate here is essentially 100%: the second
 *     through five-thousandth cell each cost one `Map.get` on the original
 *     string and nothing else — no allocation, no regex, no lowercase.
 *
 * Everything here is a pure function of (registry contents, input). The
 * registry is versioned so memoized consumers can invalidate; see
 * `abbreviationsVersion()`.
 */

/**
 * Namespaces keep unrelated dictionaries from colliding: a contractor called
 * "Baltic" must not be abbreviated by a port rule that happens to match.
 *
 * A plain string type (rather than a closed union) is deliberate — a Tier-3 app
 * or a future module can register its own dictionary without this file, in the
 * `@freighttech/ui` package, needing to know it exists.
 */
export type AbbreviationNamespace = string

/** Facilities: ports, terminals, airports, depots. Fed from `facilities`. */
export const ABBREV_FACILITY: AbbreviationNamespace = 'facility'
/** Contractors. Fed from `contractors.short_name`. */
export const ABBREV_CONTRACTOR: AbbreviationNamespace = 'contractor'

/**
 * One row of the dictionary.
 *
 * `match` is everything that should resolve to `short`. For a facility that is
 * its name, its code, its LOCODE and any alias — all pointing at one label, so
 * a grid column bound to the name and another bound to the code both abbreviate
 * to the same thing.
 */
export type AbbreviationEntry = {
  /**
   * Values that resolve to `short`. Matched after normalization (case- and
   * diacritic-insensitive), so "Port Gdańsk", "port gdansk" and "PORT GDANSK"
   * are one key.
   */
  match: readonly string[]
  /** The compact label rendered in the cell, e.g. "BCT". */
  short: string
  /**
   * The full value to show on hover. Optional — when absent the caller uses the
   * raw cell value, which is usually the better tooltip anyway.
   */
  full?: string
}

type Layer = Map<string, AbbreviationEntry>

type NamespaceState = {
  /** From the database. Curated. Wins. */
  runtime: Layer
  /** Static fallback shipped in code. */
  seed: Layer
  /**
   * Memoized answers keyed by the RAW (un-normalized) input string. This is the
   * hot path: in steady state every cell lookup terminates here.
   *
   * Holds `null` for known-misses too — a miss is just as worth caching as a
   * hit, and a grid full of un-curated values would otherwise re-normalize on
   * every pass.
   */
  resolved: Map<string, AbbreviationEntry | null>
}

/**
 * Upper bound on the memo cache, per namespace.
 *
 * A dictionary lookup column is inherently low-cardinality (ports, contractors,
 * people) so this is never reached in practice. It exists to bound the damage
 * if someone points a namespaced lookup at a high-cardinality column such as a
 * container number: without a cap the cache would grow with the dataset and
 * become a leak. On overflow the cache is cleared wholesale rather than evicted
 * LRU — an LRU needs bookkeeping on every *hit*, which is exactly the operation
 * that has to stay free.
 */
const RESOLVED_CACHE_LIMIT = 4096

const registry = new Map<AbbreviationNamespace, NamespaceState>()

let version = 0

/**
 * Change subscribers.
 *
 * The dictionary is fetched ONCE at app boot, which means every grid mounted
 * before that fetch resolves has already rendered its cells with the long
 * names. `lookupAbbreviation` would return the right answer on the NEXT render
 * — but nothing was scheduling one, so the delivery silently appeared to do
 * nothing until the user happened to sort or page.
 *
 * A version counter alone cannot fix that: React has no way to observe a plain
 * module-level integer. So registration notifies, and `useAbbreviationsVersion`
 * turns that into a `useSyncExternalStore` subscription.
 *
 * Deliberately a plain Set of thunks rather than an event emitter: this fires
 * once or twice in the lifetime of a page, so there is nothing to optimise, and
 * a listener that throws must not prevent the others from being told.
 */
const listeners = new Set<() => void>()

function notifyAbbreviationChange(): void {
  version += 1
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A broken subscriber must not stop the dictionary reaching the rest.
    }
  }
}

/**
 * Subscribe to dictionary changes. Returns an unsubscribe function.
 *
 * Pair with {@link abbreviationsVersion} as the snapshot — that is exactly the
 * `useSyncExternalStore` contract, and `useAbbreviationsVersion` is the hook
 * that wires the two together.
 */
export function subscribeAbbreviations(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function stateFor(namespace: AbbreviationNamespace): NamespaceState {
  let state = registry.get(namespace)
  if (!state) {
    state = { runtime: new Map(), seed: new Map(), resolved: new Map() }
    registry.set(namespace, state)
  }
  return state
}

/**
 * Polish (and general Latin-1) diacritic folding.
 *
 * Precomputed as a single character-class regex plus an object lookup, both
 * built ONCE at module scope. The alternative — `String.prototype.normalize`
 * — is correct but allocates an intermediate NFD string on every call, and
 * `ł` is not decomposable by NFD anyway (it is a distinct letter, not `l` plus
 * a combining mark), so normalize alone would still miss the single most
 * common Polish case: "Gdańsk"/"Gdansk" is fine but "Łódź"/"Lodz" is not.
 */
const DIACRITIC_MAP: Readonly<Record<string, string>> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ò: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ý: 'y', ÿ: 'y', ñ: 'n', ç: 'c', š: 's', ž: 'z', č: 'c', ř: 'r', ě: 'e', ů: 'u',
  ß: 'ss', æ: 'ae',
}

/** Compiled once. Never inside a function — that would recompile per cell. */
const DIACRITIC_PATTERN = /[ąćęłńóśźżàáâãäåèéêëìíîïòôõöøùúûüýÿñçšžčřěůßæ]/g

const WHITESPACE_PATTERN = /\s+/g

/**
 * Fold a raw value to its lookup key.
 *
 * Case-insensitive, diacritic-insensitive, whitespace-collapsed. NOT free —
 * it allocates — which is exactly why `lookupAbbreviation` memoizes on the raw
 * string and only ever reaches this on a cache miss.
 */
export function normalizeAbbreviationKey(value: string): string {
  const lowered = value.toLowerCase()
  const folded = DIACRITIC_PATTERN.test(lowered)
    ? // `.test` on a /g regex advances lastIndex; reset before reuse.
      ((DIACRITIC_PATTERN.lastIndex = 0),
      lowered.replace(DIACRITIC_PATTERN, (ch) => DIACRITIC_MAP[ch] ?? ch))
    : lowered
  DIACRITIC_PATTERN.lastIndex = 0
  return folded.replace(WHITESPACE_PATTERN, ' ').trim()
}

/**
 * Install (or replace) the RUNTIME layer for a namespace — the database-backed,
 * highest-precedence dictionary.
 *
 * Call this ONCE per namespace at app boot, from ONE place. It is not a
 * per-table or per-page API; wiring it into a page component is the "co fajl
 * zmieniali" failure mode this file exists to prevent.
 *
 * Replaces rather than merges by default, so a refetch cannot leave tombstones
 * of entries that were deleted in the admin screen. Pass `{ merge: true }` when
 * feeding a dictionary in pages.
 */
export function registerAbbreviations(
  namespace: AbbreviationNamespace,
  entries: readonly AbbreviationEntry[],
  options?: { merge?: boolean },
): void {
  const state = stateFor(namespace)
  if (!options?.merge) state.runtime.clear()
  indexInto(state.runtime, entries)
  // Any cached answer may now be stale — including cached MISSES, which is the
  // common case: the grid rendered before the dictionary arrived.
  state.resolved.clear()
  notifyAbbreviationChange()
}

/**
 * Install the SEED layer — the static, lowest-precedence fallback.
 *
 * Exposed so a Tier-3 deployment can extend the shipped defaults for its own
 * trade lane without forking this file, while still losing cleanly to whatever
 * staff curate in the admin screen.
 */
export function registerAbbreviationSeed(
  namespace: AbbreviationNamespace,
  entries: readonly AbbreviationEntry[],
  options?: { merge?: boolean },
): void {
  const state = stateFor(namespace)
  if (!options?.merge) state.seed.clear()
  indexInto(state.seed, entries)
  state.resolved.clear()
  notifyAbbreviationChange()
}

function indexInto(layer: Layer, entries: readonly AbbreviationEntry[]): void {
  for (const entry of entries) {
    if (!entry || !entry.short) continue
    for (const raw of entry.match) {
      if (typeof raw !== 'string') continue
      const key = normalizeAbbreviationKey(raw)
      // An empty key would match every blank cell.
      if (key) layer.set(key, entry)
    }
  }
}

/**
 * Resolve a raw cell value to its dictionary entry, or `null` if uncurated.
 *
 * THE HOT PATH. In steady state this is one `Map.get` against the original
 * string: no allocation, no lowercase, no regex. Pure with respect to registry
 * contents — see `abbreviationsVersion()` for invalidating downstream memos.
 */
export function lookupAbbreviation(
  namespace: AbbreviationNamespace,
  value: string | null | undefined,
): AbbreviationEntry | null {
  if (!value) return null
  const state = registry.get(namespace)
  if (!state) return null

  const cached = state.resolved.get(value)
  // `undefined` = never asked. `null` = asked, genuinely absent.
  if (cached !== undefined) return cached

  const key = normalizeAbbreviationKey(value)
  const found = state.runtime.get(key) ?? state.seed.get(key) ?? null

  if (state.resolved.size >= RESOLVED_CACHE_LIMIT) state.resolved.clear()
  state.resolved.set(value, found)
  return found
}

/**
 * Convenience: the compact label, or `null`.
 *
 * Callers should fall back to the full value on `null` — never to a blank cell,
 * and never to a guess. An abbreviation nobody curated is not better than the
 * name; a WRONG abbreviation is strictly worse than a long one, because the
 * operator can no longer tell two terminals apart.
 */
export function abbreviate(
  namespace: AbbreviationNamespace,
  value: string | null | undefined,
): string | null {
  return lookupAbbreviation(namespace, value)?.short ?? null
}

/**
 * Monotonic counter, bumped on every registration.
 *
 * Consumers that memoize derived output (a `useMemo` over a column's rendered
 * labels, a precomputed initials index) must include this in their dependency
 * list, otherwise the grid keeps showing long names after the dictionary loads.
 */
export function abbreviationsVersion(): number {
  return version
}

/**
 * Drop everything. Test-support only — production code has no reason to
 * un-register a dictionary.
 */
export function resetAbbreviations(): void {
  registry.clear()
  notifyAbbreviationChange()
  installDefaultSeed()
}

/**
 * Read-only view of a namespace, for debugging and for the Debugger panel.
 * Allocates; never call from a render path.
 */
export function getAbbreviationSnapshot(namespace: AbbreviationNamespace): {
  runtime: number
  seed: number
  cached: number
} {
  const state = registry.get(namespace)
  return {
    runtime: state?.runtime.size ?? 0,
    seed: state?.seed.size ?? 0,
    cached: state?.resolved.size ?? 0,
  }
}

/**
 * Adapt a facility row straight from the DB/API into a dictionary entry.
 *
 * Encodes the precedence the facilities module already implies: the curated
 * `short_name` is the label if present, otherwise the facility's own `code`
 * (which for terminals IS "BCT"/"GCT"/"DCT"), otherwise the LOCODE. If none of
 * the three exist the facility is skipped entirely rather than guessed at — an
 * uncurated facility renders its full name, which is correct behaviour.
 *
 * Every identifier the row carries becomes a `match`, so a column bound to
 * `name`, one bound to `code` and one bound to `locode` all abbreviate alike.
 */
/**
 * Longest string still worth calling an abbreviation.
 *
 * Sized from the real identifiers: a terminal trade code is 3–4 characters
 * ("BCT", "BHCT"), a UN/LOCODE is exactly 5 ("PLGDN"), and an IATA code is 3.
 * Eight leaves headroom for a curated oddity while still rejecting the thing
 * this constant exists to reject — see `looksLikeHumanCode`.
 */
const MAX_ABBREVIATION_LENGTH = 8

/**
 * Is this candidate a label a human would recognise, or an internal id?
 *
 * FOUND IN THE BROWSER, NOT REASONED ABOUT. The live `facilities` table has
 * 1738 rows in which `short_name` is null and `code` holds a generated
 * geohash-like key: "N057E010-02981", "ADDR-1BF4-9C3E". Those are not
 * abbreviations of anything. Preferring `code` over `locode` — which the
 * original precedence did, on the stated assumption that "code for terminals IS
 * BCT/GCT/DCT" — turned "Port Gdańsk" into "N031E031-04…" in an 84px column:
 * longer than the LOCODE, less readable than the name, and truncated on top.
 * That is strictly worse than not abbreviating at all.
 *
 * A length test is the whole check, and deliberately so. It needs no pattern
 * catalogue, it cannot be defeated by the next id scheme somebody invents, and
 * it fails in the SAFE direction: an unrecognised value is simply not used as a
 * label, so the cell renders the full name — which is exactly the documented
 * behaviour for an uncurated facility.
 */
export function looksLikeHumanCode(candidate: string): boolean {
  return candidate.length > 0 && candidate.length <= MAX_ABBREVIATION_LENGTH
}

export function facilityToAbbreviation(row: {
  name?: string | null
  code?: string | null
  shortName?: string | null
  locode?: string | null
}): AbbreviationEntry | null {
  // Precedence, and why it is not simply "first non-empty":
  //   1. `short_name` — CURATED BY STAFF. Always wins, never length-checked:
  //      if a human typed it into the admin screen it is the intended label,
  //      and second-guessing them here is how a central mapping stops being
  //      the source of truth.
  //   2. `code`   — the terminal's own trade code ("BCT"), WHEN it is one.
  //   3. `locode` — the UN/LOCODE. Always 5 characters and always a real
  //      standard, so it is the reliable fallback when `code` is an internal id.
  const curated = row.shortName?.trim()
  const code = row.code?.trim()
  const locode = row.locode?.trim()

  const short =
    curated ||
    (code && looksLikeHumanCode(code) ? code : '') ||
    (locode && looksLikeHumanCode(locode) ? locode : '')
  if (!short) return null

  const match: string[] = []
  if (row.name?.trim()) match.push(row.name.trim())
  if (row.code?.trim()) match.push(row.code.trim())
  if (row.locode?.trim()) match.push(row.locode.trim())
  if (match.length === 0) return null

  return { match, short, full: row.name?.trim() || undefined }
}

/**
 * Same adapter for contractors.
 *
 * NOTE: this deliberately does NOT abbreviate anything itself. `contractors`
 * already has a curated `short_name`, populated by the GUS REGON lookup and by
 * `deriveContractorShortName` in `packages/contractors/.../lib/short-name.ts`,
 * and the workshop confirmed it is live and working. Re-deriving here would be
 * a second, competing scheme that drifts from the one users maintain. When
 * `shortName` is absent the contractor keeps its full name.
 */
export function contractorToAbbreviation(row: {
  name?: string | null
  shortName?: string | null
}): AbbreviationEntry | null {
  const short = row.shortName?.trim()
  const name = row.name?.trim()
  if (!short || !name || short === name) return null
  return { match: [name], short, full: name }
}

/**
 * Static seed — the Polish terminals INF staff name out loud every day.
 *
 * Scope is deliberately tiny. This is a day-one readability floor for an
 * unseeded deployment, NOT a maintained gazetteer: the moment the facilities
 * table is populated, layer 1 supersedes all of it. Resist growing this list —
 * every entry added here is an entry that can silently disagree with the
 * database, and the database is right.
 *
 * Codes are the terminals' own SMDG/common trade codes.
 */
export const BALTIC_TERMINAL_SEED: readonly AbbreviationEntry[] = [
  {
    match: ['Baltic Container Terminal', 'Baltic Container Terminal Gdynia', 'BCT Gdynia', 'BCT'],
    short: 'BCT',
    full: 'Baltic Container Terminal Gdynia',
  },
  {
    match: ['Gdynia Container Terminal', 'GCT Gdynia', 'GCT'],
    short: 'GCT',
    full: 'Gdynia Container Terminal',
  },
  {
    match: ['Baltic Hub', 'Baltic Hub Container Terminal', 'DCT Gdansk', 'DCT Gdańsk', 'BHCT', 'DCT'],
    short: 'BHCT',
    full: 'Baltic Hub Container Terminal (ex DCT Gdańsk)',
  },
  {
    match: ['Gdansk Container Terminal', 'Gdańsk Container Terminal', 'GTK', 'GTK Gdansk'],
    short: 'GTK',
    full: 'Gdański Terminal Kontenerowy',
  },
  {
    match: ['Port Gdansk', 'Port Gdańsk', 'Port of Gdansk', 'Port of Gdańsk', 'PLGDN'],
    short: 'GDN',
    full: 'Port Gdańsk',
  },
  {
    match: ['Port Gdynia', 'Port of Gdynia', 'PLGDY'],
    short: 'GDY',
    full: 'Port Gdynia',
  },
  {
    match: ['Port Szczecin', 'Port of Szczecin', 'PLSZZ'],
    short: 'SZZ',
    full: 'Port Szczecin',
  },
  {
    match: ['Port Swinoujscie', 'Port Świnoujście', 'Port of Swinoujscie', 'PLSWI'],
    short: 'SWI',
    full: 'Port Świnoujście',
  },
]

function installDefaultSeed(): void {
  registerAbbreviationSeed(ABBREV_FACILITY, BALTIC_TERMINAL_SEED)
}

installDefaultSeed()
