/**
 * U9 — the rule interpreter (spec §2.5, §4.2, §4.3, §5.1-§5.4).
 *
 * Runs a registry of declarative rules against a claim's admitted lines in
 * two passes per epoch window — a fact pass (recompute the named, epoch-
 * scoped aggregate facts from the current line state), then a rule pass
 * (walk the rules assigned to that window in `order`, applying effects as
 * they fire). See the section banners below for the pieces; the header
 * comments on each are the design notes, not just labels.
 *
 * SCOPE. This file builds the interpreter only — not phases, not registry
 * content (§13+), not money. `dsl/operators.ts` (U8) ships exactly 40
 * operators, none of them money-bearing (`setAmount`, `multiply`,
 * `setCoinsurance`, `carveOut`, `exclusion`, `lesserOfCandidates`,
 * `claimMoneyAtLeast`, `claimDayCountAtLeast`, and `chargeAtLeast` are all
 * absent — see that file's header). Consequently this interpreter never
 * produces a dollar amount, `Determination.amounts` does not exist here,
 * and the conflict-resolution table's `setAmount`/`setCoinsurance`/
 * `multiply` rows have nothing to implement against. What is built here is
 * everything §2.5's epoch model and §4.3's conflict-resolution table need
 * for the eight effects that DO exist: `setStatus`, `bundleUnder`,
 * `convertSI`, `route`, `setBasis`, `exempt`, `flag`, `stop`.
 *
 * THE SINGLE MOST IMPORTANT CORRECTNESS DETAIL. Within one epoch window
 * (one band, or band 4000's sub-band a/b), every rule's `OperatorContext`
 * is built from the epoch snapshot that was frozen at the *start* of that
 * window — never from the in-progress working state effects are being
 * written to as rules fire earlier in the same window. This is not
 * discipline; `computeEpochSnapshot` below calls `deepFreeze` (U11) on
 * every `ClaimFacts` it hands out, so a caller cannot mutate through it
 * even by accident. This is exactly why band 4000 needs two epochs
 * (`E3a`/`E3b`) instead of one: if within-window reads saw live effects,
 * the split would buy nothing, because the Q-group tiebreak could just
 * read band 4000a's in-progress state directly. It can't — it reads
 * `E3a`, a wholly separate frozen object computed only after every band
 * 4000a rule has finished.
 *
 * See the bottom of this file (and the final report handed back with this
 * unit) for the full list of judgment calls made where the read sections
 * of the spec (§2.2, §2.4, §2.5, §4.2-§4.4, §5.1-§5.4, §12.3) were silent
 * or in tension with `dsl/operators.ts`'s already-built runtime contract.
 */

import type {
  Basis,
  EffectApplication,
  Epoch,
  Evaluation,
  EvaluationExamined,
  EngineError,
  EngineErrorCode,
  Fact,
  Flag,
  FlagSeverity,
  Outcome,
  Phase,
  ScopeExclusion,
  Status,
} from '../types.js';
import { EPOCH_ORDER } from '../types.js';
import { deepFreeze, type DeepFrozen } from './freeze.js';
import {
  operators,
  rankAmong,
  type ClaimFacts,
  type EvalNode,
  type JsonValue,
  type LineFacts,
  type OperatorContext,
  type OptionsFacts,
  type PredicateNode,
  type RankField,
  type RankSpec,
  type Tiebreak,
} from './operators.js';

// ===========================================================================
// Public input/output shapes
// ===========================================================================

/**
 * A line as admitted into this interpreter — i.e. after phase 1's REJECTED/
 * ROUTED split (out of scope here; §2.2). `status`/`bundledUnder`/`basis`/
 * `isExempt`/etc. are not inputs — they only exist as effect targets, so
 * they are absent from this type rather than pre-populated with defaults a
 * caller would have to know to set correctly.
 */
export interface AdmittedLine {
  readonly lineId: string;
  readonly code: string;
  /** As found in the data — spec §5.1's `resolvedSI`. Never mutated; `convertSI` writes a separate effective value. */
  readonly resolvedSI: string;
  readonly apc: string | null;
  readonly schedule: string | null;
  readonly modifiers: readonly string[];
  readonly unitCount: number;
  readonly rateMils: number | null;
  readonly weight: number | null;
  readonly chargeMils: number;
  /** YYYYMMDD. */
  readonly dos: string;
}

/**
 * A rule, already normalized to the `{op, args}` shape `dsl/operators.ts`
 * consumes — see the final report's note on operator argument shapes for
 * why this interpreter does not itself parse the hand-authored single-key
 * JSON registry form.
 */
export interface Rule {
  readonly id: string;
  readonly version: string;
  readonly phase: Phase;
  readonly band: number;
  /** Required, and must be `'a'` or `'b'`, for every band-4000 rule (§2.5) — the one band with two sub-epochs. Absent for every other band. */
  readonly subBand?: 'a' | 'b';
  readonly order: number;
  readonly epoch: Epoch;
  readonly scopeTarget: 'line' | 'claim';
  readonly citation: string;
  readonly scope: PredicateNode;
  readonly when?: PredicateNode;
  readonly then: readonly PredicateNode[];
  readonly note?: string;
  /** Required `true` when `when.op === 'unimplemented'` (§4.3's reserved condition); rejected otherwise. */
  readonly dataRequired?: boolean;
  readonly exclusive?: boolean;
  /** Declared per rule, not per band — see the final report. `true` only for rules in a band the registry has declared exempt from `stop` (spec's own example is band 6000). */
  readonly alwaysEvaluate?: boolean;
}

/** Spec §5.1's `Determination`, restricted to what this interpreter actually produces — no `disposition`, no `amounts` (see file header). */
export interface Determination {
  readonly lineId: string;
  readonly resolvedSI: string;
  readonly effectiveSI: string;
  readonly status: Status | null;
  readonly bundledUnder: string | null;
  readonly basis: Basis;
  readonly routed: boolean;
  readonly isExempt: boolean;
  readonly flags: readonly Flag[];
  readonly trace: readonly Evaluation[];
}

export interface EvaluateInput {
  readonly lines: readonly AdmittedLine[];
  readonly options: OptionsFacts;
  readonly rules: readonly Rule[];
}

export interface EvaluateResult {
  readonly determinations: readonly Determination[];
  readonly facts: Readonly<Record<Epoch, readonly Fact[]>>;
  readonly scopeExclusions: readonly ScopeExclusion[];
  /** Flags raised by claim-scoped `flag` effects — also replicated onto every `Determination.flags` (§4.2). */
  readonly disclosures: readonly Flag[];
  /** Claim-scoped rules' `Evaluation`s only — each fires exactly once and is never nested in a per-line trace (§4.2, §5.1). */
  readonly trace: readonly Evaluation[];
}

// ===========================================================================
// Load-time faults. Structural rule-shape defects (a too-late epoch, a
// missing band-4000 subBand, a claim-scoped rule writing a line effect, an
// `unimplemented` rule not carrying `dataRequired`) are properties of the
// *rules*, checkable before any line is touched, and not improved by a
// partial answer — so they throw here, the same `EngineError` shape and
// convention `dsl/validate.ts` already established, rather than being
// discovered mid-run as a line-local fault (§12.8's distinction).
// ===========================================================================

