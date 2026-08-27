/**
 * U10 — the append-only trace journal + canonical serializer (spec §2.2,
 * §5.3a, §12.3 — the "never freeze the trace journal" line).
 *
 * LAYERING. Per §2.6, `trace.ts` may import `dsl/operators.js` only — never
 * `dsl/evaluate.js` and never `dsl/freeze.js`. Two consequences that show up
 * directly in this file's shape:
 *
 *   - The `Evaluation`/`Fact`/`Epoch` types this file works with come from
 *     `types.ts`, not `dsl/evaluate.ts` (see that file's header for why they
 *     live there). This file never imports `dsl/evaluate.ts` and has no
 *     compile-time dependency on how the interpreter is built.
 *   - `deepFreeze` (U11, `dsl/freeze.ts`) is off limits here even though
 *     §2.2 says the assembled trace is "frozen there alongside the §12.3
 *     canonical serialization step." This file hand-rolls a small local
 *     freeze (`freezePlain`, below) rather than importing U11's — the
 *     assembled trace is always plain JSON-shaped data (no `Map`/`Set`), so
 *     the Set/Map-to-frozen-array conversion `dsl/freeze.ts` exists for
 *     isn't needed here; a straightforward recursive `Object.freeze` is a
 *     complete, correct substitute for this narrower case.
 *
 * THE JOURNAL ITSELF IS NEVER FROZEN. `TraceJournal.record*` keep working
 * for the lifetime of a run; only `assemble()`'s *output* is frozen, once,
 * as the spec requires. `TraceJournal` also exposes no read method beyond
 * `assemble()` — "phases may write it and may not read it" is enforced by
 * the class's own surface, not left to caller discipline: there is no
 * `get`/`entries`/`toArray` a phase could call mid-run to peek at what has
 * been recorded so far and branch on it.
 */

import type { Epoch, EffectApplication, Evaluation, EvaluationExamined, Fact, Outcome, Phase, ScopeExclusion } from './types.js';
import type { JsonValue } from './dsl/operators.js';

// ===========================================================================
// Trace levels (§5.3a). Declared locally rather than imported from
// `dsl/validate.ts` — that file is not on the allowed-import list either
// (only `dsl/operators.js` is), and it is a 3-value string union small
// enough that duplicating it costs nothing (the same self-containment
// choice `dsl/operators.ts` and `dsl/validate.ts` each already made for
// their own local closed vocabularies).
// ===========================================================================

export type TraceLevel = 'fired' | 'standard' | 'full';

// ===========================================================================
// The journal.
// ===========================================================================

/**
 * Append-only, keyed by `lineId` for line-scoped evaluations and held
 * separately for claim-scoped ones (§2.2's "keyed by lineId, and by claim
 * for claim-scoped rules"). A `TraceJournal` is write-only from the outside
 * — `record*` methods only. The only way to get data back out is
 * `assemble()`, which is meant to run exactly once, "at output" (§2.2); a
 * second call throws rather than silently returning a second, possibly
 * differently-filtered view of a journal a caller may have kept writing to.
 */
export class TraceJournal {
  readonly #perLine = new Map<string, Evaluation[]>();
  readonly #claim: Evaluation[] = [];
  #assembled = false;

  /** Appends one `Evaluation` for `lineId`. Never overwrites — `evaluate.ts`'s own `supersededBy` bookkeeping records overwrite *history*, not journal mutation. */
  recordLine(lineId: string, evaluation: Evaluation): void {
    this.#assertNotAssembled();
    let list = this.#perLine.get(lineId);
    if (list === undefined) {
      list = [];
      this.#perLine.set(lineId, list);
    }
    list.push(evaluation);
  }

  /** Appends one claim-scoped `Evaluation` (§4.2: exactly one per claim-scoped rule). */
  recordClaim(evaluation: Evaluation): void {
    this.#assertNotAssembled();
    this.#claim.push(evaluation);
  }

