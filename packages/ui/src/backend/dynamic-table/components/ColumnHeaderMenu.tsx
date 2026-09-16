import React, { useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { ArrowUpAZ, ArrowDownZA, ArrowUp01, ArrowDown10, ArrowUpNarrowWide, ArrowDownWideNarrow, Filter, SlidersHorizontal, Pin, PinOff, EyeOff, ArrowLeftToLine, ArrowRightToLine } from 'lucide-react';
import { ColumnDef, ContextMenuAction } from '../types/index';
import { getSortDirectionLabels } from '../types/perspective';

interface ColumnHeaderMenuProps {
  column: ColumnDef;
  colIndex: number;
  anchorRect: DOMRect;
  isFrozen: boolean;
  onSortAsc: () => void;
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
  onQuickFilter,
  onFilterByField,
  onFreezeToggle,
  onHideField,
  onMoveLeft,
  onMoveRight,
  onClose,
  extraActions,
  onExtraAction,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Position below anchor, clamped to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
    zIndex: 9999,
  };

  // Clamp to right edge
  if (menuRef.current) {
    const menuRect = menuRef.current.getBoundingClientRect();
    if (style.left as number + menuRect.width > window.innerWidth - 8) {
      style.left = window.innerWidth - menuRect.width - 8;
    }
  }

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
        <span>Sort {labels.asc}</span>
      </button>
      <button className="hot-col-menu-item" onClick={() => { onSortDesc(); onClose(); }}>
        <DescIcon className="w-4 h-4" />
        <span>Sort {labels.desc}</span>
      </button>
      <button
        className="hot-col-menu-item"
        onClick={() => {
          if (onQuickFilter) { onQuickFilter(); return; }
          onFilterByField();
          onClose();
        }}
      >
        <Filter className="w-4 h-4" />
        <span>Filter by this field</span>
      </button>
      {onQuickFilter && (
        <button className="hot-col-menu-item" onClick={() => { onFilterByField(); onClose(); }}>
          <SlidersHorizontal className="w-4 h-4" />
          <span>Advanced filter…</span>
        </button>
      )}
      <button className="hot-col-menu-item" onClick={() => { onFreezeToggle(); onClose(); }}>
        {isFrozen ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
        <span>{isFrozen ? 'Unfreeze column' : 'Freeze column'}</span>
      </button>
      <button className="hot-col-menu-item" onClick={() => { onHideField(); onClose(); }}>
        <EyeOff className="w-4 h-4" />
        <span>Hide field</span>
      </button>
      {(onMoveLeft || onMoveRight) && (
        <>
          <div className="hot-col-menu-divider" />
          <button
            className="hot-col-menu-item"
            disabled={!onMoveLeft}
            onClick={() => { onMoveLeft?.(); onClose(); }}
          >
            <ArrowLeftToLine className="w-4 h-4" />
            <span>Move left</span>
          </button>
          <button
            className="hot-col-menu-item"
            disabled={!onMoveRight}
            onClick={() => { onMoveRight?.(); onClose(); }}
          >
            <ArrowRightToLine className="w-4 h-4" />
            <span>Move right</span>
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
