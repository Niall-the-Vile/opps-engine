/**
 * U2b — institutional JSON feed adapter (spec §2.1, §5.1, §19.14; docs/M1.1;
 * §8.0, §8.0.1, §14).
 *
 * CURRENT institutional path. `docs/M1.1-input-contract.md` and this
 * repo's earlier commentary recorded that institutional claims arrive as
 * XML and only professional (CMS-1500 / 837P) claims arrive as JSON. That
 * was wrong: institutional claims arrive as JSON too (`formType: "837I"`,
 * `type_of_bill`, `claim_form: "ub92"`, lines in a `charge[]` array,
 * flat-plus-array — isomorphic to the XML feed's own shape, per M1.1's own
 * "reusable if the feed ever emits institutional JSON" note on its mapping
 * table), and per the maintainer JSON has superseded XML on the live feed.
 * `src/adapters/instXml.ts` is the legacy path — kept working, not deleted
 * (see that file's own header) — because there is real committed fixture
 * value in its three-conflicting-signals §8.0.2 case, not because new
 * institutional claims still arrive that way.
 *
 * PHI stops here, same as the XML sibling: only the fields this file
 * actually reads (grep for `field(rec,` / `scanIndexedField(` /
 * `scanOccurrenceCodes(` / `scanValueCodes(` below) ever leave the raw
 * JSON object. There is no single combined allow-list constant — the
 * allow-list IS the set of call sites, so a field this file never names is
 * structurally unreachable, not merely unmentioned. Everything else —
 * every `pat_*`, `ins_*`, `mrn`, `pcn`, every provider/facility/billing
 * identifier, every remote file/batch/claim id, `narrative` — is never
 * touched by this file. A field the feed starts sending tomorrow is
 * dropped by construction, not by a maintained exclusion list: see
 * `test/instJson.test.ts`'s PHI probe, which plants sentinel values in
 * fields this adapter has never even seen and asserts none reach the
 * output.
 *
 * MEASURED, NOT ASSUMED (n=1 institutional sample; the other two real
 * samples available are 837P/professional, not institutional — see final
 * report):
 *
 *   - `hosp_from_date` was present but EMPTY; `hosp_thru_date` was ABSENT
 *     entirely; `fdos`/`ldos` carried the real statement dates. §13.2's
 *     "claim-level dates may legitimately be empty" note is not license to
 *     guess here — see `resolveStatementDate()` below for the precedence
 *     chain and its always-emitted source flag.
 *   - Zero `cond_code_*` keys existed in the object at all (not even
 *     empty-string ones) — absent from the payload, not "the claim has
 *     none". §8.0's gate and several rules read `conditionCodes`; treating
 *     silence as "no condition codes" would be a guess dressed as a fact.
 *     `occurrenceCodes`/`valueCodes` get the identical absent-vs-empty
 *     treatment even though, on the one real sample, their keys *were*
 *     present (all with empty values) — see `scanIndexedField()`.
 *   - Modifiers are `mod1`/`mod2` (no underscore), and there are only two,
 *     where UB-04 permits four. A third key matching `mod<N>` is flagged,
 *     never silently dropped.
 *   - `claim_form` (`"ub92"`) and `formType` (`"837I"`) are independent
 *     fields that can, in principle, disagree about institutional-ness.
 *     `claimForm` is read from `claim_form` (same as the XML sibling,
 *     whose value the §8.0 gate's `INSTITUTIONAL_FORMS` set already
 *     accepts); `formType` is read only to cross-check, never to override.
 *
 * No adjudication, no §8.0 gate, no data tables — same scope discipline as
 * the XML sibling. The adapter reports what the feed says; it does not
 * judge scope.
 */

import type { ClaimInput, ClaimLineInput, EngineError, EngineErrorCode, Flag, FlagSeverity } from '../types.js';

