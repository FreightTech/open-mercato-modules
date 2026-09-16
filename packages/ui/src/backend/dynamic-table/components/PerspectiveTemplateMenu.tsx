'use client'

import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Copy, Check } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import type { PerspectiveConfig, PerspectiveTemplate } from '../types/perspective';

export interface PerspectiveTemplateMenuProps {
  /** The trigger this menu hangs off — the rect is re-read on open. */
  anchorRect: DOMRect;
  /** Templates published to roles this user holds. */
  templates: PerspectiveTemplate[];
  /** This user's own views, so an already-copied template can say so. */
  savedPerspectives: PerspectiveConfig[];
  /** Copy a template into this user's own space. */
  onCopy: (template: PerspectiveTemplate) => void;
  onClose: () => void;
}

/**
 * The shared-template shelf (personalization decision, 3 Aug 2026).
 *
 * Views are PRIVATE by default; this is the one place a view someone else built
 * becomes reachable — and it is reachable only by COPYING. Nothing here is ever
 * applied to the reader automatically, which is what keeps "there is no shared
 * thing a user can silently mutate" true after this feature exists.
 *
 * A template the user has already taken says so and stays clickable: taking a
 * second copy (e.g. after the template changed) is legitimate, so the state is
 * information, not a lock.
 *
 * Structure and CSS are the SAME as `ColumnHeaderMenu` / `PerspectiveTabMenu`
 * (`.hot-col-menu`), so the grid's three dropdowns read as one component.
 */
const PerspectiveTemplateMenu: React.FC<PerspectiveTemplateMenuProps> = ({
  anchorRect,
  templates,
  savedPerspectives,
  onCopy,
  onClose,
}) => {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Capture phase — the tab strip's own mousedown handlers call
    // stopPropagation, so a bubbling listener would never see the outside click.
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Which templates this user already holds a copy of, and whether that copy is
  // still on the template's current version. The version comparison is why the
  // copy records `origin.version` at all.
  const copiedVersionByTemplate = new Map<string, string>();
  for (const p of savedPerspectives) {
    if (p.origin) copiedVersionByTemplate.set(p.origin.templateId, p.origin.version);
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    left: Math.min(anchorRect.left, Math.max(8, window.innerWidth - 280)),
    minWidth: 240,
    maxWidth: 320,
    zIndex: 9999,
  };

  const menu = (
    <div
      ref={menuRef}
      className="hot-col-menu hot-appearance-v2"
      style={style}
      role="menu"
      aria-label={t('dynamicTable.perspectives.templatesAria', 'Shared view templates')}
    >
      <div className="hot-col-menu-title">
        {t('dynamicTable.perspectives.templatesTitle', 'Shared templates')}
      </div>
      {templates.length === 0 ? (
        <div className="hot-col-menu-empty">
          {t('dynamicTable.perspectives.templatesEmpty', 'Nobody has shared a view for this table yet.')}
        </div>
      ) : (
        templates.map((template) => {
          const copiedVersion = copiedVersionByTemplate.get(template.id);
          const isCopied = copiedVersion !== undefined;
          const isStale = isCopied && copiedVersion !== template.version;
          return (
            <button
              key={template.id}
              className="hot-col-menu-item hot-col-menu-item-stack"
              role="menuitem"
              onClick={() => { onCopy(template); onClose(); }}
            >
              {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span className="hot-col-menu-item-text">
                <span className="hot-col-menu-item-title">{template.name}</span>
                <span className="hot-col-menu-item-sub">
                  {isStale
                    ? t(
                        'dynamicTable.perspectives.templateChanged',
                        'Updated since your copy — copy again',
                      )
                    : isCopied
                      ? t('dynamicTable.perspectives.templateCopied', 'Already copied to your views')
                      : template.roleName
                        ? t('dynamicTable.perspectives.templateSharedWith', 'Shared with {role}', {
                            role: template.roleName,
                          })
                        : t('dynamicTable.perspectives.templateCopyAction', 'Copy to my views')}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );

  return ReactDOM.createPortal(menu, document.body);
};

export default PerspectiveTemplateMenu;
