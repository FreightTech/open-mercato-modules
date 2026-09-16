import { z } from 'zod'

const endpointsSchema = z.object({
  unit: z.string().min(1),
  vessel: z.string().optional(),
  trainVisits: z.string().optional(),
})

const authTypeSchema = z.enum(['oauth2_password', 'oauth2_client_credentials', 'gct_token', 'basic'])

// ─── TerminalConfig ──────────────────────────────────────────

export const terminalConfigCreateSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  terminalCode: z.string().min(1).transform((s) => s.toLowerCase()),
  adapterType: z.string().min(1),
  displayName: z.string().min(1),
  baseUrl: z.string().url(),
  proxyUrl: z.string().url().nullish(),
  endpoints: endpointsSchema.optional(),
  authType: authTypeSchema,
  tokenUrl: z.string().url().nullish(),
  scope: z.string().nullish(),
  clientId: z.string().nullish(),
  authConfig: z.record(z.string(), z.unknown()).nullish(),
  rateLimitRequests: z.number().int().positive().optional(),
  rateLimitWindowSeconds: z.number().int().positive().optional(),
  unlocode: z.string().length(5).nullish(),
  bicCodes: z.array(z.string()).nullish(),
  smdgCodes: z.array(z.string()).nullish(),
  nameAliases: z.array(z.string()).nullish(),
  isActive: z.boolean().optional(),
})
export type TerminalConfigCreateInput = z.infer<typeof terminalConfigCreateSchema>

export const terminalConfigUpdateSchema = terminalConfigCreateSchema
  .partial()
  .extend({ id: z.string().uuid() })
export type TerminalConfigUpdateInput = z.infer<typeof terminalConfigUpdateSchema>

export const terminalConfigDeleteSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})
export type TerminalConfigDeleteInput = z.infer<typeof terminalConfigDeleteSchema>

export const terminalConfigTestSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})
export type TerminalConfigTestInput = z.infer<typeof terminalConfigTestSchema>

export const terminalConfigListSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  terminalCode: z.string().optional(),
  isActive: z.string().optional(),
})

// ─── TerminalTrackingJob ─────────────────────────────────────

export const trackingJobCreateSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  terminalCode: z.string().min(1).transform((s) => s.toLowerCase()),
  containerNumber: z.string().min(4).transform((s) => s.toUpperCase()),
  schedule: z.array(z.string()).nullish(),
})
export type TrackingJobCreateInput = z.infer<typeof trackingJobCreateSchema>

export const trackingJobDeleteSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})
export type TrackingJobDeleteInput = z.infer<typeof trackingJobDeleteSchema>

export const trackingJobPollSchema = z.object({
  jobId: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})
export type TrackingJobPollInput = z.infer<typeof trackingJobPollSchema>

export const trackingJobListSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  // DynamicTable sends both `limit` and `pageSize` (same value); accept either.
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  terminalCode: z.string().optional(),
  containerNumber: z.string().optional(),
  status: z.string().optional(),
  // DynamicTable filter popover — JSON-stringified FilterRow[] sent as `?filters=`
  filters: z.string().optional(),
})

// ─── TerminalVesselVisit ─────────────────────────────────────

export const vesselVisitListSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  visitRef: z.string().optional(),
  containerNumber: z.string().optional().transform((s) => (s ? s.toUpperCase() : s)),
  terminalCode: z.string().optional(),
})
export type VesselVisitListInput = z.infer<typeof vesselVisitListSchema>
