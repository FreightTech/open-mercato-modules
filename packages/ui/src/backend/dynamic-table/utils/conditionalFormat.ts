// utils/conditionalFormat.ts
//
// User-authored conditional formatting ("Highlighting"). Rules are view-scoped:
// they ride inside the perspective's `settings.filters._conditionalFormats`
// passthrough, so switching views switches the highlighting.
//
// The rule type is declared HERE rather than in `types/perspective.ts` so this
// feature owns its own vocabulary; `PerspectiveConfig` picks it up through
// `ConditionalFormatCarrier` below.

/** Palette variants. Each maps 1:1 onto an existing `cell-*` class in DynamicTable.css. */
export type ConditionalFormatStyle =
  | 'green'
  | 'yellow'
  | 'red'
  | 'green-subtle'
  | 'yellow-subtle'
  | 'red-subtle';

export const CONDITIONAL_FORMAT_STYLES: readonly ConditionalFormatStyle[] = [
  'green',
  'yellow',
  'red',
  'green-subtle',
  'yellow-subtle',
  'red-subtle',
] as const;

export type ConditionalFormatOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'isEmpty'
  | 'isNotEmpty'
  /** `field` is chronologically before `compareField` — the ETA-vs-ATA delay case. */
  | 'beforeField'
  /** `field` is chronologically after `compareField`. */
  | 'afterField';

export const CONDITIONAL_FORMAT_OPERATORS: readonly ConditionalFormatOperator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'isEmpty',
  'isNotEmpty',
  'beforeField',
  'afterField',
] as const;

/** Operators that compare against another column instead of a literal. */
export const RELATIVE_OPERATORS: readonly ConditionalFormatOperator[] = ['beforeField', 'afterField'];

/** Operators that need no comparand at all. */
export const UNARY_OPERATORS: readonly ConditionalFormatOperator[] = ['isEmpty', 'isNotEmpty'];

export function operatorNeedsValue(op: ConditionalFormatOperator): boolean {
  return !UNARY_OPERATORS.includes(op) && !RELATIVE_OPERATORS.includes(op);
}

export function operatorNeedsCompareField(op: ConditionalFormatOperator): boolean {
  return RELATIVE_OPERATORS.includes(op);
}

export interface ConditionalFormatRule {
  /** `cf-<something unique>`. */
  id: string;
  /** `ColumnDef.data` key the rule paints. */
  field: string;
  operator: ConditionalFormatOperator;
  /** Literal comparand. Ignored by unary and relative operators. */
  value?: string | number | null;
  /** Other column's `data` key, for `beforeField` / `afterField`. */
  compareField?: string;
  style: ConditionalFormatStyle;
}

/**
 * Mixin that carries view-scoped highlighting rules on a `PerspectiveConfig`.
 * Declared here so `types/perspective.ts` does not have to change; once the
 * field is folded into `PerspectiveConfig` itself the intersection becomes a
 * harmless no-op.
 */
export interface ConditionalFormatCarrier {
  conditionalFormats?: ConditionalFormatRule[];
}

/**
 * Hard cap. Rules are evaluated on the cell render path, so an unbounded rule
 * set is a scroll-performance hazard. 20 is the spec's number.
 */
export const MAX_CONDITIONAL_FORMAT_RULES = 20;