function loadError(code: EngineErrorCode, path: string, detail: string): EngineError {
  return { name: 'EngineError', code, path, detail, claimId: null };
}

// ===========================================================================
// Epoch windows. Six fixed windows, in this order, matching §2.5's table
// exactly. `ceilingEpoch` is the latest epoch a rule assigned to that
// window may declare (strictly earlier than the epoch the window itself
// produces — "at or after its own position" is the lint-rejected case).
// `producesEpoch` is `undefined` for the trailing window (band > 5000, e.g.
// the spec's own band-6000 example): nothing is defined after `E4`, so
// that window reads `E4` and does not trigger a recompute.
//
// Bands 2000 and 3000 share one window (one epoch barrier at `E1` in, `E2`
// out) per §2.5's table row "bands 2000-3000". They remain distinct bands
// for conflict-resolution purposes (`setStatus`'s cross-band check reads
// `rule.band`, not the window) — only the epoch barrier is shared.
// ===========================================================================

interface EpochWindow {
  readonly rank: number;
  readonly ceilingEpoch: Epoch;
  readonly producesEpoch: Epoch | undefined;
}

const WINDOW_BAND_1000: EpochWindow = { rank: 1, ceilingEpoch: 'E0', producesEpoch: 'E1' };
const WINDOW_BANDS_2000_3000: EpochWindow = { rank: 2, ceilingEpoch: 'E1', producesEpoch: 'E2' };
const WINDOW_BAND_4000A: EpochWindow = { rank: 3, ceilingEpoch: 'E2', producesEpoch: 'E3a' };
const WINDOW_BAND_4000B: EpochWindow = { rank: 4, ceilingEpoch: 'E3a', producesEpoch: 'E3b' };
const WINDOW_BAND_5000: EpochWindow = { rank: 5, ceilingEpoch: 'E3b', producesEpoch: 'E4' };
const WINDOW_REST: EpochWindow = { rank: 6, ceilingEpoch: 'E4', producesEpoch: undefined };

const EPOCH_WINDOWS_IN_ORDER: readonly EpochWindow[] = [
  WINDOW_BAND_1000,
  WINDOW_BANDS_2000_3000,
  WINDOW_BAND_4000A,
  WINDOW_BAND_4000B,
  WINDOW_BAND_5000,
  WINDOW_REST,
];

function windowForRule(rule: Rule): EpochWindow {
  if (rule.band === 1000) return WINDOW_BAND_1000;
  if (rule.band === 2000 || rule.band === 3000) return WINDOW_BANDS_2000_3000;
  if (rule.band === 4000) {
    if (rule.subBand === 'a') return WINDOW_BAND_4000A;
    if (rule.subBand === 'b') return WINDOW_BAND_4000B;
    throw loadError(
      'REGISTRY_INVARIANT_VIOLATION',
      `rule[${rule.id}].subBand`,
      'band 4000 is the one band with two fact epochs (§2.5); every band-4000 rule must declare subBand "a" or "b".',
    );
  }
  if (rule.band === 5000) return WINDOW_BAND_5000;
  return WINDOW_REST;
}

function epochAtOrEarlier(a: Epoch, b: Epoch): boolean {
  return EPOCH_ORDER.indexOf(a) <= EPOCH_ORDER.indexOf(b);
}

// ===========================================================================
// Pre-flight rule validation — runs once, before any line is evaluated.
// ===========================================================================

function validateRules(rules: readonly Rule[]): void {
  const seenIds = new Set<string>();
  for (const rule of rules) {
    if (seenIds.has(rule.id)) {
      throw loadError('REGISTRY_INVARIANT_VIOLATION', `rule[${rule.id}]`, `duplicate rule id "${rule.id}" — ids are stable public API (§4.2).`);
    }
    seenIds.add(rule.id);

    const window = windowForRule(rule);
    if (!epochAtOrEarlier(rule.epoch, window.ceilingEpoch)) {
      throw loadError(
        'REGISTRY_INVARIANT_VIOLATION',
        `rule[${rule.id}].epoch`,
        `declares epoch "${rule.epoch}", but band ${String(rule.band)}${rule.subBand !== undefined ? ` sub-band ${rule.subBand}` : ''} may read at most "${window.ceilingEpoch}" (§2.5: a rule may not read an epoch at or after its own position).`,
      );
    }

    if (rule.scopeTarget === 'claim') {
      for (const effect of rule.then) {
        if (effect.op !== 'flag') {
          throw loadError(
            'REGISTRY_INVARIANT_VIOLATION',
            `rule[${rule.id}].then`,
            `claim-scoped rule writes line effect "${effect.op}" — a claim-scoped rule may write only a claim-replicated flag (§4.2).`,
          );
        }
      }
    }

    const whenNode = rule.when;
    if (whenNode !== undefined && whenNode.op === 'unimplemented' && rule.dataRequired !== true) {
      throw loadError(
        'REGISTRY_INVARIANT_VIOLATION',
        `rule[${rule.id}].when`,
        '"unimplemented" is legal only on a rule carrying dataRequired: true (§4.3).',
      );
    }
  }
}

// ===========================================================================
// The real `EvalNode` — thin wrapper over `operators.ts`'s registry. All
// trace/fact bookkeeping (factRefs, effect summaries) is computed *outside*
// this function by walking the same `PredicateNode` tree separately (see
// `collectFactRefs` below) rather than threading it through `EvalResult`,
// because `EvalResult`'s shape (`{fired, examined}`) is owned by
// `dsl/operators.ts` and is not this file's to extend.
// ===========================================================================

function makeEvalNode(): EvalNode {
  const evalNode: EvalNode = (node, ctx) => {
    const op = operators[node.op];
    if (op === undefined) throw new Error(`unknown operator "${node.op}"`);
    if (op.role !== 'condition') throw new Error(`"${node.op}" is an effect, not a condition`);
    return op.evaluate(node.args, ctx, evalNode);
  };
  return evalNode;
}

function describeNode(node: PredicateNode): string {
  const op = operators[node.op];
  if (op === undefined) throw new Error(`unknown operator "${node.op}"`);
  if (op.role !== 'condition') throw new Error(`"${node.op}" is an effect, not a condition`);
  return op.describe(node.args);
}

const ALWAYS_NODE: PredicateNode = { op: 'always', args: {} };

// ===========================================================================
// Rank helpers — `readRankField`/`resolveRankValue`/`rankAmong` are imported
// from `dsl/operators.ts` (spec §4.2), not reimplemented here. This
// interpreter needs the ranking itself for two things operators.ts has no
// operator for: resolving `bundleUnder`'s target line, and recording a
// `rank` Fact for `examined.factRefs` (§2.4, §2.5). Ranking is where the
// `weight`-vs-`rateMils` distinction and the `fallbackField` rule live —
// two independent copies is exactly where a divergence would silently
// change which line controls a bundle, so there is now exactly one
// implementation. `rankAmongLines` below is a thin adapter from this
// file's individual (field, among, tiebreak, fallbackField) parameters to
// operators.ts's `RankSpec` shape — not a second ranking algorithm.
// ===========================================================================

