import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adjudicate, ENGINE_CONTRACT_VERSION } from '../src/index.js';
import { parseInstitutionalXml } from '../src/adapters/instXml.js';
import type { ClaimInput, ClaimLineInput } from '../src/types.js';
import type { Determination, EngineResult } from '../src/phases/adjudicate.js';

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

function det(result: EngineResult, lineId: string): Determination {
  const d = result.determinations.find((x) => x.lineId === lineId);
  if (d === undefined) throw new Error(`no determination for ${lineId}`);
  return d;
}

function readFixture(name: string): ClaimInput {
  const xml = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const [parsed] = parseInstitutionalXml(xml);
  if (parsed === undefined) throw new Error(`fixture ${name} produced no claim`);
  return parsed.claim;
}

describe('adjudicate — end to end wiring', () => {
  it('exposes ENGINE_CONTRACT_VERSION', () => {
    expect(typeof ENGINE_CONTRACT_VERSION).toBe('string');
    expect(ENGINE_CONTRACT_VERSION.length).toBeGreaterThan(0);
  });

  it('the committed inpatient/CAH fixture -> NOT_OPPS, zero determinations', () => {
    const c = readFixture('inst-xml-inpatient-cah-revonly.xml');
    const result = adjudicate({ claim: c });
    expect(result.applicability).not.toBeNull();
    expect(result.applicability?.confidence).toBe('probable');
    expect(result.applicability?.evidence.length).toBe(3);
    expect(result.determinations).toEqual([]);
    expect(result.engineStatus).toBe('OK');
  });

  it('the synthetic outpatient 13X HCPCS fixture is in scope and every line is adjudicated', () => {
    const c = readFixture('outpatient-13x-hcpcs.xml');
    const result = adjudicate({ claim: c });
    expect(result.applicability).toBeNull();
    expect(result.determinations.length).toBe(4);
    for (const d of result.determinations) {
      expect(d.disposition).not.toBe('ENGINE_ERROR');
    }
  });

  it('throws EngineError, not a plain Error, for a schema-invalid claim', () => {
    try {
      adjudicate({ claim: { not: 'a claim' } });
      expect.fail('expected adjudicate() to throw');
    } catch (err) {
      expect((err as { name?: unknown }).name).toBe('EngineError');
      expect((err as { code?: unknown }).code).toBe('CLAIM_SCHEMA_INVALID');
    }
  });
});

describe('adjudicate — §8.2/§8.3 recode', () => {
  it('99205 -> NOT_PAID_RECODE naming G0463', () => {
    const result = adjudicate({ claim: claim({}, [claimLine({ procCode: '99205' })]) });
    const d = det(result, 'L1');
    expect(d.status).toBe('NOT_PAID_RECODE');
    expect(d.disposition).toBe('REJECTED');
    expect(d.flags.some((f) => f.message.includes('G0463'))).toBe(true);
  });
});

describe('adjudicate — §9.2/§9.3 the Q1/Q4 asymmetry', () => {
  it('36415 alone -> Q4 unpackaged -> converts to A -> basis CLFS', () => {
    const result = adjudicate({ claim: claim({}, [claimLine({ procCode: '36415' })]) });
    const d = det(result, 'L1');
    expect(d.resolvedSI).toBe('Q4');
    expect(d.effectiveSI).toBe('A');
    expect(d.basis).toBe('CLFS');
    expect(d.disposition).toBe('ADJUDICATED');
    expect(d.status === 'PAID' || d.status === 'PAID_UNPRICED').toBe(true);
  });

  it('G0463 + 84112 -> the Q4 line (84112) BUNDLED, G0463 pays its own visit APC', () => {
    const result = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'V', procCode: 'G0463' }), claimLine({ lineId: 'Q4', procCode: '84112' })]),
    });
    const q4 = det(result, 'Q4');
    expect(q4.status).toBe('BUNDLED');
    expect(q4.bundledUnder).toBe('V');
    const v = det(result, 'V');
    expect(v.status).toBe('PAID');
    expect(v.basis).toBe('OPPS_APC');
  });

  it('G0463 + a Q1 code -> the Q1 line PAID (not bundled) — the asymmetry, asserted alongside the Q4 case above', () => {
    // 0106T is SI Q1 in the loaded Addendum B data. Q1's trigger list is
    // {S,T,V} and does NOT include J2, so a bare J2 (G0463) companion does
    // not package it — unlike Q4, whose trigger list DOES include J2.
    const result = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'V', procCode: 'G0463' }), claimLine({ lineId: 'Q1', procCode: '0106T' })]),
    });
    const q1 = det(result, 'Q1');
    expect(q1.status).toBe('PAID');
    expect(q1.basis).toBe('OPPS_APC');
    expect(q1.bundledUnder).toBeNull();
  });
});