export function generateConditionalFormatRuleId(): string {
  return `cf-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ─── Parsing (persistence boundary) ──────────────────────────────────────────

/**
 * Defensively parse `_conditionalFormats` out of the perspective settings
 * passthrough. Anything malformed is dropped rather than allowed to crash the
 * grid, and the list is capped.
 */
export function parseConditionalFormats(raw: unknown): ConditionalFormatRule[] {
  if (!Array.isArray(raw)) return [];
  const out: ConditionalFormatRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, field, operator, value, compareField, style } = entry as Record<string, unknown>;
    if (typeof field !== 'string' || !field) continue;
    if (
      typeof operator !== 'string' ||
      !(CONDITIONAL_FORMAT_OPERATORS as readonly string[]).includes(operator)
    )
      continue;
    if (typeof style !== 'string' || !(CONDITIONAL_FORMAT_STYLES as readonly string[]).includes(style))
      continue;
    const op = operator as ConditionalFormatOperator;
    if (operatorNeedsCompareField(op) && (typeof compareField !== 'string' || !compareField)) continue;
    out.push({
      id: typeof id === 'string' && id ? id : generateConditionalFormatRuleId(),
      field,
      operator: op,
      value:
        typeof value === 'string' || typeof value === 'number' ? value : value === null ? null : undefined,
      compareField: typeof compareField === 'string' && compareField ? compareField : undefined,
      style: style as ConditionalFormatStyle,
    });
    if (out.length >= MAX_CONDITIONAL_FORMAT_RULES) break;
  }
  return out;
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

type Predicate = (value: unknown, rowData: any) => boolean;

interface CompiledRule {
  test: Predicate;
  className: string;
}

/** Pre-compiled rule set: field -> ordered predicates. */
export interface CompiledConditionalFormats {
  byField: Map<string, CompiledRule[]>;
  /** `true` when there is nothing to evaluate — lets callers skip entirely. */
  isEmpty: boolean;
}

export const EMPTY_CONDITIONAL_FORMATS: CompiledConditionalFormats = {
  byField: new Map(),
  isEmpty: true,
};

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Comparable ordering key: a date if both sides parse as dates, else a number. */
function asComparable(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const n = asNumber(v);
  if (n !== null) return n;
  if (typeof v === 'string') {
    const t = Date.parse(v.trim());
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function compileRule(rule: ConditionalFormatRule): CompiledRule | null {
  const className = `cell-${rule.style}`;
  const literal = rule.value;

  switch (rule.operator) {
    case 'isEmpty':
      return { test: (v) => isBlank(v), className };
    case 'isNotEmpty':
      return { test: (v) => !isBlank(v), className };
    case 'contains': {
      const needle = String(literal ?? '').toLowerCase();
      if (!needle) return null;
      return { test: (v) => !isBlank(v) && String(v).toLowerCase().includes(needle), className };
    }
    case 'eq':
    case 'neq': {
      const wantNumber = asNumber(literal);
      const wantText = String(literal ?? '').toLowerCase();
      const eq: Predicate = (v) => {
        if (wantNumber !== null) {
          const n = asNumber(v);
          if (n !== null) return n === wantNumber;
        }
        if (isBlank(v)) return isBlank(literal);
        return String(v).toLowerCase() === wantText;
      };
      return rule.operator === 'eq'
        ? { test: eq, className }
        : { test: (v, row) => !eq(v, row), className };
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const bound = asComparable(literal);
      if (bound === null) return null;
      const op = rule.operator;
      return {
        test: (v) => {
          const n = asComparable(v);
          if (n === null) return false;
          if (op === 'gt') return n > bound;
          if (op === 'gte') return n >= bound;
          if (op === 'lt') return n < bound;
          return n <= bound;
        },
        className,
      };
    }
    case 'beforeField':
    case 'afterField': {
      const other = rule.compareField;
      if (!other) return null;
      const wantBefore = rule.operator === 'beforeField';
      return {
        test: (v, rowData) => {
          const a = asComparable(v);
          const b = asComparable(rowData?.[other]);
          if (a === null || b === null) return false;
          return wantBefore ? a < b : a > b;
        },
        className,
      };
    }
    default:
      return null;
  }
}

/**
 * Compile a rule set ONCE per change, not once per cell. Rules that cannot
 * produce a meaningful predicate (a `gt` with no comparand, a `beforeField`
 * with no target) are dropped rather than matching everything.
 */
export function compileConditionalFormats(
  rules: ConditionalFormatRule[] | undefined | null,
): CompiledConditionalFormats {
  if (!rules || rules.length === 0) return EMPTY_CONDITIONAL_FORMATS;
  const byField = new Map<string, CompiledRule[]>();
  for (const rule of rules.slice(0, MAX_CONDITIONAL_FORMAT_RULES)) {
    const compiled = compileRule(rule);
    if (!compiled) continue;
    const list = byField.get(rule.field);
    if (list) list.push(compiled);
    else byField.set(rule.field, [compiled]);
  }
  return { byField, isEmpty: byField.size === 0 };
}

/**
 * Resolve the highlight class for one cell. First matching rule wins (Excel's
 * precedence: rules are ordered and the first one that fires paints the cell).
 * Returns `undefined` when nothing matches, so the caller can fall through to
 * the code-level `cellClassName` hook.
 */
export function conditionalFormatClassName(
  compiled: CompiledConditionalFormats,
  field: string,
  value: unknown,
  rowData: any,
): string | undefined {
  if (compiled.isEmpty) return undefined;
  const rules = compiled.byField.get(field);
  if (!rules) return undefined;
  for (const rule of rules) {
    if (rule.test(value, rowData)) return rule.className;
  }
  return undefined;
}
