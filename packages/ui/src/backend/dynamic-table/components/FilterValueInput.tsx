import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { useSuggestionFetch } from '../hooks/useSuggestionFetch';
import { useEscapeLayer } from '../hooks/useEscapeLayer';

/**
 * The filter value picker.
 *
 * WHY THIS EXISTS: `ConfigureViewFilters` declared `loadFilterSuggestions`,
 * destructured it and never called it. Every module that implements a
 * suggestion loader — folders, transport, invoicing, facilities, products,
 * carriers, contractors, the RFQ board — therefore got a bare free-text box,
 * and a filter on a relation or a user column could only be typed blind. Eight
 * lists, silently. This component is what the prop was always meant to reach.
 *
 * It is a COMBOBOX, not a closed select, and that is deliberate: `contains` on
 * a partial string is a legitimate filter, and the loader returns at most 50
 * values, so the list is a shortcut rather than the full domain.
 *
 * Fetch contract (do not "optimise" these away):
 *  - the needle goes TO THE SERVER on every change, debounced. Fetching once
 *    with an empty query and filtering the result client-side silently hides
 *    every value past the server's cap — the exact sampling bug documented in
 *    `server/filterSuggestions.ts`;
 *  - in-flight requests are superseded, so a slow first response can never
 *    overwrite a newer one;
 *  - a suggestion is a DISPLAY string that is simultaneously the stored value.
 *    Module list routes match these strings against the denormalised row, so
 *    there is no id mapping to do here. The value/label split exists only for
 *    static `source` columns, which are handled by the caller;
 *  - a loader that rejects leaves the free-text input fully usable. Filtering
 *    must never be blocked by a failed suggestion fetch.
 *
 * The fetch itself lives in `useSuggestionFetch` — shared with the column-header
 * quick filter, so that contract has exactly one implementation.
 */

const MAX_VISIBLE_SUGGESTIONS = 8;

export interface FilterValueInputProps {
  /** Filter row id — passed straight back to the change handlers. */
  filterId: string;
  /** Current value for a single-value operator. Ignored when `isMultiValue`. */
  initialValue: string;
  /** `is_any_of` / `is_not_any_of`: committing ADDS a pill instead of replacing. */
  isMultiValue: boolean;
  onValueChange: (id: string, value: string) => void;
  onValueAdd: (id: string, value: string) => void;
  /**
   * Static option labels for a column that declares `source`. Filtered
   * client-side, because the whole set is already in memory.
   */
  staticSuggestions?: string[];
  /** Server-backed suggestions for this column. Given the typed needle. */
  loadSuggestions?: (query: string) => Promise<string[]>;
  placeholder?: string;
  ariaLabel?: string;
}

