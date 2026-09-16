import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { TerminalConfig } from '../data/entities'
import type { TerminalTrackingService } from '../services/terminalTrackingService'
import type { TerminalRegistry } from '../services/terminalRegistry'
import { ensureTerminalPollSchedule } from '../lib/ensure-schedule'
import type {
  TerminalConfigCreateInput,
  TerminalConfigUpdateInput,
  TerminalConfigDeleteInput,
  TerminalConfigTestInput,
} from '../data/validators'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) throw new Error('Tenant mismatch')
  if (!ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

const createTerminalConfig: CommandHandler<TerminalConfigCreateInput, { id: string }> = {
  id: 'terminal_tracking.terminal_config.create',
  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)
    const em = ctx.container.resolve<EntityManager>('em').fork()

    // Endpoint paths are standardized per adapter family; default from the
    // adapter when the client omits them (only non-standard terminals override).
    const registry = ctx.container.resolve<TerminalRegistry>('terminalTrackingRegistry')
    const endpoints = input.endpoints ?? registry.get(input.adapterType)?.defaultEndpoints
    if (!endpoints) {
      throw new Error(`Unknown adapter type '${input.adapterType}' and no endpoints provided`)
    }

    const config = em.create(TerminalConfig, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      terminalCode: input.terminalCode,
      adapterType: input.adapterType,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      proxyUrl: input.proxyUrl ?? null,
      endpoints,
      authType: input.authType,
      tokenUrl: input.tokenUrl ?? null,
      scope: input.scope ?? null,
      clientId: input.clientId ?? null,
      authConfig: input.authConfig ?? null,
      rateLimitRequests: input.rateLimitRequests ?? 200,
      rateLimitWindowSeconds: input.rateLimitWindowSeconds ?? 60,
      unlocode: input.unlocode ?? null,
      bicCodes: input.bicCodes ?? null,
      smdgCodes: input.smdgCodes ?? null,
      nameAliases: input.nameAliases ?? null,
      isActive: input.isActive ?? true,
    })
    await em.flush()
    // Self-heal the periodic poll schedule for orgs that predate the module.
    await ensureTerminalPollSchedule(ctx.container, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })
    return { id: config.id }
  },
}

const updateTerminalConfig: CommandHandler<TerminalConfigUpdateInput, { id: string }> = {
  id: 'terminal_tracking.terminal_config.update',
  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const config = await findOneWithDecryption(em, TerminalConfig, { id: input.id, deletedAt: null })
    if (!config) throw new Error('Terminal config not found')
    ensureScope(ctx, config.tenantId, config.organizationId)

    if (input.adapterType !== undefined) config.adapterType = input.adapterType
    if (input.displayName !== undefined) config.displayName = input.displayName
    if (input.baseUrl !== undefined) config.baseUrl = input.baseUrl
    if (input.proxyUrl !== undefined) config.proxyUrl = input.proxyUrl ?? null
    if (input.endpoints !== undefined) config.endpoints = input.endpoints
    if (input.authType !== undefined) config.authType = input.authType
    if (input.tokenUrl !== undefined) config.tokenUrl = input.tokenUrl ?? null
    if (input.scope !== undefined) config.scope = input.scope ?? null
    if (input.clientId !== undefined) config.clientId = input.clientId ?? null
    if (input.authConfig !== undefined) config.authConfig = input.authConfig ?? null
    if (input.rateLimitRequests !== undefined) config.rateLimitRequests = input.rateLimitRequests
    if (input.rateLimitWindowSeconds !== undefined) config.rateLimitWindowSeconds = input.rateLimitWindowSeconds
    if (input.unlocode !== undefined) config.unlocode = input.unlocode ?? null
    if (input.bicCodes !== undefined) config.bicCodes = input.bicCodes ?? null
    if (input.smdgCodes !== undefined) config.smdgCodes = input.smdgCodes ?? null
    if (input.nameAliases !== undefined) config.nameAliases = input.nameAliases ?? null
    if (input.isActive !== undefined) config.isActive = input.isActive

    await em.flush()
    await ensureTerminalPollSchedule(ctx.container, {
      organizationId: config.organizationId,
      tenantId: config.tenantId,
    })
    return { id: config.id }
  },
}

const deleteTerminalConfig: CommandHandler<TerminalConfigDeleteInput, { id: string }> = {
  id: 'terminal_tracking.terminal_config.delete',
  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const config = await findOneWithDecryption(em, TerminalConfig, { id: input.id, deletedAt: null })
    if (!config) throw new Error('Terminal config not found')
    ensureScope(ctx, config.tenantId, config.organizationId)
    config.deletedAt = new Date()
    await em.flush()
    return { id: config.id }
  },
}

const testTerminalConfig: CommandHandler<
  TerminalConfigTestInput,
  { success: boolean; message: string; latencyMs?: number }
> = {
  id: 'terminal_tracking.terminal_config.test',
  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)
    const service = ctx.container.resolve<TerminalTrackingService>('terminalTrackingService')
    return service.testTerminalConfig(input)
  },
}

registerCommand(createTerminalConfig)
registerCommand(updateTerminalConfig)
registerCommand(deleteTerminalConfig)
registerCommand(testTerminalConfig)
