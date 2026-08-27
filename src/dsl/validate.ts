/**
 * U11 — dependency-free runtime schema validation at the engine's input
 * boundaries (spec §12.2).
 *
 * §12.2 names two boundaries that face input the engine did not produce:
 * (a) claim, options, and provider identity; (b) registry, contracts, and
 * data bundle at load. This unit's brief scopes it to exactly three of
 * those: **claim input, options, and registry shape**. Provider identity,
 * contracts, and the data bundle have no canonical type yet (U1 did not
 * define one, and the data bundle/contract units haven't landed), so this
 * file does not guess at their shape — see the final report for that gap.
 *
 * A violation throws `EngineError` (never a silent coercion), following the
 * same convention `src/adapters/instXml.ts` already established: a plain
 * object literal with `name: 'EngineError'`, not an `Error` subclass.
 *
 * No npm packages — the only imports are sibling `.ts` (type-only where
 * possible), which the spec explicitly says does not count against "adds
 * nothing to the consumer's dependencies" (§12.2: "not because of `file://`,
 * which `bundle.mjs` resolves by inlining").
 *
 * This file validates *shape* only — types, required fields, closed
 * vocabularies, and the one cross-cutting invariant each boundary can check
 * locally (duplicate `lineId`, duplicate rule `id`). It does not implement
 * §15.3's registry lint (band/epoch ordering, conflict-resolution
 * invariants, `dataRequired` cross-checks) — that is `tools/lint-registry.mjs`
 * (U18), a different, later unit operating on a fully-loaded registry.
 */

import type { ClaimInput, ClaimLineInput, EngineError, EngineErrorCode } from '../types.js';
import { operators, type JsonValue } from './operators.js';

// ---------------------------------------------------------------------------
// validate mode (§12.2)
// ---------------------------------------------------------------------------

/**
 * Governs the *optional* phase-output assertions layered between phases
 * (§12.2: "phase-output validation is an assertion, not a runtime
 * boundary"). It does **not** gate the two boundary validators below —
 * `validateClaimInput`, `validateOptions`, and `validateRegistryShape` run
 * unconditionally regardless of this mode, per §12.2's "both validated
 * unconditionally, in every mode." A caller wiring up phase transitions
 * elsewhere is expected to read this value to decide whether to also run
 * its own internal phase-output assertions; that wiring lives outside this
 * file (no phases are built yet).
 */
export type ValidateMode = 'inputs' | 'boundaries' | 'off';

export const DEFAULT_VALIDATE_MODE: ValidateMode = 'boundaries';

export function isValidateMode(v: unknown): v is ValidateMode {
  return v === 'inputs' || v === 'boundaries' || v === 'off';
}

// ---------------------------------------------------------------------------
// Error construction — same shape/convention as src/adapters/instXml.ts
// ---------------------------------------------------------------------------

function makeError(code: EngineErrorCode, path: string, detail: string, claimId: string | null): EngineError {
  return { name: 'EngineError', code, path, detail, claimId };
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// ---------------------------------------------------------------------------
// Generic guards, parameterized by the calling boundary's error code so one
// helper set serves claim/options/registry validation without duplicating
// the throw-shape logic three times.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface Ctx {
  readonly code: EngineErrorCode;
  readonly claimId: string | null;
}

function fail(ctx: Ctx, path: string, detail: string): never {
  throw makeError(ctx.code, path, detail, ctx.claimId);
}

function requireRecordAt(v: unknown, path: string, ctx: Ctx): Record<string, unknown> {
  if (!isRecord(v)) fail(ctx, path, `expected an object, got ${describeType(v)}`);
  return v;
}

function requireArrayAt(v: unknown, path: string, ctx: Ctx): unknown[] {
  if (!Array.isArray(v)) fail(ctx, path, `expected an array, got ${describeType(v)}`);
  return v;
}

function requireStringAt(rec: Record<string, unknown>, key: string, path: string, ctx: Ctx): string {
  const v = rec[key];
  if (typeof v !== 'string') fail(ctx, `${path}.${key}`, `expected a string, got ${describeType(v)}`);
  return v;
}