  /**
   * Assembles the final, trace-level-filtered, frozen output — §2.2's
   * "assembled from the journal once, at output, and frozen there." Callable
   * exactly once; a second call is a programming error, not a data question,
   * so it throws rather than silently re-deriving a possibly-stale view.
   *
   * `scopeExclusions` is optional because a caller assembling `fired` or
   * `standard` output has no use for it (§5.3a: scope exclusions per line
   * appear only at `full`) — passing it at those levels is harmless but
   * unnecessary.
   */
  assemble(options: { readonly traceLevel: TraceLevel; readonly scopeExclusions?: readonly ScopeExclusion[] }): AssembledTrace {
    this.#assertNotAssembled();
    this.#assembled = true;
    return buildAssembledTrace(this.#perLine, this.#claim, options.traceLevel, options.scopeExclusions ?? []);
  }

  #assertNotAssembled(): void {
    if (this.#assembled) {
      throw new Error('TraceJournal: assemble() has already run — the journal is assembled once, at output (§2.2), not read-and-written interleaved.');
    }
  }
}

// ===========================================================================
// Assembled output shapes.
// ===========================================================================

/**
 * One evaluation as it appears in assembled output. Always carries both
 * `counterfactual` and `counterfactualRef` — never one present and the
 * other simply absent — so a canonical serialization never has to
 * distinguish "field omitted" from "field present but null" (§2.4's "no
 * undefined-vs-absent ambiguity"). Exactly one is non-null, decided by
 * trace level: `counterfactual` at `fired`/`full`, `counterfactualRef` at
 * `standard` (§5.3a).
 */