function rankAmongLines(
  claim: ClaimFacts,
  among: PredicateNode,
  field: RankField,
  tiebreak: Tiebreak,
  fallbackField: RankField | undefined,
  options: OptionsFacts,
  evalNode: EvalNode,
  op: string,
): readonly LineFacts[] {
  const spec: RankSpec = { field, among, tiebreak, fallbackField };
  return rankAmong(spec, { subject: null, claim, options }, evalNode, op).ranked;
}

// ===========================================================================
// Canonical, key-order-independent stringification — used only to build a
// stable memo key for the on-demand `rank` fact below. Not a general
// serializer (that is `trace.ts`'s canonical serializer, U10); this exists
// purely so that two structurally identical `among` nodes memoize to the
// same rank computation regardless of incidental key order in how a rule's
// JSON happened to be authored (§2.4 — determinism must not depend on
// object key order).
// ===========================================================================

/**
 * Takes `unknown`, not `JsonValue` — its one caller (`getOrComputeRank`'s
 * memo key) stringifies a `PredicateNode`, and `PredicateNode.args` is
 * `unknown` by `dsl/operators.ts`'s own design (narrowed per-operator at
 * runtime, never assumed). Rather than assert `args` into `JsonValue`
 * without proof, this walks `unknown` directly: anything that is neither
 * an array nor a plain record is handed to `JSON.stringify` as-is (a
 * function or `undefined` inside a memo key would just be unusual
 * authoring, not a crash — `JSON.stringify` degrades those to `undefined`
 * safely and the memo still terminates).
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isRecordArgs(v)) {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// ===========================================================================
// Facts. Recomputed fresh at every epoch (never carried forward as the same
// object — §2.5's "recomputed at explicit barriers", read literally) from
// six generic, registry-independent kinds. See the final report for why
// these six and not a richer, registry-aware set (e.g. a dedicated
// "companion-triggered" fact distinct from the general bundled set): this
// interpreter has no visibility into *why* an effect fired, only that it
// did, and building that distinction would mean encoding packaging policy
// here rather than in the registry (README rule 2).
//
//   siCensus:<SI>      - one fact per SI value with >=1 line, that line's ids
//   codeCensus:<code>  - one fact per code with >=1 line
//   unitTotal:<code>   - one fact per code, `values: [sum]`, same lineIds as codeCensus
//   allLines           - one fact, every line currently on the claim
//   exemptSet          - one fact, currently-exempt lines
//   bundledSet         - one fact, currently-bundled lines
//   liveSet            - one fact, lines neither bundled nor halted (stop or fault)
//
// `rank:<field>#<n>` facts are the exception: computed on demand (memoized
// per epoch) the first time a relational condition or `bundleUnder` reads a
// given (field, among) pair at that epoch, not eagerly for every epoch.
// ===========================================================================

function siCensusFactId(epoch: Epoch, si: string): string {
  return `${epoch}:siCensus:${si}`;
}
function codeCensusFactId(epoch: Epoch, code: string): string {
  return `${epoch}:codeCensus:${code}`;
}
function unitTotalFactId(epoch: Epoch, code: string): string {
  return `${epoch}:unitTotal:${code}`;
}
function allLinesFactId(epoch: Epoch): string {
  return `${epoch}:allLines`;
}
function exemptSetFactId(epoch: Epoch): string {
  return `${epoch}:exemptSet`;
}
function bundledSetFactId(epoch: Epoch): string {
  return `${epoch}:bundledSet`;
}
function liveSetFactId(epoch: Epoch): string {
  return `${epoch}:liveSet`;
}

function computeEpochFacts(epoch: Epoch, claim: ClaimFacts): readonly Fact[] {
  const facts: Fact[] = [];

  const bySi = new Map<string, string[]>();
  const byCode = new Map<string, string[]>();
  const unitsByCode = new Map<string, number>();
  const exemptIds: string[] = [];
  const bundledIds: string[] = [];
  const liveIds: string[] = [];
  const allIds: string[] = [];

  for (const line of claim.lines) {
    allIds.push(line.lineId);
    if (line.si !== null) {
      const list = bySi.get(line.si);
      if (list === undefined) bySi.set(line.si, [line.lineId]);
      else list.push(line.lineId);
    }
    const codeList = byCode.get(line.code);
    if (codeList === undefined) byCode.set(line.code, [line.lineId]);
    else codeList.push(line.lineId);
    unitsByCode.set(line.code, (unitsByCode.get(line.code) ?? 0) + line.unitCount);
    if (line.isExempt) exemptIds.push(line.lineId);
    const bundled = line.status === 'BUNDLED';
    if (bundled) bundledIds.push(line.lineId);
    const halted = bundled || line.status === 'NOT_ADJUDICATED';
    if (!halted) liveIds.push(line.lineId);
  }

  for (const [si, lineIds] of bySi) {
    facts.push({ factId: siCensusFactId(epoch, si), kind: 'siCensus', dimension: 'si', values: [si], lineIds });
  }
  for (const [code, lineIds] of byCode) {
    facts.push({ factId: codeCensusFactId(epoch, code), kind: 'codeCensus', dimension: 'code', values: [code], lineIds });
    const units = unitsByCode.get(code) ?? 0;
    facts.push({ factId: unitTotalFactId(epoch, code), kind: 'unitTotal', dimension: 'units', values: [units], lineIds });
  }
  facts.push({ factId: allLinesFactId(epoch), kind: 'allLines', dimension: 'status', values: [], lineIds: allIds });
  facts.push({ factId: exemptSetFactId(epoch), kind: 'exemptSet', dimension: 'status', values: ['EXEMPT'], lineIds: exemptIds });
  facts.push({ factId: bundledSetFactId(epoch), kind: 'bundledSet', dimension: 'status', values: ['BUNDLED'], lineIds: bundledIds });
  facts.push({ factId: liveSetFactId(epoch), kind: 'liveSet', dimension: 'status', values: [], lineIds: liveIds });

  return facts;
}

// ===========================================================================
// factRefs — a pure walk of a condition's `PredicateNode` tree, independent
// of firing, resolving each claim-relational leaf to the Fact(s) that back
// it. Line-local leaves (siIn, codeIn, hasModifier, ...) contribute no
// factRefs: they read only the subject line's own fields, not a claim
// aggregate, so there is no epoch Fact to name (§2.5's "references a fact;
// never copies one" applies to what claim-relational reads use — a
// line-local read is not reading a fact at all).
// ===========================================================================

interface FactRefContext {
  readonly epoch: Epoch;
  readonly claim: ClaimFacts;
  readonly options: OptionsFacts;
  readonly evalNode: EvalNode;
  readonly rankMemo: RankMemo;
  readonly epochFacts: ReadonlyMap<string, Fact>;
}

function collectFactRefs(node: PredicateNode, ctx: FactRefContext): string[] {
  const refs: string[] = [];
  collectFactRefsInto(node, ctx, refs);
  // Dedup while preserving first-seen order — deterministic given
  // deterministic tree-walk order.
  return [...new Set(refs)];
}

function factsPresentFor(epoch: Epoch, factIdCandidates: readonly string[], allEpochFacts: ReadonlyMap<string, Fact>, out: string[]): void {
  for (const id of factIdCandidates) {
    if (allEpochFacts.has(id)) out.push(id);
  }
}

function collectFactRefsInto(node: PredicateNode, ctx: FactRefContext, out: string[]): void {
  const rec = isRecordArgs(node.args) ? node.args : {};
  switch (node.op) {
    case 'isExempt': {
      out.push(exemptSetFactId(ctx.epoch));
      return;
    }
    case 'claimContainsAny':
    case 'claimContainsNone': {
      const si = readStringArrayField(rec, 'si');
      const code = readStringArrayField(rec, 'code');
      const known = ctx.epochFacts;
      if (si !== undefined) factsPresentFor(ctx.epoch, si.map((s) => siCensusFactId(ctx.epoch, s)), known, out);
      if (code !== undefined) factsPresentFor(ctx.epoch, code.map((c) => codeCensusFactId(ctx.epoch, c)), known, out);
      return;
    }
    case 'claimContainsCode': {
      const code = typeof rec['code'] === 'string' ? rec['code'] : undefined;
      if (code !== undefined) factsPresentFor(ctx.epoch, [codeCensusFactId(ctx.epoch, code)], ctx.epochFacts, out);
      return;
    }
    case 'claimUnitsAtLeast': {
      const code = typeof rec['code'] === 'string' ? rec['code'] : undefined;
      const si = readStringArrayField(rec, 'si');
      if (code !== undefined) factsPresentFor(ctx.epoch, [unitTotalFactId(ctx.epoch, code), codeCensusFactId(ctx.epoch, code)], ctx.epochFacts, out);
      if (si !== undefined) factsPresentFor(ctx.epoch, si.map((s) => siCensusFactId(ctx.epoch, s)), ctx.epochFacts, out);
      return;
    }
    case 'claimLineCountAtLeast': {
      const code = typeof rec['code'] === 'string' ? rec['code'] : undefined;
      const si = readStringArrayField(rec, 'si');
      if (code !== undefined) factsPresentFor(ctx.epoch, [codeCensusFactId(ctx.epoch, code)], ctx.epochFacts, out);
      else if (si !== undefined) factsPresentFor(ctx.epoch, si.map((s) => siCensusFactId(ctx.epoch, s)), ctx.epochFacts, out);
      else out.push(allLinesFactId(ctx.epoch));
      return;
    }
    case 'isHighestBy':
    case 'isNotHighestBy':
    case 'ordinalIs':
    case 'ordinalAtLeast': {
      const factId = rankFactIdFor(node, ctx);
      if (factId !== undefined) out.push(factId);
      return;
    }
    case 'allOf':
    case 'anyOf': {
      const children = Array.isArray(rec['children']) ? rec['children'] : [];
      for (const child of children) {
        if (isPredicateNode(child)) collectFactRefsInto(child, ctx, out);
      }
      return;
    }
    case 'not': {
      const child = rec['child'];
      if (isPredicateNode(child)) collectFactRefsInto(child, ctx, out);
      return;
    }
    default:
      return;
  }
}

function isRecordArgs(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPredicateNode(v: unknown): v is PredicateNode {
  return isRecordArgs(v) && typeof v['op'] === 'string' && 'args' in v;
}

/**
 * Recursively, provably converts `unknown` into `JsonValue` — used at the
 * three places this file copies a `PredicateNode.args` (typed `unknown` by
 * `dsl/operators.ts`) into an `EffectApplication.args` (typed `JsonValue`
 * by `types.ts`, since that is what ships in the trace). Registry-authored
 * `args` is always JSON to begin with, so this always succeeds in
 * practice; it still throws on anything that genuinely is not JSON-safe
 * (a function, a `Map`/`Set`, ...) rather than silently asserting the
 * shape, which is what an `as JsonValue` would have done instead.
 * `undefined` maps to `null` — an operator with no arguments (e.g.
 * `always`, `stop`) is still authored as `{}`, never literally `undefined`,
 * but `PredicateNode.args: unknown` does not rule it out structurally.
 */
