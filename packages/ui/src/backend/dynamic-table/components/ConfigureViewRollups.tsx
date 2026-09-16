import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import SelectMenu from './SelectMenu';
import type {
  LoadRollupSources,
  RollupColumnRef,
  RollupFn,
  RollupSourceOption,
} from '../types/rollup';
import { MAX_ROLLUP_COLUMNS, ROLLUP_COUNT_FIELD } from '../types/rollup';
import { rollupColumnDataKey } from '../utils/rollupColumns';

export interface ConfigureViewRollupsProps {
  rollupColumns: RollupColumnRef[];
  onRollupColumnsChange: (refs: RollupColumnRef[]) => void;
  loadRollupSources: LoadRollupSources;
  /** Current column visibility. Adding a summarised column shows it straight
   *  away; removing one prunes it from both groups. */
  visibleColumns: string[];
  hiddenColumns: string[];
  onColumnVisibilityChange: (visible: string[], hidden: string[]) => void;
}

/**
 * "Summarised columns" — one row per column, chosen in three steps:
 * **source → field → function**.
 *
 * WHY NOT THE LINKED-COLUMNS PATTERN. Linking a lookup source adds one column
 * per field, so "add them all, hidden, let the user switch on what they want"
 * is honest. A rollup multiplies field × function: the folders `lines` source
 * alone is 2 fields × 4 functions + 1 × 1 + count = **ten** columns. Dumping
 * ten hidden columns per source and calling it "three columns became available"
 * is how a field list becomes unreadable. So the user names the ONE aggregate
 * they want, and gets exactly one column.
 *
 * Laid out as `hot-config-filter-row` — the same row shape the filter and
 * highlighting editors use — because the drawer already teaches that
 * interaction. This is composition, not new UX.
 */
