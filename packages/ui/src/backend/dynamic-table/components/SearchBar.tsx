import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { dispatch } from '../events/events';
import { TableEvents, SearchEvent } from '../types/index';
import type { SearchSuggestionsRenderer } from '../types/index';

if (typeof window !== 'undefined') {
  // @ts-ignore - CSS import handled by bundler
  import('../styles/SearchBar.css');
}

interface SearchBarProps {
  tableRef: React.RefObject<HTMLElement | null>;
  placeholder?: string;
  debounceMs?: number;
  /**
   * Renders a suggestions panel under the box while it has a query and focus.
   *
   * A RENDER PROP RATHER THAN DATA, because what a good hint looks like is
   * domain knowledge this component does not have: documents want a thumbnail
   * and the field that matched, an order list would want a status and a total.
   * SearchBar owns the two things that ARE generic — where the panel is
   * anchored, and when it is open.
   */
  renderSuggestions?: SearchSuggestionsRenderer;
}

/** Gap between the input and the panel, and the viewport margin the panel keeps. */
const PANEL_OFFSET = 4;
const VIEWPORT_MARGIN = 8;
/**
 * Never narrower than this, however narrow the 320px-max input gets.
 *
 * 460, not 360. At 360 the matched text — the one thing the user searched for —
 * was clipped at the panel edge while a 30-character filename ran to full
 * length beside it. A hint panel whose match does not fit is a panel that
 * cannot do its job.
 */
const PANEL_MIN_WIDTH = 460;