describe('adjudicate — §9.1 J1 comprehensive control', () => {
  it('two J1 lines -> one controls by payment, the other bundles, complexity flag present', () => {
    // 0200T (rate 7413380 mils) outranks 0102T (rate 3342870 mils).
    const result = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'A', procCode: '0200T' }), claimLine({ lineId: 'B', procCode: '0102T' })]),
    });
    const a = det(result, 'A');
    const b = det(result, 'B');
    expect(a.status).toBe('PAID');
    expect(a.basis).toBe('OPPS_APC');
    expect(a.bundledUnder).toBeNull();
    expect(b.status).toBe('BUNDLED');
    expect(b.bundledUnder).toBe('A');
    expect(result.disclosures.some((f) => f.code === 'OPPS.J1.COMPLEXITY_NOT_APPLIED')).toBe(true);
  });

  it('an exempt-SI line alongside a J1 -> the exempt line still pays', () => {
    // A2001 is SI S1 — exempt (band 1000), so J1 control's scope excludes it.
    const result = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'J1', procCode: '0071T' }), claimLine({ lineId: 'EX', procCode: 'A2001' })]),
    });
    const ex = det(result, 'EX');
    expect(ex.status).toBe('PAID');
    expect(ex.bundledUnder).toBeNull();
    expect(ex.flags.some((f) => f.code === 'OPPS.EXEMPT.UNVERIFIED_POLICY')).toBe(true);
    const j1 = det(result, 'J1');
    expect(j1.status).toBe('PAID');
    expect(j1.bundledUnder).toBeNull();
  });
});

describe('adjudicate — U19b defect 1: SI N status (§9.4)', () => {
  it('an SI N line alone -> PACKAGED, basis NONE, bundledUnder null — never PAID (SI N pays nothing separately)', () => {
    // 00100 is SI N (packaged, always $0, no rate) in the loaded Addendum B data.
    const result = adjudicate({ claim: claim({}, [claimLine({ procCode: '00100' })]) });
    const d = det(result, 'L1');
    expect(d.resolvedSI).toBe('N');
    expect(d.status).toBe('PACKAGED');
    expect(d.status).not.toBe('PAID');
    expect(d.basis).toBe('NONE');
    expect(d.bundledUnder).toBeNull();
  });

  it('PACKAGED and BUNDLED are distinguishable: a bundled line names a controlling line, a packaged one does not', () => {
    // The same SI N code (00100) bundles under a controlling J1 when one is
    // present on the claim (J1 control packages "all non-exempt lines")...
    const bundledResult = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'J1', procCode: '0071T' }), claimLine({ lineId: 'N', procCode: '00100' })]),
    });
    const bundledN = det(bundledResult, 'N');
    expect(bundledN.status).toBe('BUNDLED');
    expect(bundledN.bundledUnder).toBe('J1');

    // ...but standing alone, with no controlling line to name, it is PACKAGED.
    const packagedResult = adjudicate({ claim: claim({}, [claimLine({ procCode: '00100' })]) });
    const packagedN = det(packagedResult, 'L1');
    expect(packagedN.status).toBe('PACKAGED');
    expect(packagedN.bundledUnder).toBeNull();
  });
});

