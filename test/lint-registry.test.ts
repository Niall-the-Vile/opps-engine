// test/lint-registry.test.ts — U18. Asserts that each gate implemented in
// tools/lint-registry.mjs's `lintRules()` fires on a synthetic bad rule and
// stays quiet on a good one. Every synthetic rule is built inline, right
// here — nothing bad is ever added to src/registry/*.json (per this unit's
// brief).
//
// `lintRules()` is a pure function of a rule array plus the REAL
// `operators` (dsl/operators.ts) and `isKnownFlagCode` (src/flags.ts), so
// this file imports both directly and calls it synchronously — no
// subprocess, no vite-node relaunch. See tools/lint-registry.mjs's header
// for why importing it has no side effects (the CLI bootstrap is gated on
// `isMainModule`, which is false here).
//
// NOT COVERED HERE: D64 (spec-table-vs-operators.ts comparison),
// REGISTRY_MIRROR_STALE, the dynamic interpreter sweep (D66's runtime
// half), and the three deferred-gate announcements. All four are
// whole-registry/whole-repo checks — "match this file against that
// file" or "run the real interpreter over N synthetic claims" — not
// single-rule questions a "bad rule vs. good rule" pair can exercise, and
// three of the four need real filesystem paths this file has no reason to
// fake. They are covered by actually running `node tools/lint-registry.mjs`
// (see this unit's final report) rather than by a synthetic-rule test.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { operators } from '../src/dsl/operators.js';
import { isKnownFlagCode } from '../src/flags.js';
import { lintRules, normalizeNode, walkTree, buildRankFieldNullability, D45_BASELINE, D66_GUARD_BASELINE } from '../tools/lint-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A default `rankFieldNullability` that reports every field as NOT nullable
// in the data, for every domain — a safe default for the many describe()
// blocks below that use a ranking selector incidentally (e.g. the D66
// blocks' bundleUnder fixtures) but aren't testing RANKING_FIELD_NO_FALLBACK
// itself. That gate's own describe() block below overrides this per-test to
// exercise the real, data-driven behavior (§15.3: nullable in the DATA, not
// the type) — see the note on why this must be synthetic, not the real
// generated data file, in that block's header comment.
const NEVER_NULLABLE = { isNullableInData: () => false };

// ---------------------------------------------------------------------------
// A minimal, otherwise-valid rule. Every test overrides only what it needs
// to, so a passing "good" case proves the OTHER gates stay quiet on an
// ordinary rule shape, not just the one gate under test.
// ---------------------------------------------------------------------------

function baseRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'TEST.LINT.BASE',
    version: '1.0',
    effectiveFrom: '20260101',
    effectiveTo: null,
    phase: 'ADJUDICATE',
    band: 5000,
    order: 9100,
    epoch: 'E3b',
    scopeTarget: 'line',
    citation: 'test fixture — test/lint-registry.test.ts',
    scope: { siIn: { si: ['TESTSI'] } },
    then: [{ setStatus: { status: 'PAID' } }],
    ...overrides,
  };
}

function entry(rule: Record<string, unknown>, sourceFile = 'synthetic') {
  return { rule, sourceFile };
}

function gatesFired(rules: Array<{ rule: Record<string, unknown>; sourceFile: string }>, opts: Record<string, unknown> = {}) {
  const { violations } = lintRules(rules, { operators, isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE, ...opts });
  return new Set(violations.map((v) => v.gate));
}

function violationsFor(gate: string, rules: Array<{ rule: Record<string, unknown>; sourceFile: string }>, opts: Record<string, unknown> = {}) {
  const { violations } = lintRules(rules, { operators, isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE, ...opts });
  return violations.filter((v) => v.gate === gate);
}

describe('lintRules — argument validation', () => {
  it('throws on a non-array ruleEntries', () => {
    expect(() => lintRules('nope' as unknown as [], { operators, isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE })).toThrow();
  });
  it('throws without operators', () => {
    expect(() => lintRules([], { isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE } as never)).toThrow();
  });
  it('throws without isKnownFlagCode', () => {
    expect(() => lintRules([], { operators, rankFieldNullability: NEVER_NULLABLE } as never)).toThrow();
  });
  it('throws without rankFieldNullability', () => {
    expect(() => lintRules([], { operators, isKnownFlagCode } as never)).toThrow();
  });
});

