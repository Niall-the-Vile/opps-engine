/**
 * U12 — Phase 1, CLASSIFY (spec §8.0, §8.0.1, §8.0.2, §8.1, §8.2, §8.3).
 *
 * Two jobs, strictly ordered:
 *
 *   1. §8.0's claim-level applicability gate — five conditions, evaluated
 *      before a single line is classified. A failing claim returns zero
 *      determinations and an `Applicability` naming the gate and (§8.0.2)
 *      the payment system it believes actually governs. This is a
 *      first-class result, not an `EngineError` (§8.0: "the claim is
 *      well-formed, it is simply not an OPPS claim").
 *   2. Per line (only reached when the gate passes): §8.0.1's rev-only
 *      case, §8.1's six shape patterns plus `INVALID`/`INVALID_HISTORICAL`,
 *      and §8.2's REJECTED/ROUTED split with §8.3's recode instruction.
 *
 * SCOPE NOTE. Unlike `dsl/evaluate.ts` (ADJUDICATE, phase 2), this phase is
 * NOT expressed through the registry DSL — it is a plain function, matching
 * every other procedural unit already built (the XML adapter, the data
 * generators). Nothing in the sections read for this batch (§2.2, §2.3,
 * §2.6's repo layout, §4.2's registry examples — all ADJUDICATE-phase)
 * requires CLASSIFY to be declarative, and building it procedurally kept
 * this unit tractable. A consequence: `ClassifiedLine`s carry no rule
 * `Evaluation`s of their own — `phases/adjudicate.ts` gives REJECTED/ROUTED
 * determinations an empty `trace`. See the final report.
 *
 * `DELETED` (§8.1) is deliberately NOT implemented here — it is one of the
 * reserved edit slots (U17, "Do not build" per the batch-2 build brief) and
 * stays unreachable in this batch, exactly like the NCCI/MUE slots.
 */

import type { ClaimInput, ClaimLineInput, Flag, Status } from '../types.js';
import { getHcpcsTermDate, isAfs, isDmepos, isMpfs, lookupClfs, lookupOpps } from '../data/index.js';
import { resolve as resolveRoute, type RouteResult } from '../routing.js';
import type { AdmittedLine } from '../dsl/evaluate.js';

// ===========================================================================
// §8.0 — claim-level applicability gate
// ===========================================================================

export type Gate = 'FORM_TYPE' | 'BILL_TYPE' | 'PROCEDURE_CODES' | 'INPATIENT_INDICATORS' | 'PROVIDER_TYPE';

export type LikelySystem =
  | 'HOSPICE'
  | 'IPPS'
  | 'CAH_COST'
  | 'ASC'
  | 'ESRD'
  | 'RHC_FQHC'
  | 'MPFS'
  | 'SNF'
  | 'HHA'
  | 'UNKNOWN';

export interface Applicability {
  readonly inScope: false;
  readonly gate: Gate;
  readonly likelySystem: LikelySystem;
  readonly confidence: 'strong' | 'probable' | 'unknown';
  readonly evidence: readonly string[];
  readonly detail: string;
}

/**
 * Institutional claim-form values this feed is known to use (§8.0's own
 * table: "Observed feed values include ub92"). Both committed fixtures use
 * `ub92` and one of them is expected IN scope (`outpatient-13x-hcpcs.xml`),
 * so `ub92` must pass this check alongside `ub04` — confirmed by the other
 * fixture (`inst-xml-inpatient-cah-revonly.xml`) failing on BILL_TYPE, not
 * FORM_TYPE, despite also carrying `claim_form="ub92"`.
 */
const INSTITUTIONAL_FORMS: ReadonlySet<string> = new Set(['ub04', 'ub92']);

function isInstitutionalForm(claimForm: string): boolean {
  return INSTITUTIONAL_FORMS.has(claimForm.trim().toLowerCase());
}

