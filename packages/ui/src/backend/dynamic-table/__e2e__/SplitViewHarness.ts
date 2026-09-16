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
 *   [data-split-template]       a grid template in the gallery
 *   [data-split-arrange-preset] an arrange preset
 *   [data-split-shared-filters] the shared-filter toggle row
 *
 * Specs: .ai/specs/2026-08-17-split-view-workspace-composition.md
 *        .ai/specs/2026-08-04-dynamic-table-split-view.md
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { GridHarness } from './GridHarness'

export type TemplateId = '2x1' | '1x2' | '2x2' | '3-up' | 'two-top-one-below' | '1+2'

/** How many slots each template is contracted to produce. */
export const TEMPLATE_SLOTS: Record<TemplateId, number> = {
  '2x1': 2,
  '1x2': 2,
  '2x2': 4,
  '3-up': 3,
  'two-top-one-below': 3,
  '1+2': 3,
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

  // ── The overflow menu ──────────────────────────────────────────────────────

  /**
   * Open a pane's overflow menu. Every workspace control lives here — there is
   * deliberately no second button and no extra chrome row.
   */
  async openMenu(paneIndex = 0): Promise<void> {
    await this.dismissOverlays()
    const button = this.page.getByRole('button', { name: /More table actions/i }).nth(paneIndex)
    await button.click()
    await expect(this.page.locator('[data-split-arrange]').first()).toBeVisible({ timeout: 10_000 })
  }

  async closeMenu(): Promise<void> {
    await this.page.keyboard.press('Escape')
  }

  /** Apply a named grid template, then wait for its contracted slot count. */
  async applyTemplate(id: TemplateId, paneIndex = 0): Promise<void> {
    await this.openMenu(paneIndex)
    await this.page.getByRole('button', { name: /Grid template/i }).first().click()
    await this.page.locator(`[data-split-template="${id}"]`).click()
    await expect.poll(() => this.slotCount(), { timeout: 15_000 }).toBe(TEMPLATE_SLOTS[id])
  }

  /** Re-shape existing panes with an arrange preset (does NOT create slots). */
  async applyArrangePreset(presetId: string, paneIndex = 0): Promise<void> {
    await this.openMenu(paneIndex)
    await this.page.getByRole('button', { name: /^Arrange$/i }).first().click()
    await this.page.locator(`[data-split-arrange-preset="${presetId}"]`).click()
  }

  /** Toggle one chrome row (Toolbar / Search / Views bar) on one pane. */
  async toggleChrome(label: 'Toolbar' | 'Search' | 'Views bar', paneIndex = 0): Promise<void> {
    await this.openMenu(paneIndex)
    await this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click()
    await this.closeMenu()
  }

  /** Split a pane, choosing the content in the picker that follows. */
  async splitPane(
    direction: 'Left' | 'Right' | 'Above' | 'Below',
    content: string,
    paneIndex = 0,
  ): Promise<void> {
    await this.openMenu(paneIndex)
    await this.page.getByRole('button', { name: new RegExp(`^${direction}$`, 'i') }).first().click()
    await this.pickContent(content)
  }

  /** Close a pane via its overflow menu. */
  async closePane(paneIndex = 0): Promise<void> {
    await this.openMenu(paneIndex)
    await this.page.getByRole('button', { name: /^Close( pane)?$/i }).first().click()
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

  async enableSharedFilters(paneIndex = 0): Promise<void> {
    if ((await this.sharedFiltersState()) === 'on') return
    await this.openMenu(paneIndex)
    await this.page.getByRole('menuitemcheckbox', { name: /Shared search/i }).click()
    await expect.poll(() => this.sharedFiltersState(), { timeout: 10_000 }).toBe('on')
    await this.closeMenu()
  }

  /** Back to per-pane control via the bar's own "Per pane" escape. */
  async disableSharedFilters(): Promise<void> {
    await this.page.getByRole('button', { name: /Per pane/i }).click()
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
      out[id] = await this.gridFor(id).rowCount().catch(() => 0)
    }
    return out
  }

  /** Panes reporting they could not honour a shared criterion. */
  async unmappedMarkers(): Promise<string[]> {
    return this.page.$$eval('[data-shared-unmapped]', (els) =>
      els.map((e) => e.getAttribute('data-shared-unmapped') ?? ''),
    )
  }

  // ── Named (server-persisted) layouts ───────────────────────────────────────

  async saveLayout(name: string, paneIndex = 0): Promise<void> {
    await this.openMenu(paneIndex)
    await this.page.getByRole('button', { name: /^Layouts$/i }).first().click()
    await this.page.getByPlaceholder(/name/i).first().fill(name)
    await this.page.getByRole('button', { name: /^Save$/i }).first().click()
  }

  async openLayout(name: string, paneIndex = 0): Promise<void> {
    await this.openMenu(paneIndex)
    await this.page.getByRole('button', { name: /^Layouts$/i }).first().click()
    await this.page.getByRole('button', { name, exact: true }).first().click()
  }
}