describe('DUPLICATE_ID (§4.2)', () => {
  it('fires when two rules share an id', () => {
    const fired = gatesFired([entry(baseRule({ id: 'DUP.ID' })), entry(baseRule({ id: 'DUP.ID' }))]);
    expect(fired.has('DUPLICATE_ID')).toBe(true);
  });
  it('stays quiet when ids are distinct', () => {
    const fired = gatesFired([entry(baseRule({ id: 'A' })), entry(baseRule({ id: 'B' }))]);
    expect(fired.has('DUPLICATE_ID')).toBe(false);
  });
});

describe('DUPLICATE_ORDER_IN_PHASE (§15.3)', () => {
  it('fires when two rules in the same phase share an order', () => {
    const fired = gatesFired([
      entry(baseRule({ id: 'A', phase: 'ADJUDICATE', order: 100 })),
      entry(baseRule({ id: 'B', phase: 'ADJUDICATE', order: 100 })),
    ]);
    expect(fired.has('DUPLICATE_ORDER_IN_PHASE')).toBe(true);
  });
  it('stays quiet when orders differ, and when the same order appears in a different phase', () => {
    const fired = gatesFired([
      entry(baseRule({ id: 'A', phase: 'ADJUDICATE', order: 100 })),
      entry(baseRule({ id: 'B', phase: 'ADJUDICATE', order: 200 })),
      entry(baseRule({ id: 'C', phase: 'BENCHMARK', order: 100 })),
    ]);
    expect(fired.has('DUPLICATE_ORDER_IN_PHASE')).toBe(false);
  });
});

describe('MISSING_CITATION (§15.3)', () => {
  it('fires on an empty citation', () => {
    expect(violationsFor('MISSING_CITATION', [entry(baseRule({ citation: '' }))]).length).toBeGreaterThan(0);
  });
  it('fires on a missing citation', () => {
    const rule = baseRule();
    delete rule.citation;
    expect(violationsFor('MISSING_CITATION', [entry(rule)]).length).toBeGreaterThan(0);
  });
  it('stays quiet on a real citation', () => {
    expect(violationsFor('MISSING_CITATION', [entry(baseRule())]).length).toBe(0);
  });
});

describe('MISSING_SCOPE_TARGET (§15.3 / §4.2)', () => {
  it('fires when scopeTarget is neither line nor claim', () => {
    expect(violationsFor('MISSING_SCOPE_TARGET', [entry(baseRule({ scopeTarget: 'bogus' }))]).length).toBeGreaterThan(0);
  });
  it('stays quiet for "line" and "claim"', () => {
    expect(violationsFor('MISSING_SCOPE_TARGET', [entry(baseRule({ scopeTarget: 'line' }))]).length).toBe(0);
    expect(
      violationsFor('MISSING_SCOPE_TARGET', [
        entry(baseRule({ scopeTarget: 'claim', scope: { claimAlways: {} }, then: [{ flag: { code: 'TEST.EVALUATE_FIXTURE', severity: 'info', message: 'x' } }] })),
      ]).length,
    ).toBe(0);
  });
});

describe('UNKNOWN_OPERATOR (§4.3)', () => {
  it('fires on an operator not in the closed set', () => {
    expect(violationsFor('UNKNOWN_OPERATOR', [entry(baseRule({ scope: { thisOperatorDoesNotExist: {} } }))]).length).toBeGreaterThan(0);
  });
  it('stays quiet on a real operator', () => {
    expect(violationsFor('UNKNOWN_OPERATOR', [entry(baseRule({ scope: { siIn: { si: ['T'] } } }))]).length).toBe(0);
  });
});

describe('MISSING_DESCRIBE_ARGSPEC (§4.4)', () => {
  // The real closed set always ships both by construction (TypeScript
  // types it), so this gate is exercised with an injected fake operator —
  // `lintRules` accepts `operators` as a dependency for exactly this.
  const brokenOperators = { ...operators, brokenOp: { name: 'brokenOp', role: 'condition' } };

  it('fires when an operator is missing describe()/argSpec()', () => {
    const fired = gatesFired([entry(baseRule({ scope: { brokenOp: {} } }))], { operators: brokenOperators });
    expect(fired.has('MISSING_DESCRIBE_ARGSPEC')).toBe(true);
  });
  it('stays quiet on the real closed set', () => {
    const fired = gatesFired([entry(baseRule())], { operators: brokenOperators });
    expect(fired.has('MISSING_DESCRIBE_ARGSPEC')).toBe(false);
  });
});

