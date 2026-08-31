// test/fix-q4-companion-crash.test.ts
//
// Regression coverage for two stacked defects that together made
// `adjudicate()` throw an UNCAUGHT exception (zero output) on any claim
// where a Q4 line's companion-packaging trigger set already bundled a
// higher-rateMils Q1/Q2 line earlier in the same band:
//
// (a) OPPS.PKG.Q4.COMPANION (src/registry/opps.packaging.json) ranked its
//     `bundleUnder`'s "among" pool (J1/J2/S/T/V/Q1/Q2/Q3) without excluding
//     already-BUNDLED lines, AND declared band 4000 subBand "a" / epoch
//     "E2" — the epoch snapshot taken *before* subBand a's own
//     OPPS.PKG.Q1.COMPANION / OPPS.PKG.Q2.COMPANION rules run. Adding only
//     the `not(statusIn(['BUNDLED']))` guard (matching
//     OPPS.PKG.Q.SURVIVOR_TIEBREAK's "among") was verified NOT sufficient
//     by itself: `bundleUnder`'s ranking reads the rule's declared epoch's
//     frozen snapshot (dsl/evaluate.ts's `rankAmongLines`, fed by
//     `EffectApplicationContext.claim`), not live per-line state, so a
//     subBand-a rule's guard can never see a same-window subBand-a write.
//     The rule was moved to subBand "b" / epoch "E3a" (the same fix
//     OPPS.PKG.Q.SURVIVOR_TIEBREAK already applies, per that rule's own
//     note) so the guard's `statusIn(['BUNDLED'])` check actually reads
//     post-subBand-a state.
//
// (b) Even with (a) unfixed, the per-line fault WAS contained line-locally
//     (§12.8) inside dsl/evaluate.ts's `bundleUnder` case — but the halted
//     line's SKIPPED evaluation for every subsequent rule
//     (`runLineScopedRuleForLine`'s halt branch) stuffed a line-specific
//     halt-reason string into that evaluation's `counterfactual`. Since a
//     counterfactual must be a pure function of the rule's own "when"
//     clause (§5.3a), and a non-halted line evaluating the very same rule
//     produces a different, when-derived counterfactual string,
//     `trace.ts`'s `collectCounterfactuals` — which dedupes by ruleId and
//     hard-throws on divergence — blew up the *entire claim*, turning a
//     contained per-line fault into a total, zero-output crash. The fix:
//     a halted line's SKIPPED evaluation now records `counterfactual:
//     null` (the halt reason is still visible via `outcome: 'SKIPPED'`
//     plus `examined.detail.{haltReason,haltedByRuleId}`, and via the
//     halting rule's own ERRORED/FIRED-with-stop evaluation already
//     recorded on that same line).
//
// Both defects had to be fixed for the engine to degrade correctly per
// §12.8 instead of crashing outright.

import { describe, expect, it } from 'vitest';
import { adjudicate } from '../src/index.js';
import { EXEMPT_RULES, PACKAGING_RULES, DISPOSITION_RULES } from '../src/registry/index.js';
import type { ClaimInput, ClaimLineInput } from '../src/types.js';
import type { Determination, EngineResult } from '../src/phases/adjudicate.js';

// ===========================================================================
// Shared claim-building helpers (same shape as test/fix-q4-routed-basis.test.ts).
// ===========================================================================

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

function claim(lines: ClaimLineInput[]): ClaimInput {
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
  };
}

function threeLineClaim(codes: readonly [string, string, string]): ClaimInput {
  return claim([
    claimLine({ lineId: 'L1', procCode: codes[0] }),
    claimLine({ lineId: 'L2', procCode: codes[1] }),
    claimLine({ lineId: 'L3', procCode: codes[2] }),
  ]);
}

function det(result: EngineResult, lineId: string): Determination {
  const d = result.determinations.find((x) => x.lineId === lineId);
  if (d === undefined) throw new Error(`no determination for ${lineId}`);
  return d;
}

// ===========================================================================
// 1 & 2 — the two exact reproduction cases from the bug report. Both used to
// throw an uncaught exception out of adjudicate() with zero output.
// ===========================================================================

