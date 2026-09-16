/**
 * Compact label formatting for dense grids — workshop item A9.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SOLVES
 *
 * A16: *"on a normal monitor roughly half the needed columns fit"*. The density
 * scale (`types/density.ts`) buys rows by shrinking the row box. This file buys
 * COLUMNS by shrinking the strings inside them, which is the other half of the
 * same problem — a 20px row is no help if the "Assignee" column still needs
 * 180px for "Agnieszka Nowak-Kowalska".
 *
 * Four strategies, in descending order of how much they save:
 *
 *   1. INITIALS      — assignees. "Agnieszka Nowak-Kowalska" → "ANK".
 *   2. DICTIONARY    — ports/terminals/contractors, via `abbreviations.ts`.
 *                      "Port Gdansk" → "GDN"; "Baltic Hub" → "BHCT".
 *   3. MIDDLE-CLIP   — identifiers whose head AND tail carry information.
 *   4. TAIL-CLIP     — prose, where the head carries the information.
 *
 * Every one of them keeps the full value available on hover. That is the rule
 * that makes aggressive shortening safe: nothing is destroyed, only folded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERFORMANCE CONTRACT
 *
 * These functions run inside `VirtualRow`'s `columns.map`, i.e. once per column
 * per mounted row per render pass — thousands of calls. Therefore:
 *
 *   - Every function here is PURE and TOTAL. No dates, no `Intl`, no library
 *     instantiation, no `try`/`catch`, no throwing.
 *   - Every regex is compiled at MODULE scope. There is not one `new RegExp`,
 *     and not one regex literal, inside a function body.
 *   - The expensive strategy (initials, which must consider the whole roster to
 *     resolve collisions) is precomputed ONCE into a `Map` by
 *     `buildInitialsIndex` and is a single `Map.get` per cell thereafter.
 *   - The clip strategies allocate at most one string, and ONLY when the input
 *     actually exceeds the budget — a value that already fits is returned by
 *     reference with zero allocation, which is the overwhelmingly common case.
 */

import {
  ABBREV_CONTRACTOR,
  ABBREV_FACILITY,
  abbreviate,
  lookupAbbreviation,
  type AbbreviationNamespace,
} from './abbreviations'

/**
 * The single-character ellipsis. `…` (U+2026) rather than "..." — one glyph
 * instead of three, which in a column budgeted at 8 characters is a 25% saving
 * on the part of the string that carries no information at all.
 */
export const ELLIPSIS = '…'

/**
 * What a compact formatter returns.
 *
 * `text` goes in the cell; `title` goes in the tooltip. When they are equal the
 * value was not shortened — callers use that to skip wrapping the cell in an
 * element at all (see `CompactLabelCell.tsx`), which is worth doing because it
 * removes an allocation and a React node from the hot path.
 */
export type CompactLabel = {
  /** The shortened string to render. Never empty unless the input was empty. */
  text: string
  /** The complete, unshortened value, for `title`. */
  title: string
  /** `true` when `text` is a lossy rendering of `title`. */
  shortened: boolean
}

/** Returned for null/blank input. Frozen and shared — no per-cell allocation. */
const EMPTY_LABEL: CompactLabel = Object.freeze({ text: '', title: '', shortened: false })

/** Allocation-free constructor for the "it already fits" case. */
function unchanged(value: string): CompactLabel {
  return { text: value, title: value, shortened: false }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. INITIALS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Name particles that are not part of the identifying surname and must not
 * contribute a letter: "Ludwig van Beethoven" is "LB", not "LvB".
 *
 * Polish `z`/`ze` ("Jan z Czarnolasu") included alongside the common Dutch,
 * German, French, Spanish and Italian particles, because FMS contact lists are
 * full of EU carrier and forwarder staff.
 */
const NAME_PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'der', 'den', 'du', 'da', 'di', 'do', 'dos', 'das',
  'la', 'le', 'el', 'al', 'bin', 'ibn', 'ter', 'ten', 'op', 'af', 'av',
  'z', 'ze', 'y', 'i',
])