describe('ARGSPEC_VOCAB (§4.4)', () => {
  const weirdOperators = {
    ...operators,
    weirdOp: { name: 'weirdOp', role: 'condition', evaluate: () => ({ fired: true, examined: {} }), describe: () => 'weird', argSpec: () => ({ kind: 'not_a_real_kind' }) },
  };

  it('fires when argSpec().kind is outside the §4.4 vocabulary', () => {
    const fired = gatesFired([entry(baseRule({ scope: { weirdOp: {} } }))], { operators: weirdOperators });
    expect(fired.has('ARGSPEC_VOCAB')).toBe(true);
  });
  it('stays quiet on a real operator\'s argSpec()', () => {
    const fired = gatesFired([entry(baseRule())], { operators: weirdOperators });
    expect(fired.has('ARGSPEC_VOCAB')).toBe(false);
  });
});

describe('RANKING_FIELD_NO_FALLBACK (§4.3 / §15.3) — data-driven, not type-driven', () => {
  // §15.3: "omits fallbackField where the field is nullable IN THE DATA" —
  // not in the type. rateMils/weight are typed `number | null`
  // (LineFacts), but that alone is not enough to hard-fail per the
  // corrected gate; a `rankFieldNullability.isNullableInData(field,
  // siValues)` dependency answers the real question. These fakes simulate
  // both answers without ever touching src/data/opps.cy2026.ts.
  const NULLABLE_FOR_TESTSI = {
    isNullableInData: (field: string, siValues: readonly string[] | null) => field === 'weight' && (siValues === null || siValues.includes('TESTSI')),
  };
  const NOT_NULLABLE = { isNullableInData: () => false };
  const ALWAYS_NULLABLE = { isNullableInData: () => true };

  function withRanking(field: string, fallbackField?: string) {
    return baseRule({
      scope: {
        isHighestBy: {
          field,
          among: { op: 'siIn', args: { si: ['TESTSI'] } },
          tiebreak: 'codeAsc',
          ...(fallbackField !== undefined ? { fallbackField } : {}),
        },
      },
    });
  }

  it('fires when the field IS nullable in the (simulated) data for the ranked domain', () => {
    const violations = violationsFor('RANKING_FIELD_NO_FALLBACK', [entry(withRanking('weight'))], { rankFieldNullability: NULLABLE_FOR_TESTSI });
    expect(violations.length).toBeGreaterThan(0);
  });
  it('stays quiet when the field has zero nulls in the data for the ranked domain, even though the TYPE permits null', () => {
    const violations = violationsFor('RANKING_FIELD_NO_FALLBACK', [entry(withRanking('weight'))], { rankFieldNullability: NOT_NULLABLE });
    expect(violations.length).toBe(0);
  });
  it('records the type-permits-null-but-data-is-clean case as an informational note, never a violation', () => {
    const { violations, info } = lintRules([entry(withRanking('weight'))], { operators, isKnownFlagCode, rankFieldNullability: NOT_NULLABLE });
    expect(violations.some((v) => v.gate === 'RANKING_FIELD_NO_FALLBACK')).toBe(false);
    expect(info.some((line) => line.includes('RANKING_FIELD_NO_FALLBACK') && line.includes('informational'))).toBe(true);
  });
  it('stays quiet when a fallbackField is declared, regardless of data nullability', () => {
    expect(violationsFor('RANKING_FIELD_NO_FALLBACK', [entry(withRanking('weight', 'rateMils'))], { rankFieldNullability: NULLABLE_FOR_TESTSI }).length).toBe(0);
  });
  it('stays quiet for a never-nullable-by-type field (unitCount), even if the data lookup (wrongly) claims otherwise', () => {
    expect(violationsFor('RANKING_FIELD_NO_FALLBACK', [entry(withRanking('unitCount'))], { rankFieldNullability: ALWAYS_NULLABLE }).length).toBe(0);
  });
  it('also fires for bundleUnder\'s "highestBy" when nullable in data', () => {
    const rule = baseRule({
      then: [{ bundleUnder: { highestBy: 'rateMils', among: { op: 'siIn', args: { si: ['TESTSI'] } }, tiebreak: 'codeAsc' } }],
    });
    const nullableRate = { isNullableInData: (field: string) => field === 'rateMils' };
    expect(violationsFor('RANKING_FIELD_NO_FALLBACK', [entry(rule)], { rankFieldNullability: nullableRate }).length).toBeGreaterThan(0);
  });
  it('checks the whole dataset (siValues: null) when the "among" domain is not statically resolvable', () => {
    // `among` wraps a claim-relational predicate (statusIn), which
    // extractSiDomain cannot resolve to a concrete SI set — the gate must
    // fall back to a whole-dataset (conservative) nullability question
    // rather than silently skipping the check.
    const rule = baseRule({
      scope: { isHighestBy: { field: 'weight', among: { op: 'statusIn', args: { status: ['BUNDLED'] } }, tiebreak: 'codeAsc' } },
    });
    let seenSiValues: unknown = 'not-called';
    const spy = {
      isNullableInData: (field: string, siValues: readonly string[] | null) => {
        seenSiValues = siValues;
        return false;
      },
    };
    lintRules([entry(rule)], { operators, isKnownFlagCode, rankFieldNullability: spy });
    expect(seenSiValues).toBeNull();
  });
});

