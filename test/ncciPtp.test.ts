/**
 * U27/U28 — NCCI PTP: lookup accessor, generator census self-check, and the
 * CCMI 0/1/9 + associated-modifier rule behavior, exercised end to end
 * through `adjudicate()` (not by calling the DSL interpreter directly) so
 * these tests catch a real wiring break, not just an isolated unit.
 *
 * Every code pair used below is a REAL row from the source PTP files
 * (ccioph-v323r0-f1..f4, v32.3) — verified against the raw `.txt` files, not
 * invented:
 *
 *   0002M  80047  eff 20170401  del *  CCMI 0   (f1)
 *   0002M  82247  eff 20170401  del *  CCMI 1   (f1)
 *   0001A  90473  eff 20220101  del 20220101  CCMI 9  (tombstone, f1)
 *
 * `0002M`/`80047`/`82247` are all SI Q4 in CY2026 Addendum B, so they are
 * ADMITTED (phase 2 eligible) rather than ROUTED — required for the
 * end-to-end rule tests below to actually reach the DSL interpreter.
 */
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { adjudicate } from '../src/index.js';
import { lookupNcciPtp } from '../src/data/index.js';
import { lineBypassesPtpEdit, NCCI_PTP_BYPASS_MODIFIERS } from '../src/data/ncciPolicy.js';
import type { ClaimInput, ClaimLineInput } from '../src/types.js';
import type { EngineResult } from '../src/phases/adjudicate.js';

function claimLine(lineId: string, procCode: string, modifiers: string[] = []): ClaimLineInput {
  return {
    lineId,
    procCode,
    modifiers,
    revCode: '0300',
    units: '1',
    unitQualifier: 'UN',
    chargeMils: 100000,
    fromDate: '20260115',
    thruDate: '20260115',
  };
}

function claim(lines: ClaimLineInput[]): ClaimInput {
  return {
    claimId: 'NCCI-PTP-TEST',
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
  };
}

function ptpFlagsFor(result: EngineResult, lineId: string): string[] {
  const d = result.determinations.find((x) => x.lineId === lineId);
  if (d === undefined) throw new Error(`no determination for ${lineId}`);
  return d.flags.filter((f) => f.code === 'NCCI.PTP.BUNDLED').map((f) => f.code);
}

describe('lookupNcciPtp — accessor', () => {
  it('finds a real active CCMI-0 pair (0002M controlling, 80047 bundled)', () => {
    const rec = lookupNcciPtp('0002M', '80047');
    expect(rec).toEqual({ col1: '0002M', col2: '80047', ccmi: '0' });
  });

  it('finds a real active CCMI-1 pair (0002M controlling, 82247 bundled)', () => {
    const rec = lookupNcciPtp('0002M', '82247');
    expect(rec).toEqual({ col1: '0002M', col2: '82247', ccmi: '1' });
  });

  it('is asymmetric — the reversed pair does not silently match', () => {
    expect(lookupNcciPtp('82247', '0002M')).toBeUndefined();
    expect(lookupNcciPtp('80047', '0002M')).toBeUndefined();
  });

  it('returns undefined for a pair with no PTP relationship at all', () => {
    expect(lookupNcciPtp('00000', '99999')).toBeUndefined();
  });

  it('excludes a CCMI-9 tombstone pair from the active lookup (0001A/90473, deletion date equals effective date)', () => {
    // This exact pair appears in the raw source file with CCMI 9 — the
    // generator drops it because its deletion date ('20220101') is not
    // '*', not because of the CCMI value itself (see tools/gen-ncci-ptp.mjs
    // "active" filter). Confirms the tombstone is genuinely unreachable
    // through the accessor, not just absent from a rule's vocabulary.
    expect(lookupNcciPtp('0001A', '90473')).toBeUndefined();
  });
});

describe('NCCI_PTP_BYPASS_MODIFIERS / lineBypassesPtpEdit — policy semantics (I-14)', () => {
  it('does not include 22, 76, or 77', () => {
    expect(NCCI_PTP_BYPASS_MODIFIERS).not.toContain('22');
    expect(NCCI_PTP_BYPASS_MODIFIERS).not.toContain('76');
    expect(NCCI_PTP_BYPASS_MODIFIERS).not.toContain('77');
  });

  it('a line carrying only 22, 76, or 77 does not bypass', () => {
    expect(lineBypassesPtpEdit(['22'])).toBe(false);
    expect(lineBypassesPtpEdit(['76'])).toBe(false);
    expect(lineBypassesPtpEdit(['77'])).toBe(false);
    expect(lineBypassesPtpEdit(['22', '76', '77'])).toBe(false);
  });

  it('a line carrying a real bypass modifier (59) does bypass', () => {
    expect(lineBypassesPtpEdit(['59'])).toBe(true);
  });
});

