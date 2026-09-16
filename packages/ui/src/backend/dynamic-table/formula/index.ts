// formula/index.ts
//
// Public surface of the DynamicTable expression language.
//
// Everything here is dependency-free and framework-free: no React, no network,
// no `@open-mercato/*`. That is deliberate — the same modules are intended to
// run server-side unchanged if formula columns are ever persisted (spec A2b).

export type {
  FormulaAst,
  FormulaBinaryOp,
  FormulaCellResult,
  FormulaCellState,
  FormulaColumnRef,
  FormulaErrorCode,
  FormulaFieldMeta,
  FormulaIssue,
  FormulaResultType,
  FormulaValue,
  FormulaValueType,
} from './types';
export { FORMULA_ERROR_I18N_KEYS, formulaIssue, formulaIssueI18nKey } from './types';

export type { FormulaToken, FormulaTokenType, ParseResult } from './parse';
export { collectFieldRefs, parseFormula, tokenize } from './parse';

export type {
  CheckFormulaColumnInput,
  CheckFormulaColumnResult,
  CheckResult,
  FormulaCheckContext,
} from './check';
export {
  checkAst,
  checkFormulaColumn,
  columnTypeToFormulaType,
  detectFormulaCycles,
  fieldMetaFromColumns,
} from './check';

export type { EvalOutcome, FormulaFunctionDef, FormulaRuntime } from './functions';
export {
  FORMULA_FUNCTIONS,
  FORMULA_FUNCTION_NAMES,
  FORMULA_FUNCTION_SIGNATURES,
  lookupFormulaFunction,
} from './functions';

export type { CompiledFormula, CompiledFormulaSet, EvaluateOptions } from './evaluate';
export {
  coerceToResultType,
  compileFormulaColumns,
  createFormulaRowEvaluator,
  evaluateAst,
  evaluateExpression,
  evaluateFormulaRow,
} from './evaluate';
