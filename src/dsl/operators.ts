/**
 * U8 — the closed DSL operator set (spec §4.2, §4.3, §4.4).
 *
 * Milestone 1 bundling subset only. Excluded on purpose (money-bearing or
 * phase-4 operators, out of scope until a later milestone per
 * docs/BUILD_LOG.md's "no dollar amounts in output" goal): `claimMoneyAtLeast`,
 * `claimDayCountAtLeast`, `chargeAtLeast`, `setAmount`, `multiply`,
 * `setCoinsurance`, `carveOut`, `exclusion`, `lesserOfCandidates`.
 *
 * ZERO IMPORTS. Not even from `../types.js`. Every shape this file needs is
 * declared locally, either as a real interface or accepted structurally as
 * `unknown` and narrowed with runtime guards. This is what keeps
 * `operators.ts` <-> `evaluate.ts` from being an import cycle — a cycle here
 * becomes a load-time `ReferenceError` in the IIFE browser bundle (§2.7).
 *
 * DESIGN NOTE — composite/relational recursion. `allOf`, `anyOf`, `not`, and
 * the relational operators' `among` all embed a nested `PredicateNode`.
 * Two different recursion mechanisms are used here, deliberately:
 *
 *   - `evaluate()` takes an injected `evalNode` callback, supplied by the
 *     caller (the real interpreter in `evaluate.ts`, or a trivial dispatcher
 *     built from `operatorRegistry` in tests). This is the literal
 *     requirement from the build brief: composites must not import the
 *     interpreter's dispatch logic, because the interpreter needs to import
 *     *this* file, and the real `evalNode` layers in trace recording and
 *     epoch bookkeeping that does not belong here.
 *   - `describe()` and `argSpec()` are pure functions of their arguments
 *     (spec §4.4) with no side effects and no caller-supplied callback, so
 *     for the composites and for `bundleUnder`'s embedded `among`, they walk
 *     the nested node via this module's own `operatorRegistry` — a
 *     same-module lookup, not a cross-file import, so it does not create the
 *     cycle the injected-`evalNode` rule exists to avoid.
 *
 * Every operator's `evaluate`/`describe`/`argSpec` accepts `args: unknown`
 * and narrows at runtime with guards (never `as`, never `!`). A malformed
 * arg shape is a registry-authoring bug and throws a plain `Error` — never a
 * silent coercion, consistent with the rest of this codebase's discipline.
 */

// ---------------------------------------------------------------------------
// JSON-safe value type (no imports available for a shared one)
// ---------------------------------------------------------------------------

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Operator-local fact/context shapes. The real interpreter is expected to
// produce these from the frozen epoch fact sets (§2.5); this file only
// declares the shape it needs to read.
// ---------------------------------------------------------------------------

/** Per-line facts as seen by an operator. Money is integer mils. */
export interface LineFacts {
  readonly lineId: string;
  readonly code: string;
  readonly si: string | null;
  readonly apc: string | null;
  readonly schedule: string | null;
  /** Current disposition status, if any effect has set one yet. */
  readonly status: string | null;
  readonly modifiers: readonly string[];
  readonly unitCount: number;
  readonly rateMils: number | null;
  readonly weight: number | null;
  readonly chargeMils: number;
  readonly isExempt: boolean;
  /** YYYYMMDD. */
  readonly dos: string;
}

export interface ClaimFacts {
  readonly lines: readonly LineFacts[];
}

/** Options-row facts (§13.2), keyed by option name. */
export type OptionsFacts = Readonly<Record<string, JsonValue>>;

/**
 * What an operator evaluates against. `subject` is the line under test —
 * the candidate line when an operator is used as a scope selector or as
 * `among`'s membership test, or the admitted line when used in a line-scoped
 * rule's `when`. `subject` is `null` only for a claim-scoped rule's own
 * `scope`/`when`, where there is no single subject line.
 */
export interface OperatorContext {
  readonly subject: LineFacts | null;
  readonly claim: ClaimFacts;
  readonly options: OptionsFacts;
}

/** A node in a condition tree: `{op, args}`, args opaque until narrowed. */
export interface PredicateNode {
  readonly op: string;
  readonly args: unknown;
}

/** What evaluating a node produces — enough for `Evaluation.examined` (§5.2). */
export interface EvalResult {
  readonly fired: boolean;
  readonly examined: Readonly<Record<string, JsonValue>>;
}

/**
 * Injected by the caller so composite/relational operators can recurse into
 * arbitrary child nodes without this file importing the interpreter.
 */
export type EvalNode = (node: PredicateNode, ctx: OperatorContext) => EvalResult;

// ---------------------------------------------------------------------------
// argSpec closed vocabulary (spec §4.4)
// ---------------------------------------------------------------------------

export type ArgSpecKind =
  | 'linePredicate'
  | 'claimPresence'
  | 'claimQuantity'
  | 'relational'
  | 'context'
  | 'composite'
  | 'reserved'
  | 'effect';

export type ArgSpecDimension =
  | 'si'
  | 'code'
  | 'apc'
  | 'schedule'
  | 'status'
  | 'modifier'
  | 'option'
  | 'units'
  | 'money'
  | 'date';

export interface ArgSpec {
  readonly kind: ArgSpecKind;
  readonly dimension?: ArgSpecDimension;
  readonly values?: readonly JsonValue[];
  readonly negated?: boolean;
  readonly field?: string;
  readonly threshold?: number;
  readonly target?: string;
  /** Composites, and `bundleUnder`'s embedded `among`, walk here. */
  readonly children?: readonly ArgSpec[];
}

const ARG_SPEC_KINDS: readonly ArgSpecKind[] = [
  'linePredicate',
  'claimPresence',
  'claimQuantity',
  'relational',
  'context',
  'composite',
  'reserved',
  'effect',
];

const ARG_SPEC_DIMENSIONS: readonly ArgSpecDimension[] = [
  'si',
  'code',
  'apc',
  'schedule',
  'status',
  'modifier',
  'option',
  'units',
  'money',
  'date',
];

export function isArgSpecKind(v: unknown): v is ArgSpecKind {
  return typeof v === 'string' && (ARG_SPEC_KINDS as readonly string[]).includes(v);
}

export function isArgSpecDimension(v: unknown): v is ArgSpecDimension {
  return typeof v === 'string' && (ARG_SPEC_DIMENSIONS as readonly string[]).includes(v);
}

interface ArgSpecInput {
  readonly kind: ArgSpecKind;
  readonly dimension?: ArgSpecDimension;
  readonly values?: readonly JsonValue[];
  readonly negated?: boolean;
  readonly field?: string;
  readonly threshold?: number;
  readonly target?: string;
  readonly children?: readonly ArgSpec[];
}

