import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { LoadLookupSources, LookupSourceOption } from '../types/index';
import { LookupColumnRef } from '../types/perspective';
import { lookupColumnDataKey } from '../utils/lookupColumns';
import { Popover, PopoverTrigger, PopoverContent } from '../../../primitives/popover';

interface ConfigureViewLinkedColumnsProps {
  lookupColumns: LookupColumnRef[];
  onLookupColumnsChange: (refs: LookupColumnRef[]) => void;
  loadLookupSources: LoadLookupSources;
  /** Current column visibility. Linking a source appends its columns to the
   *  HIDDEN group (available, off by default); unlinking prunes them. */
  visibleColumns: string[];
  hiddenColumns: string[];
  onColumnVisibilityChange: (visible: string[], hidden: string[]) => void;
}

/**
 * A linked column's display name is the related table prefixed onto the field
 * label, e.g. `Contractor · Official name`. Fixed — the user never renames it.
 */
function prefixedLabel(sourceLabel: string, fieldLabel: string): string {
  return `${sourceLabel} · ${fieldLabel}`;
}

/**
 * "Linked sources": a custom multiselect of related tables. Linking a source
 * makes ALL of its columns *available* in the field list above (prefixed), but
 * switched OFF by default — the user turns on only the ones they want, like any
 * native column. Unlinking removes them. No per-field picker, no renaming.
 */
