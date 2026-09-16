'use client'

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Sheet, SheetContent } from '@freighttech/ui/primitives/sheet'
import { Badge } from '@freighttech/ui/primitives/badge'
import { SimpleTooltip, TooltipProvider } from '@freighttech/ui/primitives/tooltip'
import { apiCallOrThrow } from '@freighttech/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveHolds, type HoldSeverity } from '../lib/holds'
import { parseTerminalStops, activeStopModes, type TerminalStopMode } from '../lib/stops'
import {
  Loader2,
  LogIn,
  Warehouse,
  PackageCheck,
  Truck,
  Ship,
  Train,
  Anchor,
  Calendar,
  AlertTriangle,
  ShieldAlert,
  Ban,
} from 'lucide-react'

type TerminalSeal = { number: string; type?: string | null; source?: string | null }

type TerminalEventData = {
  id: string
  ufvGkey: string
  sourceEventId: string
  eventType: string
  eventCode: string
  eventClassifierCode: 'ACT' | 'PLN' | 'EST' | null
  eventDateTime: string | null
  transitState: string | null
  visitState: string | null
  facilityCode: string | null
  facilityCodeListProvider: string | null
  unlocode: string | null
  visitRefIn: string | null
  visitRefOut: string | null
  vesselName: string | null
  voyageNumber: string | null
  modeOfTransport: 'VESSEL' | 'RAIL' | 'TRUCK' | 'BARGE' | null
  seals: TerminalSeal[] | null
  vgmWeightKg: number | null
  impediments: string[] | null
  loadedAt: string | null
  rawData: Record<string, unknown> | null
}

type JobData = {
  id: string
  terminalCode: string
  containerNumber: string
  status: string
  lastPollAt: string | null
  nextPollAt: string | null
  retryCount: number
  errorHistory: Array<{ date: string; message: string }>
  createdAt: string | null
}

type VesselVisitData = {
  visitRef: string
  vesselName: string | null
  ibVoyage: string | null
  obVoyage: string | null
  line: string | null
  phase: string | null
  eta: string | null
  etd: string | null
  ata: string | null
  atd: string | null
  beginReceive: string | null
  dryCutoff: string | null
}

export interface ContainerDetailsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string | null
}

function eventIcon(code: string): React.ComponentType<{ className?: string }> {
  switch (code) {
    case 'GTIN':
      return LogIn
    case 'DISC':
      return Warehouse
    case 'LOAD':
      return PackageCheck
    case 'DEPA':
      return Anchor
    default:
      return PackageCheck
  }
}

function modeIcon(mode: string | null): React.ComponentType<{ className?: string }> | null {
  switch (mode) {
    case 'RAIL':
      return Train
    case 'TRUCK':
      return Truck
    case 'VESSEL':
    case 'BARGE':
      return Ship
    default:
      return null
  }
}

function fmt(date: string | null): string {
  if (!date) return '—'
  try {
    return new Date(date).toLocaleString()
  } catch {
    return date
  }
}

function val(v: unknown): string {
  if (v == null || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive'
  if (status === 'active') return 'default'
  if (status === 'completed') return 'outline'
  return 'secondary'
}

/** Badge colours by hold severity: red = blocking, amber = routine, slate = info. */
function holdBadgeClass(severity: HoldSeverity): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-100 text-red-700'
    case 'warning':
      return 'bg-amber-100 text-amber-800'
    case 'info':
      return 'bg-slate-100 text-slate-600'
  }
}

