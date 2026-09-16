import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'

const { withScopedPayload, parseScopedCommandInput } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'shipment_tracking.errors.tenant_required', fallback: 'Tenant context is required' },
    organizationRequired: { key: 'shipment_tracking.errors.organization_required', fallback: 'Organization context is required' },
  },
})

export { withScopedPayload, parseScopedCommandInput }
