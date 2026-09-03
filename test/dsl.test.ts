import { describe, expect, it } from 'vitest';
import {
  allOf,
  always,
  anyOf,
  apcIn,
  bundleUnder,
  claimAlways,
  claimContainsAny,
  claimContainsCode,
  claimContainsNone,
  claimLineCountAtLeast,
  claimUnitsAtLeast,
  codeIn,
  codePattern,
  convertSI,
  dosBefore,
  dosOnOrAfter,
  exempt,
  flag,
  hasModifier,
  hasRate,
  hasWeight,
  inSchedule,
  isArgSpecDimension,
  isArgSpecKind,
  isExempt,
  isHighestBy,
  isNotHighestBy,
  makeSimpleEvalNode,
  not,
  operators,
  optionAtLeast,
  optionIs,
  optionUnknown,
  ordinalAtLeast,
  ordinalIs,
  route,
  setBasis,
  setStatus,
  siIn,
  siIs,
  statusIn,
  stop,
  unimplemented,
  unitsAtLeast,
  type ClaimFacts,
  type LineFacts,
  type OperatorContext,
} from '../src/dsl/operators.js';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function line(overrides: Partial<LineFacts> = {}): LineFacts {
  return {
    lineId: 'L1',
    code: '99213',
    si: 'J1',
    apc: '5021',
    schedule: 'OPPS_APC',
    status: null,
    modifiers: [],
    unitCount: 1,
    rateMils: 100000,
    weight: 1.5,
    chargeMils: 200000,
    isExempt: false,
    dos: '20260115',
    ...overrides,
  };
}

function makeClaim(lines: readonly LineFacts[]): ClaimFacts {
  return { lines };
}

function makeCtx(
  subject: LineFacts | null,
  claimLines: readonly LineFacts[] = subject !== null ? [subject] : [],
  options: Record<string, unknown> = {},
): OperatorContext {
  return { subject, claim: makeClaim(claimLines), options: options as OperatorContext['options'] };
}

const evalNode = makeSimpleEvalNode();

// ---------------------------------------------------------------------------
// Line predicates
// ---------------------------------------------------------------------------

describe('always', () => {
  it('fires unconditionally', () => {
    expect(always.evaluate({}, makeCtx(line()), evalNode).fired).toBe(true);
    expect(always.evaluate({}, makeCtx(null, []), evalNode).fired).toBe(true);
  });
});

describe('siIn', () => {
  it('fires when subject SI is a member', () => {
    expect(siIn.evaluate({ si: ['J1', 'J2'] }, makeCtx(line({ si: 'J1' })), evalNode).fired).toBe(true);
  });
  it('does not fire when subject SI is absent from the list', () => {
    expect(siIn.evaluate({ si: ['J1', 'J2'] }, makeCtx(line({ si: 'Q4' })), evalNode).fired).toBe(false);
  });
});

describe('codeIn', () => {
  it('fires / does not fire on membership', () => {
    expect(codeIn.evaluate({ code: ['99213'] }, makeCtx(line({ code: '99213' })), evalNode).fired).toBe(true);
    expect(codeIn.evaluate({ code: ['99213'] }, makeCtx(line({ code: '99214' })), evalNode).fired).toBe(false);
  });
});

describe('codePattern', () => {
  it('matches a wildcard pattern', () => {
    expect(codePattern.evaluate({ pattern: 'G03*' }, makeCtx(line({ code: 'G0378' })), evalNode).fired).toBe(true);
  });
  it('does not match outside the pattern', () => {
    expect(codePattern.evaluate({ pattern: 'G03*' }, makeCtx(line({ code: '36415' })), evalNode).fired).toBe(false);
  });
});

describe('apcIn', () => {
  it('fires / does not fire on membership', () => {
    expect(apcIn.evaluate({ apc: ['5021'] }, makeCtx(line({ apc: '5021' })), evalNode).fired).toBe(true);
    expect(apcIn.evaluate({ apc: ['5021'] }, makeCtx(line({ apc: '5072' })), evalNode).fired).toBe(false);
  });
});

