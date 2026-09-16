import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'

const { withScopedPayload, parseScopedCommandInput } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'terminal_tracking.errors.tenant_required', fallback: 'Tenant context is required' },
    organizationRequired: { key: 'terminal_tracking.errors.organization_required', fallback: 'Organization context is required' },
  },
})

export { withScopedPayload, parseScopedCommandInput }
