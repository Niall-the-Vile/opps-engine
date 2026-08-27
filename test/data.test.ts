import { describe, expect, it } from 'vitest';
import { OPPS_ROWS } from '../src/data/opps.cy2026.js';
import { CLFS_ROWS } from '../src/data/clfs.cy2026.js';
import { HCPCS_TERM_ROWS } from '../src/data/hcpcsTerm.cy2026.js';
import { lookupOpps, lookupClfs, getHcpcsTermDate, isDmepos, isMpfs, isAfs } from '../src/data/index.js';

const EXPECTED_SI_HISTOGRAM: Record<string, number> = {
  J1: 3445, N: 2076, A: 2008, M: 1549, C: 1438, Q4: 1346, E1: 1334, T: 1052,
  B: 1017, Y: 778, Q1: 741, S: 674, K: 526, S1: 298, Q3: 183, Q2: 177,
  G: 117, L: 48, E2: 43, R: 41, V: 23, H: 19, U: 17, H1: 13, J2: 13,
  K1: 5, P: 4, F: 1,
};

describe('U3 — opps.cy2026.ts (Addendum B)', () => {
  it('carries the full §8.1 census: 18,986 rows', () => {
    expect(OPPS_ROWS.length).toBe(18986);
  });

  it('has no duplicate HCPCS keys', () => {
    const codes = new Set(OPPS_ROWS.map((r) => r[0]));
    expect(codes.size).toBe(OPPS_ROWS.length);
  });

  it('matches the §8.1 shape census exactly against emitted (post-sanitization) codes', () => {
    // §8.1's published counts (9802/7455/607/565/541/14, summing to 18984)
    // are *pre*-sanitization: A4341 and G0465 carried a trailing 0xFF byte
    // in the source and so matched no 5-character shape until the
    // generator stripped it. The array this module emits already has that
    // byte stripped (see the "sanitized codes resolve" test), so matching
    // shapes against OPPS_ROWS finds both recovered codes sitting in the
    // AV bucket: 7455 + 2 = 7457, and the total is 18986 either way.
    const patterns: [string, RegExp, number][] = [
      ['d5 (CPT I)', /^\d{5}$/, 9802],
      ['AV (HCPCS II)', /^[A-V]\d{4}$/, 7457],
      ['T (CPT III)', /^\d{4}T$/, 607],
      ['F (CPT II)', /^\d{4}F$/, 565],
      ['U (PLA)', /^\d{4}U$/, 541],
      ['M (MAA)', /^\d{4}M$/, 14],
    ];
    let matched = 0;
    for (const [, re, expected] of patterns) {
      const count = OPPS_ROWS.filter((r) => re.test(r[0])).length;
      expect(count).toBe(expected);
      matched += count;
    }
    expect(matched).toBe(18986);
  });

  it('carries exactly 7,312 rows with a payment rate', () => {
    const rated = OPPS_ROWS.filter((r) => r[4] !== null).length;
    expect(rated).toBe(7312);
  });

  it('matches the §3.5 SI histogram exactly (28 distinct SIs)', () => {
    const histogram: Record<string, number> = {};
    for (const r of OPPS_ROWS) {
      histogram[r[1]] = (histogram[r[1]] ?? 0) + 1;
    }
    expect(Object.keys(histogram).sort()).toEqual(Object.keys(EXPECTED_SI_HISTOGRAM).sort());
    for (const [si, expected] of Object.entries(EXPECTED_SI_HISTOGRAM)) {
      expect(histogram[si]).toBe(expected);
    }
  });

  it('resolves the 2 byte-sanitized codes (A4341, G0465)', () => {
    const a4341 = lookupOpps('A4341');
    expect(a4341).toBeDefined();
    expect(a4341?.si).toBe('N');

    const g0465 = lookupOpps('G0465');
    expect(g0465).toBeDefined();
    expect(g0465?.si).toBe('T');
  });

  it('spot value: G0463 — SI J2, APC 5012, weight 1.4879, rate 136020 mils', () => {
    const rec = lookupOpps('G0463');
    expect(rec).toBeDefined();
    expect(rec?.si).toBe('J2');
    expect(rec?.apc).toBe('5012');
    expect(rec?.weight).toBeCloseTo(1.4879, 4);
    expect(rec?.rateMils).toBe(136020);
  });

  it('spot value: 59025 — SI T, APC 5411, rate 206550 mils', () => {
    const rec = lookupOpps('59025');
    expect(rec).toBeDefined();
    expect(rec?.si).toBe('T');
    expect(rec?.apc).toBe('5411');
    expect(rec?.rateMils).toBe(206550);
  });

  it('spot value: 99205 — SI B, no APC, no rate', () => {
    const rec = lookupOpps('99205');
    expect(rec).toBeDefined();
    expect(rec?.si).toBe('B');
    expect(rec?.apc).toBeNull();
    expect(rec?.rateMils).toBeNull();
  });

  it('lookupOpps returns undefined for an absent code', () => {
    expect(lookupOpps('ZZZZZ')).toBeUndefined();
  });
});

