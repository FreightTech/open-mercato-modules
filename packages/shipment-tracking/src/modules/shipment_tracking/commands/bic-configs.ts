import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { BicConfig } from '../data/entities'
import type { BicConfigUpsertInput } from '../data/validators'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) {
    throw new Error('Tenant mismatch')
  }
  if (!ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

/**
 * Upsert BIC config - creates if not exists, updates if exists.
 * There is only one BIC config per organization/tenant.
 */
const upsertBicConfig: CommandHandler<BicConfigUpsertInput, { id: string }> = {
  id: 'shipment_tracking.bic_config.upsert',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    // Find existing config for this org/tenant
    let bicConfig = await findOneWithDecryption(
      em,
      BicConfig,
      { organizationId: input.organizationId, tenantId: input.tenantId },
      {},
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )

    if (bicConfig) {
      // Update existing
      bicConfig.isEnabled = input.isEnabled
      bicConfig.username = input.username
      // Only update password if a new one was provided (not the sentinel value)
      if (input.password && input.password !== '__UNCHANGED__') {
        bicConfig.password = input.password
      }
      bicConfig.baseUrl = input.baseUrl ?? 'https://api.bic-code.org'
    } else {
      // Create new
      bicConfig = em.create(BicConfig, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        isEnabled: input.isEnabled,
        username: input.username,
        password: input.password,
        baseUrl: input.baseUrl ?? 'https://api.bic-code.org',
      })
    }

    await em.flush()

    return { id: bicConfig.id }
  },
}

/**
 * Delete BIC config
 */
const deleteBicConfig: CommandHandler<{ tenantId: string; organizationId: string }, { success: boolean }> = {
  id: 'shipment_tracking.bic_config.delete',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    const bicConfig = await findOneWithDecryption(
      em,
      BicConfig,
      { organizationId: input.organizationId, tenantId: input.tenantId },
      {},
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )

    if (bicConfig) {
      em.remove(bicConfig)
      await em.flush()
    }

    return { success: true }
  },
}

registerCommand(upsertBicConfig)
registerCommand(deleteBicConfig)