/**
 * Honorifics and credentials, stripped from either end. "Dr Anna Kowalska"
 * must initial as "AK", not "DK" — an initial taken from a title identifies
 * nobody.
 */
const NAME_TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'inz', 'inż', 'mgr', 'lic', 'phd', 'md',
  'pan', 'pani', 'sir', 'herr', 'frau',
])

/** Splits on whitespace. Module scope: never recompiled. */
const NAME_SPLIT_PATTERN = /[\s.,]+/
/** Splits a compound surname. Both hyphen forms plus the Polish long dash. */
const HYPHEN_SPLIT_PATTERN = /[-–—]/
/** Anything that is not a letter or digit, for cleaning a token. */
const NON_WORD_PATTERN = /[^\p{L}\p{N}]/gu
/** An email local-part boundary, for the "name is actually an email" case. */
const EMAIL_PATTERN = /^([^@\s]+)@[^@\s]+$/
/** Separators inside an email local part: "anna.kowalska", "anna_kowalska". */
const EMAIL_LOCAL_SPLIT = /[._-]+/

/**
 * Put a raw name into canonical "Given … Surname" order before anything reads
 * it positionally.
 *
 * MUST be applied before BOTH tokenization and compound-surname detection.
 * Splitting these two apart is a real bug that this function exists to prevent:
 * `countCompoundSurnameParts` looks at the LAST whitespace-delimited chunk, so
 * running it on the raw "Nowak-Kowalska, Agnieszka" inspects "Agnieszka",
 * concludes the surname is not compound, and silently emits "AK" instead of
 * "ANK" — the exact class of wrong-initial error the whole index exists to
 * prevent, reintroduced one layer down.
 */
function canonicalNameSource(rawName: string): string {
  let source = rawName.trim()
  if (!source) return ''

  // "a.kowalska@example.com" is a name in practice — it is what an
  // un-onboarded assignee shows up as, and "AK" is far more useful than "a".
  const email = EMAIL_PATTERN.exec(source)
  if (email) source = email[1]!.replace(EMAIL_LOCAL_SPLIT, ' ')

  // "Kowalska, Anna" → "Anna Kowalska". Directory exports use this order and
  // initialling it verbatim yields "KA", which is a WRONG initial, not merely
  // an ugly one.
  const comma = source.indexOf(',')
  if (comma > 0) {
    const family = source.slice(0, comma).trim()
    const given = source.slice(comma + 1).trim()
    if (family && given) source = `${given} ${family}`
  }
  return source
}

/**
 * Break a display name into its meaningful tokens: titles and particles gone,
 * punctuation stripped, compound surnames split into their parts.
 *
 * Returns `[]` when nothing usable survives, which callers treat as "cannot
 * initial this" rather than as an empty initial.
 */
export function nameTokens(rawName: string | null | undefined): string[] {
  if (!rawName) return []
  const source = canonicalNameSource(rawName)
  if (!source) return []

  const out: string[] = []
  for (const chunk of source.split(NAME_SPLIT_PATTERN)) {
    if (!chunk) continue
    for (const part of chunk.split(HYPHEN_SPLIT_PATTERN)) {
      const clean = part.replace(NON_WORD_PATTERN, '')
      if (!clean) continue
      const lower = clean.toLowerCase()
      if (NAME_TITLES.has(lower)) continue
      if (NAME_PARTICLES.has(lower)) continue
      out.push(clean)
    }
  }
  return out
}

/**
 * Initials for one name, with no knowledge of anyone else.
 *
 * Rules, and why:
 *
 *   - The FIRST token and the LAST token always contribute. "Anna Maria
 *     Kowalska" → "AK", not "AMK": a middle name is not what distinguishes
 *     colleagues, and spending a third character on it costs column width for
 *     information nobody uses.
 *   - EXCEPT that a hyphenated surname contributes ALL its parts, because in
 *     Polish it is precisely the compound that identifies the person: Agnieszka
 *     Nowak-Kowalska → "ANK". Married-name compounds are extremely common and
 *     "AN" would collide with every other Nowak in the office.
 *   - Case is forced UPPER, so a lowercase directory export still reads as an
 *     initial and not as a typo.
 *
 * Note this takes the first CODE POINT, not `charAt(0)` — `Ł` and `Ż` are
 * single code points in the BMP so it makes no difference for Polish, but it
 * costs nothing and is correct for names outside it.
 */
