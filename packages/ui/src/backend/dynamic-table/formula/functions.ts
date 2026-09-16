// formula/functions.ts
//
// The curated function library. Every entry is total, side-effect free and
// deterministic given `FormulaRuntime.now()` — there is no I/O, no host reach
// and no way for a function to observe anything outside the row it is given.
//
// The set is grounded in the freight cases the spec names: margin, cost per
// unit, days between dates, conditional surcharge. Where Excel has an
// established name and behaviour, that name and behaviour is used verbatim;
// where it does not (`DAYS_BETWEEN`, `IS_EMPTY`), the name says what it does.
//
// This module imports nothing but `./types`, which is what keeps the
// evaluator ↔ library edge acyclic: the evaluator hands each function a
// `FormulaRuntime` rather than the library importing the evaluator.

import type {
  FormulaAst,
  FormulaErrorCode,
  FormulaIssue,
  FormulaResultType,
  FormulaValue,
  FormulaValueType,
} from './types';
import { formulaIssue } from './types';

/** Success or failure of one evaluation step. Never a thrown exception. */
export type EvalOutcome =
  | { ok: true; value: FormulaValue }
  | { ok: false; issue: FormulaIssue };

export function ok(value: FormulaValue): EvalOutcome {
  return { ok: true, value };
}

export function fail(
  code: FormulaErrorCode,
  message: string,
  params?: Record<string, string | number>,
): EvalOutcome {
  return { ok: false, issue: formulaIssue(code, message, params) };
}

/** The empty value. A null input yields empty — never `0`, never `NaN`. */
export const EMPTY: EvalOutcome = { ok: true, value: null };

/**
 * What the evaluator lends to a function: the ability to evaluate an
 * un-evaluated argument (lazy functions only) and a clock (so `TODAY()` is
 * testable).
 */
export interface FormulaRuntime {
  evaluateNode(node: FormulaAst): EvalOutcome;
  now(): Date;
}

export interface FormulaFunctionDef {
  name: string;
  minArgs: number;
  /** `Infinity` for variadic functions. */
  maxArgs: number;
  /**
   * Declared argument types for the checker. The LAST entry repeats for every
   * further argument of a variadic function.
   */
  argTypes: FormulaValueType[];
  /** Result type, or a rule over the actual argument types. */
  resultType: FormulaValueType | ((argTypes: FormulaValueType[]) => FormulaValueType);
  /**
   * `propagate` (default): a null argument short-circuits the whole call to
   * empty. `accept`: nulls reach the implementation, which decides — SUM
   * ignores blanks, COALESCE is entirely about them.
   */
  nullPolicy?: 'propagate' | 'accept';
  /** Lazy functions receive UNEVALUATED arguments (IF, IFERROR, AND, OR). */
  lazy?: boolean;
  call?(args: FormulaValue[], rt: FormulaRuntime): EvalOutcome;
  callLazy?(args: FormulaAst[], rt: FormulaRuntime): EvalOutcome;
  /** One-line description, shown in the editor's function list. */
  signature: string;
}

// ============================================
// COERCIONS
// ============================================

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Coerce to a number. A numeric *string* is accepted because the API commonly
 * returns money as a string; anything else is an honest `type_mismatch` rather
 * than a silent `NaN`.
 */
export function toNumber(value: FormulaValue, what = 'value'): EvalOutcome {
  if (value === null) return EMPTY;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return fail('type_mismatch', `${what} is not a number`, { name: what });
    return ok(value);
  }
  if (typeof value === 'boolean') return ok(value ? 1 : 0);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return EMPTY;
    const n = Number(trimmed);
    if (Number.isNaN(n)) return fail('type_mismatch', `${what} is not a number`, { name: what });
    return ok(n);
  }
  return fail('type_mismatch', `${what} is not a number`, { name: what });
}

/** Coerce to text. Dates render as `YYYY-MM-DD` so `&` never leaks a locale. */
export function toText(value: FormulaValue): EvalOutcome {
  if (value === null) return EMPTY;
  if (value instanceof Date) return ok(formatDate(value));
  return ok(String(value));
}

/** Coerce to boolean. `'true'`/`'false'` are accepted; other text is a mismatch. */
export function toBoolean(value: FormulaValue, what = 'value'): EvalOutcome {
  if (value === null) return EMPTY;
  if (typeof value === 'boolean') return ok(value);
  if (typeof value === 'number') return ok(value !== 0);
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (!lowered) return EMPTY;
    if (lowered === 'true' || lowered === '1') return ok(true);
    if (lowered === 'false' || lowered === '0') return ok(false);
  }
  return fail('type_mismatch', `${what} is not a true/false value`, { name: what });
}

