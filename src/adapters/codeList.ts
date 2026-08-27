/**
 * U19a — code-list adapter (spec §8.0, §8.0.2, §10.4, §13.1, §13.2, §5.1).
 *
 * Turns a pasted string of procedure codes into a `ClaimInput` the engine
 * can adjudicate. This is the first unit whose output a non-programmer
 * reads directly (`tools/adjudicate.mjs`), so what this file does NOT know
 * matters as much as what it does.
 *
 * THE HARD PART. A bare code list carries no form type, no bill type, no
 * dates — nothing the §8.0 claim-level gate needs. Left alone, that gate
 * would reject every paste as `NOT_OPPS`, which makes the tool useless for
 * its stated purpose (a human typing codes and reading an adjudication).
 * This adapter therefore SYNTHESIZES a minimal in-scope outpatient claim:
 * institutional form, bill type `131`, one line per token. Per §10.4 ("the
 * engine never infers silently"), every synthesized field is surfaced as an
 * explicit `Flag` at `severity: 'assumption'` — `tools/adjudicate.mjs`
 * prints it above the results, so a reader can never mistake "I assumed
 * this is a 13X outpatient claim" for "this claim is a 13X outpatient
 * claim."
 *
 * DATE OF SERVICE. §2.4: "No clock access inside the engine." This adapter
 * is part of the CLI's input path, not the engine itself, but the same
 * discipline applies — it must not smuggle a clock in through the back
 * door. Absent an explicit date, the default is `DATA_VINTAGE_EFFECTIVE_DATE`
 * below (the loaded data's own vintage, not `Date.now()`), and that default
 * is stated as an assumption exactly like the synthesized form/bill type.
 *
 * ---------------------------------------------------------------------------
 * SYNTAX (mirrored in `tools/adjudicate.mjs --help` — keep the two in sync):
 *
 *   CODE[xUNITS][:MOD[:MOD...]]
 *
 * Tokens are separated by whitespace, commas, or newlines (any run of
 * these). `x` (case-insensitive) introduces a unit count; `:` introduces
 * one or more modifiers, each itself `:`-separated. Examples:
 *
 *   36415            one line, 1 unit, no modifiers
 *   G0378x8          1 line, 8 units
 *   59025x2:73       1 line, 2 units, modifier 73
 *   G0463 84112      two lines
 *
 * A token that does not fit `CODE`, `CODExUNITS`, `CODE:MOD...`, or
 * `CODExUNITS:MOD...` is rejected as malformed — never silently coerced,
 * same discipline as `src/adapters/instXml.ts`'s money/date parsing. A
 * token that DOES fit this shape but is not a real procedure code (e.g.
 * `X8`) is not this adapter's concern to judge; it passes through to
 * `phases/classify.ts`, which reports it `MALFORMED`/`INVALID` per §8.1
 * with a citation, same as any other bad code.
 * ---------------------------------------------------------------------------
 *
 * NOT SYNTHESIZED: `revCode` (left `''`), `billingTaxonomy` (left `''`),
 * `chargeMils` (left `0`). None of these affect the §8.0 gate or any
 * bundling/routing logic this engine build implements (no registry rule
 * ranks by `chargeMils`; see the final report), so they are not stated as
 * assumptions — stating a field that provably cannot change the answer
 * would just be noise. If a later unit adds charge-dependent logic (§11.3
 * contract terms, §10.1 percentage rules), this adapter's charge default
 * becomes assumption-worthy and should be flagged then, not now.
 */

import type { ClaimInput, ClaimLineInput, EngineError, EngineErrorCode, Flag } from '../types.js';

function makeError(code: EngineErrorCode, path: string, detail: string, claimId: string | null): EngineError {
  return { name: 'EngineError', code, path, detail, claimId };
}

/**
 * The loaded data vintage's effective date (§7.5: "one active vintage";
 * §2.4: no clock access). CY2026 is this build's one active vintage,
 * corroborated by every CLFS row's `effFrom` (`src/data/clfs.cy2026.ts`)
 * and every registry rule's `effectiveFrom` (`src/registry/*.json`), which
 * all carry `"20260101"` — there is no per-source variation to reconcile.
 * Hardcoded here (not derived from `DATA_VERSION`, whose per-source strings
 * like `"opps-cy2026-jan-addendum-b-2025-12-29"` name a *publication* date,
 * not the vintage's *effective* date) with this comment as the paper trail;
 * if a future vintage ships, this constant is the one line that changes.
 */
export const DATA_VINTAGE_EFFECTIVE_DATE = '20260101';

/** §8.0: OPPS applies to hospital outpatient bill type 13X. `131` is the plain, non-adjustment case. */
const SYNTHESIZED_BILL_TYPE = '131';

/** §8.0's `INSTITUTIONAL_FORMS` set (`phases/classify.ts`) accepts both; `ub04` is the current form. */
const SYNTHESIZED_CLAIM_FORM = 'ub04';

/** Printed by `tools/adjudicate.mjs --help` — the one place this syntax is documented for a human. */
export const CODE_LIST_SYNTAX =
  'CODE[xUNITS][:MOD[:MOD...]]  -  space/comma/newline separated.\n' +
  '  Examples: 36415   G0378x8   59025x2:73   G0463 84112';

