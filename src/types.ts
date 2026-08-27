/**
 * M1.1 input contract — U1.
 *
 * `ClaimInput` / `ClaimLineInput` and the closed vocabularies the rest of
 * the engine builds on. Declared here, not imported from `837-claim-viewer`
 * (spec §2.1): the engine owns its own input shape, coupled to the viewer's
 * `src/model/claim.ts` only by naming convention, not by source.
 *
 * Money is integer mils (1/1000 dollar) everywhere in this file. No floats.
 */

// ---------------------------------------------------------------------------
// Claim input (spec §2.1, §5.1)
// ---------------------------------------------------------------------------

export interface ClaimLineInput {
  /** §19.14: chargeId when the feed supplies one, else `idx:<n>`. Unique per claim. */
  lineId: string;
  /** Empty string when the line carries no HCPCS — legitimate, see §8.0.1. */
  procCode: string;
  modifiers: string[];
  /** UB-04 FL42. Present on institutional lines even when procCode is empty. */
  revCode: string;
  /** Raw feed value, unparsed. */
  units: string;
  /** Unit-of-measure qualifier: 'DA' days, 'UN' units, '' unknown. */
  unitQualifier: string;
  chargeMils: number;
  /** YYYYMMDD. Falls back to the claim period when the feed has no per-line date. */
  fromDate: string;
  thruDate: string;
}

export interface ClaimInput {
  claimId: string;
  /** Raw feed value, e.g. 'ub92'. The gate decides; the adapter does not judge. */
  claimForm: string;
  /** UB-04 FL04, e.g. '81A'. Empty when absent. */
  typeOfBill: string;
  statementFrom: string;
  statementThrough: string;
  conditionCodes: string[];
  occurrenceCodes: { code: string; date: string }[];
  valueCodes: { code: string; amountMils: number }[];
  /** NUCC taxonomy of the billing provider, e.g. '282NC0060X'. Gate input. */
  billingTaxonomy: string;
  payer: { id: string; name: string };
  diagnoses: string[];
  lines: ClaimLineInput[];
  /** Feed-declared total, for the §U2 reconciliation check. */
  totalChargeMils: number;
  /** Which lineId scheme was used, so a consumer knows if it holds positional ids. */
  lineIdScheme: 'feed' | 'positional' | 'mixed';
}

// ---------------------------------------------------------------------------
// Closed vocabularies (string-literal unions, not enums, so they serialize
// as themselves — spec §5.1, §5.3, §10.3)
// ---------------------------------------------------------------------------

/**
 * `Determination.status` — spec §5.1. Rev 8/9 additions: `NO_PROCEDURE_CODE`
 * (§8.0.1, a revenue-code-only line — normal billing, not an error) and
 * `INVALID_HISTORICAL` (§7.5.1). `NOT_ADJUDICATED` is engine-emitted, never
 * rule-emitted (§12.8, line-local failure containment). `PACKAGED` is a
 * U19b addition (D32, settled by running the CLI against SI `N`): distinct
 * from both `PAID` (SI N pays nothing separately — reporting `PAID` told a
 * reader the line pays, the opposite of the truth) and `BUNDLED` (`BUNDLED`
 * names a controlling line in `bundledUnder`; `PACKAGED` means packaged
 * into the claim with no single controlling line to name, so
 * `bundledUnder` stays `null`).
 */
export type Status =
  | 'PAID'
  | 'PAID_EXEMPT'
  | 'PAID_UNPRICED'
  | 'PACKAGED'
  | 'BUNDLED'
  | 'ROUTED'
  | 'NOT_PAID_RECODE'
  | 'NOT_PAID_INPT_ONLY'
  | 'NOT_PAID'
  | 'MALFORMED'
  | 'INVALID'
  | 'INVALID_HISTORICAL'
  | 'NO_PROCEDURE_CODE'
  | 'DELETED'
  | 'NOT_ADJUDICATED';

/** `Determination.disposition` — spec §5.1. */
export type Disposition = 'REJECTED' | 'ROUTED' | 'ADJUDICATED' | 'ENGINE_ERROR';

/**
 * `Evaluation.outcome` — spec §5.3. `NOT_APPLICABLE` is deliberately absent
 * (§5.3a): a scope exclusion is not a "considered and passed over" outcome,
 * it produces no per-line `Evaluation` at all.
 */
export type Outcome =
  | 'FIRED'
  | 'NOT_FIRED'
  | 'NOT_EVALUATED'
  | 'NOT_REACHED'
  | 'SKIPPED'
  | 'ERRORED'
  | 'RETIRED';

/** `Determination.basis` / `Evaluation` amount basis — spec §10.3, 13 values. */
export type Basis =
  | 'OPPS_APC'
  | 'OPPS_DRUG_ASP'
  | 'OPPS_BLOOD'
  | 'OPPS_COMPREHENSIVE'
  | 'CLFS'
  | 'COST'
  | 'PHP_PER_DIEM'
  | 'ROUTED_MPFS'
  | 'ROUTED_DMEPOS'
  | 'ROUTED_AFS'
  | 'ROUTED_UNKNOWN'
  | 'CONTRACT'
  | 'NONE';

/**
 * `EngineError.code` — spec §12.7. Closed set, all load-time, all fail-closed
 * before any determination exists.
 */