describe('adjudicate — U19b defect 2: determination.line echoes its own input (§5.1)', () => {
  it('59025x2:73 round-trips: the determination echoes units and modifiers from the raw input, not just lineId/resolvedSI', () => {
    const result = adjudicate({
      claim: claim({}, [claimLine({ procCode: '59025', units: '2', modifiers: ['73'] })]),
    });
    const d = det(result, 'L1');
    expect(d.line.procCode).toBe('59025');
    expect(d.line.units).toBe('2');
    expect(d.line.modifiers).toEqual(['73']);
    expect(d.line.fromDate).toBe('20260115');
    expect(d.line.thruDate).toBe('20260115');
    expect(d.line.chargeMils).toBe(100000);
  });

  it('determination.line is populated (not an empty object) on every classification path, not only ADMITTED lines', () => {
    // REJECTED path: 99205 recodes to NOT_PAID_RECODE without reaching phase 2.
    const rejected = adjudicate({ claim: claim({}, [claimLine({ procCode: '99205', units: '3' })]) });
    const rd = det(rejected, 'L1');
    expect(rd.disposition).toBe('REJECTED');
    expect(rd.line.procCode).toBe('99205');
    expect(rd.line.units).toBe('3');
  });
});

describe('adjudicate — §9.1 C-APC 8011 (U15)', () => {
  // 99284 (ED visit level 4) is SI J2 in the loaded Addendum B data.
  // G0378 (hospital observation, per hour) is SI N. 0263T is SI S. 0101T is
  // SI T. A2001 is SI S1 (exempt, band 1000).

  it('G0378x8 99284 -> 8011 fires: the J2 is PAID_UNPRICED, basis OPPS_COMPREHENSIVE, and a flag names the missing rate', () => {
    const result = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'OBS', procCode: 'G0378', units: '8' }), claimLine({ lineId: 'J2', procCode: '99284' })]),
    });
    const j2 = det(result, 'J2');
    expect(j2.status).toBe('PAID_UNPRICED');
    expect(j2.basis).toBe('OPPS_COMPREHENSIVE');
    expect(j2.flags.some((f) => f.code === 'OPPS.8011.RATE_UNAVAILABLE')).toBe(true);
  });

  it('G0378x8 99284 plus an S line -> the S line bundles under the J2 (comprehensive packaging, not just an unpriced J2)', () => {
    const result = adjudicate({
      claim: claim({}, [
        claimLine({ lineId: 'OBS', procCode: 'G0378', units: '8' }),
        claimLine({ lineId: 'J2', procCode: '99284' }),
        claimLine({ lineId: 'S', procCode: '0263T' }),
      ]),
    });
    const s = det(result, 'S');
    expect(s.status).toBe('BUNDLED');
    expect(s.bundledUnder).toBe('J2');
    const j2 = det(result, 'J2');
    expect(j2.status).toBe('PAID_UNPRICED');
    expect(j2.basis).toBe('OPPS_COMPREHENSIVE');
  });

  it('G0378x4 99284 -> 8011 does not fire (fewer than 8 units): the J2 pays its own APC', () => {
    const result = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'OBS', procCode: 'G0378', units: '4' }), claimLine({ lineId: 'J2', procCode: '99284' })]),
    });
    const j2 = det(result, 'J2');
    expect(j2.status).toBe('PAID');
    expect(j2.basis).toBe('OPPS_APC');
    expect(j2.flags.some((f) => f.code === 'OPPS.8011.RATE_UNAVAILABLE')).toBe(false);
  });

  it('G0378x8 99284 plus a T line -> blocked by condition 3 (no SI T): the J2 pays its own APC, not OPPS_COMPREHENSIVE', () => {
    const result = adjudicate({
      claim: claim({}, [
        claimLine({ lineId: 'OBS', procCode: 'G0378', units: '8' }),
        claimLine({ lineId: 'J2', procCode: '99284' }),
        claimLine({ lineId: 'T', procCode: '0101T' }),
      ]),
    });
    const j2 = det(result, 'J2');
    expect(j2.status).toBe('PAID');
    expect(j2.basis).toBe('OPPS_APC');
    const t = det(result, 'T');
    expect(t.status).toBe('PAID');
    expect(t.bundledUnder).toBeNull();
  });

  it('G0378x4 G0378x4 99284 -> units sum across two lines (§19.7), so 8011 fires', () => {
    const result = adjudicate({
      claim: claim({}, [
        claimLine({ lineId: 'OBS1', procCode: 'G0378', units: '4' }),
        claimLine({ lineId: 'OBS2', procCode: 'G0378', units: '4' }),
        claimLine({ lineId: 'J2', procCode: '99284' }),
      ]),
    });
    const j2 = det(result, 'J2');
    expect(j2.status).toBe('PAID_UNPRICED');
    expect(j2.basis).toBe('OPPS_COMPREHENSIVE');
  });

  it('an exempt-SI line on a fired-8011 claim still pays, not bundled', () => {
    const result = adjudicate({
      claim: claim({}, [
        claimLine({ lineId: 'OBS', procCode: 'G0378', units: '8' }),
        claimLine({ lineId: 'J2', procCode: '99284' }),
        claimLine({ lineId: 'EX', procCode: 'A2001' }),
      ]),
    });
    const ex = det(result, 'EX');
    expect(ex.status).toBe('PAID');
    expect(ex.bundledUnder).toBeNull();
    const j2 = det(result, 'J2');
    expect(j2.status).toBe('PAID_UNPRICED');
  });
});

