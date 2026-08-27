/**
 * U19 — the rule inspector (spec §6.1, §6.2, §4.4, §5.2, §5.3, §5.3a, §4.2,
 * §4.3.1). Two query modes over the same registry, plus a small code-facts
 * helper both share:
 *
 *   - `explain()`   (§6.1) — retrospective. Given an already-adjudicated
 *     `Result`, restructure its trace per line: every rule considered, in
 *     order, with outcome/citation/epoch/facts, and — for whichever entries
 *     carry one — the counterfactual resolved through `Result.counterfactuals`
 *     rather than left as a bare ref.
 *   - `applicability()` (§6.2) — prospective. Given a **code alone, no
 *     claim**, enumerate every rule whose `scope` admits it, generated from
 *     rule data plus each operator's `describe()`/`argSpec()` — never
 *     hand-written prose (§4.4).
 *   - `codeFacts()` (mode 3) — what the data knows about a code: SI, APC,
 *     weight, rate presence, CLFS presence and rate, historical term date.
 *     Used by `applicability()` and useful standalone.
 *
 * LAYERING (build brief, restated here so a future edit doesn't drift). This
 * file may import `dsl/operators.js`, `src/data/index.js`, `src/types.js`,
 * and the registry loader (`registry/loader.js`) — never `phases/*` and
 * never `dsl/evaluate.js`. Two consequences that show up directly below:
 *
 *   - `Result`/`Determination`/`AssembledEvaluation` are real types owned by
 *     `phases/adjudicate.ts` and `trace.ts`, both off limits here. Rather
 *     than import them, this file declares its own structurally-equivalent
 *     `Explainable*` interfaces built only from `src/types.js` vocabulary
 *     (`Phase`, `Epoch`, `Outcome`, `Fact`, `EvaluationExamined`,
 *     `EffectApplication`, `ScopeExclusion`). TypeScript's structural typing
 *     means a real `EngineResult` (a superset) satisfies `ExplainableResult`
 *     with no cast — the same "declared locally, not imported" discipline
 *     `dsl/operators.ts`'s own header already commits to for exactly this
 *     reason (self-containment, not a coincidence of convenience).
 *   - Likewise `Rule` is owned by `dsl/evaluate.ts`. `InspectableRule` below
 *     is a local structural stand-in carrying only the fields the two modes
 *     read; `registry/loader.ts#loadRegistry()`'s real `Rule[]` output
 *     satisfies it the same way.
 *   - `resolveCounterfactual`'s dangling-ref hard error (`trace.ts`) is
 *     reimplemented locally in miniature rather than imported, for the same
 *     reason.
 *
 * See the final report for the applicability-mode design decisions this
 * header only summarizes: how `statusIn`/`isExempt` (and, generalized, any
 * scope predicate this file cannot statically resolve) are kept out of both
 * the admitted and excluded buckets, why claim-scoped rules are out of scope
 * for a code-alone query, and what the real §6.2 output for 84112 looks like
 * against the shipped registry (it differs from the spec's own §6.2
 * illustration, which was written against §4.2's simpler, unguarded example
 * rule rather than the shipped registry's `not(statusIn(["BUNDLED"]))`
 * cross-band guards).
 */

import type { Epoch, EffectApplication, EvaluationExamined, Fact, Outcome, Phase, ScopeExclusion } from './types.js';
import { EPOCH_ORDER } from './types.js';
import {
  operators,
  makeSimpleEvalNode,
  type AnyOperator,
  type ArgSpec,
  type ClaimFacts,
  type ConditionOperator,
  type EffectOperator,
  type LineFacts,
  type OperatorContext,
  type PredicateNode,
} from './dsl/operators.js';
import { lookupOpps, lookupClfs, getHcpcsTermDate } from './data/index.js';

// ===========================================================================
// Mode 3 — code facts. What the data knows about a code, independent of any
// claim or rule. Used by applicability() and useful standalone.
// ===========================================================================

export interface CodeFacts {
  readonly code: string;
  readonly si: string | null;
  readonly apc: string | null;
  /** Relative weight, if Addendum B carries one — a ranking key, not money. */
  readonly weight: number | null;
  /** Whether the code carries an OPPS Addendum B payment rate. */
  readonly hasRate: boolean;
  readonly hasWeight: boolean;
  readonly clfsPresent: boolean;
  /** Integer mils (1/1000 dollar), the unmodified CLFS row only — spec §7.1. */
  readonly clfsRateMils: number | null;
  /** YYYYMMDD termination date on file, or `null` if none (§7.5.1: absence is not evidence the code was never valid). */
  readonly historicalTermDate: string | null;
}

