'use client'

/**
 * One control that drives every pane in a workspace.
 *
 * WHY IT IS ONE ROW: this bar exists to REPLACE the per-pane search rows, not
 * to sit above them. Four panes lose four search boxes and the workspace gains
 * one — net density is unchanged or better. A second row here would spend the
 * exact thing these tables are for (rows per screen) on chrome, so everything
 * lives on a single 32px line: the search box, one chip per live criterion, an
 * add-criterion select, the unmapped-pane marker, and the switch back to
 * per-pane control.
 *
 * INTERACTION LANGUAGE is `components/ColumnFilterPopover.tsx`, deliberately
 * copied rather than reinvented: a portal-anchored popover, an operator
 * `SelectMenu`, the same three date editor branches keyed off the same
 * predicates in `types/filters.ts`, and a Clear / Apply footer. A user who has
 * used the column funnel already knows this control.
 *
 * DEGRADATION IS VISIBLE. When a pane cannot honour a live criterion the host
 * passes it in `unmappedByPane` and the bar says so. A workspace filter that
 * quietly reaches three panes out of four is how someone reads unfiltered rows
 * believing they are filtered.
 *
 * Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md
 */

import * as React from 'react'
import ReactDOM from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../../primitives-v2/Button'
import { SearchInput } from '../../../primitives-v2/SearchInput'
import SelectMenu from '../components/SelectMenu'
import FilterDatePicker from '../components/FilterDatePicker'
import { useEscapeLayer } from '../hooks/useEscapeLayer'
import {
  getOperatorsForType,
  isDateOperator,
  needsRangeValues,
  needsRelativeInput,
  needsValueInput,
  RELATIVE_DATE_UNITS,
  type FilterOperator,
} from '../types/filters'
import { computeAnchoredPosition } from '../utils/anchoredPosition'
import {
  SHARED_CRITERION_KEYS,
  type SharedCriteria,
  type SharedCriterionKey,
  type SharedCriterionRule,
} from './sharedCriteria'

// `SelectMenu` and `FilterDatePicker` are styled by the grid's stylesheet,
// which is imported by `DynamicTable` itself. A workspace of nothing but widget
// panes never mounts one, and the controls would render unstyled — so ask for
// it here too, exactly as `EntitySearchEditor` does.
if (typeof window !== 'undefined') {
  // @ts-ignore - CSS import handled by bundler
  import('../styles/DynamicTable.css')
}

/**
 * Typing must not fan a request out to every pane on every keystroke. Long
 * enough to swallow a word, short enough that the panes feel live.
 */
const SEARCH_DEBOUNCE_MS = 300

const POPOVER_WIDTH = 260
const POPOVER_HEIGHT = 280
/** Above the popover, so the calendar it opens does not paint behind it. */
const NESTED_POPUP_Z = 10002
/** The popups this popover opens INSIDE itself all portal to `<body>`. */
const NESTED_POPUP_SELECTOR = '.hot-select-menu, .hot-editor-popup, .hot-calendar-popup'

/** Only `dateRange` is a quantity to bound; the rest are domains to name. */
function criterionType(key: SharedCriterionKey): 'date' | 'text' {
  return key === 'dateRange' ? 'date' : 'text'
}

function defaultOperator(key: SharedCriterionKey): FilterOperator {
  return key === 'dateRange' ? 'is_between' : 'is_any_of'
}

export type UnmappedPaneReport = {
  paneId: string
  /** What the pane is called, for the marker's tooltip. */
  title: string
  unmapped: SharedCriterionKey[]
}