/** Builds an `ArgSpec`, omitting undefined optional keys (exactOptionalPropertyTypes). */
function makeArgSpec(o: ArgSpecInput): ArgSpec {
  return {
    kind: o.kind,
    ...(o.dimension !== undefined ? { dimension: o.dimension } : {}),
    ...(o.values !== undefined ? { values: o.values } : {}),
    ...(o.negated !== undefined ? { negated: o.negated } : {}),
    ...(o.field !== undefined ? { field: o.field } : {}),
    ...(o.threshold !== undefined ? { threshold: o.threshold } : {}),
    ...(o.target !== undefined ? { target: o.target } : {}),
    ...(o.children !== undefined ? { children: o.children } : {}),
  };
}

// ---------------------------------------------------------------------------
// Operator interfaces
// ---------------------------------------------------------------------------

export interface ConditionOperator {
  readonly name: string;
  readonly role: 'condition';
  readonly evaluate: (args: unknown, ctx: OperatorContext, evalNode: EvalNode) => EvalResult;
  readonly describe: (args: unknown) => string;
  readonly argSpec: (args: unknown) => ArgSpec;
}

export interface EffectOperator {
  readonly name: string;
  readonly role: 'effect';
  readonly describe: (args: unknown) => string;
  readonly argSpec: (args: unknown) => ArgSpec;
}

export type AnyOperator = ConditionOperator | EffectOperator;

// ---------------------------------------------------------------------------
// Runtime arg guards — narrow `unknown` without `as` or `!`.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireRecord(args: unknown, op: string): Record<string, unknown> {
  if (!isRecord(args)) {
    throw new Error(`${op}: expected an object of arguments, got ${JSON.stringify(args)}`);
  }
  return args;
}

function requireString(rec: Record<string, unknown>, key: string, op: string): string {
  const v = rec[key];
  if (typeof v !== 'string') {
    throw new Error(`${op}: expected a string at "${key}", got ${JSON.stringify(v)}`);
  }
  return v;
}

function optionalString(rec: Record<string, unknown>, key: string, op: string): string | undefined {
  const v = rec[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') {
    throw new Error(`${op}: expected a string at "${key}", got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireNumber(rec: Record<string, unknown>, key: string, op: string): number {
  const v = rec[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${op}: expected a finite number at "${key}", got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireStringArray(rec: Record<string, unknown>, key: string, op: string): string[] {
  const v = rec[key];
  if (!Array.isArray(v) || v.some((item) => typeof item !== 'string')) {
    throw new Error(`${op}: expected a string array at "${key}", got ${JSON.stringify(v)}`);
  }
  return v as string[]; // safe: just proved every element is a string via .every semantics above
}

function optionalStringArray(rec: Record<string, unknown>, key: string, op: string): string[] | undefined {
  const v = rec[key];
  if (v === undefined) return undefined;
  return requireStringArray(rec, key, op);
}

function requirePredicateNode(v: unknown, op: string, where: string): PredicateNode {
  const rec = requireRecord(v, `${op}.${where}`);
  const nodeOp = requireString(rec, 'op', `${op}.${where}`);
  if (!('args' in rec)) {
    throw new Error(`${op}.${where}: nested predicate node missing "args"`);
  }
  return { op: nodeOp, args: rec['args'] };
}

function requirePredicateNodeArray(rec: Record<string, unknown>, key: string, op: string): PredicateNode[] {
  const v = rec[key];
  if (!Array.isArray(v)) {
    throw new Error(`${op}: expected an array of predicate nodes at "${key}", got ${JSON.stringify(v)}`);
  }
  return v.map((item, i) => requirePredicateNode(item, op, `${key}[${i}]`));
}

const RANK_FIELDS: readonly string[] = ['rateMils', 'weight', 'chargeMils', 'unitCount'];

export type RankField = 'rateMils' | 'weight' | 'chargeMils' | 'unitCount';

function isRankField(v: unknown): v is RankField {
  return typeof v === 'string' && RANK_FIELDS.includes(v);
}

function requireRankField(rec: Record<string, unknown>, key: string, op: string): RankField {
  const v = rec[key];
  if (!isRankField(v)) {
    throw new Error(`${op}: expected "${key}" to be one of ${JSON.stringify(RANK_FIELDS)}, got ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * Exported (spec §4.2) so `dsl/evaluate.ts` can rank lines itself for
 * `bundleUnder` target resolution and its rank-fact memo, without
 * reimplementing this logic — ranking is where the `weight`-vs-`rateMils`
 * distinction and the `fallbackField` rule live, and a second copy is the
 * one place a divergence would silently change which line controls a
 * bundle. `operators.ts` still imports nothing (file header) — this is an
 * export, not a new dependency direction.
 */
export function readRankField(line: LineFacts, field: RankField): number | null {
  switch (field) {
    case 'rateMils':
      return line.rateMils;
    case 'weight':
      return line.weight;
    case 'chargeMils':
      return line.chargeMils;
    case 'unitCount':
      return line.unitCount;
  }
}

function requireSubject(ctx: OperatorContext, op: string): LineFacts {
  if (ctx.subject === null) {
    throw new Error(`${op}: requires a subject line, but the operator context has none (claim-scoped position?)`);
  }
  return ctx.subject;
}

// ---------------------------------------------------------------------------
// Text-formatting helpers for describe()
// ---------------------------------------------------------------------------

function joinOr(items: readonly string[]): string {
  if (items.length === 0) return '(nothing)';
  if (items.length === 1) {
    const [only] = items;
    return only ?? '(nothing)';
  }
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

function joinAnd(items: readonly string[]): string {
  if (items.length === 0) return '(nothing)';
  if (items.length === 1) {
    const [only] = items;
    return only ?? '(nothing)';
  }
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Deep equality for optionIs — options are small JSON-safe values, so a
// straightforward recursive compare is sufficient and deterministic (§2.4).
// ---------------------------------------------------------------------------

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => {
      const other = b[i];
      return other !== undefined && deepEqual(item, other);
    });
  }
  if (isRecord(a) && isRecord(b)) {
    const aObj = a as Record<string, JsonValue>;
    const bObj = b as Record<string, JsonValue>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k, i) => {
      if (bKeys[i] !== k) return false;
      const av = aObj[k];
      const bv = bObj[k];
      return av !== undefined && bv !== undefined && deepEqual(av, bv);
    });
  }
  return false;
}

// ---------------------------------------------------------------------------
// The registry every composite/relational operator's describe()/argSpec()
// recurses through. Populated at the bottom of this file, after every
// operator constant exists; composites read it lazily (inside their
// function bodies, not at module-eval time), so declaration order here
// doesn't matter.
// ---------------------------------------------------------------------------

