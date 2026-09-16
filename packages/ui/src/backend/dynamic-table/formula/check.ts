// formula/check.ts
//
// Definition-time validation. Everything that can be known without data is
// decided HERE, when the user saves the formula — not discovered per cell at
// render time. That is the whole point: an unknown column reference and a
// self-referencing formula are refused by the editor, so a saved view can never
// contain one.
//
// What survives to evaluation time is only what genuinely depends on the data:
// a `type_mismatch` on an undeclared column, and `divide_by_zero`.

import type {
  FormulaAst,
  FormulaColumnRef,
  FormulaFieldMeta,
  FormulaIssue,
  FormulaValueType,
} from './types';
import { formulaIssue } from './types';
import { collectFieldRefs, parseFormula } from './parse';
import { declaredArgType, lookupFormulaFunction, resolveResultType, unifyTypes } from './functions';

// ============================================
// TYPE + REFERENCE CHECKING
// ============================================

export interface FormulaCheckContext {
  /** Every column the formula may reference, native or synthesised. */
  fields: readonly FormulaFieldMeta[];
}

export type CheckResult =
  | { ok: true; type: FormulaValueType }
  | { ok: false; issues: FormulaIssue[] };

/** Types that can be compared with `<`, `>`, `<=`, `>=`. */
const ORDERABLE: FormulaValueType[] = ['number', 'date', 'text', 'unknown'];

/**
 * A human name for a node, used in `{name} is not a number`. A field reference
 * names the column; anything else is described by shape, because quoting the
 * user's own sub-expression back at them is noise.
 */
function describeNode(node: FormulaAst, fields: Map<string, FormulaFieldMeta>): string {
  switch (node.k) {
    case 'field':
      return fields.get(node.name)?.label ?? node.name;
    case 'call':
      return `${node.fn}()`;
    case 'lit':
      return node.v === null ? 'empty' : JSON.stringify(node.v);
    default:
      return 'the expression';
  }
}

/** True when `actual` is acceptable where `expected` is declared. */
function typeAccepts(expected: FormulaValueType, actual: FormulaValueType): boolean {
  if (expected === 'unknown' || actual === 'unknown') return true;
  return expected === actual;
}

/**
 * Walk the AST assigning types and collecting every problem — not just the
 * first, because a user fixing one error at a time is a user who stops using
 * the feature.
 */
export function checkAst(ast: FormulaAst, ctx: FormulaCheckContext): CheckResult {
  const fields = new Map<string, FormulaFieldMeta>(ctx.fields.map((f) => [f.key, f]));
  const issues: FormulaIssue[] = [];

  const walk = (node: FormulaAst): FormulaValueType => {
    switch (node.k) {
      case 'lit': {
        if (node.v === null) return 'unknown';
        if (typeof node.v === 'number') return 'number';
        if (typeof node.v === 'boolean') return 'boolean';
        return 'text';
      }

      case 'field': {
        const meta = fields.get(node.name);
        if (!meta) {
          issues.push(
            formulaIssue('unknown_field', `Unknown column: ${node.name}`, { name: node.name }),
          );
          return 'unknown';
        }
        return meta.type;
      }

      case 'neg': {
        const inner = walk(node.e);
        if (!typeAccepts('number', inner)) {
          const name = describeNode(node.e, fields);
          issues.push(formulaIssue('type_mismatch', `${name} is not a number`, { name }));
        }
        return 'number';
      }

      case 'call': {
        const def = lookupFormulaFunction(node.fn);
        if (!def) {
          issues.push(
            formulaIssue('unknown_function', `Unknown function: ${node.fn}`, { name: node.fn }),
          );
          node.args.forEach(walk);
          return 'unknown';
        }
        const argTypes = node.args.map(walk);
        if (node.args.length < def.minArgs || node.args.length > def.maxArgs) {
          issues.push(
            formulaIssue('arity', `${def.name} takes ${def.signature}`, {
              name: def.name,
              signature: def.signature,
            }),
          );
          return resolveResultType(def, argTypes);
        }
        node.args.forEach((arg, index) => {
          const expected = declaredArgType(def, index);
          if (!typeAccepts(expected, argTypes[index])) {
            const name = describeNode(arg, fields);
            issues.push(
              formulaIssue('type_mismatch', `${name} is not a ${expected}`, {
                name,
                expected,
              }),
            );
          }
        });
        return resolveResultType(def, argTypes);
      }

      case 'bin': {
        const left = walk(node.l);
        const right = walk(node.r);

        const requireNumber = (side: FormulaAst, type: FormulaValueType) => {
          if (typeAccepts('number', type)) return;
          const name = describeNode(side, fields);
          issues.push(formulaIssue('type_mismatch', `${name} is not a number`, { name }));
        };
        const requireBoolean = (side: FormulaAst, type: FormulaValueType) => {
          if (typeAccepts('boolean', type)) return;
          const name = describeNode(side, fields);
          issues.push(
            formulaIssue('type_mismatch', `${name} is not a true/false value`, {
              name,
              expected: 'boolean',
            }),
          );
        };

        switch (node.op) {
          case '+':
          case '-':
          case '*':
          case '/':
            requireNumber(node.l, left);
            requireNumber(node.r, right);
            // A literal zero divisor is provable now, so prove it now.
            if (node.op === '/' && node.r.k === 'lit' && node.r.v === 0) {
              issues.push(formulaIssue('divide_by_zero', 'Cannot divide by zero'));
            }
            return 'number';

          case '&&':
          case '||':
            requireBoolean(node.l, left);
            requireBoolean(node.r, right);
            return 'boolean';

          case 'concat':
            return 'text';

          case '=':
          case '!=':
            return 'boolean';

          case '>':
          case '>=':
          case '<':
          case '<=': {
            for (const [side, type] of [
              [node.l, left],
              [node.r, right],
            ] as [FormulaAst, FormulaValueType][]) {
              if (!ORDERABLE.includes(type)) {
                const name = describeNode(side, fields);
                issues.push(formulaIssue('type_mismatch', `${name} cannot be compared`, { name }));
              }
            }
            if (unifyTypes(left, right) === 'unknown' && left !== 'unknown' && right !== 'unknown') {
              const name = describeNode(node.r, fields);
              issues.push(
                formulaIssue('type_mismatch', `${name} is not a ${left}`, { name, expected: left }),
              );
            }
            return 'boolean';
          }

          default:
            return 'unknown';
        }
      }

      default:
        return 'unknown';
    }
  };

  const type = walk(ast);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, type };
}

