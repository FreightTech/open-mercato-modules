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
}: TableDeleteDialogProps<TRow>) {
  const resolvedTitle = row
    ? typeof title === 'function'
      ? title(row)
      : title ?? 'Delete Item'
    : 'Delete Item'

  const resolvedDescription = row
    ? typeof description === 'function'
      ? description(row)
      : description ??
        `Are you sure you want to delete "${(row as any)[nameColumn] ?? 'this item'}"? This action cannot be undone.`
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
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