describe('inSchedule', () => {
  it('fires / does not fire on membership', () => {
    expect(inSchedule.evaluate({ schedule: ['OPPS_APC'] }, makeCtx(line({ schedule: 'OPPS_APC' })), evalNode).fired).toBe(true);
    expect(inSchedule.evaluate({ schedule: ['OPPS_APC'] }, makeCtx(line({ schedule: 'CLFS' })), evalNode).fired).toBe(false);
  });
});

describe('statusIn', () => {
  it('fires / does not fire on membership', () => {
    expect(statusIn.evaluate({ status: ['BUNDLED'] }, makeCtx(line({ status: 'BUNDLED' })), evalNode).fired).toBe(true);
    expect(statusIn.evaluate({ status: ['BUNDLED'] }, makeCtx(line({ status: 'PAID' })), evalNode).fired).toBe(false);
  });
});

describe('isExempt', () => {
  it('reads the exempt-line fact', () => {
    expect(isExempt.evaluate({}, makeCtx(line({ isExempt: true })), evalNode).fired).toBe(true);
    expect(isExempt.evaluate({}, makeCtx(line({ isExempt: false })), evalNode).fired).toBe(false);
  });
});

describe('siIs', () => {
  it('fires only on exact match', () => {
    expect(siIs.evaluate({ si: 'J1' }, makeCtx(line({ si: 'J1' })), evalNode).fired).toBe(true);
    expect(siIs.evaluate({ si: 'J1' }, makeCtx(line({ si: 'J2' })), evalNode).fired).toBe(false);
  });
});

describe('hasModifier', () => {
  it('fires / does not fire on presence', () => {
    expect(hasModifier.evaluate({ modifier: '59' }, makeCtx(line({ modifiers: ['59'] })), evalNode).fired).toBe(true);
    expect(hasModifier.evaluate({ modifier: '59' }, makeCtx(line({ modifiers: ['25'] })), evalNode).fired).toBe(false);
  });
});

describe('unitsAtLeast', () => {
  it('fires / does not fire on threshold', () => {
    expect(unitsAtLeast.evaluate({ units: 4 }, makeCtx(line({ unitCount: 8 })), evalNode).fired).toBe(true);
    expect(unitsAtLeast.evaluate({ units: 4 }, makeCtx(line({ unitCount: 1 })), evalNode).fired).toBe(false);
  });
});

describe('hasRate', () => {
  it('fires / does not fire on rate presence', () => {
    expect(hasRate.evaluate({}, makeCtx(line({ rateMils: 100000 })), evalNode).fired).toBe(true);
    expect(hasRate.evaluate({}, makeCtx(line({ rateMils: null })), evalNode).fired).toBe(false);
  });
});

