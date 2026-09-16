'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '../../utils/apiCall'
import { flash } from '../../FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { SPLIT_LAYOUT_VERSION, normalizeLayout, type SplitLayout } from './types'

// Module routes are namespaced by module id, so this is /api/<module>/<route>.
const BASE = '/api/split_views/split-views'

export type SavedSplitLayout = {
  id: string
  name: string
  layout: SplitLayout
  layoutVersion: number
  anchorTableId: string | null
  isDefault: boolean
}

type IndexResponse = { layouts: SavedSplitLayout[]; defaultLayoutId: string | null }

export function useSplitViewLayouts(anchorTableId: string) {
  const queryClient = useQueryClient()
  // Layouts are per organization; switching org must not show the previous
  // org's saved layouts.
  const scopeVersion = useOrganizationScopeVersion()
  const queryKey = React.useMemo(
    () => ['split-view-layouts', anchorTableId, scopeVersion],
    [anchorTableId, scopeVersion],
  )

  const { data, isFetched } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiCall<IndexResponse>(
        `${BASE}?anchorTableId=${encodeURIComponent(anchorTableId)}`,
      )
      return res.ok && res.result ? res.result : { layouts: [], defaultLayoutId: null }
    },
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const save = React.useCallback(
    async (name: string, layout: SplitLayout) => {
      const res = await apiCall<{ layout: SavedSplitLayout }>(BASE, {
        method: 'POST',
        body: JSON.stringify({
          name,
          layout,
          layoutVersion: SPLIT_LAYOUT_VERSION,
          anchorTableId,
        }),
      })
      if (!res.ok) {
        flash('Could not save this layout', 'error')
        return null
      }
      flash('Layout saved', 'success')
      invalidate()
      return res.result?.layout ?? null
    },
    [anchorTableId, invalidate],
  )

  const remove = React.useCallback(
    async (id: string) => {
      const res = await apiCall<{ ok: boolean }>(`${BASE}/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        flash('Could not delete this layout', 'error')
        return false
      }
      flash('Layout deleted', 'success')
      invalidate()
      return true
    },
    [invalidate],
  )

  return {
    // v1 (flat) documents are MIGRATED rather than dropped: `normalizeLayout`
    // wraps their panes in a single split node, so a layout saved before the
    // tree existed still opens and behaves identically.
    layouts: (data?.layouts ?? []).map((saved) => ({
      ...saved,
      layout: normalizeLayout(saved.layout, anchorTableId),
    })),
    defaultLayoutId: data?.defaultLayoutId ?? null,
    isFetched,
    save,
    remove,
  }
}
