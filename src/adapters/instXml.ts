/**
 * U2 — institutional XML feed adapter (spec §2.1, §5.1, §19.14; docs/M1.1).
 *
 * Institutional claims arrive as XML with attributes flat on `<claim>` and
 * repeating `<charge>` children — isomorphic to the JSON feed's flat-plus-
 * array shape, differently serialized. This is where PHI stops: only the
 * fields in the mapping table below are ever read.
 *
 * No adjudication, no §8.0 gate, no data tables. The adapter reports what
 * the feed says; it does not judge scope.
 */

import type { ClaimInput, ClaimLineInput, EngineError, EngineErrorCode, Flag } from '../types.js';
import { parseXml, type XmlElement } from './xmlMini.js';

export interface ParseInstXmlOptions {
  /**
   * Caller-supplied correlation id per claim (indexed to appearance order
   * under `<claims>`). Preferred claimId source per the mapping table.
   *
   * Deliberately does NOT fall back to the feed's `pcn` attribute even
   * though the mapping table lists it as an alternate source: `pcn` (patient
   * control number) is on the §14 forbidden-field list — "never carried
   * through" — and that instruction is stricter than the mapping table's
   * permissive "pcn or a supplied id" wording. Treated as a spec
   * contradiction; the PHI boundary wins. See docs/BUILD_LOG.md decision D7.
   */
  claimIds?: string[];
}

export interface ParsedInstClaim {
  claim: ClaimInput;
  /** Non-fatal findings from parsing this claim (e.g. total-charge mismatch, unparseable date). */
  flags: Flag[];
}

function makeError(code: EngineErrorCode, path: string, detail: string, claimId: string | null): EngineError {
  return { name: 'EngineError', code, path, detail, claimId };
}

/** Reads `attrs[prefix + 1]`, `attrs[prefix + 2]`, ... until the next index is absent. */
function collectIndexed(attrs: Record<string, string>, prefix: string): string[] {
  const result: string[] = [];
  for (let i = 1; ; i++) {
    const v = attrs[`${prefix}${i}`];
    if (v === undefined) break;
    result.push(v);
  }
  return result;
}