const operatorRegistry: Record<string, AnyOperator> = {};

function lookupCondition(opName: string, where: string): ConditionOperator {
  const op = operatorRegistry[opName];
  if (op === undefined) {
    throw new Error(`${where}: unknown operator "${opName}"`);
  }
  if (op.role !== 'condition') {
    throw new Error(`${where}: operator "${opName}" is an effect, not a condition`);
  }
  return op;
}

function describeNode(node: PredicateNode, where: string): string {
  return lookupCondition(node.op, where).describe(node.args);
}

function argSpecNode(node: PredicateNode, where: string): ArgSpec {
  return lookupCondition(node.op, where).argSpec(node.args);
}

// ===========================================================================
// Line predicates — used as scope selectors and/or line-local conditions.
// (Scope selectors: always, siIn, codeIn, codePattern, apcIn, inSchedule,
//  statusIn, isExempt, not. Line-local conditions: always, siIs, siIn,
//  codeIn, hasModifier, unitsAtLeast, hasRate, hasWeight, inSchedule,
//  isExempt. The overlap is real, not accidental — both roles evaluate the
//  same predicate against "the subject line," just a different subject:
//  the scope-candidate line, or the already-admitted line.)
// ===========================================================================

export const always: ConditionOperator = {
  name: 'always',
  role: 'condition',
  evaluate: () => ({ fired: true, examined: {} }),
  describe: () => 'no condition — always true',
  argSpec: () => makeArgSpec({ kind: 'linePredicate' }),
};

export const siIn: ConditionOperator = {
  name: 'siIn',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'siIn');
    const si = requireStringArray(rec, 'si', 'siIn');
    const subject = requireSubject(ctx, 'siIn');
    const fired = subject.si !== null && si.includes(subject.si);
    return { fired, examined: { subjectSi: subject.si } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'siIn');
    return `status indicator is ${joinOr(requireStringArray(rec, 'si', 'siIn'))}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'siIn');
    return makeArgSpec({ kind: 'linePredicate', dimension: 'si', values: requireStringArray(rec, 'si', 'siIn') });
  },
};

export const codeIn: ConditionOperator = {
  name: 'codeIn',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'codeIn');
    const code = requireStringArray(rec, 'code', 'codeIn');
    const subject = requireSubject(ctx, 'codeIn');
    return { fired: code.includes(subject.code), examined: { subjectCode: subject.code } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'codeIn');
    const code = requireStringArray(rec, 'code', 'codeIn');
    return code.length === 1 ? `the code is ${code[0]}` : `the code is ${joinOr(code)}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'codeIn');
    return makeArgSpec({ kind: 'linePredicate', dimension: 'code', values: requireStringArray(rec, 'code', 'codeIn') });
  },
};

/**
 * Wildcard pattern, not a raw regex: `*` matches any run of characters, `?`
 * matches exactly one. Anchored to the whole code. Spec §4.3 names the
 * operator but does not define its pattern syntax in the sections read for
 * this unit (§4.2-4.4) — treated as an open point; see final report.
 */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export const codePattern: ConditionOperator = {
  name: 'codePattern',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'codePattern');
    const pattern = requireString(rec, 'pattern', 'codePattern');
    const subject = requireSubject(ctx, 'codePattern');
    return { fired: wildcardToRegExp(pattern).test(subject.code), examined: { subjectCode: subject.code } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'codePattern');
    return `the code matches the pattern "${requireString(rec, 'pattern', 'codePattern')}"`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'codePattern');
    return makeArgSpec({ kind: 'linePredicate', dimension: 'code', values: [requireString(rec, 'pattern', 'codePattern')] });
  },
};

export const apcIn: ConditionOperator = {
  name: 'apcIn',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'apcIn');
    const apc = requireStringArray(rec, 'apc', 'apcIn');
    const subject = requireSubject(ctx, 'apcIn');
    return { fired: subject.apc !== null && apc.includes(subject.apc), examined: { subjectApc: subject.apc } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'apcIn');
    return `the APC is ${joinOr(requireStringArray(rec, 'apc', 'apcIn'))}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'apcIn');
    return makeArgSpec({ kind: 'linePredicate', dimension: 'apc', values: requireStringArray(rec, 'apc', 'apcIn') });
  },
};

export const inSchedule: ConditionOperator = {
  name: 'inSchedule',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'inSchedule');
    const schedule = requireStringArray(rec, 'schedule', 'inSchedule');
    const subject = requireSubject(ctx, 'inSchedule');
    return { fired: subject.schedule !== null && schedule.includes(subject.schedule), examined: { subjectSchedule: subject.schedule } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'inSchedule');
    return `the fee schedule is ${joinOr(requireStringArray(rec, 'schedule', 'inSchedule'))}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'inSchedule');
    return makeArgSpec({ kind: 'linePredicate', dimension: 'schedule', values: requireStringArray(rec, 'schedule', 'inSchedule') });
  },
};

export const statusIn: ConditionOperator = {
  name: 'statusIn',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'statusIn');
    const status = requireStringArray(rec, 'status', 'statusIn');
    const subject = requireSubject(ctx, 'statusIn');
    return { fired: subject.status !== null && status.includes(subject.status), examined: { subjectStatus: subject.status } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'statusIn');
    return `the line's status is ${joinOr(requireStringArray(rec, 'status', 'statusIn'))}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'statusIn');
    return makeArgSpec({ kind: 'linePredicate', dimension: 'status', values: requireStringArray(rec, 'status', 'statusIn') });
  },
};

export const isExempt: ConditionOperator = {
  name: 'isExempt',
  role: 'condition',
  evaluate: (_args, ctx) => {
    const subject = requireSubject(ctx, 'isExempt');
    return { fired: subject.isExempt, examined: { subjectIsExempt: subject.isExempt } };
  },
  describe: () => 'the line is on the exempt set',
  argSpec: () => makeArgSpec({ kind: 'linePredicate', dimension: 'status' }),
};

export const siIs: ConditionOperator = {
  name: 'siIs',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'siIs');
    const si = requireString(rec, 'si', 'siIs');
    const subject = requireSubject(ctx, 'siIs');
    return { fired: subject.si === si, examined: { subjectSi: subject.si } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'siIs');
    return `status indicator is ${requireString(rec, 'si', 'siIs')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'siIs');
    return makeArgSpec({ kind: 'linePredicate', dimension: 'si', values: [requireString(rec, 'si', 'siIs')] });
  },
};