describe('adjudicate — §9.5/§8.1 reserved edit slots (U17)', () => {
  it('every adjudicated determination carries NOT_EVALUATED entries for the three reserved slots (D40)', () => {
    const result = adjudicate({ claim: claim({}, [claimLine({ procCode: '00100' })]) });
    const d = det(result, 'L1');
    expect(d.disposition).toBe('ADJUDICATED');
    for (const ruleId of ['NCCI.PTP.PAIR', 'MUE.LIMIT', 'OPPS.CLASSIFY.DELETED']) {
      const ev = d.trace.find((e) => e.ruleId === ruleId);
      expect(ev?.outcome).toBe('NOT_EVALUATED');
    }
  });

  it('a stop earlier in the phase does not skip the reserved slots (alwaysEvaluate, §4.3)', () => {
    // 00100 is SI N -> PACKAGED via OPPS.DISP.N at band 5000; no stop effect
    // is used anywhere in the batch-2 registry, so this asserts the weaker
    // but still load-bearing half of D40: the reserved slots fire on every
    // admitted line regardless of what happened earlier in the phase.
    const result = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'OBS', procCode: 'G0378', units: '8' }), claimLine({ lineId: 'J2', procCode: '99284' })]),
    });
    for (const lineId of ['OBS', 'J2']) {
      const d = det(result, lineId);
      for (const ruleId of ['NCCI.PTP.PAIR', 'MUE.LIMIT', 'OPPS.CLASSIFY.DELETED']) {
        const ev = d.trace.find((e) => e.ruleId === ruleId);
        expect(ev?.outcome).toBe('NOT_EVALUATED');
      }
    }
  });
});

describe('adjudicate — §12.7 flag manifest (U17 Part A)', () => {
  it('a flag effect whose code is absent from the manifest is rejected, not silently passed', () => {
    const badRegistry = [
      {
        id: 'TEST.BAD_FLAG',
        version: '1.0',
        effectiveFrom: '20260101',
        effectiveTo: null,
        phase: 'ADJUDICATE',
        band: 1000,
        order: 1000,
        epoch: 'E0',
        scopeTarget: 'line',
        citation: 'test',
        scope: { always: {} },
        then: [{ flag: { code: 'NOT.IN.MANIFEST', severity: 'info', message: 'x' } }],
      },
    ];
    const result = adjudicate({ claim: claim({}, [claimLine({ procCode: '00100' })]), registry: badRegistry });
    const d = det(result, 'L1');
    expect(d.disposition).toBe('ENGINE_ERROR');
    expect(d.flags.some((f) => f.code === 'ENGINE.RULE_FAULT' && f.message.includes('NOT.IN.MANIFEST'))).toBe(true);
  });
});
