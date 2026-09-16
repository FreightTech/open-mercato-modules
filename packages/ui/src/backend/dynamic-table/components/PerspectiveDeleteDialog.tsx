'use client'

import React, { useEffect } from 'react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../primitives/dialog';
import { Button } from '../../../primitives-v2';

export interface PerspectiveDeleteDialogProps {
  /** Name of the view about to be deleted; `null` closes the dialog. */
  name: string | null;
  /**
   * `'view'` deletes a named saved view. `'baseReset'` drops this user's own
   * personalization of the "Default view" tab and falls back to the coded
   * defaults — a different thing, so it says a different thing.
   */
  variant?: 'view' | 'baseReset';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for deleting a saved view (workshop A6).
 *
 * The complaint was that the view vanished on one stray click of a bare `×`
 * next to the label. The remedy is two-part: the action moved behind the tab's
 * `⋯` menu, and it now names the view it is about to remove — an accidental
 * open of this dialog costs an `Escape`, not a rebuilt 60-column layout.
 *
 * House keyboard contract: `Cmd/Ctrl+Enter` confirms, `Escape` cancels.
 */
const PerspectiveDeleteDialog: React.FC<PerspectiveDeleteDialogProps> = ({
  name,
  variant = 'view',
  onConfirm,
  onCancel,
}) => {
  const t = useT();
  const isReset = variant === 'baseReset';

  useEffect(() => {
    if (!name) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [name, onConfirm]);

  return (
    <Dialog open={!!name} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="hot-dialog">
        <DialogHeader>
          <DialogTitle>
            {isReset
              ? t('dynamicTable.perspectives.resetTitle', 'Reset Default view')
              : t('dynamicTable.perspectives.deleteTitle', 'Delete view')}
          </DialogTitle>
          <DialogDescription>
            {isReset
              ? t(
                  'dynamicTable.perspectives.resetConfirm',
                  'Drop your own columns, sorting and filters on the Default view and go back to the standard layout? Your saved views are untouched, and nobody else is affected.',
                )
              : t(
                  'dynamicTable.perspectives.deleteConfirm',
                  'Delete the view "{name}"? Its columns, sorting and saved filters are removed for you. Other people\'s views are not affected.',
                  { name: name ?? '' },
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('dynamicTable.perspectives.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            {isReset
              ? t('dynamicTable.perspectives.resetAction', 'Reset view')
              : t('dynamicTable.perspectives.deleteAction', 'Delete view')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PerspectiveDeleteDialog;
