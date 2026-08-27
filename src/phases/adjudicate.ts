/**
 * U12a — phase wiring (missing from the original unit list; see
 * docs/BUILD_LOG.md). Runs a validated `ClaimInput` end to end through
 * phase 1 (CLASSIFY, `./classify.js`) and phase 2 (ADJUDICATE, the
 * `dsl/evaluate.ts` interpreter over a loaded registry), and assembles the
 * combined, spec-shaped result. Phases 3 (BENCHMARK) and 4 (CONTRACT) are
 * out of scope for this batch (§10/§11 — "Do not build... no dollar
 * amounts in output"), so `EngineResult` below is a deliberately reduced
 * projection of spec §5.1's `Result`: no `amounts`, no `claimAmounts`. See
 * the final report for the exact shape decisions.
 *
 * LAYERING. This file receives already-validated, already-typed inputs
 * (`ClaimInput`, `EngineOptionsInput`, `Rule[]`) — the raw `unknown`-in
 * boundary validation (§12.2) lives in `src/index.ts`, the actual public
 * entry point. Keeping that split means this file's logic is testable
 * directly against typed fixtures without needing round-trip JSON.
 */

import type { Basis, ClaimInput, ClaimLineInput, Disposition, Epoch, EngineError, Fact, Flag, ScopeExclusion, Status } from '../types.js';
import { classify, type Applicability, type ClassifiedLine } from './classify.js';
import { evaluate, type AdmittedLine, type Rule } from '../dsl/evaluate.js';
import { TraceJournal, getLine, type AssembledEvaluation, type TraceLevel } from '../trace.js';
import { resolve as resolveRoute } from '../routing.js';
import { DATA_VERSION } from '../data/index.js';
import type { OptionsFacts } from '../dsl/operators.js';
import { REGISTRY_VERSION } from '../registry/loader.js';

// ===========================================================================
// Public output shapes — reduced §5.1 projection (see file header).
// ===========================================================================

/**
 * §5.1's `line: { procCode, modifiers[], units, fromDate, thruDate,
 * revenueCode?, chargeMils }` — U19b. Echoes exactly what the engine
 * received for this line from `ClaimLineInput`, unmodified by phase 1
 * normalization (raw `procCode`, not the normalized/shape-stripped `code`;
 * raw `units` as the still-unparsed string the feed supplied, not
 * `AdmittedLine.unitCount`'s parsed integer). This is the auditable-trace
 * requirement §5.1 states directly: `units` feeds C-APC 8011's unit test
 * and `modifiers` feed the 73/74/PN/PO rules, so a determination that does
 * not echo its own input cannot be checked against that input. `revenueCode`
 * is spec-optional (`revenueCode?`) but kept required-string here, empty
 * string meaning absent — the same convention `ClaimLineInput.revCode` and
 * this file's own flattened `revCode` field already use.
 */
export interface DeterminationLine {
  readonly procCode: string;
  readonly modifiers: readonly string[];
  readonly units: string;
  readonly fromDate: string;
  readonly thruDate: string;
  readonly revenueCode: string;
  readonly chargeMils: number;
}

/**
 * §5.1's `Determination`, minus `amounts` — phase 3 is not built this batch. `trace` is `AssembledEvaluation[]` (trace.ts, §5.3a-filtered), not the raw `Evaluation[]` the spec's illustration shows, since assembling through `TraceJournal` is the mechanism §2.2/§5.3a actually specify.
 *
 * `line` (U19b) is the spec-shaped input echo, always populated. The
 * pre-existing flattened `code`/`revCode`/`chargeMils` fields are kept
 * alongside it rather than removed: `code` is actively read outside this
 * file (the CLI's table/`--why` filter, `test/codeList.test.ts`), and this
 * `Determination` shape is a public export (`src/index.ts`) with at least
 * one out-of-repo consumer (`837-claim-viewer`) whose read surface is not
 * fully known from here — so narrowing it is a real compatibility risk for
 * a fix unit scoped to "add what's missing," not "remove what might be
 * unused." See the final report.
 */
