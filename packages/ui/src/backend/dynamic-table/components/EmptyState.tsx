'use client'

import React from 'react';
import { Inbox, SearchX, FilterX } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { Button } from '../../../primitives-v2';

export interface EmptyStateProps {
  /** Host-supplied wording for the "there is genuinely nothing here" case. */
  emptyMessage?: string;
  /** The dataset-wide search term currently narrowing the rows, if any. */
  searchQuery?: string;
  /** How many filter rules are live (quick-filter ticks + drawer rules). */
  filterCount: number;
  /** Clears the dataset-wide search. */
  onClearSearch?: () => void;
  /** Drops every live filter rule. Omit when the grid has no filter writer. */
  onClearFilters?: () => void;
}

/**
 * What a DynamicTable shows when it has no rows (ledger 2.20).
 *
 * THE POINT IS THE DIAGNOSIS, not the decoration. "No results" is useless when
 * the user cannot see what removed the rows — the reported case was a search
 * for a container number that matched nothing, which left the header row and
 * ~400px of void: no message, no icon, and no route back except remembering
 * that the search box up in the toolbar still had text in it.
 *
 * So the state names the CAUSE it can prove, most-specific first:
 *   search + filters → both, and an undo for each;
 *   search only      → quotes the term, offers "Clear search";
 *   filters only     → counts the rules, offers "Clear filters";
 *   neither          → the table really is empty; `emptyMessage` (a host string
 *                      like "No addresses") or a neutral fallback, and NO
 *                      action, because there is nothing to undo.
 *
 * Rendered UNDER the column headers rather than instead of them: the headers
 * are what tells you which table you are looking at, and a page that swaps its
 * whole body for a message reads as an error rather than a filter result.
 */
const EmptyState: React.FC<EmptyStateProps> = ({
  emptyMessage,
  searchQuery,
  filterCount,
  onClearSearch,
  onClearFilters,
}) => {
  const t = useT();
  const search = (searchQuery ?? '').trim();
  const hasSearch = search.length > 0;
  const hasFilters = filterCount > 0;

  const Icon = hasSearch ? SearchX : hasFilters ? FilterX : Inbox;

  const title = hasSearch
    ? t('dynamicTable.empty.searchTitle', 'Nothing matches “{query}”', { query: search })
    : hasFilters
      ? t('dynamicTable.empty.filterTitle', 'Nothing matches the current filters')
      : emptyMessage ?? t('dynamicTable.empty.title', 'Nothing here yet');

  const detail = hasSearch && hasFilters
    ? t(
        'dynamicTable.empty.searchAndFilterDetail',
        'The search is being applied on top of {count} filter rule(s). Clear one or both to see rows again.',
        { count: String(filterCount) },
      )
    : hasSearch
      ? t('dynamicTable.empty.searchDetail', 'No row on this table contains that text.')
      : hasFilters
        ? t(
            'dynamicTable.empty.filterDetail',
            '{count} filter rule(s) are hiding every row.',
            { count: String(filterCount) },
          )
        : null;

  return (
    <div className="hot-empty-message" role="status">
      <div className="hot-empty-state">
        <Icon className="hot-empty-state-icon" aria-hidden="true" />
        <p className="hot-empty-state-title text-body-medium-md">{title}</p>
        {detail && <p className="hot-empty-state-detail text-body-regular-sm">{detail}</p>}
        {(hasSearch || hasFilters) && (
          <div className="hot-empty-state-actions">
            {hasSearch && onClearSearch && (
              <Button variant="outline" size="sm" onClick={onClearSearch} data-empty-clear-search="">
                {t('dynamicTable.empty.clearSearch', 'Clear search')}
              </Button>
            )}
            {hasFilters && onClearFilters && (
              <Button variant="outline" size="sm" onClick={onClearFilters} data-empty-clear-filters="">
                {t('dynamicTable.empty.clearFilters', 'Clear filters')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EmptyState;