export function codeFacts(code: string): CodeFacts {
  const opps = lookupOpps(code);
  const clfs = lookupClfs(code, '');
  const termDate = getHcpcsTermDate(code);
  return {
    code,
    si: opps?.si ?? null,
    apc: opps?.apc ?? null,
    weight: opps?.weight ?? null,
    hasRate: opps !== undefined && opps.rateMils !== null,
    hasWeight: opps !== undefined && opps.weight !== null,
    clfsPresent: clfs !== undefined,
    clfsRateMils: clfs?.rateMils ?? null,
    historicalTermDate: termDate ?? null,
  };
}

// ===========================================================================
// Shared JSON-node guards. Small and local, matching dsl/operators.ts's own
// "declared locally, not imported" discipline (see that file's header) —
// there is no shared home for these across the layering boundary this file
// sits behind.
// ===========================================================================

function isJsonRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPredicateNodeLike(v: unknown): v is PredicateNode {
  return isJsonRecord(v) && typeof v['op'] === 'string' && 'args' in v;
}

function childOf(node: PredicateNode, where: string): PredicateNode {
  const args = node.args;
  const raw = isJsonRecord(args) ? args['child'] : undefined;
  if (!isPredicateNodeLike(raw)) {
    throw new Error(`inspect: "${where}" expected a "child" predicate node, got ${JSON.stringify(args)}`);
  }
  return raw;
}

function childrenOf(node: PredicateNode, where: string): readonly PredicateNode[] {
  const args = node.args;
  const raw = isJsonRecord(args) ? args['children'] : undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`inspect: "${where}" expected a "children" array, got ${JSON.stringify(args)}`);
  }
  const out: PredicateNode[] = [];
  for (const item of raw) {
    if (!isPredicateNodeLike(item)) {
      throw new Error(`inspect: "${where}" has a non-predicate-node entry in "children"`);
    }
    out.push(item);
  }
  return out;
}

function lookupOperator(op: string): AnyOperator {
  const found = operators[op];
  if (found === undefined) {
    throw new Error(`inspect: unknown operator "${op}" — the registry loader should have rejected this at load time (§12.2)`);
  }
  return found;
}

function requireCondition(op: string): ConditionOperator {
  const found = lookupOperator(op);
  if (found.role !== 'condition') {
    throw new Error(`inspect: expected "${op}" to be a condition operator, got role "${found.role}"`);
  }
  return found;
}

function requireEffect(op: string): EffectOperator {
  const found = lookupOperator(op);
  if (found.role !== 'effect') {
    throw new Error(`inspect: expected "${op}" to be an effect operator, got role "${found.role}"`);
  }
  return found;
}

// ===========================================================================
// Mode 2 — applicability (§6.2). Static query over the registry: no
// adjudication, no claim context, no line.
// ===========================================================================

/** Local structural stand-in for `dsl/evaluate.ts`'s `Rule` — see file header. */
export interface InspectableRule {
  readonly id: string;
  readonly order: number;
  readonly band: number;
  readonly epoch: Epoch;
  readonly scopeTarget: 'line' | 'claim';
  readonly citation: string;
  readonly scope: PredicateNode;
  readonly when?: PredicateNode;
  readonly then: readonly PredicateNode[];
  readonly note?: string;
  readonly dataRequired?: boolean;
}

export interface DescribedEffect {
  readonly op: string;
  readonly description: string;
  readonly argSpec: ArgSpec;
}

export interface UndecidablePredicate {
  readonly op: string;
  readonly description: string;
}

export interface ApplicableRule {
  readonly ruleId: string;
  readonly order: number;
  readonly band: number;
  readonly epoch: Epoch;
  readonly citation: string;
  /** describe() of the rule's `when` clause — "no condition — always true" (`always`'s own text, reused) when `when` is absent. */
  readonly firesWhen: string;
  readonly whenArgSpec: ArgSpec;
  readonly effects: readonly DescribedEffect[];
  readonly note: string | null;
}

/**
 * A rule whose admission cannot be decided from a code alone: its `scope`
 * tree contains `statusIn`, `isExempt`, or any other selector this walker
 * does not statically resolve (§6.2's build brief: "do not silently drop
 * those rules and do not silently include them"). `undecidable` names every
 * such predicate encountered, described via the operator's own `describe()`.
 */
export interface ConditionalRule extends ApplicableRule {
  readonly undecidable: readonly UndecidablePredicate[];
}

