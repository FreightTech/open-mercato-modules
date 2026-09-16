import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Webhook, WebhookDelivery } from '../data/entities'
import type { WebhookCreateInput, WebhookUpdateInput } from '../data/validators'
import { dispatchWebhook } from '../lib/webhook-dispatcher'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) {
    throw new Error('Tenant mismatch')
  }
  if (!ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

const createWebhook: CommandHandler<WebhookCreateInput, { id: string }> = {
  id: 'shipment_tracking.webhook.create',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    const webhook = em.create(Webhook, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      url: input.url,
      eventsSubscribed: input.eventsSubscribed,
      hmacSecret: input.hmacSecret ?? null,
      isActive: input.isActive ?? true,
    })

    await em.flush()

    return { id: webhook.id }
  },

  async undo({ input, ctx }) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const webhooks = await findWithDecryption(em, Webhook, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }, { orderBy: { createdAt: 'desc' }, limit: 1 })
    const webhook = webhooks[0]
    if (webhook) {
      em.remove(webhook)
      await em.flush()
    }
  },
}

const updateWebhook: CommandHandler<WebhookUpdateInput, { id: string }> = {
  id: 'shipment_tracking.webhook.update',

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const webhook = await findOneWithDecryption(em, Webhook, { id: input.id })
    if (!webhook) throw new Error('Webhook not found')

    ensureScope(ctx, webhook.tenantId, webhook.organizationId)

    if (input.url !== undefined) webhook.url = input.url
    if (input.eventsSubscribed !== undefined) webhook.eventsSubscribed = input.eventsSubscribed
    if (input.hmacSecret !== undefined) webhook.hmacSecret = input.hmacSecret
    if (input.isActive !== undefined) webhook.isActive = input.isActive

    await em.flush()

    return { id: webhook.id }
  },
}

const deleteWebhook: CommandHandler<{ id: string; tenantId: string; organizationId: string }, { id: string }> = {
  id: 'shipment_tracking.webhook.delete',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    const webhook = await findOneWithDecryption(em, Webhook, { id: input.id })
    if (!webhook) throw new Error('Webhook not found')

    em.remove(webhook)
    await em.flush()

    return { id: input.id }
  },
}

const testWebhook: CommandHandler<
  { id: string; tenantId: string; organizationId: string },
  { success: boolean; deliveryId: string }
> = {
  id: 'shipment_tracking.webhook.test',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()

    const webhook = await findOneWithDecryption(em, Webhook, { id: input.id })
    if (!webhook) throw new Error('Webhook not found')

    if (!webhook.isActive) {
      throw new Error('Webhook is inactive')
    }

    // Build test payload
    const testPayload = {
      type: 'test',
      event: 'webhook.test',
      message: 'This is a test webhook delivery from Shipment Tracking',
      timestamp: new Date().toISOString(),
      webhookId: webhook.id,
    }

    // Create delivery record
    // Use getReference to create a managed reference since webhook may be detached after decryption
    const delivery = em.create(WebhookDelivery, {
      webhook: em.getReference(Webhook, webhook.id),
      eventType: 'webhook.test',
      status: 'pending',
      payload: testPayload,
      retryCount: 0,
    })

    em.persist(delivery)
    await em.flush()

    // Dispatch synchronously for immediate feedback
    const result = await dispatchWebhook({
      url: webhook.url,
      payload: testPayload,
      hmacSecret: webhook.hmacSecret,
    })

    // Update delivery record with result
    delivery.responseStatus = result.responseStatus ?? null
    delivery.responseBody = result.responseBody ?? null
    delivery.status = result.success ? 'success' : 'failed'
    delivery.errorMessage = result.errorMessage ?? null
    await em.flush()

    if (!result.success) {
      throw new Error(result.errorMessage || 'Webhook delivery failed')
    }

    return { success: true, deliveryId: delivery.id }
  },
}

registerCommand(createWebhook)
registerCommand(updateWebhook)
registerCommand(deleteWebhook)
registerCommand(testWebhook)
