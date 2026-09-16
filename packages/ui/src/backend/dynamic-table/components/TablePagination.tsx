import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { PaginationProps } from '../types/index';
import { SelectMenu } from './SelectMenu';

interface TablePaginationProps {
  pagination: PaginationProps;
}

// Compact page items (Figma 220:2935): with more than two pages, show just the
// active page, an ellipsis, and the last page — e.g. `[2] ··· 5`. On the last
// page, anchor to the first instead (`1 ··· [5]`). Two pages show both; one
// page shows just itself. Adjacent anchor/last drop the ellipsis.
function getPageItems(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 1) return [1];
  if (total === 2) return [1, 2];
  const anchor = current >= total ? 1 : current;
  if (total - anchor <= 1) return [anchor, total];
  return [anchor, 'ellipsis', total];
}

/**
 * Compact inline pagination (Figma 220:2935) — sits right-aligned on the
 * perspective-tabs row: `‹ [active] ··· page › [rows-per-page ⌄]`.
 * Active page is a slate-300 pill (not navy); no record-count text.
 */
const TablePagination: React.FC<TablePaginationProps> = ({ pagination }) => {
  const t = useT();
  const { currentPage, totalPages, limit, limitOptions, onPageChange, onLimitChange } = pagination;

  return (
    <div className="hot-table-pagination">
      <div className="hot-table-pagination-pages">
        <button
          type="button"
          className="hot-table-pagination-btn"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label={t('dynamicTable.pagination.previous', 'Previous page')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {getPageItems(currentPage, Math.max(totalPages, 1)).map((item, i) =>
          item === 'ellipsis' ? (
            <span key={`ellipsis-${i}`} className="hot-table-pagination-ellipsis">···</span>
          ) : (
            <button
              key={item}
              type="button"
              className={`hot-table-pagination-page${item === currentPage ? ' is-active' : ''}`}
              onClick={() => onPageChange(item)}
              aria-current={item === currentPage ? 'page' : undefined}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          className="hot-table-pagination-btn"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label={t('dynamicTable.pagination.next', 'Next page')}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Portal-rendered menu, not a native `<select>`. The OS dropdown paints
          against the page rather than the grid, ignores every v2 type and shape
          token, and inside a split pane it escaped the pane's stacking context
          entirely — so the one control that stayed native was also the one that
          broke the M3 language the moment it was opened. `SelectMenu` already
          exists for exactly this and keeps the trigger's original class, so
          spacing, radius and colour are unchanged.
          `hot-table-pagination-select` is load-bearing for the e2e harness and
          is preserved as the trigger's class. */}
      {limitOptions && limitOptions.length > 0 && (
        <div className="hot-table-pagination-perpage">
          <SelectMenu
            className="hot-table-pagination-select"
            value={String(limit)}
            onChange={(next) => onLimitChange(Number(next))}
            options={limitOptions.map((opt) => ({ value: String(opt), label: String(opt) }))}
            ariaLabel={t('dynamicTable.pagination.perPage', 'Rows per page')}
          />
        </div>
      )}
    </div>
  );
};

export default TablePagination;