export interface ReservedRule {
  readonly ruleId: string;
  readonly order: number;
  readonly band: number;
  readonly epoch: Epoch;
  readonly citation: string;
  readonly reason: string;
  readonly note: string | null;
}

export interface ApplicabilityResult {
  readonly code: string;
  readonly facts: CodeFacts;
  readonly admitted: readonly ApplicableRule[];
  readonly conditional: readonly ConditionalRule[];
  readonly reserved: readonly ReservedRule[];
}

// ---------------------------------------------------------------------------
// Static scope decidability. Three-valued (Kleene) logic over ADMIT/REJECT/
// CONDITIONAL: a leaf test of the code's own static properties (SI, code,
// APC) is decidable; `statusIn`/`isExempt` — and, generalized, anything else
// this file does not special-case — read state that only exists once a
// claim (possibly other lines on it) is in hand, so they resolve to
// CONDITIONAL rather than a guessed default. `allOf`/`anyOf`/`not` combine
// per standard 3-valued AND/OR/NOT: REJECT dominates an `allOf` regardless
// of any CONDITIONAL sibling (false AND unknown is false), ADMIT dominates
// an `anyOf` the same way.
// ===========================================================================

type ScopeDecision = 'ADMIT' | 'REJECT' | 'CONDITIONAL';

interface ScopeWalk {
  readonly decision: ScopeDecision;
  readonly undecidable: readonly UndecidablePredicate[];
}

/**
 * Statically decidable from a code's own facts alone, with no claim: whether
 * this code's SI/code/APC matches. `always` is trivially decidable too.
 * `inSchedule` is deliberately NOT included — resolving it exactly requires
 * `routing.resolve()`, which this file may not import (see file header); see
 * the final report for why it is instead treated as undecidable, like
 * `statusIn`/`isExempt`, rather than reimplemented and risking drift from
 * the canonical resolver. No shipped rule uses `inSchedule` in `scope` today.
 */
const DECIDABLE_LEAF_OPS: ReadonlySet<string> = new Set(['always', 'siIn', 'codeIn', 'codePattern', 'apcIn']);

const trivialEvalNode = makeSimpleEvalNode();

function buildContext(subject: LineFacts): OperatorContext {
  const claim: ClaimFacts = { lines: [subject] };
  return { subject, claim, options: {} };
}

function invertDecision(d: ScopeDecision): ScopeDecision {
  if (d === 'ADMIT') return 'REJECT';
  if (d === 'REJECT') return 'ADMIT';
  return 'CONDITIONAL';
}

function andAll(ds: readonly ScopeDecision[]): ScopeDecision {
  if (ds.includes('REJECT')) return 'REJECT';
  if (ds.includes('CONDITIONAL')) return 'CONDITIONAL';
  return 'ADMIT';
}

function orAny(ds: readonly ScopeDecision[]): ScopeDecision {
  if (ds.includes('ADMIT')) return 'ADMIT';
  if (ds.includes('CONDITIONAL')) return 'CONDITIONAL';
  return 'REJECT';
}

function walkScope(node: PredicateNode, subject: LineFacts): ScopeWalk {
  if (node.op === 'not') {
    const inner = walkScope(childOf(node, 'not'), subject);
    return { decision: invertDecision(inner.decision), undecidable: inner.undecidable };
  }
  if (node.op === 'allOf' || node.op === 'anyOf') {
    const results = childrenOf(node, node.op).map((c) => walkScope(c, subject));
    const decision = node.op === 'allOf' ? andAll(results.map((r) => r.decision)) : orAny(results.map((r) => r.decision));
    const undecidable = results.flatMap((r) => r.undecidable);
    return { decision, undecidable };
  }

  const op = lookupOperator(node.op);
  if (DECIDABLE_LEAF_OPS.has(node.op) && op.role === 'condition') {
    const fired = op.evaluate(node.args, buildContext(subject), trivialEvalNode).fired;
    return { decision: fired ? 'ADMIT' : 'REJECT', undecidable: [] };
  }

  // statusIn, isExempt, inSchedule, or any operator this walker does not
  // statically resolve — undecidable from a code alone (§6.2 build brief).
  const description = op.describe(node.args);
  return { decision: 'CONDITIONAL', undecidable: [{ op: node.op, description }] };
}

function subjectFactsFor(code: string, facts: CodeFacts): LineFacts {
  return {
    lineId: 'inspect:subject',
    code,
    si: facts.si,
    apc: facts.apc,
    schedule: null,
    status: null,
    modifiers: [],
    unitCount: 0,
    rateMils: null,
    weight: facts.weight,
    chargeMils: 0,
    isExempt: false,
    dos: '',
  };
}

