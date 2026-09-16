import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LocationOverride } from '../data/entities'
import type { LocationOverrideCreateInput, LocationOverrideUpdateInput } from '../data/validators'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) {
    throw new Error('Tenant mismatch')
  }
  if (!ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

const createLocationOverride: CommandHandler<LocationOverrideCreateInput, { id: string }> = {
  id: 'shipment_tracking.location_override.create',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    const override = em.create(LocationOverride, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      carrierCode: input.carrierCode?.toUpperCase() ?? null,
      unlocode: input.unlocode.toUpperCase(),
      facilityCode: input.facilityCode,
      facilityCodeListProvider: input.facilityCodeListProvider,
      overrideData: input.overrideData,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
      createdByUserId: ctx.auth?.userId ?? null,
      updatedByUserId: ctx.auth?.userId ?? null,
    })

    await em.flush()

    return { id: override.id }
  },

  async undo({ input, ctx }) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const override = await findOneWithDecryption(em, LocationOverride, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      unlocode: input.unlocode,
      facilityCode: input.facilityCode,
      facilityCodeListProvider: input.facilityCodeListProvider,
      carrierCode: input.carrierCode ?? null,
    })
    if (override) {
      em.remove(override)
      await em.flush()
    }
  },
}

const updateLocationOverride: CommandHandler<LocationOverrideUpdateInput, { id: string }> = {
  id: 'shipment_tracking.location_override.update',

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const override = await findOneWithDecryption(em, LocationOverride, { id: input.id })
    if (!override) throw new Error('Location override not found')

    ensureScope(ctx, override.tenantId, override.organizationId)

    if (input.carrierCode !== undefined) override.carrierCode = input.carrierCode?.toUpperCase() ?? null
    if (input.unlocode !== undefined) override.unlocode = input.unlocode.toUpperCase()
    if (input.facilityCode !== undefined) override.facilityCode = input.facilityCode
    if (input.facilityCodeListProvider !== undefined) override.facilityCodeListProvider = input.facilityCodeListProvider
    if (input.overrideData !== undefined) override.overrideData = input.overrideData
    if (input.description !== undefined) override.description = input.description
    if (input.isActive !== undefined) override.isActive = input.isActive
    override.updatedByUserId = ctx.auth?.userId ?? null

    await em.flush()

    return { id: override.id }
  },
}

const deleteLocationOverride: CommandHandler<{ id: string; tenantId: string; organizationId: string }, { id: string }> = {
  id: 'shipment_tracking.location_override.delete',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    const override = await findOneWithDecryption(em, LocationOverride, { id: input.id })
    if (!override) throw new Error('Location override not found')

    // Soft delete
    override.deletedAt = new Date()
    override.updatedByUserId = ctx.auth?.userId ?? null
    await em.flush()

    return { id: input.id }
  },

  async undo({ input, ctx }) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const override = await em.findOne(LocationOverride, { id: input.id })
    if (override) {
      override.deletedAt = null
      override.updatedByUserId = ctx.auth?.userId ?? null
      await em.flush()
    }
  },
}

registerCommand(createLocationOverride)
registerCommand(updateLocationOverride)
registerCommand(deleteLocationOverride)
