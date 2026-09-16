/**
 * Unit-impediment ("hold") catalogue for Navis N4 terminals (Baltic Hub / BCT).
 *
 * N4 returns the `Unit Impediments` column as a comma-separated list of codes,
 * each prefixed with `!` and delimited inconsistently — some use underscores
 * (`!TECHNICAL_FULL_CONTAINER`), others spaces (`!CUSTOMS EXPORT PERMISSION`).
 * This module normalizes a raw code and resolves it to a human explanation plus
 * a severity, so the UI can render a coloured badge with an informative tooltip.
 *
 * Source of truth for the catalogue: Baltic Hub documentation
 * https://baltichub.com/dla-klienta/navis
 *
 * Pure helper — no DI, no i18n, no React. English strings by convention; the
 * consuming component owns localization/colour mapping.
 */

/**
 * How urgently a hold needs attention.
 * - `critical`: blocks movement/load/pickup and typically needs a third party
 *   (customs office, terminal CS) to lift — cannot be self-served.
 * - `warning`: routine, systematic permission that is auto- or self-removed in
 *   the normal flow (MRN update, VGM upload, line PIN) but currently blocks.
 * - `info`: technical/administrative marker that does NOT block operations.
 */
export type HoldSeverity = 'critical' | 'warning' | 'info'

/** Which container flow the hold belongs to. */
export type HoldCategory = 'import' | 'export' | 'general'

export type HoldDefinition = {
  /** Canonical, normalized code (no `!`, spaced, upper-case). */
  code: string
  /** Short human label for the badge. */
  label: string
  category: HoldCategory
  severity: HoldSeverity
  /** Whether the hold blocks physical movement / loading / pickup. */
  blocksMovement: boolean
  /** What the hold means / why it is applied. */
  description: string
  /** How the hold is cleared and by whom. */
  resolution: string
}

/** Resolved hold: a known definition, or an `unknown: true` fallback. */
export type HoldInfo = HoldDefinition & {
  /** Original code as received from the terminal (with `!`, original spacing). */
  rawCode: string
  /** True when the code was not in the catalogue. */
  unknown: boolean
  /**
   * Stable slug for i18n lookup, e.g. `dgd_hold`. The `label`/`description`/
   * `resolution` fields above are English fallbacks; the consuming component
   * resolves `terminal_tracking.holds.<i18nKey>.{label,description,resolution}`
   * against the active locale, falling back to those English strings.
   */
  i18nKey: string
}

/** Derive the i18n slug for a normalized hold code (e.g. `DGD HOLD` → `dgd_hold`). */
export function holdI18nKey(normalizedCode: string): string {
  return normalizedCode.toLowerCase().replace(/ /g, '_')
}

/** Sort/threshold rank: higher = more urgent. */
export const HOLD_SEVERITY_RANK: Record<HoldSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
}

/**
 * Normalize a raw N4 impediment code into its canonical lookup key: drop the
 * leading `!`, trim, upper-case, and collapse runs of `_`/whitespace into a
 * single space so `TECHNICAL_FULL_CONTAINER` and `TECHNICAL FULL CONTAINER`
 * resolve to the same entry.
 */