const ALWAYS_NODE: PredicateNode = { op: 'always', args: {} };

function buildApplicable(rule: InspectableRule): ApplicableRule {
  const whenNode = rule.when ?? ALWAYS_NODE;
  const whenOp = requireCondition(whenNode.op);
  const effects: DescribedEffect[] = rule.then.map((eff) => {
    const op = requireEffect(eff.op);
    return { op: eff.op, description: op.describe(eff.args), argSpec: op.argSpec(eff.args) };
  });
  return {
    ruleId: rule.id,
    order: rule.order,
    band: rule.band,
    epoch: rule.epoch,
    citation: rule.citation,
    firesWhen: whenOp.describe(whenNode.args),
    whenArgSpec: whenOp.argSpec(whenNode.args),
    effects,
    note: rule.note ?? null,
  };
}

function buildReserved(rule: InspectableRule): ReservedRule {
  const whenNode = rule.when;
  let reason = '';
  if (whenNode !== undefined && isJsonRecord(whenNode.args)) {
    const r = whenNode.args['reason'];
    if (typeof r === 'string') reason = r;
  }
  return { ruleId: rule.id, order: rule.order, band: rule.band, epoch: rule.epoch, citation: rule.citation, reason, note: rule.note ?? null };
}

/**
 * §6.2. `rules` is caller-supplied (e.g. `loadRegistry()`'s output, or a
 * caller's own subset/fixture) rather than an implicit default: this file
 * cannot import `src/index.ts`'s bundled-registry assembly without crossing
 * into `phases/`-adjacent wiring, and a caller-supplied registry is exactly
 * what §6.2's "static query over the registry" implies is composable with.
 *
 * Only `scopeTarget: "line"` rules are considered — a claim-scoped rule's
 * scope (`claimAlways`/`claimContainsAny`/...) is a statement about a whole
 * claim, not about one code, so "does this code admit this rule" has no
 * answer for it; see the final report.
 */
export function applicability(code: string, rules: readonly InspectableRule[]): ApplicabilityResult {
  const facts = codeFacts(code);
  const subject = subjectFactsFor(code, facts);

  const admitted: ApplicableRule[] = [];
  const conditional: ConditionalRule[] = [];
  const reserved: ReservedRule[] = [];

  const lineScoped = rules.filter((r) => r.scopeTarget === 'line');
  const sorted = [...lineScoped].sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id.localeCompare(b.id)));

  for (const rule of sorted) {
    const walk = walkScope(rule.scope, subject);
    if (walk.decision === 'REJECT') continue;

    if (rule.dataRequired === true) {
      reserved.push(buildReserved(rule));
      continue;
    }

    const built = buildApplicable(rule);
    if (walk.decision === 'CONDITIONAL') {
      conditional.push({ ...built, undecidable: walk.undecidable });
    } else {
      admitted.push(built);
    }
  }

  return { code, facts, admitted, conditional, reserved };
}

// ===========================================================================
// Mode 1 — explain (§6.1). Retrospective: given a `Result`, restructure its
// trace per line, in order, resolving counterfactuals rather than leaving a
// bare ref for the caller to chase down.
// ===========================================================================

/** Local structural stand-in for `trace.ts`'s `AssembledEvaluation` — see file header. */
export interface ExplainableEvaluation {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly phase: Phase;
  readonly band: number;
  readonly order: number;
  readonly epoch: Epoch;
  readonly citation: string;
  readonly scopeTarget: 'line' | 'claim';
  readonly examined: EvaluationExamined;
  readonly predicate: EffectApplication | null;
  readonly outcome: Outcome;
  readonly effect: readonly EffectApplication[] | null;
  readonly supersededBy: string | null;
  readonly counterfactual: string | null;
  readonly counterfactualRef: string | null;
}

/** Local structural stand-in for `phases/adjudicate.ts`'s `Determination` — see file header. */
export interface ExplainableDetermination {
  readonly lineId: string;
  readonly trace: readonly ExplainableEvaluation[];
}

/** Local structural stand-in for spec §5.1's `Result` (`phases/adjudicate.ts`'s `EngineResult`) — see file header. */
export interface ExplainableResult {
  readonly claimId: string;
  readonly determinations: readonly ExplainableDetermination[];
  /** Claim-scoped rules' evaluations only (§4.2, §5.1). */
  readonly trace: readonly ExplainableEvaluation[];
  readonly facts: Readonly<Record<Epoch, readonly Fact[]>>;
  readonly scopeExclusions: readonly ScopeExclusion[];
  readonly counterfactuals: Readonly<Record<string, string>>;
}

