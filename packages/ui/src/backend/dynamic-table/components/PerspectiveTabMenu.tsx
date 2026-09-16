import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Pencil, SlidersHorizontal, Copy, Star, Trash2, Share2, Link2 } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { computeAnchoredPosition, type AnchoredPlacement } from '../utils/anchoredPosition';

export interface PerspectiveTabMenuProps {
  /** The tab button this menu hangs off — the rect is re-read on open. */
  anchorRect: DOMRect;
  /** Name of the view the menu acts on (used in the ARIA label). */
  perspectiveName: string;
  /** True when this view is already the user's default. */
  isDefault: boolean;
  /** Omit to hide "Rename view" — the base ("Default view") tab cannot be renamed. */
  onRename?: () => void;
  /** Omit to hide "Duplicate view" (host has no copy handler). */
  onDuplicate?: () => void;
  /** Omit to hide "Set as my default" (host has no per-user default handler). */
  onSetDefault?: () => void;
  /**
   * Omit to hide "Share as template…" — the host omits it when the server says
   * this user lacks `perspectives.role_defaults`, so the affordance is absent
   * exactly when the write would be refused.
   */
  onPublish?: () => void;
  /** True when this view is already published as a shared template. */
  isPublished?: boolean;
  /** Name of the shared template this view was copied from, when it was. */
  originTemplateName?: string | null;
  /** Omit to hide the destructive row entirely. */
  onDelete?: () => void;
  /** Overrides the destructive row's label (the base tab RESETS rather than deletes). */
  deleteLabel?: string;
  onEditView?: () => void;
  onClose: () => void;
}

/**
 * The `⋯` menu on a saved-view tab (workshop A6).
 *
 * Deleting a view used to be a bare `×` sitting one pixel from the tab label —
 * "zbyt łatwo go tu można usunąć". Every view action now lives behind this one
 * trigger, with Delete last and visually separated, and Delete itself still
 * asks for confirmation.
 *
 * Structure and CSS are the SAME as `ColumnHeaderMenu` (`.hot-col-menu`) so the
 * two menus in the grid read as one component, not two.
 */
const PerspectiveTabMenu: React.FC<PerspectiveTabMenuProps> = ({
  anchorRect,
  perspectiveName,
  isDefault,
  onRename,
  onDuplicate,
  onSetDefault,
  onPublish,
  isPublished = false,
  originTemplateName,
  onDelete,
  deleteLabel,
  onEditView,
  onClose,
}) => {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<AnchoredPlacement | null>(null);

  // Measured, not guessed. The old code clamped against a hardcoded 210px while
  // the widest row ("Update shared template…") renders well past that, so the
  // clamp let the menu hang off the right edge exactly when it was widest.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    setPlacement(
      computeAnchoredPosition(
        anchorRect,
        { width: window.innerWidth, height: window.innerHeight },
        { width: el.offsetWidth, preferredHeight: el.offsetHeight, minHeight: 120 },
      ),
    );
  }, [anchorRect]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    // CAPTURE + stopPropagation, matching every other dropdown in the grid.
    // A bubbling listener let the same Escape ALSO reach the grid's global
    // handler, so dismissing this menu cleared the user's cell selection as a
    // side effect.
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    // The menu is `position: fixed` off a rect read once at open time, so any
    // scroll leaves it floating detached from the tab it belongs to. Both
    // reference dropdowns (CostLinePicker, InlineSelect) close instead.
    const handleScroll = () => onClose();
    // Capture phase — the tab strip's own mousedown handlers call
    // stopPropagation, so a bubbling listener would never see the outside click.
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    top: placement ? placement.top : anchorRect.bottom + 4,
    left: placement ? placement.left : anchorRect.left,
    maxHeight: placement?.maxHeight,
    overflowY: 'auto',
    zIndex: 9999,
    // First paint happens before the menu can be measured. Hiding that one
    // frame avoids a visible jump from the unclamped position to the clamped
    // one; `visibility` (not `display`) keeps it measurable.
    ...(placement ? {} : { visibility: 'hidden' as const }),
    ...(placement?.flipAbove ? { transform: 'translateY(-100%)' } : {}),
  };

  const menu = (
    <div
      ref={menuRef}
      className="hot-col-menu hot-appearance-v2"
      style={style}
      role="menu"
      aria-label={t('dynamicTable.perspectives.menuFor', 'View actions: {name}', { name: perspectiveName })}
    >
      {onRename && (
        <button className="hot-col-menu-item" role="menuitem" onClick={() => { onRename(); onClose(); }}>
          <Pencil className="w-4 h-4" />
          <span>{t('dynamicTable.perspectives.rename', 'Rename view')}</span>
        </button>
      )}
      {onEditView && (
        <button className="hot-col-menu-item" role="menuitem" onClick={() => { onEditView(); onClose(); }}>
          {/* The same glyph the column menu uses for "Advanced filter…" — one
              icon means "open the Configure View drawer" everywhere in the grid. */}
          <SlidersHorizontal className="w-4 h-4" />
          <span>{t('dynamicTable.perspectives.configure', 'Configure view…')}</span>
        </button>
      )}
      {onDuplicate && (
        <button className="hot-col-menu-item" role="menuitem" onClick={() => { onDuplicate(); onClose(); }}>
          <Copy className="w-4 h-4" />
          <span>{t('dynamicTable.perspectives.duplicate', 'Duplicate view')}</span>
        </button>
      )}
      {onSetDefault && (
        <button
          className="hot-col-menu-item"
          role="menuitem"
          disabled={isDefault}
          onClick={() => { onSetDefault(); onClose(); }}
        >
          <Star className="w-4 h-4" />
          <span>
            {isDefault
              ? t('dynamicTable.perspectives.isMyDefault', 'This is my default view')
              : t('dynamicTable.perspectives.setDefault', 'Set as my default')}
          </span>
        </button>
      )}
      {onPublish && (
        <button className="hot-col-menu-item" role="menuitem" onClick={() => { onPublish(); onClose(); }}>
          <Share2 className="w-4 h-4" />
          <span>
            {isPublished
              ? t('dynamicTable.perspectives.updateTemplate', 'Update shared template…')
              : t('dynamicTable.perspectives.publish', 'Share as template…')}
          </span>
        </button>
      )}
      {originTemplateName ? (
        <>
          <div className="hot-col-menu-divider" />
          {/* Provenance, not an action: a copy stays yours, and this is the only
              place that says where it came from. */}
          <div className="hot-col-menu-note">
            <Link2 className="w-4 h-4" />
            <span>
              {t('dynamicTable.perspectives.copiedFrom', 'Copied from "{name}"', {
                name: originTemplateName,
              })}
            </span>
          </div>
        </>
      ) : null}
      {onDelete && (
        <>
          <div className="hot-col-menu-divider" />
          <button
            className="hot-col-menu-item hot-col-menu-item-danger"
            role="menuitem"
            onClick={() => { onDelete(); onClose(); }}
          >
            <Trash2 className="w-4 h-4" />
            <span>{deleteLabel ?? t('dynamicTable.perspectives.deleteView', 'Delete view…')}</span>
          </button>
        </>
      )}
    </div>
  );

  return ReactDOM.createPortal(menu, document.body);
};

export default PerspectiveTabMenu;
