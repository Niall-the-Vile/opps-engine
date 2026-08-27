import { describe, expect, it } from 'vitest';
import { resolve } from '../src/routing.js';
import { OPPS_ROWS } from '../src/data/opps.cy2026.js';
import { lookupClfs } from '../src/data/index.js';

describe('U7 — routing.ts resolver (spec §2.3 / §3.4)', () => {
  it('routes a bare Q4 lab code to CLFS once converted to effective SI A: 36415/84112/81001', () => {
    expect(resolve('36415', 'A')).toEqual({ schedule: 'CLFS', rateMils: 9340, basis: 'CLFS' });
    expect(resolve('84112', 'A')).toEqual({ schedule: 'CLFS', rateMils: 98110, basis: 'CLFS' });
    expect(resolve('81001', 'A')).toEqual({ schedule: 'CLFS', rateMils: 3170, basis: 'CLFS' });
  });

  it('routes a code with no OPPS rate and no membership anywhere to null, degrading honestly', () => {
    const result = resolve('ZZZZZ', 'A');
    expect(result.schedule).toBeNull();
    expect(result.rateMils).toBeNull();
    expect(result.basis).toBe('ROUTED_UNKNOWN');
  });

  it('never routes an OPPS-rated code to a Tier 2 schedule when its SI pays its own APC', () => {
    // G0463 — SI J2, rated. J2 pays its own visit APC (§9.4), so even if
    // some future caller mistakenly asked routing to resolve it, it must
    // never fall through to CLFS/DMEPOS/AFS/MPFS.
    const result = resolve('G0463', 'J2');
    expect(result).toEqual({ schedule: 'OPPS', rateMils: 136020, basis: 'OPPS_APC' });
  });

  it('§3.4 precedence guard: no SI Q1 code with an OPPS rate resolves to CLFS', () => {
    const q1Rated = OPPS_ROWS.filter((r) => r[1] === 'Q1' && r[4] !== null);
    expect(q1Rated.length).toBeGreaterThan(0);

    let guardCases = 0;
    for (const row of q1Rated) {
      const code = row[0];
      const inClfs = lookupClfs(code, '') !== undefined;
      const result = resolve(code, 'Q1');
      expect(result.schedule).not.toBe('CLFS');
      if (inClfs) {
        // These are exactly the codes precedence step 1 exists to guard —
        // §3.4 names 10 of them.
        guardCases += 1;
        expect(result.schedule).toBe('OPPS');
        expect(result.rateMils).toBe(row[4]);
        expect(result.basis).toBe('OPPS_APC');
      }
    }
    expect(guardCases).toBe(10);
  });

  it('DMEPOS and AFS routes never carry a price (§3.2 Tier 2 is named-only)', () => {
    // Find a code that is DMEPOS-routed under effective SI Y and has no
    // OPPS rate or CLFS record, so precedence actually reaches DMEPOS.
    const siYCodes = OPPS_ROWS.filter((r) => r[1] === 'Y');
    const candidate = siYCodes.find((r) => {
      const result = resolve(r[0], 'Y');
      return result.schedule === 'DMEPOS';
    });
    expect(candidate).toBeDefined();
    if (candidate !== undefined) {
      const result = resolve(candidate[0], 'Y');
      expect(result.rateMils).toBeNull();
      expect(result.basis).toBe('ROUTED_DMEPOS');
    }
  });

  it('is a leaf module: exposes only resolve() and the Schedule/RouteResult types', () => {
    // Smoke check that the module surface stayed small — not a real
    // reflection test, just guards against routing.ts growing an import
    // of trace.ts or phases/* by accident (those would fail typecheck
    // long before this test runs, but this documents the intent).
    expect(typeof resolve).toBe('function');
  });
});