export function normalizeHoldCode(rawCode: string): string {
  return rawCode
    .replace(/^!/, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .toUpperCase()
}

function def(
  code: string,
  category: HoldCategory,
  severity: HoldSeverity,
  blocksMovement: boolean,
  label: string,
  description: string,
  resolution: string,
): HoldDefinition {
  return { code, category, severity, blocksMovement, label, description, resolution }
}

/** Catalogue keyed by normalized code. */
const HOLD_CATALOGUE: Record<string, HoldDefinition> = {
  // ── Import ────────────────────────────────────────────────────────────────
  'CFS APPOINTMENT': def(
    'CFS APPOINTMENT',
    'import',
    'warning',
    true,
    'CFS appointment',
    'Applied while a CFS (warehouse) import order is being accepted.',
    'Cleared automatically once the order is completed and warehouse work is done.',
  ),
  'CUSTOMS IMPORT PERMISSION': def(
    'CUSTOMS IMPORT PERMISSION',
    'import',
    'warning',
    true,
    'Customs import permission',
    'Applied systematically to every import container pending customs release.',
    'Removed automatically after the MRN number is updated via the Polish PCS codes.',
  ),
  'CUSTOMS IMPORT HOLD': def(
    'CUSTOMS IMPORT HOLD',
    'import',
    'critical',
    true,
    'Customs import hold',
    'Placed manually by a customs officer for scanning, inspection or a clearance issue.',
    'Only a customs officer can lift it — contact the customs office.',
  ),
  'LINE IMPORT PERMISSION': def(
    'LINE IMPORT PERMISSION',
    'import',
    'warning',
    true,
    'Line import permission',
    'Applied systematically to every import container until the shipping line releases it.',
    'Removed once the line releases the container via its PIN number.',
  ),
  'OOG HOLD': def(
    'OOG HOLD',
    'import',
    'critical',
    true,
    'OOG hold',
    'Applied to out-of-gauge import containers that require special handling permits.',
    'Must be verified by Baltic Hub before pickup; the container cannot be notified for collection until then.',
  ),

  // ── Export ────────────────────────────────────────────────────────────────
  'CFS HOLD': def(
    'CFS HOLD',
    'export',
    'warning',
    true,
    'CFS hold',
    'Applied while a CFS (warehouse) export order is being accepted.',
    'Cleared automatically once the order is completed and warehouse work is done.',
  ),
  'CUSTOMS EXPORT PERMISSION': def(
    'CUSTOMS EXPORT PERMISSION',
    'export',
    'warning',
    true,
    'Customs export permission',
    'Applied systematically to export containers pending customs release.',
    'Removed automatically after the MRN update; must be cleared before the customs-clearance deadline.',
  ),
  'CUSTOMS EXPORT HOLD': def(
    'CUSTOMS EXPORT HOLD',
    'export',
    'critical',
    true,
    'Customs export hold',
    'Placed manually by a customs officer for scanning, inspection or a clearance issue.',
    'Only a customs officer can lift it — contact the customs office.',
  ),
  'UNIT VGM LOAD PERMISSION': def(
    'UNIT VGM LOAD PERMISSION',
    'export',
    'warning',
    true,
    'VGM load permission',
    'Applied to every full export container that has no verified gross mass yet.',
    'Removed when the VGM weight is uploaded to Navis.',
  ),
  'DGD HOLD': def(
    'DGD HOLD',
    'export',
    'critical',
    true,
    'DGD hold',
    'Applied automatically to every export container carrying IMO (dangerous) cargo.',
    'Requires the DGD (dangerous-goods declaration) document to be submitted.',
  ),
  'SCANNING HOLD': def(
    'SCANNING HOLD',
    'export',
    'critical',
    true,
    'Scanning hold',
    'Placed manually by a customs officer; the container must be presented for scanning.',
    'Cleared by customs after scanning (DCT_CFS_SCANNING selection).',
  ),

  // ── General / technical ─────────────────────────────────────────────────────
  'EMPTY PERMISSION': def(
    'EMPTY PERMISSION',
    'general',
    'warning',
    true,
    'Empty permission',
    'Applied systematically to every empty container pending a release reference.',
    'Removed once the EDO / booking number from the shipping line is provided.',
  ),
  'MISSING AGENT PERMISSION': def(
    'MISSING AGENT PERMISSION',
    'general',
    'info',
    false,
    'Missing agent permission',
    'Relates to an inactive PCS payment. Does not currently block ship loading or pickup.',
    'Removed by entering the shipping code in the Agent One field.',
  ),
  'TECHNICAL FULL CONTAINER': def(
    'TECHNICAL FULL CONTAINER',
    'general',
    'info',
    false,
    'Technical (full container)',
    'Applied to every full import/export container to support OCR character recognition. Does not block movement.',
    'No action required — informational only.',
  ),
  'TECHNICAL LIVE REEFER': def(
    'TECHNICAL LIVE REEFER',
    'general',
    'info',
    false,
    'Technical (live reefer)',
    'Applied to every full reefer container to support OCR. Does not block operations.',
    'No action required — informational only.',
  ),
  // Baltic Hub's Navis docs spell this "REFFER" (double F); keep both spellings
  // so the real terminal code resolves to the non-blocking definition instead of
  // the blocking unknown-hold fallback.
  'TECHNICAL LIVE REFFER': def(
    'TECHNICAL LIVE REFFER',
    'general',
    'info',
    false,
    'Technical (live reefer)',
    'Applied to every full reefer container to support OCR. Does not block operations.',
    'No action required — informational only.',
  ),
  'TERMINAL HOLD': def(
    'TERMINAL HOLD',
    'general',
    'critical',
    true,
    'Terminal hold',
    'Applied for a container irregularity (incorrect labelling, bent container beams, etc.).',
    'Contact Baltic Hub Customer Service to resolve.',
  ),
  'CZRM HOLD': def(
    'CZRM HOLD',
    'general',
    'critical',
    true,
    'CZRM hold',
    'Applied by the customs office.',
    'Contact the customs office directly to have it lifted.',
  ),
  'IZRX HOLD': def(
    'IZRX HOLD',
    'general',
    'critical',
    true,
    'IZRX hold',
    'Applied by the customs office.',
    'Contact the customs office directly to have it lifted.',
  ),
}

/**
 * The canonical, normalized codes known to the catalogue, sorted by severity
 * (most-urgent first) then alphabetically. Consumers that offer a constrained
 * "pick a hold" UI (dropdown) or validate manual entry against the known set
 * use this instead of hard-coding the list.
 */
export const HOLD_CODES: string[] = Object.keys(HOLD_CATALOGUE).sort((a, b) => {
  const bySeverity = HOLD_SEVERITY_RANK[HOLD_CATALOGUE[b].severity] - HOLD_SEVERITY_RANK[HOLD_CATALOGUE[a].severity]
  return bySeverity !== 0 ? bySeverity : a.localeCompare(b)
})

/** True when `code` (normalized) is a known catalogue entry. */
export function isKnownHoldCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(HOLD_CATALOGUE, normalizeHoldCode(code))
}