export interface AssembledEvaluation {
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

/**
 * `perLine`/`scopeExclusionsByLine` are arrays of `[lineId, value]` tuples,
 * not a `Map` — deliberately, matching `dsl/freeze.ts`'s own reason for the
 * same choice (§12.3): `Object.freeze` on a `Map` does not block
 * `.set()`/`.delete()`, so a `Map` can never actually be the frozen,
 * "assembled... and frozen there" (§2.2) artifact this function returns.
 * This file cannot import `dsl/freeze.ts` (layering, see file header) to
 * reuse its `Map`-to-frozen-array conversion, so it applies the identical
 * principle locally instead. `getLine`/`getScopeExclusions` below are the
 * ergonomic lookup a `Map` would otherwise have given for free.
 */
export interface AssembledTrace {
  readonly perLine: readonly (readonly [string, readonly AssembledEvaluation[]])[];
  readonly claim: readonly AssembledEvaluation[];
  /** ruleId -> counterfactual text, deduped. Always fully populated regardless of level (§5.3a: "a function of the rule's when clause... not of the line", so one entry per rule that ever produced one is all there ever is). */
  readonly counterfactuals: Readonly<Record<string, string>>;
  /** Non-empty only at traceLevel 'full' (§5.3a: "scope exclusions per line"). One entry per lineId that had at least one exclusion; value is the ruleIds that excluded that line by scope. */
  readonly scopeExclusionsByLine: readonly (readonly [string, readonly string[]])[];
}

/** Looks up one line's assembled evaluations by id — `AssembledTrace.perLine` is an array of tuples, not a `Map` (see the type's own doc comment for why), so this is the ergonomic accessor. Returns `[]` for a line with no recorded evaluations. */
export function getLine(trace: AssembledTrace, lineId: string): readonly AssembledEvaluation[] {
  return trace.perLine.find(([id]) => id === lineId)?.[1] ?? [];
}

/** Looks up one line's scope-exclusion ruleIds (`full` trace level only — see `AssembledTrace.scopeExclusionsByLine`). Returns `[]` when the line had none, or when the level wasn't `full`. */
export function getScopeExclusions(trace: AssembledTrace, lineId: string): readonly string[] {
  return trace.scopeExclusionsByLine.find(([id]) => id === lineId)?.[1] ?? [];
}

// ===========================================================================
// counterfactualRef design decision.
//
// The spec's own words: "counterfactualRef, an index into
// Result.counterfactuals[ruleId]." Read most literally that says
// `Result.counterfactuals[ruleId]` is itself a collection and
// `counterfactualRef` a position within it — but the same paragraph also
// says a counterfactual "is a function of the rule's when clause... not of
// the line," which pins it to exactly one string per rule. A per-rule
// collection with only ever one member needing "an index" into it is a
// needless indirection. This file instead reads `counterfactualRef` as the
// *key* into `Result.counterfactuals` (i.e. the ruleId itself, present only
// when a counterfactual exists for that evaluation) — the "index into
// X[ruleId]" phrasing loosely describing "the thing you look up," not a
// numeric array position. `Evaluation.ruleId` already exists on every
// record, so `counterfactualRef` is not fully redundant with it: `ruleId`
// is always present; `counterfactualRef` is `null` whenever this
// evaluation carries no counterfactual (a FIRED entry, for instance) —
// telling a consumer "there is nothing to look up" without them having to
// separately know that FIRED entries never have one. See the final report.
// ===========================================================================

function buildAssembledTrace(
  perLine: ReadonlyMap<string, readonly Evaluation[]>,
  claim: readonly Evaluation[],
  traceLevel: TraceLevel,
  scopeExclusions: readonly ScopeExclusion[],
): AssembledTrace {
  const counterfactuals = collectCounterfactuals(perLine, claim);

  const assembledPerLine: (readonly [string, readonly AssembledEvaluation[]])[] = [];
  for (const [lineId, evaluations] of perLine) {
    assembledPerLine.push([lineId, levelFilterAndAssemble(evaluations, traceLevel)]);
  }
  const assembledClaim = levelFilterAndAssemble(claim, traceLevel);

  const scopeExclusionsByLine: (readonly [string, readonly string[]])[] = [];
  if (traceLevel === 'full') {
    const byLine = new Map<string, string[]>();
    for (const exclusion of scopeExclusions) {
      for (const lineId of exclusion.excludedLineIds) {
        let list = byLine.get(lineId);
        if (list === undefined) {
          list = [];
          byLine.set(lineId, list);
        }
        list.push(exclusion.ruleId);
      }
    }
    for (const [lineId, ruleIds] of byLine) scopeExclusionsByLine.push([lineId, ruleIds]);
  }

  return freezePlain({
    perLine: assembledPerLine,
    claim: assembledClaim,
    counterfactuals,
    scopeExclusionsByLine,
  });
}

/**
 * Scans every recorded evaluation (regardless of trace level — this map is
 * always built in full, since §5.3a's dedup rationale is "one string per
 * rule," not "one string per rule per requested level") and dedupes by
 * `ruleId`. Two different non-null counterfactual strings recorded for the
 * same `ruleId` is a hard error: it would falsify the "a function of the
 * rule's when clause... not of the line" premise the whole `standard`-level
 * compression scheme depends on, so this is exactly the place to catch a
 * violation rather than silently keeping whichever string arrived first.
 */
function collectCounterfactuals(perLine: ReadonlyMap<string, readonly Evaluation[]>, claim: readonly Evaluation[]): Record<string, string> {
  const out: Record<string, string> = {};
  const record = (ev: Evaluation): void => {
    if (ev.counterfactual === null) return;
    const existing = out[ev.ruleId];
    if (existing !== undefined && existing !== ev.counterfactual) {
      throw new Error(
        `TraceJournal: rule ${ev.ruleId} produced two different counterfactual strings ("${existing}" vs "${ev.counterfactual}") — a counterfactual must be a function of the rule's "when" clause only, never of the line (§5.3a).`,
      );
    }
    out[ev.ruleId] = ev.counterfactual;
  };
  for (const evaluations of perLine.values()) for (const ev of evaluations) record(ev);
  for (const ev of claim) record(ev);
  return out;
}

function levelFilterAndAssemble(evaluations: readonly Evaluation[], traceLevel: TraceLevel): readonly AssembledEvaluation[] {
  const kept = traceLevel === 'fired' ? evaluations.filter((ev) => ev.outcome === 'FIRED') : evaluations;
  return kept.map((ev) => assembleOne(ev, traceLevel));
}

function assembleOne(ev: Evaluation, traceLevel: TraceLevel): AssembledEvaluation {
  const useRef = traceLevel === 'standard';
  return {
    ruleId: ev.ruleId,
    ruleVersion: ev.ruleVersion,
    phase: ev.phase,
    band: ev.band,
    order: ev.order,
    epoch: ev.epoch,
    citation: ev.citation,
    scopeTarget: ev.scopeTarget,
    examined: ev.examined,
    predicate: ev.predicate,
    outcome: ev.outcome,
    effect: ev.effect,
    supersededBy: ev.supersededBy,
    counterfactual: useRef ? null : ev.counterfactual,
    counterfactualRef: useRef ? (ev.counterfactual === null ? null : ev.ruleId) : null,
  };
}

/**
 * Resolves a `counterfactualRef` against an assembled trace's
 * `counterfactuals` map. `null` in, `null` out (no counterfactual to
 * resolve). A non-null ref with no matching entry is a hard error, not an
 * empty string (§5.3a) — this is the defensive accessor a consumer (or
 * this unit's own tests) uses to prove that guarantee, since nothing
 * internal to `buildAssembledTrace` can ever produce a dangling ref by
 * construction.
 */
export function resolveCounterfactual(counterfactuals: Readonly<Record<string, string>>, ref: string | null): string | null {
  if (ref === null) return null;
  const text = counterfactuals[ref];
  if (text === undefined) {
    throw new Error(`resolveCounterfactual: counterfactualRef "${ref}" has no matching entry in Result.counterfactuals — a dangling ref is a hard error (§5.3a).`);
  }
  return text;
}

// ===========================================================================
// Canonical serialization (§2.4, §2.2's "alongside the §12.3 canonical
// serialization step").
//
// Two field-order regimes coexist deliberately:
//   - FIXED, declared order for the two closed-shape records this file
//     knows about (`AssembledEvaluation`, `EvaluationExamined`) — "keys
//     emitted in declared order," read literally as *this* declared order,
//     not alphabetical.
//   - Alphabetical key order for genuinely open-ended dynamic bags
//     (`examined.detail`, and any `args`/nested JSON object inside
//     `predicate`/`effect`, which is rule-authored content this file has
//     no closed vocabulary for) — canonical in the weaker sense of "not
//     dependent on incidental construction order," which is all an
//     open-ended bag can promise.
// ===========================================================================

/** Every key `serializeEvaluation` can emit at the `AssembledEvaluation` record level, in emission order. */
export const STRUCTURAL_FIELDS: readonly string[] = [
  // AssembledEvaluation, top level
  'ruleId',
  'ruleVersion',
  'phase',
  'band',
  'order',
  'epoch',
  'citation',
  'scopeTarget',
  'examined',
  'predicate',
  'outcome',
  'effect',
  'supersededBy',
  'counterfactual',
  'counterfactualRef',
  // EvaluationExamined, nested under `examined`
  'subjectLineId',
  'ordinal',
  'subjectInAmong',
  'factRefs',
  'detail',
];

/**
 * No field in the shapes this unit serializes carries money (§4.3's
 * operator set, as built through U9, has no `setAmount`/`setCoinsurance`/
 * `multiply` — see `dsl/evaluate.ts`'s header). Declared and asserted
 * anyway, empty, because §12.3's requirement is that the *union* be
 * asserted complete — a money-bearing field introduced by a later unit
 * without updating this list must fail loudly (`assertFieldCoverage`
 * below), not leak silently into a structural golden by omission. That
 * assertion has no teeth if this list is never declared at all.
 */
export const MONETARY_FIELDS: readonly string[] = [];

const KNOWN_FIELDS = new Set<string>([...STRUCTURAL_FIELDS, ...MONETARY_FIELDS]);

/** Throws if `keys` contains anything outside `STRUCTURAL_FIELDS ∪ MONETARY_FIELDS` — the runtime teeth behind the coverage assertion. */
export function assertFieldCoverage(keys: readonly string[]): void {
  for (const key of keys) {
    if (!KNOWN_FIELDS.has(key)) {
      throw new Error(`trace.ts: field "${key}" is not declared in STRUCTURAL_FIELDS or MONETARY_FIELDS — a new trace field must be classified before it can be serialized (§12.3).`);
    }
  }
}

function isPlainRecord(v: unknown): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Canonicalizes an arbitrary dynamic JSON value: object keys sorted alphabetically, array element order preserved. */
function canonicalDynamic(v: JsonValue): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalDynamic).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalDynamic(v[k] ?? null)}`).join(',')}}`;
}