/**
 * The one Critical Access Hospital taxonomy this codebase has concrete
 * evidence for (the committed fixture's `bill_taxonomy="282NC0060X"`). No
 * NUCC taxonomy reference table exists anywhere in this repo's data (§3.3
 * has no accompanying file), so this is exact-code matching against a
 * known example, not a general 282N-subtype classifier. A real 282N**C**
 * (Critical Access Hospital) code not equal to this exact value would be
 * missed — flagged in the final report as a real, disclosed limitation.
 */
const KNOWN_CAH_TAXONOMIES: ReadonlySet<string> = new Set(['282NC0060X']);

function isCahTaxonomy(billingTaxonomy: string): boolean {
  return KNOWN_CAH_TAXONOMIES.has(billingTaxonomy.trim().toUpperCase());
}

const ROOM_AND_BOARD_REVENUE_RE = /^01[1-6]\d$/; // 011X-016X

function hasRoomAndBoardInpatientIndicators(claim: ClaimInput): boolean {
  const hasRoomAndBoard = claim.lines.some((l) => ROOM_AND_BOARD_REVENUE_RE.test(l.revCode));
  const hasCoveredDaysValueCode = claim.valueCodes.some((vc) => vc.code === '80');
  return hasRoomAndBoard && hasCoveredDaysValueCode;
}

interface GateFailure {
  readonly gate: Gate;
  readonly detail: string;
}

/**
 * §8.0's five conditions, tested in the table's own order. The FIRST
 * failing condition is the one reported — §8.0 names a single gate
 * ("a flag naming the gate", singular), not a list; §8.0.2's independent
 * signal table (below) is what surfaces multiple conflicting observations
 * when they exist, via `evidence[]`, regardless of which single gate name
 * is reported here.
 */
function evaluateGate(claim: ClaimInput): GateFailure | null {
  if (!isInstitutionalForm(claim.claimForm)) {
    return { gate: 'FORM_TYPE', detail: `claimForm ${JSON.stringify(claim.claimForm)} is not a recognized institutional claim form` };
  }

  // Textbook reading of the first two digits of typeOfBill, per §8.0's own
  // table. NOT yet confirmed against this feed's actual conventions
  // (§19.25) — see the FORM_TYPE-vs-BILL_TYPE note above and the final
  // report; marked here so it is not mistaken for verified.
  if (claim.typeOfBill.slice(0, 2) !== '13') {
    return {
      gate: 'BILL_TYPE',
      detail: `typeOfBill ${JSON.stringify(claim.typeOfBill)} does not begin "13" — OPPS applies to hospital outpatient bill type 13X`,
    };
  }

  if (claim.lines.every((l) => l.procCode.trim() === '')) {
    return { gate: 'PROCEDURE_CODES', detail: 'no line on this claim carries a HCPCS/CPT procedure code (§8.0.1)' };
  }

  if (hasRoomAndBoardInpatientIndicators(claim)) {
    return {
      gate: 'INPATIENT_INDICATORS',
      detail: 'room & board revenue codes (011X-016X) are present together with a covered-days value code (80) — an inpatient stay, not OPPS',
    };
  }

  // §3.3's full Tier-3 provider-type list was not read for this batch and
  // no taxonomy reference table exists on disk — CAH is the only concrete,
  // fixture-verified example implemented. See KNOWN_CAH_TAXONOMIES's note.
  if (isCahTaxonomy(claim.billingTaxonomy)) {
    return {
      gate: 'PROVIDER_TYPE',
      detail: `billingTaxonomy ${JSON.stringify(claim.billingTaxonomy)} is a Critical Access Hospital taxonomy — cost-based (§3.3), not OPPS`,
    };
  }

  return null;
}

// ===========================================================================
// §8.0.2 — likelySystem routing signals
// ===========================================================================

interface SignalMatch {
  readonly system: LikelySystem;
  readonly evidence: string;
}

/**
 * Every row of §8.0.2's signal table, tested independently and
 * unconditionally — deliberately NOT short-circuited by an earlier match,
 * even where the table's prose qualifies the room & board row with "and
 * bill type is unhelpful". The committed conflicting-signal fixture
 * requires all three of its signals (bill-type-range, room & board,
 * CAH taxonomy) to appear in `evidence` simultaneously; honoring "bill type
 * is unhelpful" literally would suppress the room & board signal whenever
 * bill type ALSO matched a specific row (as it does there: `81A` matches
 * the 81/82 row), which breaks that fixture. See the final report.
 */
