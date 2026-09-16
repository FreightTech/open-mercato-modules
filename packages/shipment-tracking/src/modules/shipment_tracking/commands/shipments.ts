import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/core'
import type { EventBus } from '@open-mercato/events'
import { Shipment, TrackingJob } from '../data/entities'
import type { ShipmentCreateInput, ShipmentUpdateInput } from '../data/validators'
import { createTimestampEntry, addTimestampEntry } from '../lib/timestamp-utils'
import type { TimestampSource } from '../lib/timestamp-utils'

function ensureScope(ctx: CommandRuntimeContext, tenantId: string, organizationId: string) {
  if (ctx.auth?.tenantId && ctx.auth.tenantId !== tenantId) {
    throw new Error('Tenant mismatch')
  }
  if (!ctx.auth?.isSuperAdmin && ctx.auth?.organizationId && ctx.auth.organizationId !== organizationId) {
    throw new Error('Organization mismatch')
  }
}

const createShipment: CommandHandler<ShipmentCreateInput, { id: string }> = {
  id: 'shipment_tracking.shipment.create',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const eventBus = ctx.container.resolve<EventBus>('eventBus')

    // If trackingJobId is provided, verify it exists
    let trackingJob: TrackingJob | null = null
    if (input.trackingJobId) {
      trackingJob = await em.findOne(TrackingJob, {
        id: input.trackingJobId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        deletedAt: null,
      })
      if (!trackingJob) throw new Error('Tracking job not found')
    }

    const shipment = em.create(Shipment, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      trackingJob: trackingJob ?? undefined,
      carrierCode: input.carrierCode ?? null,
      containerNumber: input.containerNumber ?? null,
      bookingNumber: input.bookingNumber ?? null,
      bolNumber: input.bolNumber ?? null,
      // Multi-source timestamp arrays
      etdTimestamps: input.etdTimestamps ?? null,
      etaTimestamps: input.etaTimestamps ?? null,
      atdTimestamps: input.atdTimestamps ?? null,
      ataTimestamps: input.ataTimestamps ?? null,
      // Location data (JSONB)
      originLocation: input.originLocation ?? null,
      destinationLocation: input.destinationLocation ?? null,
      vesselName: input.vesselName ?? null,
      vesselImo: input.vesselImo ?? null,
      voyageNumber: input.voyageNumber ?? null,
      extra: input.extra ?? null,
      createdByUserId: ctx.auth?.userId ?? null,
    })

    await em.flush()

    await eventBus.emit('shipment_tracking.shipment.created', {
      id: shipment.id,
      containerNumber: shipment.containerNumber,
      trackingJobId: trackingJob?.id ?? null,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    return { id: shipment.id }
  },

  buildLog({ result, input }) {
    return {
      actionLabel: 'Create shipment',
      resourceKind: 'shipment_tracking.shipment',
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }
  },

  async undo({ logEntry, ctx }) {
    const shipmentId = logEntry?.resourceId
    if (!shipmentId) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    // Use nativeUpdate to avoid identity map issues
    const now = new Date()
    await em.nativeUpdate(Shipment, { id: shipmentId, deletedAt: null }, { deletedAt: now, updatedAt: now })
  },
}

