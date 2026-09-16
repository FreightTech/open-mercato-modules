import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from '../../../primitives/calendar';
import { useEscapeLayer } from '../hooks/useEscapeLayer';

interface FilterDatePickerProps {
  /** ISO date string (YYYY-MM-DD), or empty string when unset. */
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  /** Extra classes on the trigger. The Configure View drawer's look is default. */
  className?: string;
  /**
   * Stacking for the portalled calendar. Defaults to the drawer's 10000; a host
   * that is itself portalled ABOVE that (the header quick filter sits at 10001)
   * must raise it or the calendar paints behind the popover that opened it.
   */
  zIndex?: number;
}

function parseISODate(value: string): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplay(date: Date): string {
  // Locale-aware short date that matches the inline editor's compact look.
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export const FilterDatePicker: React.FC<FilterDatePickerProps> = ({
  value,
  onChange,
  ariaLabel,
  placeholder = 'Pick date',
  className = '',
  zIndex = 10000,
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const selected = parseISODate(value);

  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    // Measured once mounted; the constants are only the first-frame estimate.
    const popupHeight = popupRef.current?.offsetHeight || 360; // calendar + footer
    const popupWidth = popupRef.current?.offsetWidth || 300;

    // VERTICAL CLAMP. The "open above" case used to be expressed as
    // `top: rect.top - 4` plus `translateY(-100%)`, which for a trigger high on
    // the screen resolves to a NEGATIVE top: the month caption and the weekday
    // header were cut off above the viewport and the month could not be
    // changed, so an explicit date range was unpickable. The transform hid the
    // arithmetic, so the top is now computed outright and clamped.
    const fitsBelow = rect.bottom + popupHeight + margin <= window.innerHeight;
    const desiredTop = fitsBelow ? rect.bottom + 4 : rect.top - 4 - popupHeight;
    const maxTop = Math.max(margin, window.innerHeight - popupHeight - margin);
    const top = Math.max(margin, Math.min(desiredTop, maxTop));

    // Horizontal clamp. The trigger sits near the right edge of the
    // configure-view drawer, so anchoring at `rect.left` lets a 300px-wide
    // calendar overflow and get clipped by the screen edge.
    const maxLeft = window.innerWidth - popupWidth - margin;
    const left = Math.max(margin, Math.min(rect.left, maxLeft));
    setPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
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
      const t = e.target as Node;
      if (popupRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // The calendar had NO Escape handling, so pressing Escape over an open date
  // popup closed the whole Configure View drawer and left the popup orphaned.
  useEscapeLayer(open, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  const handleSelect = (day: Date | undefined) => {
    if (!day) return;
    onChange(formatISODate(day));
    setOpen(false);
  };

  const popup = open ? (
    <div
      ref={popupRef}
      className="hot-editor-popup hot-calendar-popup hot-datetime-popup"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Calendar
        mode="single"
        selected={selected ?? undefined}
        defaultMonth={selected ?? undefined}
        onSelect={handleSelect}
        classNames={{
          month: 'relative space-y-4',
          month_caption: 'flex justify-center pt-1 items-center',
          today: 'shadow-[var(--m3-focus-halo)] rounded-m3-xs text-[var(--m3-on-surface)] font-semibold',
        }}
      />
      <div className="hot-calendar-footer">
        <button
          type="button"
          className="hot-calendar-footer-btn hot-calendar-clear-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
            setOpen(false);
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="hot-calendar-footer-btn hot-calendar-today-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const now = new Date();
            onChange(formatISODate(now));
            setOpen(false);
          }}
        >
          Today
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`hot-config-filter-input hot-config-filter-date-trigger ${className}`.trim()}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? '' : 'hot-config-filter-date-placeholder'}>
          {selected ? formatDisplay(selected) : placeholder}
        </span>
        <CalendarIcon className="w-3.5 h-3.5 text-[var(--m3-on-surface-variant)]" />
      </button>
      {popup && typeof document !== 'undefined' ? ReactDOM.createPortal(popup, document.body) : popup}
    </>
  );
};

export default FilterDatePicker;