describe('Q4.COMPANION crash — exact reproduction cases adjudicate cleanly', () => {
  it('0101T G0516 0002M: does not throw, and returns a determination for all three lines', () => {
    let result: EngineResult | undefined;
    expect(() => {
      result = adjudicate({ claim: threeLineClaim(['0101T', 'G0516', '0002M']) });
    }).not.toThrow();
    if (result === undefined) throw new Error('unreachable: assignment above did not throw');

    expect(result.determinations).toHaveLength(3);
    expect(result.engineStatus).toBe('OK');
    for (const d of result.determinations) expect(d.disposition).not.toBe('ENGINE_ERROR');

    const t = det(result, 'L1'); // 0101T, SI T
    const q1 = det(result, 'L2'); // G0516, SI Q1
    const q4 = det(result, 'L3'); // 0002M, SI Q4

    expect(t.status).toBe('PAID');
    // Both companion lines bundle under the T line, the highest-rateMils
    // survivor of the ranking pool once already-bundled lines are excluded
    // — never under each other, and never crashing while ranking.
    expect(q1.status).toBe('BUNDLED');
    expect(q1.bundledUnder).toBe('L1');
    expect(q4.status).toBe('BUNDLED');
    expect(q4.bundledUnder).toBe('L1');
  });

  it('68841 0640T 0002M: does not throw, and returns a determination for all three lines', () => {
    let result: EngineResult | undefined;
    expect(() => {
      result = adjudicate({ claim: threeLineClaim(['68841', '0640T', '0002M']) });
    }).not.toThrow();
    if (result === undefined) throw new Error('unreachable: assignment above did not throw');

    expect(result.determinations).toHaveLength(3);
    expect(result.engineStatus).toBe('OK');
    for (const d of result.determinations) expect(d.disposition).not.toBe('ENGINE_ERROR');

    const q1 = det(result, 'L1'); // 68841, SI Q1
    const t = det(result, 'L2'); // 0640T, SI T
    const q4 = det(result, 'L3'); // 0002M, SI Q4

    expect(t.status).toBe('PAID');
    expect(q1.status).toBe('BUNDLED');
    expect(q1.bundledUnder).toBe('L2');
    expect(q4.status).toBe('BUNDLED');
    expect(q4.bundledUnder).toBe('L2');
  });
});

// ===========================================================================
// 3 — regression coverage for fix (b) alone, independent of fix (a). Builds
// a tiny synthetic registry (not the real OPPS packaging rules — this
// deliberately never references OPPS.PKG.Q4.COMPANION or anything in
// src/registry/*.json) that reproduces exactly the shape of the
// containment hole: one line takes a line-local engine fault, and a LATER
// rule then gets SKIPPED for that line while firing/not-firing normally for
// an unrelated line. Before fix (b), trace.ts's collectCounterfactuals saw
// two different strings recorded for that later rule's ruleId (the halt
// string vs. the real when-derived string) and threw, killing the whole
// claim. This test must fail if fix (b) is reverted, even with fix (a)
// fully intact, since it never touches the real Q4.COMPANION rule at all.
// ===========================================================================

const FAULT_LINE_CODE = '0101T'; // any admitted code; only used to target one line via codeIn
const OTHER_CODE_1 = '0640T';
const OTHER_CODE_2 = '59025';

/**
 * Three line-scoped rules, all band 1000 / epoch E0 (so they share one
 * window and run in `order` sequence):
 *
 *   1. FAULT (order 100): scoped to just the FAULT_LINE_CODE line. Its
 *      `bundleUnder`'s "among" matches no line on the claim at all, so
 *      `rankAmongLines` returns nothing and dsl/evaluate.ts's `bundleUnder`
 *      case throws "no member of 'among' was found" — a genuine line-local
 *      engine fault, unrelated to the real Q4.COMPANION defect.
 *   2. AFTER (order 200): scope always true, `when` is a `codeIn` that
 *      matches nothing on this claim, so every non-halted line gets a real,
 *      when-derived NOT_FIRED counterfactual for this same ruleId. The
 *      halted line instead takes the SKIPPED-by-halt branch this test
 *      exists to cover.
 *   3. PAY (order 300): unconditionally pays every line it reaches, so a
 *      non-halted line finishes with a real, non-null `status` — proving
 *      it "completed" rather than merely "didn't throw."
 */