const updateShipment: CommandHandler<ShipmentUpdateInput, { id: string }> = {
  id: 'shipment_tracking.shipment.update',

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const eventBus = ctx.container.resolve<EventBus>('eventBus')

    const shipment = await em.findOne(Shipment, { id: input.id, deletedAt: null })
    if (!shipment) throw new Error('Shipment not found')

    ensureScope(ctx, shipment.tenantId, shipment.organizationId)

    const previousStatus = shipment.status

    // Handle trackingJobId change
    if (input.trackingJobId !== undefined) {
      if (input.trackingJobId === null) {
        shipment.trackingJob = null
      } else {
        const trackingJob = await em.findOne(TrackingJob, {
          id: input.trackingJobId,
          tenantId: shipment.tenantId,
          organizationId: shipment.organizationId,
          deletedAt: null,
        })
        if (!trackingJob) throw new Error('Tracking job not found')
        shipment.trackingJob = trackingJob
      }
    }

    if (input.carrierCode !== undefined) shipment.carrierCode = input.carrierCode
    if (input.containerNumber !== undefined) shipment.containerNumber = input.containerNumber
    if (input.bookingNumber !== undefined) shipment.bookingNumber = input.bookingNumber
    if (input.bolNumber !== undefined) shipment.bolNumber = input.bolNumber
    if (input.status !== undefined) shipment.status = input.status

    // Multi-source timestamp arrays - can replace entire arrays
    if (input.etdTimestamps !== undefined) shipment.etdTimestamps = input.etdTimestamps
    if (input.etaTimestamps !== undefined) shipment.etaTimestamps = input.etaTimestamps
    if (input.atdTimestamps !== undefined) shipment.atdTimestamps = input.atdTimestamps
    if (input.ataTimestamps !== undefined) shipment.ataTimestamps = input.ataTimestamps

    // Convenience: add single timestamp entries (e.g., manual overrides)
    if (input.addEtdTimestamp) {
      const entry = createTimestampEntry(
        input.addEtdTimestamp.value,
        input.addEtdTimestamp.offset ?? null,
        input.addEtdTimestamp.source as TimestampSource,
        input.addEtdTimestamp.sourceEventId,
      )
      shipment.etdTimestamps = addTimestampEntry(shipment.etdTimestamps, entry)
    }
    if (input.addEtaTimestamp) {
      const entry = createTimestampEntry(
        input.addEtaTimestamp.value,
        input.addEtaTimestamp.offset ?? null,
        input.addEtaTimestamp.source as TimestampSource,
        input.addEtaTimestamp.sourceEventId,
      )
      shipment.etaTimestamps = addTimestampEntry(shipment.etaTimestamps, entry)
    }
    if (input.addAtdTimestamp) {
      const entry = createTimestampEntry(
        input.addAtdTimestamp.value,
        input.addAtdTimestamp.offset ?? null,
        input.addAtdTimestamp.source as TimestampSource,
        input.addAtdTimestamp.sourceEventId,
      )
      shipment.atdTimestamps = addTimestampEntry(shipment.atdTimestamps, entry)
    }
    if (input.addAtaTimestamp) {
      const entry = createTimestampEntry(
        input.addAtaTimestamp.value,
        input.addAtaTimestamp.offset ?? null,
        input.addAtaTimestamp.source as TimestampSource,
        input.addAtaTimestamp.sourceEventId,
      )
      shipment.ataTimestamps = addTimestampEntry(shipment.ataTimestamps, entry)
    }

    // Location data
    if (input.originLocation !== undefined) shipment.originLocation = input.originLocation
    if (input.destinationLocation !== undefined) shipment.destinationLocation = input.destinationLocation
    if (input.vesselName !== undefined) shipment.vesselName = input.vesselName
    if (input.vesselImo !== undefined) shipment.vesselImo = input.vesselImo
    if (input.voyageNumber !== undefined) shipment.voyageNumber = input.voyageNumber
    if (input.extra !== undefined) shipment.extra = input.extra

    await em.flush()

    await eventBus.emit('shipment_tracking.shipment.updated', {
      id: shipment.id,
      tenantId: shipment.tenantId,
      organizationId: shipment.organizationId,
    })

    if (input.status && previousStatus !== input.status) {
      await eventBus.emit('shipment_tracking.shipment.status_changed', {
        id: shipment.id,
        previousStatus,
        newStatus: input.status,
        tenantId: shipment.tenantId,
        organizationId: shipment.organizationId,
      })
    }

    return { id: shipment.id }
  },
}

const deleteShipment: CommandHandler<{ id: string; tenantId: string; organizationId: string }, { id: string }> = {
  id: 'shipment_tracking.shipment.delete',

  async execute(input, ctx) {
    ensureScope(ctx, input.tenantId, input.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const eventBus = ctx.container.resolve<EventBus>('eventBus')

    // First verify the shipment exists and is not already deleted
    const shipment = await em.findOne(Shipment, { id: input.id, deletedAt: null })
    if (!shipment) throw new Error('Shipment not found')

    const shipmentId = shipment.id
    const tenantId = shipment.tenantId
    const organizationId = shipment.organizationId

    // Use nativeUpdate to avoid any MikroORM identity map issues
    const now = new Date()
    const affected = await em.nativeUpdate(
      Shipment,
      { id: shipmentId, deletedAt: null },
      { deletedAt: now, updatedAt: now },
    )

    if (affected === 0) {
      throw new Error('Shipment not found or already deleted')
    }

    await eventBus.emit('shipment_tracking.shipment.deleted', {
      id: shipmentId,
      tenantId,
      organizationId,
    })

    return { id: shipmentId }
  },
}

registerCommand(createShipment)
registerCommand(updateShipment)
registerCommand(deleteShipment)