function optionalStringAt(rec: Record<string, unknown>, key: string, path: string, ctx: Ctx): string | undefined {
  const v = rec[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') fail(ctx, `${path}.${key}`, `expected a string, got ${describeType(v)}`);
  return v;
}

function requireStringArrayAt(rec: Record<string, unknown>, key: string, path: string, ctx: Ctx): string[] {
  const v = requireArrayAt(rec[key], `${path}.${key}`, ctx);
  return v.map((item, i) => {
    if (typeof item !== 'string') fail(ctx, `${path}.${key}[${i}]`, `expected a string, got ${describeType(item)}`);
    return item;
  });
}

/** Integer mils, per this codebase's "money is integer mils, no floats" discipline. */
function requireMilsAt(rec: Record<string, unknown>, key: string, path: string, ctx: Ctx): number {
  const v = rec[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
    fail(ctx, `${path}.${key}`, `expected an integer (mils), got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireIntegerAt(rec: Record<string, unknown>, key: string, path: string, ctx: Ctx): number {
  const v = rec[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
    fail(ctx, `${path}.${key}`, `expected an integer, got ${JSON.stringify(v)}`);
  }
  return v;
}

const DATE_OR_EMPTY_RE = /^\d{8}$/;

/** YYYYMMDD, or '' for the "not supplied" case a few date fields legitimately allow. */
function requireDateOrEmptyAt(rec: Record<string, unknown>, key: string, path: string, ctx: Ctx): string {
  const v = requireStringAt(rec, key, path, ctx);
  if (v !== '' && !DATE_OR_EMPTY_RE.test(v)) {
    fail(ctx, `${path}.${key}`, `expected YYYYMMDD or '', got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireDateAt(rec: Record<string, unknown>, key: string, path: string, ctx: Ctx): string {
  const v = requireStringAt(rec, key, path, ctx);
  if (!DATE_OR_EMPTY_RE.test(v)) {
    fail(ctx, `${path}.${key}`, `expected YYYYMMDD, got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireEnumAt<T extends string>(
  rec: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
  ctx: Ctx,
): T {
  const v = rec[key];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fail(ctx, `${path}.${key}`, `expected one of ${JSON.stringify(allowed)}, got ${JSON.stringify(v)}`);
  }
  return v as T;
}

// ===========================================================================
// (a) Claim input — spec §2.1, §5.1
// ===========================================================================

const UNIT_QUALIFIERS = ['DA', 'UN', ''] as const;
const LINE_ID_SCHEMES = ['feed', 'positional', 'mixed'] as const;

function validateClaimLine(v: unknown, path: string, ctx: Ctx): ClaimLineInput {
  const rec = requireRecordAt(v, path, ctx);
  const lineId = requireStringAt(rec, 'lineId', path, ctx);
  if (lineId === '') fail(ctx, `${path}.lineId`, 'lineId must not be empty');
  const procCode = requireStringAt(rec, 'procCode', path, ctx);
  const modifiers = requireStringArrayAt(rec, 'modifiers', path, ctx);
  const revCode = requireStringAt(rec, 'revCode', path, ctx);
  const units = requireStringAt(rec, 'units', path, ctx); // raw, unparsed — §5.1
  const unitQualifier = requireEnumAt(rec, 'unitQualifier', path, UNIT_QUALIFIERS, ctx);
  const chargeMils = requireMilsAt(rec, 'chargeMils', path, ctx);
  const fromDate = requireDateOrEmptyAt(rec, 'fromDate', path, ctx);
  const thruDate = requireDateOrEmptyAt(rec, 'thruDate', path, ctx);
  return { lineId, procCode, modifiers, revCode, units, unitQualifier, chargeMils, fromDate, thruDate };
}

function validateOccurrenceCode(v: unknown, path: string, ctx: Ctx): { code: string; date: string } {
  const rec = requireRecordAt(v, path, ctx);
  return { code: requireStringAt(rec, 'code', path, ctx), date: requireDateOrEmptyAt(rec, 'date', path, ctx) };
}

function validateValueCode(v: unknown, path: string, ctx: Ctx): { code: string; amountMils: number } {
  const rec = requireRecordAt(v, path, ctx);
  return { code: requireStringAt(rec, 'code', path, ctx), amountMils: requireMilsAt(rec, 'amountMils', path, ctx) };
}

/**
 * Validates a `ClaimInput` at the engine's input boundary. Throws
 * `EngineError` (`CLAIM_SCHEMA_INVALID` for shape violations,
 * `LINE_ID_NOT_UNIQUE` for the one cross-line invariant checkable here —
 * §19.14 / docs/BUILD_LOG.md decision D1) rather than coercing.
 *
 * `claimIdHint` is used only for the emitted `EngineError.claimId` when the
 * input's own `claimId` field can't be trusted yet (i.e. before this
 * function has confirmed it's even a string) — pass the caller's best
 * knowledge, or `null`.
 */
export function validateClaimInput(input: unknown, claimIdHint: string | null = null): ClaimInput {
  const ctx: Ctx = { code: 'CLAIM_SCHEMA_INVALID', claimId: claimIdHint };
  const rec = requireRecordAt(input, 'claim', ctx);

  const claimId = requireStringAt(rec, 'claimId', 'claim', ctx);
  // From here on, prefer the claim's own id in error reporting.
  const ctx2: Ctx = { code: 'CLAIM_SCHEMA_INVALID', claimId };

  const claimForm = requireStringAt(rec, 'claimForm', 'claim', ctx2);
  const typeOfBill = requireStringAt(rec, 'typeOfBill', 'claim', ctx2);
  // requireDateOrEmptyAt, not requireDateAt: a real institutional claim can
  // legitimately have no discharge date yet (single-day/still-admitted
  // stay) — src/adapters/instXml.ts's normalizeDate() already treats an
  // absent hosp_thru_date as '' rather than an error, and the committed
  // fixture test/fixtures/inst-xml-inpatient-cah-revonly.xml is exactly
  // this case (hosp_from_date present, no hosp_thru_date). The stricter
  // requireDateAt here rejected that fixture at this boundary before it
  // ever reached the §8.0 gate it exists to test — found while wiring
  // phases/adjudicate.ts's end-to-end test through the real adjudicate()
  // entry point (batch 2). statementFrom is left on the same helper as
  // statementThrough for the same reason and for symmetry with every
  // per-line date field, which already allows ''.
  const statementFrom = requireDateOrEmptyAt(rec, 'statementFrom', 'claim', ctx2);
  const statementThrough = requireDateOrEmptyAt(rec, 'statementThrough', 'claim', ctx2);
  const conditionCodes = requireStringArrayAt(rec, 'conditionCodes', 'claim', ctx2);

  const occurrenceCodesRaw = requireArrayAt(rec['occurrenceCodes'], 'claim.occurrenceCodes', ctx2);
  const occurrenceCodes = occurrenceCodesRaw.map((item, i) =>
    validateOccurrenceCode(item, `claim.occurrenceCodes[${i}]`, ctx2),
  );

  const valueCodesRaw = requireArrayAt(rec['valueCodes'], 'claim.valueCodes', ctx2);
  const valueCodes = valueCodesRaw.map((item, i) => validateValueCode(item, `claim.valueCodes[${i}]`, ctx2));

  const billingTaxonomy = requireStringAt(rec, 'billingTaxonomy', 'claim', ctx2);

  const payerRec = requireRecordAt(rec['payer'], 'claim.payer', ctx2);
  const payer = {
    id: requireStringAt(payerRec, 'id', 'claim.payer', ctx2),
    name: requireStringAt(payerRec, 'name', 'claim.payer', ctx2),
  };

  const diagnoses = requireStringArrayAt(rec, 'diagnoses', 'claim', ctx2);

  const linesRaw = requireArrayAt(rec['lines'], 'claim.lines', ctx2);
  if (linesRaw.length === 0) fail(ctx2, 'claim.lines', 'a claim must carry at least one line');
  const lines = linesRaw.map((item, i) => validateClaimLine(item, `claim.lines[${i}]`, ctx2));

  const seen = new Map<string, number>();
  lines.forEach((line, i) => {
    const firstIdx = seen.get(line.lineId);
    if (firstIdx !== undefined) {
      throw makeError(
        'LINE_ID_NOT_UNIQUE',
        `claim.lines[${i}].lineId`,
        `lineId ${JSON.stringify(line.lineId)} collides with claim.lines[${firstIdx}]`,
        claimId,
      );
    }
    seen.set(line.lineId, i);
  });

  const totalChargeMils = requireMilsAt(rec, 'totalChargeMils', 'claim', ctx2);
  const lineIdScheme = requireEnumAt(rec, 'lineIdScheme', 'claim', LINE_ID_SCHEMES, ctx2);

  return {
    claimId,
    claimForm,
    typeOfBill,
    statementFrom,
    statementThrough,
    conditionCodes,
    occurrenceCodes,
    valueCodes,
    billingTaxonomy,
    payer,
    diagnoses,
    lines,
    totalChargeMils,
    lineIdScheme,
  };
}

// ===========================================================================
// (b) Options — no canonical `EngineOptions` type exists yet anywhere in the
// codebase (U1 did not define one). This shape is this unit's own
// judgment call: the engine-run switches named elsewhere in the spec
// (`validate`, §12.2; `traceLevel`, §5.3a) plus the free-form "options row"
// (§13.2) that `optionIs`/`optionAtLeast`/`optionUnknown` read. Flagged in
// the final report as an assumption a later unit may need to reconcile.
// ===========================================================================

const TRACE_LEVELS = ['fired', 'standard', 'full'] as const;
export type TraceLevel = (typeof TRACE_LEVELS)[number];

export interface EngineOptionsInput {
  readonly validate: ValidateMode;
  readonly traceLevel: TraceLevel;
  readonly values: Readonly<Record<string, JsonValue>>;
}

function isJsonValue(v: unknown): v is JsonValue {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (isRecord(v)) return Object.values(v).every(isJsonValue);
  return false;
}

/**
 * Validates the engine-run options object. `undefined` (options omitted
 * entirely) is accepted and validates to the documented defaults.
 */
export function validateOptions(input: unknown, claimId: string | null = null): EngineOptionsInput {
  const ctx: Ctx = { code: 'OPTIONS_SCHEMA_INVALID', claimId };
  if (input === undefined) {
    return { validate: DEFAULT_VALIDATE_MODE, traceLevel: 'standard', values: {} };
  }
  const rec = requireRecordAt(input, 'options', ctx);

  const validateMode =
    rec['validate'] === undefined ? DEFAULT_VALIDATE_MODE : requireEnumAt(rec, 'validate', 'options', ['inputs', 'boundaries', 'off'], ctx);
  const traceLevel = rec['traceLevel'] === undefined ? 'standard' : requireEnumAt(rec, 'traceLevel', 'options', TRACE_LEVELS, ctx);

  const valuesRaw = rec['values'];
  let values: Readonly<Record<string, JsonValue>> = {};
  if (valuesRaw !== undefined) {
    const valuesRec = requireRecordAt(valuesRaw, 'options.values', ctx);
    for (const [key, v] of Object.entries(valuesRec)) {
      if (!isJsonValue(v)) fail(ctx, `options.values.${key}`, `expected a JSON-safe value, got ${describeType(v)}`);
    }
    values = valuesRec as Record<string, JsonValue>;
  }

  return { validate: validateMode, traceLevel, values };
}

// ===========================================================================
// (b) Registry shape — spec §4.2. Validates a flat list of rules (however
// the caller assembled it from the per-file registry JSON described in
// §2.6 — that assembly is a later unit's loader, not this file's concern).
// Shape only: field presence/type and the closed operator-name vocabulary
// (via `./operators.js`), plus the one cross-rule invariant checkable here
// (duplicate `id`). §15.3's full semantic lint is a separate tool.
// ===========================================================================

const PHASES = ['CLASSIFY', 'ADJUDICATE', 'BENCHMARK', 'CONTRACT'] as const;
const EPOCHS = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'E4'] as const;
const SCOPE_TARGETS = ['line', 'claim'] as const;

export interface RuleShape {
  readonly id: string;
  readonly version: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly phase: (typeof PHASES)[number];
  readonly band: number;
  readonly subBand: string | undefined;
  readonly order: number;
  readonly epoch: (typeof EPOCHS)[number];
  readonly scopeTarget: (typeof SCOPE_TARGETS)[number];
  readonly citation: string;
  readonly scope: Record<string, unknown>;
  readonly when: Record<string, unknown> | undefined;
  readonly then: readonly Record<string, unknown>[];
  readonly note: string | undefined;
  readonly dataRequired: boolean | undefined;
  readonly exclusive: boolean | undefined;
}

const REGISTRY_CODE: EngineErrorCode = 'REGISTRY_SCHEMA_INVALID';

/**
 * A `scope`/`when`/`then[]` entry in the hand-authored registry JSON is a
 * single-key object — `{"setStatus": {"status": "BUNDLED"}}` — not the
 * `{op, args}` node shape `dsl/operators.ts` uses internally.
 * `registry/loader.ts` unwraps one into the other; this validator checks the
 * JSON-authored form as a human actually writes it, envelope AND payload.
 *
 * §4.3.1's "bare payload for a single-dimension operator" convenience
 * (`{"siIn": ["Q4"]}`) is not implemented anywhere and is being removed from
 * the spec — every operator's `evaluate()`/`argSpec()` requires the
 * named-object form (`{"siIn": {"si": ["Q4"]}}`), and the batch-2 registry is
 * authored that way throughout. So the payload IS checked here, against the
 * named-object form only: once the envelope names a real operator with the
 * expected role, its payload is handed to that operator's own `argSpec()`
 * (spec §4.4 — a pure function of `args`, no side effects, no caller-supplied
 * callback) inside a try/catch. `argSpec()` narrows `args` with the same
 * runtime guards `evaluate()` uses and throws a plain `Error` on a malformed
 * shape (operators.ts file header) — that Error is caught here and
 * re-thrown as `REGISTRY_SCHEMA_INVALID`, so a bad payload (e.g. the bare
 * string in `{"setStatus": "BUNDLED"}`) fails at *load* time instead of
 * surfacing as a confusing evaluation-time fault somewhere unrelated.
 *
 * This deliberately does not re-encode any operator's argument shape here —
 * `argSpec()` is the one place that shape is defined (§4.4), and this
 * function only calls it. For `allOf`/`anyOf`/`not` and every ranking
 * operator's embedded `among`, `argSpec()` itself recurses through the
 * nested `{op, args}` predicate nodes via `operators.ts`'s own
 * `operatorRegistry` (see that file's "composite/relational recursion"
 * design note), so one call at this envelope's top level validates the
 * entire nested subtree — no separate recursion needed here.
 */
function requireSingleKeyOperatorNode(
  v: unknown,
  path: string,
  role: 'condition' | 'effect',
  claimId: string | null,
  ruleId: string,
): Record<string, unknown> {
  const ctx: Ctx = { code: REGISTRY_CODE, claimId };
  const rec = requireRecordAt(v, path, ctx);
  const keys = Object.keys(rec);
  if (keys.length !== 1) {
    fail(ctx, path, `expected a single-key object naming one operator, got ${keys.length} keys`);
  }
  const [opNameRaw] = keys;
  if (opNameRaw === undefined) {
    fail(ctx, path, 'expected a single-key object naming one operator, got an empty key');
  }
  const opName = opNameRaw;
  const op = operators[opName];
  if (op === undefined) {
    fail(ctx, path, `unknown operator "${opName}" — not in the closed set (dsl/operators.ts)`);
  }
  if (op.role !== role) {
    fail(ctx, path, `operator "${opName}" is ${op.role === 'effect' ? 'an effect' : 'a condition'}, expected ${role === 'effect' ? 'an effect' : 'a condition'}`);
  }
  try {
    op.argSpec(rec[opName]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(
      ctx,
      `${path}.${opName}`,
      `rule "${ruleId}": invalid arguments for operator "${opName}" (named-object form required — §4.3.1's bare-payload shorthand is not implemented): ${message}`,
    );
  }
  return rec;
}

function validateRule(v: unknown, path: string, claimId: string | null): RuleShape {
  const ctx: Ctx = { code: REGISTRY_CODE, claimId };
  const rec = requireRecordAt(v, path, ctx);

  const id = requireStringAt(rec, 'id', path, ctx);
  if (id === '') fail(ctx, `${path}.id`, 'rule id must not be empty');
  const version = requireStringAt(rec, 'version', path, ctx);
  const effectiveFrom = requireDateAt(rec, 'effectiveFrom', path, ctx);
  const effectiveToRaw = rec['effectiveTo'];
  const effectiveTo = effectiveToRaw === null ? null : requireDateAt(rec, 'effectiveTo', path, ctx);
  const phase = requireEnumAt(rec, 'phase', path, PHASES, ctx);
  const band = requireIntegerAt(rec, 'band', path, ctx);
  const subBand = optionalStringAt(rec, 'subBand', path, ctx);
  const order = requireIntegerAt(rec, 'order', path, ctx);
  const epoch = requireEnumAt(rec, 'epoch', path, EPOCHS, ctx);
  const scopeTarget = requireEnumAt(rec, 'scopeTarget', path, SCOPE_TARGETS, ctx);
  const citation = requireStringAt(rec, 'citation', path, ctx);

  const scope = requireSingleKeyOperatorNode(rec['scope'], `${path}.scope`, 'condition', claimId, id);
  const when = rec['when'] === undefined ? undefined : requireSingleKeyOperatorNode(rec['when'], `${path}.when`, 'condition', claimId, id);

  const thenRaw = requireArrayAt(rec['then'], `${path}.then`, ctx);
  if (thenRaw.length === 0) fail(ctx, `${path}.then`, 'a rule must declare at least one effect');
  const then = thenRaw.map((item, i) => requireSingleKeyOperatorNode(item, `${path}.then[${i}]`, 'effect', claimId, id));

  const note = optionalStringAt(rec, 'note', path, ctx);
  const dataRequiredRaw = rec['dataRequired'];
  if (dataRequiredRaw !== undefined && typeof dataRequiredRaw !== 'boolean') {
    fail(ctx, `${path}.dataRequired`, `expected a boolean, got ${describeType(dataRequiredRaw)}`);
  }
  const exclusiveRaw = rec['exclusive'];
  if (exclusiveRaw !== undefined && typeof exclusiveRaw !== 'boolean') {
    fail(ctx, `${path}.exclusive`, `expected a boolean, got ${describeType(exclusiveRaw)}`);
  }

  return {
    id,
    version,
    effectiveFrom,
    effectiveTo,
    phase,
    band,
    subBand,
    order,
    epoch,
    scopeTarget,
    citation,
    scope,
    when,
    then,
    note,
    dataRequired: dataRequiredRaw,
    exclusive: exclusiveRaw,
  };
}

/**
 * Validates a flat array of rule objects against the §4.2 shape. Throws
 * `REGISTRY_SCHEMA_INVALID` for a per-rule shape violation (including an
 * unrecognized operator name) and `REGISTRY_INVARIANT_VIOLATION` for a
 * duplicate `id` across the set.
 */
export function validateRegistryShape(input: unknown): readonly RuleShape[] {
  const ctx: Ctx = { code: REGISTRY_CODE, claimId: null };
  const rulesRaw = requireArrayAt(input, 'registry', ctx);
  const rules = rulesRaw.map((item, i) => validateRule(item, `registry[${i}]`, null));

  const seen = new Map<string, number>();
  rules.forEach((rule, i) => {
    const firstIdx = seen.get(rule.id);
    if (firstIdx !== undefined) {
      throw makeError(
        'REGISTRY_INVARIANT_VIOLATION',
        `registry[${i}].id`,
        `rule id ${JSON.stringify(rule.id)} collides with registry[${firstIdx}] — ids are stable public API and must be unique (§4.2)`,
        null,
      );
    }
    seen.set(rule.id, i);
  });

  return rules;
}