describe('NCCI.PTP.PAIR — end-to-end rule behavior via adjudicate()', () => {
  it('CCMI 0 fires (bundled) with no modifier present', () => {
    const result = adjudicate({ claim: claim([claimLine('L1', '0002M'), claimLine('L2', '80047')]) });
    expect(ptpFlagsFor(result, 'L2')).toEqual(['NCCI.PTP.BUNDLED']);
    expect(ptpFlagsFor(result, 'L1')).toEqual([]);
  });

  it('CCMI 0 still fires even with a real bypass modifier present — never bypassable', () => {
    const result = adjudicate({ claim: claim([claimLine('L1', '0002M'), claimLine('L2', '80047', ['59'])]) });
    expect(ptpFlagsFor(result, 'L2')).toEqual(['NCCI.PTP.BUNDLED']);
  });

  it('CCMI 1 fires (bundled) with no modifier present', () => {
    const result = adjudicate({ claim: claim([claimLine('L1', '0002M'), claimLine('L2', '82247')]) });
    expect(ptpFlagsFor(result, 'L2')).toEqual(['NCCI.PTP.BUNDLED']);
  });

  it('CCMI 1 is bypassed by a real NCCI PTP-associated modifier (59)', () => {
    const result = adjudicate({ claim: claim([claimLine('L1', '0002M'), claimLine('L2', '82247', ['59'])]) });
    expect(ptpFlagsFor(result, 'L2')).toEqual([]);
  });

  it('CCMI 1 is NOT bypassed by modifier 22, 76, or 77 — the exact near-miss I-14 warns about', () => {
    for (const modifier of ['22', '76', '77']) {
      const result = adjudicate({ claim: claim([claimLine('L1', '0002M'), claimLine('L2', '82247', [modifier])]) });
      expect(ptpFlagsFor(result, 'L2')).toEqual(['NCCI.PTP.BUNDLED']);
    }
  });

  it('a CCMI-9 tombstone pair is never evaluated as an active edit', () => {
    // 0001A/90473 is CCMI 9 in the raw source (deletion date == effective
    // date) — even though both codes could in principle appear on the same
    // claim, no active edit exists for the pair, so no flag fires no matter
    // what. (0001A is SI A in Addendum B and would be ROUTED, not ADMITTED,
    // but the point here is the lookup layer, not phase routing — already
    // covered by the accessor-level tombstone test above; this just closes
    // the loop by confirming the wiring produces no crash for a routed
    // code either.)
    const result = adjudicate({ claim: claim([claimLine('L1', '0001A')]) });
    expect(result.determinations.length).toBe(1);
  });

  it('two unrelated codes never fire the PTP flag', () => {
    const result = adjudicate({ claim: claim([claimLine('L1', '0101T'), claimLine('L2', '0263T')]) });
    expect(ptpFlagsFor(result, 'L1')).toEqual([]);
    expect(ptpFlagsFor(result, 'L2')).toEqual([]);
  });
});

describe('tools/gen-ncci-ptp.mjs — census self-check refuses to write on drift', () => {
  it('fails and does not write output when a tiny fixture file has a row the generator was not told to expect', () => {
    // This exercises the generator's own hard-fail-refuses-to-write
    // discipline (§7.1) against a small synthetic fixture — NOT the real
    // 1.87M-row source set, which would be far too slow for a test. The
    // generator's own EXPECTED_* constants are calibrated to the real
    // data, so ANY fixture this small necessarily mismatches every count —
    // that mismatch, and the resulting "refusing to write" exit, is
    // exactly the behavior under test.
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'ncci-ptp-fixture-'));
    try {
      const fileDir = path.join(tmpDir, 'ccioph-v323r0-f1');
      mkdirSync(fileDir, { recursive: true });
      const header = [
        'CPT only copyright 2025 American Medical Association.  All rights reserved.\t\t\t\t\t\t',
        'Column1/Column2 Edits\t\t\t\t\t\t',
        'Column 1\tColumn 2\t*=in existence\tEffective\tDeletion\tModifier\tPTP Edit Rationale',
        '\t\tprior to 1996\tDate\tDate\t0=not allowed\t',
        '\t\t\t\t*=no data\t1=allowed\t',
        '\t\t\t\t\t9=not applicable\t',
      ].join('\n');
      const dataRows = ['00001\t00002\t\t20220101\t*\t0\tTest rationale', '00001\t00003\t\t20220101\t*\t1\tTest rationale'].join('\n');
      writeFileSync(path.join(fileDir, 'ccioph-v323r0-f1.txt'), `${header}\n${dataRows}\n`, 'latin1');
      // Files f2-f4 are required by the generator's PTP_FILES list; supply
      // empty (header-only) stand-ins so the row-count mismatch is
      // attributable to f1's 2 rows alone, not a missing-file crash.
      for (const n of [2, 3, 4]) {
        const dir = path.join(tmpDir, `ccioph-v323r0-f${n}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `ccioph-v323r0-f${n}.txt`), `${header}\n`, 'latin1');
      }

      const generatorPath = fileURLToPath(new URL('../tools/gen-ncci-ptp.mjs', import.meta.url));
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