export const hasModifier: ConditionOperator = {
  name: 'hasModifier',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'hasModifier');
    const modifier = requireString(rec, 'modifier', 'hasModifier');
    const subject = requireSubject(ctx, 'hasModifier');
    return { fired: subject.modifiers.includes(modifier), examined: { subjectModifiers: [...subject.modifiers] } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'hasModifier');
    return `the line carries modifier ${requireString(rec, 'modifier', 'hasModifier')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'hasModifier');
    return makeArgSpec({ kind: 'linePredicate', dimension: 'modifier', values: [requireString(rec, 'modifier', 'hasModifier')] });
  },
};

export const unitsAtLeast: ConditionOperator = {
  name: 'unitsAtLeast',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'unitsAtLeast');
    const units = requireNumber(rec, 'units', 'unitsAtLeast');
    const subject = requireSubject(ctx, 'unitsAtLeast');
    return { fired: subject.unitCount >= units, examined: { subjectUnitCount: subject.unitCount } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'unitsAtLeast');
    return `the line has at least ${requireNumber(rec, 'units', 'unitsAtLeast')} units`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'unitsAtLeast');
    return makeArgSpec({ kind: 'linePredicate', dimension: 'units', threshold: requireNumber(rec, 'units', 'unitsAtLeast') });
  },
};

export const hasRate: ConditionOperator = {
  name: 'hasRate',
  role: 'condition',
  evaluate: (_args, ctx) => {
    const subject = requireSubject(ctx, 'hasRate');
    return { fired: subject.rateMils !== null, examined: { subjectHasRate: subject.rateMils !== null } };
  },
  describe: () => 'the line carries a rate',
  // No `dimension` fits "rate" in the closed vocabulary (si/code/apc/schedule/
  // status/modifier/option/units/money/date) — omitted rather than forced
  // into a misleading bucket. See final report.
  argSpec: () => makeArgSpec({ kind: 'linePredicate' }),
};

export const hasWeight: ConditionOperator = {
  name: 'hasWeight',
  role: 'condition',
  evaluate: (_args, ctx) => {
    const subject = requireSubject(ctx, 'hasWeight');
    return { fired: subject.weight !== null, examined: { subjectHasWeight: subject.weight !== null } };
  },
  describe: () => 'the line carries a relative weight',
  // Same gap as hasRate: no "weight" dimension token exists.
  argSpec: () => makeArgSpec({ kind: 'linePredicate' }),
};

// ===========================================================================
// Composition — allOf, anyOf, not. `not` also serves as a scope selector
// (§4.3: "not is valid in scope, not only in when").
// ===========================================================================

export const allOf: ConditionOperator = {
  name: 'allOf',
  role: 'condition',
  evaluate: (args, ctx, evalNode) => {
    const rec = requireRecord(args, 'allOf');
    const children = requirePredicateNodeArray(rec, 'children', 'allOf');
    const results = children.map((c) => evalNode(c, ctx));
    return { fired: results.every((r) => r.fired), examined: { childResults: results.map((r) => r.fired) } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'allOf');
    const children = requirePredicateNodeArray(rec, 'children', 'allOf');
    return joinAnd(children.map((c) => describeNode(c, 'allOf')));
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'allOf');
    const children = requirePredicateNodeArray(rec, 'children', 'allOf');
    return makeArgSpec({ kind: 'composite', children: children.map((c) => argSpecNode(c, 'allOf')) });
  },
};

export const anyOf: ConditionOperator = {
  name: 'anyOf',
  role: 'condition',
  evaluate: (args, ctx, evalNode) => {
    const rec = requireRecord(args, 'anyOf');
    const children = requirePredicateNodeArray(rec, 'children', 'anyOf');
    const results = children.map((c) => evalNode(c, ctx));
    return { fired: results.some((r) => r.fired), examined: { childResults: results.map((r) => r.fired) } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'anyOf');
    const children = requirePredicateNodeArray(rec, 'children', 'anyOf');
    return joinOr(children.map((c) => describeNode(c, 'anyOf')));
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'anyOf');
    const children = requirePredicateNodeArray(rec, 'children', 'anyOf');
    return makeArgSpec({ kind: 'composite', children: children.map((c) => argSpecNode(c, 'anyOf')) });
  },
};

export const not: ConditionOperator = {
  name: 'not',
  role: 'condition',
  evaluate: (args, ctx, evalNode) => {
    const rec = requireRecord(args, 'not');
    const child = requirePredicateNode(rec['child'], 'not', 'child');
    const r = evalNode(child, ctx);
    return { fired: !r.fired, examined: { childFired: r.fired } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'not');
    const child = requirePredicateNode(rec['child'], 'not', 'child');
    return `not (${describeNode(child, 'not')})`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'not');
    const child = requirePredicateNode(rec['child'], 'not', 'child');
    return makeArgSpec({ kind: 'composite', negated: true, children: [argSpecNode(child, 'not')] });
  },
};

// ===========================================================================
// Claim-scope selectors / claim-level conditions.
// ===========================================================================

export const claimAlways: ConditionOperator = {
  name: 'claimAlways',
  role: 'condition',
  evaluate: () => ({ fired: true, examined: {} }),
  describe: () => 'no condition — always true',
  argSpec: () => makeArgSpec({ kind: 'claimPresence' }),
};

interface ClaimMatchArgs {
  readonly si: string[] | undefined;
  readonly code: string[] | undefined;
}

function readClaimMatchArgs(rec: Record<string, unknown>, op: string): ClaimMatchArgs {
  const si = optionalStringArray(rec, 'si', op);
  const code = optionalStringArray(rec, 'code', op);
  if ((si === undefined) === (code === undefined)) {
    throw new Error(`${op}: exactly one of "si" or "code" is required`);
  }
  return { si, code };
}

function lineMatchesClaimArgs(line: LineFacts, m: ClaimMatchArgs): boolean {
  if (m.si !== undefined) return line.si !== null && m.si.includes(line.si);
  if (m.code !== undefined) return m.code.includes(line.code);
  return false;
}

function describeClaimMatchArgs(m: ClaimMatchArgs): string {
  if (m.si !== undefined) return `status indicator ${joinOr(m.si)}`;
  if (m.code !== undefined) return `code ${joinOr(m.code)}`;
  return '(nothing)';
}

export const claimContainsAny: ConditionOperator = {
  name: 'claimContainsAny',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'claimContainsAny');
    const m = readClaimMatchArgs(rec, 'claimContainsAny');
    const matches = ctx.claim.lines.filter((l) => lineMatchesClaimArgs(l, m));
    // Deliberately no claim-wide line-id list here (e.g. no
    // `matchingLineIds: matches.map(l => l.lineId)`). This is a claim-level
    // condition read from inside a line-scoped rule, so `examined` is
    // produced once per subject line; inlining the full matching-line set
    // would repeat it once per line, reproducing the O(rules x lines^2)
    // blowup spec §2.5 measured at 42 MiB minified on a 250-line claim. The
    // contributing lines are still fully recoverable: the interpreter
    // resolves this condition's `examined.factRefs` to a `Fact` whose own
    // `lineIds` names this same set exactly once (§2.5). Do not add this
    // back as a convenience — use factRefs.
    return { fired: matches.length > 0, examined: {} };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'claimContainsAny');
    return `the claim also contains a line with ${describeClaimMatchArgs(readClaimMatchArgs(rec, 'claimContainsAny'))}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'claimContainsAny');
    const m = readClaimMatchArgs(rec, 'claimContainsAny');
    return makeArgSpec({
      kind: 'claimPresence',
      dimension: m.si !== undefined ? 'si' : 'code',
      values: m.si !== undefined ? m.si : (m.code ?? []),
    });
  },
};

