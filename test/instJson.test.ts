import { describe, expect, it } from 'vitest';
import { parseInstitutionalJson } from '../src/adapters/instJson.js';
import type { EngineError } from '../src/types.js';

// Every claim object in this file is entirely synthetic: invented codes,
// invented ids, invented dates (ZZTEST / 1900-01-01-style values where a
// value is needed at all). No value from the real institutional claim
// examined while building this adapter is reproduced here — see this
// file's PHI probe below, which is the mechanical enforcement of that
// rule, not just a stated intention.

function isEngineError(e: unknown): e is EngineError {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'EngineError';
}

function expectEngineError(fn: () => unknown, code?: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(isEngineError(thrown)).toBe(true);
  if (isEngineError(thrown) && code !== undefined) {
    expect(thrown.code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// 1. Positive case: a synthetic institutional JSON claim parses correctly.
// ---------------------------------------------------------------------------

describe('parseInstitutionalJson — synthetic institutional claim', () => {
  it('reads claim-level and line-level fields into a correct ClaimInput', () => {
    const claim = {
      formType: '837I',
      claim_form: 'ub92',
      type_of_bill: '131',
      hosp_from_date: '2026-01-05',
      hosp_thru_date: '2026-01-05',
      total_charge: '555.00',
      bill_taxonomy: '282NC0060X',
      payerid: 'ZZPAYER1',
      payer_name: 'ZZTEST PAYER',
      diag_1: 'Z0000',
      claimid: 'ZZ-DO-NOT-USE-AS-CLAIMID',
      charge: [
        {
          proc_code: 'G0463',
          proc_qual: 'HC',
          rev_code: '0510',
          units: '1',
          charge: '145.00',
          from_date: '2026-01-05',
          remote_chgid: 'L1',
        },
        {
          proc_code: '36415',
          proc_qual: 'HC',
          rev_code: '0300',
          units: '2',
          charge: '410.00',
          from_date: '2026-01-05',
          remote_chgid: 'L2',
        },
      ],
    };

    const [result] = parseInstitutionalJson(claim, { claimIds: ['ZZCLAIM1'] });
    expect(result).toBeDefined();
    if (result === undefined) return;
    const { claim: parsed, flags } = result;

    expect(parsed.claimId).toBe('ZZCLAIM1');
    expect(parsed.claimForm).toBe('ub92');
    expect(parsed.typeOfBill).toBe('131');

    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((l) => l.procCode)).toEqual(['G0463', '36415']);
    expect(parsed.lines.map((l) => l.revCode)).toEqual(['0510', '0300']);
    expect(parsed.lines.map((l) => l.units)).toEqual(['1', '2']);
    expect(parsed.lines.map((l) => l.chargeMils)).toEqual([145000, 410000]);

    expect(parsed.lineIdScheme).toBe('feed');
    expect(parsed.lines.map((l) => l.lineId)).toEqual(['L1', 'L2']);

    expect(parsed.totalChargeMils).toBe(555000);
    const sum = parsed.lines.reduce((s, l) => s + l.chargeMils, 0);
    expect(sum).toBe(parsed.totalChargeMils);
    expect(flags.some((f) => f.code === 'INST_JSON.TOTAL_CHARGE_MISMATCH')).toBe(false);

    expect(parsed.billingTaxonomy).toBe('282NC0060X');
    expect(parsed.payer).toEqual({ id: 'ZZPAYER1', name: 'ZZTEST PAYER' });
    expect(parsed.diagnoses).toEqual(['Z0000']);
  });

  it('accepts a raw JSON string, not only a pre-parsed object', () => {
    const json = JSON.stringify({
      claim_form: 'ub92',
      type_of_bill: '131',
      fdos: '2026-02-01',
      ldos: '2026-02-01',
      total_charge: '10.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    });
    const [result] = parseInstitutionalJson(json);
    expect(result?.claim.lines).toHaveLength(1);
    expect(result?.claim.claimId).toBe('idx:0');
  });

  it('handles a batch: an array of claim objects, one caller id per element', () => {
    const claimA = {
      claim_form: 'ub92',
      type_of_bill: '131',
      fdos: '2026-03-01',
      total_charge: '10.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const claimB = {
      claim_form: 'ub92',
      type_of_bill: '131',
      fdos: '2026-03-02',
      total_charge: '20.00',
      charge: [{ proc_code: '99212', rev_code: '0510', units: '1', charge: '20.00', remote_chgid: '1' }],
    };
    const results = parseInstitutionalJson([claimA, claimB], { claimIds: ['A', 'B'] });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.claim.claimId)).toEqual(['A', 'B']);
    expect(results.map((r) => r.claim.totalChargeMils)).toEqual([10000, 20000]);
  });
});

// ---------------------------------------------------------------------------
// 2. PHI-leak probe: every forbidden field, plus invented fields the
//    adapter has never seen, all carrying unique sentinel values. None may
//    reach the output, proving the allow-list, not a maintained deny-list,
//    is what keeps them out.
// ---------------------------------------------------------------------------

describe('PHI boundary — allow-list, not deny-list', () => {
  const claimWithSentinels = {
    formType: '837I',
    claim_form: 'ub92',
    type_of_bill: '131',
    fdos: '2026-04-01',
    ldos: '2026-04-01',
    total_charge: '10.00',
    bill_taxonomy: '282NC0060X',
    payerid: 'ZZPAYER',
    payer_name: 'ZZPAYERNAME',

    // Forbidden claim-level fields (§14) — every one gets a unique sentinel.
    pat_name_l: 'SENTINEL_PATLNAME',
    pat_name_f: 'SENTINEL_PATFNAME',
    pat_name_m: 'SENTINEL_PATMNAME',
    pat_dob: 'SENTINEL_PATDOB',
    pat_sex: 'SENTINEL_PATSEX',
    pat_addr_1: 'SENTINEL_PATADDR1',
    pat_addr_2: 'SENTINEL_PATADDR2',
    pat_city: 'SENTINEL_PATCITY',
    pat_state: 'SENTINEL_PATSTATE',
    pat_zip: 'SENTINEL_PATZIP',
    pat_phone: 'SENTINEL_PATPHONE',
    pat_country: 'SENTINEL_PATCOUNTRY',
    ins_number: 'SENTINEL_INSNUMBER',
    ins_name_l: 'SENTINEL_INSLNAME',
    ins_name_f: 'SENTINEL_INSFNAME',
    ins_name_m: 'SENTINEL_INSMNAME',
    ins_dob: 'SENTINEL_INSDOB',
    ins_addr_1: 'SENTINEL_INSADDR1',
    ins_addr_2: 'SENTINEL_INSADDR2',
    ins_phone: 'SENTINEL_INSPHONE',
    ins_employer: 'SENTINEL_INSEMPLOYER',
    ins_group: 'SENTINEL_INSGROUP',
    ins_plan: 'SENTINEL_INSPLAN',
    other_ins_number: 'SENTINEL_OTHERINSNUMBER',
    other_ins_name_l: 'SENTINEL_OTHERINSLNAME',
    mrn: 'SENTINEL_MRN',
    pcn: 'SENTINEL_PCN',
    claimid: 'SENTINEL_CLAIMID',
    remote_claimid: 'SENTINEL_REMOTECLAIMID',
    bill_npi: 'SENTINEL_BILLNPI',
    bill_taxid: 'SENTINEL_BILLTAXID',
    bill_name: 'SENTINEL_BILLNAME',
    bill_addr_1: 'SENTINEL_BILLADDR1',
    bill_addr_2: 'SENTINEL_BILLADDR2',
    bill_phone: 'SENTINEL_BILLPHONE',
    prov_npi: 'SENTINEL_PROVNPI',
    prov_name_l: 'SENTINEL_PROVLNAME',
    prov_name_f: 'SENTINEL_PROVFNAME',
    prov_name_m: 'SENTINEL_PROVMNAME',
    prov2_id: 'SENTINEL_PROV2ID',
    prov2_npi: 'SENTINEL_PROV2NPI',
    prov2_name_l: 'SENTINEL_PROV2LNAME',
    prov3_id: 'SENTINEL_PROV3ID',
    prov3_npi: 'SENTINEL_PROV3NPI',
    prov3_name_l: 'SENTINEL_PROV3LNAME',
    ref_id: 'SENTINEL_REFID',
    ref_npi: 'SENTINEL_REFNPI',
    ref_name_l: 'SENTINEL_REFLNAME',
    facility_npi: 'SENTINEL_FACILITYNPI',
    facility_name: 'SENTINEL_FACILITYNAME',
    facility_addr_1: 'SENTINEL_FACILITYADDR1',
    facility_addr_2: 'SENTINEL_FACILITYADDR2',
    remote_fileid: 'SENTINEL_FILEID',
    remote_batchid: 'SENTINEL_BATCHID',
    icn_dcn_1: 'SENTINEL_ICNDCN1',
    auth_code_1: 'SENTINEL_AUTHCODE1',
    special_identifier: 'SENTINEL_SPECIALID',
    narrative: 'SENTINEL_CLAIMNARRATIVE',

    // Invented fields this adapter has never seen at all — proves the
    // exclusion is structural (an allow-list of call sites), not a
    // maintained list of known-bad names.
    zzz_unknown_future_field: 'SENTINEL_UNKNOWNFIELD',
    patient_ssn: 'SENTINEL_SSN',
    guarantor_name: 'SENTINEL_GUARANTOR',
    subscriber_email: 'SENTINEL_EMAIL',
    random_2027_extension_key: 'SENTINEL_RANDOMEXT',

    charge: [
      {
        proc_code: '99211',
        rev_code: '0510',
        units: '1',
        charge: '10.00',
        remote_chgid: '1',
        from_date: '2026-04-01',
        mod1: '25',

        // Forbidden / unmapped line-level fields.
        chgid: 'SENTINEL_CHGID',
        diag_ref: 'SENTINEL_DIAGREF',
        place_of_service: 'SENTINEL_POS',
        narrative: 'SENTINEL_LINENARRATIVE',
        patient_responsibility: 'SENTINEL_PATRESP',
        primary_paid_date: 'SENTINEL_PAIDDATE',

        // Invented line-level field.
        zzz_unknown_line_field: 'SENTINEL_UNKNOWNLINEFIELD',
      },
    ],
  };

  function allSentinelValues(obj: Record<string, unknown>): string[] {
    const values: string[] = [];
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && v.startsWith('SENTINEL_')) values.push(v);
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === 'object' && item !== null) values.push(...allSentinelValues(item as Record<string, unknown>));
        }
      }
    }
    return values;
  }

  it('carries none of the forbidden or invented sentinel values into the output', () => {
    const sentinels = allSentinelValues(claimWithSentinels);
    expect(sentinels.length).toBeGreaterThan(40); // sanity: the probe actually planted a lot of values

    const results = parseInstitutionalJson(claimWithSentinels);
    const serialized = JSON.stringify(results);
    for (const value of sentinels) {
      expect(serialized.includes(value)).toBe(false);
    }
  });

  it('still carries the legitimate allow-listed fields through (the probe is not just silently dropping everything)', () => {
    const [result] = parseInstitutionalJson(claimWithSentinels);
    expect(result?.claim.payer).toEqual({ id: 'ZZPAYER', name: 'ZZPAYERNAME' });
    expect(result?.claim.lines[0]?.procCode).toBe('99211');
    expect(result?.claim.lines[0]?.modifiers).toEqual(['25']);
    // chgid is present and non-empty, but lineId must come from remote_chgid only.
    expect(result?.claim.lines[0]?.lineId).toBe('1');
  });

  it('never uses claimid or remote_claimid as claimId even with no caller-supplied id (D7)', () => {
    const [result] = parseInstitutionalJson(claimWithSentinels);
    expect(result?.claim.claimId).toBe('idx:0');
    expect(result?.claim.claimId).not.toBe('SENTINEL_CLAIMID');
    expect(result?.claim.claimId).not.toBe('SENTINEL_REMOTECLAIMID');
  });
});

