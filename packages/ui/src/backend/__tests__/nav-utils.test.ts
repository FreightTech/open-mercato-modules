import {
  buildAdminNav,
  buildSettingsSections,
  computeSettingsPathPrefixes,
  convertToSectionNavGroups,
  type AdminNavItem,
} from '../utils/nav'

describe('settings navigation helpers', () => {
  it('includes only settings-context entries', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'System',
        groupId: 'settings.sections.system',
        groupKey: 'settings.sections.system',
        groupDefaultName: 'System',
        title: 'Audit Logs',
        defaultTitle: 'Audit Logs',
        href: '/backend/audit-logs',
        enabled: true,
        order: 10,
        pageContext: 'settings',
      },
      {
        group: 'Customers',
        groupId: 'customers.nav.group',
        groupDefaultName: 'Customers',
        title: 'People',
        defaultTitle: 'People',
        href: '/backend/customers/people',
        enabled: true,
        order: 1,
      },
    ]

    const sections = buildSettingsSections(entries, { system: 1 })

    expect(sections).toHaveLength(1)
    expect(sections[0].items.map((item) => item.href)).toEqual(['/backend/audit-logs'])
  })

  it('preserves nested children for settings section items', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'Data Designer',
        groupId: 'settings.sections.dataDesigner',
        groupKey: 'settings.sections.dataDesigner',
        groupDefaultName: 'Data Designer',
        title: 'User Entities',
        defaultTitle: 'User Entities',
        titleKey: 'entities.nav.userEntities',
        href: '/backend/entities/user',
        enabled: true,
        order: 10,
        pageContext: 'settings',
        children: [
          {
            group: 'Data Designer',
            groupId: 'settings.sections.dataDesigner',
            groupKey: 'settings.sections.dataDesigner',
            groupDefaultName: 'Data Designer',
            title: 'Calendar Entity',
            defaultTitle: 'Calendar Entity',
            href: '/backend/entities/user/example%3Acalendar_entity/records',
            enabled: true,
            order: 1000,
          },
        ],
      },
    ]

    const sections = buildSettingsSections(entries, { 'data-designer': 3 })
    expect(sections).toHaveLength(1)
    expect(sections[0].items[0].children?.map((item) => item.href)).toEqual([
      '/backend/entities/user/example%3Acalendar_entity/records',
    ])

    const converted = convertToSectionNavGroups(sections)
    expect(converted[0].items[0].children?.map((item) => item.href)).toEqual([
      '/backend/entities/user/example%3Acalendar_entity/records',
    ])
  })

  it('does not treat parent routes as settings prefixes for leaf settings pages', () => {
    const entries: AdminNavItem[] = [
      {
        group: 'Module Configs',
        groupId: 'settings.sections.moduleConfigs',
        groupKey: 'settings.sections.moduleConfigs',
        groupDefaultName: 'Module Configs',
        title: 'Portal Settings',
        defaultTitle: 'Portal Settings',
        href: '/backend/customer_accounts/settings',
        enabled: true,
        order: 50,
        pageContext: 'settings',
      },
    ]

    const sections = buildSettingsSections(entries, { 'module-configs': 4 })
    const prefixes = computeSettingsPathPrefixes(sections)

    expect(prefixes).toContain('/backend/customer_accounts/settings')
    expect(prefixes).not.toContain('/backend/customer_accounts')
  })

  it('matches wildcard grants when building admin navigation', async () => {
    const entries = await buildAdminNav(
      [
        {
          id: 'customer_accounts',
          backendRoutes: [
            {
              pattern: '/backend/customer_accounts/users',
              title: 'Users',
              requireFeatures: ['customer_accounts.view'],
              pageContext: 'settings',
            },
          ],
        },
      ],
      { auth: { roles: [] } },
      undefined,
      undefined,
      {
        checkFeatures: async () => ['customer_accounts.*'],
      },
    )

    expect(entries.map((item) => item.href)).toContain('/backend/customer_accounts/users')
  })
})

describe('admin nav nesting by URL path (oauth sessions placement)', () => {
  // buildAdminNav nests a route under another in the SAME group when the former's
  // href is a path-child of the latter's. The OAuth "sessions" admin page must
  // therefore NOT live under /backend/config/oauth — or it renders as a child of
  // the "OAuth" config entry instead of a sibling in the Auth settings category.
  const authRoute = (pattern: string, title: string, feature: string) => ({
    pattern,
    title,
    pageGroupKey: 'settings.sections.auth',
    pageContext: 'settings',
    requireFeatures: [feature],
  })
  const ctx = { auth: { roles: [] } }
  const grantAll = { checkFeatures: async () => ['oauth.*'] }

  it('renders OAuth sessions as a sibling of OAuth when its route is config/oauth-sessions', async () => {
    const roots = await buildAdminNav(
      [{ id: 'oauth', backendRoutes: [
        authRoute('/backend/config/oauth', 'OAuth', 'oauth.client.manage'),
        authRoute('/backend/config/oauth-sessions', 'OAuth sessions', 'oauth.session.manage'),
      ] as any }],
      ctx, undefined, undefined, grantAll,
    )
    const oauth = roots.find((e) => e.href === '/backend/config/oauth')
    // Top-level sibling, not buried under the OAuth entry's children.
    expect(roots.some((e) => e.href === '/backend/config/oauth-sessions')).toBe(true)
    expect((oauth?.children ?? []).some((c) => c.href === '/backend/config/oauth-sessions')).toBe(false)
  })

  it('would nest it as a child if the route were config/oauth/sessions (the layout we avoid)', async () => {
    const roots = await buildAdminNav(
      [{ id: 'oauth', backendRoutes: [
        authRoute('/backend/config/oauth', 'OAuth', 'oauth.client.manage'),
        authRoute('/backend/config/oauth/sessions', 'OAuth sessions', 'oauth.session.manage'),
      ] as any }],
      ctx, undefined, undefined, grantAll,
    )
    const oauth = roots.find((e) => e.href === '/backend/config/oauth')
    expect(roots.some((e) => e.href === '/backend/config/oauth/sessions')).toBe(false)
    expect((oauth?.children ?? []).some((c) => c.href === '/backend/config/oauth/sessions')).toBe(true)
  })
})