// ============================================
// CYCLE DETECTION
// ============================================

/**
 * Cycles among formula columns, keyed by the formula key that participates.
 * Same-row references (A3) keep the graph tiny — one node per formula column —
 * so this is exhaustive rather than heuristic, and it runs at DEFINITION time.
 *
 * A formula that fails to parse contributes no edges; its syntax error is
 * reported separately and it cannot be saved anyway.
 */
export function detectFormulaCycles(refs: readonly FormulaColumnRef[]): Map<string, string[]> {
  const keys = new Set(refs.map((r) => r.key));
  const edges = new Map<string, string[]>();

  for (const ref of refs) {
    const parsed = parseFormula(ref.expression);
    const deps = parsed.ok ? collectFieldRefs(parsed.ast).filter((d) => keys.has(d)) : [];
    edges.set(ref.key, deps);
  }

  const cycles = new Map<string, string[]>();
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (key: string): void => {
    const mark = state.get(key);
    if (mark === 'done') return;
    if (mark === 'visiting') {
      // Found a back-edge: everything from `key` to the top of the stack is the
      // cycle, and every member of it is refused.
      const from = stack.indexOf(key);
      const path = [...stack.slice(from), key];
      for (const member of path) cycles.set(member, path);
      return;
    }
    state.set(key, 'visiting');
    stack.push(key);
    for (const dep of edges.get(key) ?? []) visit(dep);
    stack.pop();
    state.set(key, 'done');
  };

  for (const ref of refs) visit(ref.key);
  return cycles;
}

// ============================================
// THE EDITOR'S ENTRY POINT
// ============================================

export interface CheckFormulaColumnInput {
  /** The definition being saved (new or edited). */
  ref: FormulaColumnRef;
  /** Native + lookup columns the formula may reference. */
  fields: readonly FormulaFieldMeta[];
  /**
   * Every other formula column already on the view. The one being edited is
   * matched by key and replaced, so re-saving an existing formula is not
   * mistaken for a cycle with its own previous version.
   */
  existing?: readonly FormulaColumnRef[];
}

export type CheckFormulaColumnResult =
  | { ok: true; ast: FormulaAst; type: FormulaValueType }
  | { ok: false; issues: FormulaIssue[] };

/**
 * Validate one formula definition end to end: syntax → cycles → references and
 * types. Returns EVERY issue so the editor can list them.
 */
export function checkFormulaColumn(input: CheckFormulaColumnInput): CheckFormulaColumnResult {
  const { ref, fields } = input;
  const existing = (input.existing ?? []).filter((r) => r.key !== ref.key);

  const parsed = parseFormula(ref.expression);
  if (!parsed.ok) return { ok: false, issues: [parsed.issue] };

  // Cycles first: a self-reference makes the type check meaningless.
  const cycles = detectFormulaCycles([...existing, ref]);
  const cycle = cycles.get(ref.key);
  if (cycle) {
    const isSelf = cycle.length <= 2;
    return {
      ok: false,
      issues: [
        formulaIssue(
          'cycle',
          isSelf ? 'This formula refers to itself' : `Circular reference: ${cycle.join(' → ')}`,
          { path: cycle.join(' → ') },
        ),
      ],
    };
  }

  // Other formula columns are referenceable, typed by their declared result.
  const formulaFields: FormulaFieldMeta[] = existing.map((r) => ({
    key: r.key,
    label: r.label,
    type: r.resultType,
  }));

  return mapCheck(checkAst(parsed.ast, { fields: [...fields, ...formulaFields] }), parsed.ast);
}

function mapCheck(result: CheckResult, ast: FormulaAst): CheckFormulaColumnResult {
  return result.ok ? { ok: true, ast, type: result.type } : { ok: false, issues: result.issues };
}

/**
 * Column metadata in the shape the checker wants, derived from `ColumnDef`s.
 * `ColumnDef.type` is the grid's vocabulary (`numeric`, `dropdown`, …); this is
 * the single place that translation lives.
 */
export function fieldMetaFromColumns(
  columns: readonly { data: string; title?: string; type?: string }[],
): FormulaFieldMeta[] {
  return columns.map((col) => ({
    key: col.data,
    label: col.title,
    type: columnTypeToFormulaType(col.type),
  }));
}

/** `ColumnDef.type` → checker type. Undeclared columns are `unknown`. */
export function columnTypeToFormulaType(type: string | undefined): FormulaValueType {
  switch (type) {
    case 'numeric':
      return 'number';
    case 'date':
      return 'date';
    case 'boolean':
      return 'boolean';
    case 'text':
    case 'dropdown':
    case 'multiselect':
      return 'text';
    default:
      return 'unknown';
  }
}
