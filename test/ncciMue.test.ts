/**
 * U29/U30 — NCCI MUE: lookup accessor and generator census self-check.
 *
 * `MUE.LIMIT` itself stays a reserved slot (see its "note" in
 * src/registry/opps.dispositions.json) — comparing a claim line's actual
 * reported units against an MUE value requires spec §19.2 (units
 * semantics), still open per D89. So there is no end-to-end
 * adjudicate()-level rule-behavior section here, unlike ncciPtp.test.ts:
 * everything below tests the DATA LAYER (`lookupNcciMue`,
 * `mueZeroMeansNotPayable`), which is fully live regardless.
 *
 * Real codes below (verified against
 * MCR_MUE_OutpatientHospitalServices_Eff_10-01-2026.csv, not invented):
 *
 *   0001U  value 1  MAI 2 "Date of Service Edit: Policy"  rationale "Code Descriptor / CPT Instruction"
 *   0002M  value 1  MAI 3 "Date of Service Edit: Clinical" rationale "Nature of Analyte"
 *   V5364  value 0  MAI 3 "Date of Service Edit: Clinical" rationale "CMS Policy"
 */
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { lookupNcciMue } from '../src/data/index.js';
import { mueZeroMeansNotPayable } from '../src/data/ncciPolicy.js';

describe('lookupNcciMue — accessor', () => {
  it('finds a real MAI-2 code with a nonzero value', () => {
    const rec = lookupNcciMue('0001U');
    expect(rec).toEqual({ code: '0001U', mueValue: 1, mai: 2, rationale: 'Code Descriptor / CPT Instruction' });
  });

  it('finds a real MAI-3 code with a nonzero value', () => {
    const rec = lookupNcciMue('0002M');
    expect(rec).toEqual({ code: '0002M', mueValue: 1, mai: 3, rationale: 'Nature of Analyte' });
  });

  it('finds a real MUE-0 code', () => {
    const rec = lookupNcciMue('V5364');
    expect(rec).toEqual({ code: 'V5364', mueValue: 0, mai: 3, rationale: 'CMS Policy' });
  });

  it('returns undefined for a code with no MUE row at all — a gap, not a pass (I-34)', () => {
    expect(lookupNcciMue('ZZZZZ')).toBeUndefined();
  });
});

describe('mueZeroMeansNotPayable — §4.4 semantics', () => {
  it('an MUE value of 0 reads as "not payable," not "no limit"', () => {
    expect(mueZeroMeansNotPayable(0)).toBe(true);
  });

  it('a nonzero MUE value does not read as "not payable"', () => {
    expect(mueZeroMeansNotPayable(1)).toBe(false);
    expect(mueZeroMeansNotPayable(999)).toBe(false);
  });

  it('the real MUE-0 code V5364 reads as not payable through the full accessor chain', () => {
    const rec = lookupNcciMue('V5364');
    expect(rec).toBeDefined();
    expect(mueZeroMeansNotPayable(rec!.mueValue)).toBe(true);
  });
});

describe('tools/gen-ncci-mue.mjs — census self-check refuses to write on drift', () => {
  it('fails and does not write output when a tiny fixture file does not match the expected row count', () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'ncci-mue-fixture-'));
    try {
      const dir = path.join(tmpDir, 'facilityoutpatienthospitalservicesmuetable-effective-10-01-2026');
      mkdirSync(dir, { recursive: true });
      const csv = [
        '"Current Procedural Terminology (CPT) codes... copyright 2025 American Medical Association.",,,',
        '"HCPCS/',
        'CPT Code",Outpatient Hospital Services MUE Values,MUE Adjudication Indicator,MUE Rationale',
        '0001U,1,2 Date of Service Edit: Policy,Code Descriptor / CPT Instruction',
        '0002M,1,3 Date of Service Edit: Clinical,Nature of Analyte',
      ].join('\n');
      writeFileSync(
        path.join(dir, 'MCR_MUE_OutpatientHospitalServices_Eff_10-01-2026.csv'),
        `${csv}\n`,
        'latin1',
      );

      const generatorPath = fileURLToPath(new URL('../tools/gen-ncci-mue.mjs', import.meta.url));
      let threw = false;
      try {
        execFileSync(process.execPath, [generatorPath, tmpDir], { stdio: 'pipe' });
      } catch (err) {
        threw = true;
        const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
        expect(stderr).toContain('FAIL:');
        expect(stderr).toContain('hard failure');
      }
      expect(threw).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
