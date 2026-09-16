'use client'

import React, { useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../hooks/useEscapeLayer';

if (typeof window !== 'undefined') {
  // @ts-ignore - CSS import handled by bundler
  import('../styles/ContextMenu.css');
}

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  actions: ContextMenuAction[];
  onClose: () => void;
  onActionClick: (actionId: string) => void;
}

/**
 * The right-click menu.
 *
 * Chrome is NOT its own: it renders `.hot-col-menu` / `.hot-col-menu-item` /
 * `.hot-col-menu-divider` — the exact shell the column-header menu, the view-tab
 * menu and the shared-template shelf already use. Everything visual (background,
 * border, radius, shadow, item padding, hover fill, disabled opacity) therefore
 * comes from one place and tracks the theme through `--hot-*` tokens.
 *
 * It previously carried its own inline `backgroundColor: 'white'`,
 * `color: '#374151'`, `#e5e7eb` borders and JS `onMouseEnter` hover painting.
 * Inline styles beat any stylesheet, so the menu rendered as a white card with
 * dark-grey text on top of the dark app — and the dark rules that did exist in
 * `ContextMenu.css` were written against `@media (prefers-color-scheme: dark)`,
 * which never matches here because this app themes with a `.dark` CLASS.
 *
 * `.context-menu` / `.context-menu-item` stay on the elements: `DynamicTable`
 * hit-tests for them, `GridHarness` locates the menu by them, and
 * `TC-OFFER-310` asserts on them.
 */
const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  position,
  actions,
  onClose,
  onActionClick,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    // Adjust position to keep menu within viewport
    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 10;
    }

    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 10;
    }

    setAdjustedPosition({ x, y });
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Escape closes THIS menu only. A bubble-phase `document` listener let the
  // key reach an enclosing Sheet/Dialog first and tear it down as well.
  useEscapeLayer(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu hot-col-menu hot-context-menu hot-appearance-v2"
      style={{
        position: 'fixed',
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
      }}
    >
      {actions.map((action, index) => {
        if (action.separator) {
          return (
            <div
              key={`separator-${index}`}
              className="context-menu-separator hot-col-menu-divider"
            />
          );
        }

        return (
          <button
            key={action.id}
            type="button"
            onClick={() => {
              if (!action.disabled) {
                onActionClick(action.id);
                onClose();
              }
            }}
            disabled={action.disabled}
            className="context-menu-item hot-col-menu-item"
          >
            {action.icon && <span className="context-menu-item-icon">{action.icon}</span>}
            <span className="context-menu-item-label">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ContextMenu;
