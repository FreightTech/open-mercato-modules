'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context';
import type { BulkActionConfig } from '../types/index';

/**
 * "selected" agreeing with the count: Polish says 1 zaznaczony, 2 zaznaczone,
 * 5 zaznaczonych — one word for every count read "1 zaznaczonych". The plural
 * category comes from Intl.PluralRules; a locale without a form for it falls
 * back to the plain `selected` key.
 */
function selectedWord(t: (key: string, fallback?: string) => string, locale: string | null | undefined, count: number): string {
  let category: string = 'other';
  try {
    category = new Intl.PluralRules(locale || 'en').select(count);
  } catch {
    // An unknown locale tag: keep "other".
  }
  const plain = t('dynamicTable.bulk.selected', 'selected');
  const key = category === 'one' ? 'selectedOne' : category === 'few' ? 'selectedFew' : category === 'many' ? 'selectedMany' : null;
  return key ? t(`dynamicTable.bulk.${key}`, plain) : plain;
}

export interface BulkActionsBarProps {
  /** Number of currently selected rows. */
  count: number;
  /** Disables the actions while a bulk operation is in flight. */
  busy?: boolean;
  /**
   * Run the batch delete over the selected rows. Present only when the table
   * defines `onBulkDelete`.
   */
  onDelete?: () => void;
  /** Clear the whole selection (deselect all). */
  onClear: () => void;
  /** Per-table batch actions (`uiConfig.bulkActions`), after Delete. */
  actions?: BulkActionConfig[];
  /** The currently-selected row ids — passed to each custom action's callbacks. */
  selectedIds?: string[];
}

/**
 * Grouped-actions bar. Sits below the perspective tabs and above the column
 * headers while rows are selected. It carries only the actions the table
 * defines in code (Delete via `onBulkDelete`, plus `uiConfig.bulkActions`);
 * DynamicTable does not render it at all for a table that defines none. The
 * leading checkbox clears the selection.
 */
const BulkActionsBar: React.FC<BulkActionsBarProps> = ({ count, busy, onDelete, onClear, actions, selectedIds }) => {
  const t = useT();
  const locale = useLocale();
  const ids = selectedIds ?? [];
  return (
    <div className="hot-bulk-bar" role="toolbar" aria-label={t('dynamicTable.bulk.ariaLabel', 'Bulk actions')}>
      <input
        type="checkbox"
        className="hot-row-select hot-bulk-bar-checkbox"
        checked
        readOnly
        onClick={onClear}
        disabled={busy}
        aria-label={t('dynamicTable.bulk.clear', 'Deselect all')}
        title={t('dynamicTable.bulk.clear', 'Deselect all')}
      />
      <span className="hot-bulk-bar-count">
        {count} {selectedWord(t, locale, count)}
      </span>
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
    </div>
  );
};

BulkActionsBar.displayName = 'BulkActionsBar';

export default BulkActionsBar;
