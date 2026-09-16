'use client'

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { Button } from '../../../primitives-v2';

export interface LoadErrorStateProps {
  /** Host label for the dataset, e.g. "Invoices". Used to name what failed. */
  tableName?: string;
  /** Re-runs the list request. Omit only when the host cannot refetch. */
  onRetry?: () => void;
}

/**
 * What a DynamicTable shows when the list request FAILED (HEDGE-119).
 *
 * THE POINT IS THAT THIS IS NOT `EmptyState`. Until this component existed the
 * two situations were rendered by the same branch — `rowCount === 0` — because
 * a failed query leaves `dataQuery.data` undefined and `data` therefore `[]`.
 * An HTTP 500 and a genuinely empty table were byte-identical on screen, down
 * to the Inbox icon and the words "Nothing here yet".
 *
 * That is not a cosmetic problem. The reported case was the invoice queue: the
 * endpoint 500'd, the accountant read "Nothing here yet" as "no invoices are
 * waiting for me", and 17 unpaid documents sat unbooked. A table that cannot
 * reach the server must never claim to know what the server contains — the
 * honest statement is "I do not know", and that is what this renders.
 *
 * So the wording is deliberately about the FETCH, not about the data: it says
 * the rows could not be loaded, states outright that this does not mean the
 * table is empty, and offers the only action that can help (retry). No icon or
 * phrasing is shared with `EmptyState`; the two states must not be mistakable
 * for each other at a glance, which is precisely how this defect survived.
 *
 * Rendered UNDER the column headers, exactly like `EmptyState` — the headers
 * are the context that says which table you are looking at, and they are still
 * true when the body could not load.
 */
const LoadErrorState: React.FC<LoadErrorStateProps> = ({ tableName, onRetry }) => {
  const t = useT();

  const title = tableName
    ? t('dynamicTable.loadError.titleNamed', 'Could not load {name}', { name: tableName })
    : t('dynamicTable.loadError.title', 'Could not load these rows');

  return (
    <div className="hot-empty-message" role="alert" data-load-error="">
      <div className="hot-empty-state hot-load-error-state">
        <AlertTriangle className="hot-empty-state-icon hot-load-error-icon" aria-hidden="true" />
        <p className="hot-empty-state-title text-body-medium-md">{title}</p>
        <p className="hot-empty-state-detail text-body-regular-sm">
          {t(
            'dynamicTable.loadError.detail',
            'The server did not answer this request, so the rows below are unknown — this does NOT mean the table is empty. Retry, and if it keeps failing report it rather than treating the list as complete.',
          )}
        </p>
        {onRetry && (
          <div className="hot-empty-state-actions">
            <Button variant="outline" size="sm" onClick={onRetry} data-load-error-retry="">
              {t('dynamicTable.loadError.retry', 'Try again')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoadErrorState;