/** Coerce to a Date. ISO strings only — no locale guessing, ever. */
export function toDate(value: FormulaValue, what = 'value'): EvalOutcome {
  if (value === null) return EMPTY;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return fail('type_mismatch', `${what} is not a date`, { name: what });
    }
    return ok(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return EMPTY;
    if (!ISO_DATE.test(trimmed)) return fail('type_mismatch', `${what} is not a date`, { name: what });
    // A date-only string is a LOCAL calendar date. `new Date('2026-01-25')`
    // would read it as UTC midnight, which is the previous day in every
    // timezone west of Greenwich — the classic off-by-one that makes
    // DAYS_BETWEEN wrong for half the world.
    const dateOnly = DATE_ONLY.exec(trimmed);
    const d = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(trimmed);
    if (Number.isNaN(d.getTime())) return fail('type_mismatch', `${what} is not a date`, { name: what });
    return ok(d);
  }
  return fail('type_mismatch', `${what} is not a date`, { name: what });
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Round half AWAY FROM ZERO, which is what Excel does and what an accountant
 * expects — JS `Math.round` rounds half UP, so `-2.5` would become `-2`.
 *
 * The shift is done through the exponent in the string form rather than by
 * multiplying: `1.005 * 100` is `100.49999999999999`, so a naive implementation
 * rounds a price DOWN by a grosz and nobody notices until the invoice does not
 * reconcile.
 */
