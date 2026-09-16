// formula/evaluate.ts
//
// The AST walker. It is a plain recursive function over five node kinds.
//
// There is no `eval`, no `new Function`, no template interpolation into SQL and
// no dynamic property access into host objects — a formula can read the row it
// is handed and nothing else. That is enforced structurally (the language has
// no syntax for anything else) and asserted mechanically by
// `__tests__/formula.noEval.test.ts`.
//
// Null propagates: an arithmetic operand that is empty makes the whole result
// empty. It never becomes `0` and it never becomes `NaN`.

import type {
  FormulaAst,
  FormulaCellResult,
  FormulaColumnRef,
  FormulaFieldMeta,
  FormulaIssue,
  FormulaResultType,
  FormulaValue,
} from './types';
import { collectFieldRefs, parseFormula } from './parse';
import {
  EMPTY,
  fail,
  lookupFormulaFunction,
  ok,
  toBoolean,
  toDate,
  toNumber,
  toText,
  type EvalOutcome,
  type FormulaRuntime,
} from './functions';
import { checkFormulaColumn } from './check';

export interface EvaluateOptions {
  /** Column metadata, used to name a column in a `type_mismatch` message. */
  fields?: ReadonlyMap<string, FormulaFieldMeta>;
  /** Injectable clock so `TODAY()` is deterministic under test. */
  now?: () => Date;
  /**
   * Results of formula columns already evaluated for this row. A field
   * reference resolves here first, which is how one formula reads another.
   */
  computed?: ReadonlyMap<string, FormulaCellResult>;
}

// ============================================
// CORE WALKER
// ============================================

/** Normalise a raw row value into the evaluator's value domain. */
function normalise(raw: unknown): FormulaValue {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  const type = typeof raw;
  if (type === 'number' || type === 'string' || type === 'boolean') return raw as FormulaValue;
  // Objects and arrays have no meaning in a same-row language; treating them as
  // empty is safer than stringifying `[object Object]` into a total.
  return null;
}

/**
 * Evaluate one AST against one row. Never throws — every failure is an
 * `EvalOutcome` carrying the issue that will be shown in that cell.
 */
