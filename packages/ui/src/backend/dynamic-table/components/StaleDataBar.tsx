'use client'

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../../primitives-v2'

export interface StaleDataBarProps {
  /** Host label for the dataset, e.g. "Invoices". Used to name what went stale. */
  tableName?: string
  /** Re-runs the list request. Omit only when the host cannot refetch. */
  onRetry?: () => void
}

/**
 * What a DynamicTable shows when the list request FAILED but the grid still
 * holds rows from the previous successful response (HEDGE-165).
 *
 * THIS IS THE OTHER HALF OF `LoadErrorState`. HEDGE-119 taught the zero-row
 * region to tell "the server refused" from "the server said zero rows", and
 * stopped there — because `LoadErrorState` is gated on `rowCount === 0`, the
 * case where a refetch fails *while rows are on screen* rendered nothing at
 * all. The failure flag reached the grid and was dropped on the floor.
 *
 * That silence is worse than the state HEDGE-119 fixed, not milder. A grid that
 * shows nothing at least looks broken. A grid that shows the PREVIOUS answer
 * looks like a correct answer to the question just asked: the operator types a
 * search term, the endpoint 500s, and the five rows already there stay put — so
 * "the search is broken" is the charitable reading and "these five are the
 * matches" is the likely one. The same trap swallows a post-save refresh: the
 * save succeeded, the refetch behind it 500'd, and the operator is left looking
 * at their pre-save values with nothing saying so.
 *
 * The rows deliberately STAY (dropping them on a transient failure would be a
 * worse trade, which is exactly what `placeholderData` in `useDynamicTablePage`
 * is for). Only the SIGNAL is added: one line saying what is on screen is the
 * previous result, plus the retry that already existed as `onRetryLoad`.
 *
 * `role="status"`, not `role="alert"`: the rows are still usable and the user
 * may be mid-keystroke, so this must not preempt what they are doing the way
 * the zero-row `LoadErrorState` (which owns `role="alert"`) legitimately does.
 */
const StaleDataBar: React.FC<StaleDataBarProps> = ({ tableName, onRetry }) => {
  const t = useT()

  const message = tableName
    ? t(
        'dynamicTable.staleData.messageNamed',
        'Could not refresh {name} — the rows below are the previous result, not the current one.',
        { name: tableName },
      )
    : t(
        'dynamicTable.staleData.message',
        'Could not refresh this list — the rows below are the previous result, not the current one.',
      )

  return (
    <div className="hot-stale-data-bar" role="status" data-stale-data="">
      <AlertTriangle className="hot-stale-data-bar-icon" aria-hidden="true" />
      {/* `title` because the message is clipped to one line on a narrow
          viewport — a band that reflows would re-measure the grid under it. */}
      <span className="hot-stale-data-bar-message text-body-regular-sm" title={message}>
        {message}
      </span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} data-stale-data-retry="">
          {t('dynamicTable.staleData.retry', 'Try again')}
        </Button>
      )}
    </div>
  )
}

export default StaleDataBar