function toJsonValue(v: unknown): JsonValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(toJsonValue);
  if (isRecordArgs(v)) {
    const out: Record<string, JsonValue> = {};
    for (const [k, val] of Object.entries(v)) out[k] = toJsonValue(val);
    return out;
  }
  throw new Error(`value of type "${typeof v}" is not JSON-safe and cannot be recorded in a trace.`);
}

function readStringArrayField(rec: Record<string, unknown>, key: string): string[] | undefined {
  const v = rec[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((item) => typeof item !== 'string')) return undefined;
  return v as string[];
}

// ===========================================================================
// On-demand rank facts. Memoized per (epoch, field, canonical `among` JSON)
// in first-encountered order — deterministic because rules are always
// processed in ascending `order` (§2.4). `#<n>` is the memo's insertion
// index within that epoch, not derived from rule identity, so two
// different rules asking the identical (field, among) question at the same
// epoch share one fact rather than duplicating it.
// ===========================================================================

interface RankMemo {
  perEpoch: Map<Epoch, Map<string, { readonly factId: string; readonly ranked: readonly LineFacts[] }>>;
  countPerEpoch: Map<Epoch, number>;
}

function makeRankMemo(): RankMemo {
  return { perEpoch: new Map(), countPerEpoch: new Map() };
}

function getOrComputeRank(
  epoch: Epoch,
  field: RankField,
  among: PredicateNode,
  tiebreak: Tiebreak,
  fallbackField: RankField | undefined,
  claim: ClaimFacts,
  options: OptionsFacts,
  evalNode: EvalNode,
  memo: RankMemo,
  op: string,
): { readonly factId: string; readonly ranked: readonly LineFacts[] } {
  const key = `${field}|${stableStringify(among)}`;
  let epochMap = memo.perEpoch.get(epoch);
  if (epochMap === undefined) {
    epochMap = new Map();
    memo.perEpoch.set(epoch, epochMap);
  }
  const existing = epochMap.get(key);
  if (existing !== undefined) return existing;
  const ranked = rankAmongLines(claim, among, field, tiebreak, fallbackField, options, evalNode, op);
  const n = memo.countPerEpoch.get(epoch) ?? 0;
  memo.countPerEpoch.set(epoch, n + 1);
  const entry = { factId: `${epoch}:rank:${field}#${n}`, ranked };
  epochMap.set(key, entry);
  return entry;
}

function rankFactIdFor(node: PredicateNode, ctx: FactRefContext): string | undefined {
  const rec = isRecordArgs(node.args) ? node.args : {};
  const field = rec['field'];
  const among = rec['among'];
  const tiebreak = rec['tiebreak'];
  if (typeof field !== 'string' || !isPredicateNode(among) || (tiebreak !== 'codeAsc' && tiebreak !== 'codeDesc')) return undefined;
  if (field !== 'rateMils' && field !== 'weight' && field !== 'chargeMils' && field !== 'unitCount') return undefined;
  const fallbackRaw = rec['fallbackField'];
  const fallbackField =
    fallbackRaw === 'rateMils' || fallbackRaw === 'weight' || fallbackRaw === 'chargeMils' || fallbackRaw === 'unitCount' ? fallbackRaw : undefined;
  try {
    return getOrComputeRank(ctx.epoch, field, among, tiebreak, fallbackField, ctx.claim, ctx.options, ctx.evalNode, ctx.rankMemo, node.op).factId;
  } catch {
    // A null field with no fallback throws inside resolveRankValue — that
    // is a firing-time hard error, surfaced when the condition is actually
    // evaluated (below), not here where we are only computing a reference
    // for the trace. Recording no factRef in that case is correct: there
    // is no fact to name because the rank computation itself is undefined.
    return undefined;
  }
}