export type EngineErrorCode =
  | 'CONTRACT_VERSION_MISMATCH'
  | 'DATA_BUNDLE_INVALID'
  | 'DATA_TABLE_MISSING'
  | 'REGISTRY_SCHEMA_INVALID'
  | 'REGISTRY_INVARIANT_VIOLATION'
  | 'CLAIM_SCHEMA_INVALID'
  | 'OPTIONS_SCHEMA_INVALID'
  | 'PROVIDER_IDENTITY_INVALID'
  | 'LINE_ID_NOT_UNIQUE'
  | 'CONTRACT_SELECTION_TIE'
  | 'DOS_OUT_OF_WINDOW_ALL_LINES';

/** `Flag.severity` — spec §12.7. */
export type FlagSeverity = 'info' | 'warning' | 'assumption' | 'gap';

/**
 * Errors are data, on the same terms as determinations (spec §12.7). The
 * engine throws exactly one class, and only for faults that make the whole
 * run meaningless — every code above is claim-fatal (§12.8).
 */
export interface EngineError {
  name: 'EngineError';
  code: EngineErrorCode;
  path: string;
  detail: string;
  claimId: string | null;
}

/**
 * Every §10.4 disclosure and every gap flag emits one (spec §12.7). `code`
 * is enumerated in a flag manifest elsewhere in the engine; this type only
 * fixes the shape.
 */
export interface Flag {
  code: string;
  severity: FlagSeverity;
  message: string;
  ruleId: string | null;
  citation: string | null;
  lineIds: string[];
}

// ---------------------------------------------------------------------------
// U9/U10 shared vocabulary (spec §2.5, §4.2, §5.2, §5.4).
//
// These live here — not in `dsl/evaluate.ts` or `trace.ts` — because §2.6's
// stated import direction lets `trace.ts` import `dsl/operators.js` only; it
// may never import `dsl/evaluate.js`. `Evaluation`/`Fact`/`Epoch` are read by
// both the interpreter (which produces them) and the trace journal (which
// stores and serializes them), so the only place both can reach without
// violating that rule is this file — the same role it already plays for
// `Status`/`Outcome`/`Flag` above. `JsonValue` is duplicated here rather than
// imported from `dsl/operators.ts`, matching that file's own "declared
// locally, not imported" self-containment discipline (see its header).
// ---------------------------------------------------------------------------

/** A JSON-safe value. Duplicated from `dsl/operators.ts` — see note above. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Fact epochs (spec §2.5). `E0` exists before any rule runs; each later
 * epoch is recomputed at the stated band barrier. `E3a`/`E3b` are band
 * 4000's two sub-epochs — the one point where a single band needs more than
 * one fact barrier (see `dsl/evaluate.ts`'s header for why).
 */
export type Epoch = 'E0' | 'E1' | 'E2' | 'E3a' | 'E3b' | 'E4';

/** `Epoch`s in barrier order — the only place their ordering is allowed to matter (§2.4: no relying on array order for semantics elsewhere). */
export const EPOCH_ORDER: readonly Epoch[] = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'E4'];

/** Rule/`Evaluation` phase — spec §2.2's four-stage pipeline. */
export type Phase = 'CLASSIFY' | 'ADJUDICATE' | 'BENCHMARK' | 'CONTRACT';

/**
 * A single named, epoch-scoped aggregate fact (spec §2.5, §5.4). Stored once
 * per epoch in `Result.facts[epoch]`; an `Evaluation` never copies a fact's
 * contents, only references its `factId` — see `dsl/evaluate.ts`.
 */
export interface Fact {
  readonly factId: string;
  readonly kind: string;
  readonly dimension: string;
  readonly values: readonly JsonValue[];
  readonly lineIds: readonly string[];
}

/** `{op, args}` record of one effect actually applied by a `FIRED` rule — spec §5.2's `Evaluation.effect`. */
export interface EffectApplication {
  readonly op: string;
  readonly args: JsonValue;
}

/**
 * Spec §5.2's `Evaluation.examined`, illustrated there as operator-specific
 * keys (e.g. `si: "Q4"`) flattened alongside four fixed fields. Nested here
 * under `detail` instead of flattened: a flattened shape needs either an
 * index signature (which cannot coexist with concretely-typed sibling
 * fields under this repo's strict settings without weakening their types
 * to the index signature's) or an intersection type (which produces the
 * same conflict). Nesting is content-equivalent — `detail` carries exactly
 * what the evaluated operator's own `EvalResult.examined` returned — and
 * `trace.ts`'s canonical serializer treats `examined` as one structural key
 * regardless of nesting depth, so nothing downstream needs the flat shape.
 */
export interface EvaluationExamined {
  readonly subjectLineId: string | null;
  readonly ordinal: number | null;
  readonly subjectInAmong: boolean | null;
  readonly factRefs: readonly string[];
  readonly detail: Readonly<Record<string, JsonValue>>;
}

/**
 * One rule's consideration of one line (or, for a claim-scoped rule, of the
 * claim) — spec §5.2. `counterfactual` is always present here at full
 * fidelity; `trace.ts` is what replaces it with `counterfactualRef` at
 * trace levels `standard`/`fired` (§5.3a) when assembling the journal into
 * output. `predicate` records `{op, args}` for whichever node (`when`, or a
 * synthetic `always` when `when` is absent) determined FIRED/NOT_FIRED —
 * not the spec illustration's single-key JSON form, since reconstructing
 * that form from `{op, args}` would need an operator-to-JSON-key mapping
 * this engine does not maintain anywhere (see `dsl/evaluate.ts`'s final
 * report note on operator argument shapes).
 */
export interface Evaluation {
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
}

/** `Result.scopeExclusions` entry (spec §5.3a) — one per rule whose `scope` excluded at least one line, recorded once per claim, never as a per-line `Evaluation`. */
export interface ScopeExclusion {
  readonly ruleId: string;
  readonly excludedLineIds: readonly string[];
}
