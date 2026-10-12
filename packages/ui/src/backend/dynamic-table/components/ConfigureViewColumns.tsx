import React, { useState } from 'react';
import { GripVertical, Plus, Search, X } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { ColumnDef } from '../types/index';

/**
 * The two column halves of the "Dostosuj widok" wizard — the DynamicTable's
 * version of the kartoteka's slots + catalogue (contractors `CustomizeSheet`):
 *
 *   ColumnSlots     the columns ON the view, in order — drag to reorder, × to hide
 *   ColumnCatalog   every column NOT on the view — search, + to add at the end
 *
 * Both edit through `onColumnVisibilityChange`, the same live-preview path the
 * rest of the drawer uses, so Cancel's snapshot rollback covers them.
 */

type Props = {
  columns: ColumnDef[];
  visibleColumns: string[];
  hiddenColumns: string[];
  onColumnVisibilityChange: (visible: string[], hidden: string[]) => void;
};

const titleOf = (columns: ColumnDef[], key: string) => columns.find((c) => c.data === key)?.title || key;

export function ColumnSlots({ columns, visibleColumns, hiddenColumns, onColumnVisibilityChange }: Props) {
  const t = useT();
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const hide = (key: string) =>
    onColumnVisibilityChange(visibleColumns.filter((k) => k !== key), [...hiddenColumns, key]);

  const drop = (target: string) => {
    if (dragged && dragged !== target) {
      const next = visibleColumns.filter((k) => k !== dragged);
      next.splice(next.indexOf(target), 0, dragged);
      onColumnVisibilityChange(next, hiddenColumns);
    }
    setDragged(null);
    setOver(null);
  };

  if (visibleColumns.length === 0) {
    return (
      <p className="text-body-regular-sm text-[var(--m3-on-surface-variant)]">
        {t('dynamicTable.configureView.noColumns', 'No columns — add some from the catalogue or pick a starter set.')}
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-1" data-wizard-columns="">
      {visibleColumns.map((key, index) => (
        <li
          key={key}
          draggable
          onDragStart={(e) => {
            setDragged(key);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', key);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (key !== dragged) setOver(key);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            drop(key);
          }}
          onDragEnd={() => {
            setDragged(null);
            setOver(null);
          }}
          data-wizard-column={key}
          className={[
            'flex h-9 items-center gap-2 rounded-[8px] bg-[var(--m3-surface)] pl-1.5 pr-1',
            dragged === key ? 'opacity-50' : '',
            over === key ? 'outline outline-2 outline-[var(--m3-primary)]' : '',
          ].join(' ')}
        >
          <GripVertical className="size-4 shrink-0 cursor-grab text-[var(--m3-on-surface-variant)]" aria-hidden />
          <span className="w-5 shrink-0 text-right text-label-semibold-xs tabular-nums text-[var(--m3-on-surface-variant)]">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-body-regular-sm text-[var(--m3-on-surface)]">{titleOf(columns, key)}</span>
          <button
            type="button"
            onClick={() => hide(key)}
            aria-label={t('dynamicTable.configureView.hideColumn', 'Hide column {name}', { name: titleOf(columns, key) })}
            title={t('dynamicTable.configureView.hideColumnShort', 'Hide')}
            className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--m3-on-surface-variant)] hover:bg-[var(--m3-surface-container)]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ol>
  );
}

export function ColumnCatalog({ columns, visibleColumns, hiddenColumns, onColumnVisibilityChange }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const list = hiddenColumns.filter((key) => !needle || titleOf(columns, key).toLowerCase().includes(needle));

  const show = (key: string) =>
    onColumnVisibilityChange([...visibleColumns, key], hiddenColumns.filter((k) => k !== key));

  if (hiddenColumns.length === 0) {
    return (
      <p className="text-body-regular-sm text-[var(--m3-on-surface-variant)]">
        {t('dynamicTable.configureView.catalogEmpty', 'Every column is already in the view.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {hiddenColumns.length > 6 ? (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--m3-on-surface-variant)]" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('dynamicTable.configureView.catalogSearch', 'Search columns')}
            className="h-9 w-full rounded-[8px] bg-[var(--m3-surface-container)] pl-8 pr-2 text-body-regular-sm text-[var(--m3-on-surface)] outline-none focus:outline-2 focus:outline-[var(--m3-primary)]"
          />
        </label>
      ) : null}
      <ul className="flex flex-col" data-wizard-catalog="">
        {list.map((key) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => show(key)}
              data-wizard-catalog-item={key}
              className="flex h-9 w-full items-center gap-3 rounded-[8px] px-2 text-left hover:bg-[var(--m3-surface-container)]"
            >
              <span className="min-w-0 flex-1 truncate text-body-regular-sm text-[var(--m3-on-surface)]">{titleOf(columns, key)}</span>
              <Plus className="size-4 shrink-0 text-[var(--m3-on-surface-variant)]" aria-hidden />
            </button>
          </li>
        ))}
        {list.length === 0 ? (
          <li className="px-2 py-1.5 text-body-regular-sm text-[var(--m3-on-surface-variant)]">
            {t('dynamicTable.configureView.catalogNoMatch', 'No matching columns.')}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
