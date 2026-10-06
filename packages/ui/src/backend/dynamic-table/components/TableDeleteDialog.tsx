'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../primitives/dialog'
import { Button } from '../../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface TableDeleteDialogProps<TRow = any> {
  row: TRow | null
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Ref to focus when the dialog closes */
  restoreFocusRef?: React.RefObject<HTMLElement | null>
  title?: string | ((row: TRow) => string)
  description?: string | ((row: TRow) => string)
  /** Column key to use for the row name in the default description */
  nameColumn?: string
  /** Bulk delete: `row` is `{ count }` and this names what is being deleted ("invoices"). */
  bulkNoun?: string
}

export default function TableDeleteDialog<TRow = any>({
  row,
  isDeleting,
  onConfirm,
  onCancel,
  restoreFocusRef,
  title,
  description,
  nameColumn = 'name',
  bulkNoun,
}: TableDeleteDialogProps<TRow>) {
  const t = useT()
  if (bulkNoun !== undefined && row && title === undefined && description === undefined) {
    const count = String((row as any).count ?? '')
    title = t('dynamicTable.delete.bulkTitle', 'Delete {count} {noun}').replace('{count}', count).replace('{noun}', bulkNoun).replace(/\s+/g, ' ').trim()
    description = t('dynamicTable.delete.bulkDescription', 'Are you sure you want to delete {count} selected items? This action cannot be undone.').replace('{count}', count)
  }
  const defaultTitle = t('dynamicTable.delete.title', 'Delete item')
  const resolvedTitle = row
    ? typeof title === 'function'
      ? title(row)
      : title ?? defaultTitle
    : defaultTitle

  const resolvedDescription = row
    ? typeof description === 'function'
      ? description(row)
      : description ??
        t('dynamicTable.delete.description', 'Are you sure you want to delete "{name}"? This action cannot be undone.').replace(
          '{name}',
          String((row as any)[nameColumn] ?? t('dynamicTable.delete.thisItem', 'this item')),
        )
    : ''

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="hot-dialog"
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          restoreFocusRef?.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{resolvedTitle}</DialogTitle>
          <DialogDescription>{resolvedDescription}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
            {t('dynamicTable.delete.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? t('dynamicTable.delete.deleting', 'Deleting...') : t('dynamicTable.delete.confirm', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