export interface ExplainedEvaluation {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly phase: Phase;
  readonly band: number;
  readonly order: number;
  readonly epoch: Epoch;
  readonly citation: string;
  readonly scopeTarget: 'line' | 'claim';
  readonly outcome: Outcome;
  readonly examined: EvaluationExamined;
  readonly predicate: EffectApplication | null;
  readonly effect: readonly EffectApplication[] | null;
  readonly supersededBy: string | null;
  /**
   * Resolved text, not a ref — via `Result.counterfactuals`. `null` only
   * when this entry never carried one (e.g. `FIRED`). A non-null ref with no
   * matching entry throws rather than returning `""` (§5.3a) — see
   * `resolveCounterfactualLocal` below.
   */
  readonly counterfactual: string | null;
  /** `examined.factRefs`, resolved into the actual `Fact` objects they name (§5.4), not left as bare ids. */
  readonly factsRead: readonly Fact[];
}

export interface ExplainedLine {
  readonly lineId: string;
  readonly rules: readonly ExplainedEvaluation[];
}

export interface ExplainResult {
  readonly claimId: string;
  readonly lines: readonly ExplainedLine[];
  /** Claim-scoped rules' evaluations, resolved the same way (§4.2). */
  readonly claimRules: readonly ExplainedEvaluation[];
  /** §5.3a — recorded once per claim, never per line; kept as its own section rather than folded into `lines`. */
  readonly scopeExclusions: readonly ScopeExclusion[];
}

/**
 * Local reimplementation of `trace.ts#resolveCounterfactual` — see file
 * header on why this file cannot import `trace.ts` directly. `null` in,
 * `null` out; a non-null ref with no matching entry is a hard error, never
 * an empty string (§5.3a).
 */
function resolveCounterfactualLocal(counterfactuals: Readonly<Record<string, string>>, ref: string | null): string | null {
  if (ref === null) return null;
  const text = counterfactuals[ref];
  if (text === undefined) {
    throw new Error(`inspect.explain: counterfactualRef "${ref}" has no matching entry in Result.counterfactuals — a dangling ref is a hard error (§5.3a).`);
  }
  return text;
}

function buildFactsIndex(facts: Readonly<Record<Epoch, readonly Fact[]>>): ReadonlyMap<Epoch, ReadonlyMap<string, Fact>> {
  const out = new Map<Epoch, ReadonlyMap<string, Fact>>();
  for (const epoch of EPOCH_ORDER) {
    out.set(epoch, new Map(facts[epoch].map((f) => [f.factId, f] as const)));
  }
  return out;
}

function byOrderThenId(a: ExplainableEvaluation, b: ExplainableEvaluation): number {
  return a.order !== b.order ? a.order - b.order : a.ruleId.localeCompare(b.ruleId);
}

/** §6.1. `result` is any value structurally matching `ExplainableResult` — in practice, `adjudicate()`'s real output. */
export function explain(result: ExplainableResult): ExplainResult {
  const factsIndex = buildFactsIndex(result.facts);

  const explainOne = (ev: ExplainableEvaluation): ExplainedEvaluation => {
    const counterfactual = ev.counterfactual !== null ? ev.counterfactual : resolveCounterfactualLocal(result.counterfactuals, ev.counterfactualRef);
    const byId = factsIndex.get(ev.epoch);
    const factsRead: Fact[] = ev.examined.factRefs.map((ref) => {
      const f = byId?.get(ref);
      if (f === undefined) {
        throw new Error(`inspect.explain: rule ${ev.ruleId} references fact "${ref}" at epoch ${ev.epoch}, not present in Result.facts (§5.4).`);
      }
      return f;
    });
    return {
      ruleId: ev.ruleId,
      ruleVersion: ev.ruleVersion,
      phase: ev.phase,
      band: ev.band,
      order: ev.order,
      epoch: ev.epoch,
      citation: ev.citation,
      scopeTarget: ev.scopeTarget,
      outcome: ev.outcome,
      examined: ev.examined,
      predicate: ev.predicate,
      effect: ev.effect,
      supersededBy: ev.supersededBy,
      counterfactual,
      factsRead,
    };
  };

  const lines: ExplainedLine[] = result.determinations.map((d) => ({
    lineId: d.lineId,
    rules: [...d.trace].sort(byOrderThenId).map(explainOne),
  }));

  return {
    claimId: result.claimId,
    lines,
    claimRules: [...result.trace].sort(byOrderThenId).map(explainOne),
    scopeExclusions: result.scopeExclusions,
  };
}