// ===========================================================================
// Closed-vocabulary runtime guards for effect payloads that carry a
// `Status`/`Basis` value. Mirrors `src/types.ts`'s unions exactly; kept
// local (not exported from types.ts as a runtime array) the same way
// `dsl/validate.ts` keeps its own `PHASES`/`EPOCHS` arrays local.
// ===========================================================================

const STATUS_VALUES: readonly Status[] = [
  'PAID',
  'PAID_EXEMPT',
  'PAID_UNPRICED',
  'PACKAGED',
  'BUNDLED',
  'ROUTED',
  'NOT_PAID_RECODE',
  'NOT_PAID_INPT_ONLY',
  'NOT_PAID',
  'MALFORMED',
  'INVALID',
  'INVALID_HISTORICAL',
  'NO_PROCEDURE_CODE',
  'DELETED',
  'NOT_ADJUDICATED',
];
function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUS_VALUES as readonly string[]).includes(v);
}

const BASIS_VALUES: readonly Basis[] = [
  'OPPS_APC',
  'OPPS_DRUG_ASP',
  'OPPS_BLOOD',
  'OPPS_COMPREHENSIVE',
  'CLFS',
  'COST',
  'PHP_PER_DIEM',
  'ROUTED_MPFS',
  'ROUTED_DMEPOS',
  'ROUTED_AFS',
  'ROUTED_UNKNOWN',
  'CONTRACT',
  'NONE',
];
function isBasis(v: unknown): v is Basis {
  return typeof v === 'string' && (BASIS_VALUES as readonly string[]).includes(v);
}

const FLAG_SEVERITIES: readonly FlagSeverity[] = ['info', 'warning', 'assumption', 'gap'];
function isFlagSeverity(v: unknown): v is FlagSeverity {
  return typeof v === 'string' && (FLAG_SEVERITIES as readonly string[]).includes(v);
}

// ===========================================================================
// Per-line working state — the mutable substrate effects write to. Frozen,
// read-only `LineFacts` snapshots are derived from this at each epoch
// barrier (`toLineFacts`); operators never see this type directly.
// ===========================================================================

interface LineWorkingState {
  readonly admitted: AdmittedLine;
  si: string; // effective SI; starts as resolvedSI, mutated by convertSI
  status: Status | null;
  isExempt: boolean;
  bundledUnder: string | null;
  basis: Basis;
  routed: boolean;
  flags: Flag[];
  haltReason: 'stop' | 'fault' | null;
  haltedByRuleId: string | null;
  evaluations: Evaluation[];
}

function toLineFacts(ws: LineWorkingState): LineFacts {
  return {
    lineId: ws.admitted.lineId,
    code: ws.admitted.code,
    si: ws.si,
    apc: ws.admitted.apc,
    schedule: ws.admitted.schedule,
    status: ws.status,
    modifiers: ws.admitted.modifiers,
    unitCount: ws.admitted.unitCount,
    rateMils: ws.admitted.rateMils,
    weight: ws.admitted.weight,
    chargeMils: ws.admitted.chargeMils,
    isExempt: ws.isExempt,
    dos: ws.admitted.dos,
  };
}

function computeEpochSnapshot(states: readonly LineWorkingState[]): DeepFrozen<ClaimFacts> {
  const claim: ClaimFacts = { lines: states.map(toLineFacts) };
  return deepFreeze(claim);
}

// ===========================================================================
// Conflict-resolution bookkeeping (spec §4.3's table + `exclusive`).
// ===========================================================================

type StructuralEffect = 'bundleUnder' | 'convertSI' | 'route' | 'setBasis';
const STRUCTURAL_EFFECTS: readonly StructuralEffect[] = ['bundleUnder', 'convertSI', 'route', 'setBasis'];
function isStructuralEffect(op: string): op is StructuralEffect {
  return (STRUCTURAL_EFFECTS as readonly string[]).includes(op);
}

interface StatusWriteRecord {
  readonly band: number;
  readonly ruleId: string;
  readonly exclusive: boolean;
}

interface StructuralWriteRecord {
  readonly ruleId: string;
}

interface ConflictTracker {
  readonly statusWriters: Map<string, StatusWriteRecord>;
  readonly structuralWriters: Map<string, Map<StructuralEffect, StructuralWriteRecord>>;
}

function makeConflictTracker(): ConflictTracker {
  return { statusWriters: new Map(), structuralWriters: new Map() };
}

/** Finds the earlier `Evaluation` that fired `setStatus` for `ruleId` on this line, and marks it superseded. Internal bookkeeping only — the interpreter mutates its own not-yet-finalized trace entries, never a value handed to a caller. */
function markSupersededBy(ws: LineWorkingState, supersededRuleId: string, byRuleId: string): void {
  for (let i = ws.evaluations.length - 1; i >= 0; i--) {
    const ev = ws.evaluations[i];
    if (ev !== undefined && ev.ruleId === supersededRuleId && ev.outcome === 'FIRED') {
      ws.evaluations[i] = { ...ev, supersededBy: byRuleId };
      return;
    }
  }
}

// ===========================================================================
// Effect application. Throws a plain `Error` on any conflict violation or
// malformed value — caught by the per-line rule loop and turned into a
// line-local `ERRORED` fault (§12.8). Effects already applied earlier in
// the SAME rule's `then[]` before a later one throws are not rolled back
// (see final report) — this file does not implement transactional effect
// application, only per-rule fault containment.
// ===========================================================================

interface EffectApplicationContext {
  readonly rule: Rule;
  readonly claim: ClaimFacts;
  readonly options: OptionsFacts;
  readonly evalNode: EvalNode;
  readonly workingByLineId: ReadonlyMap<string, LineWorkingState>;
  readonly tracker: ConflictTracker;
}

