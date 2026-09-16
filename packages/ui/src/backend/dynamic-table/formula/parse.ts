// formula/parse.ts
//
// Tokeniser + hand-written recursive-descent parser for the DynamicTable
// expression language. No parser dependency: the grammar is small enough that a
// dependency would cost more (licence surface, bundle, indirection) than it
// saves.
//
// Grammar, loosest binding first — Excel's precedence, deliberately:
//
//   expression  := or
//   or          := and      ( ("||" | "OR")  and )*
//   and         := not      ( ("&&" | "AND") not )*
//   not         := ("!" | "NOT") not | comparison
//   comparison  := concat   ( ("=" | "==" | "!=" | "<>" | ">" | ">=" | "<" | "<=") concat )?
//   concat      := additive ( "&" additive )*
//   additive    := multiplicative ( ("+" | "-") multiplicative )*
//   multiplicative := unary ( ("*" | "/") unary )*
//   unary       := "-" unary | primary
//   primary     := NUMBER | STRING | TRUE | FALSE | NULL
//                | IDENT "(" [ expression ("," expression)* ] ")"     -- call
//                | IDENT | "[" ... "]"                                -- field
//                | "(" expression ")"
//
// Comparison is intentionally non-associative: `a < b < c` is a bug in every
// language that allows it, so it is a syntax error here.

import type { FormulaAst, FormulaBinaryOp, FormulaIssue } from './types';
import { formulaIssue } from './types';

// ============================================
// TOKENISER
// ============================================

export type FormulaTokenType = 'number' | 'string' | 'ident' | 'field' | 'punct' | 'eof';

export interface FormulaToken {
  type: FormulaTokenType;
  /** Punctuation/identifier text, or the decoded value for literals. */
  text: string;
  /** Decoded literal value for `number` / `string` tokens. */
  value?: number | string;
  /** 0-based offset of the token's first character. */
  start: number;
}

/**
 * Two-character operators, checked before the single-character table so `>=`
 * never tokenises as `>` followed by `=`.
 */
const TWO_CHAR_OPS = ['>=', '<=', '!=', '<>', '==', '&&', '||'];
const ONE_CHAR_OPS = ['+', '-', '*', '/', '(', ')', ',', '&', '=', '>', '<', '!'];

/** A tokenisation or parse failure, carried as an issue rather than a throw. */
class FormulaSyntaxError extends Error {
  readonly issue: FormulaIssue;
  constructor(issue: FormulaIssue) {
    super(issue.message);
    this.issue = issue;
  }
}

function syntaxError(token: string, position: number): FormulaSyntaxError {
  return new FormulaSyntaxError(
    formulaIssue('syntax', `Could not read the formula near "${token}"`, { token }, position),
  );
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

/**
 * Split source text into tokens. Exported because the token stream is the
 * cheapest thing to assert against when a precedence bug is suspected.
 */
export function tokenize(source: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    // Number: 12, 12.5, .5 is NOT accepted (leading digit required, so `.` stays
    // free for a future member operator without an ambiguity).
    if (isDigit(ch)) {
      const start = i;
      while (i < source.length && isDigit(source[i])) i += 1;
      if (source[i] === '.') {
        i += 1;
        while (i < source.length && isDigit(source[i])) i += 1;
      }
      const text = source.slice(start, i);
      tokens.push({ type: 'number', text, value: Number(text), start });
      continue;
    }

    // String: '…' or "…", backslash escapes.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i += 1;
      let out = '';
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\' && i + 1 < source.length) {
          out += source[i + 1];
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          closed = true;
          break;
        }
        out += c;
        i += 1;
      }
      if (!closed) throw syntaxError(source.slice(start), start);
      tokens.push({ type: 'string', text: out, value: out, start });
      continue;
    }

    // Bracketed field reference: [Unit price], for keys with spaces or dots.
    if (ch === '[') {
      const start = i;
      const end = source.indexOf(']', i + 1);
      if (end === -1) throw syntaxError(source.slice(start), start);
      const name = source.slice(i + 1, end).trim();
      if (!name) throw syntaxError('[]', start);
      tokens.push({ type: 'field', text: name, start });
      i = end + 1;
      continue;
    }

    // Identifier / keyword / bare field reference.
    if (isIdentStart(ch)) {
      const start = i;
      while (i < source.length && isIdentPart(source[i])) i += 1;
      tokens.push({ type: 'ident', text: source.slice(start, i), start });
      continue;
    }

    // Operators / punctuation.
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'punct', text: two, start: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: 'punct', text: ch, start: i });
      i += 1;
      continue;
    }

    throw syntaxError(ch, i);
  }

  tokens.push({ type: 'eof', text: '', start: source.length });
  return tokens;
}