export const claimContainsNone: ConditionOperator = {
  name: 'claimContainsNone',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'claimContainsNone');
    const m = readClaimMatchArgs(rec, 'claimContainsNone');
    const matches = ctx.claim.lines.filter((l) => lineMatchesClaimArgs(l, m));
    // See claimContainsAny above: no matchingLineIds here, deliberately —
    // use examined.factRefs.
    return { fired: matches.length === 0, examined: {} };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'claimContainsNone');
    return `the claim contains no line with ${describeClaimMatchArgs(readClaimMatchArgs(rec, 'claimContainsNone'))}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'claimContainsNone');
    const m = readClaimMatchArgs(rec, 'claimContainsNone');
    return makeArgSpec({
      kind: 'claimPresence',
      dimension: m.si !== undefined ? 'si' : 'code',
      values: m.si !== undefined ? m.si : (m.code ?? []),
      negated: true,
    });
  },
};

export const claimContainsCode: ConditionOperator = {
  name: 'claimContainsCode',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'claimContainsCode');
    const code = requireString(rec, 'code', 'claimContainsCode');
    const matches = ctx.claim.lines.filter((l) => l.code === code);
    // See claimContainsAny above: no matchingLineIds here, deliberately —
    // use examined.factRefs.
    return { fired: matches.length > 0, examined: {} };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'claimContainsCode');
    return `the claim contains a line with code ${requireString(rec, 'code', 'claimContainsCode')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'claimContainsCode');
    return makeArgSpec({ kind: 'claimPresence', dimension: 'code', values: [requireString(rec, 'code', 'claimContainsCode')] });
  },
};

interface ClaimSumFilter {
  readonly code: string | undefined;
  readonly si: string[] | undefined;
}

function readClaimSumFilter(rec: Record<string, unknown>, op: string): ClaimSumFilter {
  const code = optionalString(rec, 'code', op);
  const si = optionalStringArray(rec, 'si', op);
  if ((code === undefined) === (si === undefined)) {
    throw new Error(`${op}: exactly one of "code" or "si" is required`);
  }
  return { code, si };
}

function lineMatchesSumFilter(line: LineFacts, f: ClaimSumFilter): boolean {
  if (f.code !== undefined) return line.code === f.code;
  if (f.si !== undefined) return line.si !== null && f.si.includes(line.si);
  return false;
}

function describeSumFilter(f: ClaimSumFilter): string {
  if (f.code !== undefined) return `code ${f.code}`;
  if (f.si !== undefined) return `status indicator ${joinOr(f.si)}`;
  return '(nothing)';
}

export const claimUnitsAtLeast: ConditionOperator = {
  name: 'claimUnitsAtLeast',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'claimUnitsAtLeast');
    const f = readClaimSumFilter(rec, 'claimUnitsAtLeast');
    const units = requireNumber(rec, 'units', 'claimUnitsAtLeast');
    const matching = ctx.claim.lines.filter((l) => lineMatchesSumFilter(l, f));
    const sum = matching.reduce((s, l) => s + l.unitCount, 0);
    // `sum` is a scalar and stays — genuinely useful in the trace. No
    // matchingLineIds alongside it, deliberately: see claimContainsAny
    // above for why (use examined.factRefs to recover the contributing lines).
    return { fired: sum >= units, examined: { sum } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'claimUnitsAtLeast');
    const f = readClaimSumFilter(rec, 'claimUnitsAtLeast');
    const units = requireNumber(rec, 'units', 'claimUnitsAtLeast');
    return `the claim's lines matching ${describeSumFilter(f)} sum to at least ${units} units`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'claimUnitsAtLeast');
    const f = readClaimSumFilter(rec, 'claimUnitsAtLeast');
    return makeArgSpec({
      kind: 'claimQuantity',
      dimension: f.code !== undefined ? 'code' : 'si',
      threshold: requireNumber(rec, 'units', 'claimUnitsAtLeast'),
    });
  },
};

export const claimLineCountAtLeast: ConditionOperator = {
  name: 'claimLineCountAtLeast',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'claimLineCountAtLeast');
    const code = optionalString(rec, 'code', 'claimLineCountAtLeast');
    const si = optionalStringArray(rec, 'si', 'claimLineCountAtLeast');
    const count = requireNumber(rec, 'count', 'claimLineCountAtLeast');
    const matching =
      code !== undefined
        ? ctx.claim.lines.filter((l) => l.code === code)
        : si !== undefined
          ? ctx.claim.lines.filter((l) => l.si !== null && si.includes(l.si))
          : ctx.claim.lines;
    // See claimContainsAny above: no matchingLineIds here, deliberately —
    // use examined.factRefs.
    return { fired: matching.length >= count, examined: {} };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'claimLineCountAtLeast');
    const code = optionalString(rec, 'code', 'claimLineCountAtLeast');
    const si = optionalStringArray(rec, 'si', 'claimLineCountAtLeast');
    const count = requireNumber(rec, 'count', 'claimLineCountAtLeast');
    const which = code !== undefined ? `with code ${code}` : si !== undefined ? `with status indicator ${joinOr(si)}` : 'total';
    return `the claim has at least ${count} lines ${which}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'claimLineCountAtLeast');
    const code = optionalString(rec, 'code', 'claimLineCountAtLeast');
    const si = optionalStringArray(rec, 'si', 'claimLineCountAtLeast');
    return makeArgSpec({
      kind: 'claimQuantity',
      dimension: code !== undefined ? 'code' : si !== undefined ? 'si' : 'units',
      threshold: requireNumber(rec, 'count', 'claimLineCountAtLeast'),
    });
  },
};

// ===========================================================================
// Context conditions — optionIs/optionAtLeast/optionUnknown double as
// claim-scope selectors (§4.3); dosOnOrAfter/dosBefore read the subject
// line's date of service.
// ===========================================================================

export const optionIs: ConditionOperator = {
  name: 'optionIs',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'optionIs');
    const option = requireString(rec, 'option', 'optionIs');
    if (!('equals' in rec)) throw new Error('optionIs: missing "equals"');
    const equals = rec['equals'] as JsonValue;
    const value = ctx.options[option];
    if (value === undefined) return { fired: false, examined: { present: false } };
    return { fired: deepEqual(value, equals), examined: { present: true, value } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'optionIs');
    const option = requireString(rec, 'option', 'optionIs');
    return `option "${option}" is ${JSON.stringify(rec['equals'])}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'optionIs');
    return makeArgSpec({ kind: 'context', dimension: 'option', target: requireString(rec, 'option', 'optionIs') });
  },
};

