/**
 * A dashboard widget rendered as pane content.
 *
 * What is actually worth pinning is the props CONTRACT — the pane builds
 * `DashboardWidgetComponentProps` by hand, so a fake widget that records what it
 * was handed is a truer test than any assertion about markup. The rest is
 * degradation: three ways this can fail, three distinguishable outcomes, and in
 * particular a failed chunk load that shows an ERROR rather than a spinner that
 * never stops (the failure `lazyTable.tsx` exists to document).
 *
 * Unit companion to TC-APP-604 (widget renders in a slot), TC-APP-606 (settings
 * persist on the owning slot) and TC-APP-609 (a removed widget degrades that
 * pane only).
 * Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md
 */

import * as React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type {
  DashboardWidgetComponentProps,
  DashboardWidgetModule,
} from '@open-mercato/shared/modules/dashboard/widgets'
import { WidgetPane } from '../split-view/WidgetPane'
import { ContentRegistryProvider } from '../registry/ContentRegistryContext'
import type { WidgetCatalogEntry } from '../registry/widgetCatalog'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

jest.mock('../../dashboard/widgetRegistry', () => ({
  loadDashboardWidgetModule: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadDashboardWidgetModule } = require('../../dashboard/widgetRegistry') as {
  loadDashboardWidgetModule: jest.Mock
}

// ── fixtures ────────────────────────────────────────────────────────────────

const LOADER_KEY = 'invoicing:inflows:widget'
const WIDGET_ID = 'invoicing.dashboard.inflows'
const SLOT_ID = 'pane-7'

const CATALOG_ENTRY: WidgetCatalogEntry = {
  id: WIDGET_ID,
  title: 'Wpływy',
  description: null,
  loaderKey: LOADER_KEY,
  icon: null,
  features: ['dashboards.view'],
  moduleId: 'invoicing',
  defaultSettings: { window: 30 },
  defaultSize: 'md',
  supportsRefresh: true,
}

const RENDER_CONTEXT = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userName: 'Ada',
  userEmail: 'ada@example.com',
  userLabel: 'Ada',
}

/** Records every props object it was handed, so the contract can be asserted. */
function makeFakeModule(overrides: Partial<DashboardWidgetModule<any>> = {}) {
  const seen: DashboardWidgetComponentProps<any>[] = []
  const module: DashboardWidgetModule<any> = {
    metadata: { id: WIDGET_ID, title: 'Wpływy' },
    Widget: (props: DashboardWidgetComponentProps<any>) => {
      seen.push(props)
      return (
        <div data-testid="fake-widget">
          <span data-testid="mode">{props.mode}</span>
          <span data-testid="settings">{JSON.stringify(props.settings)}</span>
          <button type="button" onClick={() => props.onSettingsChange({ window: 90 })}>
            change
          </button>
        </div>
      )
    },
    ...overrides,
  }
  return { module, seen }
}

function renderPane(
  options: {
    widgets?: WidgetCatalogEntry[]
    ready?: boolean
    existingLoaderKeys?: string[]
    settings?: unknown
    onSettingsChange?: (next: unknown) => void
    overflowExtras?: React.ReactNode
  } = {},
) {
  const value = {
    widgets: options.widgets ?? [CATALOG_ENTRY],
    context: RENDER_CONTEXT,
    ready: options.ready ?? true,
    loaderKeyExists: (key: string) => (options.existingLoaderKeys ?? []).includes(key),
  }
  return render(
    <I18nProvider locale="en" dict={{}}>
    <ContentRegistryProvider value={value}>
      <WidgetPane
        content={{
          kind: 'widget',
          widgetId: WIDGET_ID,
          loaderKey: LOADER_KEY,
          settings: options.settings,
        }}
        slotId={SLOT_ID}
        onSettingsChange={options.onSettingsChange}
        overflowExtras={options.overflowExtras}
      />
    </ContentRegistryProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  loadDashboardWidgetModule.mockReset()
})

// ── tests ───────────────────────────────────────────────────────────────────

describe('WidgetPane — rendering', () => {
  it('TC-APP-604 renders the widget in view mode with a layout item synthesized from the slot', async () => {
    const { module, seen } = makeFakeModule()
    loadDashboardWidgetModule.mockResolvedValue(module)

    renderPane()

    await screen.findByTestId('fake-widget')
    expect(loadDashboardWidgetModule).toHaveBeenCalledWith(LOADER_KEY)

    const props = seen[seen.length - 1]
    expect(props.mode).toBe('view')
    // The slot is the identity: two panes of one widget must not share it.
    expect(props.layout).toMatchObject({ id: SLOT_ID, widgetId: WIDGET_ID, order: 0 })
    expect(props.context).toEqual(RENDER_CONTEXT)
    expect(typeof props.refreshToken).toBe('number')
  })

  it('TC-APP-604 shows the widget title in the pane header', async () => {
    const { module } = makeFakeModule()
    loadDashboardWidgetModule.mockResolvedValue(module)

    renderPane()

    await screen.findByTestId('fake-widget')
    expect(screen.getByText('Wpływy')).toBeTruthy()
  })

  it('bumps refreshToken when the header refresh is pressed', async () => {
    const { module, seen } = makeFakeModule()
    loadDashboardWidgetModule.mockResolvedValue(module)

    const { container } = renderPane()
    await screen.findByTestId('fake-widget')
    const before = seen[seen.length - 1].refreshToken

    fireEvent.click(container.querySelector('[data-pane-widget-refresh]')!)

    await waitFor(() => {
      expect(seen[seen.length - 1].refreshToken).toBe(before + 1)
    })
  })
})

describe('WidgetPane — settings', () => {
  it('passes the widget its default settings when the slot carries none', async () => {
    const { module } = makeFakeModule()
    loadDashboardWidgetModule.mockResolvedValue(module)

    renderPane()

    await screen.findByTestId('fake-widget')
    expect(screen.getByTestId('settings').textContent).toBe(JSON.stringify({ window: 30 }))
  })

  it('TC-APP-606 prefers the settings stored on the slot over the catalogue defaults', async () => {
    const { module } = makeFakeModule()
    loadDashboardWidgetModule.mockResolvedValue(module)

    renderPane({ settings: { window: 7 } })

    await screen.findByTestId('fake-widget')
    expect(screen.getByTestId('settings').textContent).toBe(JSON.stringify({ window: 7 }))
  })

  it('runs stored settings through hydrateSettings when the module declares it', async () => {
    const { module } = makeFakeModule({
      hydrateSettings: (raw: unknown) => ({ ...(raw as object), hydrated: true }),
    })
    loadDashboardWidgetModule.mockResolvedValue(module)

    renderPane({ settings: { window: 7 } })

    await screen.findByTestId('fake-widget')
    expect(JSON.parse(screen.getByTestId('settings').textContent!)).toEqual({
      window: 7,
      hydrated: true,
    })
  })

  it('falls back to the raw settings when hydrateSettings throws, rather than blanking the widget', async () => {
    const { module } = makeFakeModule({
      hydrateSettings: () => {
        throw new Error('bad shape')
      },
    })
    loadDashboardWidgetModule.mockResolvedValue(module)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      renderPane({ settings: { window: 7 } })
      await screen.findByTestId('fake-widget')
      expect(screen.getByTestId('settings').textContent).toBe(JSON.stringify({ window: 7 }))
    } finally {
      warn.mockRestore()
    }
  })

  it('TC-APP-606 propagates a settings change to the host so it can persist on the slot', async () => {
    const { module } = makeFakeModule()
    loadDashboardWidgetModule.mockResolvedValue(module)
    const onSettingsChange = jest.fn()

    renderPane({ onSettingsChange })

    await screen.findByTestId('fake-widget')
    fireEvent.click(screen.getByText('change'))

    expect(onSettingsChange).toHaveBeenCalledWith({ window: 90 })
  })

  it('TC-APP-606 dehydrates settings before handing them to the host', async () => {
    const { module } = makeFakeModule({
      dehydrateSettings: (settings: any) => ({ w: settings.window }),
    })
    loadDashboardWidgetModule.mockResolvedValue(module)
    const onSettingsChange = jest.fn()

    renderPane({ onSettingsChange })

    await screen.findByTestId('fake-widget')
    fireEvent.click(screen.getByText('change'))

    expect(onSettingsChange).toHaveBeenCalledWith({ w: 90 })
  })
})