export type WorkspaceFilterBarProps = {
  /** The live criteria. Fully controlled — this bar holds no criteria state. */
  criteria: SharedCriteria
  /** Every edit, already debounced for the search box. */
  onChange: (next: SharedCriteria) => void
  /**
   * Panes that could not honour a live criterion, from `mapCriteriaForTable` /
   * `mapCriteriaForWidget`. Omitted or empty ⇒ every pane is filtered.
   */
  unmappedByPane?: UnmappedPaneReport[]
  /**
   * `true` = "Wspólne": this bar drives every pane. `false` = "Per tabela":
   * each pane keeps its own search and filters, and the bar's search and
   * criteria are shown disabled rather than removed, so switching back is one
   * click and the layout does not jump.
   */
  shared?: boolean
  /** Switch between the two modes. */
  onSharedChange?: (shared: boolean) => void
  /** Back to per-pane control. Kept for callers that only know "off". */
  onToggleOff?: () => void
  /** Host controls on the right end of the bar — add widget, layouts, full screen. */
  trailing?: React.ReactNode
  className?: string
}

// ─── Criterion editor ────────────────────────────────────────────────────────

type EditorProps = {
  rule: SharedCriterionRule
  anchorEl: HTMLElement
  onApply: (next: SharedCriterionRule) => void
  onRemove: () => void
  onClose: () => void
}

/**
 * Operator + the editor that operator needs, and nothing else — the same three
 * branches `ColumnFilterPopover` and `ConfigureViewFilters` render, off the
 * same predicates, so the workspace bar cannot disagree with the column funnel
 * about what an operator means.
 *
 * Values for a non-date criterion are typed, not ticked: this bar has no data
 * source of its own (the panes hold different entities, so there is no one list
 * of "customers" to offer), and inventing one per criterion would be a lookup
 * service this feature does not need.
 */