export function formatInitials(rawName: string | null | undefined): string {
  const tokens = nameTokens(rawName)
  if (tokens.length === 0) return ''
  if (tokens.length === 1) return firstLetter(tokens[0]!)

  // Reconstruct which trailing tokens formed the compound surname: `nameTokens`
  // already split them, and they are by definition the trailing tokens. The
  // hyphen is gone from the token list, so detection reads the CANONICAL source
  // string — canonical, not raw, because "Nowak-Kowalska, Agnieszka" puts the
  // surname first until it is reordered.
  const compoundParts = countCompoundSurnameParts(canonicalNameSource(rawName!))
  if (compoundParts > 1) {
    let out = firstLetter(tokens[0]!)
    for (let i = tokens.length - compoundParts; i < tokens.length; i += 1) {
      if (i <= 0) continue
      out += firstLetter(tokens[i]!)
    }
    return out
  }

  return firstLetter(tokens[0]!) + firstLetter(tokens[tokens.length - 1]!)
}

function firstLetter(token: string): string {
  // Iterating the string yields whole code points; `[0]` would split a
  // surrogate pair and render a replacement glyph.
  for (const ch of token) return ch.toUpperCase()
  return ''
}

/**
 * How many parts the trailing compound surname has. 1 = not compound.
 * Cheap: scans the last whitespace-delimited chunk only.
 */
function countCompoundSurnameParts(rawName: string): number {
  const trimmed = rawName.trim()
  const lastSpace = trimmed.lastIndexOf(' ')
  const tail = lastSpace >= 0 ? trimmed.slice(lastSpace + 1) : trimmed
  let parts = 1
  for (const ch of tail) {
    if (ch === '-' || ch === '–' || ch === '—') parts += 1
  }
  return parts
}

/**
 * A precomputed, collision-free name → initials map.
 *
 * WHY THIS IS A MAP AND NOT A FUNCTION
 *
 * Collisions cannot be resolved one cell at a time. Whether "AK" is safe for
 * "Anna Kowalska" depends entirely on whether an "Adam Kowalski" also exists —
 * information a per-cell formatter does not have and cannot cheaply get. The
 * brief is explicit that *a wrong initial is worse than a long name*, and two
 * people sharing one initial in an assignee column is exactly a wrong initial:
 * the operator reads "AK", assigns work to the wrong person, and nothing in the
 * UI ever tells them.
 *
 * So collisions are resolved ONCE, against the whole roster, by escalating
 * through progressively longer forms until every name is unique:
 *
 *   1. "AK"           — initials
 *   2. "AKow"         — given initial + 3 chars of surname
 *   3. "A.Kowalska"   — given initial + full surname
 *   4. the full name  — give up shortening rather than be ambiguous
 *
 * The escalation is applied ONLY to the colliding group, so one unlucky pair of
 * names does not widen the column for everybody.
 *
 * DETERMINISM: names are sorted before processing, so the same roster always
 * produces the same map regardless of the order rows arrived in. Without this
 * the initials would shuffle as the grid paged or re-sorted, which reads as a
 * rendering bug.
 *
 * STABILITY, stated honestly: adding a colliding person to the roster CAN
 * lengthen an existing person's initials ("AK" → "AKow"). That is the correct
 * trade — an initial that changes when a colleague joins is recoverable; an
 * initial that silently points at two people is not.
 *
 * COST: O(n log n) in roster size, run once per roster change — NOT per cell.
 * Feed it the assignee list you already fetch for the column's filter/editor
 * options, memoized on that list plus `abbreviationsVersion()`.
 */
