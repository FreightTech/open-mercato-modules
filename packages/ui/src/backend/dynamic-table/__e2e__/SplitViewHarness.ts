/**
 * SplitViewHarness — the ONE driver for composable split-view workspaces.
 *
 * Companion to `GridHarness`, not a replacement: this drives the WORKSPACE
 * (slots, templates, the content picker, the shared filter bar) and hands you a
 * scoped `GridHarness` for any pane that holds a table. Per the repo rule, do
 * not hand-roll a second driver — extend this one.
 *
 * Everything selects on stable `data-*` hooks the components already emit, not
 * on visible text, so a copy change or a translation does not break the suite:
 *
 *   [data-split-view]           "true" once more than one slot exists
 *   [data-shared-filters]       "on" | "off"
 *   [data-pane-id]              one per filled pane
 *   [data-pane-table]           registry table id held by a pane
 *   [data-pane-widget]          widget id held by a pane
 *   [data-pane-status]          "unknown" | "denied" on a degraded pane
 *   [data-split-divider]        one per boundary between siblings
 *   [data-split-customize-tab]  the "Dostosuj" tab that opens the drawer
 *   [data-split-customize]      the "Dostosowanie widoku" drawer
 *   [data-split-template]       a grid tile in the drawer (step 1)
 *   [data-split-main]           the main grid, as opposed to the sections
 *   [data-workspace-box]        a section below the main grid
 *   [data-workspace-filter-bar] the workspace bar (split only)
 *   [data-table-settings]       a table's ⚙
 *   [data-table-setting=key]    one switch in it: toolbar | tabs | pagination | striped
 *   [data-pane-menu-rows]       a pane's own rows inside its ⋯ / ⋮
 *
 * Specs: .ai/specs/2026-09-23-split-view-workspace-customize.md
 *        .ai/specs/2026-08-17-split-view-workspace-composition.md
 *        .ai/specs/2026-08-04-dynamic-table-split-view.md
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { GridHarness } from './GridHarness'

// Re-exported so a consuming spec gets the layout's geometry from the same
// module as its driver — `split-view/types` is pure (no React), so this keeps
// the harness loadable in plain Node.
export { PANE_MIN_HEIGHT_PX, PANE_MIN_WIDTH_PX, BOX_MAX_SLOTS } from '../split-view/types'

/** The six grids of the "Dostosowanie widoku" drawer, in its order. */
export type TemplateId = '2x1' | '1x2' | '2x2' | '3-up' | 'one-top-two-below' | 'two-top-one-below'

/** How many slots each template is contracted to produce. */
export const TEMPLATE_SLOTS: Record<TemplateId, number> = {
  '2x1': 2,
  '1x2': 2,
  '2x2': 4,
  '3-up': 3,
  'one-top-two-below': 3,
  'two-top-one-below': 3,
}

const READY_TIMEOUT = 30_000

export class SplitViewHarness {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  /**
   * Open an anchor page and wait for its split view.
   *
   * ALWAYS clears the stored working layout first. Without this a spec inherits
   * whatever arrangement the previous spec left in localStorage, which is the
   * single most likely source of a suite that passes alone and fails in a run.
   */
  static async open(page: Page, url: string): Promise<SplitViewHarness> {
    const harness = new SplitViewHarness(page)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await harness.clearStoredLayout()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await harness.waitReady()
    await harness.dismissOverlays()
    return harness
  }

  /** Wait until the host has rendered at least one slot. */
  async waitReady(timeout = READY_TIMEOUT): Promise<void> {
    await this.page.locator('[data-split-view]').first().waitFor({ state: 'attached', timeout })
    await expect
      .poll(async () => (await this.slotCount()) > 0, { timeout })
      .toBe(true)
  }

  /**
   * Wait for the layout to SETTLE, not merely to exist.
   *
   * After a reload the anchor pane mounts first and the restored siblings paint
   * a frame or two later, so a bare `waitReady` can observe 1 slot when the
   * stored layout has 4. Asserting straight after it produced a real flake.
   * Settled = the same count twice in a row, with the expected count required
   * when the caller knows it.
   */
  async waitForSlots(expected?: number, timeout = READY_TIMEOUT): Promise<number> {
    await this.waitReady(timeout)
    if (expected !== undefined) {
      await expect.poll(() => this.slotCount(), { timeout }).toBe(expected)
      return expected
    }
    let last = -1
    await expect
      .poll(
        async () => {
          const current = await this.slotCount()
          const stable = current === last
          last = current
          return stable
        },
        { timeout, intervals: [250, 250, 500] },
      )
      .toBe(true)
    return last
  }