describe('hasWeight', () => {
  it('fires / does not fire on weight presence', () => {
    expect(hasWeight.evaluate({}, makeCtx(line({ weight: 1.5 })), evalNode).fired).toBe(true);
    expect(hasWeight.evaluate({}, makeCtx(line({ weight: null })), evalNode).fired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composition, including `not` used in a scope position
// ---------------------------------------------------------------------------

describe('not — usable in a scope position', () => {
  it('negates a scope-selector-style child (siIn) evaluated against a candidate line', () => {
    const candidateJ1 = line({ si: 'J1' });
    const candidateQ4 = line({ si: 'Q4' });
    const notQ4 = { child: { op: 'siIn', args: { si: ['Q4'] } } };
    // "not exempt / not SI Q4" is exactly the §4.3 scope use case: the
    // candidate line under test is `ctx.subject`, same as any other scope
    // selector receives.
    expect(not.evaluate(notQ4, makeCtx(candidateJ1), evalNode).fired).toBe(true);
    expect(not.evaluate(notQ4, makeCtx(candidateQ4), evalNode).fired).toBe(false);
  });
});

describe('allOf / anyOf', () => {
  const childTrue = { op: 'always', args: {} };
  const childFalseSi = { op: 'siIn', args: { si: ['Q4'] } };

  it('allOf fires only when every child fires', () => {
    expect(allOf.evaluate({ children: [childTrue, childTrue] }, makeCtx(line()), evalNode).fired).toBe(true);
    expect(allOf.evaluate({ children: [childTrue, childFalseSi] }, makeCtx(line({ si: 'J1' })), evalNode).fired).toBe(false);
  });

  it('anyOf fires when at least one child fires', () => {
    expect(anyOf.evaluate({ children: [childFalseSi, childTrue] }, makeCtx(line({ si: 'J1' })), evalNode).fired).toBe(true);
    expect(anyOf.evaluate({ children: [childFalseSi] }, makeCtx(line({ si: 'J1' })), evalNode).fired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Claim-scope selectors / claim-level conditions
// ---------------------------------------------------------------------------

describe('claimAlways', () => {
  it('fires unconditionally', () => {
    expect(claimAlways.evaluate({}, makeCtx(null, []), evalNode).fired).toBe(true);
  });
});

describe('claimContainsAny / claimContainsNone', () => {
  const lines = [line({ lineId: 'A', si: 'S' }), line({ lineId: 'B', si: 'J1' })];

  it('claimContainsAny fires / does not fire on claim-wide presence', () => {
    expect(claimContainsAny.evaluate({ si: ['S', 'T', 'V'] }, makeCtx(null, lines), evalNode).fired).toBe(true);
    expect(claimContainsAny.evaluate({ si: ['Q4'] }, makeCtx(null, lines), evalNode).fired).toBe(false);
  });

  it('claimContainsNone is the negation', () => {
    expect(claimContainsNone.evaluate({ si: ['Q4'] }, makeCtx(null, lines), evalNode).fired).toBe(true);
    expect(claimContainsNone.evaluate({ si: ['S'] }, makeCtx(null, lines), evalNode).fired).toBe(false);
  });

  it('requires exactly one of si/code', () => {
    expect(() => claimContainsAny.evaluate({}, makeCtx(null, lines), evalNode)).toThrow();
    expect(() => claimContainsAny.evaluate({ si: ['S'], code: ['99213'] }, makeCtx(null, lines), evalNode)).toThrow();
  });
});

describe('claimContainsCode', () => {
  const lines = [line({ lineId: 'A', code: 'G0378' })];
  it('fires / does not fire on exact code presence', () => {
    expect(claimContainsCode.evaluate({ code: 'G0378' }, makeCtx(null, lines), evalNode).fired).toBe(true);
    expect(claimContainsCode.evaluate({ code: '36415' }, makeCtx(null, lines), evalNode).fired).toBe(false);
  });
});

describe('claimUnitsAtLeast — sums across duplicate lines (§19.7)', () => {
  // Two G0378 lines of 4 units each, never collapsed — must sum to 8 for the
  // C-APC 8011 "≥8 units" leg to fire on real claims, per the build brief.
  const lines = [
    line({ lineId: 'A', code: 'G0378', unitCount: 4 }),
    line({ lineId: 'B', code: 'G0378', unitCount: 4 }),
  ];

  it('sums units across matching lines and compares to the threshold', () => {
    const fired = claimUnitsAtLeast.evaluate({ code: 'G0378', units: 8 }, makeCtx(null, lines), evalNode);
    expect(fired.fired).toBe(true);
    expect(fired.examined['sum']).toBe(8);
  });

  it('does not fire below the threshold', () => {
    expect(claimUnitsAtLeast.evaluate({ code: 'G0378', units: 9 }, makeCtx(null, lines), evalNode).fired).toBe(false);
  });

  it('also sums by si filter, and requires exactly one of code/si', () => {
    expect(claimUnitsAtLeast.evaluate({ si: ['J1'], units: 8 }, makeCtx(null, [line({ si: 'J1', unitCount: 5 }), line({ si: 'J1', unitCount: 5 })]), evalNode).fired).toBe(true);
    expect(() => claimUnitsAtLeast.evaluate({ units: 8 }, makeCtx(null, lines), evalNode)).toThrow();
    expect(() => claimUnitsAtLeast.evaluate({ code: 'G0378', si: ['J1'], units: 8 }, makeCtx(null, lines), evalNode)).toThrow();
  });
});

describe('claimLineCountAtLeast', () => {
  const lines = [line({ lineId: 'A', code: 'G0378' }), line({ lineId: 'B', code: 'G0378' }), line({ lineId: 'C', code: '99213' })];
  it('fires / does not fire on count threshold', () => {
    expect(claimLineCountAtLeast.evaluate({ code: 'G0378', count: 2 }, makeCtx(null, lines), evalNode).fired).toBe(true);
    expect(claimLineCountAtLeast.evaluate({ code: 'G0378', count: 3 }, makeCtx(null, lines), evalNode).fired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Context conditions
// ---------------------------------------------------------------------------

describe('optionIs', () => {
  it('fires on equality, false when unset', () => {
    expect(optionIs.evaluate({ option: 'g0378Units', equals: 4 }, makeCtx(line(), [], { g0378Units: 4 }), evalNode).fired).toBe(true);
    expect(optionIs.evaluate({ option: 'g0378Units', equals: 4 }, makeCtx(line(), [], { g0378Units: 5 }), evalNode).fired).toBe(false);
    expect(optionIs.evaluate({ option: 'g0378Units', equals: 4 }, makeCtx(line(), [], {}), evalNode).fired).toBe(false);
  });
});

describe('optionAtLeast', () => {
  it('fires / does not fire on numeric threshold; false when unset', () => {
    expect(optionAtLeast.evaluate({ option: 'g0378Units', atLeast: 4 }, makeCtx(line(), [], { g0378Units: 8 }), evalNode).fired).toBe(true);
    expect(optionAtLeast.evaluate({ option: 'g0378Units', atLeast: 4 }, makeCtx(line(), [], { g0378Units: 1 }), evalNode).fired).toBe(false);
    expect(optionAtLeast.evaluate({ option: 'g0378Units', atLeast: 4 }, makeCtx(line(), [], {}), evalNode).fired).toBe(false);
  });
});

describe('optionUnknown', () => {
  it('fires only when the option is absent (§13.2/§10.4)', () => {
    expect(optionUnknown.evaluate({ option: 'g0378Units' }, makeCtx(line(), [], {}), evalNode).fired).toBe(true);
    expect(optionUnknown.evaluate({ option: 'g0378Units' }, makeCtx(line(), [], { g0378Units: 4 }), evalNode).fired).toBe(false);
  });
});

describe('dosOnOrAfter / dosBefore', () => {
  it('compare the subject line date of service', () => {
    expect(dosOnOrAfter.evaluate({ date: '20260101' }, makeCtx(line({ dos: '20260115' })), evalNode).fired).toBe(true);
    expect(dosOnOrAfter.evaluate({ date: '20260201' }, makeCtx(line({ dos: '20260115' })), evalNode).fired).toBe(false);
    expect(dosBefore.evaluate({ date: '20260201' }, makeCtx(line({ dos: '20260115' })), evalNode).fired).toBe(true);
    expect(dosBefore.evaluate({ date: '20260101' }, makeCtx(line({ dos: '20260115' })), evalNode).fired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Relational conditions
// ---------------------------------------------------------------------------

describe('isHighestBy / isNotHighestBy / ordinalIs / ordinalAtLeast', () => {
  const among = { op: 'always', args: {} };
  const high = line({ lineId: 'HIGH', code: 'A', rateMils: 300000 });
  const mid = line({ lineId: 'MID', code: 'B', rateMils: 200000 });
  const low = line({ lineId: 'LOW', code: 'C', rateMils: 100000 });
  const claimLines = [high, mid, low];

  it('isHighestBy fires only for the top-ranked line', () => {
    expect(isHighestBy.evaluate({ field: 'rateMils', among, tiebreak: 'codeAsc' }, makeCtx(high, claimLines), evalNode).fired).toBe(true);
    expect(isHighestBy.evaluate({ field: 'rateMils', among, tiebreak: 'codeAsc' }, makeCtx(mid, claimLines), evalNode).fired).toBe(false);
  });

  it('isNotHighestBy is the negation', () => {
    expect(isNotHighestBy.evaluate({ field: 'rateMils', among, tiebreak: 'codeAsc' }, makeCtx(low, claimLines), evalNode).fired).toBe(true);
    expect(isNotHighestBy.evaluate({ field: 'rateMils', among, tiebreak: 'codeAsc' }, makeCtx(high, claimLines), evalNode).fired).toBe(false);
  });

  it('ordinalIs / ordinalAtLeast read the raw rank', () => {
    const r = ordinalIs.evaluate({ field: 'rateMils', among, tiebreak: 'codeAsc', equals: 2 }, makeCtx(mid, claimLines), evalNode);
    expect(r.fired).toBe(true);
    expect(r.examined['ordinal']).toBe(2);
    expect(ordinalAtLeast.evaluate({ field: 'rateMils', among, tiebreak: 'codeAsc', atLeast: 2 }, makeCtx(low, claimLines), evalNode).fired).toBe(true);
    expect(ordinalAtLeast.evaluate({ field: 'rateMils', among, tiebreak: 'codeAsc', atLeast: 4 }, makeCtx(low, claimLines), evalNode).fired).toBe(false);
  });

  it('records subjectInAmong: false, never an error, when the subject is not a member of `among`', () => {
    const outsider = line({ lineId: 'OUT', code: 'Z', si: 'Q4', rateMils: 50000 });
    const amongJ1 = { op: 'siIn', args: { si: ['J1'] } };
    const r = isHighestBy.evaluate(
      { field: 'rateMils', among: amongJ1, tiebreak: 'codeAsc' },
      makeCtx(outsider, [...claimLines, outsider].map((l) => ({ ...l, si: l.lineId === 'OUT' ? 'Q4' : 'J1' }))),
      evalNode,
    );
    expect(r.fired).toBe(false);
    expect(r.examined['subjectInAmong']).toBe(false);
    expect(r.examined['ordinal']).toBe(null);
  });

  describe('weight ranking against a null field (§4.2 fallbackField)', () => {
    const weighted = line({ lineId: 'W', code: 'A', weight: 2.0, rateMils: 100000 });
    const noWeight = line({ lineId: 'NW', code: 'B', weight: null, rateMils: 400000 });
    const claimLinesW = [weighted, noWeight];

    it('is a hard error with no fallbackField declared', () => {
      expect(() =>
        isHighestBy.evaluate({ field: 'weight', among, tiebreak: 'codeAsc' }, makeCtx(weighted, claimLinesW), evalNode),
      ).toThrow(/fallbackField/);
    });

    it('resolves via fallbackField instead of silently skipping the line', () => {
      // With fallbackField: rateMils, "noWeight" (rate 400000) outranks
      // "weighted" (weight 2.0, but that's not comparable to a rate — the
      // point here is only that resolution succeeds and is deterministic,
      // not a claim about cross-field comparability).
      const r = isHighestBy.evaluate(
        { field: 'weight', among, tiebreak: 'codeAsc', fallbackField: 'rateMils' },
        makeCtx(noWeight, claimLinesW),
        evalNode,
      );
      expect(r.fired).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Reserved
// ---------------------------------------------------------------------------

describe('unimplemented', () => {
  it('never fires', () => {
    expect(unimplemented.evaluate({ reason: 'no source data yet' }, makeCtx(line()), evalNode).fired).toBe(false);
  });
  it('argSpec identifies it as reserved, so the interpreter can force NOT_EVALUATED rather than treat this as an ordinary NOT_FIRED', () => {
    expect(unimplemented.argSpec({ reason: 'x' }).kind).toBe('reserved');
  });
});

// ---------------------------------------------------------------------------
// Effects — describe()/argSpec() only, no evaluate()
// ---------------------------------------------------------------------------

describe('effects ship describe() and argSpec()', () => {
  it('setStatus', () => {
    expect(setStatus.describe({ status: 'BUNDLED' })).toContain('BUNDLED');
    expect(setStatus.argSpec({ status: 'BUNDLED' }).kind).toBe('effect');
  });
  it('bundleUnder embeds its among selector in argSpec.children', () => {
    const spec = bundleUnder.argSpec({ highestBy: 'rateMils', among: { op: 'always', args: {} }, tiebreak: 'codeAsc' });
    expect(spec.kind).toBe('effect');
    expect(spec.children).toHaveLength(1);
  });
  it('convertSI / route / setBasis / exempt / flag / stop', () => {
    expect(convertSI.argSpec({ to: 'A' }).kind).toBe('effect');
    // `route` takes NO arguments (spec §4.3.1, D18) — the target schedule is
    // computed by routing.resolve(), never named in the registry.
    expect(route.argSpec({}).kind).toBe('effect');
    expect(() => route.argSpec({ schedule: 'ROUTED_MPFS' })).toThrow(/takes no arguments/);
    expect(setBasis.argSpec({ value: 'OPPS_APC' }).kind).toBe('effect');
    expect(exempt.argSpec({}).kind).toBe('effect');
    expect(flag.argSpec({ code: 'X', severity: 'info', message: 'm' }).kind).toBe('effect');
    expect(stop.argSpec({}).kind).toBe('effect');
  });
});

// ---------------------------------------------------------------------------
// Table-driven closed-vocabulary assertion over the full exported registry —
// every operator must ship describe()/argSpec(), and every argSpec().kind
// and .dimension must be in the closed vocabulary. A future operator added
// without them fails this test.
// ---------------------------------------------------------------------------

const SAMPLE_ARGS: Record<string, unknown> = {
  always: {},
  siIn: { si: ['J1'] },
  codeIn: { code: ['99213'] },
  codePattern: { pattern: 'G03*' },
  apcIn: { apc: ['5021'] },
  inSchedule: { schedule: ['OPPS_APC'] },
  statusIn: { status: ['PAID'] },
  isExempt: {},
  siIs: { si: 'J1' },
  hasModifier: { modifier: '59' },
  ncciPtpBundled: {},
  unitsAtLeast: { units: 2 },
  hasRate: {},
  hasWeight: {},
  not: { child: { op: 'always', args: {} } },
  allOf: { children: [{ op: 'always', args: {} }] },
  anyOf: { children: [{ op: 'always', args: {} }] },
  claimAlways: {},
  claimContainsAny: { si: ['J1'] },
  claimContainsNone: { code: ['99213'] },
  claimContainsCode: { code: '99213' },
  claimUnitsAtLeast: { code: 'G0378', units: 8 },
  claimLineCountAtLeast: { count: 1 },
  optionIs: { option: 'g0378Units', equals: 4 },
  optionAtLeast: { option: 'g0378Units', atLeast: 4 },
  optionUnknown: { option: 'g0378Units' },
  dosOnOrAfter: { date: '20260101' },
  dosBefore: { date: '20260101' },
  isHighestBy: { field: 'rateMils', among: { op: 'always', args: {} }, tiebreak: 'codeAsc' },
  isNotHighestBy: { field: 'rateMils', among: { op: 'always', args: {} }, tiebreak: 'codeAsc' },
  ordinalIs: { field: 'rateMils', among: { op: 'always', args: {} }, tiebreak: 'codeAsc', equals: 1 },
  ordinalAtLeast: { field: 'rateMils', among: { op: 'always', args: {} }, tiebreak: 'codeAsc', atLeast: 1 },
  unimplemented: { reason: 'test' },
  setStatus: { status: 'BUNDLED' },
  bundleUnder: { highestBy: 'rateMils', among: { op: 'always', args: {} }, tiebreak: 'codeAsc' },
  convertSI: { to: 'A' },
  route: {},
  setBasis: { value: 'OPPS_APC' },
  exempt: {},
  flag: { code: 'TEST', severity: 'info', message: 'test' },
  stop: {},
};

describe('every operator in the closed set ships describe()/argSpec() with closed-vocabulary output', () => {
  const names = Object.keys(operators);

  it('the sample-args table covers every exported operator, and vice versa', () => {
    expect(new Set(names)).toEqual(new Set(Object.keys(SAMPLE_ARGS)));
  });

  it.each(names)('%s', (name) => {
    const op = operators[name];
    expect(op).toBeDefined();
    if (op === undefined) return;
    expect(typeof op.describe).toBe('function');
    expect(typeof op.argSpec).toBe('function');

    const args = SAMPLE_ARGS[name];
    const description = op.describe(args);
    expect(typeof description).toBe('string');
    expect(description.length).toBeGreaterThan(0);

    const spec = op.argSpec(args);
    expect(isArgSpecKind(spec.kind)).toBe(true);
    if (spec.dimension !== undefined) {
      expect(isArgSpecDimension(spec.dimension)).toBe(true);
    }

    if (op.role === 'condition') {
      expect(typeof op.evaluate).toBe('function');
    }
  });
});
