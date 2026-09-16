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

type TimestampCellProps = {
  timestamps: TimestampEntry[] | null | undefined
  type: 'ETD' | 'ETA' | 'ATD' | 'ATA'
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

function formatTimestamp(value: string, offset: string | null, format: 'date' | 'datetime'): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  if (format === 'date') {
    return date.toLocaleDateString()
  }

  // Include time
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const dateStr = date.toLocaleDateString()
  const offsetStr = offset ? ` (${offset})` : ''
  return `${dateStr} ${timeStr}${offsetStr}`
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

function getLatestTimestamp(timestamps: TimestampEntry[]): TimestampEntry | null {
  if (timestamps.length === 0) return null
  return timestamps.reduce((latest, entry) =>
    entry.updatedAt > latest.updatedAt ? entry : latest
  )
}

export function TimestampCell({ timestamps, type, format = 'date' }: TimestampCellProps) {
  const t = useT()

  if (!timestamps || timestamps.length === 0) {
    return <span className="text-muted-foreground">-</span>
  }

  const latest = getLatestTimestamp(timestamps)
  if (!latest) {
    return <span className="text-muted-foreground">-</span>
  }

  const primaryValue = formatTimestamp(latest.value, latest.offset, format)
  const hasHistory = timestamps.length > 1

  // Sort by updatedAt descending (newest first)
  const sortedHistory = [...timestamps].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <span className={`cursor-help ${hasHistory ? 'border-b border-dashed border-muted-foreground/50' : ''}`}>
            {primaryValue}
            {hasHistory && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({timestamps.length})
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-sm p-0">
          <div className="p-2 space-y-2">
            <div className="text-xs font-medium text-muted-foreground border-b pb-1 mb-2">
              {t(`shipment_tracking.timestamps.${type.toLowerCase()}History`, `${type} History`)}
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {sortedHistory.map((entry, index) => {
                const isLatest = entry === latest
                return (
                  <div
                    key={`${entry.value}-${entry.updatedAt}`}
                    className={`text-xs rounded p-1.5 ${isLatest ? 'bg-accent' : 'bg-muted/50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${isLatest ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {formatTimestamp(entry.value, entry.offset, 'datetime')}
                      </span>
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_COLORS[entry.source] || 'bg-gray-100 text-gray-700'}`}>
                        {SOURCE_LABELS[entry.source] || entry.source}
                      </span>
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

export default TimestampCell