function canonicalEffectApplication(e: EffectApplication | null): string {
  if (e === null) return 'null';
  return `{"op":${JSON.stringify(e.op)},"args":${canonicalDynamic(e.args)}}`;
}

function canonicalExamined(ex: EvaluationExamined): string {
  assertFieldCoverage(['subjectLineId', 'ordinal', 'subjectInAmong', 'factRefs', 'detail']);
  const parts = [
    `"subjectLineId":${JSON.stringify(ex.subjectLineId)}`,
    `"ordinal":${JSON.stringify(ex.ordinal)}`,
    `"subjectInAmong":${JSON.stringify(ex.subjectInAmong)}`,
    `"factRefs":${JSON.stringify(ex.factRefs)}`,
    `"detail":${canonicalDynamic(ex.detail)}`,
  ];
  return `{${parts.join(',')}}`;
}

/** Canonically serializes one `AssembledEvaluation` — keys in `STRUCTURAL_FIELDS` order, no undefined-vs-absent ambiguity (every field always present, `null` when inapplicable). */
export function serializeEvaluation(ev: AssembledEvaluation): string {
  assertFieldCoverage(Object.keys(ev));
  const parts = [
    `"ruleId":${JSON.stringify(ev.ruleId)}`,
    `"ruleVersion":${JSON.stringify(ev.ruleVersion)}`,
    `"phase":${JSON.stringify(ev.phase)}`,
    `"band":${JSON.stringify(ev.band)}`,
    `"order":${JSON.stringify(ev.order)}`,
    `"epoch":${JSON.stringify(ev.epoch)}`,
    `"citation":${JSON.stringify(ev.citation)}`,
    `"scopeTarget":${JSON.stringify(ev.scopeTarget)}`,
    `"examined":${canonicalExamined(ev.examined)}`,
    `"predicate":${canonicalEffectApplication(ev.predicate)}`,
    `"outcome":${JSON.stringify(ev.outcome)}`,
    `"effect":${ev.effect === null ? 'null' : `[${ev.effect.map(canonicalEffectApplication).join(',')}]`}`,
    `"supersededBy":${JSON.stringify(ev.supersededBy)}`,
    `"counterfactual":${JSON.stringify(ev.counterfactual)}`,
    `"counterfactualRef":${JSON.stringify(ev.counterfactualRef)}`,
  ];
  return `{${parts.join(',')}}`;
}