const FAULT_REGISTRY: readonly unknown[] = [
  {
    id: 'TEST.INDUCED_FAULT',
    version: '1.0',
    effectiveFrom: '20260101',
    effectiveTo: null,
    phase: 'ADJUDICATE',
    band: 1000,
    order: 100,
    epoch: 'E0',
    scopeTarget: 'line',
    citation: 'test fixture — fix-q4-companion-crash.test.ts',
    scope: { codeIn: { code: [FAULT_LINE_CODE] } },
    then: [
      {
        bundleUnder: {
          highestBy: 'rateMils',
          among: { op: 'siIn', args: { si: ['NO_SUCH_STATUS_INDICATOR'] } },
          tiebreak: 'codeAsc',
        },
      },
    ],
    note: 'Deliberately unsatisfiable "among" — forces bundleUnder to throw "no member of among was found" for exactly the targeted line, a line-local engine fault with no relationship to the real OPPS.PKG.Q4.COMPANION defect.',
  },
  {
    id: 'TEST.AFTER_FAULT',
    version: '1.0',
    effectiveFrom: '20260101',
    effectiveTo: null,
    phase: 'ADJUDICATE',
    band: 1000,
    order: 200,
    epoch: 'E0',
    scopeTarget: 'line',
    citation: 'test fixture — fix-q4-companion-crash.test.ts',
    scope: { always: {} },
    when: { codeIn: { code: ['NO_SUCH_CODE_EVER'] } },
    then: [{ stop: {} }],
    note: 'Never fires for any line (codeIn matches nothing) — every non-halted line gets this rule\'s ordinary, when-derived NOT_FIRED counterfactual. The halted line instead exercises the SKIPPED-by-halt branch this test targets.',
  },
  {
    id: 'TEST.PAY_SURVIVORS',
    version: '1.0',
    effectiveFrom: '20260101',
    effectiveTo: null,
    phase: 'ADJUDICATE',
    band: 1000,
    order: 300,
    epoch: 'E0',
    scopeTarget: 'line',
    citation: 'test fixture — fix-q4-companion-crash.test.ts',
    scope: { always: {} },
    then: [{ setStatus: { status: 'PAID' } }],
    note: 'Unconditionally pays every line it reaches, so a non-halted line finishes with a real status rather than staying null.',
  },
];

describe('containment-hole regression (fix b), independent of the registry fix (a)', () => {
  it('a forced line-local engine fault degrades that one line per §12.8 while every other line still completes, and engineStatus is PARTIAL', () => {
    let result: EngineResult | undefined;
    expect(() => {
      result = adjudicate({
        claim: threeLineClaim([FAULT_LINE_CODE, OTHER_CODE_1, OTHER_CODE_2]),
        registry: FAULT_REGISTRY,
        // 'full' so `Evaluation.counterfactual` itself is populated (not
        // compressed to `counterfactualRef` + `Result.counterfactuals`,
        // §5.3a's 'standard'-level behavior) — this test inspects the raw
        // string fix (b) touches directly.
        options: { traceLevel: 'full' },
      });
    }).not.toThrow();
    if (result === undefined) throw new Error('unreachable: assignment above did not throw');

    expect(result.determinations).toHaveLength(3);
    expect(result.engineStatus).toBe('PARTIAL');

    // The faulted line (§12.8's exact contract).
    const faulted = det(result, 'L1');
    expect(faulted.disposition).toBe('ENGINE_ERROR');
    expect(faulted.status).toBe('NOT_ADJUDICATED');
    const erroredEval = faulted.trace.find((ev) => ev.outcome === 'ERRORED');
    expect(erroredEval).toBeDefined();
    expect(erroredEval?.ruleId).toBe('TEST.INDUCED_FAULT');
    expect(faulted.flags.some((f) => f.severity === 'gap' && f.code === 'ENGINE.RULE_FAULT')).toBe(true);

    // Every other line still completes — not swept into the fault.
    const survivor1 = det(result, 'L2');
    const survivor2 = det(result, 'L3');
    for (const s of [survivor1, survivor2]) {
      expect(s.disposition).toBe('ADJUDICATED');
      expect(s.status).toBe('PAID');
      expect(s.trace.some((ev) => ev.outcome === 'ERRORED')).toBe(false);
    }

    // The specific containment hole (b) fixed: TEST.AFTER_FAULT's SKIPPED
    // evaluation on the halted line must not have leaked a halt-specific
    // string into the deduped, rule-level counterfactual map — a survivor
    // line's ordinary NOT_FIRED evaluation for the very same rule is what
    // the map actually holds.
    const skippedAfterFault = faulted.trace.find((ev) => ev.ruleId === 'TEST.AFTER_FAULT');
    expect(skippedAfterFault).toBeDefined();
    expect(skippedAfterFault?.outcome).toBe('SKIPPED');
    expect(skippedAfterFault?.counterfactual).toBeNull();

    const notFiredAfterFault = survivor1.trace.find((ev) => ev.ruleId === 'TEST.AFTER_FAULT');
    expect(notFiredAfterFault?.outcome).toBe('NOT_FIRED');
    expect(notFiredAfterFault?.counterfactual).not.toBeNull();

    expect(result.counterfactuals['TEST.AFTER_FAULT']).toBe(notFiredAfterFault?.counterfactual);
  });
});