export interface Determination {
  readonly lineId: string;
  readonly line: DeterminationLine;
  readonly code: string;
  readonly revCode: string;
  readonly chargeMils: number;
  readonly resolvedSI: string | null;
  readonly effectiveSI: string | null;
  readonly status: Status;
  readonly disposition: Disposition;
  readonly bundledUnder: string | null;
  readonly basis: Basis;
  readonly flags: readonly Flag[];
  readonly trace: readonly AssembledEvaluation[];
}

export interface EngineResult {
  readonly claimId: string;
  /** Non-null only when the §8.0 gate rejected the claim outright — zero determinations follow (§8.0). */
  readonly applicability: Applicability | null;
  readonly determinations: readonly Determination[];
  readonly facts: Readonly<Record<Epoch, readonly Fact[]>>;
  readonly disclosures: readonly Flag[];
  readonly scopeExclusions: readonly ScopeExclusion[];
  readonly counterfactuals: Readonly<Record<string, string>>;
  /** Always `[]` in this batch — see the final report on why §12.8's "the fault repeats in Result.errors" is not implementable against §12.7's closed, load-time-only `EngineErrorCode` vocabulary. */
  readonly errors: readonly EngineError[];
  readonly engineStatus: 'OK' | 'PARTIAL';
  readonly provenance: {
    readonly dataVersion: typeof DATA_VERSION;
    readonly registryVersion: string;
    readonly contractVersion: null;
  };
  readonly meta: {
    readonly validate: 'inputs' | 'boundaries' | 'off';
    readonly traceLevel: TraceLevel;
    readonly build: string;
  };
  readonly trace: readonly AssembledEvaluation[];
}

export interface AdjudicateClaimOptions {
  readonly validate: 'inputs' | 'boundaries' | 'off';
  readonly traceLevel: TraceLevel;
  readonly values: OptionsFacts;
}

/** No clock access inside the engine (§2.4) — a fixed, compile-time build id, never `Date.now()`. */
export const ENGINE_BUILD_ID = 'opps-engine@0.0.1-batch2';

// ===========================================================================
// Orchestration.
// ===========================================================================

export function adjudicateClaim(claim: ClaimInput, options: AdjudicateClaimOptions, rules: readonly Rule[]): EngineResult {
  const classified = classify(claim);

  if (classified.applicability !== null) {
    return {
      claimId: claim.claimId,
      applicability: classified.applicability,
      determinations: [],
      facts: emptyFacts(),
      disclosures: [
        {
          code: 'OPPS.CLASSIFY.NOT_OPPS',
          severity: 'info',
          message: classified.applicability.detail,
          ruleId: null,
          citation: '§8.0',
          lineIds: [],
        },
      ],
      scopeExclusions: [],
      counterfactuals: {},
      errors: [],
      engineStatus: 'OK',
      provenance: { dataVersion: DATA_VERSION, registryVersion: REGISTRY_VERSION, contractVersion: null },
      meta: { validate: options.validate, traceLevel: options.traceLevel, build: ENGINE_BUILD_ID },
      trace: [],
    };
  }

  const originalByLineId = new Map<string, ClaimLineInput>(claim.lines.map((l) => [l.lineId, l] as const));

  const admittedLines: AdmittedLine[] = [];
  for (const cl of classified.lines) {
    if (cl.kind === 'ADMITTED') admittedLines.push(cl.admitted);
  }

  const evalResult = evaluate({ lines: admittedLines, options: options.values, rules });

  const journal = new TraceJournal();
  for (const det of evalResult.determinations) {
    for (const ev of det.trace) journal.recordLine(det.lineId, ev);
  }
  for (const ev of evalResult.trace) journal.recordClaim(ev);
  const assembled = journal.assemble({ traceLevel: options.traceLevel, scopeExclusions: evalResult.scopeExclusions });

  const evalDetByLineId = new Map(evalResult.determinations.map((d) => [d.lineId, d] as const));

  let anyLineFaulted = false;
  const determinations: Determination[] = classified.lines.map((cl) => {
    const built = buildDetermination(cl, originalByLineId, evalDetByLineId, assembled);
    if (built.disposition === 'ENGINE_ERROR') anyLineFaulted = true;
    return built;
  });

  return {
    claimId: claim.claimId,
    applicability: null,
    determinations,
    facts: evalResult.facts,
    disclosures: evalResult.disclosures,
    scopeExclusions: evalResult.scopeExclusions,
    counterfactuals: assembled.counterfactuals,
    errors: [],
    engineStatus: anyLineFaulted ? 'PARTIAL' : 'OK',
    provenance: { dataVersion: DATA_VERSION, registryVersion: REGISTRY_VERSION, contractVersion: null },
    meta: { validate: options.validate, traceLevel: options.traceLevel, build: ENGINE_BUILD_ID },
    trace: assembled.claim,
  };
}