// ---------------------------------------------------------------------------
// 3. Statement-date precedence chain.
// ---------------------------------------------------------------------------

describe('statement-date precedence chain', () => {
  function baseClaim(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      claim_form: 'ub92',
      type_of_bill: '131',
      total_charge: '10.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
      ...overrides,
    };
  }

  it('tier 1: uses hosp_from_date/hosp_thru_date when both are present and non-empty', () => {
    const claim = baseClaim({ hosp_from_date: '2026-05-01', hosp_thru_date: '2026-05-03' });
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.statementFrom).toBe('20260501');
    expect(result?.claim.statementThrough).toBe('20260503');
    expect(result?.flags.some((f) => f.code === 'INST_JSON.STATEMENT_FROM_SOURCE' && f.message.includes('hosp_from_date'))).toBe(true);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.STATEMENT_THROUGH_SOURCE' && f.message.includes('hosp_thru_date'))).toBe(true);
  });

  it('tier 2: falls back to fdos/ldos when hosp_from_date is empty and hosp_thru_date is absent (the real-sample case)', () => {
    const claim = baseClaim({ hosp_from_date: '', fdos: '2026-06-01', ldos: '2026-06-01' });
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.statementFrom).toBe('20260601');
    expect(result?.claim.statementThrough).toBe('20260601');
    expect(result?.flags.some((f) => f.code === 'INST_JSON.STATEMENT_FROM_SOURCE' && f.message.includes('fdos'))).toBe(true);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.STATEMENT_THROUGH_SOURCE' && f.message.includes('ldos'))).toBe(true);
  });

  it('tier 3: falls back to min/max of the lines\' own from_date/thru_date when hosp_* and fdos/ldos are all unavailable', () => {
    const claim = baseClaim({
      charge: [
        { proc_code: '99211', rev_code: '0510', units: '1', charge: '5.00', remote_chgid: '1', from_date: '2026-07-02', thru_date: '2026-07-02' },
        { proc_code: '99212', rev_code: '0510', units: '1', charge: '5.00', remote_chgid: '2', from_date: '2026-07-01', thru_date: '2026-07-03' },
      ],
      total_charge: '10.00',
    });
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.statementFrom).toBe('20260701');
    expect(result?.claim.statementThrough).toBe('20260703');
    expect(result?.flags.some((f) => f.code === 'INST_JSON.STATEMENT_FROM_SOURCE' && f.message.includes("from_date"))).toBe(true);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.STATEMENT_THROUGH_SOURCE' && f.message.includes("thru_date"))).toBe(true);
  });

  it('raises a distinct disagreement flag when two available sources give different dates, but still uses the higher-precedence one', () => {
    const claim = baseClaim({ hosp_from_date: '2026-08-01', fdos: '2026-08-05' });
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.statementFrom).toBe('20260801'); // tier 1 still wins
    expect(
      result?.flags.some(
        (f) => f.code === 'INST_JSON.STATEMENT_FROM_DISAGREEMENT' && f.message.includes('hosp_from_date') && f.message.includes('fdos'),
      ),
    ).toBe(true);
  });

  it('does not raise a disagreement flag when the only available sources agree', () => {
    const claim = baseClaim({ hosp_from_date: '2026-09-01', fdos: '2026-09-01' });
    const [result] = parseInstitutionalJson(claim);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.STATEMENT_FROM_DISAGREEMENT')).toBe(false);
  });

  it('emits a severity "gap" source flag and an empty date when no tier supplies a usable date', () => {
    const claim = baseClaim({});
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.statementFrom).toBe('');
    expect(result?.claim.statementThrough).toBe('');
    const fromFlag = result?.flags.find((f) => f.code === 'INST_JSON.STATEMENT_FROM_SOURCE');
    expect(fromFlag?.severity).toBe('gap');
  });
});

