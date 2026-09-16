/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '../../utils/apiCall'
import { useDynamicTablePage } from '../hooks/useDynamicTablePage'
import { TableEvents } from '../types/index'
import type { ColumnDef } from '../types/index'
import type { PerspectiveTemplate } from '../types/perspective'

/**
 * THE REQUEST SHAPES that make "personal views + shared templates" true.
 *
 * Every guarantee in the personalization decision is ultimately a property of
 * what this hook POSTs:
 *   • publishing writes role-scoped template rows AND never sets a role default
 *   • copying a template writes a NEW PERSONAL row that is not the default and
 *     records origin template + version
 *   • saving resolves the row BY ID first, so a rename updates instead of
 *     cloning
 *
 * The endpoint itself is upstream and unchanged; these assertions are the
 * contract this distribution depends on.
 */

jest.mock('../../utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'client', title: 'Client' },
]

const personalDto = {
  id: 'p-uuid-1',
  name: 'Open transports',
  tableId: 'things',
  settings: { columnOrder: ['ref'], columnVisibility: { ref: true, client: false } },
  isDefault: false,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: null,
}

const baseDto = {
  ...personalDto,
  id: 'p-base-uuid',
  name: '__base__',
  settings: {
    columnOrder: ['client'],
    columnVisibility: { client: true, ref: false },
    filters: { v: 2, rows: [], _baseView: true },
  },
}

const roleDto = {
  ...personalDto,
  id: 'tmpl-1',
  name: 'Ops standard',
  roleId: 'role-a',
  roleName: 'Operations',
  tenantId: 'ten-1',
  organizationId: 'org-1',
  isDefault: true,
  updatedAt: '2026-08-02T11:00:00.000Z',
}

type IndexOverrides = {
  perspectives?: unknown[]
  rolePerspectives?: unknown[]
  defaultPerspectiveId?: string | null
  canApplyToRoles?: boolean
  roles?: Array<{ id: string; name: string }>
}

function setupApi(index: IndexOverrides = {}) {
  ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/perspectives')) {
      return {
        ok: true,
        result: {
          tableId: 'things',
          perspectives: index.perspectives ?? [personalDto],
          defaultPerspectiveId: index.defaultPerspectiveId ?? null,
          rolePerspectives: index.rolePerspectives ?? [],
          roles: index.roles ?? [],
          canApplyToRoles: index.canApplyToRoles ?? false,
          perspective: { id: 'saved-id' },
        },
      }
    }
    return { ok: true, result: { items: [], total: 0, totalPages: 1 } }
  })
}

function renderTablePage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  return renderHook(
    () =>
      useDynamicTablePage({
        source: '/api/things',
        columns,
        tableName: 'Things',
        perspectives: 'things',
      }),
    { wrapper },
  )
}

/** The body of the last POST to /api/perspectives. */
function lastPerspectivePost(): Record<string, any> {
  const calls = (apiCall as jest.Mock).mock.calls.filter(
    (c) => typeof c[0] === 'string' && c[0].startsWith('/api/perspectives') && c[1]?.method === 'POST',
  )
  return JSON.parse(calls[calls.length - 1][1].body)
}

/**
 * The hook listens on `tableRef`, and only binds its listeners once a render
 * has SEEN `ref.current` (a layout effect polls it). So attach the element,
 * force one render, and only then dispatch the CustomEvent the grid would.
 */
async function dispatchOn(
  rendered: {
    result: { current: ReturnType<typeof useDynamicTablePage> }
    rerender: () => void
  },
  event: string,
  detail: unknown,
) {
  const ref = rendered.result.current.props.tableRef as React.MutableRefObject<HTMLElement | null>
  if (!ref.current) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    ref.current = el
    await act(async () => {
      rendered.rerender()
      await Promise.resolve()
    })
  }
  await act(async () => {
    ref.current!.dispatchEvent(new CustomEvent(event, { detail, bubbles: true }))
    await Promise.resolve()
  })
}

describe('shared templates reach the grid', () => {
  beforeEach(() => jest.clearAllMocks())

  it('decodes role perspectives into copyable templates and reports publish rights', async () => {
    setupApi({
      rolePerspectives: [roleDto],
      canApplyToRoles: true,
      roles: [{ id: 'role-a', name: 'Operations' }],
    })
    const rendered = renderTablePage()
    const { result } = rendered

    await waitFor(() => expect(result.current.props.sharedTemplates?.length).toBe(1))
    const template = result.current.props.sharedTemplates![0] as PerspectiveTemplate
    expect(template.id).toBe('tmpl-1')
    expect(template.version).toBe('2026-08-02T11:00:00.000Z')
    // The ROLE row's own `isDefault` must not travel into anyone's space.
    expect(template.isDefault).toBe(false)
    expect(result.current.props.canPublishTemplates).toBe(true)
    expect(result.current.props.publishableRoles).toEqual([{ id: 'role-a', name: 'Operations' }])
  })

  it('withholds the publish affordance when the server refuses the feature', async () => {
    setupApi({ rolePerspectives: [roleDto] })
    const rendered = renderTablePage()
    const { result } = rendered
    await waitFor(() => expect(result.current.props.sharedTemplates?.length).toBe(1))
    expect(result.current.props.canPublishTemplates).toBe(false)
  })
})