function emptyFacts(): Readonly<Record<Epoch, readonly Fact[]>> {
  return { E0: [], E1: [], E2: [], E3a: [], E3b: [], E4: [] };
}

/**
 * §5.1's `line` echo, built from the raw `ClaimLineInput` the engine
 * actually received for this `lineId` — never from phase 1's normalized
 * `code`/parsed `unitCount`, which would echo what classify.ts *derived*,
 * not what was *input*. `original` is `undefined` only in the defensive
 * "lineId vanished between claim.lines and classification" case (mirrors
 * the pre-existing `original?.revCode ?? ''` fallback below); every field
 * degrades to its natural empty value rather than a non-null assertion
 * (README rule: no `!` in src/).
 */
function buildLineEcho(original: ClaimLineInput | undefined): DeterminationLine {
  return {
    procCode: original?.procCode ?? '',
    modifiers: original?.modifiers ?? [],
    units: original?.units ?? '',
    fromDate: original?.fromDate ?? '',
    thruDate: original?.thruDate ?? '',
    revenueCode: original?.revCode ?? '',
    chargeMils: original?.chargeMils ?? 0,
  };
}

function buildDetermination(
  cl: ClassifiedLine,
  originalByLineId: ReadonlyMap<string, ClaimLineInput>,
  evalDetByLineId: ReadonlyMap<string, ReturnType<typeof evaluate>['determinations'][number]>,
  assembled: ReturnType<TraceJournal['assemble']>,
): Determination {
  const original = originalByLineId.get(cl.lineId);
  const revCode = original?.revCode ?? '';
  const line = buildLineEcho(original);

  if (cl.kind === 'FAULTED') {
    return {
      lineId: cl.lineId,
      line,
      code: '',
      revCode,
      chargeMils: original?.chargeMils ?? 0,
      resolvedSI: null,
      effectiveSI: null,
      status: 'NOT_ADJUDICATED',
      disposition: 'ENGINE_ERROR',
      bundledUnder: null,
      basis: 'NONE',
      flags: [{ code: 'ENGINE.CLASSIFY_FAULT', severity: 'gap', message: `phase 1 faulted on line ${cl.lineId}: ${cl.detail}`, ruleId: null, citation: null, lineIds: [cl.lineId] }],
      trace: [],
    };
  }

  if (cl.kind === 'REJECTED') {
    return {
      lineId: cl.lineId,
      line,
      code: cl.code,
      revCode: cl.revCode,
      chargeMils: cl.chargeMils,
      resolvedSI: cl.resolvedSI,
      effectiveSI: cl.resolvedSI,
      status: cl.status,
      disposition: 'REJECTED',
      bundledUnder: null,
      basis: 'NONE',
      flags: cl.flags,
      trace: getLine(assembled, cl.lineId),
    };
  }

  if (cl.kind === 'ROUTED') {
    return {
      lineId: cl.lineId,
      line,
      code: cl.code,
      revCode: cl.revCode,
      chargeMils: cl.chargeMils,
      resolvedSI: cl.resolvedSI,
      effectiveSI: cl.resolvedSI,
      status: 'ROUTED',
      disposition: 'ROUTED',
      bundledUnder: null,
      basis: cl.route.basis,
      flags: cl.flags,
      trace: getLine(assembled, cl.lineId),
    };
  }

  // cl.kind === 'ADMITTED' — ran through phase 2.
  const det = evalDetByLineId.get(cl.lineId);
  const trace = getLine(assembled, cl.lineId);
  const flags = [...cl.flags, ...(det?.flags ?? [])];

  if (det === undefined) {
    // Cannot happen given every ADMITTED line is fed into `evaluate()` —
    // kept as a defensive, total branch rather than a non-null assertion
    // (README rule 5).
    return {
      lineId: cl.lineId,
      line,
      code: cl.admitted.code,
      revCode,
      chargeMils: cl.admitted.chargeMils,
      resolvedSI: cl.resolvedSI,
      effectiveSI: cl.resolvedSI,
      status: 'NOT_ADJUDICATED',
      disposition: 'ENGINE_ERROR',
      bundledUnder: null,
      basis: 'NONE',
      flags: [...flags, { code: 'ENGINE.MISSING_DETERMINATION', severity: 'gap', message: `line ${cl.lineId} was admitted to phase 2 but produced no determination`, ruleId: null, citation: null, lineIds: [cl.lineId] }],
      trace,
    };
  }

  const faulted = trace.some((ev) => ev.outcome === 'ERRORED');
  if (faulted) {
    return {
      lineId: cl.lineId,
      line,
      code: cl.admitted.code,
      revCode,
      chargeMils: cl.admitted.chargeMils,
      resolvedSI: cl.resolvedSI,
      effectiveSI: det.effectiveSI,
      status: 'NOT_ADJUDICATED',
      disposition: 'ENGINE_ERROR',
      bundledUnder: null,
      basis: 'NONE',
      flags,
      trace,
    };
  }

  if (det.routed) {
    // §9.3 — an unpackaged Q4 converted to SI A and routed. The shared
    // resolver (§2.3) is called here, in the phase, never by the
    // interpreter (§4.3) — this is the one place §9.3's criterion ("the
    // mechanism, not just the verdict") is satisfied.
    const route = resolveRoute(cl.admitted.code, det.effectiveSI);
    // basis is CLFS unconditionally for a Q4 conversion (§9.3: "never
    // OPPS_APC") — forced here rather than trusting whatever
    // routing.resolve() happens to return, because resolve() has no way to
    // distinguish "known CLFS-family code missing a rate row" from "no fee
    // schedule match anywhere" and degrades the former to ROUTED_UNKNOWN.
    // See the final report.
    const status: Status = route.rateMils !== null ? 'PAID' : 'PAID_UNPRICED';
    return {
      lineId: cl.lineId,
      line,
      code: cl.admitted.code,
      revCode,
      chargeMils: cl.admitted.chargeMils,
      resolvedSI: cl.resolvedSI,
      effectiveSI: det.effectiveSI,
      status,
      disposition: 'ADJUDICATED',
      bundledUnder: null,
      basis: 'CLFS',
      flags,
      trace,
    };
  }

  const status = det.status ?? 'NOT_ADJUDICATED';
  return {
    lineId: cl.lineId,
    line,
    code: cl.admitted.code,
    revCode,
    chargeMils: cl.admitted.chargeMils,
    resolvedSI: cl.resolvedSI,
    effectiveSI: det.effectiveSI,
    status,
    disposition: det.status === null ? 'ENGINE_ERROR' : 'ADJUDICATED',
    bundledUnder: det.bundledUnder,
    basis: det.basis,
    flags,
    trace,
  };
}