const ConfigureViewRollups: React.FC<ConfigureViewRollupsProps> = ({
  rollupColumns,
  onRollupColumnsChange,
  loadRollupSources,
  visibleColumns,
  hiddenColumns,
  onColumnVisibilityChange,
}) => {
  const t = useT();

  const [sources, setSources] = useState<RollupSourceOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRollupSources()
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
  }, [loadRollupSources]);

  const fnLabel = useCallback(
    (fn: RollupFn) => t(`dynamicTable.rollup.fn.${fn}`, DEFAULT_FN_LABELS[fn]),
    [t],
  );

  /**
   * The header a column carries. Stored ON the ref rather than recomputed at
   * render time, so a saved view still reads correctly on a page that has not
   * loaded the source registry (or after a source is retired).
   */
  const labelFor = useCallback(
    (source: RollupSourceOption, field: string, fn: RollupFn): string => {
      if (fn === 'count') {
        // "Documents · Documents" reads as a stutter — a source whose count
        // noun already repeats its own name gets the bare label.
        return source.countLabel === source.label
          ? source.label
          : `${source.label} · ${source.countLabel}`;
      }
      const f = source.fields.find((x) => x.key === field);
      return `${source.label} · ${fnLabel(fn)} ${f?.label ?? field}`;
    },
    [fnLabel],
  );

  /** Field choices for a source: the always-available count, then its fields. */
  const fieldOptions = useCallback(
    (source: RollupSourceOption | undefined) => {
      if (!source) return [];
      return [
        {
          value: ROLLUP_COUNT_FIELD,
          label: t('dynamicTable.rollup.recordCount', 'Number of records'),
        },
        ...source.fields.map((f) => ({ value: f.key, label: f.label })),
      ];
    },
    [t],
  );

  /** Functions legal for (source, field). COUNT is the only one over records. */
  const fnOptions = useCallback(
    (source: RollupSourceOption | undefined, field: string): RollupFn[] => {
      if (field === ROLLUP_COUNT_FIELD) return ['count'];
      const f = source?.fields.find((x) => x.key === field);
      return f ? f.fns : [];
    },
    [],
  );

  /** Rewrite the visible-column list so `oldKey` becomes `newKey` in place.
   *  Keeping the position matters: the column does not jump when the user
   *  changes the function on a column they have already placed. */
  const swapColumnKey = useCallback(
    (oldKey: string | null, newKey: string | null) => {
      const replaceIn = (list: string[]) => {
        if (!oldKey) return list;
        return newKey ? list.map((k) => (k === oldKey ? newKey : k)) : list.filter((k) => k !== oldKey);
      };
      let nextVisible = replaceIn(visibleColumns);
      let nextHidden = replaceIn(hiddenColumns);
      if (newKey && !oldKey) {
        // Brand-new column: SHOW it. The user just named this exact aggregate —
        // adding it hidden would make them go and find it in another section.
        if (!nextVisible.includes(newKey)) nextVisible = [...nextVisible, newKey];
        nextHidden = nextHidden.filter((k) => k !== newKey);
      }
      onColumnVisibilityChange(nextVisible, nextHidden);
    },
    [visibleColumns, hiddenColumns, onColumnVisibilityChange],
  );

  const keys = useMemo(() => rollupColumns.map((r) => rollupColumnDataKey(r)), [rollupColumns]);

  /**
   * Replace the ref at `index`. A change that would duplicate a column already
   * in the view is refused rather than silently collapsing two rows into one
   * key (which would leave a row editing a column that is not there).
   */
  const updateRef = useCallback(
    (index: number, patch: Partial<RollupColumnRef>) => {
      const current = rollupColumns[index];
      if (!current) return;
      const merged = { ...current, ...patch };
      const source = sources.find((s) => s.key === merged.source);

      // Snap field/fn back to something legal whenever the source changes.
      if (patch.source && patch.source !== current.source) {
        merged.field = ROLLUP_COUNT_FIELD;
        merged.fn = 'count';
      }
      if (patch.field && patch.field !== current.field) {
        const legal = fnOptions(source, merged.field);
        if (!legal.includes(merged.fn)) merged.fn = legal[0] ?? 'count';
      }
      if (!source) return;
      merged.label = labelFor(source, merged.field, merged.fn);

      const oldKey = rollupColumnDataKey(current);
      const newKey = rollupColumnDataKey(merged);
      if (oldKey !== newKey && keys.includes(newKey)) return;

      const next = rollupColumns.map((r, i) => (i === index ? merged : r));
      onRollupColumnsChange(next);
      if (oldKey !== newKey) swapColumnKey(oldKey, newKey);
    },
    [rollupColumns, sources, keys, fnOptions, labelFor, onRollupColumnsChange, swapColumnKey],
  );

  const removeRef = useCallback(
    (index: number) => {
      const current = rollupColumns[index];
      if (!current) return;
      onRollupColumnsChange(rollupColumns.filter((_, i) => i !== index));
      swapColumnKey(rollupColumnDataKey(current), null);
    },
    [rollupColumns, onRollupColumnsChange, swapColumnKey],
  );

  /**
   * Add the first aggregate not already in the view, scanning sources in
   * declaration order (count first, then each field × each of its functions).
   * "Add" must never be a no-op that looks like a broken button.
   */
  const addRef = useCallback(() => {
    if (rollupColumns.length >= MAX_ROLLUP_COLUMNS) return;
    const taken = new Set(keys);
    for (const source of sources) {
      const candidates: Array<{ field: string; fn: RollupFn }> = [
        { field: ROLLUP_COUNT_FIELD, fn: 'count' },
        ...source.fields.flatMap((f) => f.fns.map((fn) => ({ field: f.key, fn: fn as RollupFn }))),
      ];
      for (const c of candidates) {
        const key = rollupColumnDataKey({ source: source.key, ...c });
        if (taken.has(key)) continue;
        const ref: RollupColumnRef = {
          source: source.key,
          field: c.field,
          fn: c.fn,
          label: labelFor(source, c.field, c.fn),
        };
        onRollupColumnsChange([...rollupColumns, ref]);
        swapColumnKey(null, key);
        return;
      }
    }
  }, [rollupColumns, keys, sources, labelFor, onRollupColumnsChange, swapColumnKey]);

  /** True when every legal aggregate is already in the view. */
  const exhausted = useMemo(() => {
    const taken = new Set(keys);
    for (const source of sources) {
      const candidates: Array<{ field: string; fn: RollupFn }> = [
        { field: ROLLUP_COUNT_FIELD, fn: 'count' },
        ...source.fields.flatMap((f) => f.fns.map((fn) => ({ field: f.key, fn: fn as RollupFn }))),
      ];
      if (candidates.some((c) => !taken.has(rollupColumnDataKey({ source: source.key, ...c })))) {
        return false;
      }
    }
    return true;
  }, [keys, sources]);

  if (loading) {
    return (
      <div className="hot-config-section-body">
        <p className="hot-config-empty-hint">{t('dynamicTable.configureView.loading', 'Loading…')}</p>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="hot-config-section-body">
        <p className="hot-config-empty-hint">
          {t(
            'dynamicTable.configureView.rollupSourcesNone',
            'Nothing on this table can be summarised yet.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="hot-config-filters" data-rollup-editor>
      <p className="hot-config-linked-hint">
        {t(
          'dynamicTable.configureView.rollupHint',
          'Summarise the records linked to each row — how many there are, or a total of one of their amounts.',
        )}
      </p>

      {rollupColumns.length > 0 && (
        <div className="hot-config-sorting-header">
          <span className="hot-config-sorting-header-label">
            {t('dynamicTable.configureView.rollupColumns', 'Summarised columns')}
          </span>
          <button
            onClick={() => {
              for (const key of keys) swapColumnKey(key, null);
              onRollupColumnsChange([]);
            }}
            className="hot-config-clear-btn"
          >
            {t('dynamicTable.configureView.clearAll', 'Clear all')}
          </button>
        </div>
      )}

      {rollupColumns.map((ref, index) => {
        const source = sources.find((s) => s.key === ref.source);
        const fns = fnOptions(source, ref.field);
        return (
          <div
            key={rollupColumnDataKey(ref)}
            className="hot-config-filter-row"
            data-rollup-row={rollupColumnDataKey(ref)}
          >
            <SelectMenu
              value={ref.source}
              onChange={(next) => updateRef(index, { source: next })}
              options={sources.map((s) => ({ value: s.key, label: s.label }))}
              className="hot-config-filter-select"
              ariaLabel={t('dynamicTable.configureView.rollupSource', 'Related records')}
              dataAttributes={{ 'data-rollup-source': true }}
            />

            <SelectMenu
              value={ref.field}
              onChange={(next) => updateRef(index, { field: next })}
              options={fieldOptions(source)}
              className="hot-config-filter-select"
              ariaLabel={t('dynamicTable.configureView.rollupField', 'What to summarise')}
              dataAttributes={{ 'data-rollup-field': true }}
            />

            {/* One legal function means there is nothing to choose. The control
                stays on screen — disabled, showing what WILL be used — because
                removing it would make the three-step row change shape row by
                row, and a shifting layout reads as a glitch. */}
            <SelectMenu
              value={ref.fn}
              onChange={(next) => updateRef(index, { fn: next as RollupFn })}
              options={fns.map((fn) => ({ value: fn, label: fnLabel(fn) }))}
              disabled={fns.length <= 1}
              className="hot-config-filter-select hot-config-filter-operator"
              ariaLabel={t('dynamicTable.configureView.rollupFn', 'Function')}
              dataAttributes={{ 'data-rollup-fn': true }}
            />

            <button
              onClick={() => removeRef(index)}
              className="hot-config-filter-remove"
              aria-label={t('dynamicTable.configureView.remove', 'Remove')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      <button
        onClick={addRef}
        disabled={exhausted || rollupColumns.length >= MAX_ROLLUP_COLUMNS}
        className="hot-config-add-btn"
        data-rollup-add
      >
        <Plus className="w-3.5 h-3.5" aria-hidden />
        {t('dynamicTable.configureView.rollupAdd', 'Add summarised column')}
      </button>

      {rollupColumns.length >= MAX_ROLLUP_COLUMNS && (
        <p className="hot-config-filters-label">
          {t('dynamicTable.configureView.rollupLimitReached', 'Column limit reached ({max})', {
            max: MAX_ROLLUP_COLUMNS,
          })}
        </p>
      )}
    </div>
  );
};

/** English fallbacks. `count` names the thing, the rest name the operation. */
const DEFAULT_FN_LABELS: Record<RollupFn, string> = {
  count: 'Count',
  sum: 'Sum of',
  avg: 'Average of',
  min: 'Min of',
  max: 'Max of',
};

export default ConfigureViewRollups;