describe('U4 — clfs.cy2026.ts', () => {
  it('carries 2,179 records over 2,055 distinct codes', () => {
    expect(CLFS_ROWS.length).toBe(2179);
    const codes = new Set(CLFS_ROWS.map((r) => r[0]));
    expect(codes.size).toBe(2055);
  });

  it('keys by (code, modifier) — 124 QW rows do not collide with the bare row', () => {
    const qwRows = CLFS_ROWS.filter((r) => r[1] === 'QW');
    expect(qwRows.length).toBe(124);
    for (const row of qwRows) {
      const code = row[0];
      const bare = lookupClfs(code, '');
      const qw = lookupClfs(code, 'QW');
      expect(bare).toBeDefined();
      expect(qw).toBeDefined();
      expect(bare).not.toBe(qw);
    }
  });

  it('excludes a rate for all 49 INDICATOR=L, RATE=0.00 rows', () => {
    const zeroRows = CLFS_ROWS.filter((r) => r[4] === null);
    expect(zeroRows.length).toBe(49);
    for (const row of zeroRows) {
      expect(row[3]).toBe('L');
    }
  });

  it('carries EFF_DATE — 17 rows effective 20260401 (0614U-0630U)', () => {
    const april = CLFS_ROWS.filter((r) => r[2] === '20260401');
    expect(april.length).toBe(17);
    const codes = april.map((r) => r[0]).sort();
    expect(codes[0]).toBe('0614U');
    expect(codes[codes.length - 1]).toBe('0630U');
    const jan = CLFS_ROWS.filter((r) => r[2] === '20260101');
    expect(jan.length).toBe(2162);
  });

  it('spot values: 36415 $9.34, 84112 $98.11, 81001 $3.17 (mils)', () => {
    expect(lookupClfs('36415', '')?.rateMils).toBe(9340);
    expect(lookupClfs('84112', '')?.rateMils).toBe(98110);
    expect(lookupClfs('81001', '')?.rateMils).toBe(3170);
  });
});

describe('U5 — hcpcsTerm.cy2026.ts (historical validity index)', () => {
  it('carries exactly 1,300 term-dated codes', () => {
    expect(HCPCS_TERM_ROWS.length).toBe(1300);
  });

  it('carries no term date in 2026 or later', () => {
    for (const [, termDate] of HCPCS_TERM_ROWS) {
      expect(termDate < '20260101').toBe(true);
    }
  });

  it('getHcpcsTermDate resolves a known historical code and misses a current one', () => {
    const [sampleCode] = HCPCS_TERM_ROWS[0] ?? [undefined];
    expect(sampleCode).toBeDefined();
    if (sampleCode !== undefined) {
      expect(getHcpcsTermDate(sampleCode)).toBeDefined();
    }
    // G0463 is live in current Addendum B — must not appear in the
    // historical validity index.
    expect(getHcpcsTermDate('G0463')).toBeUndefined();
  });
});

describe('U6 — schedule-derivation membership sets', () => {
  it('DMEPOS/MPFS membership sets are non-empty; AFS is empty (unsourced .xlsx)', () => {
    expect(isDmepos('A4217')).toBe(true);
    expect(isAfs('A4217')).toBe(false);
    // AFS is empty for every code in milestone 1.
    expect(isAfs('00000')).toBe(false);
  });

  it('reproduces the §3.4 reference buckets: 672 of 2,008 SI A codes in CLFS', () => {
    const siACodes = OPPS_ROWS.filter((r) => r[1] === 'A').map((r) => r[0]);
    expect(siACodes.length).toBe(2008);
    const inClfs = siACodes.filter((c) => lookupClfs(c, '') !== undefined).length;
    expect(inClfs).toBe(672);
  });

  it('reproduces the §3.4 reference buckets: 662 of 778 SI Y codes in DMEPOS', () => {
    const siYCodes = OPPS_ROWS.filter((r) => r[1] === 'Y').map((r) => r[0]);
    expect(siYCodes.length).toBe(778);
    const inDmepos = siYCodes.filter((c) => isDmepos(c)).length;
    expect(inDmepos).toBe(662);
  });

  it('isMpfs is a real membership check (not vacuously true/false)', () => {
    const someMpfsCode = OPPS_ROWS.find((r) => isMpfs(r[0]));
    expect(someMpfsCode).toBeDefined();
    const someNonMpfsCode = OPPS_ROWS.find((r) => !isMpfs(r[0]));
    expect(someNonMpfsCode).toBeDefined();
  });
});
