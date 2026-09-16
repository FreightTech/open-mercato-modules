'use client';

import React from 'react';

/**
 * Publishes the active perspective's chosen date/time format (an opaque host
 * token, e.g. a preset key) down to cell renderers. `DynamicTable` fills it from
 * the active perspective; custom renderers read it via `useTableDateFormat()` and
 * map it to an actual format. `undefined` means "no explicit choice" — renderers
 * should fall back to their own default so existing views are unchanged.
 *
 * The framework stays format-agnostic: it stores/round-trips the string and lets
 * the host own the vocabulary and the formatting.
 */
export const TableDateFormatContext = React.createContext<string | undefined>(undefined);

export function useTableDateFormat(): string | undefined {
  return React.useContext(TableDateFormatContext);
}