// ---------------------------------------------------------------------------
// 4. Absent-vs-empty disclosure flags for condition/occurrence/value codes.
// ---------------------------------------------------------------------------

describe('condition/occurrence/value code absent-vs-empty disclosure', () => {
  it('fires INST_JSON.CONDITION_CODES_NOT_PRESENT when no cond_code_* key exists at all', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      fdos: '2026-10-01',
      total_charge: '10.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.conditionCodes).toEqual([]);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.CONDITION_CODES_NOT_PRESENT' && f.severity === 'gap')).toBe(true);
  });

  it('does not fire the disclosure when cond_code_1 is present, even if the value is empty (known-empty, not absent)', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      fdos: '2026-10-01',
      total_charge: '10.00',
      cond_code_1: '',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.conditionCodes).toEqual([]);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.CONDITION_CODES_NOT_PRESENT')).toBe(false);
  });

  it('collects a real condition code when present and non-empty', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      fdos: '2026-10-01',
      total_charge: '10.00',
      cond_code_1: 'M2',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.conditionCodes).toEqual(['M2']);
  });

  it('fires the same absent-vs-empty disclosure for occurrence and value codes', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      fdos: '2026-10-01',
      total_charge: '10.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.occurrenceCodes).toEqual([]);
    expect(result?.claim.valueCodes).toEqual([]);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.OCCURRENCE_CODES_NOT_PRESENT')).toBe(true);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.VALUE_CODES_NOT_PRESENT')).toBe(true);
  });

  it('treats present-but-all-empty value/occurrence code slots as known-empty (no disclosure), matching the real feed convention', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      fdos: '2026-10-01',
      total_charge: '10.00',
      occ_code_1: '',
      occ_date_1_date: '',
      value_code_1: '',
      value_amt_1: '0.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.occurrenceCodes).toEqual([]);
    expect(result?.claim.valueCodes).toEqual([]);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.OCCURRENCE_CODES_NOT_PRESENT')).toBe(false);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.VALUE_CODES_NOT_PRESENT')).toBe(false);
  });

  it('collects a real value code (e.g. covered days, code 80) when present', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      fdos: '2026-10-01',
      total_charge: '10.00',
      value_code_1: '80',
      value_amt_1: '6.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.valueCodes).toContainEqual({ code: '80', amountMils: 6000 });
  });
});

