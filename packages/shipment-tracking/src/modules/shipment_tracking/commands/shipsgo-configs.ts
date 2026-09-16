import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ShipsGoConfig } from '../data/entities'
import type { ShipsGoConfigUpsertInput } from '../data/validators'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) {
    throw new Error('Tenant mismatch')
  }
  if (!ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

/**
 * Upsert the ShipsGo config — one row per organization/tenant. The api_token
 * sentinel '__UNCHANGED__' leaves the stored (encrypted) token intact so the
 * UI can round-trip without ever seeing the plaintext.
 */
const upsertShipsGoConfig: CommandHandler<ShipsGoConfigUpsertInput, { id: string }> = {
  id: 'shipment_tracking.shipsgo_config.upsert',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    let config = await findOneWithDecryption(
      em,
      ShipsGoConfig,
      { organizationId: input.organizationId, tenantId: input.tenantId },
      {},
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )

    if (config) {
      config.isEnabled = input.isEnabled
      if (input.apiToken && input.apiToken !== '__UNCHANGED__') {
        config.apiToken = input.apiToken
      }
      config.baseUrl = input.baseUrl ?? 'https://api.shipsgo.com/v2'
      config.oceanEnabled = input.oceanEnabled
      config.airEnabled = input.airEnabled
      config.rateLimitRequests = input.rateLimitRequests
      config.rateLimitWindowSeconds = input.rateLimitWindowSeconds
      // Re-configuring after a soft delete revives the row.
      config.isActive = true
      config.deletedAt = null
    } else {
      config = em.create(ShipsGoConfig, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        isEnabled: input.isEnabled,
        apiToken: input.apiToken,
        baseUrl: input.baseUrl ?? 'https://api.shipsgo.com/v2',
        oceanEnabled: input.oceanEnabled,
        airEnabled: input.airEnabled,
        rateLimitRequests: input.rateLimitRequests,
        rateLimitWindowSeconds: input.rateLimitWindowSeconds,
      })
    }

    await em.flush()

    return { id: config.id }
  },
}

const deleteShipsGoConfig: CommandHandler<{ tenantId: string; organizationId: string }, { success: boolean }> = {
  id: 'shipment_tracking.shipsgo_config.delete',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    const config = await findOneWithDecryption(
      em,
      ShipsGoConfig,
      { organizationId: input.organizationId, tenantId: input.tenantId },
      {},
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )

    if (config) {
      // Soft-delete: preserve the row (and its encrypted token) for audit, and
      // stop it driving tracking. resolveConfig filters `deletedAt: null`, so a
      // soft-deleted config falls back to the platform env account like no row.
      config.isActive = false
      config.deletedAt = new Date()
      await em.flush()
    }

    return { success: true }
  },
}

registerCommand(upsertShipsGoConfig)
registerCommand(deleteShipsGoConfig)
