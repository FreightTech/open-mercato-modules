import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadFilterSuggestions } from '../types/index';

/**
 * THE one place a filter-suggestion request is made.
 *
 * There are two value pickers in this grid — the combobox in the Configure View
 * drawer (`FilterValueInput`) and the Excel-style checkbox list in the column
 * header (`ColumnFilterPopover`) — and they must not each own a copy of the
 * fetch. The contract they share is not cosmetic:
 *
 *  - the needle goes TO THE SERVER on every keystroke, debounced. Fetching once
 *    with an empty query and filtering client-side silently hides every value
 *    past the server's 50-row cap (see `server/filterSuggestions.ts`);
 *  - responses are superseded by request sequence, so a slow first response can
 *    never overwrite a newer one;
 *  - a rejected loader degrades to `failed` and an empty list — never to a
 *    blocked filter. Loading, empty and failed are three DISTINGUISHABLE states,
 *    because a silently blank dropdown is what hid the missing loader for
 *    months.
 */

export const SUGGESTIONS_DEBOUNCE_MS = 200;

export interface SuggestionFetchState {
  values: string[];
  loading: boolean;
  failed: boolean;
}

export function useSuggestionFetch(
  loadSuggestions: ((query: string) => Promise<string[]>) | undefined,
  query: string,
  enabled: boolean,
  debounceMs: number = SUGGESTIONS_DEBOUNCE_MS,
): SuggestionFetchState {
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Monotonic request id — a stale response is dropped, never rendered. */
  const seqRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Invalidate anything in flight so an unmounted picker never setStates.
      seqRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!loadSuggestions || !enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const seq = ++seqRef.current;
    setLoading(true);
    timerRef.current = setTimeout(() => {
      loadSuggestions(query)
        .then((results) => {
          if (seq !== seqRef.current) return;
          setValues(Array.isArray(results) ? results : []);
          setFailed(false);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setValues([]);
          setFailed(true);
        })
        .finally(() => {
          if (seq !== seqRef.current) return;
          setLoading(false);
        });
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, loadSuggestions, enabled, debounceMs]);

  return { values, loading, failed };
}

/**
 * Per-field loader cache.
 *
 * `useSuggestionFetch` keys its effect on the loader's identity, so handing it
 * an inline `(q) => load(field, q)` re-fires the request on every render — a
 * fetch loop, not a picker. Both call sites get their stable per-field function
 * from here.
 */
export function useFieldSuggestionLoader(
  loadFilterSuggestions?: LoadFilterSuggestions,
): (field: string) => ((query: string) => Promise<string[]>) | undefined {
  const cache = useMemo(
    () => new Map<string, (query: string) => Promise<string[]>>(),
    [loadFilterSuggestions],
  );
  return useCallback(
    (field: string) => {
      if (!loadFilterSuggestions || !field) return undefined;
      const cached = cache.get(field);
      if (cached) return cached;
      const fn = (query: string) => loadFilterSuggestions(field, query);
      cache.set(field, fn);
      return fn;
    },
    [loadFilterSuggestions, cache],
  );
}
