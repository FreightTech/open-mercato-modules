import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Shipment } from '../../../data/entities'
import { shipsMapQuerySchema, shipsMapResponseSchema } from '../../../data/validators'
import type { ShipsMapMarker, ShipsMapShipment } from '../../../data/validators'
import { getCurrentVessel } from '../../../lib/current-vessel'
import type { RouteStopEntry } from '../../../lib/route-extraction'
import { getVesselCached, mapWithConcurrency } from '../../../lib/vessel-cache'

// ─── Metadata ────────────────────────────────────────────────

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['shipment_tracking.dashboard.ships_map.view'] },
}

// ─── Helpers ─────────────────────────────────────────────────

/** The subset of Shipment fields this route projects from the DB. */
type ShipmentLite = Pick<
  Shipment,
  | 'id'
  | 'status'
  | 'containerNumber'
  | 'routeStops'
  | 'cargoEvents'
  | 'vesselName'
  | 'vesselImo'
  | 'destinationLocation'
  | 'etaTimestamps'
>

/**
 * Resolve the port coordinates for an `at_port` shipment. `getCurrentVessel` reports the
 * port as a location name (`currentPort`); we look up the matching route stop (the one the
 * cargo has arrived at but not departed) for its coords, then fall back to the shipment's
 * destination coords. Returns `null` when nothing is plottable.
 */
function resolveAtPortPosition(
  routeStops: RouteStopEntry[] | null | undefined,
  currentPort: string | undefined,
  shipment: ShipmentLite,
): { lat: number; lng: number; portName: string | null; unlocode: string | null } | null {
  // Prefer the stop the cargo is resting at (arrived, not yet departed) that matches currentPort.
  const stop = (routeStops ?? []).find(
    (s) => s.location === currentPort && s.ata && !s.atd && s.coords,
  )
    ?? (routeStops ?? []).find((s) => s.ata && !s.atd && s.coords)

  if (stop?.coords) {
    return {
      lat: stop.coords.latitude,
      lng: stop.coords.longitude,
      portName: stop.location ?? currentPort ?? null,
      unlocode: stop.unlocode ?? null,
    }
  }

  // Fallback: destination coords.
  const dest = shipment.destinationLocation
  if (dest?.coords) {
    return {
      lat: dest.coords.latitude,
      lng: dest.coords.longitude,
      portName: dest.name ?? currentPort ?? null,
      unlocode: dest.unlocode ?? null,
    }
  }

  return null
}

function toShipmentSummary(shipment: ShipmentLite): ShipsMapShipment {
  const eta = shipment.etaTimestamps?.length
    ? shipment.etaTimestamps[shipment.etaTimestamps.length - 1]?.value ?? null
    : null
  return {
    id: shipment.id,
    containerNumber: shipment.containerNumber ?? null,
    status: shipment.status,
    eta,
    destinationLocation: shipment.destinationLocation?.name ?? null,
  }
}

// ─── GET — Ships map aggregation ─────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.orgId || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const parsedQuery = shipsMapQuerySchema.safeParse({
    scope: url.searchParams.get('scope') ?? undefined,
  })
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }
  const { scope: scopeFilter } = parsedQuery.data

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = container.resolve('em') as EntityManager

  const organizationId = scope?.selectedId ?? auth.orgId
  const tenantId = auth.tenantId

  // Coarse prefilter only: exclude DELIVERED. getCurrentVessel is the authoritative
  // classifier — the denormalized `status` column can lag route-stop reality, so we must
  // NOT narrow to a status allow-list here or we'd drop genuinely in-transit shipments.
  const where: FilterQuery<Shipment> = {
    organizationId,
    tenantId,
    deletedAt: null,
    status: { $ne: 'DELIVERED' },
  }

  const shipments = await em.find(Shipment, where, {
    fields: [
      'id',
      'status',
      'containerNumber',
      'routeStops',
      'cargoEvents',
      'vesselName',
      'vesselImo',
      'destinationLocation',
      'etaTimestamps',
    ],
  })

  // Group in_transit shipments by the IMO of the vessel actually carrying them.
  const byImo = new Map<string, ShipmentLite[]>()
  // Group at_port shipments by a port key (unlocode|name + rounded coords).
  const portGroups = new Map<
    string,
    { lat: number; lng: number; portName: string | null; unlocode: string | null; shipments: ShipmentLite[] }
  >()
  let unresolvedCount = 0

  for (const shipment of shipments) {
    const current = getCurrentVessel(shipment.routeStops, shipment.cargoEvents, {
      vesselName: shipment.vesselName,
      vesselImo: shipment.vesselImo,
    })

    if (current.status === 'in_transit') {
      if (scopeFilter === 'at_port') continue
      const imo = current.vesselImo
      if (!imo) {
        unresolvedCount += 1
        continue
      }
      const list = byImo.get(imo) ?? []
      list.push(shipment)
      byImo.set(imo, list)
    } else if (current.status === 'at_port') {
      if (scopeFilter === 'in_transit') continue
      const pos = resolveAtPortPosition(shipment.routeStops, current.currentPort, shipment)
      if (!pos) {
        unresolvedCount += 1
        continue
      }
      const key = pos.unlocode ?? `${pos.portName ?? ''}:${pos.lat.toFixed(3)},${pos.lng.toFixed(3)}`
      const group = portGroups.get(key)
      if (group) {
        group.shipments.push(shipment)
      } else {
        portGroups.set(key, { ...pos, shipments: [shipment] })
      }
    }
    // not_departed / delivered → not plotted (no meaningful "where is it now").
  }

  const markers: ShipsMapMarker[] = []

  // Fan out distinct IMOs through the bounded cache, concurrency-capped, fault-tolerant.
  const imos = Array.from(byImo.keys())
  const vesselResults = await mapWithConcurrency(imos, (imo) => getVesselCached(imo))

  imos.forEach((imo, i) => {
    const result = vesselResults[i]
    const group = byImo.get(imo) ?? []
    const vessel = result.status === 'fulfilled' ? result.value : null
    if (!vessel || !vessel.lastPosition) {
      // vessel-api miss / failure / positionless → fold its shipments into unresolved.
      unresolvedCount += group.length
      return
    }
    markers.push({
      kind: 'vessel',
      imo,
      name: vessel.name ?? null,
      position: { lat: vessel.lastPosition.lat, lng: vessel.lastPosition.lng },
      heading: vessel.lastHeading ?? null,
      destination: vessel.lastDestinationPort?.name ?? vessel.lastDestination ?? null,
      updatedAt: vessel.updatedAt ?? null,
      shipments: group.map(toShipmentSummary),
    })
  })

  for (const group of portGroups.values()) {
    markers.push({
      kind: 'port',
      portName: group.portName,
      unlocode: group.unlocode,
      position: { lat: group.lat, lng: group.lng },
      shipments: group.shipments.map(toShipmentSummary),
    })
  }

  return NextResponse.json({
    markers,
    unresolvedCount,
    generatedAt: new Date().toISOString(),
  })
}

// ─── OpenAPI ─────────────────────────────────────────────────

export const openApi: OpenApiRouteDoc = {
  tag: 'Shipment Tracking',
  summary: 'Ships map dashboard widget',
  methods: {
    GET: {
      summary: 'Aggregate live vessel and at-port positions for active shipments',
      description:
        'Returns one marker per distinct in-transit vessel (live AIS position) plus one port marker per port where at-rest cargo waits, scoped to the authenticated organization. Read-only projection over existing Shipment data + the external vessel-api.',
      query: shipsMapQuerySchema,
      responses: [
        { status: 200, description: 'Ships map payload', schema: shipsMapResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