function computeSignals(claim: ClaimInput): readonly SignalMatch[] {
  const matches: SignalMatch[] = [];
  const tob = claim.typeOfBill;
  const prefix2 = tob.slice(0, 2);

  if (prefix2 === '11' || prefix2 === '12') {
    matches.push({ system: 'IPPS', evidence: `typeOfBill ${JSON.stringify(tob)} begins "${prefix2}" (11/12 => IPPS)` });
  }
  if (prefix2 === '81' || prefix2 === '82') {
    matches.push({ system: 'HOSPICE', evidence: `typeOfBill ${JSON.stringify(tob)} begins "${prefix2}" (81/82 => HOSPICE)` });
  }
  if (prefix2 === '83') {
    matches.push({ system: 'ASC', evidence: `typeOfBill ${JSON.stringify(tob)} begins "83" (=> ASC)` });
  }
  if (prefix2 === '85') {
    matches.push({ system: 'CAH_COST', evidence: `typeOfBill ${JSON.stringify(tob)} begins "85" (=> CAH_COST)` });
  }
  if (isCahTaxonomy(claim.billingTaxonomy)) {
    matches.push({ system: 'CAH_COST', evidence: `billingTaxonomy ${JSON.stringify(claim.billingTaxonomy)} is a Critical Access Hospital taxonomy` });
  }
  if (prefix2 === '72') {
    matches.push({ system: 'ESRD', evidence: `typeOfBill ${JSON.stringify(tob)} begins "72" (=> ESRD)` });
  }
  if (prefix2 === '71' || prefix2 === '77') {
    matches.push({ system: 'RHC_FQHC', evidence: `typeOfBill ${JSON.stringify(tob)} begins "${prefix2}" (71/77 => RHC_FQHC)` });
  }
  if (prefix2 === '21' || prefix2 === '22' || prefix2 === '23') {
    matches.push({ system: 'SNF', evidence: `typeOfBill ${JSON.stringify(tob)} begins "${prefix2}" (21/22/23 => SNF)` });
  }
  if (prefix2 === '32' || prefix2 === '33' || prefix2 === '34') {
    matches.push({ system: 'HHA', evidence: `typeOfBill ${JSON.stringify(tob)} begins "${prefix2}" (32/33/34 => HHA)` });
  }
  if (!isInstitutionalForm(claim.claimForm)) {
    matches.push({ system: 'MPFS', evidence: `claimForm ${JSON.stringify(claim.claimForm)} is not an institutional form` });
  }
  if (hasRoomAndBoardInpatientIndicators(claim)) {
    matches.push({ system: 'IPPS', evidence: 'room & board revenue codes are present together with a covered-days value code (80)' });
  }

  return matches;
}

function computeApplicabilityFailure(failure: GateFailure, claim: ClaimInput): Applicability {
  const matches = computeSignals(claim);
  if (matches.length === 0) {
    return { inScope: false, gate: failure.gate, likelySystem: 'UNKNOWN', confidence: 'unknown', evidence: [], detail: failure.detail };
  }
  const first = matches[0];
  if (first === undefined) {
    return { inScope: false, gate: failure.gate, likelySystem: 'UNKNOWN', confidence: 'unknown', evidence: [], detail: failure.detail };
  }
  const distinctSystems = new Set(matches.map((m) => m.system));
  // Where signals conflict — more than one distinct system suggested — the
  // gate reports EVERY signal and drops confidence to 'probable' rather
  // than picking a winner (§8.0.2). `likelySystem` still needs one value
  // (LikelySystem has no "conflicted" member); the first-matched signal's
  // system is used, in the table's own testing order, with the lowered
  // confidence carrying the actual "do not trust this pick" signal.
  const confidence = distinctSystems.size > 1 ? 'probable' : 'strong';
  return {
    inScope: false,
    gate: failure.gate,
    likelySystem: first.system,
    confidence,
    evidence: matches.map((m) => m.evidence),
    detail: failure.detail,
  };
}