describe('EPOCH_TOO_LATE (§2.5)', () => {
  it('fires when a band-4000 subBand-a rule declares epoch E3a (its own sub-band\'s produced epoch)', () => {
    expect(
      violationsFor('EPOCH_TOO_LATE', [entry(baseRule({ band: 4000, subBand: 'a', epoch: 'E3a', scope: { siIn: { si: ['Q1'] } } }))]).length,
    ).toBeGreaterThan(0);
  });
  it('stays quiet at the correct ceiling epoch (E2) for band-4000 subBand a', () => {
    expect(
      violationsFor('EPOCH_TOO_LATE', [entry(baseRule({ band: 4000, subBand: 'a', epoch: 'E2', scope: { siIn: { si: ['Q1'] } } }))]).length,
    ).toBe(0);
  });
});

describe('UNIMPLEMENTED_WITHOUT_DATA_REQUIRED (§4.3 / §9.5)', () => {
  function reservedRule(dataRequired: unknown) {
    return baseRule({
      scope: { always: {} },
      when: { unimplemented: { reason: 'test' } },
      then: [{ flag: { code: 'TEST.EVALUATE_FIXTURE', severity: 'gap', message: 'reserved' } }],
      ...(dataRequired !== undefined ? { dataRequired } : {}),
    });
  }

  it('fires when "when" is unimplemented but dataRequired is not true', () => {
    expect(violationsFor('UNIMPLEMENTED_WITHOUT_DATA_REQUIRED', [entry(reservedRule(undefined))]).length).toBeGreaterThan(0);
    expect(violationsFor('UNIMPLEMENTED_WITHOUT_DATA_REQUIRED', [entry(reservedRule(false))]).length).toBeGreaterThan(0);
  });
  it('stays quiet when dataRequired is true', () => {
    expect(violationsFor('UNIMPLEMENTED_WITHOUT_DATA_REQUIRED', [entry(reservedRule(true))]).length).toBe(0);
  });
});

describe('LINE_EFFECT_IN_CLAIM_SCOPE (§4.2)', () => {
  it('fires when a claim-scoped rule writes a line effect', () => {
    const rule = baseRule({ scopeTarget: 'claim', scope: { claimAlways: {} }, then: [{ setStatus: { status: 'PAID' } }] });
    expect(violationsFor('LINE_EFFECT_IN_CLAIM_SCOPE', [entry(rule)]).length).toBeGreaterThan(0);
  });
  it('stays quiet when a claim-scoped rule writes only flag', () => {
    const rule = baseRule({
      scopeTarget: 'claim',
      scope: { claimAlways: {} },
      then: [{ flag: { code: 'TEST.EVALUATE_FIXTURE', severity: 'info', message: 'x' } }],
    });
    expect(violationsFor('LINE_EFFECT_IN_CLAIM_SCOPE', [entry(rule)]).length).toBe(0);
  });
});

describe('CLAIM_AMOUNT_EFFECT_IN_LINE_SCOPE (§4.2) — forward-compatible, currently reachable only via an injected setAmount', () => {
  const withSetAmount = {
    ...operators,
    setAmount: {
      name: 'setAmount',
      role: 'effect',
      describe: () => 'sets an amount',
      argSpec: (args: { target?: string }) => ({ kind: 'effect', target: args?.target }),
    },
  };

  it('fires when a line-scoped rule targets a claim-level amount', () => {
    const rule = baseRule({ scopeTarget: 'line', then: [{ setAmount: { target: 'claimMedicareMils', valueMils: 100 } }] });
    const fired = gatesFired([entry(rule)], { operators: withSetAmount });
    expect(fired.has('CLAIM_AMOUNT_EFFECT_IN_LINE_SCOPE')).toBe(true);
  });
  it('stays quiet when a line-scoped rule targets a line-level amount', () => {
    const rule = baseRule({ scopeTarget: 'line', then: [{ setAmount: { target: 'medicareMils', valueMils: 100 } }] });
    const fired = gatesFired([entry(rule)], { operators: withSetAmount });
    expect(fired.has('CLAIM_AMOUNT_EFFECT_IN_LINE_SCOPE')).toBe(false);
  });
});