function CriterionEditor({ rule, anchorEl, onApply, onRemove, onClose }: EditorProps) {
  const t = useT()
  const type = criterionType(rule.key)
  const operators = React.useMemo(() => getOperatorsForType(type), [type])

  const [operator, setOperator] = React.useState<FilterOperator>(rule.operator)
  const [values, setValues] = React.useState<string[]>(() => rule.values.map((v) => String(v ?? '')))

  const isRange = needsRangeValues(operator)
  const isRelative = needsRelativeInput(operator)
  const isPicker = type === 'date' && !isRange && isDateOperator(operator)
  const takesValue = needsValueInput(operator)

  // Switching operator resets the values so the editor's shape and the stored
  // pair never disagree (range → single, single → count+unit, → none).
  const changeOperator = React.useCallback((next: string) => {
    setOperator(next as FilterOperator)
    setValues([])
  }, [])

  const setSlot = React.useCallback((index: 0 | 1, value: string) => {
    setValues((prev) => {
      const next = [prev[0] ?? '', prev[1] ?? '']
      next[index] = value
      return next
    })
  }, [])

  const commitValues = React.useCallback((): string[] => {
    if (!takesValue) return []
    if (isRange) {
      const from = (values[0] ?? '').trim()
      const to = (values[1] ?? '').trim()
      // A half-filled range is a legitimate filter — the server leaves the
      // missing side unbounded — so only a range with both ends blank is "no rule".
      return from || to ? [from, to] : []
    }
    if (isRelative) {
      const count = (values[0] ?? '').trim()
      return count ? [count, values[1] || 'days'] : []
    }
    if (type === 'text') {
      // Comma-separated, because `is_any_of` is the default and "Maersk, MSC"
      // is how a dispatcher writes two customers.
      return (values[0] ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    }
    const single = (values[0] ?? '').trim()
    return single ? [single] : []
  }, [takesValue, isRange, isRelative, type, values])

  const apply = React.useCallback(() => {
    onApply({ key: rule.key, operator, values: commitValues() })
    onClose()
  }, [commitValues, operator, onApply, onClose, rule.key])

  // ── Placement and dismissal — same contract as the column funnel ──
  const popoverRef = React.useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState(() => ({
    top: -9999,
    left: -9999,
    maxHeight: POPOVER_HEIGHT,
    flipAbove: false,
  }))

  const reposition = React.useCallback(() => {
    if (!anchorEl.isConnected) {
      onClose()
      return
    }
    setPosition(
      computeAnchoredPosition(
        anchorEl.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        { width: POPOVER_WIDTH, preferredHeight: POPOVER_HEIGHT, minHeight: 180 },
      ),
    )
  }, [anchorEl, onClose])

  React.useLayoutEffect(() => {
    reposition()
  }, [reposition])

  React.useEffect(() => {
    const onScroll = (e: Event) => {
      if (popoverRef.current?.contains(e.target as Node)) return
      reposition()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', reposition)
    }
  }, [reposition])

  React.useEffect(() => {
    // CAPTURE, and the nested portals excluded: the calendar and the operator
    // menu are React children of this popover but DOM children of <body>, so a
    // plain `contains` check dismisses the editor the instant one is opened.
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (popoverRef.current?.contains(target)) return
      if (target instanceof Element && target.closest(NESTED_POPUP_SELECTOR)) return
      onClose()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [onClose])

  useEscapeLayer(true, onClose)

  const content = (
    <div
      ref={popoverRef}
      className="hot-quick-filter hot-appearance-v2"
      role="dialog"
      aria-label={criterionLabel(t, rule.key)}
      data-workspace-criterion={rule.key}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: POPOVER_WIDTH,
        maxHeight: position.maxHeight,
        zIndex: 10001,
        ...(position.flipAbove ? { transform: 'translateY(-100%)' } : {}),
      }}
    >
      <div className="hot-quick-filter-date">
        <label className="hot-quick-filter-date-field">
          <span className="hot-quick-filter-date-label text-body-medium-sm">
            {t('dynamicTable.quickFilter.condition', 'Condition')}
          </span>
          <SelectMenu
            value={operator}
            onChange={changeOperator}
            options={operators.map((op) => ({
              value: op.value,
              label: t(`dynamicTable.filter.operator.${op.value}`, op.label),
            }))}
            className="hot-config-filter-select hot-quick-filter-control"
            ariaLabel={t('dynamicTable.quickFilter.condition', 'Condition')}
            dataAttributes={{ 'data-workspace-criterion-operator': operator }}
          />
        </label>

        {type === 'text' && takesValue && (
          <label className="hot-quick-filter-date-field">
            <span className="hot-quick-filter-date-label text-body-medium-sm">
              {t('splitView.sharedFilter.values', 'Values')}
            </span>
            <input
              type="text"
              autoFocus
              className="hot-config-filter-input hot-quick-filter-control"
              value={values[0] ?? ''}
              onChange={(e) => setSlot(0, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  apply()
                }
              }}
              placeholder={t('splitView.sharedFilter.valuesPlaceholder', 'Comma-separated')}
              aria-label={t('splitView.sharedFilter.values', 'Values')}
              data-workspace-criterion-values=""
            />
          </label>
        )}

        {isRange && (
          <>
            <label className="hot-quick-filter-date-field" data-workspace-range="from">
              <span className="hot-quick-filter-date-label text-body-medium-sm">
                {t('dynamicTable.quickFilter.from', 'From')}
              </span>
              <FilterDatePicker
                value={values[0] ?? ''}
                onChange={(v) => setSlot(0, v)}
                ariaLabel={t('dynamicTable.quickFilter.from', 'From')}
                placeholder={t('dynamicTable.quickFilter.pickDate', 'Pick date')}
                className="hot-quick-filter-control"
                zIndex={NESTED_POPUP_Z}
              />
            </label>
            <label className="hot-quick-filter-date-field" data-workspace-range="to">
              <span className="hot-quick-filter-date-label text-body-medium-sm">
                {t('dynamicTable.quickFilter.to', 'To')}
              </span>
              <FilterDatePicker
                value={values[1] ?? ''}
                onChange={(v) => setSlot(1, v)}
                ariaLabel={t('dynamicTable.quickFilter.to', 'To')}
                placeholder={t('dynamicTable.quickFilter.pickDate', 'Pick date')}
                className="hot-quick-filter-control"
                zIndex={NESTED_POPUP_Z}
              />
            </label>
          </>
        )}

        {isPicker && (
          <label className="hot-quick-filter-date-field" data-workspace-range="single">
            <span className="hot-quick-filter-date-label text-body-medium-sm">
              {t('dynamicTable.quickFilter.date', 'Date')}
            </span>
            <FilterDatePicker
              value={values[0] ?? ''}
              onChange={(v) => setSlot(0, v)}
              ariaLabel={t('dynamicTable.quickFilter.date', 'Date')}
              placeholder={t('dynamicTable.quickFilter.pickDate', 'Pick date')}
              className="hot-quick-filter-control"
              zIndex={NESTED_POPUP_Z}
            />
          </label>
        )}

        {isRelative && (
          // A moving window, not a calendar date: "next 7 days" has to keep
          // meaning that tomorrow, so what is stored is [count, unit].
          <div className="hot-quick-filter-date-field hot-quick-filter-relative">
            <span className="hot-quick-filter-date-label text-body-medium-sm">
              {t('dynamicTable.quickFilter.window', 'Window')}
            </span>
            <div className="hot-quick-filter-relative-row">
              <input
                type="number"
                min={1}
                step={1}
                className="hot-config-filter-input hot-quick-filter-control hot-quick-filter-count"
                value={values[0] ?? ''}
                onChange={(e) => setSlot(0, e.target.value)}
                placeholder={t('dynamicTable.quickFilter.count', 'count')}
                aria-label={t('dynamicTable.quickFilter.count', 'count')}
              />
              <SelectMenu
                value={values[1] || 'days'}
                onChange={(next) => setSlot(1, next)}
                options={RELATIVE_DATE_UNITS.map((u) => ({
                  value: u,
                  label: t(`dynamicTable.filter.unit.${u}`, u),
                }))}
                className="hot-config-filter-select hot-quick-filter-control"
                ariaLabel={t('dynamicTable.quickFilter.unit', 'Unit')}
              />
            </div>
          </div>
        )}

        {!takesValue && (
          <p className="hot-quick-filter-note text-body-regular-xs">
            {t(
              'dynamicTable.quickFilter.presetHint',
              'Applies to {condition}, recalculated every time.',
              { condition: t(`dynamicTable.filter.operator.${operator}`, operator) },
            )}
          </p>
        )}
      </div>

      <div className="hot-quick-filter-footer">
        <Button variant="ghost" size="xs" onClick={onRemove} data-workspace-criterion-remove="">
          {t('splitView.sharedFilter.remove', 'Remove')}
        </Button>
        <Button variant="primary" size="xs" onClick={apply} data-workspace-criterion-apply="">
          {t('dynamicTable.quickFilter.apply', 'Apply')}
        </Button>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return content
  return ReactDOM.createPortal(content, document.body)
}

