"use client"

import * as React from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@freighttech/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type TimestampEntry = {
  value: string
  offset: string | null
  source: 'carrier_api' | 'manual' | 'ais' | 'port' | 'edi'
  updatedAt: string
  sourceEventId?: string | null
}

type CombinedEntry = TimestampEntry & {
  isActual: boolean
}

type CombinedTimestampCellProps = {
  estimatedTimestamps: TimestampEntry[] | null | undefined
  actualTimestamps: TimestampEntry[] | null | undefined
  label: 'ETD/ATD' | 'ETA/ATA'
  format?: 'date' | 'datetime'
}

const SOURCE_LABELS: Record<string, string> = {
  carrier_api: 'Carrier API',
  manual: 'Manual',
  ais: 'AIS',
  port: 'Port',
  edi: 'EDI',
}

const SOURCE_COLORS: Record<string, string> = {
  carrier_api: 'bg-blue-100 text-blue-700',
  manual: 'bg-purple-100 text-purple-700',
  ais: 'bg-green-100 text-green-700',
  port: 'bg-orange-100 text-orange-700',
  edi: 'bg-gray-100 text-gray-700',
}

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

function FormattedDate({ date }: { date: Date }) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return (
    <>
      {day}<span className="opacity-50">/</span>{month}<span className="opacity-50">/</span>{year}
    </>
  )
}

function formatTimestamp(value: string, offset: string | null, format: 'date' | 'datetime'): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  if (format === 'date') {
    return formatDate(date)
  }

  // Include time
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const dateStr = formatDate(date)
  const offsetStr = offset ? ` (${offset})` : ''
  return `${dateStr} ${timeStr}${offsetStr}`
}

function FormattedTimestamp({ value, offset, format }: { value: string; offset: string | null; format: 'date' | 'datetime' }) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return <>-</>

  if (format === 'date') {
    return <FormattedDate date={date} />
  }

  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const offsetStr = offset ? ` (${offset})` : ''
  return (
    <>
      <FormattedDate date={date} /> {timeStr}{offsetStr}
    </>
  )
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function combineTimestamps(
  estimatedTimestamps: TimestampEntry[] | null | undefined,
  actualTimestamps: TimestampEntry[] | null | undefined
): CombinedEntry[] {
  const combined: CombinedEntry[] = []

  if (estimatedTimestamps) {
    for (const entry of estimatedTimestamps) {
      combined.push({ ...entry, isActual: false })
    }
  }

  if (actualTimestamps) {
    for (const entry of actualTimestamps) {
      combined.push({ ...entry, isActual: true })
    }
  }

  return combined
}

function getLatestEntry(entries: CombinedEntry[]): CombinedEntry | null {
  if (entries.length === 0) return null
  return entries.reduce((latest, entry) =>
    entry.updatedAt > latest.updatedAt ? entry : latest
  )
}

export function CombinedTimestampCell({
  estimatedTimestamps,
  actualTimestamps,
  label,
  format = 'date',
}: CombinedTimestampCellProps) {
  const t = useT()

  const combined = combineTimestamps(estimatedTimestamps, actualTimestamps)

  if (combined.length === 0) {
    return <span className="text-muted-foreground">-</span>
  }

  const latest = getLatestEntry(combined)
  if (!latest) {
    return <span className="text-muted-foreground">-</span>
  }

  const hasHistory = combined.length > 1

  // Sort by updatedAt descending (newest first)
  const sortedHistory = [...combined].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  // Badge for estimated vs actual
  const typeBadgeClass = latest.isActual
    ? 'bg-green-100 text-green-700'
    : 'bg-gray-100 text-gray-600'
  const typeBadgeLabel = latest.isActual
    ? t('shipment_tracking.timestamps.actual', 'Actual')
    : t('shipment_tracking.timestamps.estimated', 'Est.')

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1.5 cursor-help ${hasHistory ? 'border-b border-dashed border-muted-foreground/50' : ''}`}>
            <span><FormattedTimestamp value={latest.value} offset={latest.offset} format={format} /></span>
            <span className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium ${typeBadgeClass}`}>
              {typeBadgeLabel}
            </span>
            {hasHistory && (
              <span className="text-[10px] text-muted-foreground">
                ({combined.length})
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-sm p-0">
          <div className="p-2 space-y-2">
            <div className="text-xs font-medium text-muted-foreground border-b pb-1 mb-2">
              {t(`shipment_tracking.timestamps.${label.replace('/', '_').toLowerCase()}History`, `${label} History`)}
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {sortedHistory.map((entry, index) => {
                const isLatest = entry === latest
                const entryTypeBadgeClass = entry.isActual
                  ? 'bg-green-100 text-green-700'
                  : 'bg-slate-200 text-slate-700'
                const entryTypeBadgeLabel = entry.isActual
                  ? t('shipment_tracking.timestamps.actual', 'Actual')
                  : t('shipment_tracking.timestamps.estimated', 'Est.')

                return (
                  <div
                    key={`${entry.value}-${entry.updatedAt}-${index}`}
                    className={`text-xs rounded p-1.5 ${isLatest ? 'bg-accent' : 'bg-muted'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        {formatTimestamp(entry.value, entry.offset, 'datetime')}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium ${entryTypeBadgeClass}`}>
                          {entryTypeBadgeLabel}
                        </span>
                        <span className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium ${SOURCE_COLORS[entry.source] || 'bg-gray-100 text-gray-700'}`}>
                          {SOURCE_LABELS[entry.source] || entry.source}
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t('shipment_tracking.timestamps.updatedAt', 'Updated')}: {formatUpdatedAt(entry.updatedAt)}
                      {isLatest && (
                        <span className="ml-1 text-primary font-medium">
                          ({t('shipment_tracking.timestamps.latest', 'latest')})
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default CombinedTimestampCell