export function evaluateAst(
  ast: FormulaAst,
  row: Record<string, unknown>,
  options: EvaluateOptions = {},
): EvalOutcome {
  const nowFn = options.now ?? (() => new Date());
  const fields = options.fields;
  const computed = options.computed;

  const runtime: FormulaRuntime = {
    evaluateNode: (node) => walk(node),
    now: nowFn,
  };

  const nameOf = (node: FormulaAst): string => {
    if (node.k === 'field') return fields?.get(node.name)?.label ?? node.name;
    if (node.k === 'call') return `${node.fn}()`;
    return 'value';
  };

  function walk(node: FormulaAst): EvalOutcome {
    switch (node.k) {
      case 'lit':
        return ok(node.v);

      case 'field': {
        const upstream = computed?.get(node.name);
        if (upstream) {
          // A formula reading another formula inherits its error rather than
          // inventing a fresh one — the user needs to fix the upstream cell.
          if (upstream.state === 'error') return { ok: false, issue: upstream.issue };
          return ok(upstream.value);
        }
        return ok(normalise(row[node.name]));
      }

      case 'neg': {
        const inner = walk(node.e);
        if (!inner.ok) return inner;
        const n = toNumber(inner.value, nameOf(node.e));
        if (!n.ok || n.value === null) return n;
        return ok(-(n.value as number));
      }

      case 'call': {
        const def = lookupFormulaFunction(node.fn);
        if (!def) {
          return fail('unknown_function', `Unknown function: ${node.fn}`, { name: node.fn });
        }
        if (node.args.length < def.minArgs || node.args.length > def.maxArgs) {
          return fail('arity', `${def.name} takes ${def.signature}`, {
            name: def.name,
            signature: def.signature,
          });
        }
        if (def.lazy && def.callLazy) return def.callLazy(node.args, runtime);

        const values: FormulaValue[] = [];
        for (const arg of node.args) {
          const result = walk(arg);
          if (!result.ok) return result;
          if (result.value === null && def.nullPolicy !== 'accept') return EMPTY;
          values.push(result.value);
        }
        if (!def.call) return EMPTY;
        return def.call(values, runtime);
      }

      case 'bin':
        return walkBinary(node);

      default:
        return EMPTY;
    }
  }

  function walkBinary(node: Extract<FormulaAst, { k: 'bin' }>): EvalOutcome {
    const { op } = node;

    // `&&` / `||` short-circuit, so the right operand is not evaluated at all
    // when the left decides the answer.
    if (op === '&&' || op === '||') {
      const left = walk(node.l);
      if (!left.ok) return left;
      const lb = toBoolean(left.value, nameOf(node.l));
      if (!lb.ok) return lb;
      if (lb.value === null) return EMPTY;
      if (op === '&&' && lb.value === false) return ok(false);
      if (op === '||' && lb.value === true) return ok(true);
      const right = walk(node.r);
      if (!right.ok) return right;
      const rb = toBoolean(right.value, nameOf(node.r));
      if (!rb.ok || rb.value === null) return rb;
      return ok(rb.value);
    }

    const left = walk(node.l);
    if (!left.ok) return left;
    const right = walk(node.r);
    if (!right.ok) return right;

    if (op === 'concat') {
      const l = toText(left.value);
      if (!l.ok) return l;
      const r = toText(right.value);
      if (!r.ok) return r;
      // Concatenation treats empty as the empty string; `'A' & null` is `'A'`,
      // not empty — otherwise every optional suffix would blank the column.
      const ls = l.value === null ? '' : (l.value as string);
      const rs = r.value === null ? '' : (r.value as string);
      if (left.value === null && right.value === null) return EMPTY;
      return ok(ls + rs);
    }

    if (op === '=' || op === '!=') {
      const equal = looseEquals(left.value, right.value);
      return ok(op === '=' ? equal : !equal);
    }

    if (op === '>' || op === '>=' || op === '<' || op === '<=') {
      if (left.value === null || right.value === null) return EMPTY;
      const cmp = compare(left.value, right.value, nameOf(node.r));
      if (!cmp.ok) return cmp;
      const c = cmp.value as number;
      switch (op) {
        case '>':
          return ok(c > 0);
        case '>=':
          return ok(c >= 0);
        case '<':
          return ok(c < 0);
        default:
          return ok(c <= 0);
      }
    }

    // Arithmetic.
    const l = toNumber(left.value, nameOf(node.l));
    if (!l.ok) return l;
    const r = toNumber(right.value, nameOf(node.r));
    if (!r.ok) return r;
    if (l.value === null || r.value === null) return EMPTY;

    const a = l.value as number;
    const b = r.value as number;
    switch (op) {
      case '+':
        return ok(a + b);
      case '-':
        return ok(a - b);
      case '*':
        return ok(a * b);
      case '/':
        if (b === 0) return fail('divide_by_zero', 'Cannot divide by zero');
        return ok(a / b);
      default:
        return EMPTY;
    }
  }

  /**
   * Equality across the value domain. Two empties are equal (as in Excel, where
   * blank equals blank); a date equals a date with the same instant; numbers
   * and numeric strings compare as numbers so `'10' = 10` is true.
   */
  function looseEquals(a: FormulaValue, b: FormulaValue): boolean {
    if (a === null || b === null) return a === b;
    if (a instanceof Date || b instanceof Date) {
      const da = toDate(a);
      const db = toDate(b);
      if (!da.ok || !db.ok || da.value === null || db.value === null) return false;
      return (da.value as Date).getTime() === (db.value as Date).getTime();
    }
    if (typeof a === 'number' || typeof b === 'number') {
      const na = toNumber(a);
      const nb = toNumber(b);
      if (na.ok && nb.ok && na.value !== null && nb.value !== null) return na.value === nb.value;
      return false;
    }
    return a === b;
  }

  /** Three-way comparison for ordering operators. */
  function compare(a: FormulaValue, b: FormulaValue, rightName: string): EvalOutcome {
    if (a instanceof Date || b instanceof Date) {
      const da = toDate(a, rightName);
      if (!da.ok) return da;
      const db = toDate(b, rightName);
      if (!db.ok) return db;
      if (da.value === null || db.value === null) return EMPTY;
      return ok(Math.sign((da.value as Date).getTime() - (db.value as Date).getTime()));
    }
    if (typeof a === 'string' && typeof b === 'string') {
      const na = Number(a.trim());
      const nb = Number(b.trim());
      if (a.trim() && b.trim() && !Number.isNaN(na) && !Number.isNaN(nb)) {
        return ok(Math.sign(na - nb));
      }
      return ok(Math.sign(a.localeCompare(b)));
    }
    const na = toNumber(a, rightName);
    if (!na.ok) return na;
    const nb = toNumber(b, rightName);
    if (!nb.ok) return nb;
    if (na.value === null || nb.value === null) return EMPTY;
    return ok(Math.sign((na.value as number) - (nb.value as number)));
  }

  return walk(ast);
}