const ConfigureViewLinkedColumns: React.FC<ConfigureViewLinkedColumnsProps> = ({
  lookupColumns,
  onLookupColumnsChange,
  loadLookupSources,
  visibleColumns,
  hiddenColumns,
  onColumnVisibilityChange,
}) => {
  const t = useT();

  const [sources, setSources] = useState<LookupSourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadLookupSources()
      .then((result) => {
        if (!cancelled) setSources(result);
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadLookupSources]);

  const linkedKeys = useMemo(
    () => Array.from(new Set(lookupColumns.map((r) => r.source))),
    [lookupColumns],
  );

  const selectedSources = useMemo(
    () => sources.filter((s) => linkedKeys.includes(s.key)),
    [sources, linkedKeys],
  );

  // Reconcile the whole linked-source selection at once. Added sources contribute
  // all their columns to the hidden group; removed sources have their columns
  // pruned from both groups.
  const setLinkedSources = useCallback(
    (nextKeys: string[]) => {
      const nextSet = new Set(nextKeys);
      const currentSet = new Set(lookupColumns.map((r) => r.source));
      const added = nextKeys.filter((k) => !currentSet.has(k));
      const removed = [...currentSet].filter((k) => !nextSet.has(k));

      let refs = lookupColumns.filter((r) => nextSet.has(r.source));
      for (const key of added) {
        const src = sources.find((s) => s.key === key);
        if (!src) continue;
        refs = [
          ...refs,
          ...src.fields.map((f) => ({
            source: src.key,
            field: f.key,
            label: prefixedLabel(src.label, f.label),
          })),
        ];
      }
      onLookupColumnsChange(refs);

      const addedKeys = added.flatMap((key) => {
        const src = sources.find((s) => s.key === key);
        return src
          ? src.fields.map((f) => lookupColumnDataKey({ source: src.key, field: f.key }))
          : [];
      });
      const removedKeys = removed.flatMap((key) =>
        lookupColumns.filter((r) => r.source === key).map(lookupColumnDataKey),
      );

      onColumnVisibilityChange(
        visibleColumns.filter((k) => !removedKeys.includes(k)),
        [
          ...hiddenColumns.filter((k) => !removedKeys.includes(k)),
          ...addedKeys.filter((k) => !hiddenColumns.includes(k) && !visibleColumns.includes(k)),
        ],
      );
    },
    [lookupColumns, sources, onLookupColumnsChange, visibleColumns, hiddenColumns, onColumnVisibilityChange],
  );

  const toggleSource = useCallback(
    (key: string) => {
      setLinkedSources(
        linkedKeys.includes(key) ? linkedKeys.filter((k) => k !== key) : [...linkedKeys, key],
      );
    },
    [linkedKeys, setLinkedSources],
  );

  const countLabel = useCallback(
    (n: number) => t('dynamicTable.configureView.linkedColumnsCount', '{n} columns').replace('{n}', String(n)),
    [t],
  );

  if (loading) {
    return (
      <div className="hot-config-linked">
        <p className="hot-config-empty-hint">{t('dynamicTable.configureView.loading', 'Loading…')}</p>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="hot-config-linked">
        <p className="hot-config-empty-hint">
          {t('dynamicTable.configureView.linkedSourcesNone', 'No related tables to link to.')}
        </p>
      </div>
    );
  }

  return (
    <div className="hot-config-linked">
      <p className="hot-config-linked-hint">
        {t(
          'dynamicTable.configureView.linkedSourcesHint',
          'Link related tables. Their columns become available in the field list above (prefixed) — switch on the ones you want.',
        )}
      </p>

      {/* Selected sources as removable chips (outside the trigger to avoid
          nested interactive elements). */}
      {selectedSources.length > 0 && (
        <div className="hot-config-linked-ms-chips">
          {selectedSources.map((s) => (
            <span key={s.key} className="hot-config-linked-ms-chip">
              {s.label}
              <button
                type="button"
                aria-label={t('dynamicTable.configureView.remove', 'Remove')}
                className="hot-config-linked-ms-chip-x"
                onClick={() => toggleSource(s.key)}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="hot-config-linked-ms-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className="hot-config-linked-ms-placeholder">
              {t('dynamicTable.configureView.linkedSourcesPlaceholder', 'Add a related table…')}
            </span>
            <ChevronDown className="w-4 h-4 hot-config-linked-ms-chevron" />
          </button>
        </PopoverTrigger>
        {/* `hot-select-menu` is what makes this popover one of the grid's menus
            rather than a shadcn card: it joins the shell block in
            ContextMenu.css, so the surface, the soft outline, the 12px corner
            and the M3 elevation are the SAME declarations every other
            DynamicTable dropdown reads — a Popover default of `bg-popover` +
            `shadow-md` + an 8px corner sat pixels away from those menus inside
            the same Configure View drawer. Those sheets are imported unlayered,
            so they win over the primitive's utilities without `!important`. */}
        <PopoverContent
          align="start"
          sideOffset={4}
          className="hot-select-menu max-h-64 overflow-y-auto p-1"
          style={{ width: 'var(--radix-popover-trigger-width)' }}
        >
          {sources.map((s) => {
            const on = linkedKeys.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggleSource(s.key)}
                /* `shrink-0` is load-bearing now that the shell is a flex
                   column with a max-height: without it a long source list is
                   SQUASHED to fit instead of scrolling, exactly as
                   `.hot-select-menu-option` guards against. 8px corner is the
                   concentric radius inside the menu's 12px. */
                className="flex w-full shrink-0 items-center gap-2.5 rounded-m3-sm px-2 py-2 text-left hover:bg-[var(--m3-state-layer-hover)]"
                style={{ transition: 'var(--m3-transition-state)' }}
              >
                <span className="flex w-4 shrink-0 items-center justify-center text-[var(--m3-accent)]">
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
                {/* `text-body-medium-sm` is 14/20 at weight 500 — the exact
                    metrics of the `text-sm font-medium` it replaces, so the row
                    box does not move. */}
                <span className={`min-w-0 flex-1 truncate text-body-medium-sm ${on ? 'text-[var(--m3-accent)]' : 'text-m3-on-surface'}`}>
                  {s.label}
                </span>
                <span className="whitespace-nowrap text-body-regular-xs text-m3-on-surface-variant">
                  {countLabel(s.fields.length)}
                </span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default ConfigureViewLinkedColumns;