const DATE_RE = /^\d{8}$/;

/**
 * `CODE`, `CODExUNITS`, `CODE:MOD[:MOD...]`, or `CODExUNITS:MOD[:MOD...]`.
 * The code group is non-greedy so `x`/`:` are read as separators first and
 * only folded back into the code if no valid split exists (e.g. a code that
 * itself contains no `x`/`:` matches whole, as every real HCPCS/CPT code
 * does).
 */
const TOKEN_RE = /^([A-Za-z0-9]+?)(?:[xX](\d+))?((?::[A-Za-z0-9]+)*)$/;

export interface ParseCodeListOptions {
  /** YYYYMMDD. Defaults to `DATA_VINTAGE_EFFECTIVE_DATE` — see that constant's doc comment. */
  readonly dos?: string;
  readonly claimId?: string;
}

export interface ParsedCodeListClaim {
  readonly claim: ClaimInput;
  /** Always non-empty: at minimum, the §10.4 assumption flag naming what was synthesized. */
  readonly flags: readonly Flag[];
}

function parseToken(raw: string, index: number, claimId: string, dos: string): ClaimLineInput {
  const match = TOKEN_RE.exec(raw);
  if (match === null) {
    throw makeError(
      'CLAIM_SCHEMA_INVALID',
      `input.token[${index}]`,
      `malformed token ${JSON.stringify(raw)} — expected CODE[xUNITS][:MOD[:MOD...]] (see --help)`,
      claimId,
    );
  }
  const codeRaw = match[1];
  const unitsRaw = match[2];
  const modsRaw = match[3];
  if (codeRaw === undefined || codeRaw === '') {
    // Unreachable given TOKEN_RE's leading group is `+?` (at least one
    // character) — kept as a defensive, total branch rather than a
    // non-null assertion (README rule: no `!` in src/).
    throw makeError('CLAIM_SCHEMA_INVALID', `input.token[${index}]`, `malformed token ${JSON.stringify(raw)} — no code found`, claimId);
  }

  const code = codeRaw.toUpperCase();
  const units = unitsRaw === undefined ? '1' : unitsRaw;
  const modifiers =
    modsRaw === undefined || modsRaw === ''
      ? []
      : modsRaw
          .split(':')
          .filter((m) => m !== '')
          .map((m) => m.toUpperCase());

  return {
    lineId: `idx:${index}`,
    procCode: code,
    modifiers,
    revCode: '',
    units,
    unitQualifier: '',
    chargeMils: 0,
    fromDate: dos,
    thruDate: dos,
  };
}

function buildAssumptionFlag(dos: string, dosWasExplicit: boolean): Flag {
  const dosClause = dosWasExplicit ? `date of service ${dos} (explicit)` : `date of service ${dos} (data vintage default)`;
  return {
    code: 'CODELIST.ASSUMED_CLAIM_SHAPE',
    severity: 'assumption',
    message: `institutional 13X outpatient claim (bill type ${SYNTHESIZED_BILL_TYPE}), one line per code token; ${dosClause}`,
    ruleId: null,
    citation: '§10.4, §13.2',
    lineIds: [],
  };
}

/**
 * Parses a pasted code list into a `ClaimInput` (see file header for
 * syntax). Throws `EngineError` — never anything else, never a crash — for
 * input that cannot be turned into a claim at all: empty/whitespace-only
 * input, a malformed token, or a malformed `options.dos`. A token that
 * parses but names an invalid/unknown code is NOT an error here; it reaches
 * `phases/classify.ts` normally and is reported per §8.1.
 */
export function parseCodeList(input: string, options: ParseCodeListOptions = {}): ParsedCodeListClaim {
  const claimId = options.claimId ?? 'code-list';
  const dosWasExplicit = options.dos !== undefined;
  const dos = options.dos ?? DATA_VINTAGE_EFFECTIVE_DATE;

  if (dosWasExplicit && !DATE_RE.test(dos)) {
    throw makeError('CLAIM_SCHEMA_INVALID', 'options.dos', `expected YYYYMMDD, got ${JSON.stringify(dos)}`, claimId);
  }

  const rawTokens = input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t !== '');

  if (rawTokens.length === 0) {
    throw makeError('CLAIM_SCHEMA_INVALID', 'input', 'no code tokens found — input was empty or whitespace-only', claimId);
  }

  const lines = rawTokens.map((raw, index) => parseToken(raw, index, claimId, dos));

  const claim: ClaimInput = {
    claimId,
    claimForm: SYNTHESIZED_CLAIM_FORM,
    typeOfBill: SYNTHESIZED_BILL_TYPE,
    statementFrom: dos,
    statementThrough: dos,
    conditionCodes: [],
    occurrenceCodes: [],
    valueCodes: [],
    billingTaxonomy: '',
    payer: { id: '', name: '' },
    diagnoses: [],
    lines,
    totalChargeMils: 0,
    lineIdScheme: 'positional',
  };

  return { claim, flags: [buildAssumptionFlag(dos, dosWasExplicit)] };
}