// ============================================
// RESULT SHAPING
// ============================================

/** Coerce an evaluated value into the column's declared result type. */
export function coerceToResultType(
  outcome: EvalOutcome,
  resultType: FormulaResultType,
  label: string,
): FormulaCellResult {
  if (!outcome.ok) return { state: 'error', value: null, issue: outcome.issue };
  if (outcome.value === null) return { state: 'empty', value: null };

  let coerced: EvalOutcome;
  switch (resultType) {
    case 'number':
      coerced = toNumber(outcome.value, label);
      break;
    case 'text':
      coerced = toText(outcome.value);
      break;
    case 'boolean':
      coerced = toBoolean(outcome.value, label);
      break;
    default:
      coerced = toDate(outcome.value, label);
  }

  if (!coerced.ok) return { state: 'error', value: null, issue: coerced.issue };
  if (coerced.value === null) return { state: 'empty', value: null };
  return { state: 'ok', value: coerced.value };
}

// ============================================
// COLUMN SETS
// ============================================

export interface CompiledFormula {
  ref: FormulaColumnRef;
  ast: FormulaAst;
  /** Every field key the expression reads, formula keys included. */
  deps: string[];
}

export interface CompiledFormulaSet {
  /** Valid formulas in dependency order — an upstream formula evaluates first. */
  order: CompiledFormula[];
  /** Definition-time failures, keyed by formula column key. */
  invalid: Map<string, FormulaIssue>;
  fields: Map<string, FormulaFieldMeta>;
  /**
   * Union of every NON-formula field the set reads. The evaluator's cache
   * signature is built from exactly these, so a cache entry is invalidated when
   * an input changes and by nothing else.
   */
  inputKeys: string[];
}

/**
 * Validate and order a view's formula columns once, so per-row evaluation is a
 * walk and nothing more. Definition failures (syntax, unknown field, cycle) are
 * captured per key: one broken formula shows an error in its own column and
 * leaves every other column working.
 */