export const optionAtLeast: ConditionOperator = {
  name: 'optionAtLeast',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'optionAtLeast');
    const option = requireString(rec, 'option', 'optionAtLeast');
    const atLeast = requireNumber(rec, 'atLeast', 'optionAtLeast');
    const value = ctx.options[option];
    if (value === undefined) return { fired: false, examined: { present: false } };
    if (typeof value !== 'number') {
      throw new Error(`optionAtLeast: option "${option}" is not numeric, got ${JSON.stringify(value)}`);
    }
    return { fired: value >= atLeast, examined: { present: true, value } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'optionAtLeast');
    const option = requireString(rec, 'option', 'optionAtLeast');
    const atLeast = requireNumber(rec, 'atLeast', 'optionAtLeast');
    return `option "${option}" is at least ${atLeast}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'optionAtLeast');
    return makeArgSpec({
      kind: 'context',
      dimension: 'option',
      target: requireString(rec, 'option', 'optionAtLeast'),
      threshold: requireNumber(rec, 'atLeast', 'optionAtLeast'),
    });
  },
};

export const optionUnknown: ConditionOperator = {
  name: 'optionUnknown',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'optionUnknown');
    const option = requireString(rec, 'option', 'optionUnknown');
    return { fired: ctx.options[option] === undefined, examined: {} };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'optionUnknown');
    return `option "${requireString(rec, 'option', 'optionUnknown')}" was not supplied`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'optionUnknown');
    return makeArgSpec({ kind: 'context', dimension: 'option', target: requireString(rec, 'option', 'optionUnknown') });
  },
};

export const dosOnOrAfter: ConditionOperator = {
  name: 'dosOnOrAfter',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'dosOnOrAfter');
    const date = requireString(rec, 'date', 'dosOnOrAfter');
    const subject = requireSubject(ctx, 'dosOnOrAfter');
    return { fired: subject.dos >= date, examined: { subjectDos: subject.dos } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'dosOnOrAfter');
    return `the date of service is on or after ${requireString(rec, 'date', 'dosOnOrAfter')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'dosOnOrAfter');
    return makeArgSpec({ kind: 'context', dimension: 'date', target: requireString(rec, 'date', 'dosOnOrAfter') });
  },
};

export const dosBefore: ConditionOperator = {
  name: 'dosBefore',
  role: 'condition',
  evaluate: (args, ctx) => {
    const rec = requireRecord(args, 'dosBefore');
    const date = requireString(rec, 'date', 'dosBefore');
    const subject = requireSubject(ctx, 'dosBefore');
    return { fired: subject.dos < date, examined: { subjectDos: subject.dos } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'dosBefore');
    return `the date of service is before ${requireString(rec, 'date', 'dosBefore')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'dosBefore');
    return makeArgSpec({ kind: 'context', dimension: 'date', target: requireString(rec, 'date', 'dosBefore') });
  },
};

// ===========================================================================
// Relational conditions — isHighestBy, isNotHighestBy, ordinalIs,
// ordinalAtLeast. All rank `among` (a scope-selector predicate node,
// evaluated against every claim line) by `field`, descending, with an
// explicit `tiebreak`. A ranking selector with a null field and no
// `fallbackField` is a hard error (§4.2) — never a silent skip.
// ===========================================================================

export type Tiebreak = 'codeAsc' | 'codeDesc';

function isTiebreak(v: unknown): v is Tiebreak {
  return v === 'codeAsc' || v === 'codeDesc';
}

/** Exported alongside {@link readRankField}/{@link resolveRankValue}/{@link rankAmong} — see the note on `readRankField`. */
export interface RankSpec {
  readonly field: RankField;
  readonly among: PredicateNode;
  readonly tiebreak: Tiebreak;
  readonly fallbackField: RankField | undefined;
}

function readRankSpec(rec: Record<string, unknown>, op: string): RankSpec {
  const field = requireRankField(rec, 'field', op);
  const among = requirePredicateNode(rec['among'], op, 'among');
  const tiebreakRaw = rec['tiebreak'];
  if (!isTiebreak(tiebreakRaw)) {
    throw new Error(`${op}: expected "tiebreak" to be "codeAsc" or "codeDesc", got ${JSON.stringify(tiebreakRaw)}`);
  }
  const fallbackRaw = rec['fallbackField'];
  const fallbackField = fallbackRaw === undefined ? undefined : requireRankField(rec, 'fallbackField', op);
  return { field, among, tiebreak: tiebreakRaw, fallbackField };
}

/** See the note on {@link readRankField} for why this is exported. */
export function resolveRankValue(line: LineFacts, spec: RankSpec, op: string): number {
  const primary = readRankField(line, spec.field);
  if (primary !== null) return primary;
  if (spec.fallbackField === undefined) {
    throw new Error(
      `${op}: line ${line.lineId} has a null "${spec.field}" and no fallbackField was declared — hard error, not a silent skip (§4.2)`,
    );
  }
  const fallback = readRankField(line, spec.fallbackField);
  if (fallback === null) {
    throw new Error(`${op}: line ${line.lineId} has a null "${spec.field}" and its fallbackField "${spec.fallbackField}" is also null`);
  }
  return fallback;
}

/**
 * Ranks `among`-member claim lines by `spec.field` desc, tiebreak by code.
 * Rank 1 is highest. See the note on {@link readRankField} for why this is
 * exported.
 */
export function rankAmong(
  spec: RankSpec,
  ctx: OperatorContext,
  evalNode: EvalNode,
  op: string,
): { ranked: readonly LineFacts[]; values: ReadonlyMap<string, number> } {
  const members = ctx.claim.lines.filter(
    (line) => evalNode(spec.among, { subject: line, claim: ctx.claim, options: ctx.options }).fired,
  );
  const values = new Map<string, number>();
  for (const line of members) {
    values.set(line.lineId, resolveRankValue(line, spec, op));
  }
  const ranked = [...members].sort((a, b) => {
    const av = values.get(a.lineId);
    const bv = values.get(b.lineId);
    const aVal = av === undefined ? 0 : av;
    const bVal = bv === undefined ? 0 : bv;
    if (aVal !== bVal) return bVal - aVal; // descending by value
    return spec.tiebreak === 'codeAsc' ? a.code.localeCompare(b.code) : b.code.localeCompare(a.code);
  });
  return { ranked, values };
}

/** Returns the subject's 1-based ordinal within `among`, or null if not a member. */
function subjectOrdinal(
  spec: RankSpec,
  ctx: OperatorContext,
  evalNode: EvalNode,
  op: string,
): { ordinal: number | null; subjectInAmong: boolean } {
  const subject = requireSubject(ctx, op);
  const { ranked } = rankAmong(spec, ctx, evalNode, op);
  const idx = ranked.findIndex((l) => l.lineId === subject.lineId);
  if (idx === -1) return { ordinal: null, subjectInAmong: false };
  return { ordinal: idx + 1, subjectInAmong: true };
}

function describeRankSpec(spec: RankSpec, op: string): string {
  return `${spec.field} ranked among lines where ${describeNode(spec.among, op)} (tiebreak ${spec.tiebreak})`;
}

function argSpecRankSpec(spec: RankSpec, op: string): { field: string; children: readonly ArgSpec[] } {
  return { field: spec.field, children: [argSpecNode(spec.among, op)] };
}

export const isHighestBy: ConditionOperator = {
  name: 'isHighestBy',
  role: 'condition',
  evaluate: (args, ctx, evalNode) => {
    const rec = requireRecord(args, 'isHighestBy');
    const spec = readRankSpec(rec, 'isHighestBy');
    const { ordinal, subjectInAmong } = subjectOrdinal(spec, ctx, evalNode, 'isHighestBy');
    return { fired: ordinal === 1, examined: { ordinal, subjectInAmong } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'isHighestBy');
    return `the line has the highest ${describeRankSpec(readRankSpec(rec, 'isHighestBy'), 'isHighestBy')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'isHighestBy');
    const built = argSpecRankSpec(readRankSpec(rec, 'isHighestBy'), 'isHighestBy');
    return makeArgSpec({ kind: 'relational', field: built.field, children: built.children });
  },
};

