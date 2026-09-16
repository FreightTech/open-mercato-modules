import {
  apiToDynamicTable,
  apiTemplateToDynamicTable,
  dynamicTableToApi,
  parsePerspectiveOrigin,
  parsePerspectivePublication,
  templateVersionOf,
} from '../utils/perspectiveTransforms'
import { BASE_VIEW_PERSPECTIVE_NAME } from '../types/perspective'
import type { PerspectiveDto, RolePerspectiveDto } from '@open-mercato/shared/modules/perspectives/types'

/**
 * PERSONAL VIEWS + SHARED TEMPLATES — the wire contract.
 *
 * The binding model (3 Aug 2026): every view is private by default; a user may
 * publish one as a shared TEMPLATE that others COPY; each copy records the
 * template and version it came from so later drift can be surfaced rather than
 * discovered.
 *
 * Everything below travels inside `settings.filters`, not beside it. That is
 * not a stylistic choice: the upstream zod schema for perspective settings
 * strips unknown TOP-LEVEL keys, so an `origin` field next to `columnOrder`
 * would be silently dropped on the way to the database. These tests exist to
 * make that constraint fail loudly if anyone "tidies" the transform.
 */

const dto = (over: Partial<PerspectiveDto> = {}): PerspectiveDto => ({
  id: 'p-1',
  name: 'Open transports',
  tableId: 'folders-transport',
  settings: { columnOrder: ['ref', 'client'], columnVisibility: { ref: true, client: true } },
  isDefault: false,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: null,
  ...over,
})

const allColumns = ['ref', 'client', 'carrier']

describe('personalization metadata survives a save → load round trip', () => {
  it('carries origin, publication and the base-view flag through the filters channel', () => {
    const settings = dynamicTableToApi({
      id: 'p-1',
      name: 'Copied view',
      columns: { visible: ['ref'], hidden: ['client'] },
      filters: [],
      sorting: [],
      origin: {
        templateId: 'tmpl-9',
        version: '2026-08-02T09:00:00.000Z',
        name: 'Ops standard',
        copiedAt: '2026-08-03T08:00:00.000Z',
      },
      publication: { roleIds: ['role-a'], publishedAt: '2026-08-03T09:00:00.000Z' },
      isBaseView: false,
    })

    const filters = settings.filters as Record<string, unknown>
    // The load-bearing assertion: these keys are INSIDE `filters`.
    expect(filters._origin).toEqual({
      templateId: 'tmpl-9',
      version: '2026-08-02T09:00:00.000Z',
      name: 'Ops standard',
      copiedAt: '2026-08-03T08:00:00.000Z',
    })
    expect(filters._published).toEqual({
      roleIds: ['role-a'],
      publishedAt: '2026-08-03T09:00:00.000Z',
    })
    expect((settings as Record<string, unknown>).origin).toBeUndefined()

    const round = apiToDynamicTable(dto({ settings }), allColumns)
    expect(round.origin?.templateId).toBe('tmpl-9')
    expect(round.origin?.version).toBe('2026-08-02T09:00:00.000Z')
    expect(round.publication?.roleIds).toEqual(['role-a'])
  })

  it('does not grow empty metadata keys on a plain personal view', () => {
    const settings = dynamicTableToApi({
      id: 'p-1',
      name: 'Plain',
      columns: { visible: ['ref'], hidden: [] },
      filters: [],
      sorting: [],
    })
    const filters = settings.filters as Record<string, unknown>
    expect('_origin' in filters).toBe(false)
    expect('_published' in filters).toBe(false)
    expect('_baseView' in filters).toBe(false)
  })
})

