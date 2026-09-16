'use client';

import React from 'react';
import { Trash2, Copy } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import type { BulkActionConfig } from '../types/index';
import type { ExportFormat } from '../utils/exportTable';
import ExportMenu from './ExportMenu';

export interface BulkActionsBarProps {
  /** Number of currently selected rows. */
  count: number;
  /** Disables the actions while a bulk operation is in flight. */
  busy?: boolean;
  /** Copy the selected rows to the clipboard (TSV). Available for every table. */
  onCopy: () => void;
  /**
   * Run the batch delete over the selected rows. Optional — some tables don't
   * support deletion, in which case the Delete action is hidden (Copy stays).
   */
  onDelete?: () => void;
  /**
   * Export the selected rows to CSV/Excel. Optional — omitted when the table
   * disables export, in which case the Export action is hidden.
   */
  onExport?: (format: ExportFormat) => void;
  /** Clear the whole selection (deselect all). */
  onClear: () => void;
  /** Per-table custom batch actions, appended after Copy/Delete. */
  actions?: BulkActionConfig[];
  /** The currently-selected row ids — passed to each custom action's callbacks. */
  selectedIds?: string[];
}

/**
 * Grouped-actions bar (Figma Frame 546:12289). Sits below the perspective tabs
 * and above the column headers; shown whenever ≥1 row is selected. Carries Copy
 * (always) and Delete (when supported), plus the count + deselect-all.
 */
const BulkActionsBar: React.FC<BulkActionsBarProps> = ({ count, busy, onCopy, onDelete, onExport, onClear, actions, selectedIds }) => {
  const t = useT();
  const ids = selectedIds ?? [];
  return (
    <div className="hot-bulk-bar" role="toolbar" aria-label={t('dynamicTable.bulk.ariaLabel', 'Bulk actions')}>
      <input
        type="checkbox"
        className="hot-row-select hot-bulk-bar-checkbox"
        checked
        readOnly
        onClick={onClear}
        aria-label={t('dynamicTable.bulk.clear', 'Deselect all')}
      />
      <span className="hot-bulk-bar-count">
        {count} {t('dynamicTable.bulk.selected', 'selected')}
      </span>
      <button type="button" className="hot-bulk-bar-action" onClick={onCopy} disabled={busy}>
        <Copy size={12} aria-hidden="true" />
        <span>{t('dynamicTable.bulk.copy', 'Copy')}</span>
      </button>
      {onExport && <ExportMenu variant="bulk" onExport={onExport} disabled={busy} />}
      {onDelete && (
        <button type="button" className="hot-bulk-bar-action" onClick={onDelete} disabled={busy}>
          <Trash2 size={12} aria-hidden="true" />
          <span>{t('dynamicTable.bulk.delete', 'Delete')}</span>
        </button>
      )}
      {actions?.map((action) => (
        <button
          key={action.id}
          type="button"
          className="hot-bulk-bar-action"
          onClick={() => action.onClick(ids)}
          disabled={busy || action.disabled?.(ids)}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
      <div className="hot-bulk-bar-spacer" />
      <button type="button" className="hot-bulk-bar-clear" onClick={onClear} disabled={busy}>
        {t('dynamicTable.bulk.clear', 'Deselect all')}
      </button>
    </div>
  );
};

BulkActionsBar.displayName = 'BulkActionsBar';

export default BulkActionsBar;
