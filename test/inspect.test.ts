import { describe, expect, it } from 'vitest';
import { adjudicate } from '../src/index.js';
import { applicability, codeFacts, explain, type ExplainableResult, type InspectableRule } from '../src/inspect.js';
import { loadRegistry } from '../src/registry/loader.js';
import { EXEMPT_RULES, PACKAGING_RULES, DISPOSITION_RULES } from '../src/registry/index.js';
import { operators } from '../src/dsl/operators.js';
import type { ClaimInput, ClaimLineInput } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fixture builders — same shape as test/adjudicate.test.ts's, kept local
// (not imported) since that file is owned by a concurrently-editing agent.
// ---------------------------------------------------------------------------

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

/** The engine's own bundled registry, normalized — same assembly `src/index.ts` performs internally. */
const BUNDLED_RULES = loadRegistry([...EXEMPT_RULES, ...PACKAGING_RULES, ...DISPOSITION_RULES]);

// ===========================================================================
// Mode 3 — codeFacts()
// ===========================================================================

describe('codeFacts (mode 3)', () => {
  it('84112 — SI Q4, no APC, no OPPS rate, present in CLFS at $98.11, no historical term date', () => {
    const facts = codeFacts('84112');
    expect(facts.code).toBe('84112');
    expect(facts.si).toBe('Q4');
    expect(facts.apc).toBeNull();
    expect(facts.hasRate).toBe(false);
    expect(facts.clfsPresent).toBe(true);
    expect(facts.clfsRateMils).toBe(98110);
    expect(facts.historicalTermDate).toBeNull();
  });

  it('an unknown code returns all-null/false facts, not an error', () => {
    const facts = codeFacts('ZZ9999');
    expect(facts.si).toBeNull();
    expect(facts.apc).toBeNull();
    expect(facts.hasRate).toBe(false);
    expect(facts.clfsPresent).toBe(false);
    expect(facts.clfsRateMils).toBeNull();
  });
});

// ===========================================================================
// Mode 2 — applicability() — the differentiator
// ===========================================================================

describe('applicability (mode 2) — prospective, code alone, no claim', () => {
  it('84112 (SI Q4) names the Q4 companion-packaging rule and the Q4->A conversion rule, each with a described condition, both ADMITTED (D45 fixed) — no claim constructed anywhere in this test', () => {
    const result = applicability('84112', BUNDLED_RULES);

    expect(result.code).toBe('84112');
    expect(result.facts.si).toBe('Q4');

    // Post-D45-migration: OPPS.PKG.Q4.COMPANION/CONVERT's `scope` is the bare
    // `siIn: [Q4]` — statically decidable from the code alone — with the
    // not(statusIn(['BUNDLED'])) guard relocated into `when` (§4.3, D45).
    // Both therefore land in `admitted`, not `conditional`: this is the
    // exact defect this migration fixes (docs/BUILD_LOG.md D45) — before the
    // fix, both landed in `conditional` naming `statusIn` as undecidable,
    // and `admitted` was empty for every Q-group/J1 code (see
    // test/fix-d45-applicability.test.ts for the broader, data-driven
    // regression coverage).
    const q4Companion = result.admitted.find((r) => r.ruleId === 'OPPS.PKG.Q4.COMPANION');
    const q4Convert = result.admitted.find((r) => r.ruleId === 'OPPS.PKG.Q4.CONVERT');

    expect(q4Companion).toBeDefined();
    expect(q4Convert).toBeDefined();
    expect(result.conditional.find((r) => r.ruleId === 'OPPS.PKG.Q4.COMPANION')).toBeUndefined();
    expect(result.conditional.find((r) => r.ruleId === 'OPPS.PKG.Q4.CONVERT')).toBeUndefined();
    expect(q4Companion?.firesWhen.length).toBeGreaterThan(0);
    expect(q4Convert?.firesWhen.length).toBeGreaterThan(0);
    expect(q4Companion?.firesWhen).toContain('J1');
    expect(q4Convert?.firesWhen.toLowerCase()).toContain('no line');
  });

  it('a code with no rules admitting it returns an empty list, not an error', () => {
    const rules: InspectableRule[] = [
      {
        id: 'TEST.Q1.ONLY',
        order: 100,
        band: 4000,
        epoch: 'E2',
        scopeTarget: 'line',
        citation: 'test fixture',
        scope: { op: 'siIn', args: { si: ['Q1'] } },
        then: [{ op: 'setStatus', args: { status: 'BUNDLED' } }],
      },
    ];
    // An unmapped code has SI null, which siIn never matches.
    const result = applicability('ZZ9999', rules);
    expect(result.admitted).toEqual([]);
    expect(result.conditional).toEqual([]);
    expect(result.reserved).toEqual([]);
  });

  it('the conditional group is populated for a rule scoped on isExempt, with the undecidable predicate named', () => {
    const rules: InspectableRule[] = [
      {
        id: 'TEST.NOT_EXEMPT',
        order: 100,
        band: 2000,
        epoch: 'E1',
        scopeTarget: 'line',
        citation: 'test fixture',
        scope: { op: 'not', args: { child: { op: 'isExempt', args: {} } } },
        then: [{ op: 'flag', args: { code: 'TEST', severity: 'info', message: 'test' } }],
      },
    ];
    const result = applicability('84112', rules);
    expect(result.admitted).toEqual([]);
    expect(result.conditional.length).toBe(1);
    const [entry] = result.conditional;
    expect(entry?.ruleId).toBe('TEST.NOT_EXEMPT');
    expect(entry?.undecidable.length).toBe(1);
    expect(entry?.undecidable[0]?.op).toBe('isExempt');
    expect(entry?.undecidable[0]?.description.length).toBeGreaterThan(0);
  });

  it('D45 fixed: no shipped rule scoped on Q4 is undecidable on statusIn any more — OPPS.PKG.Q4.COMPANION is ADMITTED, not conditional', () => {
    const result = applicability('84112', BUNDLED_RULES);
    const q4Companion = result.admitted.find((r) => r.ruleId === 'OPPS.PKG.Q4.COMPANION');
    expect(q4Companion).toBeDefined();
    expect(result.conditional.find((r) => r.ruleId === 'OPPS.PKG.Q4.COMPANION')).toBeUndefined();
  });

  it('a rule whose scope statically rejects the code (mismatched SI) never appears in any group', () => {
    const result = applicability('84112', BUNDLED_RULES);
    const ids = [...result.admitted, ...result.conditional, ...result.reserved].map((r) => r.ruleId);
    // Q1/Q2-only companion rules cannot ever apply to a Q4 code.
    expect(ids).not.toContain('OPPS.PKG.Q1.COMPANION');
    expect(ids).not.toContain('OPPS.PKG.Q2.COMPANION');
  });

  it('claim-scoped rules are never returned — a code-alone query has no claim to score them against', () => {
    const result = applicability('84112', BUNDLED_RULES);
    const ids = [...result.admitted, ...result.conditional].map((r) => r.ruleId);
    expect(ids).not.toContain('OPPS.PKG.J1.COMPLEXITY_NOT_APPLIED');
  });
});