export function buildInitialsIndex(names: readonly (string | null | undefined)[]): Map<string, string> {
  const index = new Map<string, string>()

  // Dedupe first: a roster derived from row data repeats every assignee once
  // per row, and a duplicate must not be mistaken for a collision.
  const unique: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (!name) continue
    const trimmed = name.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    unique.push(trimmed)
  }
  unique.sort()

  // Group by their level-1 form, then escalate only the groups that collide.
  const groups = new Map<string, string[]>()
  for (const name of unique) {
    const initials = formatInitials(name)
    // Un-initialisable (e.g. "???") — the full name is the only honest answer.
    if (!initials) {
      index.set(name, name)
      continue
    }
    const bucket = groups.get(initials)
    if (bucket) bucket.push(name)
    else groups.set(initials, [name])
  }

  for (const [initials, members] of groups) {
    if (members.length === 1) {
      index.set(members[0]!, initials)
      continue
    }
    resolveCollision(members, index)
  }

  return index
}

/**
 * Escalate a colliding group to the SHORTEST level at which every member is
 * distinct. Level-by-level rather than per-member, so the column stays visually
 * consistent: three "Kowalski"s all render at the same length rather than one
 * being "AK" and another "AKow".
 */
function resolveCollision(members: readonly string[], index: Map<string, string>): void {
  for (let level = 2; level <= 3; level += 1) {
    const candidates = new Map<string, string>()
    let distinct = true
    for (const name of members) {
      const candidate = initialsAtLevel(name, level)
      if (!candidate || candidates.has(candidate)) {
        distinct = false
        break
      }
      candidates.set(candidate, name)
    }
    if (distinct) {
      for (const [candidate, name] of candidates) index.set(name, candidate)
      return
    }
  }
  // Level 4: two people genuinely share a printable name, or the escalation
  // could not separate them. Show the full name — ambiguity is not acceptable
  // and there is nothing shorter left that is honest.
  for (const name of members) index.set(name, name)
}

/** Escalation forms. Level 1 is `formatInitials`; see `resolveCollision`. */
function initialsAtLevel(name: string, level: number): string {
  const tokens = nameTokens(name)
  if (tokens.length === 0) return name
  const given = firstLetter(tokens[0]!)
  const surname = tokens.length > 1 ? tokens[tokens.length - 1]! : tokens[0]!

  if (level === 2) {
    // Given initial + first 3 of surname. Capitalised so it reads as a name
    // fragment ("AKow") rather than as a code.
    return given + capitalize(surname.slice(0, 3))
  }
  // Level 3: given initial + full surname.
  return `${given}.${capitalize(surname)}`
}

function capitalize(token: string): string {
  if (!token) return ''
  let first = ''
  for (const ch of token) {
    first = ch
    break
  }
  return first.toUpperCase() + token.slice(first.length).toLowerCase()
}

/**
 * Per-cell assignee formatter.
 *
 * One `Map.get` when an index is supplied. Falls back to uncollided initials
 * when it is not — correct for a single-name context (a drawer, a detail
 * header) and an acceptable degradation in a grid whose roster has not loaded
 * yet, since the value is only ever a *display* shortening and the full name is
 * always in the tooltip.
 */
