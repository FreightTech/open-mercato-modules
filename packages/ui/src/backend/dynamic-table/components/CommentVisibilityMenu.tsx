'use client'

/**
 * The table menu's "Comments" section (GEPARD-310, owner 17.11: "do ustawienia na poziomie ustawień konkretnej tabeli").
 * Where a comment written in THIS table shows: as the system's setting says, everywhere its information shows, or only in
 * this table and on the row it was written on. It applies to comments written from then on.
 *
 * Reads and writes the gt-fms annotations setting (`/api/annotations/settings`). A person without
 * `annotations.settings.manage` sees the value and cannot change it; a server without the endpoint shows no section.
 */

import * as React from 'react'
import { Check } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '../../utils/apiCall'
import { flash } from '../../FlashMessages'

type Visibility = 'everywhere' | 'where_added'
type Setting = { system: Visibility; table: Visibility | null; effective: Visibility; canManage: boolean }

/** A refusal or a missing endpoint is no reason to leave the page. */
const NO_REDIRECT = { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } as const

export interface CommentVisibilityMenuProps {
  /** The table's comment view context — the id its setting is kept under. */
  tableId: string
  /** The menu's own row and gutter classes, so the section reads like its neighbours. */
  rowClassName: string
  gutterClassName: string
}

export function CommentVisibilityMenu({ tableId, rowClassName, gutterClassName }: CommentVisibilityMenuProps) {
  const t = useT()
  const [setting, setSetting] = React.useState<Setting | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let live = true
    void apiCall<Setting>(`/api/annotations/settings?tableId=${encodeURIComponent(tableId)}`, { headers: NO_REDIRECT })
      .then((res) => {
        if (live && res.ok && res.result && typeof res.result.effective === 'string') setSetting(res.result)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [tableId])

  if (!setting) return null

  const choose = async (value: Visibility | null) => {
    if (!setting.canManage || saving || setting.table === value) return
    setSaving(true)
    try {
      const res = await apiCall<Setting>('/api/annotations/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...NO_REDIRECT },
        body: JSON.stringify({ tableId, visibility: value }),
      })
      if (res.ok && res.result) setSetting(res.result)
      else flash(t('dynamicTable.comments.visibility.notSaved', 'The comment setting was not saved'), 'error')
    } catch {
      flash(t('dynamicTable.comments.visibility.notSaved', 'The comment setting was not saved'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const label = (v: Visibility) =>
    v === 'where_added'
      ? t('dynamicTable.comments.visibility.whereAdded', 'Only in this table and row')
      : t('dynamicTable.comments.visibility.everywhere', 'Shown everywhere')
  const options: Array<{ value: Visibility | null; label: string }> = [
    { value: null, label: t('dynamicTable.comments.visibility.asSystem', 'As in the settings: {value}', { value: label(setting.system) }) },
    { value: 'everywhere', label: label('everywhere') },
    { value: 'where_added', label: label('where_added') },
  ]
  const readOnlyHint = setting.canManage ? undefined : t('dynamicTable.comments.visibility.readOnly', 'Changed by an administrator')

  return (
    <div data-comment-visibility-menu="">
      <div className="mx-2 my-1 border-t border-[var(--m3-outline-faint)]" />
      <div className="px-2 pb-1 pt-1.5 text-label-semibold-2xs uppercase text-[var(--m3-on-surface-variant)]">
        {t('dynamicTable.comments.visibility.label', 'Comments')}
      </div>
      <div className="px-1 pb-1" role="group" aria-label={t('dynamicTable.comments.visibility.label', 'Comments')}>
        {options.map((option) => (
          <button
            key={option.value ?? 'system'}
            type="button"
            role="menuitemradio"
            aria-checked={setting.table === option.value}
            disabled={!setting.canManage || saving}
            onClick={() => void choose(option.value)}
            className={rowClassName}
            title={readOnlyHint}
            data-comment-visibility-option={option.value ?? 'system'}
          >
            <span className={gutterClassName}>
              {setting.table === option.value ? <Check className="h-3.5 w-3.5 text-[var(--m3-on-surface)]" aria-hidden="true" /> : null}
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default CommentVisibilityMenu