export function ContainerDetailsDrawer({ open, onOpenChange, jobId }: ContainerDetailsDrawerProps) {
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [job, setJob] = useState<JobData | null>(null)
  const [events, setEvents] = useState<TerminalEventData[]>([])
  const [vesselVisits, setVesselVisits] = useState<Record<string, VesselVisitData>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !jobId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiCallOrThrow<{
      job: JobData
      events: TerminalEventData[]
      vesselVisits?: Record<string, VesselVisitData>
    }>(`/api/terminal_tracking/tracking-jobs/details?id=${encodeURIComponent(jobId)}`)
      .then(({ result }) => {
        if (cancelled) return
        setJob(result?.job ?? null)
        setEvents(result?.events ?? [])
        setVesselVisits(result?.vesselVisits ?? {})
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load container details')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, jobId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    },
    [onOpenChange],
  )

  const eventLabel = useCallback(
    (code: string): string => {
      switch (code) {
        case 'GTIN':
          return t('terminal_tracking.event.gate_in', 'Gate In')
        case 'DISC':
          return t('terminal_tracking.event.yard', 'In Yard / Discharged')
        case 'LOAD':
          return t('terminal_tracking.event.loaded', 'Loaded')
        case 'DEPA':
          return t('terminal_tracking.event.departed', 'Departed')
        default:
          return code
      }
    },
    [t],
  )

  // Group events by Unit Facility Visit (import/export leg)
  const legs = React.useMemo(() => {
    const map = new Map<string, TerminalEventData[]>()
    for (const ev of events) {
      const arr = map.get(ev.ufvGkey) ?? []
      arr.push(ev)
      map.set(ev.ufvGkey, arr)
    }
    return Array.from(map.entries()).map(([ufvGkey, evs]) => ({ ufvGkey, events: evs }))
  }, [events])

  const latest = events.length ? events[events.length - 1] : null
  const vgm = latest?.vgmWeightKg ?? null
  const seals = latest?.seals ?? null
  // The load timestamp of whichever leg reported one (last non-null wins).
  const loadedAt = events.map((e) => e.loadedAt).filter(Boolean).pop() ?? null
  // Per-mode load/pickup restrictions (Stop-Vsl/Road/Rail), read from the raw
  // N4 columns on the latest snapshot; only active stops are surfaced.
  const stopModes = activeStopModes(parseTerminalStops(latest?.rawData ?? null))

  const stopLabel = useCallback(
    (mode: TerminalStopMode): string => {
      switch (mode) {
        case 'vsl':
          return t('terminal_tracking.stops.vsl', 'No vessel loading')
        case 'road':
          return t('terminal_tracking.stops.road', 'No road pickup')
        case 'rail':
          return t('terminal_tracking.stops.rail', 'No rail pickup')
      }
    },
    [t],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex flex-col p-0 w-full sm:max-w-xl md:max-w-2xl"
        overlayClassName="backdrop-blur-none"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('terminal_tracking.tracking_job.details', 'Container Details')}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-xl font-semibold font-mono">{job?.containerNumber ?? '—'}</span>
            {job ? (
              <Badge variant={statusVariant(job.status)}>
                {t(`terminal_tracking.tracking_job.statuses.${job.status}`, job.status)}
              </Badge>
            ) : null}
          </div>
          {job ? (
            <div className="mt-1 text-sm text-muted-foreground">
              {t('terminal_tracking.terminal_config.terminalCode', 'Terminal')}:{' '}
              <span className="font-medium uppercase">{job.terminalCode}</span>
            </div>
          ) : null}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : (
            <>
              {/* Holds */}
              {latest?.impediments && latest.impediments.length > 0 ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-red-700">
                    <ShieldAlert className="h-4 w-4" />
                    {t('terminal_tracking.event.impediments', 'Holds')}
                  </div>
                  <TooltipProvider>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {resolveHolds(latest.impediments).map((hold) => {
                        const label = hold.unknown
                          ? hold.label
                          : t(`terminal_tracking.holds.${hold.i18nKey}.label`, hold.label)
                        const description = t(
                          `terminal_tracking.holds.${hold.i18nKey}.description`,
                          hold.description,
                        )
                        const resolution = t(
                          `terminal_tracking.holds.${hold.i18nKey}.resolution`,
                          hold.resolution,
                        )
                        return (
                          <SimpleTooltip
                            key={hold.rawCode}
                            content={
                              <div className="space-y-1">
                                <div className="font-medium">{label}</div>
                                <div>{description}</div>
                                <div className="text-slate-300">{resolution}</div>
                              </div>
                            }
                          >
                            <span
                              className={`cursor-help rounded px-1.5 py-0.5 text-xs ${holdBadgeClass(hold.severity)}`}
                            >
                              {label}
                            </span>
                          </SimpleTooltip>
                        )
                      })}
                    </div>
                  </TooltipProvider>
                </div>
              ) : null}

              {/* Loading restrictions (Stop-Vsl / Stop-Road / Stop-Rail) */}
              {stopModes.length > 0 ? (
                <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-orange-700">
                    <Ban className="h-4 w-4" />
                    {t('terminal_tracking.stops.title', 'Loading restrictions')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {stopModes.map((mode) => {
                      const Icon = mode === 'vsl' ? Ship : mode === 'road' ? Truck : Train
                      return (
                        <span
                          key={mode}
                          className="inline-flex items-center gap-1 rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-800"
                        >
                          <Icon className="h-3 w-3" />
                          {stopLabel(mode)}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {/* Summary */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <SummaryItem label={t('terminal_tracking.tracking_job.lastPollAt', 'Last polled')} value={fmt(job?.lastPollAt ?? null)} />
                <SummaryItem label={t('terminal_tracking.event.vgm', 'VGM (kg)')} value={vgm != null ? String(vgm) : '—'} />
                <SummaryItem
                  label={t('terminal_tracking.event.seals', 'Seals')}
                  value={seals && seals.length ? seals.map((s) => s.number).join(', ') : '—'}
                />
                <SummaryItem label={t('terminal_tracking.event.loadedAt', 'Loaded at')} value={fmt(loadedAt)} />
                <SummaryItem label={t('common.created', 'Created')} value={fmt(job?.createdAt ?? null)} />
              </div>

              {/* Events by leg */}
              {legs.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t('terminal_tracking.tracking_job.noEvents', 'No terminal events yet. Use "Poll now" to fetch.')}
                </div>
              ) : (
                legs.map(({ ufvGkey, events: legEvents }) => {
                  const last = legEvents[legEvents.length - 1]
                  const category = (last?.rawData?.['Category'] as string) ?? null
                  const ib = last?.visitRefIn
                  const ob = last?.visitRefOut
                  // The leg's vessel: whichever visit ref resolved to a vessel
                  // visit (import → I/B, export → O/B; land-side refs don't resolve).
                  const vesselRef = ib && vesselVisits[ib] ? ib : ob && vesselVisits[ob] ? ob : null
                  const vessel = vesselRef ? vesselVisits[vesselRef] : null
                  const voyage = vessel ? (vesselRef === ib ? vessel.ibVoyage : vessel.obVoyage) : null
                  return (
                    <div key={ufvGkey} className="rounded-lg border">
                      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs">
                        <span className="font-medium">
                          {category ?? t('terminal_tracking.tracking_job.leg', 'Facility visit')}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {t('terminal_tracking.event.ufvGkey', 'Ufv_Gkey')} {ufvGkey}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {ib ? `I/B ${ib}` : ''} {ob ? `· O/B ${ob}` : ''}
                        </span>
                      </div>

                      {/* Vessel visit (ETA/ETD/ATA/ATD from /VESSEL) */}
                      {vessel ? (
                        <div className="border-b bg-sky-50/60 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                            <Ship className="h-3.5 w-3.5 text-sky-700" />
                            <span>{vessel.vesselName ?? vessel.visitRef}</span>
                            {voyage ? <span className="text-muted-foreground">{voyage}</span> : null}
                            {vessel.line ? <span className="text-muted-foreground">· {vessel.line}</span> : null}
                            {vessel.phase ? (
                              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700">
                                {vessel.phase}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                            <VesselTime label={t('terminal_tracking.event.eta', 'ETA')} value={vessel.eta} />
                            <VesselTime label={t('terminal_tracking.event.ata', 'ATA')} value={vessel.ata} actual />
                            <VesselTime label={t('terminal_tracking.event.etd', 'ETD')} value={vessel.etd} />
                            <VesselTime label={t('terminal_tracking.event.atd', 'ATD')} value={vessel.atd} actual />
                          </div>
                        </div>
                      ) : null}

                      {/* Milestone timeline */}
                      <div className="space-y-2 p-2.5">
                        {legEvents.map((ev) => {
                          const Icon = eventIcon(ev.eventCode)
                          const Mode = modeIcon(ev.modeOfTransport)
                          return (
                            <div key={ev.id} className="flex items-start gap-3">
                              <div className="mt-0.5 rounded-full border-2 border-green-200 bg-card p-1.5">
                                <Icon className="h-4 w-4 text-green-600" />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{eventLabel(ev.eventCode)}</span>
                                  {ev.eventClassifierCode ? (
                                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                                      {ev.eventClassifierCode}
                                    </span>
                                  ) : null}
                                  {ev.transitState ? (
                                    <span className="text-[10px] text-muted-foreground">{ev.transitState}</span>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                  <span className="inline-flex items-center gap-1">
                                    <Calendar className="h-3 w-3" /> {fmt(ev.eventDateTime)}
                                  </span>
                                  {ev.vesselName ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Ship className="h-3 w-3" /> {ev.vesselName}
                                      {ev.voyageNumber ? ` ${ev.voyageNumber}` : ''}
                                    </span>
                                  ) : null}
                                  {Mode ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Mode className="h-3 w-3" /> {ev.modeOfTransport}
                                    </span>
                                  ) : null}
                                  {ev.unlocode ? <span>{ev.unlocode}</span> : null}
                                  {ev.facilityCode ? (
                                    <span>
                                      {ev.facilityCode}
                                      {ev.facilityCodeListProvider ? ` (${ev.facilityCodeListProvider})` : ''}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Full raw N4 row (non-empty fields), 2-column field grid */}
                      {(() => {
                        const rawRows = Object.entries(last?.rawData ?? {})
                          .map(([k, v]) => [k, val(v)] as [string, string])
                          .filter(([, v]) => v !== '—')
                        if (rawRows.length === 0) return null
                        return (
                          <div className="border-t px-2.5 py-2.5">
                            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              {t('terminal_tracking.event.rawData', 'Raw terminal data')}
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                              {rawRows.map(([k, v], i) => (
                                <SummaryItem key={`${k}-${i}`} label={k} value={v} />
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })
              )}

              {/* Errors */}
              {job?.errorHistory && job.errorHistory.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="text-sm font-medium text-amber-800">
                    {t('terminal_tracking.tracking_job.recentErrors', 'Recent poll errors')}
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-amber-700">
                    {job.errorHistory.slice(0, 5).map((e, i) => (
                      <li key={i}>
                        <span className="text-amber-500">{fmt(e.date)}</span> — {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="break-words text-sm font-medium">{value}</div>
    </div>
  )
}

/** One vessel timestamp cell; actual (ATA/ATD) values render emphasized. */
function VesselTime({ label, value, actual = false }: { label: string; value: string | null; actual?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xs ${actual && value ? 'font-semibold text-sky-800' : 'font-medium'}`}>
        {fmt(value)}
      </div>
    </div>
  )
}

export default ContainerDetailsDrawer
