// test/fix-q4-routed-basis.test.ts
//
// Regression coverage for the §9.3 false-provenance defect: an unpackaged
// Q4 line that converts to SI A used to report `basis: 'CLFS'`
// unconditionally, even for the CY2026 Q4 codes that have no CLFS row —
// or any other loaded fee-schedule row — at all. That fabricated
// provenance: it told a reader "this prices under the clinical lab fee
// schedule, the rate is just missing" for a code that matched nothing
// anywhere.
//
// The fix (src/phases/adjudicate.ts, the `det.routed` branch) checks CLFS
// membership directly via `lookupClfs` (src/data/index.ts) before trusting
// `basis: 'CLFS'`: present -> CLFS (truthful, even with no usable rate
// row); absent, and no match in DMEPOS/AFS/MPFS either -> report whatever
// `routing.resolve()` actually found (ROUTED_UNKNOWN for every affected
// CY2026 code) and raise `OPPS.Q4.NO_SCHEDULE_MATCH`.

import { describe, expect, it } from 'vitest';
import { adjudicate } from '../src/index.js';
import { OPPS_ROWS } from '../src/data/opps.cy2026.js';
import { lookupClfs } from '../src/data/index.js';
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

/** Adjudicate a single bare code as its own one-line claim — the §9.3 Q4-conversion path. */
function adjudicateAlone(code: string): Determination {
  const result = adjudicate({ claim: claim({}, [claimLine({ procCode: code })]) });
  return det(result, 'L1');
}

// The 6 CY2026 Q4 codes with no CLFS row and no match in any other loaded
// fee schedule (DMEPOS/AFS/MPFS) either — verified directly against the
// generated data files (src/data/opps.cy2026.ts, src/data/clfs.cy2026.ts,
// src/data/dmepos.cy2026.ts, src/data/afs.cy2026.ts, src/data/mpfs.cy2026.ts)
// before writing this test, not assumed from the bug report.
const NO_SCHEDULE_MATCH_CODES = ['81099', '84999', '85999', '88749', '0602T', '0603T'];

describe('§9.3 Q4-conversion basis — no fabricated CLFS provenance', () => {
  it('81099 (no CLFS row, no match anywhere): reports ROUTED_UNKNOWN, not CLFS, and carries the disclosure flag', () => {
    const d = adjudicateAlone('81099');
    expect(d.resolvedSI).toBe('Q4');
    expect(d.effectiveSI).toBe('A');
    expect(d.disposition).toBe('ADJUDICATED');
    expect(d.basis).not.toBe('CLFS');
    expect(d.basis).toBe('ROUTED_UNKNOWN');
    expect(d.status).toBe('PAID_UNPRICED');
    expect(d.flags.some((f) => f.code === 'OPPS.Q4.NO_SCHEDULE_MATCH')).toBe(true);
  });

  it.each(NO_SCHEDULE_MATCH_CODES)('%s: same honest-degradation behavior as 81099', (code) => {
    const d = adjudicateAlone(code);
    expect(d.resolvedSI).toBe('Q4');
    expect(d.effectiveSI).toBe('A');
    expect(d.basis).not.toBe('CLFS');
    expect(d.basis).toBe('ROUTED_UNKNOWN');
    expect(d.status).toBe('PAID_UNPRICED');
    const flag = d.flags.find((f) => f.code === 'OPPS.Q4.NO_SCHEDULE_MATCH');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('gap');
    expect(flag?.lineIds).toEqual(['L1']);
  });

  it('a real CY2026 Q4 code WITH a CLFS row still reports basis CLFS (the truthful case is unchanged)', () => {
    // Find a genuine Q4 code (not hard-invented) that is CLFS-present, by
    // cross-referencing the generated OPPS and CLFS data directly.
    const q4CodesWithClfs = OPPS_ROWS.filter((r) => r[1] === 'Q4' && lookupClfs(r[0], '') !== undefined);
    expect(q4CodesWithClfs.length).toBeGreaterThan(0);
    const row = q4CodesWithClfs[0];
    if (row === undefined) throw new Error('unreachable: length just asserted > 0');
    const d = adjudicateAlone(row[0]);
    expect(d.resolvedSI).toBe('Q4');
    expect(d.effectiveSI).toBe('A');
    expect(d.basis).toBe('CLFS');
    // A CLFS-present code must never carry the "no schedule match" disclosure.
    expect(d.flags.some((f) => f.code === 'OPPS.Q4.NO_SCHEDULE_MATCH')).toBe(false);
  });

  it('no unpackaged-Q4 conversion ever reports basis OPPS_APC (§9.3\'s actual invariant), across every Q4 code in the loaded data', () => {
    const q4Codes = OPPS_ROWS.filter((r) => r[1] === 'Q4').map((r) => r[0]);
    expect(q4Codes.length).toBeGreaterThan(1000); // sanity: the full CY2026 Q4 census, not a stub
    for (const code of q4Codes) {
      const d = adjudicateAlone(code);
      // Only assert the invariant for lines that actually took the §9.3
      // Q4-conversion path (unpackaged, converted A, routed) — a line
      // rejected or bundled some other way is out of scope for this
      // invariant, which is specifically about the conversion branch.
      if (d.resolvedSI === 'Q4' && d.effectiveSI === 'A' && d.disposition === 'ADJUDICATED') {
        expect(d.basis).not.toBe('OPPS_APC');
      }
    }
  });
});
