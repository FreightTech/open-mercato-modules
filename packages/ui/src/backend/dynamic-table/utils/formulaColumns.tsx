import * as React from 'react'
import type { ColumnDef } from '../types/index'
import type {
  FormulaCellResult,
  FormulaColumnRef,
  FormulaErrorCode,
  FormulaFieldMeta,
  FormulaResultType,
} from '../formula/types'
import { compileFormulaColumns, createFormulaRowEvaluator } from '../formula/evaluate'
import { formulaIssueI18nKey } from '../formula/types'

/**
 * Row field / column data key for a calculated column. Mirrors
 * `lookupColumnDataKey`'s `<prefix>__<tail>` convention so the two virtual
 * column kinds are told apart by prefix alone, on client and server both.
 */
export function formulaColumnDataKey(slug: string): string {
  return `formula__${slug}`
}

/** True when a column data key belongs to a calculated column. */
export function isFormulaColumnKey(key: string): boolean {
  return key.startsWith('formula__')
}

/**
 * Derive a stable slug from the user's label. Diacritics are stripped so a
 * Polish label (`Marża`) yields an ASCII key the server and URL params can
 * carry unescaped.
 */
export function slugifyFormulaLabel(label: string): string {
  const ascii = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
  return (
    ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'calc'
  )
}

/**
 * A key not already taken by another formula column. Two columns both called
 * "Margin" must not collide into one, so the second gets a numeric suffix.
 */
export function uniqueFormulaColumnKey(label: string, taken: readonly string[]): string {
  const base = formulaColumnDataKey(slugifyFormulaLabel(label))
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

/**
 * Excel's error tokens, because Excel's error tokens are what users already
 * read. Inventing our own vocabulary here would be a novel UX for no gain.
 */
const ERROR_TOKENS: Record<FormulaErrorCode, string> = {
  divide_by_zero: '#DIV/0!',
  type_mismatch: '#VALUE!',
  unknown_field: '#REF!',
  cycle: '#REF!',
  unknown_function: '#NAME?',
  syntax: '#NAME?',
  arity: '#NAME?',
}

/** The short token shown inside an errored formula cell. */
export function formulaErrorToken(code: FormulaErrorCode): string {
  return ERROR_TOKENS[code]
}

/**
 * Render a computed value as text. Floating-point noise (`0.1 + 0.2`) is
 * trimmed at the 10th decimal — enough to keep money and rates exact, short of
 * the precision where trimming would be a lie.
 */
export function formatFormulaValue(result: FormulaCellResult): string {
  if (result.state === 'empty') return ''
  if (result.state === 'error') return formulaErrorToken(result.issue.code)
  const value = result.value
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    return String(Number(value.toFixed(10)))
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  return String(value)
}

/** `ColumnDef.type` for a declared result type — drives alignment and sort UI. */
function columnTypeFor(resultType: FormulaResultType): ColumnDef['type'] {
  switch (resultType) {
    case 'number':
      return 'numeric'
    case 'date':
      return 'date'
    case 'boolean':
      return 'boolean'
    default:
      return 'text'
  }
}

export interface BuildFormulaColumnDefsOptions {
  /** Every column a formula may reference (native + linked). */
  fields: readonly FormulaFieldMeta[]
  /**
   * Translator for the per-cell error tooltip. Given the issue's i18n key, its
   * English fallback and its params. Defaults to the English fallback so the
   * util stays usable outside a React tree (tests, exports).
   */
  translate?: (key: string, fallback: string, params?: Record<string, string | number>) => string
  /** Injectable clock, so `TODAY()` is deterministic under test. */
  now?: () => Date
}

/**
 * Build read-only `ColumnDef`s for a perspective's calculated columns,
 * following `buildLookupColumnDefs`.
 *
 * The value is NOT attached to the row: it is computed by the renderer from the
 * row it is handed, through one shared evaluator whose cache guarantees each row
 * is walked at most once per change to the inputs the formulas actually read.
 *
 * Every column is `readOnly` and `disableFill` — a derived value has nowhere to
 * be written back to, so inline edit is refused rather than silently discarded.
 */
export function buildFormulaColumnDefs(
  refs: readonly FormulaColumnRef[],
  options: BuildFormulaColumnDefsOptions,
): ColumnDef[] {
  const translate = options.translate ?? ((_key, fallback) => fallback)
  const set = compileFormulaColumns(refs, options.fields)
  const evaluate = createFormulaRowEvaluator(set, { now: options.now })

  const resultFor = (ref: FormulaColumnRef, rowData: unknown): FormulaCellResult => {
    if (!rowData || typeof rowData !== 'object') return { state: 'empty', value: null }
    const results = evaluate(rowData as Record<string, unknown>)
    return results.get(ref.key) ?? { state: 'empty', value: null }
  }

  return refs.map((ref) => ({
    data: ref.key,
    title: ref.label,
    type: columnTypeFor(ref.resultType),
    align: ref.resultType === 'number' ? ('right' as const) : undefined,
    mono: ref.resultType === 'number',
    readOnly: true,
    disableFill: true,
    renderer: (_value: unknown, rowData: unknown) => {
      const result = resultFor(ref, rowData)
      if (result.state === 'error') {
        const title = translate(
          formulaIssueI18nKey(result.issue),
          result.issue.message,
          result.issue.params,
        )
        return (
          <span
            className="text-body-regular-sm text-destructive-v2"
            data-formula-key={ref.key}
            data-formula-state="error"
            data-formula-error={result.issue.code}
            title={title}
          >
            {formulaErrorToken(result.issue.code)}
          </span>
        )
      }
      if (result.state === 'empty') {
        return (
          <span
            className="text-body-regular-sm text-m3-on-surface-variant"
            data-formula-key={ref.key}
            data-formula-state="empty"
          >
            —
          </span>
        )
      }
      return (
        <span
          className="text-body-regular-sm"
          data-formula-key={ref.key}
          data-formula-state="ok"
        >
          {formatFormulaValue(result)}
        </span>
      )
    },
    // Exports carry the computed value, not the (absent) stored one. An errored
    // cell exports its Excel token so a spreadsheet reader sees the same thing
    // the grid showed rather than a silent blank.
    exportValue: (_value: unknown, rowData: unknown) => {
      const result = resultFor(ref, rowData)
      if (result.state === 'empty') return null
      if (result.state === 'ok' && typeof result.value === 'number') return result.value
      return formatFormulaValue(result)
    },
  }))
}

/**
 * Defensively parse the `_formulas` smuggled inside the perspective's `filters`
 * passthrough. Drops anything malformed so a legacy or hand-edited view can
 * never crash the table — the same contract as `parseLookupColumns`.
 */
export function parseFormulaColumns(raw: unknown): FormulaColumnRef[] {
  if (!Array.isArray(raw)) return []
  const valid: FormulaResultType[] = ['number', 'text', 'boolean', 'date']
  const out: FormulaColumnRef[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { key, label, expression, resultType } = entry as Record<string, unknown>
    if (typeof key !== 'string' || !isFormulaColumnKey(key)) continue
    if (typeof expression !== 'string' || !expression.trim()) continue
    if (out.some((r) => r.key === key)) continue
    out.push({
      key,
      label: typeof label === 'string' && label ? label : key,
      expression,
      resultType: valid.includes(resultType as FormulaResultType)
        ? (resultType as FormulaResultType)
        : 'text',
    })
  }
  return out
}
