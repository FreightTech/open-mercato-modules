import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { computeAnchoredPosition } from '../utils/anchoredPosition';
import { useEscapeLayer } from '../hooks/useEscapeLayer';

/**
 * The Configure View drawer's dropdown.
 *
 * A native `<select>` is not usable here: the drawer is a `Sheet` with its own
 * scroll container and stacking context, so the OS menu paints against the page
 * rather than the panel, and it cannot carry the v2 type tokens at all. Every
 * dropdown in this product is therefore a portal-rendered menu anchored via
 * `getBoundingClientRect`, closing on outside-click, Escape and scroll — the
 * same shape `FilterDatePicker` already uses, deliberately copied rather than
 * reinvented.
 *
 * The trigger keeps the class the old `<select>` carried, so spacing, radius
 * and colour are unchanged; only the menu is ours.
 */

export interface SelectMenuOption {
  value: string;
  label: string;
}

export interface SelectMenuProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  /** Shown when `value` matches no option (i.e. nothing chosen yet). */
  placeholder?: string;
  /**
   * Rendered as the first entry and selects `''`. Omit for a menu with no
   * "no choice" state.
   */
  emptyOptionLabel?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Marks the trigger for the harness / tests, mirroring the old select. */
  dataAttributes?: Record<string, string | boolean | undefined>;
}

const MENU_MAX_HEIGHT = 280;

export const SelectMenu: React.FC<SelectMenuProps> = ({
  value,
  onChange,
  options,
  placeholder,
  emptyOptionLabel,
  className = '',
  ariaLabel,
  disabled = false,
  dataAttributes,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: MENU_MAX_HEIGHT,
    openAbove: false,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const entries: SelectMenuOption[] =
    emptyOptionLabel !== undefined ? [{ value: '', label: emptyOptionLabel }, ...options] : options;

  const selected = entries.find((o) => o.value === value);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // The menu sets `minWidth` (not `width`) so a long option label stays
    // readable — which means its real width can exceed the trigger's. Clamp
    // against the WIDER of the two, or a menu opened from a trigger near the
    // right edge (every select in the Configure View drawer) overflows.
    const placement = computeAnchoredPosition(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      {
        width: Math.max(rect.width, menuRef.current?.offsetWidth ?? rect.width),
        preferredHeight: MENU_MAX_HEIGHT,
        minHeight: 96,
      },
    );
    setPosition({
      top: placement.top,
      left: placement.left,
      // Never narrower than the trigger; a value wider than the trigger is
      // readable rather than clipped.
      width: rect.width,
      maxHeight: placement.maxHeight,
      openAbove: placement.flipAbove,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => reposition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Escape closes THIS menu and nothing else. A `document`-capture listener was
  // not enough: Radix's Sheet registers its own document-capture Escape handler
  // when it mounts, i.e. before this menu ever opens, so it always ran first and
  // the whole Configure View drawer closed. See `useEscapeLayer`.
  useEscapeLayer(open, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  const commit = useCallback(
    (next: string) => {
      onChange(next);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      if (!open) {
        e.preventDefault();
        setActiveIndex(Math.max(0, entries.findIndex((o) => o.value === value)));
        setOpen(true);
        return;
      }
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = entries[activeIndex];
      if (entry) commit(entry.value);
    }
  };

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      aria-label={ariaLabel}
      className="hot-select-menu"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        minWidth: `${position.width}px`,
        maxHeight: `${position.maxHeight}px`,
        zIndex: 10002,
        ...(position.openAbove ? { transform: 'translateY(-100%)' } : {}),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {entries.map((option, index) => (
        <button
          key={option.value || '__empty'}
          type="button"
          role="option"
          aria-selected={option.value === value}
          data-active={index === activeIndex || undefined}
          data-selected={option.value === value || undefined}
          className="hot-select-menu-option text-body-regular-sm"
          onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commit(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        className={`hot-select-trigger ${className}`.trim()}
        onClick={() => {
          setActiveIndex(Math.max(0, entries.findIndex((o) => o.value === value)));
          setOpen((o) => !o);
        }}
        onKeyDown={onTriggerKeyDown}
        {...dataAttributes}
      >
        <span
          className={`hot-select-trigger-label${selected ? '' : ' hot-select-trigger-placeholder'}`}
        >
          {selected ? selected.label : (placeholder ?? '')}
        </span>
        <ChevronDown className="hot-select-trigger-chevron" aria-hidden />
      </button>
      {menu && typeof document !== 'undefined' ? ReactDOM.createPortal(menu, document.body) : menu}
    </>
  );
};

export default SelectMenu;
