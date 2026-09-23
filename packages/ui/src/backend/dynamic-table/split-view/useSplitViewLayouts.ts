'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '../../utils/apiCall'
import { flash } from '../../FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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
  /**
   * Set on a copy a colleague shared with this user: who sent it. The copy is
   * the recipient's own from then on — editing or deleting it never touches
   * the sender's original.
   */
  sharedByName?: string | null
  sharedAt?: string | null
}

type IndexResponse = { layouts: SavedSplitLayout[]; defaultLayoutId: string | null }

export function useSplitViewLayouts(anchorTableId: string) {
  const t = useT()
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
        flash(t('splitView.layouts.saveFailed', 'Could not save this layout'), 'error')
        return null
      }
      flash(t('splitView.layouts.saved', 'Layout saved'), 'success')
      invalidate()
      return res.result?.layout ?? null
    },
    [anchorTableId, invalidate, t],
  )

  const remove = React.useCallback(
    async (id: string) => {
      const res = await apiCall<{ ok: boolean }>(`${BASE}/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        flash(t('splitView.layouts.deleteFailed', 'Could not delete this layout'), 'error')
        return false
      }
      flash(t('splitView.layouts.deleted', 'Layout deleted'), 'success')
      invalidate()
      return true
    },
    [invalidate, t],
  )

  const rename = React.useCallback(
    async (id: string, name: string) => {
      const res = await apiCall<{ layout: SavedSplitLayout }>(`${BASE}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        flash(t('splitView.layouts.renameFailed', 'Could not rename this layout'), 'error')
        return false
      }
      invalidate()
      return true
    },
    [invalidate, t],
  )

  /** Overwrite a saved layout with what is on screen now. */
  const update = React.useCallback(
    async (id: string, layout: SplitLayout) => {
      const res = await apiCall<{ layout: SavedSplitLayout }>(`${BASE}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ layout, layoutVersion: SPLIT_LAYOUT_VERSION }),
      })
      if (!res.ok) {
        flash(t('splitView.layouts.saveFailed', 'Could not save this layout'), 'error')
        return false
      }
      flash(t('splitView.layouts.saved', 'Layout saved'), 'success')
      invalidate()
      return true
    },
    [invalidate, t],
  )

  /**
   * Send a COPY of a saved layout to colleagues. Each recipient gets their own
   * row they can apply, rename or delete; the sender's layout is untouched.
   */
  const share = React.useCallback(
    async (id: string, userIds: string[]) => {
      const res = await apiCall<{ shared: number }>(`${BASE}/${id}/share`, {
        method: 'POST',
        // The page the recipient's notification opens — the one this layout
        // belongs to, which is the page the user is on.
        body: JSON.stringify({
          userIds,
          linkHref: typeof window !== 'undefined' ? window.location.pathname : undefined,
        }),
      })
      if (!res.ok) {
        flash(t('splitView.share.failed', 'Could not share this layout'), 'error')
        return 0
      }
      const count = res.result?.shared ?? userIds.length
      flash(t('splitView.share.done', 'Shared with {count}', { count: String(count) }), 'success')
      return count
    },
    [t],
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
    rename,
    update,
    share,
  }
}