// ─── Labels ──────────────────────────────────────────────────────────────────

type Translate = ReturnType<typeof useT>

const CRITERION_FALLBACKS: Record<SharedCriterionKey, string> = {
  customer: 'Customer',
  dateRange: 'Date',
  status: 'Status',
  transportMode: 'Mode',
}

function criterionLabel(t: Translate, key: SharedCriterionKey): string {
  return t(`splitView.sharedFilter.criterion.${key}`, CRITERION_FALLBACKS[key])
}

/** What the chip says after the criterion name. Never longer than the chip. */
function ruleSummary(t: Translate, rule: SharedCriterionRule): string {
  if (!needsValueInput(rule.operator)) {
    return t(`dynamicTable.filter.operator.${rule.operator}`, rule.operator)
  }
  if (rule.values.length === 0) return t('splitView.sharedFilter.any', 'any')
  return rule.values.map((v) => String(v ?? '')).filter(Boolean).join(', ')
}

// ─── Bar ─────────────────────────────────────────────────────────────────────

export function WorkspaceFilterBar({
  criteria,
  onChange,
  unmappedByPane,
  onToggleOff,
  shared = true,
  onSharedChange,
  trailing,
  className,
}: WorkspaceFilterBarProps) {
  const setShared = (next: boolean) => {
    if (next === shared) return
    if (onSharedChange) onSharedChange(next)
    else if (!next) onToggleOff?.()
  }
  const t = useT()
  const [editing, setEditing] = React.useState<{ key: SharedCriterionKey; anchorEl: HTMLElement } | null>(null)

  // Criteria can arrive from a saved workspace row, i.e. from JSON that predates
  // this shape. A missing `rules` must render an empty bar, not throw the whole
  // workspace away.
  const rules = criteria.rules ?? []

  // Latest props for the debounce timer, which fires outside the render that
  // scheduled it.
  const latest = React.useRef({ criteria, onChange })
  latest.current = { criteria, onChange }

  const emit = React.useCallback((next: SharedCriteria) => {
    latest.current.onChange(next)
  }, [])

  // ── Search, debounced ──
  //
  // The box is typed into far faster than four panes can answer, so the draft
  // is local and only the settled value fans out. `lastEmitted` is what keeps
  // an external change (opening a saved workspace) from being swallowed by a
  // draft the user never touched.
  const [draft, setDraft] = React.useState(criteria.search ?? '')
  const lastEmitted = React.useRef(criteria.search ?? '')

  React.useEffect(() => {
    const incoming = criteria.search ?? ''
    if (incoming === lastEmitted.current) return
    lastEmitted.current = incoming
    setDraft(incoming)
  }, [criteria.search])

  React.useEffect(() => {
    if (draft === lastEmitted.current) return
    const timer = setTimeout(() => {
      lastEmitted.current = draft
      emit({ ...latest.current.criteria, search: draft })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, emit])

  // ── Rules ──

  const setRule = React.useCallback(
    (next: SharedCriterionRule) => {
      const current = criteria.rules ?? []
      const nextRules = current.some((r) => r.key === next.key)
        ? current.map((r) => (r.key === next.key ? next : r))
        : [...current, next]
      emit({ ...criteria, rules: nextRules })
    },
    [criteria, emit],
  )

  const removeRule = React.useCallback(
    (key: SharedCriterionKey) => {
      emit({ ...criteria, rules: (criteria.rules ?? []).filter((r) => r.key !== key) })
    },
    [criteria, emit],
  )

  const available = SHARED_CRITERION_KEYS.filter((key) => !rules.some((r) => r.key === key))

  const addCriterion = React.useCallback(
    (key: string) => {
      if (!key) return
      const criterion = key as SharedCriterionKey
      // Added EMPTY and opened for editing rather than applied blind: a rule
      // with no values would narrow every pane to nothing the moment it lands.
      setRule({ key: criterion, operator: defaultOperator(criterion), values: [] })
      // The chip mounts on the next render; anchor the editor to it then.
      requestAnimationFrame(() => {
        const chip = document.querySelector<HTMLElement>(`[data-workspace-chip="${criterion}"]`)
        if (chip) setEditing({ key: criterion, anchorEl: chip })
      })
    },
    [setRule],
  )

  // ── Unmapped panes ──
  //
  // Summarised per CRITERION, not per pane: "2 panes are not filtered by
  // customer" is the sentence the user needs, and the pane names go in the
  // tooltip rather than a second row.
  const unmappedSummary = React.useMemo(() => {
    const byKey = new Map<SharedCriterionKey, string[]>()
    for (const pane of unmappedByPane ?? []) {
      for (const key of pane.unmapped) {
        const panes = byKey.get(key) ?? []
        panes.push(pane.title)
        byKey.set(key, panes)
      }
    }
    return Array.from(byKey.entries())
  }, [unmappedByPane])

  const editingRule = editing ? rules.find((r) => r.key === editing.key) : undefined

  return (
    // ONE row on the page surface, above the panes — the prototype's
    // "pasek nadrzędny". Controls are outlined 32px pills, the same height as
    // the grid toolbar's icon buttons, so the bar and the toolbars beneath it
    // line up. No tinted strip behind them: the page surface IS the strip.
    <div
      // A size container: when the bar is narrow its secondary labels collapse
      // to icons (see the `@max-[…]/wsbar:` classes here and in
      // WorkspaceActions) instead of pushing controls off the right edge.
      className={`@container/wsbar mb-2 flex h-9 min-w-0 shrink-0 items-center gap-2 ${className ?? ''}`.trim()}
      role="search"
      aria-label={t('splitView.sharedFilter.title', 'Workspace filter')}
      data-workspace-filter-bar=""
      data-workspace-scope={shared ? 'shared' : 'per-pane'}
    >
      <SearchInput
        /* NOT `type="search"`: Chrome paints its own cancel "×" on a search
           input, right beside the primitive's clear button. */
        type="text"
        inputSize="sm"
        className="h-9 min-w-[9rem] flex-1"
        /* The pill overrides go through `style`, not through classes.
           `primitives-v2/utils#cn` is a plain string join with no
           tailwind-merge, so `rounded-m3-full` and the primitive's own
           `rounded-md` would BOTH land on the element and the winner would be
           whichever Tailwind happened to emit last. Inline wins deterministically. */
        style={{
          borderRadius: 'var(--m3-shape-full)',
          borderColor: 'var(--m3-outline-variant)',
          backgroundColor: 'var(--m3-surface-container-lowest)',
        }}
        value={draft}
        disabled={!shared}
        onChange={(e) => setDraft(e.target.value)}
        onClear={() => setDraft('')}
        placeholder={t('splitView.sharedFilter.search', 'Search all panes…')}
        aria-label={t('splitView.sharedFilter.search', 'Search all panes…')}
        title={shared ? undefined : t('splitView.sharedFilter.perPaneHint', 'Each pane searches on its own — switch to “Shared” to search them all')}
        data-workspace-search=""
      />

      {/* ONE chip per live criterion. M3's input chip puts the trailing "×"
          INSIDE the container — so the chip is the outer element and the
          remove button nests in it. `data-workspace-chip` MUST stay on that
          outer element: `addCriterion` anchors the editor popover to it. The
          outer element is a `role="button"` span, not a `<button>` — a button
          cannot legally contain another button. */}
      {shared && rules.map((rule) => {
        // "Active" = the rule actually narrows something. A criterion added
        // but never filled in is deliberately NOT tinted: the blue container
        // is the app's one selection signal, and an empty rule has selected
        // nothing yet.
        const isActive = rule.values.length > 0 || !needsValueInput(rule.operator)
        const open = (anchorEl: HTMLElement) => setEditing({ key: rule.key, anchorEl })
        return (
          <span
            key={rule.key}
            role="button"
            tabIndex={0}
            onClick={(e) => open(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              open(e.currentTarget)
            }}
            className={`flex h-9 max-w-56 shrink-0 cursor-pointer items-center gap-1 rounded-m3-full border px-3 transition-colors ${
              isActive
                ? 'border-transparent bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)] hover:bg-[var(--m3-row-selected-hover)]'
                : 'border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-lowest)] text-[var(--m3-on-surface)] hover:bg-[var(--m3-container-hover)]'
            }`}
            data-workspace-chip={rule.key}
            title={`${criterionLabel(t, rule.key)}: ${ruleSummary(t, rule)}`}
          >
            <span className="shrink-0 text-label-medium-md">{criterionLabel(t, rule.key)}</span>
            <span className={`truncate text-body-regular-xs ${isActive ? '' : 'text-[var(--m3-on-surface-variant)]'}`}>
              {ruleSummary(t, rule)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                // The chip itself opens the editor; the "×" must not.
                e.stopPropagation()
                removeRule(rule.key)
              }}
              aria-label={t('splitView.sharedFilter.remove', 'Remove')}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-m3-full text-current transition-colors hover:bg-[var(--m3-state-layer-hover)]"
              data-workspace-chip-remove={rule.key}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        )
      })}

      {shared && available.length > 0 && (
        <SelectMenu
          /* A portal-rendered custom menu, never a native <select>. */
          value=""
          onChange={addCriterion}
          options={available.map((key) => ({ value: key, label: criterionLabel(t, key) }))}
          placeholder={t('splitView.sharedFilter.add', 'Filter')}
          className="hot-quick-filter-control h-9 shrink-0 gap-1.5 rounded-m3-full border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-lowest)] pl-3 pr-2.5 text-label-medium-md transition-colors hover:bg-[var(--m3-container-hover)]"
          ariaLabel={t('splitView.sharedFilter.add', 'Filter')}
          dataAttributes={{ 'data-workspace-add-criterion': '' }}
        />
      )}

      {/* Degradation as a TONAL chip rather than loose coloured text: it reads
          as a thing in the bar, at the same height as every other control. */}
      {shared && unmappedSummary.map(([key, panes]) => (
        <span
          key={key}
          className="flex h-9 shrink-0 items-center gap-1 rounded-m3-full bg-[var(--m3-error-container)] px-3 text-[var(--m3-on-error-container)]"
          title={t('splitView.sharedFilter.unmappedPanes', 'Not filtered: {panes}', {
            panes: panes.join(', '),
          })}
          data-workspace-unmapped={key}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="text-body-regular-xs @max-[1400px]/wsbar:hidden">
            {t('splitView.sharedFilter.unmapped', '{count} not filtered by {criterion}', {
              count: String(panes.length),
              criterion: criterionLabel(t, key),
            })}
          </span>
          <span className="hidden text-label-semibold-xs @max-[1400px]/wsbar:inline" aria-hidden="true">
            {panes.length}
          </span>
        </span>
      ))}

      {/* "Wspólne | Per tabela" — an M3 connected button group. The current
          mode takes the same `secondary-container` every other selection in
          the app uses, and the other mode is one click away. */}
      <div
        className="flex h-9 shrink-0 items-center overflow-hidden rounded-m3-full border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-lowest)]"
        role="radiogroup"
        aria-label={t('splitView.sharedFilter.scope', 'Filter scope')}
      >
        {([true, false] as const).map((value) => {
          const on = shared === value
          return (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setShared(value)}
              className={`flex h-full items-center px-3 text-label-medium-md transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard ${
                value ? '' : 'border-l border-[var(--m3-outline-variant)]'
              } ${
                on
                  ? 'bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]'
                  : 'text-[var(--m3-on-surface-variant)] hover:bg-[var(--m3-state-layer-hover)] hover:text-[var(--m3-on-surface)]'
              }`}
              title={value
                ? t('splitView.sharedFilter.toggleOnHint', 'Drive every pane from this search and filter')
                : t('splitView.sharedFilter.toggleOffHint', 'Give every pane its own search back')}
              {...(value ? { 'data-workspace-filter-on': '' } : { 'data-workspace-filter-off': '' })}
            >
              {value
                ? t('splitView.sharedFilter.toggleOnLabel', 'Shared')
                : t('splitView.sharedFilter.toggleOff', 'Per pane')}
            </button>
          )
        })}
      </div>

      {trailing && (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-[var(--m3-outline-variant)]" aria-hidden="true" />
          {trailing}
        </>
      )}

      {editing && editingRule && (
        <CriterionEditor
          rule={editingRule}
          anchorEl={editing.anchorEl}
          onApply={setRule}
          onRemove={() => {
            removeRule(editing.key)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

export default WorkspaceFilterBar