export const isNotHighestBy: ConditionOperator = {
  name: 'isNotHighestBy',
  role: 'condition',
  evaluate: (args, ctx, evalNode) => {
    const rec = requireRecord(args, 'isNotHighestBy');
    const spec = readRankSpec(rec, 'isNotHighestBy');
    const { ordinal, subjectInAmong } = subjectOrdinal(spec, ctx, evalNode, 'isNotHighestBy');
    return { fired: ordinal !== 1, examined: { ordinal, subjectInAmong } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'isNotHighestBy');
    return `the line does not have the highest ${describeRankSpec(readRankSpec(rec, 'isNotHighestBy'), 'isNotHighestBy')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'isNotHighestBy');
    const built = argSpecRankSpec(readRankSpec(rec, 'isNotHighestBy'), 'isNotHighestBy');
    return makeArgSpec({ kind: 'relational', field: built.field, children: built.children, negated: true });
  },
};

export const ordinalIs: ConditionOperator = {
  name: 'ordinalIs',
  role: 'condition',
  evaluate: (args, ctx, evalNode) => {
    const rec = requireRecord(args, 'ordinalIs');
    const spec = readRankSpec(rec, 'ordinalIs');
    const equals = requireNumber(rec, 'equals', 'ordinalIs');
    const { ordinal, subjectInAmong } = subjectOrdinal(spec, ctx, evalNode, 'ordinalIs');
    return { fired: ordinal === equals, examined: { ordinal, subjectInAmong } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'ordinalIs');
    const spec = readRankSpec(rec, 'ordinalIs');
    const equals = requireNumber(rec, 'equals', 'ordinalIs');
    return `the line's rank by ${describeRankSpec(spec, 'ordinalIs')} is exactly ${equals}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'ordinalIs');
    const built = argSpecRankSpec(readRankSpec(rec, 'ordinalIs'), 'ordinalIs');
    return makeArgSpec({ kind: 'relational', field: built.field, children: built.children, threshold: requireNumber(rec, 'equals', 'ordinalIs') });
  },
};