/** Canonically serializes a full `AssembledTrace` — `perLine` entries in the order the journal first saw each `lineId` (claim-authoring order; this file does not re-sort it, since it is not this file's call to make), each line's evaluations in recorded order. */
export function serializeTrace(trace: AssembledTrace): string {
  const perLineJson = trace.perLine.map(([id, evaluations]) => `${JSON.stringify(id)}:[${evaluations.map(serializeEvaluation).join(',')}]`);
  const claimJson = trace.claim.map(serializeEvaluation).join(',');
  const counterfactualKeys = Object.keys(trace.counterfactuals).sort();
  const counterfactualsJson = counterfactualKeys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(trace.counterfactuals[k])}`).join(',');
  const exclusionsJson = [...trace.scopeExclusionsByLine]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, ruleIds]) => `${JSON.stringify(id)}:${JSON.stringify(ruleIds)}`)
    .join(',');
  return `{"perLine":{${perLineJson.join(',')}},"claim":[${claimJson}],"counterfactuals":{${counterfactualsJson}},"scopeExclusionsByLine":{${exclusionsJson}}}`;
}

// ===========================================================================
// Local recursive freeze — see the file header for why this doesn't import
// `dsl/freeze.ts`. `AssembledTrace`'s own two "map-like" fields (`perLine`,
// `scopeExclusionsByLine`) are already plain frozen arrays of tuples by the
// time this runs (see that type's doc comment), not `Map` instances — so,
// unlike `dsl/freeze.ts`, this function never needs to handle the
// `Object.freeze`-on-a-`Map`-doesn't-block-`.set()` defect (§12.3) at all;
// there is no `Map` anywhere in the structure it walks. Plain recursive
// `Object.freeze` over objects/arrays is a complete, correct freeze for
// data that is JSON-shaped by construction (§12.9: "structured-clone-safe").
// ===========================================================================

function freezePlainInner(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) freezePlainInner(item, seen);
    Object.freeze(value);
    return;
  }
  for (const key of Object.keys(value)) freezePlainInner(Reflect.get(value, key), seen);
  Object.freeze(value);
}

function freezePlain<T>(value: T): T {
  freezePlainInner(value, new WeakSet());
  return value;
}