function collectDiagnoses(attrs: Record<string, string>): string[] {
  const diagnoses = collectIndexed(attrs, 'diag_');
  const admit = attrs['admit_diag'];
  if (admit !== undefined && admit !== '') diagnoses.push(admit);
  return diagnoses;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` -> `YYYYMMDD`. An absent value is not an error (returns '').
 * A present but unparseable value is a flag, not a guess — the original raw
 * string is preserved rather than discarded or coerced.
 */
function normalizeDate(raw: string | undefined, path: string, flags: Flag[]): string {
  if (raw === undefined || raw === '') return '';
  const m = DATE_RE.exec(raw);
  if (m === null) {
    flags.push({
      code: 'INST_XML.DATE_UNPARSEABLE',
      severity: 'warning',
      message: `unparseable date at ${path}: ${JSON.stringify(raw)}`,
      ruleId: null,
      citation: null,
      lineIds: [],
    });
    return raw;
  }
  const y = m[1];
  const mo = m[2];
  const d = m[3];
  if (y === undefined || mo === undefined || d === undefined) return raw;
  return `${y}${mo}${d}`;
}

/**
 * Plain decimal dollars -> integer mils (1/1000 dollar), e.g. "2700.00" ->
 * 2700000. Rejects non-numeric/NaN input by throwing rather than coercing
 * (spec §7.1 discipline, applied here per §U2 validation point 4).
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

function collectOccurrenceCodes(
  attrs: Record<string, string>,
  flags: Flag[],
): { code: string; date: string }[] {
  const result: { code: string; date: string }[] = [];
  for (let i = 1; ; i++) {
    const code = attrs[`occ_code_${i}`];
    if (code === undefined) break;
    const date = normalizeDate(attrs[`occ_date_${i}_date`], `occurrenceCodes[${i - 1}]@occ_date_${i}_date`, flags);
    result.push({ code, date });
  }
  return result;
}

function collectValueCodes(
  attrs: Record<string, string>,
  claimId: string,
  pathPrefix: string,
): { code: string; amountMils: number }[] {
  const result: { code: string; amountMils: number }[] = [];
  for (let i = 1; ; i++) {
    const code = attrs[`value_code_${i}`];
    if (code === undefined) break;
    const amountMils = parseMoneyMils(attrs[`value_amt_${i}`], `${pathPrefix}@value_amt_${i}`, claimId);
    result.push({ code, amountMils });
  }
  return result;
}

/**
 * §19.14 line identity: `remote_chgid` (trimmed) when non-empty and unique
 * across the claim, else `idx:<n>`. Two lines resolving to the same
 * non-empty `remote_chgid` is refused outright — never silently
 * de-duplicated, since a wrong `bundledUnder` target is worse than a
 * rejected claim.
 */
function buildLines(
  chargeEls: XmlElement[],
  claimFromDate: string,
  claimThruDate: string,
  claimId: string,
  pathPrefix: string,
): { lines: ClaimLineInput[]; lineIdScheme: 'feed' | 'positional' | 'mixed' } {
  const rawIds = chargeEls.map((el) => (el.attrs['remote_chgid'] ?? '').trim());

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
  const lines: ClaimLineInput[] = chargeEls.map((el, index) => {
    const attrs = el.attrs;
    const rawId = rawIds[index] ?? '';
    let lineId: string;
    if (rawId !== '') {
      lineId = rawId;
      sawFeed = true;
    } else {
      lineId = `idx:${index}`;
      sawPositional = true;
    }
    return {
      lineId,
      procCode: attrs['proc_code'] ?? '',
      modifiers: [],
      revCode: attrs['rev_code'] ?? '',
      units: attrs['units'] ?? '',
      unitQualifier: attrs['charge_record_type'] ?? '',
      chargeMils: parseMoneyMils(attrs['charge'], `${pathPrefix}.charge[${index}]@charge`, claimId),
      fromDate: claimFromDate,
      thruDate: claimThruDate,
    };
  });

  const lineIdScheme: 'feed' | 'positional' | 'mixed' =
    sawFeed && sawPositional ? 'mixed' : sawFeed ? 'feed' : 'positional';

  return { lines, lineIdScheme };
}

function parseClaim(claimEl: XmlElement, claimIndex: number, options: ParseInstXmlOptions): ParsedInstClaim {
  const attrs = claimEl.attrs;
  const flags: Flag[] = [];
  const pathPrefix = `claims.claim[${claimIndex}]`;

  const claimId = options.claimIds?.[claimIndex] ?? `idx:${claimIndex}`;

  const claimForm = attrs['claim_form'] ?? '';
  const typeOfBill = attrs['type_of_bill'] ?? '';

  const statementFrom = normalizeDate(attrs['hosp_from_date'], `${pathPrefix}@hosp_from_date`, flags);
  const statementThrough = normalizeDate(attrs['hosp_thru_date'], `${pathPrefix}@hosp_thru_date`, flags);

  const conditionCodes = collectIndexed(attrs, 'cond_code_');
  const occurrenceCodes = collectOccurrenceCodes(attrs, flags);
  const valueCodes = collectValueCodes(attrs, claimId, pathPrefix);

  const billingTaxonomy = attrs['bill_taxonomy'] ?? '';
  const payer = { id: attrs['payerid'] ?? '', name: attrs['payer_name'] ?? '' };
  const diagnoses = collectDiagnoses(attrs);

  const chargeEls = claimEl.children.filter((c) => c.tag === 'charge');
  const { lines, lineIdScheme } = buildLines(chargeEls, statementFrom, statementThrough, claimId, pathPrefix);

  const totalChargeMils = parseMoneyMils(attrs['total_charge'], `${pathPrefix}@total_charge`, claimId);
  const sumChargeMils = lines.reduce((sum, line) => sum + line.chargeMils, 0);
  if (sumChargeMils !== totalChargeMils) {
    flags.push({
      code: 'INST_XML.TOTAL_CHARGE_MISMATCH',
      severity: 'warning',
      message: `line charges sum to ${sumChargeMils} mils but @total_charge declares ${totalChargeMils} mils`,
      ruleId: null,
      citation: null,
      lineIds: lines.map((l) => l.lineId),
    });
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

/**
 * Parses the institutional XML feed (`<claims>` -> one or more `<claim>`,
 * each with repeating `<charge>` children) into `ClaimInput`s. Throws
 * `EngineError` (never anything else) for malformed input.
 */
export function parseInstitutionalXml(xml: string, options: ParseInstXmlOptions = {}): ParsedInstClaim[] {
  const root = parseXml(xml);
  const claimsEl = root.children.find((c) => c.tag === 'claims');
  if (claimsEl === undefined) {
    throw makeError('CLAIM_SCHEMA_INVALID', 'claims', 'no <claims> root element found', null);
  }
  const claimEls = claimsEl.children.filter((c) => c.tag === 'claim');
  if (claimEls.length === 0) {
    throw makeError('CLAIM_SCHEMA_INVALID', 'claims', 'no <claim> elements found under <claims>', null);
  }
  return claimEls.map((el, i) => parseClaim(el, i, options));
}