describe('UNKNOWN_FLAG_CODE (§12.7)', () => {
  it('fires on a flag code absent from the manifest', () => {
    const rule = baseRule({ then: [{ flag: { code: 'TEST.NOT.A.REAL.CODE', severity: 'info', message: 'x' } }] });
    expect(violationsFor('UNKNOWN_FLAG_CODE', [entry(rule)]).length).toBeGreaterThan(0);
  });
  it('stays quiet on a registered code', () => {
    const rule = baseRule({ then: [{ flag: { code: 'TEST.EVALUATE_FIXTURE', severity: 'info', message: 'x' } }] });
    expect(violationsFor('UNKNOWN_FLAG_CODE', [entry(rule)]).length).toBe(0);
  });
});

describe('D45_SCOPE_NOT_DECIDABLE (§4.3 / D45) — ratchet', () => {
  it('is counted (and, with baseline 0, exceeds) when scope carries a claim-relational predicate', () => {
    const rule = baseRule({ scope: { statusIn: { status: ['BUNDLED'] } } });
    const { d45, violations } = lintRules([entry(rule)], { operators, isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE, d45Baseline: 0 });
    expect(d45.count).toBe(1);
    expect(d45.exceeded).toBe(true);
    expect(violations.some((v) => v.gate === 'D45_SCOPE_NOT_DECIDABLE')).toBe(true);
  });
  it('stays at zero for a plain siIn scope', () => {
    const rule = baseRule({ scope: { siIn: { si: ['T'] } } });
    const { d45 } = lintRules([entry(rule)], { operators, isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE, d45Baseline: 0 });
    expect(d45.count).toBe(0);
    expect(d45.exceeded).toBe(false);
  });
  it('excludes claim-scoped rules — a claim-scope selector in scope is correct there, not a violation', () => {
    const rule = baseRule({ scopeTarget: 'claim', scope: { claimContainsAny: { si: ['T'] } }, then: [{ flag: { code: 'TEST.EVALUATE_FIXTURE', severity: 'info', message: 'x' } }] });
    const { d45 } = lintRules([entry(rule)], { operators, isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE, d45Baseline: 0 });
    expect(d45.count).toBe(0);
  });
  it('does not exceed the real, documented baseline when nothing is added beyond it', () => {
    // Not a claim about the shipped registry (see final report for the
    // real measured count) — just proves the ratchet's own arithmetic:
    // exactly D45_BASELINE synthetic offenders does not exceed.
    const rules = Array.from({ length: D45_BASELINE }, (_, i) => entry(baseRule({ id: `D45.SYN.${i}`, scope: { isExempt: {} } })));
    const { d45 } = lintRules(rules, { operators, isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE });
    expect(d45.count).toBe(D45_BASELINE);
    expect(d45.exceeded).toBe(false);
  });
});

describe('SECOND_WRITE_STRUCTURAL_EFFECT (§4.3)', () => {
  function writer(id: string, band: number, order: number, withGuard: boolean) {
    return baseRule({
      id,
      band,
      order,
      epoch: band === 2000 ? 'E1' : 'E3b',
      scope: withGuard
        ? { allOf: { children: [{ op: 'siIn', args: { si: ['Q9'] } }, { op: 'not', args: { child: { op: 'statusIn', args: { status: ['BUNDLED'] } } } }] } }
        : { siIn: { si: ['Q9'] } },
      then: [{ setBasis: { value: 'OPPS_APC' } }],
    });
  }

  it('fires across bands on overlapping domain with no not-BUNDLED guard on the later rule', () => {
    const fired = gatesFired([entry(writer('EARLY', 2000, 2100, false)), entry(writer('LATE', 5000, 5100, false))]);
    expect(fired.has('SECOND_WRITE_STRUCTURAL_EFFECT')).toBe(true);
  });
  it('stays quiet when the later rule\'s scope guards against already-bundled lines', () => {
    const fired = gatesFired([entry(writer('EARLY', 2000, 2100, false)), entry(writer('LATE', 5000, 5100, true))]);
    expect(fired.has('SECOND_WRITE_STRUCTURAL_EFFECT')).toBe(false);
  });
  it('stays quiet when domains are disjoint', () => {
    const a = writer('A', 2000, 2100, false);
    const b = baseRule({ id: 'B', band: 5000, order: 5100, epoch: 'E3b', scope: { siIn: { si: ['Q8'] } }, then: [{ setBasis: { value: 'OPPS_APC' } }] });
    const fired = gatesFired([entry(a), entry(b)]);
    expect(fired.has('SECOND_WRITE_STRUCTURAL_EFFECT')).toBe(false);
  });
});