// ---------------------------------------------------------------------------
// 5. Malformed input (§12.7): typed error or graceful flag, never an
//    uncaught throw that loses the claim.
// ---------------------------------------------------------------------------

describe('malformed input handling (§12.7)', () => {
  it('not JSON: throws a typed EngineError, not a raw SyntaxError', () => {
    expectEngineError(() => parseInstitutionalJson('{ this is not json'), 'CLAIM_SCHEMA_INVALID');
  });

  it('JSON that is not a claim (a bare scalar): throws CLAIM_SCHEMA_INVALID', () => {
    expectEngineError(() => parseInstitutionalJson('42'), 'CLAIM_SCHEMA_INVALID');
    expectEngineError(() => parseInstitutionalJson('"just a string"'), 'CLAIM_SCHEMA_INVALID');
    expectEngineError(() => parseInstitutionalJson('null'), 'CLAIM_SCHEMA_INVALID');
  });

  it('JSON that is an empty array: throws CLAIM_SCHEMA_INVALID rather than silently returning zero claims', () => {
    expectEngineError(() => parseInstitutionalJson('[]'), 'CLAIM_SCHEMA_INVALID');
  });

  it('charge missing entirely: throws CLAIM_SCHEMA_INVALID naming the charge path', () => {
    const claim = { claim_form: 'ub92', type_of_bill: '131', total_charge: '10.00' };
    let thrown: unknown;
    try {
      parseInstitutionalJson(claim);
    } catch (e) {
      thrown = e;
    }
    expect(isEngineError(thrown)).toBe(true);
    if (isEngineError(thrown)) {
      expect(thrown.code).toBe('CLAIM_SCHEMA_INVALID');
      expect(thrown.path).toContain('charge');
    }
  });

  it('charge present but not an array: throws CLAIM_SCHEMA_INVALID', () => {
    const claim = { claim_form: 'ub92', type_of_bill: '131', total_charge: '10.00', charge: 'not-an-array' };
    expectEngineError(() => parseInstitutionalJson(claim), 'CLAIM_SCHEMA_INVALID');
  });

  it('a line missing proc_code: does NOT throw (§8.0.1 revenue-code-only billing is normal) -- procCode comes back empty', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      total_charge: '10.00',
      charge: [{ rev_code: '0250', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.lines[0]?.procCode).toBe('');
    expect(result?.claim.lines[0]?.revCode).toBe('0250');
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: line identity, third-modifier flag, claim_form vs
// formType disagreement -- all called out explicitly in the build brief.
// ---------------------------------------------------------------------------

describe('line identity (§19.14) and other disclosures', () => {
  it('falls back to positional ids when charges lack remote_chgid, and never reads chgid for identity', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      total_charge: '20.00',
      charge: [
        { proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', chgid: 'WRONG_ID_1' },
        { proc_code: '99212', rev_code: '0510', units: '1', charge: '10.00', chgid: 'WRONG_ID_2' },
      ],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.lineIdScheme).toBe('positional');
    expect(result?.claim.lines.map((l) => l.lineId)).toEqual(['idx:0', 'idx:1']);
  });

  it('throws LINE_ID_NOT_UNIQUE when two charges share a non-empty remote_chgid', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      total_charge: '20.00',
      charge: [
        { proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: 'DUP' },
        { proc_code: '99212', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: 'DUP' },
      ],
    };
    expectEngineError(() => parseInstitutionalJson(claim), 'LINE_ID_NOT_UNIQUE');
  });

  it('flags a third modifier convention beyond mod1/mod2', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      total_charge: '10.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1', mod1: '25', mod2: '59', mod3: 'XU' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.THIRD_MODIFIER_CONVENTION')).toBe(true);
    // mod3 is still not carried into modifiers[] -- only mod1/mod2 are mapped.
    expect(result?.claim.lines[0]?.modifiers).toEqual(['25', '59']);
  });

  it('flags claim_form/formType disagreement about institutional-ness', () => {
    const claim = {
      claim_form: 'ub92',
      formType: '837P', // professional -- disagrees with the institutional claim_form
      type_of_bill: '131',
      total_charge: '10.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.FORM_TYPE_DISAGREEMENT')).toBe(true);
  });

  it('does not flag agreement between claim_form and formType', () => {
    const claim = {
      claim_form: 'ub92',
      formType: '837I',
      type_of_bill: '131',
      total_charge: '10.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.FORM_TYPE_DISAGREEMENT')).toBe(false);
  });

  it('a per-line date falls back to the claim statement period when the line carries none', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      hosp_from_date: '2026-11-01',
      hosp_thru_date: '2026-11-01',
      total_charge: '10.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.claim.lines[0]?.fromDate).toBe('20261101');
    expect(result?.claim.lines[0]?.thruDate).toBe('20261101');
  });

  it('flags a total-charge mismatch without failing the claim', () => {
    const claim = {
      claim_form: 'ub92',
      type_of_bill: '131',
      total_charge: '999.00',
      charge: [{ proc_code: '99211', rev_code: '0510', units: '1', charge: '10.00', remote_chgid: '1' }],
    };
    const [result] = parseInstitutionalJson(claim);
    expect(result?.flags.some((f) => f.code === 'INST_JSON.TOTAL_CHARGE_MISMATCH' && f.severity === 'warning')).toBe(true);
  });
});
