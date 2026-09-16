'use client'

// The tracking-jobs table. Moved verbatim from
// `backend/tracking-jobs/page.tsx`, which is now a thin host over this
// component — so the page and any other host (a split-view pane, a drawer)
// render the SAME table rather than two that drift.
//
// Only the `TableHostContext` contract differs from the original page body:
// `storageScope`, `embedded`, `initialFilters`, `overflowExtras` and the hide*
// flags. Row clicks already opened a drawer rather than navigating, so nothing
// here tears a host down.
//
// Specs: .ai/specs/2026-08-04-module-table-registry.md
//        .ai/specs/2026-08-17-split-view-workspace-composition.md

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@freighttech/ui/primitives-v2'
import {
  DynamicTable,
  DynamicTableBadge,
  TableSkeleton,
  useDynamicTablePage,
} from '@freighttech/ui/backend/dynamic-table'
import type { ColumnDef, ContextMenuAction, DynamicTableBadgeVariant, TableHostContext } from '@freighttech/ui/backend/dynamic-table'
import { apiCallOrThrow } from '@freighttech/ui/backend/utils/apiCall'
import { flash } from '@freighttech/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Plus } from 'lucide-react'
import { TrackingJobDrawer } from '../../components/TrackingJobDrawer'

type TrackingJobRow = {
  id: string
  carrierCode: string
  referenceType: string
  referenceValue: string
  status: string
  nextPollAt: string | null
  lastPollAt: string | null
  retryCount: number
  createdAt: string | null
}

