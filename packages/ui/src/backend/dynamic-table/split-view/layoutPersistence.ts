'use client'

/**
 * WORKING-LAYOUT PERSISTENCE — what you left on screen is what you come back to.
 *
 * Without this the split view was amnesiac: open invoicing beside transports,
 * drag the divider, hide a toolbar, reload — and you were back to one pane at
 * the default width with the chrome restored. Every arrangement had to be
 * rebuilt by hand on every page load, which makes the feature decorative.
 *
 * This is the WORKING layout (the one you are using right now), which is a
 * different thing from a NAMED layout (`useSplitViewLayouts`, saved to the
 * server under a name you chose). Named layouts are deliberate and shareable;
 * the working layout is incidental and personal. Only the latter is stored
 * here.
 *
 * localStorage, user-scoped, for the same reasons `useDensityPreference`
 * argues at length: it CANNOT leak between users (the A3 incident, where one
 * person's view change hit the whole organisation, was received as a bug), it
 * is synchronous so the first paint is already correct rather than flashing
 * one-pane-then-two, and a layout is a statement about the SCREEN you are
 * sitting at — a 27" desk monitor and a 13" laptop want different answers.
 *
 * The scope segment reuses density's `fms.dt.uid` cache rather than resolving
 * identity a third way, so all three stores agree on who the user is.
 */

import { DENSITY_SCOPE_CACHE_KEY } from '../hooks/useDensityPreference'
import { getCurrentOrganizationScope } from '@open-mercato/shared/lib/frontend/organizationEvents'
import {
  countPanes,
  normalizeLayout,
  type LayoutNode,
  type PaneContentRef,
  type SplitLayout,
} from './types'

export const SPLIT_LAYOUT_STORAGE_PREFIX = 'fms.dt.split'

const FALLBACK_SCOPE = 'shared'

/**
 * Every scope this user could plausibly have written under, best first.
 *
 * The scope segment is NOT stable across a page load: the shared `fms.dt.uid`
 * cache is populated asynchronously, so an early write (first paint, before
 * identity resolves) lands under the organisation or `shared`, while a later
 * read resolves the real user id. Keying on a single "current" scope therefore
 * loses the layout on the next load — observed as the split view forgetting a
 * four-pane arrangement immediately after login.
 *
 * Rather than coordinate on the async hydration, reads try every candidate and
 * writes collapse to the best one, so at most one entry survives per table.
 */
function scopeCandidates(): string[] {
  const scopes: string[] = []
  try {
    const cached = window.localStorage.getItem(DENSITY_SCOPE_CACHE_KEY)
    if (cached) scopes.push(cached)
  } catch {
    /* storage unavailable — the org scope below still applies */
  }
  try {
    const org = getCurrentOrganizationScope().organizationId
    if (org) scopes.push(org)
  } catch {
    /* scope module not ready */
  }
  scopes.push(FALLBACK_SCOPE)
  return Array.from(new Set(scopes))
}

/** One entry per ANCHOR table: the transports page and the invoicing page each
 *  remember their own arrangement, which is how users think about them. */
function keyFor(anchorTableId: string, scope: string): string {
  return `${SPLIT_LAYOUT_STORAGE_PREFIX}:${scope}:${anchorTableId}`
}

/**
 * Drop panes whose CONTENT the user can no longer open.
 *
 * A stored layout outlives the grant that created it: a feature can be revoked,
 * a module removed, a table renamed, a widget dropped from the catalogue.
 * Restoring such a pane would mount an unresolvable id and leave a permanently
 * empty box the user cannot get rid of — it carries no toolbar, so it carries
 * no menu to close it with — so the pane is dropped and its siblings absorb the
 * space.
 *
 * EMPTY slots always survive: a hole the user deliberately left in a grid
 * template is content in its own right, and it is removable from the UI.
 *
 * Returns `null` when nothing survives — the caller then falls back to the
 * plain single pane rather than rendering an empty split.
 */
function pruneUnknown(
  node: LayoutNode,
  isKnown: (content: PaneContentRef) => boolean,
): LayoutNode | null {
  if (node.kind === 'pane') return isKnown(node.content) ? node : null
  if (node.kind === 'empty') return node

  const kept: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, index) => {
    const pruned = pruneUnknown(child, isKnown)
    if (!pruned) return
    kept.push(pruned)
    sizes.push(node.sizes?.[index] ?? 1 / node.children.length)
  })

  if (kept.length === 0) return null
  // A split with one surviving child is not a split any more.
  if (kept.length === 1) return kept[0]

  const total = sizes.reduce((sum, value) => sum + value, 0) || 1
  return { ...node, children: kept, sizes: sizes.map((value) => value / total) }
}

/**
 * Read the stored working layout, or `null` when there is none, it is corrupt,
 * it predates the current tree model, or none of its tables resolve.
 *
 * Deliberately total: a user whose stored layout cannot be honoured gets the
 * default view, never a crash and never an empty screen.
 */
export function readStoredLayout(
  anchorTableId: string,
  isKnown: (content: PaneContentRef) => boolean,
): SplitLayout | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    for (const scope of scopeCandidates()) {
      raw = window.localStorage.getItem(keyFor(anchorTableId, scope))
      if (raw) break
    }
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const layout = normalizeLayout(parsed, anchorTableId)
    if (!layout?.root) return null
    const pruned = pruneUnknown(layout.root, isKnown)
    if (!pruned) return null
    // A workspace with nothing left in it is not worth restoring: the page's
    // own table is a better answer than a screen of holes, and the user can
    // pick a template again in two clicks.
    if (countPanes(pruned) === 0) return null
    return { ...layout, root: pruned }
  } catch {
    // Corrupt JSON, or a shape from a future/never-shipped version. Treated
    // exactly like "no stored layout" — the default is always safe.
    return null
  }
}

/** Best-effort write. A user with no reachable storage simply gets today's
 *  amnesiac behaviour rather than an error. */
export function writeStoredLayout(anchorTableId: string, layout: SplitLayout): void {
  if (typeof window === 'undefined') return
  try {
    const [best, ...stale] = scopeCandidates()
    window.localStorage.setItem(keyFor(anchorTableId, best), JSON.stringify(layout))
    // Collapse to one entry: once identity resolves, anything written earlier
    // under the org/`shared` fallback is a duplicate that would later shadow or
    // resurrect an older arrangement.
    for (const scope of stale) window.localStorage.removeItem(keyFor(anchorTableId, scope))
  } catch {
    /* quota exceeded / storage blocked — persistence is best-effort */
  }
}

/** Used by tests, and by any future "reset this page's layout" affordance. */
export function clearStoredLayout(anchorTableId: string): void {
  if (typeof window === 'undefined') return
  try {
    for (const scope of scopeCandidates()) window.localStorage.removeItem(keyFor(anchorTableId, scope))
  } catch {
    /* nothing to do */
  }
}
