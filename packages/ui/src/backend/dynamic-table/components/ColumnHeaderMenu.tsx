import React, { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import ReactDOM from 'react-dom';
import { ArrowUpAZ, ArrowDownZA, ArrowUp01, ArrowDown10, ArrowUpNarrowWide, ArrowDownWideNarrow, ArrowUpDown, Filter, SlidersHorizontal, Pin, PinOff, Eye, EyeOff, ArrowLeftToLine, ArrowRightToLine, ChevronDown, RotateCcw } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { ColumnDef, ContextMenuAction } from '../types/index';
import { getSortDirectionLabels } from '../types/perspective';

interface ColumnHeaderMenuProps {
  column: ColumnDef;
  colIndex: number;
  anchorRect: DOMRect;
  isFrozen: boolean;
  onSortAsc: () => void;
  /** Present only when this column is the sorted one. */
  onSortClear?: () => void;
  onSortDesc: () => void;
  /**
   * Opens the per-column quick filter (the funnel dropdown). When supplied it
   * takes the "Filter by this field" slot, and the Configure View route moves
   * down to "Advanced filter…". Omitted for a column the quick filter cannot
   * serve (a calculated column), which falls back to the old behaviour.
   */
  onQuickFilter?: () => void;
  onFilterByField: () => void;
  onFreezeToggle: () => void;
  onHideField: () => void;
  /**
   * 0.14.33 — columns the person hid (beyond the table's defaults). When there are any, the menu offers them back
   * ("Pokaż ukryte kolumny"): in a table without a toolbar this menu is the only place to do it.
   */
  hiddenColumns?: Array<{ field: string; title: string }>;
  onShowColumns?: (fields: string[]) => void;
  /** "Przywróć domyślny…" — the table's default layout (the caller asks first). */
  onResetLayout?: () => void;
  /**
   * A16 — the keyboard/menu route to column reordering. Supplied only when the
   * move is legal: `undefined` at either end of the column's pinned run, so the
   * menu never offers a move the drag would refuse.
   */
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onClose: () => void;
  extraActions?: ContextMenuAction[];
  onExtraAction?: (actionId: string) => void;
}

const ColumnHeaderMenu: React.FC<ColumnHeaderMenuProps> = ({
  column,
  colIndex,
  anchorRect,
  isFrozen,
  onSortAsc,
  onSortDesc,
  onSortClear,
  onQuickFilter,
  onFilterByField,
  onFreezeToggle,
  onHideField,
  hiddenColumns,
  onShowColumns,
  onResetLayout,
  onMoveLeft,
  onMoveRight,
  onClose,
  extraActions,
  onExtraAction,
}) => {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const hiddenCount = hiddenColumns?.length ?? 0;

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Capture phase: the grid's own mousedown handlers call stopPropagation,
    // so a bubbling listener never sees outside clicks on the table. Capture
    // fires before any stopPropagation, so the menu reliably closes.
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Position below anchor, clamped to viewport. Measured once drawn and before the browser paints: clamped in render,
  // the ref was still null on the first render and a last column's menu opened past the window's edge (G18).
  const [left, setLeft] = useState(anchorRect.left);
  useLayoutEffect(() => {
    const width = menuRef.current?.getBoundingClientRect().width ?? 0;
    setLeft(Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8)));
  }, [anchorRect.left]);
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    left,
    zIndex: 9999,
  };

  const labels = getSortDirectionLabels(column.type);
  // Match the icon to the column type so the menu reads at a glance
  // (calendar/number/text orderings all look distinct).
  const AscIcon = column.type === 'numeric' || column.type === 'date'
    ? ArrowUp01
    : column.type === 'boolean'
      ? ArrowUpNarrowWide
      : ArrowUpAZ;
  const DescIcon = column.type === 'numeric' || column.type === 'date'
    ? ArrowDown10
    : column.type === 'boolean'
      ? ArrowDownWideNarrow
      : ArrowDownZA;

  const v2cls = 'hot-appearance-v2';
  const menuContent = (
    <div ref={menuRef} className={`hot-col-menu ${v2cls}`.trim()} style={style}>
      <button className="hot-col-menu-item" onClick={() => { onSortAsc(); onClose(); }}>
        <AscIcon className="w-4 h-4" />
        <span>{t('dynamicTable.columnMenu.sort', 'Sort {direction}', { direction: labels.asc })}</span>
      </button>
      <button className="hot-col-menu-item" onClick={() => { onSortDesc(); onClose(); }}>
        <DescIcon className="w-4 h-4" />
        <span>{t('dynamicTable.columnMenu.sort', 'Sort {direction}', { direction: labels.desc })}</span>
      </button>
      {onSortClear && (
        <button className="hot-col-menu-item" onClick={() => { onSortClear(); onClose(); }} data-col-menu-sort-clear="">
          <ArrowUpDown className="w-4 h-4" />
          <span>{t('dynamicTable.columnMenu.clearSort', 'Clear sort')}</span>
        </button>
      )}
      <button
        className="hot-col-menu-item"
        onClick={() => {
          if (onQuickFilter) { onQuickFilter(); return; }
          onFilterByField();
          onClose();
        }}
      >
        <Filter className="w-4 h-4" />
        <span>{t('dynamicTable.columnMenu.filter', 'Filter by this field')}</span>
      </button>
      {onQuickFilter && (
        <button className="hot-col-menu-item" onClick={() => { onFilterByField(); onClose(); }}>
          <SlidersHorizontal className="w-4 h-4" />
          <span>{t('dynamicTable.columnMenu.advancedFilter', 'Advanced filter…')}</span>
        </button>
      )}
      <button className="hot-col-menu-item" onClick={() => { onFreezeToggle(); onClose(); }}>
        {isFrozen ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
        <span>{isFrozen ? t('dynamicTable.columnMenu.unfreeze', 'Unfreeze column') : t('dynamicTable.columnMenu.freeze', 'Freeze column')}</span>
      </button>
      <button className="hot-col-menu-item" onClick={() => { onHideField(); onClose(); }}>
        <EyeOff className="w-4 h-4" />
        <span>{t('dynamicTable.columnMenu.hide', 'Hide field')}</span>
      </button>
      {onShowColumns && hiddenCount > 0 && (
        <>
          <button
            className="hot-col-menu-item"
            aria-expanded={hiddenOpen}
            onClick={() => setHiddenOpen((open) => !open)}
            data-col-menu-show-hidden=""
          >
            <Eye className="w-4 h-4" />
            <span>{t('dynamicTable.columnMenu.showHidden', 'Show hidden columns ({count})', { count: String(hiddenCount) })}</span>
            <ChevronDown className={`ml-auto w-4 h-4 transition-transform ${hiddenOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {hiddenOpen && (
            <div className="flex flex-col pl-6" role="group" data-col-menu-hidden-list="">
              {hiddenColumns!.map((hidden) => (
                <button
                  key={hidden.field}
                  className="hot-col-menu-item"
                  onClick={() => { onShowColumns([hidden.field]); onClose(); }}
                  data-col-menu-show={hidden.field}
                >
                  <span className="min-w-0 truncate">{hidden.title}</span>
                  <span className="ml-auto shrink-0 text-[var(--m3-primary)]">{t('dynamicTable.viewChanged.show', 'Show')}</span>
                </button>
              ))}
              {hiddenCount > 1 && (
                <button
                  className="hot-col-menu-item"
                  onClick={() => { onShowColumns(hiddenColumns!.map((h) => h.field)); onClose(); }}
                  data-col-menu-show-all=""
                >
                  <span>{t('dynamicTable.viewChanged.showAll', 'Show all')}</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
      {onResetLayout && (
        <button className="hot-col-menu-item" onClick={() => { onResetLayout(); onClose(); }} data-col-menu-reset-layout="">
          <RotateCcw className="w-4 h-4" />
          <span>{t('dynamicTable.viewChanged.reset', 'Restore default…')}</span>
        </button>
      )}
      {(onMoveLeft || onMoveRight) && (
        <>
          <div className="hot-col-menu-divider" />
          <button
            className="hot-col-menu-item"
            disabled={!onMoveLeft}
            onClick={() => { onMoveLeft?.(); onClose(); }}
          >
            <ArrowLeftToLine className="w-4 h-4" />
            <span>{t('dynamicTable.columnMenu.moveLeft', 'Move left')}</span>
          </button>
          <button
            className="hot-col-menu-item"
            disabled={!onMoveRight}
            onClick={() => { onMoveRight?.(); onClose(); }}
          >
            <ArrowRightToLine className="w-4 h-4" />
            <span>{t('dynamicTable.columnMenu.moveRight', 'Move right')}</span>
          </button>
        </>
      )}

      {extraActions && extraActions.length > 0 && (
        <>
          <div className="hot-col-menu-divider" />
          {extraActions.map(action => (
            <button
              key={action.id}
              className="hot-col-menu-item"
              disabled={action.disabled}
              onClick={() => {
                onExtraAction?.(action.id);
                onClose();
              }}
            >
              <span>{action.label}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );

  if (typeof document === 'undefined') return menuContent;
  return ReactDOM.createPortal(menuContent, document.body);
};

export default ColumnHeaderMenu;