export function formatAssignee(
  rawName: string | null | undefined,
  index?: ReadonlyMap<string, string> | null,
): CompactLabel {
  if (!rawName) return EMPTY_LABEL
  const title = rawName.trim()
  if (!title) return EMPTY_LABEL

  const text = index?.get(title) ?? formatInitials(title)
  if (!text) return unchanged(title)
  return text === title ? unchanged(title) : { text, title, shortened: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DICTIONARY (ports, terminals, contractors)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look a value up in a central dictionary namespace and fold it if found.
 *
 * Falls through to the untouched value when uncurated — never guesses, never
 * blanks. See `abbreviations.ts` for why guessing is not on the table.
 */
export function formatFromDictionary(
  namespace: AbbreviationNamespace,
  value: string | null | undefined,
): CompactLabel {
  if (!value) return EMPTY_LABEL
  const entry = lookupAbbreviation(namespace, value)
  if (!entry) return unchanged(value)
  // Prefer the dictionary's own `full` for the tooltip — it is the canonical
  // name, whereas the cell value may be an alias or a bare code.
  const title = entry.full ?? value
  return entry.short === title
    ? unchanged(title)
    : { text: entry.short, title, shortened: true }
}

/** Ports / terminals / airports / depots. Workshop A9: "Port Gdansk" → "GDN". */
export function formatFacility(value: string | null | undefined): CompactLabel {
  return formatFromDictionary(ABBREV_FACILITY, value)
}

/**
 * Contractors.
 *
 * Uses the EXISTING, already-live `contractors.short_name` by way of the
 * registry — it does not derive anything. The workshop confirmed short names
 * are in place and working, and `packages/contractors/.../lib/short-name.ts`
 * already owns derivation for the cases where they are missing. A second
 * abbreviation scheme here would drift from the one staff actually maintain.
 */
export function formatContractor(value: string | null | undefined): CompactLabel {
  return formatFromDictionary(ABBREV_CONTRACTOR, value)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 & 4. TRUNCATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tail-clip: keep the head, drop the tail. For PROSE.
 *
 * Correct when the string reads left to right and the beginning carries the
 * meaning — descriptions, notes, addresses, company names. "Uszkodzenie plomby
 * przy rozładunku" → "Uszkodzenie plom…".
 *
 * Returns the input BY REFERENCE when it already fits: no allocation, no
 * `slice`, which matters because the fits-already case is most cells.
 */
export function truncateTail(value: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (value.length <= maxChars) return value
  if (maxChars === 1) return ELLIPSIS
  return value.slice(0, maxChars - 1) + ELLIPSIS
}

/**
 * Middle-clip: keep the head AND the tail, drop the middle. For IDENTIFIERS.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL
 *
 * Freight identifiers are structured as [issuer prefix][serial]. The prefix is
 * shared across thousands of records; the SERIAL is what distinguishes them.
 * Tail-clipping such a value destroys precisely the informative part and leaves
 * the redundant one:
 *
 *   MSCU7234561  → tail-clip →  "MSCU72…"      ← MSCU is on 4 000 other rows
 *                → mid-clip  →  "MSC…561"      ← the serial survives
 *   MAEU1234567890 → tail    →  "MAEU123…"
 *                  → mid     →  "MAE…7890"
 *
 * In a column of container or booking numbers, tail-clipping makes every cell
 * look identical — the operator has to open each record to tell them apart,
 * which is the exact behaviour the density work exists to eliminate.
 *
 * The split favours the TAIL when the budget is odd, because the tail is the
 * discriminating end.
 */
export function truncateMiddle(value: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (value.length <= maxChars) return value
  if (maxChars <= 2) return ELLIPSIS

  const keep = maxChars - 1
  // Tail gets the extra character on an odd budget.
  const head = keep >> 1
  const tail = keep - head
  return value.slice(0, head) + ELLIPSIS + value.slice(value.length - tail)
}

/**
 * Which end of a string is worth keeping.
 *
 * - `identifier` → middle-clip (container/booking/invoice numbers, refs)
 * - `prose`      → tail-clip (descriptions, notes, names, addresses)
 */
export type FitMode = 'identifier' | 'prose'

/**
 * Heuristic mode detection, for callers that have not declared one.
 *
 * A value is treated as an identifier when it contains no space and mixes
 * letters with digits — which is what a container number, booking ref, invoice
 * number or MMSI looks like, and which prose essentially never is.
 *
 * DELIBERATELY CONSERVATIVE: it defaults to `prose`, because tail-clipping a
 * misdetected identifier is merely unhelpful, whereas middle-clipping prose is
 * actively unreadable ("Uszkodz…ładunku"). Callers that KNOW the column holds
 * identifiers should pass the mode explicitly rather than rely on this.
 *
 * Cost: one pass over at most the first 64 characters, no allocation, no regex.
 */
export function detectFitMode(value: string): FitMode {
  let hasDigit = false
  let hasAlpha = false
  const limit = value.length < 64 ? value.length : 64
  for (let i = 0; i < limit; i += 1) {
    const code = value.charCodeAt(i)
    if (code === 32 || code === 9) return 'prose'
    if (code >= 48 && code <= 57) hasDigit = true
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) hasAlpha = true
  }
  return hasDigit && hasAlpha ? 'identifier' : 'prose'
}

/**
 * Fit a value into a character budget, keeping the informative end.
 *
 * The general-purpose entry point for item 4. Always reports the full value as
 * `title`, so nothing is ever lost — only folded.
 */
export function fitText(
  value: string | null | undefined,
  maxChars: number,
  mode?: FitMode,
): CompactLabel {
  if (!value) return EMPTY_LABEL
  if (maxChars <= 0 || value.length <= maxChars) return unchanged(value)
  const resolved = mode ?? detectFitMode(value)
  const text = resolved === 'identifier'
    ? truncateMiddle(value, maxChars)
    : truncateTail(value, maxChars)
  return { text, title: value, shortened: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a column wants its labels compacted.
 *
 * `maxChars` composes with every strategy: a dictionary hit or a set of
 * initials is *also* clipped if it somehow still overflows, so a budget is a
 * genuine guarantee about column width rather than a hope.
 */
export type CompactLabelSpec =
  | { kind: 'assignee'; index?: ReadonlyMap<string, string> | null; maxChars?: number }
  | { kind: 'facility'; maxChars?: number }
  | { kind: 'contractor'; maxChars?: number }
  | { kind: 'dictionary'; namespace: AbbreviationNamespace; maxChars?: number }
  | { kind: 'text'; mode?: FitMode; maxChars: number }

/**
 * Single entry point used by the renderers in `CompactLabelCell.tsx`.
 *
 * Pure. One `Map.get` plus at most one `slice` in the worst case; zero
 * allocation when the value already fits and is not in a dictionary.
 */
export function formatLabelCompact(
  value: unknown,
  spec: CompactLabelSpec,
): CompactLabel {
  const raw = toDisplayString(value)
  if (!raw) return EMPTY_LABEL

  let label: CompactLabel
  switch (spec.kind) {
    case 'assignee':
      label = formatAssignee(raw, spec.index)
      break
    case 'facility':
      label = formatFacility(raw)
      break
    case 'contractor':
      label = formatContractor(raw)
      break
    case 'dictionary':
      label = formatFromDictionary(spec.namespace, raw)
      break
    case 'text':
      return fitText(raw, spec.maxChars, spec.mode)
    default:
      return unchanged(raw)
  }

  const budget = spec.maxChars
  if (!budget || label.text.length <= budget) return label
  // Still over budget after folding — clip, but keep the ORIGINAL title.
  return {
    text: truncateTail(label.text, budget),
    title: label.title,
    shortened: true,
  }
}

/**
 * Coerce a cell value to a display string.
 *
 * Relation columns in this grid store either a plain string or an object with a
 * `name`/`label`, and some store `JSON.stringify({ id, name })`. Handled here
 * rather than in each formatter so every strategy behaves the same on them.
 *
 * Returns `''` for anything it cannot honestly render, which callers treat as
 * an empty cell.
 */
export function toDisplayString(value: unknown): string {
  if (value == null) return ''
  const t = typeof value
  if (t === 'string') return (value as string).trim()
  if (t === 'number' || t === 'boolean') return String(value)
  if (t === 'object') {
    const obj = value as Record<string, unknown>
    const named = obj.name ?? obj.label ?? obj.shortName ?? obj.code
    if (typeof named === 'string') return named.trim()
  }
  return ''
}

/** Re-exported so consumers need only this module for the common cases. */
export { abbreviate, ABBREV_FACILITY, ABBREV_CONTRACTOR }