export interface ParseInstJsonOptions {
  /**
   * Caller-supplied correlation id per claim (indexed to appearance order:
   * one id per top-level claim object, or per array element when the input
   * is an array of claim objects). Preferred `claimId` source — same D7
   * discipline as the XML adapter.
   *
   * Deliberately does NOT fall back to `claimid`, `pcn`, `mrn`, or
   * `remote_claimid`, even though all four are present in the real feed and
   * even though one of them (`claimid`) reads as if it were made for this
   * exact purpose. `pcn` and `mrn` are unambiguously on the §14
   * forbidden-field list; `claimid`/`remote_claimid` are the feed's own
   * correlation ids, not ids this engine minted, and D7's reasoning (the
   * PHI boundary wins over convenience) applies to all four alike. See
   * docs/BUILD_LOG.md D7.
   */
  claimIds?: string[];
}

export interface ParsedInstClaim {
  claim: ClaimInput;
  /** Non-fatal findings from parsing this claim (statement-date source, absent-code disclosures, total-charge mismatch, etc). */
  flags: Flag[];
}

function makeError(code: EngineErrorCode, path: string, detail: string, claimId: string | null): EngineError {
  return { name: 'EngineError', code, path, detail, claimId };
}

function makeFlag(code: string, severity: FlagSeverity, message: string, lineIds: readonly string[] = []): Flag {
  return { code, severity, message, ruleId: null, citation: null, lineIds: [...lineIds] };
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Reads `rec[key]` only when it is a string. A wrong-typed or missing value both come back `undefined` -- never a crash, never a coercion. */
function field(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === 'string' ? v : undefined;
}

function hasOwn(rec: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(rec, key);
}

// ---------------------------------------------------------------------------
// Date / money parsing -- duplicated from instXml.ts rather than imported.
// That file exports neither helper (both are file-local there), and this
// repo's own convention (see types.ts's header on JsonValue) is to
// duplicate a small self-contained helper across independent adapters
// rather than couple two otherwise-unrelated adapters for a few lines of
// logic.
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` -> `YYYYMMDD`. An absent value is not an error (returns '').
 * A present but unparseable value is a flag, not a guess -- the original
 * raw string is preserved rather than discarded or coerced.
 */
function normalizeDate(raw: string | undefined, path: string, flags: Flag[]): string {
  if (raw === undefined || raw === '') return '';
  const m = DATE_RE.exec(raw);
  if (m === null) {
    flags.push(makeFlag('INST_JSON.DATE_UNPARSEABLE', 'warning', `unparseable date at ${path}: ${JSON.stringify(raw)}`));
    return raw;
  }
  const y = m[1];
  const mo = m[2];
  const d = m[3];
  if (y === undefined || mo === undefined || d === undefined) return raw;
  return `${y}${mo}${d}`;
}

/**
 * Plain decimal dollars -> integer mils (1/1000 dollar), e.g. "758.00" ->
 * 758000. Rejects non-numeric/NaN input by throwing rather than coercing
 * (spec §7.1 discipline, same as the XML sibling's parseMoneyMils).
 */
function parseMoneyMils(raw: string | undefined, path: string, claimId: string): number {
  if (raw === undefined) {
    throw makeError('CLAIM_SCHEMA_INVALID', path, 'missing required money value', claimId);
  }
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d{1,3})?$/.test(trimmed)) {
    throw makeError('CLAIM_SCHEMA_INVALID', path, `not a valid decimal money value: ${JSON.stringify(raw)}`, claimId);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split('.');
  const wholePart = parts[0] ?? '0';
  const fracPart = ((parts[1] ?? '') + '000').slice(0, 3);
  const mils = Number(wholePart) * 1000 + Number(fracPart);
  if (!Number.isFinite(mils)) {
    throw makeError('CLAIM_SCHEMA_INVALID', path, `money value did not parse to a finite number: ${JSON.stringify(raw)}`, claimId);
  }
  return negative ? -mils : mils;
}

// ---------------------------------------------------------------------------
// Indexed-field scanning (cond_code_1..N, occ_code_1..N, diag_1..N,
// value_code_1..N).
//
// The XML adapter's collectIndexed() stops at the first missing index --
// correct for that feed's variable-length attribute convention. The JSON
// feed measured here does NOT share that convention: value_code_1..12 and
// occ_code_1..8 are present as keys on every claim, holding "" when
// unpopulated, rather than being omitted past the last populated slot.
// Stopping at the first "missing" index would therefore stop at index 1 on
// a claim whose codes happen to start at, say, index 3 -- silently
// dropping real data. This scanner instead checks every slot up to a
// generous bound and records whether ANY slot-key existed at all
// (anyKeyPresent), independent of whether its value was populated -- that
// distinction is exactly what feeds the absent-vs-empty disclosure flags
// below.
//
// The bound (40) comfortably covers every indexed field observed
// (diag_1..12, value_code_1..12, occ_code_1..8) with headroom; it is not a
// guess at the feed's true maximum, just a safety bound so a malformed or
// adversarial object can't force an unbounded scan.
// ---------------------------------------------------------------------------

const MAX_INDEXED_SLOTS = 40;

interface IndexedScan {
  /** Non-empty, trimmed values, in index order. */
  readonly values: string[];
  /** True if `${prefix}${n}` existed as a key for at least one n, regardless of whether its value was populated. */
  readonly anyKeyPresent: boolean;
}

function scanIndexedField(rec: Record<string, unknown>, prefix: string): IndexedScan {
  const values: string[] = [];
  let anyKeyPresent = false;
  for (let i = 1; i <= MAX_INDEXED_SLOTS; i++) {
    const key = `${prefix}${i}`;
    if (!hasOwn(rec, key)) continue;
    anyKeyPresent = true;
    const raw = field(rec, key);
    if (raw !== undefined && raw.trim() !== '') values.push(raw.trim());
  }
  return { values, anyKeyPresent };
}

function scanDiagnoses(rec: Record<string, unknown>): string[] {
  const scan = scanIndexedField(rec, 'diag_');
  const diagnoses = [...scan.values];
  const admit = field(rec, 'admit_diag');
  if (admit !== undefined && admit.trim() !== '') diagnoses.push(admit.trim());
  return diagnoses;
}

function scanOccurrenceCodes(
  rec: Record<string, unknown>,
  flags: Flag[],
): { codes: { code: string; date: string }[]; anyKeyPresent: boolean } {
  const codes: { code: string; date: string }[] = [];
  let anyKeyPresent = false;
  for (let i = 1; i <= MAX_INDEXED_SLOTS; i++) {
    const codeKey = `occ_code_${i}`;
    if (!hasOwn(rec, codeKey)) continue;
    anyKeyPresent = true;
    const codeRaw = field(rec, codeKey);
    const code = codeRaw !== undefined ? codeRaw.trim() : '';
    if (code === '') continue;
    const date = normalizeDate(field(rec, `occ_date_${i}_date`), `occurrenceCodes[${i - 1}]@occ_date_${i}_date`, flags);
    codes.push({ code, date });
  }
  return { codes, anyKeyPresent };
}

function scanValueCodes(
  rec: Record<string, unknown>,
  claimId: string,
  pathPrefix: string,
): { codes: { code: string; amountMils: number }[]; anyKeyPresent: boolean } {
  const codes: { code: string; amountMils: number }[] = [];
  let anyKeyPresent = false;
  for (let i = 1; i <= MAX_INDEXED_SLOTS; i++) {
    const codeKey = `value_code_${i}`;
    if (!hasOwn(rec, codeKey)) continue;
    anyKeyPresent = true;
    const codeRaw = field(rec, codeKey);
    const code = codeRaw !== undefined ? codeRaw.trim() : '';
    if (code === '') continue;
    const amountMils = parseMoneyMils(field(rec, `value_amt_${i}`), `${pathPrefix}@value_amt_${i}`, claimId);
    codes.push({ code, amountMils });
  }
  return { codes, anyKeyPresent };
}

// ---------------------------------------------------------------------------
// Statement-date precedence chain (maintainer instruction: "flag", not
// "assume"). Tiers, in precedence order:
//
//   1. hosp_from_date / hosp_thru_date  -- the "proper" UB-04 fields
//   2. fdos / ldos                      -- the fields that actually carried
//                                          real dates on the one measured
//                                          sample, because tier 1 was empty
//                                          (from) or absent (thru)
//   3. min/max of the claim's own lines' from_date/thru_date
//
// A tier only counts as "available" when its value is present AND
// non-empty AND parses as a date (an unparseable value already raised
// INST_JSON.DATE_UNPARSEABLE via normalizeDate and is excluded here rather
// than silently winning the chain). The first available tier wins; every
// available tier is compared against every other, and a mismatch raises a
// distinct, separate flag -- the winning tier is still used, since
// refusing the whole claim over a soft-source disagreement would be worse
// than adjudicating with a disclosed uncertainty.
// ---------------------------------------------------------------------------

interface DateCandidate {
  readonly source: string;
  readonly value: string;
}

/**
 * Resolves one statement-date field (`statementFrom` or `statementThrough`)
 * from its three candidate tiers, in precedence order. Always pushes a
 * source flag (`severity: 'gap'` when NO tier had a usable value --
 * building a dateless claim silently is exactly the failure mode this
 * adapter exists to prevent -- otherwise `'info'`), and pushes a distinct
 * `severity: 'warning'` disagreement flag when two or more available tiers
 * disagree on the date.
 */
function resolveStatementDate(
  fieldName: 'statementFrom' | 'statementThrough',
  tiers: readonly DateCandidate[],
  flags: Flag[],
): string {
  const available = tiers.filter((t) => t.value !== '');
  const sourceCode = fieldName === 'statementFrom' ? 'INST_JSON.STATEMENT_FROM_SOURCE' : 'INST_JSON.STATEMENT_THROUGH_SOURCE';
  const disagreementCode =
    fieldName === 'statementFrom' ? 'INST_JSON.STATEMENT_FROM_DISAGREEMENT' : 'INST_JSON.STATEMENT_THROUGH_DISAGREEMENT';

  const [chosen] = available;
  if (chosen === undefined) {
    const tierNames = tiers.map((t) => t.source).join(', ');
    flags.push(makeFlag(sourceCode, 'gap', `${fieldName}: none of ${tierNames} supplied a usable date`));
    return '';
  }

  flags.push(makeFlag(sourceCode, 'info', `${fieldName} taken from ${chosen.source} (${chosen.value})`));

  const distinctValues = new Set(available.map((t) => t.value));
  if (distinctValues.size > 1) {
    const detail = available.map((t) => `${t.source}=${t.value}`).join(', ');
    flags.push(makeFlag(disagreementCode, 'warning', `${fieldName}: available sources disagree (${detail}); used ${chosen.source}`));
  }

  return chosen.value;
}

function minString(values: readonly string[]): string {
  const [first, ...rest] = values;
  if (first === undefined) return '';
  let min = first;
  for (const v of rest) if (v < min) min = v;
  return min;
}

function maxString(values: readonly string[]): string {
  const [first, ...rest] = values;
  if (first === undefined) return '';
  let max = first;
  for (const v of rest) if (v > max) max = v;
  return max;
}

// ---------------------------------------------------------------------------
// Lines (charge[]).
// ---------------------------------------------------------------------------

interface NormalizedLineDates {
  readonly ownFrom: string;
  readonly ownThru: string;
}

/** Normalizes each charge entry's own from_date/thru_date exactly once, up front -- both the tier-3 claim-date scan and the final per-line fallback read from this array, so an unparseable line date is flagged once, not twice. */
function normalizeLineDates(chargeItems: readonly unknown[], pathPrefix: string, flags: Flag[]): NormalizedLineDates[] {
  return chargeItems.map((item, index) => {
    const rec = isRecord(item) ? item : {};
    const ownFrom = normalizeDate(field(rec, 'from_date'), `${pathPrefix}.charge[${index}]@from_date`, flags);
    const ownThru = normalizeDate(field(rec, 'thru_date'), `${pathPrefix}.charge[${index}]@thru_date`, flags);
    return { ownFrom, ownThru };
  });
}

const KNOWN_MODIFIER_KEYS: ReadonlySet<string> = new Set(['mod1', 'mod2']);
const MODIFIER_KEY_RE = /^mod\d+$/;

/**
 * Flags a line whose raw object carries a modifier key beyond the known
 * mod1/mod2 convention (e.g. a future mod3) instead of silently ignoring
 * it. UB-04 permits four modifiers; this feed, as measured, carries only
 * two -- a third key is new information, not noise.
 */
function flagThirdModifierConvention(rec: Record<string, unknown>, lineId: string, flags: Flag[]): void {
  for (const key of Object.keys(rec)) {
    if (!MODIFIER_KEY_RE.test(key) || KNOWN_MODIFIER_KEYS.has(key)) continue;
    const value = field(rec, key);
    if (value !== undefined && value.trim() !== '') {
      flags.push(
        makeFlag(
          'INST_JSON.THIRD_MODIFIER_CONVENTION',
          'warning',
          `line carries modifier key ${JSON.stringify(key)} beyond the known mod1/mod2 convention`,
          [lineId],
        ),
      );
    }
  }
}

/**
 * §19.14 line identity: `remote_chgid` (trimmed) when non-empty and unique
 * across the claim, else `idx:<n>`. Never `chgid` -- the professional
 * samples carry both `chgid` and `remote_chgid`; `chgid` is what
 * `jsonClaimSource`-style readers use and is exactly the wrong-field
 * mistake M1.1's XML adapter work already found once (finding #2). Two
 * lines resolving to the same non-empty `remote_chgid` is refused outright,
 * same as the XML sibling -- a wrong `bundledUnder` target is worse than a
 * rejected claim.
 */
function buildLines(
  chargeItems: readonly unknown[],
  lineDates: readonly NormalizedLineDates[],
  claimFromDate: string,
  claimThruDate: string,
  claimId: string,
  pathPrefix: string,
  flags: Flag[],
): { lines: ClaimLineInput[]; lineIdScheme: 'feed' | 'positional' | 'mixed' } {
  const chargeRecs = chargeItems.map((item) => (isRecord(item) ? item : {}));
  const rawIds = chargeRecs.map((rec) => (field(rec, 'remote_chgid') ?? '').trim());

  const counts = new Map<string, number>();
  for (const id of rawIds) {
    if (id !== '') counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (let i = 0; i < rawIds.length; i++) {
    const idI = rawIds[i];
    if (idI === undefined || idI === '') continue;
    if ((counts.get(idI) ?? 0) > 1) {
      const otherIndex = rawIds.findIndex((id, j) => j !== i && id === idI);
      throw makeError(
        'LINE_ID_NOT_UNIQUE',
        `${pathPrefix}.charge[${i}],${pathPrefix}.charge[${otherIndex}]`,
        `duplicate remote_chgid ${JSON.stringify(idI)}`,
        claimId,
      );
    }
  }

  let sawFeed = false;
  let sawPositional = false;
  const lines: ClaimLineInput[] = chargeRecs.map((rec, index) => {
    const rawId = rawIds[index] ?? '';
    let lineId: string;
    if (rawId !== '') {
      lineId = rawId;
      sawFeed = true;
    } else {
      lineId = `idx:${index}`;
      sawPositional = true;
    }

    flagThirdModifierConvention(rec, lineId, flags);

    const mod1 = field(rec, 'mod1');
    const mod2 = field(rec, 'mod2');
    const modifiers = [mod1, mod2]
      .filter((m): m is string => m !== undefined)
      .map((m) => m.trim())
      .filter((m) => m !== '');

    const ownDates = lineDates[index];
    const fromDate = ownDates !== undefined && ownDates.ownFrom !== '' ? ownDates.ownFrom : claimFromDate;
    const thruDate = ownDates !== undefined && ownDates.ownThru !== '' ? ownDates.ownThru : claimThruDate;

    return {
      lineId,
      procCode: field(rec, 'proc_code') ?? '',
      modifiers,
      revCode: field(rec, 'rev_code') ?? '',
      units: field(rec, 'units') ?? '',
      // No JSON equivalent of the XML feed's charge_record_type (DA/UN
      // unit-of-measure) has been observed -- `proc_qual` is a HCPCS
      // procedure-code qualifier ("HC"), a different field entirely, not a
      // unit qualifier. Left '' ("unknown"), same as codeList.ts's
      // synthesized lines, rather than guessed from an unrelated field.
      unitQualifier: '',
      chargeMils: parseMoneyMils(field(rec, 'charge'), `${pathPrefix}.charge[${index}]@charge`, claimId),
      fromDate,
      thruDate,
    };
  });

  const lineIdScheme: 'feed' | 'positional' | 'mixed' =
    sawFeed && sawPositional ? 'mixed' : sawFeed ? 'feed' : 'positional';

  return { lines, lineIdScheme };
}

// ---------------------------------------------------------------------------
// Claim form / formType cross-check.
// ---------------------------------------------------------------------------

/** Same set §8.0's `INSTITUTIONAL_FORMS` (phases/classify.ts) accepts; duplicated locally rather than imported so this adapter stays self-contained (it does not otherwise depend on the CLASSIFY phase). */
const INSTITUTIONAL_CLAIM_FORMS: ReadonlySet<string> = new Set(['ub04', 'ub92']);

function isInstitutionalClaimForm(claimForm: string): boolean {
  return INSTITUTIONAL_CLAIM_FORMS.has(claimForm.trim().toLowerCase());
}

function isInstitutionalFormType(formType: string): boolean {
  return formType.trim().toUpperCase() === '837I';
}

// ---------------------------------------------------------------------------
// One claim.
// ---------------------------------------------------------------------------

function parseClaim(rec: Record<string, unknown>, claimIndex: number, options: ParseInstJsonOptions): ParsedInstClaim {
  const flags: Flag[] = [];
  const pathPrefix = `claims[${claimIndex}]`;

  const claimId = options.claimIds?.[claimIndex] ?? `idx:${claimIndex}`;

  const claimForm = field(rec, 'claim_form') ?? '';
  const typeOfBill = field(rec, 'type_of_bill') ?? '';

  const formTypeRaw = field(rec, 'formType');
  if (formTypeRaw !== undefined && formTypeRaw.trim() !== '') {
    if (isInstitutionalClaimForm(claimForm) !== isInstitutionalFormType(formTypeRaw)) {
      flags.push(
        makeFlag(
          'INST_JSON.FORM_TYPE_DISAGREEMENT',
          'warning',
          `claim_form ${JSON.stringify(claimForm)} and formType ${JSON.stringify(formTypeRaw)} disagree about whether this is an institutional claim`,
        ),
      );
    }
  }

  const chargeRaw = rec['charge'];
  if (!Array.isArray(chargeRaw)) {
    throw makeError('CLAIM_SCHEMA_INVALID', `${pathPrefix}.charge`, `expected an array, got ${describeType(chargeRaw)}`, claimId);
  }
  if (chargeRaw.length === 0) {
    throw makeError('CLAIM_SCHEMA_INVALID', `${pathPrefix}.charge`, 'a claim must carry at least one line', claimId);
  }

  const lineDates = normalizeLineDates(chargeRaw, pathPrefix, flags);

  const hospFrom = normalizeDate(field(rec, 'hosp_from_date'), `${pathPrefix}@hosp_from_date`, flags);
  const hospThru = normalizeDate(field(rec, 'hosp_thru_date'), `${pathPrefix}@hosp_thru_date`, flags);
  const fdos = normalizeDate(field(rec, 'fdos'), `${pathPrefix}@fdos`, flags);
  const ldos = normalizeDate(field(rec, 'ldos'), `${pathPrefix}@ldos`, flags);
  const lineMinFrom = minString(lineDates.map((d) => d.ownFrom).filter((v) => v !== ''));
  const lineMaxThru = maxString(lineDates.map((d) => d.ownThru).filter((v) => v !== ''));

  const statementFrom = resolveStatementDate(
    'statementFrom',
    [
      { source: 'hosp_from_date', value: hospFrom },
      { source: 'fdos', value: fdos },
      { source: "min(lines' from_date)", value: lineMinFrom },
    ],
    flags,
  );
  const statementThrough = resolveStatementDate(
    'statementThrough',
    [
      { source: 'hosp_thru_date', value: hospThru },
      { source: 'ldos', value: ldos },
      { source: "max(lines' thru_date)", value: lineMaxThru },
    ],
    flags,
  );

  const conditionScan = scanIndexedField(rec, 'cond_code_');
  if (!conditionScan.anyKeyPresent) {
    flags.push(
      makeFlag(
        'INST_JSON.CONDITION_CODES_NOT_PRESENT',
        'gap',
        'no cond_code_* key was present in the payload -- absent from the feed, not confirmed as "this claim has no condition codes"; read the §8.0 gate and any condition-code rule with that caveat',
      ),
    );
  }
  const conditionCodes = conditionScan.values;

  const occurrenceScan = scanOccurrenceCodes(rec, flags);
  if (!occurrenceScan.anyKeyPresent) {
    flags.push(
      makeFlag(
        'INST_JSON.OCCURRENCE_CODES_NOT_PRESENT',
        'gap',
        'no occ_code_* key was present in the payload -- absent from the feed, not confirmed as "this claim has no occurrence codes"',
      ),
    );
  }
  const occurrenceCodes = occurrenceScan.codes;

  const valueScan = scanValueCodes(rec, claimId, pathPrefix);
  if (!valueScan.anyKeyPresent) {
    flags.push(
      makeFlag(
        'INST_JSON.VALUE_CODES_NOT_PRESENT',
        'gap',
        'no value_code_* key was present in the payload -- absent from the feed, not confirmed as "this claim has no value codes" (§8.0\'s covered-days check reads value code 80)',
      ),
    );
  }
  const valueCodes = valueScan.codes;

  const billingTaxonomy = field(rec, 'bill_taxonomy') ?? '';
  const payer = { id: field(rec, 'payerid') ?? '', name: field(rec, 'payer_name') ?? '' };
  const diagnoses = scanDiagnoses(rec);

  const { lines, lineIdScheme } = buildLines(chargeRaw, lineDates, statementFrom, statementThrough, claimId, pathPrefix, flags);

  const totalChargeMils = parseMoneyMils(field(rec, 'total_charge'), `${pathPrefix}@total_charge`, claimId);
  const sumChargeMils = lines.reduce((sum, line) => sum + line.chargeMils, 0);
  if (sumChargeMils !== totalChargeMils) {
    flags.push(
      makeFlag(
        'INST_JSON.TOTAL_CHARGE_MISMATCH',
        'warning',
        `line charges sum to ${sumChargeMils} mils but total_charge declares ${totalChargeMils} mils`,
        lines.map((l) => l.lineId),
      ),
    );
  }

  const claim: ClaimInput = {
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

  return { claim, flags };
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    // Only the parser's own message is surfaced -- never the raw input
    // text itself, which is exactly the object this file exists to keep
    // PHI-bearing fields out of.
    const message = err instanceof Error ? err.message : String(err);
    throw makeError('CLAIM_SCHEMA_INVALID', 'root', `input is not valid JSON: ${message}`, null);
  }
}

/**
 * Parses the institutional JSON feed into `ClaimInput`s. Accepts either a
 * raw JSON string or an already-parsed value (a single claim object, or an
 * array of claim objects for a batch). Throws `EngineError` (never
 * anything else) for malformed input -- unparseable JSON, a top-level value
 * that isn't a claim object or array of claim objects, or a claim missing
 * its required `charge` array.
 *
 * A per-line quirk that is normal institutional billing rather than a
 * defect -- most notably a line with no `proc_code` (§8.0.1: a
 * revenue-code-only line) -- is never an error here; it produces `''` for
 * that field, exactly like the XML sibling.
 */
export function parseInstitutionalJson(input: string | unknown, options: ParseInstJsonOptions = {}): ParsedInstClaim[] {
  const parsed = typeof input === 'string' ? parseJsonText(input) : input;

  let claimRecords: Record<string, unknown>[];
  if (Array.isArray(parsed)) {
    claimRecords = parsed.map((item, i) => {
      if (!isRecord(item)) {
        throw makeError('CLAIM_SCHEMA_INVALID', `claims[${i}]`, `expected a claim object, got ${describeType(item)}`, null);
      }
      return item;
    });
  } else if (isRecord(parsed)) {
    claimRecords = [parsed];
  } else {
    throw makeError('CLAIM_SCHEMA_INVALID', 'root', `expected a claim object or an array of claim objects, got ${describeType(parsed)}`, null);
  }

  if (claimRecords.length === 0) {
    throw makeError('CLAIM_SCHEMA_INVALID', 'root', 'no claim objects found', null);
  }

  return claimRecords.map((rec, i) => parseClaim(rec, i, options));
}