function applyLineEffect(ws: LineWorkingState, node: PredicateNode, ctx: EffectApplicationContext): void {
  const rec = isRecordArgs(node.args) ? node.args : {};
  switch (node.op) {
    case 'setStatus': {
      const statusRaw = rec['status'];
      if (!isStatus(statusRaw)) throw new Error(`setStatus: "${JSON.stringify(statusRaw)}" is not a recognized Status value.`);
      const existing = ctx.tracker.statusWriters.get(ws.admitted.lineId);
      if (existing !== undefined) {
        if (existing.band !== ctx.rule.band) {
          throw new Error(
            `setStatus: cross-band overwrite — rule ${ctx.rule.id} (band ${String(ctx.rule.band)}) would overwrite rule ${existing.ruleId} (band ${String(existing.band)}); a cross-band setStatus overwrite is an error (§4.3).`,
          );
        }
        if (existing.exclusive) {
          throw new Error(`setStatus: rule ${existing.ruleId} declared exclusive:true — a later same-band write by ${ctx.rule.id} is an error (§4.3).`);
        }
        markSupersededBy(ws, existing.ruleId, ctx.rule.id);
      }
      ws.status = statusRaw;
      ctx.tracker.statusWriters.set(ws.admitted.lineId, { band: ctx.rule.band, ruleId: ctx.rule.id, exclusive: ctx.rule.exclusive === true });
      return;
    }
    case 'bundleUnder': {
      checkStructuralUnwritten(ws, 'bundleUnder', ctx);
      const highestByRaw = rec['highestBy'];
      const amongRaw = rec['among'];
      const tiebreakRaw = rec['tiebreak'];
      if (
        (highestByRaw !== 'rateMils' && highestByRaw !== 'weight' && highestByRaw !== 'chargeMils' && highestByRaw !== 'unitCount') ||
        !isPredicateNode(amongRaw) ||
        (tiebreakRaw !== 'codeAsc' && tiebreakRaw !== 'codeDesc')
      ) {
        throw new Error('bundleUnder: malformed args — expected {highestBy, among, tiebreak, fallbackField?}.');
      }
      const fallbackRaw = rec['fallbackField'];
      const fallbackField =
        fallbackRaw === 'rateMils' || fallbackRaw === 'weight' || fallbackRaw === 'chargeMils' || fallbackRaw === 'unitCount' ? fallbackRaw : undefined;
      const ranked = rankAmongLines(ctx.claim, amongRaw, highestByRaw, tiebreakRaw, fallbackField, ctx.options, ctx.evalNode, 'bundleUnder');
      const winner = ranked[0];
      if (winner === undefined) {
        throw new Error(`bundleUnder: no member of "among" was found among the claim's current lines at rule ${ctx.rule.id}'s declared epoch.`);
      }
      if (winner.lineId === ws.admitted.lineId) {
        throw new Error(`bundleUnder: line ${ws.admitted.lineId} resolved as its own bundling target.`);
      }
      const targetWs = ctx.workingByLineId.get(winner.lineId);
      if (targetWs === undefined) {
        throw new Error(`bundleUnder: target line ${winner.lineId} does not exist on this claim.`);
      }
      if (targetWs.bundledUnder !== null) {
        throw new Error(
          `bundleUnder: target line ${winner.lineId} is itself already bundled (under ${targetWs.bundledUnder}) — cannot bundle under an already-bundled line. This usually means the rule's "among" scope failed to exclude already-bundled lines at the epoch it declared.`,
        );
      }
      ws.bundledUnder = winner.lineId;
      recordStructuralWrite(ws, 'bundleUnder', ctx);
      return;
    }
    case 'convertSI': {
      checkStructuralUnwritten(ws, 'convertSI', ctx);
      const to = rec['to'];
      if (typeof to !== 'string' || to === '') throw new Error('convertSI: expected a non-empty string "to".');
      ws.si = to;
      recordStructuralWrite(ws, 'convertSI', ctx);
      return;
    }
    case 'route': {
      checkStructuralUnwritten(ws, 'route', ctx);
      ws.routed = true;
      recordStructuralWrite(ws, 'route', ctx);
      return;
    }
    case 'setBasis': {
      checkStructuralUnwritten(ws, 'setBasis', ctx);
      const value = rec['value'];
      if (!isBasis(value)) throw new Error(`setBasis: "${JSON.stringify(value)}" is not a recognized Basis value.`);
      ws.basis = value;
      recordStructuralWrite(ws, 'setBasis', ctx);
      return;
    }
    case 'exempt': {
      // Idempotent boolean marker — no conflict tracking (see file header
      // and final report: unlike bundleUnder/convertSI, two rules both
      // marking a line exempt is not ambiguous).
      ws.isExempt = true;
      return;
    }
    case 'flag': {
      ws.flags.push(buildFlag(rec, ctx.rule, [ws.admitted.lineId]));
      return;
    }
    case 'stop': {
      // Recorded by the caller after the full then[] array has been
      // applied — see the rule-firing loop below for why "stop" does not
      // short-circuit its own rule's remaining effects.
      return;
    }
    default:
      throw new Error(`"${node.op}" is not a recognized line effect.`);
  }
}

function checkStructuralUnwritten(ws: LineWorkingState, effect: StructuralEffect, ctx: EffectApplicationContext): void {
  const perLine = ctx.tracker.structuralWriters.get(ws.admitted.lineId);
  const existing = perLine?.get(effect);
  if (existing !== undefined) {
    throw new Error(`${effect}: second write on line ${ws.admitted.lineId} — rule ${ctx.rule.id} conflicts with rule ${existing.ruleId}; first-writer-wins, a second write is an error (§4.3).`);
  }
}

function recordStructuralWrite(ws: LineWorkingState, effect: StructuralEffect, ctx: EffectApplicationContext): void {
  let perLine = ctx.tracker.structuralWriters.get(ws.admitted.lineId);
  if (perLine === undefined) {
    perLine = new Map();
    ctx.tracker.structuralWriters.set(ws.admitted.lineId, perLine);
  }
  perLine.set(effect, { ruleId: ctx.rule.id });
}

function buildFlag(rec: Record<string, unknown>, rule: Rule, lineIds: readonly string[]): Flag {
  const code = rec['code'];
  const severity = rec['severity'];
  const message = rec['message'];
  if (typeof code !== 'string') throw new Error('flag: expected a string "code".');
  if (!isFlagSeverity(severity)) throw new Error(`flag: "${JSON.stringify(severity)}" is not a recognized severity.`);
  return {
    code,
    severity,
    message: typeof message === 'string' ? message : '',
    ruleId: rule.id,
    citation: rule.citation,
    lineIds: [...lineIds],
  };
}

// ===========================================================================
// The interpreter's main loop.
// ===========================================================================

