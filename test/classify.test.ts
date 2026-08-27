import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/phases/classify.js';
import { parseInstitutionalXml } from '../src/adapters/instXml.js';
import type { ClaimInput, ClaimLineInput } from '../src/types.js';

function claimLine(overrides: Partial<ClaimLineInput> = {}): ClaimLineInput {
  return {
    lineId: 'L1',
    procCode: '',
    modifiers: [],
    revCode: '0300',
    units: '1',
    unitQualifier: 'UN',
    chargeMils: 100000,
    fromDate: '20260115',
    thruDate: '20260115',
    ...overrides,
  };
}

function claim(overrides: Partial<ClaimInput> = {}, lines: ClaimLineInput[] = [claimLine()]): ClaimInput {
  return {
    claimId: 'C1',
    claimForm: 'ub04',
    typeOfBill: '131',
    statementFrom: '20260115',
    statementThrough: '20260115',
    conditionCodes: [],
    occurrenceCodes: [],
    valueCodes: [],
    billingTaxonomy: '282N00000X',
    payer: { id: '1', name: 'TEST' },
    diagnoses: [],
    lines,
    totalChargeMils: lines.reduce((s, l) => s + l.chargeMils, 0),
    lineIdScheme: 'positional',
    ...overrides,
  };
}

function readFixture(name: string): ClaimInput {
  const xml = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const [parsed] = parseInstitutionalXml(xml);
  if (parsed === undefined) throw new Error(`fixture ${name} produced no claim`);
  return parsed.claim;
}

describe('classify — §8.0 applicability gate', () => {
  it('the committed inpatient/CAH fixture is NOT_OPPS with all three conflicting signals in evidence', () => {
    const c = readFixture('inst-xml-inpatient-cah-revonly.xml');
    const result = classify(c);
    expect(result.applicability).not.toBeNull();
    const a = result.applicability;
    if (a === null) throw new Error('unreachable');
    expect(a.inScope).toBe(false);
    expect(a.confidence).toBe('probable');
    expect(a.evidence.length).toBe(3);
    expect(a.evidence.some((e) => /HOSPICE|81\/82/.test(e))).toBe(true);
    expect(a.evidence.some((e) => /room & board/.test(e))).toBe(true);
    expect(a.evidence.some((e) => /Critical Access Hospital/.test(e))).toBe(true);
    expect(result.lines).toEqual([]);
  });

  it('the synthetic outpatient 13X HCPCS fixture is in scope', () => {
    const c = readFixture('outpatient-13x-hcpcs.xml');
    const result = classify(c);
    expect(result.applicability).toBeNull();
    expect(result.lines.length).toBe(4);
  });

  it('fails BILL_TYPE when typeOfBill does not begin 13', () => {
    const result = classify(claim({ typeOfBill: '831' }));
    expect(result.applicability?.gate).toBe('BILL_TYPE');
  });

  it('fails FORM_TYPE for a non-institutional form', () => {
    const result = classify(claim({ claimForm: 'cms1500' }));
    expect(result.applicability?.gate).toBe('FORM_TYPE');
  });

  it('fails PROCEDURE_CODES when no line carries a HCPCS code', () => {
    const result = classify(claim({}, [claimLine({ procCode: '' }), claimLine({ lineId: 'L2', procCode: '' })]));
    expect(result.applicability?.gate).toBe('PROCEDURE_CODES');
  });

  it('fails INPATIENT_INDICATORS on room & board + covered-days value code', () => {
    const result = classify(
      claim({ valueCodes: [{ code: '80', amountMils: 6000 }] }, [claimLine({ procCode: 'G0463', revCode: '0110' })]),
    );
    expect(result.applicability?.gate).toBe('INPATIENT_INDICATORS');
  });

  it('fails PROVIDER_TYPE for a Critical Access Hospital taxonomy', () => {
    const result = classify(claim({ billingTaxonomy: '282NC0060X' }, [claimLine({ procCode: 'G0463' })]));
    expect(result.applicability?.gate).toBe('PROVIDER_TYPE');
  });
});

describe('classify — §8.0.1 revenue-code-only lines', () => {
  it('is NO_PROCEDURE_CODE / REJECTED, not MALFORMED', () => {
    // The claim needs at least one HCPCS-bearing line to clear the §8.0
    // gate at all (§8.0.1: a claim carrying NONE is caught at the gate) —
    // this fixture pairs a real code with a genuine revenue-code-only line.
    const result = classify(claim({}, [claimLine({ lineId: 'L1', procCode: 'G0463' }), claimLine({ lineId: 'L2', procCode: '', revCode: '0250' })]));
    expect(result.applicability).toBeNull();
    const l = result.lines.find((x) => x.lineId === 'L2');
    if (l === undefined || l.kind !== 'REJECTED') throw new Error('expected a rejected line');
    expect(l.status).toBe('NO_PROCEDURE_CODE');
    expect(l.revCode).toBe('0250');
  });
});

describe('classify — §8.1 shapes', () => {
  it('flags a 4-digit code as MALFORMED (likely a revenue code)', () => {
    const result = classify(claim({}, [claimLine({ procCode: '0300' })]));
    const [l] = result.lines;
    if (l === undefined || l.kind !== 'REJECTED') throw new Error('expected a rejected line');
    expect(l.status).toBe('MALFORMED');
  });

  it('flags a code absent from every data set as INVALID', () => {
    // Valid HCPCS-II shape ([A-V]\d{4}) but present in no loaded data set.
    const result = classify(claim({}, [claimLine({ procCode: 'V9999' })]));
    const [l] = result.lines;
    if (l === undefined || l.kind !== 'REJECTED') throw new Error('expected a rejected line');
    expect(l.status).toBe('INVALID');
  });
});

describe('classify — §8.2 jurisdictional dispositions', () => {
  it('99205 is REJECTED as NOT_PAID_RECODE, naming G0463', () => {
    const result = classify(claim({}, [claimLine({ procCode: '99205' })]));
    const [l] = result.lines;
    if (l === undefined || l.kind !== 'REJECTED') throw new Error('expected a rejected line');
    expect(l.status).toBe('NOT_PAID_RECODE');
    expect(l.flags.some((f) => f.message.includes('G0463'))).toBe(true);
  });

  it('SI A is ROUTED, not REJECTED, and skips phase 2', () => {
    // 36415 is Q4 in this batch's data, not A — use a code the loaded data marks SI A instead of asserting on 36415 here (that belongs to the Q4 conversion test).
    const result = classify(claim({}, [claimLine({ procCode: '0001U' })]));
    const [l] = result.lines;
    if (l === undefined || l.kind !== 'ROUTED') throw new Error('expected a routed line');
    expect(l.resolvedSI).toBe('A');
  });
});
