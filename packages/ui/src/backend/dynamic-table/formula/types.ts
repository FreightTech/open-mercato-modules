// formula/types.ts
//
// The shared vocabulary of the DynamicTable expression language.
//
// Everything here is deliberately *data*: the AST is a plain serialisable
// discriminated union with no methods, no closures and no host references, so
// the exact same definition that the browser walks today can later be walked by
// a server evaluator or lowered to a parameterised SQL expression without ever
// re-parsing the user's text.
//
// `FormulaColumnRef` is declared HERE rather than in `types/perspective.ts` on
// purpose: the perspective module is the table's spine, and a formula column is
// a leaf that depends on the language, not the other way round. Declaring it
// locally keeps the dependency edge pointing one way.

/**
 * Binary operators the language admits. `concat` is the `&` operator (string
 * concatenation, Excel's spelling); it is spelled out rather than punctuated so
 * a serialised AST stays readable in a saved view.
 */
export type FormulaBinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | '&&'
  | '||'
  | 'concat';

/**
 * The whole language. Five node kinds, no loops, no assignment, no property
 * access, no host-object reach — which is what makes AST-walking evaluation
 * safe and `eval` unnecessary.
 */
export type FormulaAst =
  | { k: 'lit'; v: number | string | boolean | null }
  | { k: 'field'; name: string }
  | { k: 'bin'; op: FormulaBinaryOp; l: FormulaAst; r: FormulaAst }
  | { k: 'neg'; e: FormulaAst }
  | { k: 'call'; fn: string; args: FormulaAst[] };

/** The type a formula column declares it produces. */
export type FormulaResultType = 'number' | 'text' | 'boolean' | 'date';

/**
 * A type as seen by the checker. `unknown` is the escape hatch for a column
 * whose `ColumnDef.type` the host never declared — it unifies with everything
 * so an undeclared column is never a false positive.
 */
export type FormulaValueType = FormulaResultType | 'unknown';

/** Every value the evaluator can hold. `null` is "empty", never `NaN` or `0`. */
export type FormulaValue = number | string | boolean | Date | null;

/**
 * A view-scoped calculated column. Rides in the perspectives `settings_json`
 * passthrough as `_formulas`, exactly as `_lookups` / `_aggregations` do.
 */
export interface FormulaColumnRef {
  /** `formula__<slug>` — the synthesised `ColumnDef.data`. */
  key: string;
  /** Column header, user-authored. */
  label: string;
  /** Source text, exactly as the user typed it. */
  expression: string;
  resultType: FormulaResultType;
}

/**
 * Every way a formula can be wrong. `syntax`, `unknown_field`,
 * `unknown_function`, `arity` and `cycle` are *definition-time* failures — the
 * editor refuses to save them. `type_mismatch` and `divide_by_zero` can be
 * either: caught at definition time when the checker can prove them, and per
 * cell at evaluation time when only the data reveals them.
 */
export type FormulaErrorCode =
  | 'syntax'
  | 'unknown_field'
  | 'unknown_function'
  | 'arity'
  | 'type_mismatch'
  | 'divide_by_zero'
  | 'cycle';

/** One problem with a formula, carrying everything needed to translate it. */
export interface FormulaIssue {
  code: FormulaErrorCode;
  /** Untranslated English, used as the `t()` fallback and in tests. */
  message: string;
  /** Interpolation params for the i18n string (`{name}`, `{token}`). */
  params?: Record<string, string | number>;
  /** 0-based offset into the source text, when the issue has a location. */
  position?: number;
}

/** Per-cell evaluation state, mirroring how `saveState` already works. */
export type FormulaCellState = 'ok' | 'empty' | 'error';

/**
 * The outcome of evaluating one formula against one row. `empty` is a
 * first-class state: a null input yields `empty`, never `0` and never `NaN`.
 */
export type FormulaCellResult =
  | { state: 'ok'; value: Exclude<FormulaValue, null> }
  | { state: 'empty'; value: null }
  | { state: 'error'; value: null; issue: FormulaIssue };

/**
 * What the checker and the evaluator know about a referenceable column. `type`
 * comes from `ColumnDef.type`; `unknown` when the host did not declare one.
 */
export interface FormulaFieldMeta {
  key: string;
  label?: string;
  type: FormulaValueType;
}

/** i18n keys for the error codes, so a caller never hand-maps them. */
export const FORMULA_ERROR_I18N_KEYS: Record<FormulaErrorCode, string> = {
  syntax: 'dynamicTable.formula.error.syntax',
  unknown_field: 'dynamicTable.formula.error.unknownField',
  unknown_function: 'dynamicTable.formula.error.unknownFunction',
  arity: 'dynamicTable.formula.error.arity',
  type_mismatch: 'dynamicTable.formula.error.typeMismatch',
  divide_by_zero: 'dynamicTable.formula.error.divideByZero',
  cycle: 'dynamicTable.formula.error.cycle',
};

/** The i18n key for an issue, for `t(key, issue.message, issue.params)`. */
export function formulaIssueI18nKey(issue: FormulaIssue): string {
  return FORMULA_ERROR_I18N_KEYS[issue.code];
}

/** Build an issue without repeating the object shape at 30 call sites. */
export function formulaIssue(
  code: FormulaErrorCode,
  message: string,
  params?: Record<string, string | number>,
  position?: number,
): FormulaIssue {
  const issue: FormulaIssue = { code, message };
  if (params) issue.params = params;
  if (position !== undefined) issue.position = position;
  return issue;
}