// ===========================================================================
// Mode 1 — explain() — retrospective
// ===========================================================================

describe('explain (mode 1) — retrospective, on a real adjudication', () => {
  it('resolves every NOT_FIRED counterfactual against a real adjudicated claim, and surfaces scopeExclusions separately', () => {
    const result = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'V', procCode: 'G0463' }), claimLine({ lineId: 'Q4', procCode: '84112' })]),
    });

    const explained = explain(result);

    expect(explained.claimId).toBe('C1');
    expect(explained.lines.length).toBe(2);

    let sawNotFired = false;
    for (const line of explained.lines) {
      for (const ruleEval of line.rules) {
        expect(ruleEval.factsRead).toBeDefined();
        if (ruleEval.outcome === 'NOT_FIRED') {
          sawNotFired = true;
          expect(typeof ruleEval.counterfactual).toBe('string');
          expect(ruleEval.counterfactual?.length).toBeGreaterThan(0);
        }
        if (ruleEval.outcome === 'FIRED') {
          // FIRED entries never carry a counterfactual.
          expect(ruleEval.counterfactual).toBeNull();
        }
      }
    }
    expect(sawNotFired).toBe(true);

    // §5.3a — scope exclusions are claim-level, separate from per-line entries.
    expect(explained.scopeExclusions).toBe(result.scopeExclusions);
    expect(explained.scopeExclusions.length).toBeGreaterThan(0);
  });

  it('U9b: explain() succeeds on a claim with a T line, and the resolved rank fact is reachable through it (§2.5, §5.4)', () => {
    // 59025 (T, MPPR-ranked) + 84112 (Q4) — the exact repro from the
    // confirmed defect: OPPS.DISP.T.MPPR_RANK's ordinalAtLeast condition
    // used to cite a rank fact ("E3b:rank:weight#0") that was never
    // registered into Result.facts, so explain() (which resolves factRefs
    // strictly) threw on any claim containing a T line. Before the fix,
    // this call throws "not present in Result.facts (§5.4)".
    const result = adjudicate({
      claim: claim({}, [claimLine({ lineId: 'T', procCode: '59025' }), claimLine({ lineId: 'Q4', procCode: '84112' })]),
    });

    const explained = explain(result);
    const tLine = explained.lines.find((l) => l.lineId === 'T');
    expect(tLine).toBeDefined();

    const mpprEval = tLine?.rules.find((r) => r.ruleId === 'OPPS.DISP.T.MPPR_RANK');
    expect(mpprEval).toBeDefined();
    expect(mpprEval?.examined.factRefs.length).toBeGreaterThan(0);

    // The rank fact itself is resolved into `factsRead`, not left dangling
    // as a bare id — this is the reachability §5.4 promises.
    expect(mpprEval?.factsRead.length).toBe(mpprEval?.examined.factRefs.length);
    const rankFact = mpprEval?.factsRead.find((f) => f.kind === 'rank');
    expect(rankFact).toBeDefined();
    expect(rankFact?.dimension).toBe('weight');
    expect(rankFact?.lineIds).toContain('T');
  });

  it('a deliberately dangling counterfactualRef throws, not an empty string', () => {
    const dangling: ExplainableResult = {
      claimId: 'C-DANGLING',
      determinations: [
        {
          lineId: 'L1',
          trace: [
            {
              ruleId: 'FAKE.RULE',
              ruleVersion: '2026.1',
              phase: 'ADJUDICATE',
              band: 5000,
              order: 5000,
              epoch: 'E3b',
              citation: 'test fixture',
              scopeTarget: 'line',
              examined: { subjectLineId: 'L1', ordinal: null, subjectInAmong: null, factRefs: [], detail: {} },
              predicate: null,
              outcome: 'NOT_FIRED',
              effect: null,
              supersededBy: null,
              counterfactual: null,
              counterfactualRef: 'FAKE.RULE',
            },
          ],
        },
      ],
      trace: [],
      facts: { E0: [], E1: [], E2: [], E3a: [], E3b: [], E4: [] },
      scopeExclusions: [],
      counterfactuals: {}, // deliberately missing 'FAKE.RULE'
    };

    expect(() => explain(dangling)).toThrow(/dangling ref is a hard error/);
  });
});