export function roundHalfAwayFromZero(value: number, digits: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const shifted = Number(`${abs}e${digits}`);
  const rounded = Number.isFinite(shifted)
    ? Math.round(shifted)
    : Math.round(abs * 10 ** digits);
  const unshifted = Number(`${rounded}e${-digits}`);
  return sign * (Number.isFinite(unshifted) ? unshifted : rounded / 10 ** digits);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two dates, ignoring the time of day. */
function dayDelta(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

// ============================================
// HELPERS FOR THE REGISTRY
// ============================================

/** Fold a variadic numeric function, skipping blanks the way Excel does. */
function numericFold(
  name: string,
  args: FormulaValue[],
  fold: (values: number[]) => number,
): EvalOutcome {
  const numbers: number[] = [];
  for (const arg of args) {
    const n = toNumber(arg, name);
    if (!n.ok) return n;
    if (n.value === null) continue; // blanks are skipped, not zeroed
    numbers.push(n.value as number);
  }
  if (numbers.length === 0) return EMPTY;
  return ok(fold(numbers));
}

function unaryNumber(name: string, f: (n: number) => number) {
  return (args: FormulaValue[]): EvalOutcome => {
    const n = toNumber(args[0], name);
    if (!n.ok || n.value === null) return n;
    return ok(f(n.value as number));
  };
}

function unaryText(f: (s: string) => string | number) {
  return (args: FormulaValue[]): EvalOutcome => {
    const s = toText(args[0]);
    if (!s.ok || s.value === null) return s;
    return ok(f(s.value as string));
  };
}

function unaryDatePart(name: string, f: (d: Date) => number) {
  return (args: FormulaValue[]): EvalOutcome => {
    const d = toDate(args[0], name);
    if (!d.ok || d.value === null) return d;
    return ok(f(d.value as Date));
  };
}

/** The widest of two checker types; `unknown` absorbs everything. */
export function unifyTypes(a: FormulaValueType, b: FormulaValueType): FormulaValueType {
  if (a === b) return a;
  return 'unknown';
}

// ============================================
// THE LIBRARY
// ============================================

const DEFS: FormulaFunctionDef[] = [
  // --- Logic -------------------------------------------------------------
  {
    name: 'IF',
    signature: 'IF(condition, then, else)',
    minArgs: 3,
    maxArgs: 3,
    argTypes: ['boolean', 'unknown', 'unknown'],
    resultType: (types) => unifyTypes(types[1] ?? 'unknown', types[2] ?? 'unknown'),
    lazy: true,
    callLazy(args, rt) {
      const cond = rt.evaluateNode(args[0]);
      if (!cond.ok) return cond;
      const asBool = toBoolean(cond.value, 'condition');
      if (!asBool.ok) return asBool;
      // A blank condition takes the else branch — the same reading as Excel,
      // where a blank cell is falsey.
      return rt.evaluateNode(asBool.value === true ? args[1] : args[2]);
    },
  },
  {
    name: 'IFERROR',
    signature: 'IFERROR(value, fallback)',
    minArgs: 2,
    maxArgs: 2,
    argTypes: ['unknown', 'unknown'],
    resultType: (types) => unifyTypes(types[0] ?? 'unknown', types[1] ?? 'unknown'),
    lazy: true,
    callLazy(args, rt) {
      const primary = rt.evaluateNode(args[0]);
      if (primary.ok) return primary;
      return rt.evaluateNode(args[1]);
    },
  },
  {
    name: 'AND',
    signature: 'AND(a, b, …)',
    minArgs: 1,
    maxArgs: Infinity,
    argTypes: ['boolean'],
    resultType: 'boolean',
    lazy: true,
    callLazy(args, rt) {
      for (const arg of args) {
        const r = rt.evaluateNode(arg);
        if (!r.ok) return r;
        const b = toBoolean(r.value, 'AND');
        if (!b.ok) return b;
        if (b.value === null) return EMPTY;
        if (b.value === false) return ok(false); // short-circuit
      }
      return ok(true);
    },
  },
  {
    name: 'OR',
    signature: 'OR(a, b, …)',
    minArgs: 1,
    maxArgs: Infinity,
    argTypes: ['boolean'],
    resultType: 'boolean',
    lazy: true,
    callLazy(args, rt) {
      for (const arg of args) {
        const r = rt.evaluateNode(arg);
        if (!r.ok) return r;
        const b = toBoolean(r.value, 'OR');
        if (!b.ok) return b;
        if (b.value === null) return EMPTY;
        if (b.value === true) return ok(true); // short-circuit
      }
      return ok(false);
    },
  },
  {
    name: 'NOT',
    signature: 'NOT(value)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['boolean'],
    resultType: 'boolean',
    call(args) {
      const b = toBoolean(args[0], 'NOT');
      if (!b.ok || b.value === null) return b;
      return ok(!(b.value as boolean));
    },
  },
  {
    name: 'IS_EMPTY',
    signature: 'IS_EMPTY(value)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['unknown'],
    resultType: 'boolean',
    nullPolicy: 'accept',
    call(args) {
      const v = args[0];
      return ok(v === null || v === undefined || v === '');
    },
  },
  {
    name: 'COALESCE',
    signature: 'COALESCE(a, b, …)',
    minArgs: 1,
    maxArgs: Infinity,
    argTypes: ['unknown'],
    resultType: (types) => types.reduce<FormulaValueType>((acc, t) => unifyTypes(acc, t), types[0] ?? 'unknown'),
    nullPolicy: 'accept',
    call(args) {
      for (const arg of args) {
        if (arg !== null && arg !== '') return ok(arg);
      }
      return EMPTY;
    },
  },

  // --- Maths -------------------------------------------------------------
  {
    name: 'ABS',
    signature: 'ABS(number)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['number'],
    resultType: 'number',
    call: unaryNumber('ABS', Math.abs),
  },
  {
    name: 'ROUND',
    signature: 'ROUND(number, digits)',
    minArgs: 1,
    maxArgs: 2,
    argTypes: ['number', 'number'],
    resultType: 'number',
    call(args) {
      const n = toNumber(args[0], 'ROUND');
      if (!n.ok || n.value === null) return n;
      const dRaw = args.length > 1 ? toNumber(args[1], 'ROUND') : ok(0);
      if (!dRaw.ok) return dRaw;
      const digits = dRaw.value === null ? 0 : Math.trunc(dRaw.value as number);
      return ok(roundHalfAwayFromZero(n.value as number, digits));
    },
  },
  {
    name: 'CEILING',
    signature: 'CEILING(number)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['number'],
    resultType: 'number',
    call: unaryNumber('CEILING', Math.ceil),
  },
  {
    name: 'FLOOR',
    signature: 'FLOOR(number)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['number'],
    resultType: 'number',
    call: unaryNumber('FLOOR', Math.floor),
  },
  {
    name: 'MIN',
    signature: 'MIN(a, b, …)',
    minArgs: 1,
    maxArgs: Infinity,
    argTypes: ['number'],
    resultType: 'number',
    nullPolicy: 'accept',
    call: (args) => numericFold('MIN', args, (v) => Math.min(...v)),
  },
  {
    name: 'MAX',
    signature: 'MAX(a, b, …)',
    minArgs: 1,
    maxArgs: Infinity,
    argTypes: ['number'],
    resultType: 'number',
    nullPolicy: 'accept',
    call: (args) => numericFold('MAX', args, (v) => Math.max(...v)),
  },
  {
    name: 'SUM',
    signature: 'SUM(a, b, …)',
    minArgs: 1,
    maxArgs: Infinity,
    argTypes: ['number'],
    resultType: 'number',
    nullPolicy: 'accept',
    call: (args) => numericFold('SUM', args, (v) => v.reduce((a, b) => a + b, 0)),
  },
  {
    name: 'AVERAGE',
    signature: 'AVERAGE(a, b, …)',
    minArgs: 1,
    maxArgs: Infinity,
    argTypes: ['number'],
    resultType: 'number',
    nullPolicy: 'accept',
    call: (args) => numericFold('AVERAGE', args, (v) => v.reduce((a, b) => a + b, 0) / v.length),
  },
  {
    name: 'POWER',
    signature: 'POWER(base, exponent)',
    minArgs: 2,
    maxArgs: 2,
    argTypes: ['number', 'number'],
    resultType: 'number',
    call(args) {
      const base = toNumber(args[0], 'POWER');
      if (!base.ok || base.value === null) return base;
      const exp = toNumber(args[1], 'POWER');
      if (!exp.ok || exp.value === null) return exp;
      const result = (base.value as number) ** (exp.value as number);
      if (!Number.isFinite(result)) {
        return fail('type_mismatch', 'POWER is not a number', { name: 'POWER' });
      }
      return ok(result);
    },
  },
  {
    name: 'SQRT',
    signature: 'SQRT(number)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['number'],
    resultType: 'number',
    call(args) {
      const n = toNumber(args[0], 'SQRT');
      if (!n.ok || n.value === null) return n;
      if ((n.value as number) < 0) {
        return fail('type_mismatch', 'SQRT is not a number', { name: 'SQRT' });
      }
      return ok(Math.sqrt(n.value as number));
    },
  },
  {
    name: 'MOD',
    signature: 'MOD(number, divisor)',
    minArgs: 2,
    maxArgs: 2,
    argTypes: ['number', 'number'],
    resultType: 'number',
    call(args) {
      const a = toNumber(args[0], 'MOD');
      if (!a.ok || a.value === null) return a;
      const b = toNumber(args[1], 'MOD');
      if (!b.ok || b.value === null) return b;
      if (b.value === 0) return fail('divide_by_zero', 'Cannot divide by zero');
      return ok((a.value as number) % (b.value as number));
    },
  },

  // --- Text --------------------------------------------------------------
  {
    name: 'CONCAT',
    signature: 'CONCAT(a, b, …)',
    minArgs: 1,
    maxArgs: Infinity,
    argTypes: ['unknown'],
    resultType: 'text',
    nullPolicy: 'accept',
    call(args) {
      let out = '';
      for (const arg of args) {
        if (arg === null) continue; // blanks contribute nothing, as in Excel
        const s = toText(arg);
        if (!s.ok) return s;
        out += s.value === null ? '' : (s.value as string);
      }
      return ok(out);
    },
  },
  {
    name: 'UPPER',
    signature: 'UPPER(text)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['text'],
    resultType: 'text',
    call: unaryText((s) => s.toUpperCase()),
  },
  {
    name: 'LOWER',
    signature: 'LOWER(text)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['text'],
    resultType: 'text',
    call: unaryText((s) => s.toLowerCase()),
  },
  {
    name: 'TRIM',
    signature: 'TRIM(text)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['text'],
    resultType: 'text',
    call: unaryText((s) => s.trim()),
  },
  {
    name: 'LEN',
    signature: 'LEN(text)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['text'],
    resultType: 'number',
    call: unaryText((s) => s.length),
  },
  {
    name: 'LEFT',
    signature: 'LEFT(text, count)',
    minArgs: 2,
    maxArgs: 2,
    argTypes: ['text', 'number'],
    resultType: 'text',
    call(args) {
      const s = toText(args[0]);
      if (!s.ok || s.value === null) return s;
      const n = toNumber(args[1], 'LEFT');
      if (!n.ok || n.value === null) return n;
      return ok((s.value as string).slice(0, Math.max(0, Math.trunc(n.value as number))));
    },
  },
  {
    name: 'RIGHT',
    signature: 'RIGHT(text, count)',
    minArgs: 2,
    maxArgs: 2,
    argTypes: ['text', 'number'],
    resultType: 'text',
    call(args) {
      const s = toText(args[0]);
      if (!s.ok || s.value === null) return s;
      const n = toNumber(args[1], 'RIGHT');
      if (!n.ok || n.value === null) return n;
      const count = Math.max(0, Math.trunc(n.value as number));
      return ok(count === 0 ? '' : (s.value as string).slice(-count));
    },
  },
  {
    name: 'CONTAINS',
    signature: 'CONTAINS(text, search)',
    minArgs: 2,
    maxArgs: 2,
    argTypes: ['text', 'text'],
    resultType: 'boolean',
    call(args) {
      const haystack = toText(args[0]);
      if (!haystack.ok || haystack.value === null) return haystack;
      const needle = toText(args[1]);
      if (!needle.ok || needle.value === null) return needle;
      return ok(
        (haystack.value as string).toLowerCase().includes((needle.value as string).toLowerCase()),
      );
    },
  },
  {
    name: 'TEXT',
    signature: 'TEXT(value)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['unknown'],
    resultType: 'text',
    call: (args) => toText(args[0]),
  },
  {
    name: 'VALUE',
    signature: 'VALUE(text)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['unknown'],
    resultType: 'number',
    call: (args) => toNumber(args[0], 'VALUE'),
  },

  // --- Dates -------------------------------------------------------------
  {
    name: 'TODAY',
    signature: 'TODAY()',
    minArgs: 0,
    maxArgs: 0,
    argTypes: [],
    resultType: 'date',
    call(_args, rt) {
      const now = rt.now();
      return ok(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    },
  },
  {
    name: 'DAYS_BETWEEN',
    signature: 'DAYS_BETWEEN(from, to)',
    minArgs: 2,
    maxArgs: 2,
    argTypes: ['date', 'date'],
    resultType: 'number',
    call(args) {
      const from = toDate(args[0], 'DAYS_BETWEEN');
      if (!from.ok || from.value === null) return from;
      const to = toDate(args[1], 'DAYS_BETWEEN');
      if (!to.ok || to.value === null) return to;
      return ok(dayDelta(from.value as Date, to.value as Date));
    },
  },
  {
    name: 'DATE_ADD',
    signature: 'DATE_ADD(date, days)',
    minArgs: 2,
    maxArgs: 2,
    argTypes: ['date', 'number'],
    resultType: 'date',
    call(args) {
      const d = toDate(args[0], 'DATE_ADD');
      if (!d.ok || d.value === null) return d;
      const n = toNumber(args[1], 'DATE_ADD');
      if (!n.ok || n.value === null) return n;
      const base = d.value as Date;
      return ok(
        new Date(base.getFullYear(), base.getMonth(), base.getDate() + Math.trunc(n.value as number)),
      );
    },
  },
  {
    name: 'YEAR',
    signature: 'YEAR(date)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['date'],
    resultType: 'number',
    call: unaryDatePart('YEAR', (d) => d.getFullYear()),
  },
  {
    name: 'MONTH',
    signature: 'MONTH(date)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['date'],
    resultType: 'number',
    call: unaryDatePart('MONTH', (d) => d.getMonth() + 1),
  },
  {
    name: 'DAY',
    signature: 'DAY(date)',
    minArgs: 1,
    maxArgs: 1,
    argTypes: ['date'],
    resultType: 'number',
    call: unaryDatePart('DAY', (d) => d.getDate()),
  },
];

/** Name → definition. Names are canonical upper-case. */
export const FORMULA_FUNCTIONS: Readonly<Record<string, FormulaFunctionDef>> = Object.freeze(
  DEFS.reduce<Record<string, FormulaFunctionDef>>((acc, def) => {
    acc[def.name] = def;
    return acc;
  }, {}),
);

/** Every function name, sorted — the editor's "Available functions" list. */
export const FORMULA_FUNCTION_NAMES: readonly string[] = Object.freeze(
  DEFS.map((d) => d.name).sort(),
);

/** Signatures in list order, for the editor. */
export const FORMULA_FUNCTION_SIGNATURES: readonly { name: string; signature: string }[] =
  Object.freeze(DEFS.map((d) => ({ name: d.name, signature: d.signature })).sort((a, b) => a.name.localeCompare(b.name)));

/** Case-insensitive lookup — users type `if(...)` as often as `IF(...)`. */
export function lookupFormulaFunction(name: string): FormulaFunctionDef | undefined {
  return FORMULA_FUNCTIONS[name.toUpperCase()];
}

/** The declared type of argument `index`, honouring variadic repetition. */
export function declaredArgType(def: FormulaFunctionDef, index: number): FormulaValueType {
  if (def.argTypes.length === 0) return 'unknown';
  return def.argTypes[Math.min(index, def.argTypes.length - 1)];
}

/** The function's result type given the checker's view of its arguments. */
export function resolveResultType(
  def: FormulaFunctionDef,
  argTypes: FormulaValueType[],
): FormulaValueType {
  return typeof def.resultType === 'function' ? def.resultType(argTypes) : def.resultType;
}

/** Narrow a checker type to the four persistable result types. */
export function asResultType(type: FormulaValueType): FormulaResultType | undefined {
  return type === 'unknown' ? undefined : type;
}