/**
 * Resolve a single raw impediment code to its explanation + severity. Unknown
 * codes return a `warning`-severity fallback that echoes the cleaned code, so a
 * never-before-seen hold still renders something meaningful and visible.
 */
export function getHoldInfo(rawCode: string): HoldInfo {
  const key = normalizeHoldCode(rawCode)
  const found = HOLD_CATALOGUE[key]
  if (found) {
    return { ...found, rawCode, unknown: false, i18nKey: holdI18nKey(key) }
  }
  // Unknown code: surface the raw hold itself as the label (just drop the `!`
  // marker) so an operator still sees exactly what the terminal reported.
  const rawLabel = rawCode.replace(/^!/, '').trim()
  return {
    code: key,
    label: rawLabel || 'Unknown hold',
    category: 'general',
    severity: 'warning',
    blocksMovement: true,
    description: 'Unrecognised terminal hold. Refer to the terminal for details.',
    resolution: 'Contact the terminal to determine how this hold is cleared.',
    rawCode,
    unknown: true,
    i18nKey: 'unknown',
  }
}

/**
 * Resolve a list of raw impediment codes, sorted most-urgent first. Empty,
 * null, or all-whitespace entries are dropped.
 */
export function resolveHolds(rawCodes: readonly string[] | null | undefined): HoldInfo[] {
  if (!rawCodes || rawCodes.length === 0) return []
  return rawCodes
    .filter((c) => c != null && c.trim() !== '')
    .map(getHoldInfo)
    .sort((a, b) => HOLD_SEVERITY_RANK[b.severity] - HOLD_SEVERITY_RANK[a.severity])
}

/** The highest severity among a list of raw codes, or `null` when there are none. */
export function highestHoldSeverity(
  rawCodes: readonly string[] | null | undefined,
): HoldSeverity | null {
  const holds = resolveHolds(rawCodes)
  if (holds.length === 0) return null
  return holds[0].severity // already sorted most-urgent first
}