export function compileFormulaColumns(
  refs: readonly FormulaColumnRef[],
  fields: readonly FormulaFieldMeta[],
): CompiledFormulaSet {
  const fieldMap = new Map<string, FormulaFieldMeta>(fields.map((f) => [f.key, f]));
  const invalid = new Map<string, FormulaIssue>();
  const compiled = new Map<string, CompiledFormula>();

  for (const ref of refs) {
    const checked = checkFormulaColumn({ ref, fields, existing: refs });
    if (!checked.ok) {
      invalid.set(ref.key, checked.issues[0]);
      continue;
    }
    compiled.set(ref.key, { ref, ast: checked.ast, deps: collectFieldRefs(checked.ast) });
  }

  // Dependency order. Cycles are already refused above, so this terminates.
  const order: CompiledFormula[] = [];
  const placed = new Set<string>();
  const place = (key: string, seen: Set<string>): void => {
    if (placed.has(key) || seen.has(key)) return;
    const entry = compiled.get(key);
    if (!entry) return;
    seen.add(key);
    for (const dep of entry.deps) {
      if (compiled.has(dep)) place(dep, seen);
    }
    seen.delete(key);
    placed.add(key);
    order.push(entry);
  };
  for (const ref of refs) place(ref.key, new Set());

  const inputKeys = new Set<string>();
  for (const entry of order) {
    for (const dep of entry.deps) {
      if (!compiled.has(dep)) inputKeys.add(dep);
    }
  }

  return { order, invalid, fields: fieldMap, inputKeys: [...inputKeys] };
}

/**
 * Evaluate every formula column for one row, in dependency order.
 * Returns a result for EVERY declared key — including the invalid ones, whose
 * definition error is what that cell shows.
 */
export function evaluateFormulaRow(
  set: CompiledFormulaSet,
  row: Record<string, unknown>,
  options: { now?: () => Date } = {},
): Map<string, FormulaCellResult> {
  const computed = new Map<string, FormulaCellResult>();

  for (const [key, issue] of set.invalid) {
    computed.set(key, { state: 'error', value: null, issue });
  }

  for (const entry of set.order) {
    const outcome = evaluateAst(entry.ast, row, {
      fields: set.fields,
      now: options.now,
      computed,
    });
    computed.set(
      entry.ref.key,
      coerceToResultType(outcome, entry.ref.resultType, entry.ref.label),
    );
  }

  return computed;
}

/**
 * A row evaluator that computes each row at most once per change to its inputs.
 *
 * The cache is keyed on the row object AND a signature over just the fields the
 * formulas read. Object identity alone is not enough: the cell store mutates
 * `rowData` in place on an inline edit, so an identity-only cache would serve a
 * stale margin after the user changed the cost. The signature is over two or
 * three values, so it is far cheaper than re-walking the ASTs.
 */
export function createFormulaRowEvaluator(
  set: CompiledFormulaSet,
  options: { now?: () => Date } = {},
): (row: Record<string, unknown>) => Map<string, FormulaCellResult> {
  const cache = new WeakMap<object, { signature: string; results: Map<string, FormulaCellResult> }>();

  const signatureOf = (row: Record<string, unknown>): string =>
    set.inputKeys
      .map((key) => {
        const value = row[key];
        if (value === null || value === undefined) return ' ';
        if (value instanceof Date) return String(value.getTime());
        return String(value);
      })
      .join('');

  return (row) => {
    if (!row || typeof row !== 'object') return new Map();
    const signature = signatureOf(row);
    const hit = cache.get(row);
    if (hit && hit.signature === signature) return hit.results;
    const results = evaluateFormulaRow(set, row, options);
    cache.set(row, { signature, results });
    return results;
  };
}

/**
 * One-shot convenience: parse, check and evaluate a single expression against a
 * row. Used by the editor's live preview, where there is no compiled set yet.
 */
export function evaluateExpression(
  expression: string,
  row: Record<string, unknown>,
  fields: readonly FormulaFieldMeta[],
  resultType: FormulaResultType = 'number',
  options: { now?: () => Date } = {},
): FormulaCellResult {
  const parsed = parseFormula(expression);
  if (!parsed.ok) return { state: 'error', value: null, issue: parsed.issue };
  const outcome = evaluateAst(parsed.ast, row, {
    fields: new Map(fields.map((f) => [f.key, f])),
    now: options.now,
  });
  return coerceToResultType(outcome, resultType, expression);
}