// ===========================================================================
// §4.4 invariant every mode above depends on: every operator in use across
// the shipped registry ships a describe() that returns a non-empty string.
// Table-driven so a future rule with an undescribable condition fails here,
// not silently in the inspector.
// ===========================================================================

function walkAndDescribe(op: string, args: unknown, out: Array<{ op: string; text: string }>): void {
  const found = operators[op];
  if (found === undefined) throw new Error(`unknown operator "${op}"`);
  out.push({ op, text: found.describe(args) });

  if (op === 'not' && typeof args === 'object' && args !== null) {
    const child = (args as Record<string, unknown>)['child'];
    if (typeof child === 'object' && child !== null) {
      const c = child as { op?: unknown; args?: unknown };
      if (typeof c.op === 'string') walkAndDescribe(c.op, c.args, out);
    }
  }
  if ((op === 'allOf' || op === 'anyOf') && typeof args === 'object' && args !== null) {
    const children = (args as Record<string, unknown>)['children'];
    if (Array.isArray(children)) {
      for (const child of children) {
        if (typeof child === 'object' && child !== null) {
          const c = child as { op?: unknown; args?: unknown };
          if (typeof c.op === 'string') walkAndDescribe(c.op, c.args, out);
        }
      }
    }
  }
}

const ALL_RULES: InspectableRule[] = BUNDLED_RULES.map((r) => r);

const DESCRIBE_CASES: Array<{ ruleId: string; position: string; op: string; args: unknown }> = [];
for (const rule of ALL_RULES) {
  DESCRIBE_CASES.push({ ruleId: rule.id, position: 'scope', op: rule.scope.op, args: rule.scope.args });
  if (rule.when !== undefined) {
    DESCRIBE_CASES.push({ ruleId: rule.id, position: 'when', op: rule.when.op, args: rule.when.args });
  }
  rule.then.forEach((eff, i) => {
    DESCRIBE_CASES.push({ ruleId: rule.id, position: `then[${i}]`, op: eff.op, args: eff.args });
  });
}

describe('describe() is non-empty for every operator node in the shipped registry', () => {
  it.each(DESCRIBE_CASES)('$ruleId $position ($op)', ({ op, args }) => {
    const collected: Array<{ op: string; text: string }> = [];
    walkAndDescribe(op, args, collected);
    for (const { op: seenOp, text } of collected) {
      expect(typeof text, `operator "${seenOp}" describe() should return a string`).toBe('string');
      expect(text.length, `operator "${seenOp}" describe() should be non-empty`).toBeGreaterThan(0);
    }
  });
});