// ============================================
// PARSER
// ============================================

const KEYWORD_LITERALS: Record<string, { v: number | string | boolean | null }> = {
  TRUE: { v: true },
  FALSE: { v: false },
  NULL: { v: null },
};

class Parser {
  private readonly tokens: FormulaToken[];
  private pos = 0;

  constructor(tokens: FormulaToken[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): FormulaToken {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): FormulaToken {
    const token = this.peek();
    if (token.type !== 'eof') this.pos += 1;
    return token;
  }

  private fail(token: FormulaToken): never {
    throw syntaxError(token.type === 'eof' ? 'end of formula' : token.text, token.start);
  }

  /**
   * Match an operator that may be written as punctuation (`&&`) or as a keyword
   * (`AND`). A keyword only counts as an operator when it is NOT immediately
   * followed by `(` — otherwise `AND(a, b)` would parse as a dangling operator
   * instead of the function call it is.
   */
  private matchOperator(punct: string[], keywords: string[] = []): string | null {
    const token = this.peek();
    if (token.type === 'punct' && punct.includes(token.text)) {
      this.pos += 1;
      return token.text;
    }
    if (token.type === 'ident' && keywords.includes(token.text.toUpperCase())) {
      if (this.peek(1).type === 'punct' && this.peek(1).text === '(') return null;
      this.pos += 1;
      return token.text.toUpperCase();
    }
    return null;
  }

  parseExpression(): FormulaAst {
    return this.parseOr();
  }

  private parseOr(): FormulaAst {
    let left = this.parseAnd();
    for (;;) {
      const op = this.matchOperator(['||'], ['OR']);
      if (!op) return left;
      left = { k: 'bin', op: '||', l: left, r: this.parseAnd() };
    }
  }

  private parseAnd(): FormulaAst {
    let left = this.parseNot();
    for (;;) {
      const op = this.matchOperator(['&&'], ['AND']);
      if (!op) return left;
      left = { k: 'bin', op: '&&', l: left, r: this.parseNot() };
    }
  }

  private parseNot(): FormulaAst {
    const op = this.matchOperator(['!'], ['NOT']);
    // `NOT` lowers to the library function of the same name rather than a
    // dedicated AST node, so the persisted AST stays exactly the five kinds the
    // spec fixes.
    if (op) return { k: 'call', fn: 'NOT', args: [this.parseNot()] };
    return this.parseComparison();
  }

  private parseComparison(): FormulaAst {
    const left = this.parseConcat();
    const op = this.matchOperator(['=', '==', '!=', '<>', '>', '>=', '<', '<=']);
    if (!op) return left;
    const normalised: FormulaBinaryOp =
      op === '==' ? '=' : op === '<>' ? '!=' : (op as FormulaBinaryOp);
    const right = this.parseConcat();
    // Non-associative on purpose: `a < b < c` reads as maths but means something
    // else in every language that allows it.
    const chained = this.matchOperator(['=', '==', '!=', '<>', '>', '>=', '<', '<=']);
    if (chained) this.fail(this.peek(-1));
    return { k: 'bin', op: normalised, l: left, r: right };
  }

  private parseConcat(): FormulaAst {
    let left = this.parseAdditive();
    for (;;) {
      const op = this.matchOperator(['&']);
      if (!op) return left;
      left = { k: 'bin', op: 'concat', l: left, r: this.parseAdditive() };
    }
  }

  private parseAdditive(): FormulaAst {
    let left = this.parseMultiplicative();
    for (;;) {
      const op = this.matchOperator(['+', '-']);
      if (!op) return left;
      left = { k: 'bin', op: op as FormulaBinaryOp, l: left, r: this.parseMultiplicative() };
    }
  }

  private parseMultiplicative(): FormulaAst {
    let left = this.parseUnary();
    for (;;) {
      const op = this.matchOperator(['*', '/']);
      if (!op) return left;
      left = { k: 'bin', op: op as FormulaBinaryOp, l: left, r: this.parseUnary() };
    }
  }

  private parseUnary(): FormulaAst {
    if (this.matchOperator(['-'])) return { k: 'neg', e: this.parseUnary() };
    if (this.matchOperator(['+'])) return this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaAst {
    const token = this.next();

    if (token.type === 'number') return { k: 'lit', v: token.value as number };
    if (token.type === 'string') return { k: 'lit', v: token.value as string };
    if (token.type === 'field') return { k: 'field', name: token.text };

    if (token.type === 'punct' && token.text === '(') {
      const inner = this.parseExpression();
      const close = this.next();
      if (close.type !== 'punct' || close.text !== ')') this.fail(close);
      return inner;
    }

    if (token.type === 'ident') {
      const upper = token.text.toUpperCase();
      const ahead = this.peek();
      const isCall = ahead.type === 'punct' && ahead.text === '(';

      if (!isCall && upper in KEYWORD_LITERALS) {
        return { k: 'lit', v: KEYWORD_LITERALS[upper].v };
      }
      if (!isCall) return { k: 'field', name: token.text };

      this.pos += 1; // consume '('
      const args: FormulaAst[] = [];
      if (!(this.peek().type === 'punct' && this.peek().text === ')')) {
        for (;;) {
          args.push(this.parseExpression());
          if (this.matchOperator([','])) continue;
          break;
        }
      }
      const close = this.next();
      if (close.type !== 'punct' || close.text !== ')') this.fail(close);
      return { k: 'call', fn: upper, args };
    }

    this.fail(token);
  }

  expectEof(): void {
    const token = this.peek();
    if (token.type !== 'eof') this.fail(token);
  }
}

export type ParseResult =
  | { ok: true; ast: FormulaAst }
  | { ok: false; issue: FormulaIssue };

/**
 * Parse source text into a `FormulaAst`. Never throws: a malformed formula is a
 * normal outcome (the user is mid-typing), so failure is a returned issue.
 */
export function parseFormula(source: string): ParseResult {
  if (!source || !source.trim()) {
    return {
      ok: false,
      issue: formulaIssue('syntax', 'Could not read the formula near ""', { token: '' }, 0),
    };
  }
  try {
    const parser = new Parser(tokenize(source));
    const ast = parser.parseExpression();
    parser.expectEof();
    return { ok: true, ast };
  } catch (err) {
    if (err instanceof FormulaSyntaxError) return { ok: false, issue: err.issue };
    throw err;
  }
}

/**
 * Every field key an AST reads, de-duplicated, in first-seen order. The basis
 * for both cycle detection and the evaluator's per-row cache signature.
 */
export function collectFieldRefs(ast: FormulaAst): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const walk = (node: FormulaAst): void => {
    switch (node.k) {
      case 'field':
        if (!seen.has(node.name)) {
          seen.add(node.name);
          out.push(node.name);
        }
        return;
      case 'bin':
        walk(node.l);
        walk(node.r);
        return;
      case 'neg':
        walk(node.e);
        return;
      case 'call':
        node.args.forEach(walk);
        return;
      default:
        return;
    }
  };

  walk(ast);
  return out;
}