describe('publishing', () => {
  beforeEach(() => jest.clearAllMocks())

  it('applies to the chosen roles, never as a role DEFAULT, and records the audience', async () => {
    setupApi({ canApplyToRoles: true, roles: [{ id: 'role-a', name: 'Operations' }] })
    const rendered = renderTablePage()
    const { result } = rendered
    await waitFor(() => expect(result.current.props.savedPerspectives?.length).toBe(1))

    await dispatchOn(rendered, TableEvents.PERSPECTIVE_PUBLISH, {
      id: 'p-uuid-1',
      roleIds: ['role-a'],
      name: 'Open transports',
    })

    const body = lastPerspectivePost()
    expect(body.perspectiveId).toBe('p-uuid-1')
    expect(body.applyToRoles).toEqual(['role-a'])
    expect(body.setRoleDefault).toBe(false)
    // The template necessarily carries the view's own name — one `name` drives
    // both rows upstream, so anything else would rename the publisher's view.
    expect(body.name).toBe('Open transports')
    expect(body.settings.filters._published.roleIds).toEqual(['role-a'])
  })
})

describe('copying a template', () => {
  beforeEach(() => jest.clearAllMocks())

  it('writes a new personal row that is not the default and remembers its origin', async () => {
    setupApi({ rolePerspectives: [roleDto] })
    const rendered = renderTablePage()
    const { result } = rendered
    await waitFor(() => expect(result.current.props.sharedTemplates?.length).toBe(1))
    const template = result.current.props.sharedTemplates![0]

    await dispatchOn(rendered, TableEvents.PERSPECTIVE_TEMPLATE_COPY, {
      template,
      newName: 'Ops standard',
    })

    const body = lastPerspectivePost()
    expect(body.perspectiveId).toBeUndefined() // a brand-new row
    expect(body.isDefault).toBe(false)
    expect(body.name).toBe('Ops standard')
    expect(body.settings.filters._origin).toMatchObject({
      templateId: 'tmpl-1',
      version: '2026-08-02T11:00:00.000Z',
      name: 'Ops standard',
    })
    // A copy is not a publication, and it is not anybody's base view.
    expect(body.settings.filters._published).toBeUndefined()
    expect(body.settings.filters._baseView).toBeUndefined()
  })
})

describe('saving', () => {
  beforeEach(() => jest.clearAllMocks())

  it('resolves the row by id, so a rename updates in place instead of cloning', async () => {
    setupApi()
    const rendered = renderTablePage()
    const { result } = rendered
    await waitFor(() => expect(result.current.props.savedPerspectives?.length).toBe(1))
    const existing = result.current.props.savedPerspectives![0]

    await dispatchOn(rendered, TableEvents.PERSPECTIVE_SAVE, {
      perspective: { ...existing, name: 'Open transports (renamed)' },
    })

    const body = lastPerspectivePost()
    expect(body.perspectiveId).toBe('p-uuid-1')
    expect(body.name).toBe('Open transports (renamed)')
  })

  it('inserts when the id is a client-minted one — a genuinely new view', async () => {
    setupApi()
    const rendered = renderTablePage()
    const { result } = rendered
    await waitFor(() => expect(result.current.props.savedPerspectives?.length).toBe(1))

    await dispatchOn(rendered, TableEvents.PERSPECTIVE_SAVE, {
      perspective: {
        id: 'perspective-1754300000000-abc',
        name: 'Tomorrow',
        columns: { visible: ['ref'], hidden: [] },
        filters: [],
        sorting: [],
      },
    })

    expect(lastPerspectivePost().perspectiveId).toBeUndefined()
  })
})

describe('the base view', () => {
  beforeEach(() => jest.clearAllMocks())

  it('opens on the user\'s own personalization when they have no other default', async () => {
    setupApi({ perspectives: [personalDto, baseDto] })
    const rendered = renderTablePage()
    const { result } = rendered
    await waitFor(() => expect(result.current.props.savedPerspectives?.length).toBe(2))
    expect(result.current.props.activePerspectiveId).toBe('p-base-uuid')
    expect(
      result.current.props.savedPerspectives!.find((p) => p.id === 'p-base-uuid')!.isBaseView,
    ).toBe(true)
  })

  it('leaves the coded defaults alone when there is no personalization', async () => {
    setupApi({ perspectives: [personalDto] })
    const rendered = renderTablePage()
    const { result } = rendered
    await waitFor(() => expect(result.current.props.savedPerspectives?.length).toBe(1))
    expect(result.current.props.activePerspectiveId).toBeNull()
  })

  it('updates the existing base row rather than inserting a second one', async () => {
    setupApi({ perspectives: [personalDto, baseDto] })
    const rendered = renderTablePage()
    const { result } = rendered
    await waitFor(() => expect(result.current.props.savedPerspectives?.length).toBe(2))
    const base = result.current.props.savedPerspectives!.find((p) => p.isBaseView)!

    await dispatchOn(rendered, TableEvents.PERSPECTIVE_SAVE, { perspective: base })

    const body = lastPerspectivePost()
    expect(body.perspectiveId).toBe('p-base-uuid')
    expect(body.name).toBe('__base__')
    expect(body.settings.filters._baseView).toBe(true)
  })
})