function mapItem(item: Record<string, unknown>): TrackingJobRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null

  return {
    id,
    carrierCode: (item.carrierCode as string) ?? (item.carrier_code as string) ?? '',
    referenceType: (item.referenceType as string) ?? (item.reference_type as string) ?? '',
    referenceValue: (item.referenceValue as string) ?? (item.reference_value as string) ?? '',
    status: (item.status as string) ?? 'active',
    nextPollAt: (item.nextPollAt as string) ?? (item.next_poll_at as string) ?? null,
    lastPollAt: (item.lastPollAt as string) ?? (item.last_poll_at as string) ?? null,
    retryCount: typeof item.retryCount === 'number' ? item.retryCount : (typeof item.retry_count === 'number' ? item.retry_count : 0),
    createdAt: (item.createdAt as string) ?? (item.created_at as string) ?? null,
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

const JOB_STATUS_VARIANTS: Record<string, DynamicTableBadgeVariant> = {
  active: 'success',
  paused: 'warning',
  deactivated: 'neutral',
  failed: 'error',
  completed: 'info',
}

/** Cancels the AppShell's page padding so the grid bleeds edge-to-edge. A host
 *  supplies its own bounds, so an embedded table must not apply it. */
const PAGE_BLEED = '-mx-4 lg:-mx-6 -mb-4 lg:-mb-6 -mt-7 lg:-mt-9'

export default function TrackingJobTable({
  storageScope = '',
  embedded = false,
  initialFilters,
  sharedFilters,
  sharedSearch,
  overflowExtras,
  hideToolbar,
  hideSearch,
  hideViews,
  hidePagination,
}: TableHostContext = {}) {
  const t = useT()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>(undefined)
  const refreshRef = useRef<() => void>(() => {})

  const handleAction = useCallback(
    async (jobId: string, action: 'pause' | 'resume' | 'deactivate') => {
      const commandMap = {
        pause: 'PUT',
        resume: 'PUT',
        deactivate: 'DELETE',
      }

      try {
        await apiCallOrThrow('/api/shipment_tracking/tracking-jobs', {
          method: commandMap[action],
          body: JSON.stringify({ id: jobId, status: action === 'resume' ? 'active' : action === 'pause' ? 'paused' : undefined }),
        })
        flash(`Job ${action}d`, 'success')
        refreshRef.current()
      } catch {
        flash(`Failed to ${action} job`, 'error')
      }
    },
    [],
  )

  const handleSync = useCallback(async (jobId: string) => {
    try {
      const result = await apiCallOrThrow('/api/shipment_tracking/tracking-jobs/sync', {
        method: 'POST',
        body: JSON.stringify({ id: jobId }),
      })
      const data = result as { newEvents?: number; shipmentsCreated?: number }
      const eventCount = data.newEvents ?? 0
      const shipmentCount = data.shipmentsCreated ?? 0
      flash(
        eventCount > 0 || shipmentCount > 0
          ? `Sync complete: ${eventCount} new event(s), ${shipmentCount} shipment(s) created`
          : 'Sync complete — no new data',
        'success',
      )
      refreshRef.current()
    } catch {
      flash('Failed to sync tracking job', 'error')
    }
  }, [])

  const columns = useMemo<ColumnDef[]>(
    () => [
      {
        data: 'referenceValue',
        title: 'Reference',
        width: 200,
        readOnly: true,
        renderer: (value: unknown, rowData: Record<string, unknown>) => (
          <div>
            <span className="font-medium font-mono text-sm tracking-wider">{String(value ?? '')}</span>
            <span className="text-xs text-muted-foreground ml-2">({String(rowData.referenceType ?? '')})</span>
          </div>
        ),
      },
      {
        data: 'carrierCode',
        title: t('shipment_tracking.tracking_jobs.fields.carrierCode', 'Carrier'),
        width: 130,
        readOnly: true,
      },
      {
        data: 'status',
        title: t('shipment_tracking.tracking_jobs.fields.status', 'Status'),
        width: 110,
        readOnly: true,
        renderer: (value: unknown) => {
          const status = String(value ?? '')
          return (
            <DynamicTableBadge variant={JOB_STATUS_VARIANTS[status] ?? 'neutral'}>
              {t(`shipment_tracking.tracking_jobs.statuses.${status}`, status)}
            </DynamicTableBadge>
          )
        },
      },
      {
        data: 'nextPollAt',
        title: t('shipment_tracking.tracking_jobs.fields.nextPollAt', 'Next Poll'),
        width: 170,
        readOnly: true,
        renderer: (value: unknown) => formatDateTime(value as string | null),
      },
      {
        data: 'lastPollAt',
        title: t('shipment_tracking.tracking_jobs.fields.lastPollAt', 'Last Poll'),
        width: 170,
        readOnly: true,
        renderer: (value: unknown) => formatDateTime(value as string | null),
      },
      {
        data: 'retryCount',
        title: t('shipment_tracking.tracking_jobs.fields.retryCount', 'Retries'),
        width: 80,
        readOnly: true,
      },
    ],
    [t],
  )

  const handleRowClick = useCallback((_rowIndex: number, rowData: Record<string, unknown>) => {
    const id = rowData?.id as string | undefined
    if (id) {
      setDrawerMode('edit')
      setSelectedJobId(id)
      setDrawerOpen(true)
    }
  }, [])

  const createButton = useMemo(
    () => (
      <Button
        variant="primary"
        size="sm"
        icon={<Plus className="h-4 w-4" />}
        onClick={() => {
          setDrawerMode('create')
          setSelectedJobId(undefined)
          setDrawerOpen(true)
        }}
      >
        {t('shipment_tracking.tracking_jobs.create', 'Create Tracking Job')}
      </Button>
    ),
    [t],
  )

  const rowActions = useCallback(
    (rowData: any): ContextMenuAction[] => {
      const id = rowData?.id as string | undefined
      const status = rowData?.status as string | undefined
      if (!id) return []

      const actions: ContextMenuAction[] = []

      if (status === 'active') {
        actions.push({ id: 'sync', label: t('shipment_tracking.tracking_jobs.actions.triggerSync', 'Trigger Sync') })
        actions.push({ id: 'pause', label: t('shipment_tracking.tracking_jobs.actions.pause', 'Pause') })
      }

      if (status === 'paused' || status === 'failed') {
        actions.push({ id: 'resume', label: t('shipment_tracking.tracking_jobs.actions.resume', 'Resume') })
      }

      if (status !== 'deactivated' && status !== 'completed') {
        actions.push({ id: 'deactivate', label: t('shipment_tracking.tracking_jobs.actions.deactivate', 'Deactivate') })
      }

      return actions
    },
    [t],
  )

  const handleRowAction = useCallback(
    (actionId: string, rowData: any) => {
      const id = rowData?.id as string | undefined
      if (!id) return
      if (actionId === 'sync') handleSync(id)
      else if (actionId === 'pause') handleAction(id, 'pause')
      else if (actionId === 'resume') handleAction(id, 'resume')
      else if (actionId === 'deactivate') handleAction(id, 'deactivate')
    },
    [handleSync, handleAction],
  )

  const table = useDynamicTablePage<TrackingJobRow>({
    source: '/api/shipment_tracking/tracking-jobs',
    // Saved views. Without this the perspective tab strip auto-hides
    // (hidePerspectiveTabs ?? !hasPerspectives), so users cannot save or
    // switch a view on this list at all.
    perspectives: 'shipment_tracking_jobs',
    columns,
    tableName: t('shipment_tracking.tracking_jobs.title', 'Tracking Jobs'),
    storageScope,
    initialFilters,
    sharedFilters,
    sharedSearch,
    defaultPageSize: 20,
    mapApiItem: mapItem,
    cellEdit: false,
    tableProps: {
      height: 'fill',
      // Opens the edit drawer — it never navigates, so it is safe inside a host
      // and stays wired in both modes.
      onRowClick: handleRowClick,
      uiConfig: {
        readOnlyStyle: 'normal',
        hideAddRowButton: true,
        searchBarEnd: createButton,
        toolbarOverflowExtras: overflowExtras,
        // Chrome the host asked to suppress, so a pane can trade toolbar rows
        // for data rows.
        hideToolbar,
        hideSearch,
        hidePerspectiveTabs: hideViews,
        hidePagination,
        // Fullscreen is a document-level overlay; in a host it would cover the
        // host itself, so it is a full-page affordance only.
        enableFullscreen: !embedded,
      },
    },
  })

  useEffect(() => {
    refreshRef.current = table.refresh
  }, [table.refresh])

  const wrapperClass = embedded ? 'h-full min-h-0' : PAGE_BLEED

  if (table.isLoading) {
    return (
      <div className={wrapperClass}>
        <TableSkeleton rows={10} columns={6} />
      </div>
    )
  }

  return (
    <div className={wrapperClass} data-table-id="shipment_tracking.tracking_job">
      <DynamicTable
        {...table.props}
        striped
        density="md"
        rowActions={rowActions}
        onRowAction={handleRowAction}
      />

      <TrackingJobDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={drawerMode}
        trackingJobId={selectedJobId}
        onSaved={() => {
          table.refresh()
        }}
      />
    </div>
  )
}