describe('CROSS_BAND_SETSTATUS (§4.3)', () => {
  function statusWriter(id: string, band: number, withGuard: boolean) {
    return baseRule({
      id,
      band,
      order: band + 1,
      epoch: band === 2000 ? 'E1' : 'E3b',
      scope: withGuard
        ? { allOf: { children: [{ op: 'siIn', args: { si: ['Q9'] } }, { op: 'not', args: { child: { op: 'statusIn', args: { status: ['BUNDLED'] } } } }] } }
        : { siIn: { si: ['Q9'] } },
      then: [{ setStatus: { status: 'PAID' } }],
    });
  }

  it('fires across bands on overlapping domain with no guard', () => {
    const fired = gatesFired([entry(statusWriter('EARLY', 2000, false)), entry(statusWriter('LATE', 5000, false))]);
    expect(fired.has('CROSS_BAND_SETSTATUS')).toBe(true);
  });
  it('stays quiet within the SAME band regardless of guard (last-writer-wins is legal there)', () => {
    const fired = gatesFired([entry(statusWriter('A', 5000, false)), entry(baseRule({ id: 'B', band: 5000, order: 5200, epoch: 'E3b', scope: { siIn: { si: ['Q9'] } }, then: [{ setStatus: { status: 'PAID' } }] }))]);
    expect(fired.has('CROSS_BAND_SETSTATUS')).toBe(false);
  });
  it('stays quiet across bands when the later rule\'s scope guards against already-bundled lines', () => {
    const fired = gatesFired([entry(statusWriter('EARLY', 2000, false)), entry(statusWriter('LATE', 5000, true))]);
    expect(fired.has('CROSS_BAND_SETSTATUS')).toBe(false);
  });
});

describe('D66_BUNDLE_UNDER_MISSING_GUARD (D66)', () => {
  function bundler(id: string, band: number, subBand: string | undefined, epoch: string, withAmongGuard: boolean) {
    return baseRule({
      id,
      band,
      subBand,
      order: band + 1,
      epoch,
      scope: { siIn: { si: [id] } },
      then: [
        {
          bundleUnder: withAmongGuard
            ? { highestBy: 'rateMils', among: { op: 'allOf', args: { children: [{ op: 'siIn', args: { si: ['Q9'] } }, { op: 'not', args: { child: { op: 'statusIn', args: { status: ['BUNDLED'] } } } }] } }, tiebreak: 'codeAsc' }
            : { highestBy: 'rateMils', among: { op: 'siIn', args: { si: ['Q9'] } }, tiebreak: 'codeAsc' },
        },
      ],
    });
  }

  it('fires when a later-window bundleUnder\'s "among" has no not-BUNDLED guard and an earlier-window bundler exists', () => {
    const early = bundler('EARLY', 2000, undefined, 'E1', false);
    const late = bundler('LATE', 4000, 'a', 'E2', false);
    const fired = gatesFired([entry(early), entry(late)]);
    expect(fired.has('D66_BUNDLE_UNDER_MISSING_GUARD')).toBe(true);
  });
  it('stays quiet when the "among" carries the not-BUNDLED guard', () => {
    const early = bundler('EARLY', 2000, undefined, 'E1', false);
    const late = bundler('LATE', 4000, 'a', 'E2', true);
    const fired = gatesFired([entry(early), entry(late)]);
    expect(fired.has('D66_BUNDLE_UNDER_MISSING_GUARD')).toBe(false);
  });
  it('stays quiet when no earlier-window bundleUnder writer exists at all', () => {
    const only = bundler('ONLY', 2000, undefined, 'E1', false);
    const fired = gatesFired([entry(only)]);
    expect(fired.has('D66_BUNDLE_UNDER_MISSING_GUARD')).toBe(false);
  });

  it('is a RATCHET (debt baseline, not an approval): still reported in `violations`, but only fails via `d66Guard.exceeded`', () => {
    const early = bundler('EARLY', 2000, undefined, 'E1', false);
    const late = bundler('LATE', 4000, 'a', 'E2', false);
    const { violations, d66Guard } = lintRules([entry(early), entry(late)], {
      operators,
      isKnownFlagCode,
      rankFieldNullability: NEVER_NULLABLE,
      d66GuardBaseline: 0,
    });
    expect(violations.some((v) => v.gate === 'D66_BUNDLE_UNDER_MISSING_GUARD')).toBe(true);
    expect(d66Guard.count).toBe(1);
    expect(d66Guard.ruleIds).toEqual(['LATE']);
    expect(d66Guard.exceeded).toBe(true); // baseline 0 -> any hit exceeds.
  });
  it('does not exceed at the default baseline with exactly that many hits, and exceeds with one more', () => {
    const rules = [entry(bundler('EARLY', 2000, undefined, 'E1', false))];
    for (let i = 0; i < D66_GUARD_BASELINE; i++) rules.push(entry(bundler(`LATE${i}`, 4000, 'a', 'E2', false)));
    const atBaseline = lintRules(rules, { operators, isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE });
    expect(atBaseline.d66Guard.count).toBe(D66_GUARD_BASELINE);
    expect(atBaseline.d66Guard.exceeded).toBe(false);

    rules.push(entry(bundler('LATE_ONE_MORE', 4000, 'a', 'E2', false)));
    const overBaseline = lintRules(rules, { operators, isKnownFlagCode, rankFieldNullability: NEVER_NULLABLE });
    expect(overBaseline.d66Guard.count).toBe(D66_GUARD_BASELINE + 1);
    expect(overBaseline.d66Guard.exceeded).toBe(true);
  });
});

