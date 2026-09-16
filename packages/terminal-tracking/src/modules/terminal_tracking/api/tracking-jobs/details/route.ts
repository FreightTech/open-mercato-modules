import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { TerminalTrackingJob, TerminalEvent, TerminalVesselVisit } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['terminal_tracking.tracking_jobs.view'] },
}

export async function GET(request: NextRequest) {
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = container.resolve('em') as EntityManager
  const orgIds = scope?.filterIds ?? [auth.orgId]

  const job = await em.findOne(TerminalTrackingJob, {
    id,
    tenantId: auth.tenantId,
    organizationId: { $in: orgIds },
    deletedAt: null,
  })
  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const events = await em.find(
    TerminalEvent,
    { job: job.id, tenantId: auth.tenantId },
    { orderBy: { eventDateTime: 'asc' } },
  )

  // Resolved vessel visits for this container's legs, keyed by visit ref.
  const visitRefs = [
    ...new Set(
      events.flatMap((e) => [e.visitRefIn, e.visitRefOut]).filter((r): r is string => !!r),
    ),
  ]
  const visits = visitRefs.length
    ? await em.find(TerminalVesselVisit, {
        tenantId: auth.tenantId,
        organizationId: { $in: orgIds },
        terminalCode: job.terminalCode,
        visitRef: { $in: visitRefs },
      })
    : []
  const vesselVisits = Object.fromEntries(
    visits.map((v) => [
      v.visitRef,
      {
        visitRef: v.visitRef,
        vesselName: v.vesselName ?? null,
        ibVoyage: v.ibVoyage ?? null,
        obVoyage: v.obVoyage ?? null,
        line: v.line ?? null,
        phase: v.phase ?? null,
        eta: v.eta ? v.eta.toISOString() : null,
        etd: v.etd ? v.etd.toISOString() : null,
        ata: v.ata ? v.ata.toISOString() : null,
        atd: v.atd ? v.atd.toISOString() : null,
        beginReceive: v.beginReceive ? v.beginReceive.toISOString() : null,
        dryCutoff: v.dryCutoff ? v.dryCutoff.toISOString() : null,
      },
    ]),
  )

  return NextResponse.json({
    job: {
      id: job.id,
      terminalCode: job.terminalCode,
      containerNumber: job.containerNumber,
      status: job.status,
      lastPollAt: job.lastPollAt ? job.lastPollAt.toISOString() : null,
      nextPollAt: job.nextPollAt ? job.nextPollAt.toISOString() : null,
      retryCount: job.retryCount,
      errorHistory: job.errorHistory ?? [],
      createdAt: job.createdAt ? job.createdAt.toISOString() : null,
    },
    events: events.map((e) => ({
      id: e.id,
      ufvGkey: e.ufvGkey,
      sourceEventId: e.sourceEventId,
      eventType: e.eventType,
      eventCode: e.eventCode,
      eventClassifierCode: e.eventClassifierCode ?? null,
      eventDateTime: e.eventDateTime ? e.eventDateTime.toISOString() : null,
      transitState: e.transitState ?? null,
      visitState: e.visitState ?? null,
      facilityCode: e.facilityCode ?? null,
      facilityCodeListProvider: e.facilityCodeListProvider ?? null,
      unlocode: e.unlocode ?? null,
      visitRefIn: e.visitRefIn ?? null,
      visitRefOut: e.visitRefOut ?? null,
      vesselName: e.vesselName ?? null,
      voyageNumber: e.voyageNumber ?? null,
      modeOfTransport: e.modeOfTransport ?? null,
      seals: e.seals ?? null,
      vgmWeightKg: e.vgmWeightKg ?? null,
      impediments: e.impediments ?? null,
      loadedAt: e.loadedAt ? e.loadedAt.toISOString() : null,
      rawData: e.rawData ?? null,
    })),
    vesselVisits,
  })
}