// ===========================================================================
// §8.1 — line shape classification
// ===========================================================================

const VALID_SHAPE_PATTERNS: readonly RegExp[] = [
  /^\d{5}$/, // CPT I
  /^[A-V]\d{4}$/, // HCPCS II (incl. D dental)
  /^\d{4}T$/, // CPT III
  /^\d{4}F$/, // CPT II (informational/non-payable)
  /^\d{4}U$/, // PLA
  /^\d{4}M$/, // MAA
];

function isValidShape(code: string): boolean {
  return VALID_SHAPE_PATTERNS.some((re) => re.test(code));
}

function stripNonPrintable(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x20 && cp !== 0x7f) out += ch;
  }
  return out;
}

interface NormalizedCode {
  readonly code: string;
  readonly peeledModifier: string | null;
}

const MODIFIER_CHAR_SHAPE = /^[A-Z0-9]{2}$/;

/**
 * Fix for the silent-alteration defect described in this unit's task: a
 * trailing 2-character pair used to be accepted as "the modifier" purely
 * because it was 2 alphanumeric characters — which every 2-character
 * substring of any byte is, virtually always. That made peeling
 * unconditional for any 7-character token with a valid 5-character prefix,
 * which is precisely the case §8.1 calls MALFORMED ("more than 5 characters
 * after normalization — stray modifier or concatenation").
 *
 * There is no CPT/HCPCS modifier reference table anywhere in this repo, so
 * this function CANNOT and does not attempt to validate that a pair is an
 * *assigned* modifier (e.g. confirm "59" is real and "61" is not) — that
 * would require a data file this repo does not have, and hard-coding a
 * partial list of "the modifiers I remember" would be worse than the bug
 * it replaces (an authoritative-looking guess). What it DOES check is a
 * single structural boundary of the modifier grammar that holds regardless
 * of vintage and needs no reference table: CPT Level I's numeric modifiers
 * start at 22 (AMA CPT Appendix 1) — there has never been a modifier "00"
 * through "19". A numeric trailing pair below that floor cannot be a real
 * modifier under any CPT/HCPCS revision, so it is rejected on shape alone,
 * not on a value lookup.
 *
 * This is a floor, not a validator. A shape-plausible pair that is not
 * actually assigned (an invented alpha pair, or a numeric pair in-range but
 * unassigned) still passes here and still peels — silent alteration for
 * that broader case is prevented separately, by the
 * OPPS.CLASSIFY.MODIFIER_PEELED disclosure flag `classifyLine` always
 * raises when a peel happens, not by this function pretending to know more
 * than it can.
 */
function looksLikeModifierShape(pair: string): boolean {
  if (!MODIFIER_CHAR_SHAPE.test(pair)) return false;
  if (/^\d{2}$/.test(pair) && Number(pair) < 20) return false;
  return true;
}

/**
 * §8.1 normalization: uppercase; strip whitespace, hyphens, non-printable
 * bytes; peel a trailing 2-character modifier into its own field. Does NOT
 * auto-pad a 4-digit token to 5 (ambiguous with a revenue code — flagged as
 * MALFORMED instead, never silently invented). The trailing pair must also
 * pass {@link looksLikeModifierShape} — see that function for why a shape
 * check, not a value lookup.
 */
function normalizeProcCode(raw: string): NormalizedCode {
  const stripped = stripNonPrintable(raw).toUpperCase().replace(/[\s-]/g, '');
  if (stripped.length === 7 && isValidShape(stripped.slice(0, 5)) && looksLikeModifierShape(stripped.slice(5))) {
    return { code: stripped.slice(0, 5), peeledModifier: stripped.slice(5) };
  }
  return { code: stripped, peeledModifier: null };
}