export function evaluate(input: EvaluateInput): EvaluateResult {
  validateRules(input.rules);

  const states: LineWorkingState[] = input.lines.map((admitted) => ({
    admitted,
    si: admitted.resolvedSI,
    status: null,
    isExempt: false,
    bundledUnder: null,
    basis: 'NONE',
    routed: false,
    flags: [],
    haltReason: null,
    haltedByRuleId: null,
    evaluations: [],
  }));
  const workingByLineId = new Map(states.map((s) => [s.admitted.lineId, s] as const));

  const evalNode = makeEvalNode();
  const tracker = makeConflictTracker();
  const rankMemo = makeRankMemo();
  const scopeExclusions = new Map<string, Set<string>>(); // ruleId -> excluded lineIds, accumulated across the whole run
  const disclosures: Flag[] = [];
  const claimTrace: Evaluation[] = [];

  const epochSnapshots = new Map<Epoch, DeepFrozen<ClaimFacts>>();
  const epochFacts = new Map<Epoch, readonly Fact[]>();
  const epochFactsByIdMap = new Map<Epoch, ReadonlyMap<string, Fact>>();

  function recordEpoch(epoch: Epoch): void {
    const snapshot = computeEpochSnapshot(states);
    epochSnapshots.set(epoch, snapshot);
    const facts = computeEpochFacts(epoch, snapshot);
    epochFacts.set(epoch, facts);
    epochFactsByIdMap.set(epoch, new Map(facts.map((f) => [f.factId, f] as const)));
  }

  // E0 exists before any rule runs.
  recordEpoch('E0');

  // Group rules by window rank, preserving global (order asc, id asc)
  // sequencing within each window (§2.4: explicit tiebreak on every sort).
  const byWindowRank = new Map<number, Rule[]>();
  for (const rule of input.rules) {
    const rank = windowForRule(rule).rank;
    let list = byWindowRank.get(rank);
    if (list === undefined) {
      list = [];
      byWindowRank.set(rank, list);
    }
    list.push(rule);
  }
  for (const list of byWindowRank.values()) {
    list.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id.localeCompare(b.id)));
  }

  for (const window of EPOCH_WINDOWS_IN_ORDER) {
    const rulesInWindow = byWindowRank.get(window.rank) ?? [];
    for (const rule of rulesInWindow) {
      const readEpoch = rule.epoch;
      const snapshot = epochSnapshots.get(readEpoch);
      if (snapshot === undefined) {
        // Cannot happen given `validateRules`'s ceiling check plus the
        // fixed window sequence, but keeps this function total rather
        // than reaching for a non-null assertion (README rule 5).
        throw new Error(`rule ${rule.id} declared epoch "${readEpoch}", which has not been computed yet.`);
      }

      if (rule.scopeTarget === 'claim') {
        runClaimScopedRule(rule, snapshot, input.options, evalNode, rankMemo, epochFactsByIdMap, workingByLineId, claimTrace, disclosures);
        continue;
      }

      for (const ws of states) {
        runLineScopedRuleForLine(ws, rule, snapshot, input.options, evalNode, rankMemo, epochFactsByIdMap, tracker, workingByLineId, scopeExclusions);
      }
    }

    if (window.producesEpoch !== undefined) {
      recordEpoch(window.producesEpoch);
    }
  }

  const factsOut: Record<Epoch, readonly Fact[]> = {
    E0: epochFacts.get('E0') ?? [],
    E1: epochFacts.get('E1') ?? [],
    E2: epochFacts.get('E2') ?? [],
    E3a: epochFacts.get('E3a') ?? [],
    E3b: epochFacts.get('E3b') ?? [],
    E4: epochFacts.get('E4') ?? [],
  };

  const scopeExclusionsOut: ScopeExclusion[] = [...scopeExclusions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ruleId, lineIds]) => ({ ruleId, excludedLineIds: [...lineIds] }));

  const determinations: Determination[] = states.map((ws) => ({
    lineId: ws.admitted.lineId,
    resolvedSI: ws.admitted.resolvedSI,
    effectiveSI: ws.si,
    status: ws.status,
    bundledUnder: ws.bundledUnder,
    basis: ws.basis,
    routed: ws.routed,
    isExempt: ws.isExempt,
    flags: ws.flags,
    trace: ws.evaluations,
  }));

  return {
    determinations,
    facts: factsOut,
    scopeExclusions: scopeExclusionsOut,
    disclosures,
    trace: claimTrace,
  };
}

// ---------------------------------------------------------------------------
// Line-scoped rule, applied to one admitted line.
// ---------------------------------------------------------------------------

function runLineScopedRuleForLine(
  ws: LineWorkingState,
  rule: Rule,
  snapshot: ClaimFacts,
  options: OptionsFacts,
  evalNode: EvalNode,
  rankMemo: RankMemo,
  epochFactsByIdMap: ReadonlyMap<Epoch, ReadonlyMap<string, Fact>>,
  tracker: ConflictTracker,
  workingByLineId: ReadonlyMap<string, LineWorkingState>,
  scopeExclusions: Map<string, Set<string>>,
): void {
  if (ws.haltReason === 'fault' || (ws.haltReason === 'stop' && rule.alwaysEvaluate !== true)) {
    ws.evaluations.push(
      makeEvaluation(rule, {
        examined: emptyExamined(ws.admitted.lineId),
        predicate: rule.when ?? ALWAYS_NODE,
        outcome: 'SKIPPED',
        effect: null,
        counterfactual: `halted by an earlier ${ws.haltReason === 'fault' ? 'engine fault' : 'stop'}${ws.haltedByRuleId !== null ? ` (rule ${ws.haltedByRuleId})` : ''} in this phase`,
      }),
    );
    return;
  }

  const lineSubject = toLineFacts(ws);
  const scopeCtx: OperatorContext = { subject: lineSubject, claim: snapshot, options };

  let scopeFired: boolean;
  try {
    scopeFired = evalNode(rule.scope, scopeCtx).fired;
  } catch (err) {
    haltWithFault(ws, rule, err, emptyExamined(ws.admitted.lineId), rule.scope);
    return;
  }

  if (!scopeFired) {
    let excluded = scopeExclusions.get(rule.id);
    if (excluded === undefined) {
      excluded = new Set();
      scopeExclusions.set(rule.id, excluded);
    }
    excluded.add(ws.admitted.lineId);
    return;
  }

  const whenNode = rule.when ?? ALWAYS_NODE;
  const factRefCtx: FactRefContext = {
    epoch: rule.epoch,
    claim: snapshot,
    options,
    evalNode,
    rankMemo,
    epochFacts: epochFactsByIdMap.get(rule.epoch) ?? new Map(),
  };

  // Only a rule's own top-level `when` gets the NOT_EVALUATED treatment —
  // `unimplemented` nested inside an `allOf`/`anyOf`/`not` is not special-
  // cased here and just evaluates false like any other child, per §4.3's
  // framing of `dataRequired` as a property of the *rule*, not of a
  // sub-clause. See the final report.
  if (whenNode.op === 'unimplemented') {
    const reasonRaw = isRecordArgs(whenNode.args) ? whenNode.args['reason'] : undefined;
    ws.evaluations.push(
      makeEvaluation(rule, {
        examined: {
          subjectLineId: ws.admitted.lineId,
          ordinal: null,
          subjectInAmong: null,
          factRefs: [],
          detail: { reason: typeof reasonRaw === 'string' ? reasonRaw : '' },
        },
        predicate: whenNode,
        outcome: 'NOT_EVALUATED',
        effect: null,
        counterfactual: null,
      }),
    );
    return;
  }

  let fired: boolean;
  let operatorExamined: Readonly<Record<string, JsonValue>>;
  try {
    const result = evalNode(whenNode, scopeCtx);
    fired = result.fired;
    operatorExamined = result.examined;
  } catch (err) {
    haltWithFault(ws, rule, err, examinedFrom(ws.admitted.lineId, {}, collectFactRefs(whenNode, factRefCtx)), whenNode);
    return;
  }

  const factRefs = collectFactRefs(whenNode, factRefCtx);
  const examined = examinedFrom(ws.admitted.lineId, operatorExamined, factRefs);

  if (!fired) {
    ws.evaluations.push(
      makeEvaluation(rule, {
        examined,
        predicate: whenNode,
        outcome: 'NOT_FIRED',
        effect: null,
        counterfactual: `would fire if ${describeNode(whenNode)}`,
      }),
    );
    return;
  }

  const effectCtx: EffectApplicationContext = { rule, claim: snapshot, options, evalNode, workingByLineId, tracker };
  let haltRequested = false;
  const applied: EffectApplication[] = [];
  try {
    for (const effectNode of rule.then) {
      if (effectNode.op === 'stop') haltRequested = true;
      applyLineEffect(ws, effectNode, effectCtx);
      applied.push({ op: effectNode.op, args: toJsonValue(effectNode.args) });
    }
  } catch (err) {
    haltWithFault(ws, rule, err, examined, whenNode);
    return;
  }

  ws.evaluations.push(
    makeEvaluation(rule, {
      examined,
      predicate: whenNode,
      outcome: 'FIRED',
      effect: applied,
      counterfactual: null,
    }),
  );

  if (haltRequested) {
    ws.haltReason = 'stop';
    ws.haltedByRuleId = rule.id;
  }
}

