import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CarrierConfig } from '../data/entities'
import type { CarrierConfigCreateInput, CarrierConfigUpdateInput } from '../data/validators'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) {
    throw new Error('Tenant mismatch')
  }
  if (!ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

const createCarrierConfig: CommandHandler<CarrierConfigCreateInput, { id: string }> = {
  id: 'shipment_tracking.carrier_config.create',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    const carrierConfig = em.create(CarrierConfig, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      carrierCode: input.carrierCode,
      apiEndpoint: input.apiEndpoint ?? null,
      authConfig: input.authConfig ?? null,
      rateLimitRequests: input.rateLimitRequests ?? 60,
      rateLimitWindowSeconds: input.rateLimitWindowSeconds ?? 60,
      isActive: input.isActive ?? true,
    })

    await em.flush()

    return { id: carrierConfig.id }
  },
}

const updateCarrierConfig: CommandHandler<CarrierConfigUpdateInput, { id: string }> = {
  id: 'shipment_tracking.carrier_config.update',

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const carrierConfig = await findOneWithDecryption(em, CarrierConfig, { id: input.id, deletedAt: null })
    if (!carrierConfig) throw new Error('Carrier config not found')

    ensureScope(ctx, carrierConfig.tenantId, carrierConfig.organizationId)

    if (input.apiEndpoint !== undefined) carrierConfig.apiEndpoint = input.apiEndpoint
    if (input.authConfig !== undefined) carrierConfig.authConfig = input.authConfig
    if (input.rateLimitRequests !== undefined) carrierConfig.rateLimitRequests = input.rateLimitRequests
    if (input.rateLimitWindowSeconds !== undefined) carrierConfig.rateLimitWindowSeconds = input.rateLimitWindowSeconds
    if (input.isActive !== undefined) carrierConfig.isActive = input.isActive

    await em.flush()

    return { id: carrierConfig.id }
  },
}

const deleteCarrierConfig: CommandHandler<{ id: string; tenantId: string; organizationId: string }, { id: string }> = {
  id: 'shipment_tracking.carrier_config.delete',

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()

    // Fetch first, then validate scope (same pattern as update)
    const carrierConfig = await findOneWithDecryption(em, CarrierConfig, {
      id: input.id,
      deletedAt: null,
    })
    if (!carrierConfig) throw new Error('Carrier config not found')

    ensureScope(ctx, carrierConfig.tenantId, carrierConfig.organizationId)

    carrierConfig.deletedAt = new Date()
    await em.flush()

    return { id: carrierConfig.id }
  },
}

registerCommand(createCarrierConfig)
registerCommand(updateCarrierConfig)
registerCommand(deleteCarrierConfig)