describe('the base-view row', () => {
  it('is recognised only when BOTH the flag and the reserved name agree', () => {
    const settings = dynamicTableToApi({
      id: 'p-base',
      name: BASE_VIEW_PERSPECTIVE_NAME,
      columns: { visible: ['ref'], hidden: ['client'] },
      filters: [],
      sorting: [],
      isBaseView: true,
    })
    expect(apiToDynamicTable(dto({ name: BASE_VIEW_PERSPECTIVE_NAME, settings }), allColumns).isBaseView).toBe(true)

    // A hand-edited settings blob must not be able to make an ordinary named
    // view vanish from the tab strip.
    expect(apiToDynamicTable(dto({ name: 'My view', settings }), allColumns).isBaseView).toBe(false)
  })

  it('keeps a normal view unflagged', () => {
    expect(apiToDynamicTable(dto(), allColumns).isBaseView).toBe(false)
  })
})

describe('defensive parsing', () => {
  it('drops an origin with no usable version rather than half-trusting it', () => {
    expect(parsePerspectiveOrigin({ templateId: 't-1' })).toBeUndefined()
    expect(parsePerspectiveOrigin({ version: 'v' })).toBeUndefined()
    expect(parsePerspectiveOrigin(null)).toBeUndefined()
    expect(parsePerspectiveOrigin('nonsense')).toBeUndefined()
    expect(parsePerspectiveOrigin({ templateId: 't-1', version: 'v1' })).toEqual({
      templateId: 't-1',
      version: 'v1',
      name: '',
      copiedAt: '',
    })
  })

  it('drops a publication with no roles — an audience of nobody is not a publication', () => {
    expect(parsePerspectivePublication({ roleIds: [] })).toBeUndefined()
    expect(parsePerspectivePublication({ roleIds: [1, 2] })).toBeUndefined()
    expect(parsePerspectivePublication({ roleIds: ['r-1', ''] })).toEqual({
      roleIds: ['r-1'],
      publishedAt: '',
    })
  })
})

describe('shared templates', () => {
  const roleDto = (over: Partial<RolePerspectiveDto> = {}): RolePerspectiveDto => ({
    ...dto(),
    id: 'tmpl-1',
    name: 'Ops standard',
    roleId: 'role-a',
    roleName: 'Operations',
    tenantId: 'ten-1',
    organizationId: 'org-1',
    isDefault: true,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T11:00:00.000Z',
    ...over,
  })

  it('versions a template by updatedAt, falling back to createdAt', () => {
    expect(templateVersionOf(roleDto())).toBe('2026-08-02T11:00:00.000Z')
    expect(templateVersionOf(roleDto({ updatedAt: null }))).toBe('2026-08-01T10:00:00.000Z')
  })

  it('never carries someone else\'s default or base flag into the reader\'s space', () => {
    const template = apiTemplateToDynamicTable(roleDto(), allColumns)
    // `isDefault: true` on the ROLE row means "the role default"; copying it
    // must not hijack which view opens for the person taking the copy.
    expect(template.isDefault).toBe(false)
    expect(template.isBaseView).toBe(false)
    expect(template.publication).toBeUndefined()
    expect(template.roleId).toBe('role-a')
    expect(template.roleName).toBe('Operations')
    expect(template.version).toBe('2026-08-02T11:00:00.000Z')
  })

  it('decodes a template exactly like the view it was made from', () => {
    const settings = dynamicTableToApi({
      id: 'p-1',
      name: 'Ops standard',
      color: 'green',
      columns: { visible: ['ref', 'carrier'], hidden: ['client'] },
      filters: [{ id: 'f1', field: 'client', operator: 'contains', value: 'ACME' } as never],
      sorting: [{ id: 's1', field: 'ref', direction: 'desc' }],
    })
    const personal = apiToDynamicTable(dto({ settings }), allColumns)
    const template = apiTemplateToDynamicTable(roleDto({ settings }), allColumns)

    expect(template.columns).toEqual(personal.columns)
    expect(template.filters).toEqual(personal.filters)
    expect(template.sorting).toEqual(personal.sorting)
    expect(template.color).toEqual(personal.color)
  })
})