describe('WidgetPane — degradation', () => {
  it('TC-APP-609 says a widget is gone when it is in neither the catalogue nor the build', async () => {
    const { container } = renderPane({ widgets: [], existingLoaderKeys: [] })

    expect(container.querySelector('[data-pane-status="unknown"]')).toBeTruthy()
    expect(screen.getByText(/no longer available/i)).toBeTruthy()
    // Nothing else: no header, no spinner, no attempt to load the chunk.
    expect(loadDashboardWidgetModule).not.toHaveBeenCalled()
    expect(container.querySelector('[data-pane-widget-header]')).toBeNull()
  })

  it('TC-APP-609 says access is missing when the widget still exists but was not granted', () => {
    const { container } = renderPane({ widgets: [], existingLoaderKeys: [LOADER_KEY] })

    expect(container.querySelector('[data-pane-status="denied"]')).toBeTruthy()
    expect(loadDashboardWidgetModule).not.toHaveBeenCalled()
  })

  it('shows a spinner, not a verdict, while the catalogue is still in flight', () => {
    const { container } = renderPane({ widgets: [], ready: false })

    expect(container.querySelector('[data-pane-status="loading"]')).toBeTruthy()
    expect(container.querySelector('[data-pane-status="denied"]')).toBeNull()
    expect(container.querySelector('[data-pane-status="unknown"]')).toBeNull()
  })

  it('shows an ERROR when the chunk fails to load — never a spinner that waits forever', async () => {
    loadDashboardWidgetModule.mockRejectedValue(new Error('chunk 404'))
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const { container } = renderPane()

      await waitFor(() => {
        expect(container.querySelector('[data-pane-widget-error]')).toBeTruthy()
      })
      expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i)
      expect(container.querySelector('[data-pane-widget-loading]')).toBeNull()
    } finally {
      error.mockRestore()
    }
  })

  it('shows the same error when the loader key resolves to no module at all', async () => {
    // `loadDashboardWidgetModule` returns null for an unregistered key rather
    // than throwing, so a null resolution must reach the same visible outcome.
    loadDashboardWidgetModule.mockResolvedValue(null)

    const { container } = renderPane()

    await waitFor(() => {
      expect(container.querySelector('[data-pane-widget-error]')).toBeTruthy()
    })
  })
})

describe('WidgetPane — host chrome', () => {
  it('renders host overflow rows behind one menu button, costing no extra pane height', async () => {
    const { module } = makeFakeModule()
    loadDashboardWidgetModule.mockResolvedValue(module)

    const { container } = renderPane({
      overflowExtras: <button type="button">Close pane</button>,
    })

    await screen.findByTestId('fake-widget')
    const trigger = container.querySelector('[data-pane-widget-menu-btn]')
    expect(trigger).toBeTruthy()
    // Collapsed by default — the rows cost nothing until asked for.
    expect(document.querySelector('[data-pane-widget-menu]')).toBeNull()

    fireEvent.click(trigger!)

    expect(document.querySelector('[data-pane-widget-menu]')).toBeTruthy()
    expect(screen.getByText('Close pane')).toBeTruthy()
  })

  it('omits the menu button entirely when the host passes no rows', async () => {
    const { module } = makeFakeModule()
    loadDashboardWidgetModule.mockResolvedValue(module)

    const { container } = renderPane()

    await screen.findByTestId('fake-widget')
    expect(container.querySelector('[data-pane-widget-menu-btn]')).toBeNull()
  })
})
