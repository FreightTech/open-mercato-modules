import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { TerminalEvent, TerminalVesselVisit } from '../../data/entities'
import { vesselVisitListSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['terminal_tracking.events.view'] },
}

function serialize(v: TerminalVesselVisit) {
  return {
    id: v.id,
    terminalCode: v.terminalCode,
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
    updatedAt: v.updatedAt ? v.updatedAt.toISOString() : null,
  }
}

/**
 * List resolved vessel visits. Filter by `visitRef`, by `containerNumber`
 * (resolved through the container's terminal events' visit refs), or page the
 * most-recently-updated visits.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = vesselVisitListSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }
  const { visitRef, containerNumber, terminalCode } = parsed.data
  const page = parsed.data.page ?? 1
  const pageSize = parsed.data.pageSize ?? 50

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = container.resolve('em') as EntityManager
  const orgIds = scope?.filterIds ?? [auth.orgId]

  const baseWhere = {
    tenantId: auth.tenantId,
    organizationId: { $in: orgIds },
    ...(terminalCode ? { terminalCode } : {}),
  }

  // Resolve the set of visit refs to query.
  let refFilter: Record<string, unknown> | null = null
  if (visitRef) {
    refFilter = { visitRef }
  } else if (containerNumber) {
    const events = await em.find(
      TerminalEvent,
      { containerNumber, tenantId: auth.tenantId, organizationId: { $in: orgIds } },
      { fields: ['visitRefIn', 'visitRefOut'] },
    )
    const refs = [
      ...new Set(
        events.flatMap((e) => [e.visitRefIn, e.visitRefOut]).filter((r): r is string => !!r),
      ),
    ]
    if (refs.length === 0) {
      return NextResponse.json({ items: [], total: 0, page, pageSize })
    }
    refFilter = { visitRef: { $in: refs } }
  }

  const where = { ...baseWhere, ...(refFilter ?? {}) }

  const [items, total] = await em.findAndCount(TerminalVesselVisit, where, {
    orderBy: { updatedAt: 'desc' },
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })

  return NextResponse.json({ items: items.map(serialize), total, page, pageSize })
}