function haltWithFault(ws: LineWorkingState, rule: Rule, err: unknown, examined: EvaluationExamined, predicate: PredicateNode): void {
  const message = err instanceof Error ? err.message : String(err);
  ws.evaluations.push(
    makeEvaluation(rule, {
      examined,
      predicate,
      outcome: 'ERRORED',
      effect: null,
      counterfactual: null,
    }),
  );
  ws.flags.push({
    code: 'ENGINE.RULE_FAULT',
    severity: 'gap',
    message: `rule ${rule.id} faulted on line ${ws.admitted.lineId}: ${message}`,
    ruleId: rule.id,
    citation: rule.citation,
    lineIds: [ws.admitted.lineId],
  });
  ws.haltReason = 'fault';
  ws.haltedByRuleId = rule.id;
}

// ---------------------------------------------------------------------------
// Claim-scoped rule — evaluated exactly once, never per line (§4.2).
// ---------------------------------------------------------------------------

function runClaimScopedRule(
  rule: Rule,
  snapshot: ClaimFacts,
  options: OptionsFacts,
  evalNode: EvalNode,
  rankMemo: RankMemo,
  epochFactsByIdMap: ReadonlyMap<Epoch, ReadonlyMap<string, Fact>>,
  workingByLineId: ReadonlyMap<string, LineWorkingState>,
  claimTrace: Evaluation[],
  disclosures: Flag[],
): void {
  const ctx: OperatorContext = { subject: null, claim: snapshot, options };
  const factRefCtx: FactRefContext = {
    epoch: rule.epoch,
    claim: snapshot,
    options,
    evalNode,
    rankMemo,
    epochFacts: epochFactsByIdMap.get(rule.epoch) ?? new Map(),
  };

  let fired: boolean;
  let operatorExamined: Readonly<Record<string, JsonValue>> = {};
  try {
    const scopeResult = evalNode(rule.scope, ctx);
    if (!scopeResult.fired) {
      claimTrace.push(
        makeEvaluation(rule, {
          examined: examinedFrom(null, scopeResult.examined, collectFactRefs(rule.scope, factRefCtx)),
          predicate: rule.scope,
          outcome: 'NOT_FIRED',
          effect: null,
          counterfactual: `would fire if ${describeNode(rule.scope)}`,
        }),
      );
      return;
    }
    const whenNode = rule.when ?? ALWAYS_NODE;
    const whenResult = evalNode(whenNode, ctx);
    fired = whenResult.fired;
    operatorExamined = whenResult.examined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    claimTrace.push(
      makeEvaluation(rule, {
        examined: examinedFrom(null, {}, []),
        predicate: rule.scope,
        outcome: 'ERRORED',
        effect: null,
        counterfactual: null,
      }),
    );
    disclosures.push({
      code: 'ENGINE.RULE_FAULT',
      severity: 'gap',
      message: `claim-scoped rule ${rule.id} faulted: ${message}`,
      ruleId: rule.id,
      citation: rule.citation,
      lineIds: [],
    });
    return;
  }

  const whenNode = rule.when ?? ALWAYS_NODE;
  const factRefs = collectFactRefs(whenNode, factRefCtx);
  const examined = examinedFrom(null, operatorExamined, factRefs);

  if (!fired) {
    claimTrace.push(
      makeEvaluation(rule, {
        examined,
        predicate: whenNode,
        outcome: 'NOT_FIRED',
        effect: null,
        counterfactual: `would fire if ${describeNode(whenNode)}`,
      }),
    );
    return;
  }

  const allLineIds = [...workingByLineId.keys()];
  const applied: EffectApplication[] = [];
  for (const effectNode of rule.then) {
    // Pre-flight already guarantees every claim-scoped effect is `flag`.
    const rec = isRecordArgs(effectNode.args) ? effectNode.args : {};
    const f = buildFlag(rec, rule, allLineIds);
    disclosures.push(f);
    for (const ws of workingByLineId.values()) ws.flags.push(f);
    applied.push({ op: effectNode.op, args: toJsonValue(effectNode.args) });
  }

  claimTrace.push(
    makeEvaluation(rule, {
      examined,
      predicate: whenNode,
      outcome: 'FIRED',
      effect: applied,
      counterfactual: null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Small `Evaluation`/`examined` builders.
// ---------------------------------------------------------------------------

function emptyExamined(subjectLineId: string | null): EvaluationExamined {
  return { subjectLineId, ordinal: null, subjectInAmong: null, factRefs: [], detail: {} };
}

/**
 * Builds `Evaluation.examined` from an operator's raw `EvalResult.examined`
 * plus this file's own `factRefs` computation. No redaction happens here:
 * `dsl/operators.ts`'s claim-level conditions
 * (`claimContainsAny`/`claimContainsNone`/`claimContainsCode`/
 * `claimUnitsAtLeast`/`claimLineCountAtLeast`) never return a claim-wide
 * line-id list in the first place — see the comments at each of those
 * operators for why (§2.5's O(rules x lines^2) hazard). The contributing
 * lines are recoverable from `factRefs` below, which resolves into
 * `Result.facts` (§2.5's single-storage rule), so there is nothing left to
 * strip out of `rawDetail` on the way into `detail`.
 */
function examinedFrom(subjectLineId: string | null, rawDetail: Readonly<Record<string, JsonValue>>, factRefs: readonly string[]): EvaluationExamined {
  const ordinalRaw = rawDetail['ordinal'];
  const subjectInAmongRaw = rawDetail['subjectInAmong'];
  const detail: Record<string, JsonValue> = { ...rawDetail };
  return {
    subjectLineId,
    ordinal: typeof ordinalRaw === 'number' ? ordinalRaw : null,
    subjectInAmong: typeof subjectInAmongRaw === 'boolean' ? subjectInAmongRaw : null,
    factRefs,
    detail,
  };
}

interface MakeEvaluationInput {
  readonly examined: EvaluationExamined;
  readonly predicate: PredicateNode | null;
  readonly outcome: Outcome;
  readonly effect: readonly EffectApplication[] | null;
  readonly counterfactual: string | null;
}

function makeEvaluation(rule: Rule, parts: MakeEvaluationInput): Evaluation {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    phase: rule.phase,
    band: rule.band,
    order: rule.order,
    epoch: rule.epoch,
    citation: rule.citation,
    scopeTarget: rule.scopeTarget,
    examined: parts.examined,
    predicate: parts.predicate === null ? null : { op: parts.predicate.op, args: toJsonValue(parts.predicate.args) },
    outcome: parts.outcome,
    effect: parts.effect,
    supersededBy: null,
    counterfactual: parts.counterfactual,
  };
}