describe('D66_BUNDLE_UNDER_STALE_EPOCH (D66) — same-window peer conflict', () => {
  function peerBundler(id: string, subjectSi: string, amongSi: readonly string[], rankGatedWhen: boolean) {
    return baseRule({
      id,
      band: 4000,
      subBand: 'a',
      order: 4000 + amongSi.length,
      epoch: 'E2',
      scope: { allOf: { children: [{ op: 'siIn', args: { si: [subjectSi] } }, { op: 'not', args: { child: { op: 'statusIn', args: { status: ['BUNDLED'] } } } }] } },
      ...(rankGatedWhen
        ? {
            when: {
              isNotHighestBy: { field: 'rateMils', among: { op: 'siIn', args: { si: [subjectSi] } }, tiebreak: 'codeAsc' },
            },
          }
        : {}),
      then: [{ setStatus: { status: 'BUNDLED' } }, { bundleUnder: { highestBy: 'rateMils', among: { op: 'siIn', args: { si: amongSi } }, tiebreak: 'codeAsc' } }],
    });
  }

  it('fires when a same-window peer unconditionally bundles a subject inside this rule\'s "among" pool', () => {
    // Reproduces the original OPPS.PKG.Q4.COMPANION shape: WIDE's among
    // pool includes NARROW's subject SI, and NARROW bundles unconditionally.
    const wide = peerBundler('WIDE', 'Q4TEST', ['S', 'T', 'NARROWSI'], false);
    const narrow = peerBundler('NARROW', 'NARROWSI', ['S', 'T'], false);
    const fired = gatesFired([entry(wide), entry(narrow)]);
    expect(fired.has('D66_BUNDLE_UNDER_STALE_EPOCH')).toBe(true);
  });
  it('stays quiet when the peer\'s bundling is rank-gated (the documented safe/nested shape)', () => {
    const wide = peerBundler('WIDE', 'Q4TEST', ['S', 'T', 'NARROWSI'], false);
    const narrow = peerBundler('NARROW', 'NARROWSI', ['S', 'T'], true);
    const fired = gatesFired([entry(wide), entry(narrow)]);
    expect(fired.has('D66_BUNDLE_UNDER_STALE_EPOCH')).toBe(false);
  });
  it('stays quiet when the two rules are in different sub-bands (not sharing a frozen epoch)', () => {
    const wide = peerBundler('WIDE', 'Q4TEST', ['S', 'T', 'NARROWSI'], false);
    const narrowLater = { ...peerBundler('NARROW', 'NARROWSI', ['S', 'T'], false), subBand: 'b', epoch: 'E3a' };
    const fired = gatesFired([entry(wide), entry(narrowLater)]);
    expect(fired.has('D66_BUNDLE_UNDER_STALE_EPOCH')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pure helper sanity — normalizeNode/walkTree are exported and used
// directly above; a couple of direct checks on shape-handling.
// ---------------------------------------------------------------------------

describe('normalizeNode / walkTree (envelope and {op,args} forms)', () => {
  it('normalizes a single-key envelope', () => {
    expect(normalizeNode({ siIn: { si: ['T'] } })).toEqual({ op: 'siIn', args: { si: ['T'] } });
  });
  it('normalizes an {op,args} node', () => {
    expect(normalizeNode({ op: 'siIn', args: { si: ['T'] } })).toEqual({ op: 'siIn', args: { si: ['T'] } });
  });
  it('returns null for a malformed node', () => {
    expect(normalizeNode({ a: 1, b: 2 })).toBeNull();
    expect(normalizeNode(null)).toBeNull();
    expect(normalizeNode('nope')).toBeNull();
  });
  it('walks nested allOf/not children', () => {
    const seen: string[] = [];
    walkTree(
      { allOf: { children: [{ op: 'siIn', args: { si: ['T'] } }, { op: 'not', args: { child: { op: 'isExempt', args: {} } } }] } },
      (op) => seen.push(op),
    );
    expect(seen).toEqual(['allOf', 'siIn', 'not', 'isExempt']);
  });
});

// ---------------------------------------------------------------------------
// Integration fence — the REAL, hand-authored registry, run through the
// exact same lintRules() the CLI uses. Documents (and pins) the currently
// known state so a future change to the registry that fixes or worsens one
// of these is visible as a test diff, not just as CLI output nobody reads.
// See this unit's final report for the narrative behind each number.
// ---------------------------------------------------------------------------

describe('real registry — pinned current state (see final report)', () => {
  function loadRealRules() {
    const dir = path.join(__dirname, '..', 'src', 'registry');
    const files = ['opps.exempt.json', 'opps.packaging.json', 'opps.dispositions.json'];
    return files.flatMap((f) => {
      const rows = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Record<string, unknown>[];
      return rows.map((rule) => entry(rule, f));
    });
  }

  it('D45 and D66-guard ratchets sit exactly at their documented baselines — not below, not above — and RANKING_FIELD_NO_FALLBACK is clean against the REAL loaded data', async () => {
    // Real data, not a synthetic stand-in: this is the one test in this
    // file meant to answer "does the real registry, checked against the
    // real CY2026 data, currently pass or fail" — every other test in this
    // file uses a synthetic rankFieldNullability precisely so it does NOT
    // depend on what happens to be loaded today.
    const { OPPS_ROWS } = (await import('../src/data/opps.cy2026.js')) as { OPPS_ROWS: readonly (readonly [string, string, string | null, number | null, number | null])[] };
    const rankFieldNullability = buildRankFieldNullability(OPPS_ROWS);

    const rules = loadRealRules();
    const { d45, d66Guard, violations } = lintRules(rules, { operators, isKnownFlagCode, rankFieldNullability });

    expect(d45.count).toBe(D45_BASELINE);
    expect(d45.exceeded).toBe(false);
    expect(d66Guard.count).toBe(2);
    expect(d66Guard.baseline).toBe(D66_GUARD_BASELINE);
    expect(d66Guard.exceeded).toBe(false);
    expect([...d66Guard.ruleIds].sort()).toEqual(['OPPS.PKG.Q1.COMPANION', 'OPPS.PKG.Q2.COMPANION']);

    // Corrected gate (§15.3: nullable IN THE DATA): every packaging SI
    // (J1/J2/S/T/V/Q1/Q2/Q3) currently carries a rate in the loaded
    // CY2026 data, so this is clean — see final report for the measured
    // denominator and the reconciliation of an earlier miscount.
    const byGate = new Map<string, number>();
    for (const v of violations) byGate.set(v.gate, (byGate.get(v.gate) ?? 0) + 1);
    expect(byGate.get('RANKING_FIELD_NO_FALLBACK')).toBeUndefined();

    // Everything else — every non-ratchet gate — is clean: the registry
    // fully passes every hard-fail gate today.
    const RATCHETED = new Set(['D45_SCOPE_NOT_DECIDABLE', 'D66_BUNDLE_UNDER_MISSING_GUARD']);
    const hardViolations = violations.filter((v) => !RATCHETED.has(v.gate));
    expect(hardViolations).toEqual([]);
  });
});
