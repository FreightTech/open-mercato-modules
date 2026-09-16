'use client'

import React, { useEffect, useState } from 'react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../primitives/dialog';
import { Button, Checkbox } from '../../../primitives-v2';
import type { PerspectiveConfig } from '../types/perspective';

export interface PerspectivePublishDialogProps {
  /** The view being published; `null` closes the dialog. */
  perspective: PerspectiveConfig | null;
  /** Roles the publisher may share with. */
  roles: Array<{ id: string; name: string }>;
  onConfirm: (roleIds: string[]) => void;
  onCancel: () => void;
}

/**
 * "Publish as shared template" (personalization decision, 3 Aug 2026).
 *
 * Everything a user configures is PRIVATE by default. This dialog is the single
 * deliberate step that makes a layout available to colleagues — and even then it
 * is available to COPY, not applied. The copy explains that in one sentence,
 * because the recorded incident (A3) was a user discovering *after the fact*
 * that her change had reached everyone: „Czyli jak tu porobiłam, to porobiłam
 * wszystkim?" The answer here is visibly no.
 *
 * Roles are the audience because that is what the perspectives API already
 * scopes shared views by — no new entity, no new endpoint, and the same ACL
 * feature (`perspectives.role_defaults`) already guards the write.
 *
 * House keyboard contract: `Cmd/Ctrl+Enter` confirms, `Escape` cancels.
 */
const PerspectivePublishDialog: React.FC<PerspectivePublishDialogProps> = ({
  perspective,
  roles,
  onConfirm,
  onCancel,
}) => {
  const t = useT();
  const [selected, setSelected] = useState<string[]>([]);

  // Pre-select whatever the view is already published to, so re-publishing
  // after an edit is one click and cannot silently narrow the audience.
  useEffect(() => {
    if (!perspective) return;
    setSelected(perspective.publication?.roleIds ?? []);
  }, [perspective]);

  const canConfirm = selected.length > 0;

  useEffect(() => {
    if (!perspective) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canConfirm) {
        e.preventDefault();
        onConfirm(selected);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [perspective, canConfirm, selected, onConfirm]);

  const toggle = (roleId: string) => {
    setSelected((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  };

  const allSelected = roles.length > 0 && selected.length === roles.length;

  return (
    <Dialog open={!!perspective} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="hot-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('dynamicTable.perspectives.publishTitle', 'Share as a template')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'dynamicTable.perspectives.publishDescription',
              'Colleagues can copy "{name}" into their own views. Nobody\'s screen changes until they do, and their copy is theirs to edit.',
              { name: perspective?.name ?? '' },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="flex items-center justify-between">
            <span className="text-body-medium-sm text-foreground-v2">
              {t('dynamicTable.perspectives.publishAudience', 'Who can copy it')}
            </span>
            {roles.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(allSelected ? [] : roles.map((r) => r.id))}
              >
                {allSelected
                  ? t('dynamicTable.perspectives.publishNone', 'Clear all')
                  : t('dynamicTable.perspectives.publishAll', 'Select all')}
              </Button>
            )}
          </div>

          {roles.length === 0 ? (
            <p className="text-body-regular-sm text-muted-v2-foreground">
              {t(
                'dynamicTable.perspectives.publishNoRoles',
                'There are no roles you can share with.',
              )}
            </p>
          ) : (
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {roles.map((role) => (
                <Checkbox
                  key={role.id}
                  label={role.name}
                  checked={selected.includes(role.id)}
                  onChange={() => toggle(role.id)}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('dynamicTable.perspectives.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canConfirm}
            onClick={() => onConfirm(selected)}
          >
            {t('dynamicTable.perspectives.publishAction', 'Share template')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PerspectivePublishDialog;