const SearchBar: React.FC<SearchBarProps> = ({
  tableRef,
  placeholder = 'Search a product',
  debounceMs = 300,
  renderSuggestions,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);


  const dispatchSearchEvent = useCallback((value: string) => {
    if (tableRef.current) {
      dispatch<SearchEvent>(
        tableRef.current,
        TableEvents.SEARCH,
        {
          query: value,
          timestamp: Date.now(),
        }
      );
    }
  }, [tableRef]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);
    // Typing always re-opens: a user who dismissed the panel with Escape and
    // then kept typing is asking a new question.
    setSuggestionsOpen(true);

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      dispatchSearchEvent(value);
    }, debounceMs);
  }, [dispatchSearchEvent, debounceMs]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Arrow keys belong to the suggestions panel while it is open; it listens on
    // the input itself (see `renderSuggestions`' contract) and stops the event
    // there. Nothing to do here but stay out of the way.
    if (e.key === 'Enter') {
      // Clear debounce and dispatch immediately
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      dispatchSearchEvent(searchValue);
      setSuggestionsOpen(false);
    } else if (e.key === 'Escape') {
      // ESCAPE RETREATS ONE STEP AT A TIME. With a panel open it closes the
      // panel and keeps the query — wiping a query the user is still reading
      // results for is a different, much more annoying action than the one they
      // asked for. A second Escape then clears, as it always did.
      if (suggestionsOpen) {
        setSuggestionsOpen(false);
        return;
      }
      // Clear the search on Escape key
      setSearchValue('');
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      dispatchSearchEvent('');
      // Keep focus on input after clearing
      inputRef.current?.focus();
    }
  }, [searchValue, dispatchSearchEvent, suggestionsOpen]);

  const handleClear = useCallback(() => {
    setSearchValue('');
    setSuggestionsOpen(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    dispatchSearchEvent('');
  }, [dispatchSearchEvent]);

  /** Put a query into the box and into the dataset in one move — what clicking
   *  a suggestion does. */
  const submitQuery = useCallback((value: string) => {
    setSearchValue(value);
    setSuggestionsOpen(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    dispatchSearchEvent(value);
  }, [dispatchSearchEvent]);

  const closeSuggestions = useCallback(() => setSuggestionsOpen(false), []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  /**
   * Mirror a search dispatched by SOMEONE ELSE.
   *
   * The grid's zero-result state dispatches `TableEvents.SEARCH` directly to
   * clear a dead query — it hands the change to this control's machinery.
   * Without this listener the dataset would filter while the box still looked
   * empty, leaving the user filtered with no visible cause and no way to clear
   * it. Guarded on value equality, so this can never echo its own change.
   */
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const onSearch = (e: Event) => {
      const query = (e as CustomEvent<SearchEvent>).detail?.query ?? '';
      setSearchValue((current) => (current === query ? current : query));
    };
    el.addEventListener(TableEvents.SEARCH, onSearch as EventListener);
    return () => el.removeEventListener(TableEvents.SEARCH, onSearch as EventListener);
  }, [tableRef]);

  /**
   * Where the panel goes.
   *
   * MEASURED AND PORTALLED, not `position: absolute` inside the wrapper. The
   * wrapper is `position: relative` and would host a dropdown happily — but the
   * toolbar sits inside `.hot-card`, which is `overflow: hidden`, so an in-flow
   * panel is CLIPPED at the card's edge and only its first few pixels are ever
   * seen. Measured on the documents list, and it is the same trap the topbar's
   * own search hit inside the sticky header.
   */
  const measureAnchor = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.width, PANEL_MIN_WIDTH),
      window.innerWidth - VIEWPORT_MARGIN * 2,
    );
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      window.innerWidth - width - VIEWPORT_MARGIN,
    );
    setAnchor({ top: rect.bottom + PANEL_OFFSET, left, width });
  }, []);

  useEffect(() => {
    if (!suggestionsOpen) return;
    measureAnchor();
    window.addEventListener('resize', measureAnchor);
    // Capturing: the page scrolls in `<main>`, not on the window, so a bubbling
    // listener on window never fires and the panel would detach from the box.
    window.addEventListener('scroll', measureAnchor, true);
    return () => {
      window.removeEventListener('resize', measureAnchor);
      window.removeEventListener('scroll', measureAnchor, true);
    };
  }, [suggestionsOpen, measureAnchor]);

  /** Click-outside. Both refs, because the panel is NOT inside the wrapper. */
  useEffect(() => {
    if (!suggestionsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setSuggestionsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [suggestionsOpen]);

  const suggestionsContext = useMemo(() => ({
    query: searchValue,
    inputRef,
    close: closeSuggestions,
    submit: submitQuery,
  }), [searchValue, closeSuggestions, submitQuery]);

  const suggestionPanel = renderSuggestions && suggestionsOpen && anchor && searchValue
    ? createPortal(
        <div
          ref={panelRef}
          className="hot-search-suggestions"
          data-testid="table-search-suggestions"
          style={{ top: anchor.top, left: anchor.left, width: anchor.width }}
          // The input keeps focus while the panel is used: a mousedown that
          // moves focus would blur the box, and the arrow keys the panel listens
          // for on the input would stop arriving mid-interaction.
          onMouseDown={(e) => e.preventDefault()}
        >
          {renderSuggestions(suggestionsContext)}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="search-bar">
      <div className="search-input-wrapper" ref={wrapperRef}>
        <svg
          className="search-icon"
          width="15"
          height="15"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"

        >
          <path
            d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <input
          type="text"
          value={searchValue}
          onChange={handleSearchChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="search-input"
          ref={inputRef}
          onFocus={() => { if (searchValue) setSuggestionsOpen(true); }}
          autoComplete="off"
          role={renderSuggestions ? 'combobox' : undefined}
          aria-autocomplete={renderSuggestions ? 'list' : undefined}
          aria-expanded={renderSuggestions ? suggestionsOpen : undefined}
        />
        {/* NO keyboard hint here. ⌘K belongs to the upstream global search
            dialog, which registers a window-level listener and preventDefaults
            it — this bar has never had a shortcut of any kind, so the badge that
            used to sit here advertised a key that does something else entirely.
            Ctrl+F is the BROWSER's: this box filters the whole dataset
            server-side, and nothing in the grid claims that key. */}
        {searchValue && (
          <button
            onClick={handleClear}
            className="search-clear-btn"
            aria-label="Clear search"
            title="Clear search"
            type="button"
            data-search-clear=""
          >
            {/* A drawn glyph, not the "×" MULTIPLICATION SIGN character: the
                literal took its weight and baseline from whatever face the
                toolbar inherited, so it sat off-centre inside the 20px circle
                and changed size with the font. The icon is metric-stable. */}
            <X size={12} strokeWidth={2.25} aria-hidden="true" />
          </button>
        )}
      </div>
      {suggestionPanel}
    </div>
  );
};

export default SearchBar;