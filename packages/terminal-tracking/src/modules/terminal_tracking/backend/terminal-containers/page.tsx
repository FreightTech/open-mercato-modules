'use client'

import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Page, PageBody } from '@freighttech/ui/backend/Page'
import { DynamicTable, TableSkeleton, useDynamicTablePage } from '@freighttech/ui/backend/dynamic-table'
import type { ColumnDef } from '@freighttech/ui/backend/dynamic-table'
import { RowActions, type RowActionItem } from '@freighttech/ui/backend/RowActions'
import { apiCallOrThrow } from '@freighttech/ui/backend/utils/apiCall'
import { flash } from '@freighttech/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@freighttech/ui/primitives/dialog'
import { Button } from '@freighttech/ui/primitives/button'
import { Input } from '@freighttech/ui/primitives/input'
import { Label } from '@freighttech/ui/primitives/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@freighttech/ui/primitives/card'
import { Loader2 } from 'lucide-react'
import { ContainerDetailsDrawer } from '../../components/ContainerDetailsDrawer'

type JobRow = {
  id: string
  terminalCode: string
  containerNumber: string
  status: string
  gateInAt: string | null
  gateOutAt: string | null
  holds: string[]
  lastPollAt: string | null
}

function mapItem(item: Record<string, unknown>): JobRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    terminalCode: (item.terminalCode as string) ?? '',
    containerNumber: (item.containerNumber as string) ?? '',
    status: (item.status as string) ?? '',
    gateInAt: (item.gateInAt as string) ?? null,
    gateOutAt: (item.gateOutAt as string) ?? null,
    holds: Array.isArray(item.holds) ? (item.holds as string[]) : [],
    lastPollAt: (item.lastPollAt as string) ?? null,
  }
}

function DateTimeCell({ value }: { value: unknown }): React.ReactElement {
  return <span className="text-sm">{value ? new Date(String(value)).toLocaleString() : '-'}</span>
}

const API = '/api/terminal_tracking/tracking-jobs'