/**
 * Specific MALFORMED sub-reasons per §8.1. A bare 3-4 character code with
 * no literal decimal point (many real ICD-10-CM codes, e.g. "F418") is
 * indistinguishable from "too short"/"likely a revenue code" using only
 * what's derivable here — a disclosed limitation, not a guess (see final
 * report). The decimal-bearing ICD-10 shape ("E11.9") is unambiguous and
 * is detected.
 */
function malformedReason(code: string): string {
  if (/^\d{11}$/.test(code)) return 'NDC in the procedure field (11 digits)';
  if (code.includes('.') && /^[A-TV-Z]\d[\dA-Z]\.[\dA-Z]{1,4}$/.test(code)) return 'diagnosis (ICD-10) shape in the procedure field';
  if (/^\d{4}$/.test(code)) return 'likely a revenue code or a dropped leading zero';
  if (code.length >= 1 && code.length <= 3) return 'too short for a valid procedure code';
  if (code.length > 5) return 'more than 5 characters after normalization — stray modifier or concatenation';
  return 'fails all valid shape patterns (§8.1)';
}

// ===========================================================================
// §8.3 — recode recommendation for SI B
// ===========================================================================

/**
 * §8.3's highest-volume mapping. Office/outpatient E/M only. Emergency
 * department E/M (99281-99285) is deliberately absent — those are OPPS-
 * payable as billed, and are verified (against the loaded Addendum B data)
 * to carry SI J2, not B, so they never reach this map regardless.
 */
const RECODE_MAP: Readonly<Record<string, string>> = {
  '99202': 'G0463',
  '99203': 'G0463',
  '99204': 'G0463',
  '99205': 'G0463',
  '99211': 'G0463',
  '99212': 'G0463',
  '99213': 'G0463',
  '99214': 'G0463',
  '99215': 'G0463',
};

// ===========================================================================
// Per-line classification result
// ===========================================================================

export interface RejectedLine {
  readonly kind: 'REJECTED';
  readonly lineId: string;
  readonly code: string;
  readonly revCode: string;
  readonly chargeMils: number;
  readonly resolvedSI: string | null;
  readonly status: Status;
  readonly flags: readonly Flag[];
}

export interface RoutedLine {
  readonly kind: 'ROUTED';
  readonly lineId: string;
  readonly code: string;
  readonly revCode: string;
  readonly chargeMils: number;
  readonly resolvedSI: string;
  readonly route: RouteResult;
  readonly flags: readonly Flag[];
}

export interface AdmittedClassifiedLine {
  readonly kind: 'ADMITTED';
  readonly lineId: string;
  readonly resolvedSI: string;
  readonly admitted: AdmittedLine;
  readonly flags: readonly Flag[];
}

/**
 * A per-line runtime fault during classification — `phases/classify.ts`'s
 * own line-local fault containment (§12.8), mirroring what `dsl/
 * evaluate.ts` already does for phase 2. Without this, an unexpected
 * exception classifying one line would propagate out of `classify()` and
 * crash the whole claim rather than degrading that one line and continuing.
 */
export interface FaultedLine {
  readonly kind: 'FAULTED';
  readonly lineId: string;
  readonly detail: string;
}

export type ClassifiedLine = RejectedLine | RoutedLine | AdmittedClassifiedLine | FaultedLine;

export interface ClassifyResult {
  readonly applicability: Applicability | null;
  readonly lines: readonly ClassifiedLine[];
}

function parseUnits(raw: string, lineId: string, flags: Flag[]): number {
  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(n) || n < 0) {
    flags.push({
      code: 'OPPS.CLASSIFY.UNITS_UNPARSEABLE',
      severity: 'warning',
      message: `line ${lineId}: units ${JSON.stringify(raw)} did not parse as a non-negative number — defaulted to 1`,
      ruleId: null,
      citation: null,
      lineIds: [lineId],
    });
    return 1;
  }
  return Math.trunc(n);
}

function rejectedSI(line: ClaimLineInput, code: string, si: string, status: Status, flags: Flag[]): RejectedLine {
  return { kind: 'REJECTED', lineId: line.lineId, code, revCode: line.revCode, chargeMils: line.chargeMils, resolvedSI: si, status, flags };
}