  /**
   * The demo banner and the cookie bar overlay the toolbar and silently swallow
   * clicks — a click that lands on a `<p>` reports success and does nothing,
   * which reads as a broken feature. Cleared before every interaction phase.
   */
  async dismissOverlays(): Promise<void> {
    await this.page.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => {
        if (/Accept cookies|Dismiss/i.test(b.textContent ?? '')) b.click()
      })
    })
  }

  /** Wipe every persisted working layout for this user, whatever the scope key. */
  async clearStoredLayout(): Promise<void> {
    await this.page.evaluate(() => {
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith('fms.dt.split'))
        .forEach((k) => window.localStorage.removeItem(k))
    })
  }

  /** The persisted working-layout keys, for asserting persistence directly. */
  async storedLayoutKeys(): Promise<string[]> {
    return this.page.evaluate(() =>
      Object.keys(window.localStorage).filter((k) => k.startsWith('fms.dt.split')),
    )
  }

  // ── Reading the layout ─────────────────────────────────────────────────────

  panes(): Locator {
    return this.page.locator('[data-pane-id]')
  }

  async paneCount(): Promise<number> {
    return this.panes().count()
  }

  /** Empty slots are add-affordances, not panes — counted separately by design. */
  emptySlots(): Locator {
    return this.page.getByRole('button', { name: /Add table or widget/i })
  }

  async emptySlotCount(): Promise<number> {
    return this.emptySlots().count()
  }

  /** Filled panes + empty slots — what a grid template promises. */
  async slotCount(): Promise<number> {
    return (await this.paneCount()) + (await this.emptySlotCount())
  }

  async dividerCount(): Promise<number> {
    return this.page.locator('[data-split-divider]').count()
  }

  async isSplit(): Promise<boolean> {
    return (await this.page.locator('[data-split-view]').first().getAttribute('data-split-view')) === 'true'
  }

  /** Registry ids of every table pane, in document order. */
  async tableIds(): Promise<string[]> {
    return this.page.$$eval('[data-pane-table]', (els) =>
      els.map((e) => e.getAttribute('data-pane-table') ?? ''),
    )
  }

  /** Widget ids of every widget pane, in document order. */
  async widgetIds(): Promise<string[]> {
    return this.page.$$eval('[data-pane-widget]', (els) =>
      els.map((e) => e.getAttribute('data-pane-widget') ?? ''),
    )
  }

  paneByTable(tableId: string): Locator {
    return this.page.locator(`[data-pane-table="${tableId}"]`)
  }

  paneByWidget(widgetId: string): Locator {
    return this.page.locator(`[data-pane-widget="${widgetId}"]`)
  }

  /** A `GridHarness` scoped to ONE pane — this is how you assert on its rows. */
  gridFor(tableId: string): GridHarness {
    return new GridHarness(this.page, {
      root: this.paneByTable(tableId).locator('.hot-container').first(),
    })
  }

  /** Degradation state of a pane, when it has one. */
  async paneStatuses(): Promise<string[]> {
    return this.page.$$eval('[data-pane-status]', (els) =>
      els.map((e) => e.getAttribute('data-pane-status') ?? ''),
    )
  }

  // ── Pane menus, the drawer, the ⚙ ──────────────────────────────────────────

  /** Open a TABLE pane's ⋯ menu, which carries the pane's own rows. */
  async openMenu(paneIndex = 0): Promise<void> {
    await this.dismissOverlays()
    const button = this.page.getByRole('button', { name: /More table actions/i }).nth(paneIndex)
    await button.click()
    await expect(this.page.locator('[data-pane-menu-rows]').first()).toBeVisible({ timeout: 10_000 })
  }

  async closeMenu(): Promise<void> {
    await this.page.keyboard.press('Escape')
  }

  /** Open the "Dostosowanie widoku" drawer from the Dostosuj tab. */
  async openCustomize(): Promise<Locator> {
    await this.dismissOverlays()
    await this.page.locator('[data-split-customize-tab]').first().click()
    const drawer = this.page.locator('[data-split-customize]').first()
    await expect(drawer).toBeVisible({ timeout: 10_000 })
    return drawer
  }

  async closeCustomize(): Promise<void> {
    await this.page.locator('[data-customize-done]').first().click()
    await expect(this.page.locator('[data-split-customize]')).toHaveCount(0, { timeout: 10_000 })
  }

  /** Slots of the MAIN grid only — sections below it are counted separately. */
  async mainSlotCount(): Promise<number> {
    const main = this.page.locator('[data-split-main]').first()
    if ((await main.count()) === 0) return this.slotCount()
    return (await main.locator('[data-pane-id]').count()) + (await main.locator('[data-pane-empty]').count())
  }

  /** How many sections sit below the main grid. */
  async boxCount(): Promise<number> {
    return this.page.locator('[data-workspace-box]').count()
  }

  /**
   * Apply a grid from the drawer, then wait for the main grid's contracted slot
   * count. Panes that do not fit move to sections — nothing is dropped.
   */
  async applyTemplate(id: TemplateId): Promise<void> {
    const drawer = await this.openCustomize()
    await drawer.locator(`[data-split-template="${id}"]`).first().click()
    await this.closeCustomize()
    await expect.poll(() => this.mainSlotCount(), { timeout: 15_000 }).toBe(TEMPLATE_SLOTS[id])
  }

  /**
   * Switch one of a table pane's bars on or off from its ⚙.
   *
   * 'Views bar' is the row of saved-view tabs AND pagination: both switches go,
   * which is what reclaims the row.
   */
  async toggleChrome(label: 'Toolbar' | 'Views bar' | 'Tabs' | 'Pagination' | 'Striped', paneIndex = 0): Promise<void> {
    await this.dismissOverlays()
    const pane = this.panes().nth(paneIndex)
    // With the toolbar hidden the ⚙ floats in the corner and shows on hover.
    await pane.hover()
    await pane.locator('[data-table-settings]').first().click()
    const keys: Record<typeof label, string[]> = {
      Toolbar: ['toolbar'],
      'Views bar': ['tabs', 'pagination'],
      Tabs: ['tabs'],
      Pagination: ['pagination'],
      Striped: ['striped'],
    }
    for (const key of keys[label]) {
      await this.page.locator(`[data-table-settings-menu] [data-table-setting="${key}"]`).click()
    }
    await this.closeMenu()
  }

  /** Split a pane ("Dodaj obok"), choosing the content in the picker that follows. */
  async splitPane(
    direction: 'Left' | 'Right' | 'Above' | 'Below',
    content: string,
    paneIndex = 0,
  ): Promise<void> {
    await this.openMenu(paneIndex)
    const attr = { Left: 'left', Right: 'right', Above: 'up', Below: 'down' }[direction]
    await this.page.locator(`[data-pane-split-${attr}]`).first().click()
    await this.pickContent(content)
  }

  /**
   * Close a pane: "Usuń panel" empties its cell, then the empty cell's ✕
   * collapses it — the two steps a user takes to make the tree smaller.
   */
  async closePane(paneIndex = 0): Promise<void> {
    const pane = this.panes().nth(paneIndex)
    const id = await pane.getAttribute('data-pane-id')
    await this.openMenu(paneIndex)
    await this.page.locator('[data-pane-close]').first().click()
    const hole = this.page.locator(`[data-pane-empty="${id}"]`)
    if ((await hole.count()) > 0) {
      await hole.locator(`[data-pane-empty-remove="${id}"]`).click()
    }
    await expect(this.page.locator(`[data-pane-id="${id}"], [data-pane-empty="${id}"]`)).toHaveCount(0, {
      timeout: 10_000,
    })
  }

  // ── The content picker ─────────────────────────────────────────────────────

  /** Open the picker from the Nth empty slot. */
  async openPickerFromSlot(slotIndex = 0): Promise<void> {
    await this.dismissOverlays()
    await this.emptySlots().nth(slotIndex).click()
    await expect(this.pickerInput()).toBeVisible({ timeout: 10_000 })
  }

  pickerInput(): Locator {
    return this.page.getByPlaceholder(/Add table or widget/i)
  }

  /**
   * Choose content by its visible name. Types into the picker's own search
   * first — the catalogue is long enough that the target is often below the
   * fold, and scrolling a virtualised list is far more brittle than filtering.
   */
  async pickContent(name: string): Promise<void> {
    await expect(this.pickerInput()).toBeVisible({ timeout: 10_000 })
    await this.pickerInput().fill(name)
    await this.page.getByRole('button', { name, exact: true }).first().click()
    await expect(this.pickerInput()).toBeHidden({ timeout: 10_000 })
  }

  /** Fill the Nth empty slot with named content. */
  async fillSlot(name: string, slotIndex = 0): Promise<void> {
    const before = await this.paneCount()
    await this.openPickerFromSlot(slotIndex)
    await this.pickContent(name)
    await expect.poll(() => this.paneCount(), { timeout: 20_000 }).toBe(before + 1)
  }

  /** Every option the picker currently offers, grouped label included. */
  async pickerOptions(): Promise<string[]> {
    return this.page.$$eval('[role="dialog"] button, [data-content-picker] button', (els) =>
      els.map((e) => (e.textContent ?? '').trim()).filter(Boolean),
    )
  }

  // ── Shared search and filtering ────────────────────────────────────────────

  async sharedFiltersState(): Promise<'on' | 'off'> {
    const value = await this.page
      .locator('[data-shared-filters]')
      .first()
      .getAttribute('data-shared-filters')
    return value === 'on' ? 'on' : 'off'
  }

  /** "Wspólne" in the workspace bar — the default for a workspace. */
  async enableSharedFilters(): Promise<void> {
    if ((await this.sharedFiltersState()) === 'on') return
    await this.page.locator('[data-workspace-filter-on]').first().click()
    await expect.poll(() => this.sharedFiltersState(), { timeout: 10_000 }).toBe('on')
  }

  /** "Per tabela" — every pane gets its own search back. */
  async disableSharedFilters(): Promise<void> {
    await this.page.locator('[data-workspace-filter-off]').first().click()
    await expect.poll(() => this.sharedFiltersState(), { timeout: 10_000 }).toBe('off')
  }

  sharedSearchInput(): Locator {
    return this.page.getByPlaceholder(/Search all panes/i)
  }

  /** Type into the workspace search and let every pane refetch. */
  async sharedSearch(needle: string): Promise<void> {
    await this.sharedSearchInput().fill(needle)
    // The bar debounces, then each pane issues its own request.
    await this.page.waitForLoadState('networkidle').catch(() => {})
    await this.page.waitForTimeout(1_500)
  }

  /** Row counts per table pane — the actual proof a shared criterion applied. */
  async rowCountsByTable(): Promise<Record<string, number>> {
    const ids = await this.tableIds()
    const out: Record<string, number> = {}
    for (const id of ids) {
      // Rows LOADED, not rows rendered — see `GridHarness.loadedRowCount`.
      out[id] = await this.gridFor(id).loadedRowCount().catch(() => 0)
    }
    return out
  }

  /** Panes reporting they could not honour a shared criterion. */
  async unmappedMarkers(): Promise<string[]> {
    return this.page.$$eval('[data-workspace-unmapped]', (els) =>
      els.map((e) => e.getAttribute('data-workspace-unmapped') ?? ''),
    )
  }

  // ── Named (server-persisted) layouts ───────────────────────────────────────

  /** Save what is on screen under a name, from the drawer's step 3. */
  async saveLayout(name: string): Promise<void> {
    const drawer = await this.openCustomize()
    await drawer.locator('[data-split-layout-name]').fill(name)
    await drawer.locator('[data-split-layout-save]').click()
    await expect(drawer.locator(`[data-split-layout-row="${name}"]`)).toBeVisible({ timeout: 15_000 })
    await this.closeCustomize()
  }

  /** Apply a saved layout from the drawer's step 3. */
  async openLayout(name: string): Promise<void> {
    const drawer = await this.openCustomize()
    await drawer.locator(`[data-split-layout-open="${name}"]`).click()
    await this.closeCustomize()
  }

  /** Back to the page's own table — "Widok domyślny". */
  async openDefaultView(): Promise<void> {
    const drawer = await this.openCustomize()
    await drawer.locator('[data-split-layout-default]').click()
    await this.closeCustomize()
  }

  /** "Dodaj widget" in the workspace bar: first free slot, else a new section. */
  async addFromBar(name: string): Promise<void> {
    await this.dismissOverlays()
    await this.page.locator('[data-workspace-add-widget]').first().click()
    await this.pickContent(name)
  }
}