export const FilterValueInput: React.FC<FilterValueInputProps> = ({
  filterId,
  initialValue,
  isMultiValue,
  onValueChange,
  onValueAdd,
  staticSuggestions,
  loadSuggestions,
  placeholder,
  ariaLabel,
}) => {
  const t = useT();
  const [localValue, setLocalValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);

  // ── Suggestion fetch ───────────────────────────────────────────────────────
  // Shared with the column-header quick filter: debounced, superseded, and it
  // degrades to `failed` (never to a blocked filter) when the loader rejects.
  const {
    values: asyncSuggestions,
    loading,
    failed,
  } = useSuggestionFetch(loadSuggestions, localValue, open);

  const suggestions = useMemo(() => {
    if (loadSuggestions) {
      // The server already applied the needle and the cap; re-filtering here
      // would drop values it deliberately returned.
      return asyncSuggestions.slice(0, MAX_VISIBLE_SUGGESTIONS);
    }
    const all = staticSuggestions ?? [];
    const needle = localValue.trim().toLowerCase();
    if (!needle) return all.slice(0, MAX_VISIBLE_SUGGESTIONS);
    return all.filter((s) => s.toLowerCase().includes(needle)).slice(0, MAX_VISIBLE_SUGGESTIONS);
  }, [loadSuggestions, asyncSuggestions, staticSuggestions, localValue]);

  const hasPicker = !!loadSuggestions || (staticSuggestions?.length ?? 0) > 0;

  // ── Positioning ────────────────────────────────────────────────────────────
  const reposition = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    // Measured once mounted; 240 is only the first-frame estimate.
    const menuHeight = menuRef.current?.offsetHeight || 240;
    // Clamped into the viewport instead of `translateY(-100%)`: flipping a menu
    // above a trigger that is itself near the top of the screen used to place
    // it at a negative top, silently cutting off the first suggestions.
    const fitsBelow = rect.bottom + menuHeight + margin <= window.innerHeight;
    const desiredTop = fitsBelow ? rect.bottom + 4 : rect.top - 4 - menuHeight;
    const maxTop = Math.max(margin, window.innerHeight - menuHeight - margin);
    setPosition({
      top: Math.max(margin, Math.min(desiredTop, maxTop)),
      left: rect.left,
      width: rect.width,
    });
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
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (inputRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Escape dismisses the suggestion list and nothing else. With the list CLOSED
  // the hook is inactive, so Escape falls through to the drawer as it should.
  useEscapeLayer(open, () => {
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  });

  // ── Commit ─────────────────────────────────────────────────────────────────
  const commit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (isMultiValue) {
        if (trimmed) onValueAdd(filterId, trimmed);
        setLocalValue('');
      } else {
        setLocalValue(value);
        onValueChange(filterId, trimmed);
      }
      setOpen(false);
      setActiveIndex(-1);
    },
    [filterId, isMultiValue, onValueAdd, onValueChange],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, -1));
        return;
      }
    }
    // NOTE: Escape is NOT handled here. React attaches its listeners at the
    // root container, which runs long after the document-capture Escape handler
    // Radix's Sheet installs — so by the time this ran the Configure View
    // drawer was already closing underneath the suggestion list. `useEscapeLayer`
    // below intercepts it at window-capture instead, and only while this list is
    // the innermost open layer.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        commit(suggestions[activeIndex]);
        return;
      }
      commit(localValue);
    }
  };

  const menu =
    open && hasPicker ? (
      <div
        ref={menuRef}
        role="listbox"
        className="hot-filter-suggestions"
        style={{
          position: 'fixed',
          top: `${position.top}px`,
          left: `${position.left}px`,
          minWidth: `${position.width}px`,
          zIndex: 10002,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {suggestions.length > 0 ? (
          suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              data-active={index === activeIndex || undefined}
              className="hot-filter-suggestion text-body-regular-sm"
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(suggestion)}
            >
              {suggestion}
            </button>
          ))
        ) : loading ? (
          // Loading and empty MUST look different. A silently empty dropdown is
          // precisely what made this defect invisible for months.
          <span className="hot-filter-suggestion-note text-body-regular-xs" data-suggestions-state="loading">
            {t('dynamicTable.filter.suggestionsLoading', 'Loading…')}
          </span>
        ) : failed ? (
          <span className="hot-filter-suggestion-note text-body-regular-xs" data-suggestions-state="error">
            {t('dynamicTable.filter.suggestionsFailed', 'Suggestions unavailable — type a value')}
          </span>
        ) : (
          <span className="hot-filter-suggestion-note text-body-regular-xs" data-suggestions-state="empty">
            {t('dynamicTable.filter.suggestionsEmpty', 'No suggestions')}
          </span>
        )}
      </div>
    ) : null;

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        role={hasPicker ? 'combobox' : undefined}
        aria-expanded={hasPicker ? open : undefined}
        aria-label={ariaLabel}
        className="hot-config-filter-input"
        placeholder={placeholder}
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          setActiveIndex(-1);
          if (hasPicker) setOpen(true);
        }}
        onFocus={() => {
          if (hasPicker) {
            reposition();
            setOpen(true);
          }
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delayed so a click on a suggestion lands first.
          setTimeout(() => {
            if (!isMultiValue && localValue.trim() !== initialValue) {
              onValueChange(filterId, localValue.trim());
            }
            setOpen(false);
          }, 150);
        }}
      />
      {menu && typeof document !== 'undefined' ? ReactDOM.createPortal(menu, document.body) : menu}
    </>
  );
};

export default FilterValueInput;
