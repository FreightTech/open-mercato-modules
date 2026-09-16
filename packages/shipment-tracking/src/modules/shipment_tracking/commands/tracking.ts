import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import type { TrackingService } from '../services/trackingService'
import { Shipment } from '../data/entities'
import { evaluatePreArrivalUpgrade } from '../lib/status-machine'
import { getPrimaryTimestampValue } from '../lib/timestamp-utils'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId?: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) {
    throw new Error('Tenant mismatch')
  }
  if (organizationId && !ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

type PollAllInput = {
  tenantId: string
  organizationId?: string
}

type PollAllResult = {
  polled: number
  newEvents: number
  failed: number
}

/**
 * Command to poll all active tracking jobs for a tenant/organization.
 * This is called by the scheduler for daily re-polling.
 */
const pollAllActiveJobs: CommandHandler<PollAllInput, PollAllResult> = {
  id: 'shipment_tracking.tracking.poll_all',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const trackingService = ctx.container.resolve<TrackingService>('shipmentTrackingService')

    const result = await trackingService.pollAllActiveJobs(input.tenantId, input.organizationId)

    console.log('[shipment-tracking:poll_all] Command completed:', {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...result,
    })

    return result
  },

  buildLog({ result, input }) {
    return {
      actionLabel: 'Poll all tracking jobs',
      resourceKind: 'shipment_tracking.tracking',
      resourceId: input.organizationId ?? input.tenantId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      details: {
        polled: result.polled,
        newEvents: result.newEvents,
        failed: result.failed,
      },
    }
  },
}

type PollSingleInput = {
  jobId: string
  tenantId: string
  organizationId: string
}

type PollSingleResult = {
  newEvents: number
  shipmentsCreated: number
  shipmentsUpdated: number
}

/**
 * Command to poll a single tracking job.
 * Can be called manually to trigger an immediate poll.
 */
const pollSingleJob: CommandHandler<PollSingleInput, PollSingleResult> = {
  id: 'shipment_tracking.tracking.poll_single',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const trackingService = ctx.container.resolve<TrackingService>('shipmentTrackingService')

    const result = await trackingService.pollTrackingJob(input.jobId)

    return {
      newEvents: result.newEvents,
      shipmentsCreated: result.shipmentsCreated,
      shipmentsUpdated: result.shipmentsUpdated,
    }
  },

  buildLog({ result, input }) {
    return {
      actionLabel: 'Poll tracking job',
      resourceKind: 'shipment_tracking.tracking_job',
      resourceId: input.jobId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      details: {
        newEvents: result.newEvents,
        shipmentsCreated: result.shipmentsCreated,
        shipmentsUpdated: result.shipmentsUpdated,
      },
    }
  },
}

type EvaluatePreArrivalInput = {
  tenantId: string
  organizationId?: string
}

type EvaluatePreArrivalResult = {
  evaluated: number
  upgraded: number
}

/**
 * Command to evaluate IN_TRANSIT shipments for PRE_ARRIVAL status upgrade.
 * This is called by the scheduler to check shipments approaching their destination.
 *
 * A shipment is upgraded to PRE_ARRIVAL when:
 * - Current status is IN_TRANSIT
 * - ETA is within 7 days
 * - No ATA (actual arrival) yet
 */
const evaluatePreArrival: CommandHandler<EvaluatePreArrivalInput, EvaluatePreArrivalResult> = {
  id: 'shipment_tracking.tracking.evaluate_pre_arrival',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em')
    const eventBus = ctx.container.resolve<EventBus>('eventBus')

    // Find all IN_TRANSIT shipments for the tenant/organization
    const filters: Record<string, unknown> = {
      tenantId: input.tenantId,
      status: 'IN_TRANSIT',
      deletedAt: null,
    }

    if (input.organizationId) {
      filters.organizationId = input.organizationId
    }

    const shipments = await em.find(Shipment, filters)

    let upgraded = 0

    for (const shipment of shipments) {
      const eta = getPrimaryTimestampValue(shipment.etaTimestamps)
      const ata = getPrimaryTimestampValue(shipment.ataTimestamps)

      const newStatus = evaluatePreArrivalUpgrade(shipment.status, { eta, ata })

      if (newStatus !== shipment.status) {
        const previousStatus = shipment.status
        shipment.status = newStatus

        // Emit status_changed event
        await eventBus.emit('shipment_tracking.shipment.status_changed', {
          id: shipment.id,
          previousStatus,
          newStatus,
          tenantId: shipment.tenantId,
          organizationId: shipment.organizationId,
        })

        // Emit pre_arrival lifecycle event
        await eventBus.emit('shipment_tracking.shipment.pre_arrival', {
          id: shipment.id,
          tenantId: shipment.tenantId,
          organizationId: shipment.organizationId,
        })

        // Emit updated event
        await eventBus.emit('shipment_tracking.shipment.updated', {
          id: shipment.id,
          tenantId: shipment.tenantId,
          organizationId: shipment.organizationId,
        })

        upgraded++
      }
    }

    await em.flush()

    console.log('[shipment-tracking:evaluate_pre_arrival] Command completed:', {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      evaluated: shipments.length,
      upgraded,
    })

    return {
      evaluated: shipments.length,
      upgraded,
    }
  },

  buildLog({ result, input }) {
    return {
      actionLabel: 'Evaluate PRE_ARRIVAL status',
      resourceKind: 'shipment_tracking.tracking',
      resourceId: input.organizationId ?? input.tenantId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      details: {
        evaluated: result.evaluated,
        upgraded: result.upgraded,
      },
    }
  },
}

registerCommand(pollAllActiveJobs)
registerCommand(pollSingleJob)
registerCommand(evaluatePreArrival)