function classifyLine(line: ClaimLineInput): ClassifiedLine {
  const flags: Flag[] = [];
  const rawProc = line.procCode.trim();

  if (rawProc === '') {
    // §8.0.1 — revenue-code-only line. Normal institutional billing, not an
    // error: the procedure field is legitimately empty and the revenue
    // code lives in its own field (do not confuse with §8.1's "4 digits ->
    // likely a revenue code" MALFORMED case, which is about a revenue code
    // appearing IN the procedure field).
    return {
      kind: 'REJECTED',
      lineId: line.lineId,
      code: '',
      revCode: line.revCode,
      chargeMils: line.chargeMils,
      resolvedSI: null,
      status: 'NO_PROCEDURE_CODE',
      flags,
    };
  }

  const { code, peeledModifier } = normalizeProcCode(rawProc);
  const modifiers = peeledModifier !== null ? [...line.modifiers, peeledModifier] : line.modifiers;

  // Disclosure for the silent-alteration defect: normalizeProcCode() just
  // reinterpreted the submitted token as two separate pieces of data (a
  // shorter code, plus a modifier that was not delimited in the input).
  // determination.line still echoes rawProc verbatim (D37) and this flag is
  // the ONLY place in the output that says the split happened at all — so
  // it fires every time a peel happens, independent of what the line goes
  // on to adjudicate as. Severity 'assumption', not 'info' or 'warning':
  // the engine is not reporting a fact about the data (info) or a recovered
  // parse problem (warning) — it made an interpretive choice about how to
  // read ambiguous submitted data, which is exactly what 'assumption' means
  // elsewhere in this manifest (see e.g. OPPS.EXEMPT.UNVERIFIED_POLICY).
  if (peeledModifier !== null) {
    flags.push({
      code: 'OPPS.CLASSIFY.MODIFIER_PEELED',
      severity: 'assumption',
      message: `line ${line.lineId}: submitted procedure token ${JSON.stringify(rawProc)} was split into code ${code} + modifier ${JSON.stringify(peeledModifier)} — no delimiter separated them in the input, and no modifier reference table is loaded to confirm ${JSON.stringify(peeledModifier)} is an assigned modifier; adjudication proceeds against ${code}`,
      ruleId: null,
      citation: '§8.1',
      lineIds: [line.lineId],
    });
  }

  if (!isValidShape(code)) {
    flags.push({
      code: 'OPPS.CLASSIFY.MALFORMED',
      severity: 'warning',
      message: `line ${line.lineId}: procedure code ${JSON.stringify(rawProc)} is malformed — ${malformedReason(code)}`,
      ruleId: null,
      citation: '§8.1',
      lineIds: [line.lineId],
    });
    return { kind: 'REJECTED', lineId: line.lineId, code, revCode: line.revCode, chargeMils: line.chargeMils, resolvedSI: null, status: 'MALFORMED', flags };
  }

  const oppsRecord = lookupOpps(code);
  // §8.1: "INVALID is tested against every loaded data set, not Addendum B
  // alone" — 17 payable CLFS codes are absent from Addendum B.
  const inAnyDataSet = oppsRecord !== undefined || lookupClfs(code, '') !== undefined || isDmepos(code) || isMpfs(code) || isAfs(code);

  if (!inAnyDataSet) {
    const termDate = getHcpcsTermDate(code);
    if (termDate !== undefined && termDate > line.fromDate) {
      flags.push({
        code: 'OPPS.CLASSIFY.INVALID_HISTORICAL',
        severity: 'info',
        message: `code ${code} is absent from current data but was still active on ${line.fromDate} (terminated ${termDate}) — valid when billed, not a coding error (§7.5.1)`,
        ruleId: null,
        citation: '§7.5.1',
        lineIds: [line.lineId],
      });
      return {
        kind: 'REJECTED',
        lineId: line.lineId,
        code,
        revCode: line.revCode,
        chargeMils: line.chargeMils,
        resolvedSI: null,
        status: 'INVALID_HISTORICAL',
        flags,
      };
    }
    flags.push({
      code: 'OPPS.CLASSIFY.INVALID',
      severity: 'warning',
      message: `code ${code} is absent from every loaded data set, with no evidence it ever existed`,
      ruleId: null,
      citation: '§8.1',
      lineIds: [line.lineId],
    });
    return { kind: 'REJECTED', lineId: line.lineId, code, revCode: line.revCode, chargeMils: line.chargeMils, resolvedSI: null, status: 'INVALID', flags };
  }

  if (oppsRecord === undefined) {
    // Valid shape, present in a Tier-1/2 data set but absent from Addendum
    // B — no SI to classify against §8.2's table (e.g. the 17 CLFS-only
    // 0614U-0630U codes named in §8.1). Treated as ROUTED with a synthetic
    // resolvedSI of 'A' so the shared routing.resolve() (§2.3) still does
    // the actual schedule resolution uniformly. This is a judgment call,
    // not a spec-stated rule — see the final report.
    flags.push({
      code: 'OPPS.CLASSIFY.CLFS_ONLY',
      severity: 'info',
      message: `code ${code} has no Addendum B row (no SI) but is present in CLFS or another Tier-1/2 data set — routed as if SI A`,
      ruleId: null,
      citation: '§8.1',
      lineIds: [line.lineId],
    });
    const route = resolveRoute(code, 'A');
    return { kind: 'ROUTED', lineId: line.lineId, code, revCode: line.revCode, chargeMils: line.chargeMils, resolvedSI: 'A', route, flags };
  }

  const si = oppsRecord.si;

  if (si === 'A' || si === 'Y') {
    const route = resolveRoute(code, si);
    return { kind: 'ROUTED', lineId: line.lineId, code, revCode: line.revCode, chargeMils: line.chargeMils, resolvedSI: si, route, flags };
  }

  if (si === 'B') {
    const altCode = RECODE_MAP[code];
    const message =
      altCode !== undefined
        ? `professional/MPFS code on a UB-04 — recode -> bill ${altCode} instead`
        : 'professional/MPFS code on a UB-04 — confirm the facility equivalent';
    flags.push({ code: 'OPPS.CLASSIFY.RECODE', severity: 'warning', message, ruleId: null, citation: '§8.3', lineIds: [line.lineId] });
    return rejectedSI(line, code, si, 'NOT_PAID_RECODE', flags);
  }
  if (si === 'C') return rejectedSI(line, code, si, 'NOT_PAID_INPT_ONLY', flags);
  if (si === 'E1' || si === 'E2') return rejectedSI(line, code, si, 'NOT_PAID', flags);
  if (si === 'M') return rejectedSI(line, code, si, 'NOT_PAID', flags);

  // Everything else is phase-2 (ADJUDICATE) eligible.
  const admitted: AdmittedLine = {
    lineId: line.lineId,
    code,
    resolvedSI: si,
    apc: oppsRecord.apc,
    schedule: null, // computed on demand by routing.resolve() when needed — never stored (§3.4/D12)
    modifiers,
    unitCount: parseUnits(line.units, line.lineId, flags),
    rateMils: oppsRecord.rateMils,
    weight: oppsRecord.weight,
    chargeMils: line.chargeMils,
    dos: line.fromDate,
  };
  return { kind: 'ADMITTED', lineId: line.lineId, resolvedSI: si, admitted, flags };
}

// ===========================================================================
// Entry point
// ===========================================================================

/** Phase 1 — CLASSIFY (§8). See file header for the two-stage structure. */
export function classify(claim: ClaimInput): ClassifyResult {
  const gateFailure = evaluateGate(claim);
  if (gateFailure !== null) {
    return { applicability: computeApplicabilityFailure(gateFailure, claim), lines: [] };
  }
  const lines: ClassifiedLine[] = claim.lines.map((line): ClassifiedLine => {
    try {
      return classifyLine(line);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { kind: 'FAULTED', lineId: line.lineId, detail };
    }
  });
  return { applicability: null, lines };
}