export default function TrackingJobsPage() {
  const t = useT()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [terminalCode, setTerminalCode] = useState('')
  const [containerNumber, setContainerNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const columns = useMemo<ColumnDef[]>(
    () => [
      {
        data: 'containerNumber',
        title: t('terminal_tracking.tracking_job.containerNumber', 'Container'),
        width: 160,
        readOnly: true,
        renderer: (v: unknown) => <span className="font-medium font-mono">{String(v ?? '')}</span>,
      },
      {
        data: 'terminalCode',
        title: t('terminal_tracking.terminal_config.terminalCode', 'Terminal'),
        width: 120,
        readOnly: true,
      },
      {
        data: 'status',
        title: t('terminal_tracking.tracking_job.status', 'Status'),
        width: 110,
        readOnly: true,
      },
      {
        data: 'gateInAt',
        title: t('terminal_tracking.tracking_job.gateIn', 'Gate in'),
        width: 170,
        readOnly: true,
        renderer: (v: unknown) => <DateTimeCell value={v} />,
      },
      {
        data: 'gateOutAt',
        title: t('terminal_tracking.tracking_job.gateOut', 'Gate out'),
        width: 170,
        readOnly: true,
        renderer: (v: unknown) => <DateTimeCell value={v} />,
      },
      {
        data: 'holds',
        title: t('terminal_tracking.tracking_job.holds', 'Holds'),
        width: 220,
        readOnly: true,
        renderer: (v: unknown) => {
          const holds = Array.isArray(v) ? (v as string[]) : []
          if (!holds.length) return <span className="text-sm text-muted-foreground">-</span>
          return (
            <span className="text-sm" title={holds.join(', ')}>
              {holds.join(', ')}
            </span>
          )
        },
      },
      {
        data: 'lastPollAt',
        title: t('terminal_tracking.tracking_job.lastPollAt', 'Last polled'),
        width: 180,
        readOnly: true,
        renderer: (v: unknown) => <DateTimeCell value={v} />,
      },
    ],
    [t],
  )

  const openCreate = useCallback(() => {
    setTerminalCode('')
    setContainerNumber('')
    setDialogOpen(true)
  }, [])

  const addButton = useMemo(
    () => (
      <Button size="sm" onClick={openCreate}>
        {t('terminal_tracking.tracking_job.create', 'Track Container')}
      </Button>
    ),
    [openCreate, t],
  )

  const table = useDynamicTablePage<JobRow>({
    source: API,
    columns,
    tableName: t('terminal_tracking.tracking_job.title', 'Tracked Containers'),
    defaultPageSize: 20,
    mapApiItem: mapItem,
    cellEdit: false,
    tableProps: {
      uiConfig: {
        readOnlyStyle: 'normal',
        hideAddRowButton: true,
        topBarEnd: addButton,
      },
    },
  })

  // Grow the grid to fit its rows so the page — not the table — owns the scroll.
  // `height` sizes the WHOLE DynamicTable (toolbar + scroll area + pagination as a
  // flex column), so it must cover the chrome (~100px) plus the scroll area's own
  // content: a 37px column header + one 37px row each. Sizing to content this way
  // removes the inner scrollbar; a small row floor keeps the empty state sensible.
  const CHROME_PX = 100 // top toolbar + bottom pagination
  const ROW_PX = 37 // matches the DynamicTable virtualizer row estimate
  const rowCount = table.props.data?.length ?? 0
  const tableHeight = `${CHROME_PX + ROW_PX + Math.max(rowCount, 3) * ROW_PX}px`

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    if (!terminalCode.trim() || !containerNumber.trim()) {
      flash(t('terminal_tracking.tracking_job.validation.required', 'Terminal code and container number are required'), 'error')
      return
    }
    setSubmitting(true)
    try {
      await apiCallOrThrow(API, {
        method: 'POST',
        body: JSON.stringify({ terminalCode: terminalCode.trim(), containerNumber: containerNumber.trim() }),
      })
      flash(t('terminal_tracking.tracking_job.flash.created', 'Container is now tracked'), 'success')
      setDialogOpen(false)
      table.refresh()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to track container', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, terminalCode, containerNumber, table, t])

  const handlePoll = useCallback(
    async (id: string) => {
      try {
        const { result } = await apiCallOrThrow<{ newEvents: number; updatedEvents?: number }>(`${API}/poll`, {
          method: 'POST',
          body: JSON.stringify({ id }),
        })
        flash(
          t('terminal_tracking.tracking_job.flash.polled', 'Polled — {n} new, {u} updated event(s)')
            .replace('{n}', String(result?.newEvents ?? 0))
            .replace('{u}', String(result?.updatedEvents ?? 0)),
          'success',
        )
        table.refresh()
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Poll failed', 'error')
      }
    },
    [table, t],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm(t('terminal_tracking.tracking_job.confirmDelete', 'Stop tracking this container?'))) return
      try {
        await apiCallOrThrow(API, { method: 'DELETE', body: JSON.stringify({ id }) })
        flash(t('terminal_tracking.tracking_job.flash.deleted', 'Tracking stopped'), 'success')
        table.refresh()
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Failed to stop tracking', 'error')
      }
    },
    [table, t],
  )

  const handleDialogKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const openDetails = useCallback((id: string) => {
    setSelectedJobId(id)
    setDrawerOpen(true)
  }, [])

  const handleRowClick = useCallback(
    (_rowIndex: number, rowData: Record<string, unknown>) => {
      const id = rowData?.id as string | undefined
      if (id) openDetails(id)
    },
    [openDetails],
  )

  const actionsRenderer = useCallback(
    (rowData: { id: string }) => {
      if (!rowData?.id) return null
      const items: RowActionItem[] = [
        { label: t('terminal_tracking.tracking_job.actions.details', 'Details'), onSelect: () => openDetails(rowData.id) },
        { label: t('terminal_tracking.tracking_job.actions.poll', 'Poll now'), onSelect: () => handlePoll(rowData.id) },
        { label: t('common.delete', 'Delete'), onSelect: () => handleDelete(rowData.id), destructive: true },
      ]
      return <RowActions items={items} />
    },
    [t, openDetails, handlePoll, handleDelete],
  )

  if (table.isLoading) {
    return (
      <Page>
        <PageBody className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('terminal_tracking.tracking_job.title', 'Tracked Containers')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TableSkeleton rows={5} columns={7} />
            </CardContent>
          </Card>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('terminal_tracking.tracking_job.title', 'Tracked Containers')}</CardTitle>
            <CardDescription>
              {t('terminal_tracking.tracking_job.description', 'Containers polled at configured terminals. Use "Poll now" to fetch immediately.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DynamicTable {...table.props} height={tableHeight} actionsRenderer={actionsRenderer} onRowClick={handleRowClick} />
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md" onKeyDown={handleDialogKeyDown}>
            <DialogHeader>
              <DialogTitle>{t('terminal_tracking.tracking_job.create', 'Track Container')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="terminalCode">{t('terminal_tracking.terminal_config.terminalCode', 'Terminal code')}</Label>
                <Input id="terminalCode" value={terminalCode} autoFocus
                  onChange={(e) => setTerminalCode(e.target.value)} placeholder="bct" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="containerNumber">{t('terminal_tracking.tracking_job.containerNumber', 'Container')}</Label>
                <Input id="containerNumber" value={containerNumber}
                  onChange={(e) => setContainerNumber(e.target.value.toUpperCase())} placeholder="GCXU5598460" className="font-mono" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('common.create', 'Create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ContainerDetailsDrawer open={drawerOpen} onOpenChange={setDrawerOpen} jobId={selectedJobId} />
      </PageBody>
    </Page>
  )
}
