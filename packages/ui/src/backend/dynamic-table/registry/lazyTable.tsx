'use client'

// Mirrors `lazyDashboardWidget` (@open-mercato/shared/modules/dashboard/widgets.ts:64):
// a cached, single-flight loader so a table's code is only fetched when a host
// actually renders it, and only once no matter how many hosts mount at the
// same moment.

import * as React from 'react'
import TableSkeleton from '../components/TableSkeleton'
import type { TableHostContext, TableLoader } from './types'

export function lazyTable(
  loader: TableLoader,
): React.ComponentType<TableHostContext> {
  let cached: React.ComponentType<TableHostContext> | null = null
  let pending: Promise<void> | null = null
  let failed: unknown = null

  const load = () => {
    if (cached) return Promise.resolve()
    if (!pending) {
      pending = loader()
        .then((mod) => {
          cached =
            (mod as { default?: React.ComponentType<TableHostContext> }).default ??
            (mod as React.ComponentType<TableHostContext>)
        })
        .catch((err) => {
          // Clear `pending` so a later mount retries rather than awaiting a
          // promise that will never resolve — a failed chunk fetch is usually
          // transient (deploy mid-session, flaky network).
          pending = null
          failed = err
          throw err
        })
    }
    return pending
  }

  const LazyTable: React.ComponentType<TableHostContext> = (props) => {
    const [, setTick] = React.useState(0)

    React.useEffect(() => {
      let cancelled = false
      void load()
        .then(() => {
          if (!cancelled) setTick((v) => v + 1)
        })
        .catch((err) => {
          if (cancelled) return
          try {
            console.error('Failed to load table component', err)
          } catch {}
          // Re-render so the failure is SHOWN. A lazy loader that swallows its
          // error leaves a permanent skeleton, which reads as "still loading"
          // forever — the one outcome worse than an error message.
          setTick((v) => v + 1)
        })
      return () => {
        cancelled = true
      }
    }, [])

    if (cached) {
      const Loaded = cached
      return <Loaded {...props} />
    }
    if (failed) {
      return (
        <div className="p-4 text-body-regular-sm" role="alert" data-table-load-error="">
          This table could not be loaded.
        </div>
      )
    }
    return <TableSkeleton rows={10} columns={5} />
  }

  LazyTable.displayName = 'LazyTable'
  return LazyTable
}