// ===========================================================================
// 4 — data-driven sweep over the SHIPPED registry: no bundleUnder anywhere
// in it may ever select an already-bundled line, across a broad,
// systematically generated set of claims — not a hard-coded list of "the
// rules we know about." A future rule that reintroduces this class of
// hazard (an unguarded `among`, or a guard checked against a stale epoch —
// see the file header on why the guard predicate alone was not enough) is
// expected to surface here as soon as its trigger conditions appear in one
// of the generated combinations, without this test needing to name it.
// ===========================================================================

/** One representative admitted code per packaging-relevant status indicator, drawn directly from the shipped OPPS data (src/data/opps.cy2026.ts) — not invented. */
const SI_REPRESENTATIVE_CODES: Readonly<Record<string, string>> = {
  T: '0101T',
  S: '0263T',
  V: '0811T',
  J1: '0071T',
  J2: '99281',
  Q1: 'G0516',
  Q2: '0412T',
  Q3: '0362T',
  Q4: '0002M',
};

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const [head, ...rest] = items;
  if (head === undefined) return [];
  const withHead = combinations(rest, size - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(rest, size);
  return [...withHead, ...withoutHead];
}

function claimFromCodes(codes: readonly string[]): ClaimInput {
  return claim(codes.map((code, i) => claimLine({ lineId: `L${i + 1}`, procCode: code })));
}

describe('shipped registry — no bundleUnder can ever select an already-bundled line', () => {
  const sis = Object.keys(SI_REPRESENTATIVE_CODES);
  const combos = [2, 3, 4].flatMap((size) => combinations(sis, size));

  it('sanity: the shipped registry actually contains bundleUnder effects (so this sweep exercises something)', () => {
    const allRules = [...EXEMPT_RULES, ...PACKAGING_RULES, ...DISPOSITION_RULES] as readonly Record<string, unknown>[];
    const bundleUnderRuleIds: string[] = [];
    for (const rule of allRules) {
      const then = rule['then'];
      if (!Array.isArray(then)) continue;
      if (then.some((eff) => typeof eff === 'object' && eff !== null && 'bundleUnder' in eff)) {
        bundleUnderRuleIds.push(String(rule['id']));
      }
    }
    expect(bundleUnderRuleIds.length).toBeGreaterThan(0);
    expect(bundleUnderRuleIds).toContain('OPPS.PKG.Q4.COMPANION');
  });

  // A plain loop generating one `it(...)` per combination, not
  // `it.each(combos)`: vitest/jest's `it.each` spreads an array-shaped
  // element across the test callback's positional parameters rather than
  // passing it as one argument, which would silently reduce every
  // multi-SI combo down to just its first SI. A loop keeps each combo
  // intact and gives every generated case its own readable title.
  for (const combo of combos) {
    it(`SI combination [${combo.join(',')}] adjudicates without an engine fault`, () => {
      const codes = combo.map((si) => {
        const code = SI_REPRESENTATIVE_CODES[si];
        if (code === undefined) throw new Error(`unreachable: no representative code for SI "${si}"`);
        return code;
      });
      let result: EngineResult | undefined;
      expect(() => {
        result = adjudicate({ claim: claimFromCodes(codes) });
      }).not.toThrow();
      if (result === undefined) throw new Error('unreachable: assignment above did not throw');

      expect(result.engineStatus).toBe('OK');
      for (const d of result.determinations) {
        expect(d.disposition).not.toBe('ENGINE_ERROR');
        expect(d.trace.some((ev) => ev.outcome === 'ERRORED')).toBe(false);
      }
    });
  }
});