export const ordinalAtLeast: ConditionOperator = {
  name: 'ordinalAtLeast',
  role: 'condition',
  evaluate: (args, ctx, evalNode) => {
    const rec = requireRecord(args, 'ordinalAtLeast');
    const spec = readRankSpec(rec, 'ordinalAtLeast');
    const atLeast = requireNumber(rec, 'atLeast', 'ordinalAtLeast');
    const { ordinal, subjectInAmong } = subjectOrdinal(spec, ctx, evalNode, 'ordinalAtLeast');
    return { fired: ordinal !== null && ordinal >= atLeast, examined: { ordinal, subjectInAmong } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'ordinalAtLeast');
    const spec = readRankSpec(rec, 'ordinalAtLeast');
    const atLeast = requireNumber(rec, 'atLeast', 'ordinalAtLeast');
    return `the line's rank by ${describeRankSpec(spec, 'ordinalAtLeast')} is at least ${atLeast}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'ordinalAtLeast');
    const built = argSpecRankSpec(readRankSpec(rec, 'ordinalAtLeast'), 'ordinalAtLeast');
    return makeArgSpec({
      kind: 'relational',
      field: built.field,
      children: built.children,
      threshold: requireNumber(rec, 'atLeast', 'ordinalAtLeast'),
    });
  },
};

// ===========================================================================
// Reserved
// ===========================================================================

export const unimplemented: ConditionOperator = {
  name: 'unimplemented',
  role: 'condition',
  // Never fires. The interpreter is expected to special-case `kind ===
  // 'reserved'` (or the operator name) to force `outcome: "NOT_EVALUATED"`
  // rather than treat a returned `false` as an ordinary NOT_FIRED — see the
  // final-report note on this operator's split responsibility.
  evaluate: (args) => {
    const rec = requireRecord(args, 'unimplemented');
    const reason = requireString(rec, 'reason', 'unimplemented');
    return { fired: false, examined: { reason } };
  },
  describe: (args) => {
    const rec = requireRecord(args, 'unimplemented');
    return `not yet implemented: ${requireString(rec, 'reason', 'unimplemented')}`;
  },
  argSpec: () => makeArgSpec({ kind: 'reserved' }),
};

// ===========================================================================
// Effects — no evaluate(); they act, they don't fire/not-fire. Every effect
// still ships describe()/argSpec() (§4.4: "Effects ship argSpec too").
// ===========================================================================

export const setStatus: EffectOperator = {
  name: 'setStatus',
  role: 'effect',
  describe: (args) => {
    const rec = requireRecord(args, 'setStatus');
    return `sets the line's status to ${requireString(rec, 'status', 'setStatus')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'setStatus');
    return makeArgSpec({ kind: 'effect', dimension: 'status', target: requireString(rec, 'status', 'setStatus') });
  },
};

export const bundleUnder: EffectOperator = {
  name: 'bundleUnder',
  role: 'effect',
  describe: (args) => {
    const rec = requireRecord(args, 'bundleUnder');
    const field = requireRankField(rec, 'highestBy', 'bundleUnder');
    const among = requirePredicateNode(rec['among'], 'bundleUnder', 'among');
    return `bundles under the line with the highest ${field} among lines where ${describeNode(among, 'bundleUnder')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'bundleUnder');
    const field = requireRankField(rec, 'highestBy', 'bundleUnder');
    const among = requirePredicateNode(rec['among'], 'bundleUnder', 'among');
    return makeArgSpec({ kind: 'effect', field, children: [argSpecNode(among, 'bundleUnder')] });
  },
};

export const convertSI: EffectOperator = {
  name: 'convertSI',
  role: 'effect',
  describe: (args) => {
    const rec = requireRecord(args, 'convertSI');
    return `converts the line's status indicator to ${requireString(rec, 'to', 'convertSI')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'convertSI');
    return makeArgSpec({ kind: 'effect', dimension: 'si', target: requireString(rec, 'to', 'convertSI') });
  },
};

export const route: EffectOperator = {
  name: 'route',
  role: 'effect',
  // `route` takes NO arguments — spec §4.3.1, decision D18. It is a structural
  // marker: `dsl/evaluate.ts` only sets `ws.routed = true`, because the target
  // schedule is computed from (code, effectiveSI) by the shared `routing.ts`
  // resolver that the phase wiring calls afterwards (§2.3, §3.4).
  //
  // A `schedule` key is therefore REJECTED rather than accepted-and-ignored.
  // An earlier version made it optional, which meant a rule could author
  // `{"route": {"schedule": "CLFS"}}`, pass validation, and be silently
  // discarded at evaluation — the same "valid at load, ignored at run" failure
  // class that §12.2's payload validation exists to eliminate. Worse, a rule
  // naming a schedule would reintroduce the stale-derived-value problem that
  // removing the per-code `schedule` column fixed (D12).
  describe: () => 'routes the line to the fee schedule resolved by the routing step (§2.3)',
  argSpec: (args) => {
    const rec = requireRecord(args, 'route');
    for (const key of Object.keys(rec)) {
      throw new Error(
        `route takes no arguments; got '${key}'. The target schedule is computed by routing.resolve(), not named in the registry (spec §4.3.1, D18).`,
      );
    }
    return makeArgSpec({ kind: 'effect', dimension: 'schedule' });
  },
};

export const setBasis: EffectOperator = {
  name: 'setBasis',
  role: 'effect',
  describe: (args) => {
    const rec = requireRecord(args, 'setBasis');
    return `sets the pricing basis to ${requireString(rec, 'value', 'setBasis')}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'setBasis');
    return makeArgSpec({ kind: 'effect', target: requireString(rec, 'value', 'setBasis') });
  },
};

export const exempt: EffectOperator = {
  name: 'exempt',
  role: 'effect',
  describe: () => 'marks the line exempt from packaging',
  argSpec: () => makeArgSpec({ kind: 'effect', dimension: 'status' }),
};

export const flag: EffectOperator = {
  name: 'flag',
  role: 'effect',
  describe: (args) => {
    const rec = requireRecord(args, 'flag');
    const code = requireString(rec, 'code', 'flag');
    const severity = requireString(rec, 'severity', 'flag');
    const message = requireString(rec, 'message', 'flag');
    return `raises a ${severity} flag (${code}): ${message}`;
  },
  argSpec: (args) => {
    const rec = requireRecord(args, 'flag');
    return makeArgSpec({ kind: 'effect', target: requireString(rec, 'code', 'flag') });
  },
};

export const stop: EffectOperator = {
  name: 'stop',
  role: 'effect',
  describe: () => "halts further rule evaluation for this line in the current phase (except bands marked 'alwaysEvaluate')",
  argSpec: () => makeArgSpec({ kind: 'effect' }),
};

// ===========================================================================
// The full closed set, keyed by name. This is the module's one piece of
// mutable state, populated here (not at each operator's own declaration) so
// composite/relational describe() and argSpec() can close over it safely
// regardless of declaration order.
// ===========================================================================

Object.assign(operatorRegistry, {
  always,
  siIn,
  codeIn,
  codePattern,
  apcIn,
  inSchedule,
  statusIn,
  isExempt,
  siIs,
  hasModifier,
  unitsAtLeast,
  hasRate,
  hasWeight,
  not,
  allOf,
  anyOf,
  claimAlways,
  claimContainsAny,
  claimContainsNone,
  claimContainsCode,
  claimUnitsAtLeast,
  claimLineCountAtLeast,
  optionIs,
  optionAtLeast,
  optionUnknown,
  dosOnOrAfter,
  dosBefore,
  isHighestBy,
  isNotHighestBy,
  ordinalIs,
  ordinalAtLeast,
  unimplemented,
  setStatus,
  bundleUnder,
  convertSI,
  route,
  setBasis,
  exempt,
  flag,
  stop,
} satisfies Record<string, AnyOperator>);

Object.freeze(operatorRegistry);

/** The full closed operator set, keyed by name (§4.3). Read-only. */
export const operators: Readonly<Record<string, AnyOperator>> = operatorRegistry;

/**
 * A trivial `EvalNode` dispatcher built from `operators`, for tests and for
 * any caller that doesn't need the real interpreter's trace/epoch layering.
 * The real `evaluate.ts` is expected to build its own, richer `evalNode`
 * instead of using this one.
 */
export function makeSimpleEvalNode(): EvalNode {
  const evalNode: EvalNode = (node, ctx) => {
    const op = operatorRegistry[node.op];
    if (op === undefined) throw new Error(`makeSimpleEvalNode: unknown operator "${node.op}"`);
    if (op.role !== 'condition') throw new Error(`makeSimpleEvalNode: "${node.op}" is an effect, not a condition`);
    return op.evaluate(node.args, ctx, evalNode);
  };
  return evalNode;
}
