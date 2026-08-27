import { describe, expect, it } from 'vitest';
import { evaluate, type AdmittedLine, type EvaluateResult, type Rule } from '../src/dsl/evaluate.js';
import type { Epoch, EngineError, Fact } from '../src/types.js';

/** `evaluate()`'s load-time faults throw a plain `EngineError` object, not an `Error` instance (same convention as `dsl/validate.ts`) — so assertions match on `.detail`/`.code` via try/catch, not `.toThrow(/regex/)`, which only inspects `Error#message`. */
function isEngineError(e: unknown): e is EngineError {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'EngineError';
}

// ---------------------------------------------------------------------------
// Fixture builders. A small synthetic registry, not the real one (§ per the
// build brief — U13+ registry content doesn't exist yet). Every rule below
// is invented purely to exercise the interpreter's own mechanics: epoch
// layering, conflict resolution, stop/alwaysEvaluate, claim scope, scope
// exclusion, and fact references.
// ---------------------------------------------------------------------------

function line(overrides: Partial<AdmittedLine> = {}): AdmittedLine {
  return {
    lineId: 'L1',
    code: 'C1',
    resolvedSI: 'J1',
    apc: null,
    schedule: null,
    modifiers: [],
    unitCount: 1,
    rateMils: 1000,
    weight: null,
    chargeMils: 2000,
    dos: '20260115',
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> & Pick<Rule, 'id' | 'band' | 'order' | 'epoch' | 'scope' | 'then'>): Rule {
  return {
    version: '2026.1',
    phase: 'ADJUDICATE',
    scopeTarget: 'line',
    citation: 'test fixture',
    ...overrides,
  };
}

const ALWAYS = { op: 'always', args: {} };
function siIn(si: readonly string[]) {
  return { op: 'siIn', args: { si } };
}
function statusIn(status: readonly string[]) {
  return { op: 'statusIn', args: { status } };
}
function notNode(child: unknown) {
  return { op: 'not', args: { child } };
}
function allOf(children: readonly unknown[]) {
  return { op: 'allOf', args: { children } };
}
function setStatus(status: string) {
  return { op: 'setStatus', args: { status } };
}
function bundleUnder(highestBy: string, among: unknown, tiebreak: string, fallbackField?: string) {
  return { op: 'bundleUnder', args: { highestBy, among, tiebreak, ...(fallbackField !== undefined ? { fallbackField } : {}) } };
}
function isHighestBy(field: string, among: unknown, tiebreak: string, fallbackField?: string) {
  return { op: 'isHighestBy', args: { field, among, tiebreak, ...(fallbackField !== undefined ? { fallbackField } : {}) } };
}
function isNotHighestBy(field: string, among: unknown, tiebreak: string, fallbackField?: string) {
  return { op: 'isNotHighestBy', args: { field, among, tiebreak, ...(fallbackField !== undefined ? { fallbackField } : {}) } };
}
function ordinalIs(field: string, among: unknown, tiebreak: string, equals: number, fallbackField?: string) {
  return { op: 'ordinalIs', args: { field, among, tiebreak, equals, ...(fallbackField !== undefined ? { fallbackField } : {}) } };
}
function ordinalAtLeast(field: string, among: unknown, tiebreak: string, atLeast: number, fallbackField?: string) {
  return { op: 'ordinalAtLeast', args: { field, among, tiebreak, atLeast, ...(fallbackField !== undefined ? { fallbackField } : {}) } };
}
/**
 * `code` here is always the shared `TEST.EVALUATE_FIXTURE` manifest marker
 * (src/flags.ts) — real emission is now validated against that manifest
 * (U17 Part A, §12.7), so these synthetic fixture rules can no longer use
 * arbitrary made-up codes like `'EDIT_SLOT'`. `label` still distinguishes
 * one fixture flag from another; assertions below match on `message`
 * (`'flag <label>'`) instead of `code`.
 */
function flagEffect(label: string, severity = 'info') {
  return { op: 'flag', args: { code: 'TEST.EVALUATE_FIXTURE', severity, message: `flag ${label}` } };
}

function factByEpoch(facts: Readonly<Record<Epoch, readonly Fact[]>>, epoch: Epoch, factId: string): Fact | undefined {
  return facts[epoch].find((f) => f.factId === factId);
}

function detOf(result: EvaluateResult, lineId: string) {
  const d = result.determinations.find((x) => x.lineId === lineId);
  if (d === undefined) throw new Error(`no determination for ${lineId}`);
  return d;
}

// ===========================================================================
// The two-epoch requirement (§2.5) — band 4000's defining scenario.
// ===========================================================================

describe('band 4000 — two fact epochs', () => {
  // L1 (J1, rate 6000), L2 (S, rate 9000), L3 (T, rate 4000), L4 (Q4, the
  // line a companion rule bundles). Sub-band a bundles L2 under L1;
  // sub-band b then bundles L4 under the highest-rate SURVIVING member of
  // {J1,S,T} — which must be L1 (6000), not L2 (9000, but already bundled).
  const lines = [
    line({ lineId: 'L1', code: 'A1', resolvedSI: 'J1', rateMils: 6000 }),
    line({ lineId: 'L2', code: 'A2', resolvedSI: 'S', rateMils: 9000 }),
    line({ lineId: 'L3', code: 'A3', resolvedSI: 'T', rateMils: 4000 }),
    line({ lineId: 'L4', code: 'A4', resolvedSI: 'Q4', rateMils: null }),
  ];

  const ruleA = rule({
    id: 'PKG.A',
    band: 4000,
    subBand: 'a',
    order: 4100,
    epoch: 'E2',
    scope: siIn(['S']),
    then: [setStatus('BUNDLED'), bundleUnder('rateMils', siIn(['J1']), 'codeAsc')],
  });

  const ruleBCorrect = rule({
    id: 'PKG.B.CORRECT',
    band: 4000,
    subBand: 'b',
    order: 4200,
    epoch: 'E3a', // the correct ceiling for sub-band b — sees sub-band a's effects
    scope: siIn(['Q4']),
    then: [
      setStatus('BUNDLED'),
      bundleUnder('rateMils', allOf([siIn(['J1', 'S', 'T']), notNode(statusIn(['BUNDLED']))]), 'codeAsc'),
    ],
  });

  it('E3a and E3b are genuinely different fact snapshots — E3a predates sub-band b, E3b postdates it', () => {
    const result = evaluate({ lines, options: {}, rules: [ruleA, ruleBCorrect] });
    const e3aBundled = factByEpoch(result.facts, 'E3a', 'E3a:bundledSet');
    const e3bBundled = factByEpoch(result.facts, 'E3b', 'E3b:bundledSet');
    expect(e3aBundled?.lineIds).toEqual(['L2']); // only sub-band a's effect has happened yet
    expect(e3bBundled?.lineIds).toEqual(['L2', 'L4']); // sub-band b's effect is now visible too
  });

  it('a correctly-epoched sub-band b rule bundles under the highest surviving (non-bundled) member, never the already-bundled one', () => {
    const result = evaluate({ lines, options: {}, rules: [ruleA, ruleBCorrect] });
    expect(detOf(result, 'L2').bundledUnder).toBe('L1');
    expect(detOf(result, 'L4').bundledUnder).toBe('L1'); // not L2, even though L2 has the higher raw rate
  });

  it('bundleUnder rejects a target that is already bundled — caught even when a sub-band b rule is (mis)configured to read a too-early epoch whose snapshot has not yet observed sub-band a\'s bundling', () => {
    const ruleBStale = rule({
      id: 'PKG.B.STALE',
      band: 4000,
      subBand: 'b',
      order: 4200,
      epoch: 'E2', // legal per the ceiling check (E2 <= E3a), but stale: predates sub-band a's own effects
      scope: siIn(['Q4']),
      // No exclusion of already-bundled lines — at E2's snapshot nothing is
      // bundled yet, so this predicate can't see the problem coming.
      then: [setStatus('BUNDLED'), bundleUnder('rateMils', siIn(['J1', 'S', 'T']), 'codeAsc')],
    });
    const result = evaluate({ lines, options: {}, rules: [ruleA, ruleBStale] });
    const l4 = detOf(result, 'L4');
    expect(l4.bundledUnder).toBeNull();
    const errored = l4.trace.find((e) => e.ruleId === 'PKG.B.STALE');
    expect(errored?.outcome).toBe('ERRORED');
    expect(l4.flags.some((f) => f.code === 'ENGINE.RULE_FAULT' && f.message.includes('already bundled'))).toBe(true);
  });

  it('a rule declaring an epoch at or after its own sub-band position is a load-time error', () => {
    const badRule = rule({
      id: 'PKG.B.TOO_LATE',
      band: 4000,
      subBand: 'b',
      order: 4200,
      epoch: 'E3b', // sub-band b's ceiling is E3a — E3b is at-or-after its own position
      scope: siIn(['Q4']),
      then: [setStatus('BUNDLED')],
    });
    try {
      evaluate({ lines, options: {}, rules: [badRule] });
      expect.unreachable('expected a throw');
    } catch (e) {
      expect(isEngineError(e)).toBe(true);
      if (!isEngineError(e)) return;
      expect(e.code).toBe('REGISTRY_INVARIANT_VIOLATION');
      expect(e.detail).toMatch(/may read at most/);
    }
  });
});

// ===========================================================================
// setStatus conflict resolution — last-writer-wins within a band, error
// across bands.
// ===========================================================================

describe('setStatus conflict resolution (§4.3)', () => {
  const lines = [line({ lineId: 'L1', resolvedSI: 'J1' })];

  it('a cross-band overwrite is an error, and the earlier value survives on the (now-halted) line', () => {
    const r1 = rule({ id: 'R1', band: 1000, order: 1000, epoch: 'E0', scope: ALWAYS, then: [setStatus('PAID_EXEMPT')] });
    const r2 = rule({ id: 'R2', band: 2000, order: 2000, epoch: 'E1', scope: ALWAYS, then: [setStatus('BUNDLED')] });
    const result = evaluate({ lines, options: {}, rules: [r1, r2] });
    const det = detOf(result, 'L1');
    expect(det.status).toBe('PAID_EXEMPT'); // R2's write never landed
    expect(det.trace.map((e) => [e.ruleId, e.outcome])).toEqual([
      ['R1', 'FIRED'],
      ['R2', 'ERRORED'],
    ]);
  });

  it('a same-band overwrite is last-writer-wins, and the earlier Evaluation records supersededBy', () => {
    const r1 = rule({ id: 'R1', band: 2000, order: 2010, epoch: 'E1', scope: ALWAYS, then: [setStatus('PAID')] });
    const r2 = rule({ id: 'R2', band: 2000, order: 2020, epoch: 'E1', scope: ALWAYS, then: [setStatus('BUNDLED')] });
    const result = evaluate({ lines, options: {}, rules: [r1, r2] });
    const det = detOf(result, 'L1');
    expect(det.status).toBe('BUNDLED');
    const ev1 = det.trace.find((e) => e.ruleId === 'R1');
    const ev2 = det.trace.find((e) => e.ruleId === 'R2');
    expect(ev1?.supersededBy).toBe('R2');
    expect(ev2?.supersededBy).toBeNull();
  });

  it('exclusive: true on the earlier writer turns a same-band overwrite into an error', () => {
    const r1 = rule({ id: 'R1', band: 2000, order: 2010, epoch: 'E1', scope: ALWAYS, exclusive: true, then: [setStatus('PAID')] });
    const r2 = rule({ id: 'R2', band: 2000, order: 2020, epoch: 'E1', scope: ALWAYS, then: [setStatus('BUNDLED')] });
    const result = evaluate({ lines, options: {}, rules: [r1, r2] });
    const det = detOf(result, 'L1');
    expect(det.status).toBe('PAID'); // R1's exclusive write stands
    expect(det.trace.find((e) => e.ruleId === 'R2')?.outcome).toBe('ERRORED');
  });
});

// ===========================================================================
// Structural effects — first-writer-wins, any band.
// ===========================================================================

describe('structural effects (bundleUnder / convertSI / route / setBasis) — first-writer-wins, any band', () => {
  it('a second convertSI write, in a different band, is an error', () => {
    const lines = [line({ lineId: 'L1', resolvedSI: 'Q4' })];
    const r1 = rule({ id: 'R1', band: 2000, order: 2000, epoch: 'E1', scope: ALWAYS, then: [{ op: 'convertSI', args: { to: 'A' } }] });
    const r2 = rule({ id: 'R2', band: 3000, order: 3000, epoch: 'E1', scope: ALWAYS, then: [{ op: 'convertSI', args: { to: 'B' } }] });
    const result = evaluate({ lines, options: {}, rules: [r1, r2] });
    const det = detOf(result, 'L1');
    expect(det.effectiveSI).toBe('A'); // R1's write stands
    expect(det.trace.find((e) => e.ruleId === 'R2')?.outcome).toBe('ERRORED');
  });

  it('a second bundleUnder write is an error even when the first already succeeded', () => {
    const lines = [
      line({ lineId: 'L1', resolvedSI: 'J1', rateMils: 5000 }),
      line({ lineId: 'L2', resolvedSI: 'S', rateMils: 1000 }),
      line({ lineId: 'L3', resolvedSI: 'Q4' }),
    ];
    const r1 = rule({ id: 'R1', band: 4000, subBand: 'a', order: 4100, epoch: 'E2', scope: siIn(['Q4']), then: [bundleUnder('rateMils', siIn(['J1']), 'codeAsc')] });
    const r2 = rule({ id: 'R2', band: 4000, subBand: 'b', order: 4200, epoch: 'E3a', scope: siIn(['Q4']), then: [bundleUnder('rateMils', siIn(['S']), 'codeAsc')] });
    const result = evaluate({ lines, options: {}, rules: [r1, r2] });
    const det = detOf(result, 'L3');
    expect(det.bundledUnder).toBe('L1'); // R1's write stands
    expect(det.trace.find((e) => e.ruleId === 'R2')?.outcome).toBe('ERRORED');
  });
});

// ===========================================================================
// stop / alwaysEvaluate / SKIPPED.
// ===========================================================================

describe('stop and alwaysEvaluate (§4.3)', () => {
  it('stop halts later rules in the phase (recorded SKIPPED), except a rule declaring alwaysEvaluate', () => {
    const lines = [line({ lineId: 'L1', resolvedSI: 'J1' })];
    const r5000 = rule({ id: 'R.5000', band: 5000, order: 5000, epoch: 'E3b', scope: ALWAYS, then: [setStatus('PAID'), { op: 'stop', args: {} }] });
    const rAfter = rule({ id: 'R.AFTER', band: 5000, order: 5100, epoch: 'E3b', scope: ALWAYS, then: [flagEffect('AFTER')] });
    const r6000 = rule({
      id: 'R.6000',
      band: 6000,
      order: 6000,
      epoch: 'E4',
      alwaysEvaluate: true,
      scope: ALWAYS,
      then: [flagEffect('EDIT_SLOT')],
    });
    const result = evaluate({ lines, options: {}, rules: [r5000, rAfter, r6000] });
    const det = detOf(result, 'L1');
    expect(det.trace.find((e) => e.ruleId === 'R.5000')?.outcome).toBe('FIRED');
    expect(det.trace.find((e) => e.ruleId === 'R.AFTER')?.outcome).toBe('SKIPPED');
    expect(det.trace.find((e) => e.ruleId === 'R.6000')?.outcome).toBe('FIRED');
    expect(det.flags.some((f) => f.message === 'flag EDIT_SLOT')).toBe(true);
    expect(det.flags.some((f) => f.message === 'flag AFTER')).toBe(false);
  });
});

// ===========================================================================
// Claim-scoped rules.
// ===========================================================================

describe('claim-scoped rules (§4.2)', () => {
  it('a claim-scoped rule is evaluated exactly once on a 5-line claim, and its flag is replicated to every determination', () => {
    const lines = ['L1', 'L2', 'L3', 'L4', 'L5'].map((id) => line({ lineId: id, code: id }));
    const claimRule = rule({
      id: 'CLAIM.RULE',
      band: 2000,
      order: 2500,
      epoch: 'E1',
      scopeTarget: 'claim',
      scope: { op: 'claimAlways', args: {} },
      when: { op: 'claimLineCountAtLeast', args: { count: 5 } },
      then: [flagEffect('CLAIM_LEVEL')],
    });
    const result = evaluate({ lines, options: {}, rules: [claimRule] });

    const claimEvals = result.trace.filter((e) => e.ruleId === 'CLAIM.RULE');
    expect(claimEvals).toHaveLength(1);
    expect(claimEvals[0]?.outcome).toBe('FIRED');

    for (const det of result.determinations) {
      expect(det.flags.some((f) => f.message === 'flag CLAIM_LEVEL' && f.ruleId === 'CLAIM.RULE')).toBe(true);
      // The claim-scoped rule never appears in a per-line trace.
      expect(det.trace.some((e) => e.ruleId === 'CLAIM.RULE')).toBe(false);
    }
    expect(result.disclosures.some((f) => f.message === 'flag CLAIM_LEVEL')).toBe(true);
  });

  it('a claim-scoped rule writing a line effect is a load-time error', () => {
    const lines = [line()];
    const badRule = rule({
      id: 'CLAIM.BAD',
      band: 2000,
      order: 2500,
      epoch: 'E1',
      scopeTarget: 'claim',
      scope: { op: 'claimAlways', args: {} },
      then: [setStatus('PAID')],
    });
    try {
      evaluate({ lines, options: {}, rules: [badRule] });
      expect.unreachable('expected a throw');
    } catch (e) {
      expect(isEngineError(e)).toBe(true);
      if (!isEngineError(e)) return;
      expect(e.code).toBe('REGISTRY_INVARIANT_VIOLATION');
      expect(e.detail).toMatch(/claim-scoped rule writes line effect/);
    }
  });
});

// ===========================================================================
// Scope exclusions.
// ===========================================================================

describe('scope exclusions (§5.3a)', () => {
  it('a rule whose scope excludes every line records one Result.scopeExclusions entry, never a per-line Evaluation', () => {
    const lines = ['L1', 'L2', 'L3', 'L4', 'L5'].map((id) => line({ lineId: id, resolvedSI: 'J1' }));
    const r = rule({ id: 'R.NEVER', band: 2000, order: 2000, epoch: 'E1', scope: siIn(['ZZZ']), then: [setStatus('PAID')] });
    const result = evaluate({ lines, options: {}, rules: [r] });

    expect(result.scopeExclusions).toEqual([{ ruleId: 'R.NEVER', excludedLineIds: ['L1', 'L2', 'L3', 'L4', 'L5'] }]);
    for (const det of result.determinations) {
      expect(det.trace.some((e) => e.ruleId === 'R.NEVER')).toBe(false);
    }
  });
});

// ===========================================================================
// factRefs resolve into Result.facts — no inlined line sets.
// ===========================================================================

describe('examined.factRefs (§2.5)', () => {
  it('a claimContainsAny condition\'s factRefs resolve into Result.facts at the rule\'s declared epoch', () => {
    const lines = [line({ lineId: 'L1', resolvedSI: 'J1' }), line({ lineId: 'L2', resolvedSI: 'Q4' })];
    const r = rule({
      id: 'R.CCA',
      band: 2000,
      order: 2000,
      epoch: 'E1',
      scope: siIn(['J1']),
      when: { op: 'claimContainsAny', args: { si: ['Q4'] } },
      then: [flagEffect('SAW_Q4')],
    });
    const result = evaluate({ lines, options: {}, rules: [r] });
    const det = detOf(result, 'L1');
    const ev = det.trace.find((e) => e.ruleId === 'R.CCA');
    expect(ev?.outcome).toBe('FIRED');
    const refs = ev?.examined.factRefs ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const factId of refs) {
      const fact = factByEpoch(result.facts, 'E1', factId);
      expect(fact).toBeDefined();
      expect(fact?.lineIds).toEqual(['L2']);
    }
    // The redundant per-line inline copy operators.ts returns is dropped —
    // factRefs is the audit path, not a second copy of the same list.
    expect(ev?.examined.detail['matchingLineIds']).toBeUndefined();
  });

  it('isExempt factRefs resolve to the epoch\'s exemptSet fact', () => {
    const lines = [line({ lineId: 'L1', resolvedSI: 'N' })];
    const exemptRule = rule({ id: 'R.EXEMPT', band: 1000, order: 1000, epoch: 'E0', scope: ALWAYS, then: [{ op: 'exempt', args: {} }] });
    const readRule = rule({ id: 'R.READ', band: 2000, order: 2000, epoch: 'E1', scope: { op: 'isExempt', args: {} }, then: [flagEffect('IS_EXEMPT')] });
    const result = evaluate({ lines, options: {}, rules: [exemptRule, readRule] });
    // The scope selector itself doesn't emit an Evaluation (scope, not
    // when), but its match means readRule fires and we can inspect the
    // resulting fact set directly.
    const det = detOf(result, 'L1');
    expect(det.isExempt).toBe(true);
    expect(det.flags.some((f) => f.message === 'flag IS_EXEMPT')).toBe(true);
    const exemptFact = factByEpoch(result.facts, 'E1', 'E1:exemptSet');
    expect(exemptFact?.lineIds).toEqual(['L1']);
  });
});

// ===========================================================================
// Determinism (§2.4) — same input twice, byte-for-byte-equal structured output.
// ===========================================================================

describe('determinism', () => {
  it('running the same claim and registry twice produces deep-equal results', () => {
    const lines = [
      line({ lineId: 'L1', code: 'A1', resolvedSI: 'J1', rateMils: 6000 }),
      line({ lineId: 'L2', code: 'A2', resolvedSI: 'S', rateMils: 9000 }),
      line({ lineId: 'L3', code: 'A3', resolvedSI: 'Q4' }),
    ];
    const rules: Rule[] = [
      rule({ id: 'R1', band: 4000, subBand: 'a', order: 4100, epoch: 'E2', scope: siIn(['S']), then: [setStatus('BUNDLED'), bundleUnder('rateMils', siIn(['J1']), 'codeAsc')] }),
      rule({
        id: 'R2',
        band: 4000,
        subBand: 'b',
        order: 4200,
        epoch: 'E3a',
        scope: siIn(['Q4']),
        then: [setStatus('BUNDLED'), bundleUnder('rateMils', allOf([siIn(['J1', 'S']), notNode(statusIn(['BUNDLED']))]), 'codeAsc')],
      }),
    ];
    const a = evaluate({ lines, options: {}, rules });
    const b = evaluate({ lines, options: {}, rules });
    expect(a).toEqual(b);
  });
});

// ===========================================================================
// U9a — ranking-logic dedup invariant. `bundleUnder`'s target resolution
// (this file) and the `isHighestBy` operator (dsl/operators.ts) must now
// share one ranking implementation (readRankField/resolveRankValue/
// rankAmong, exported from operators.ts). Before the dedup, two independent
// copies of this logic existed; this test is the guard against them ever
// silently diverging again.
// ===========================================================================

describe('bundleUnder / isHighestBy ranking agreement (§4.2, dedup invariant)', () => {
  it('the line bundleUnder resolves as its target is the same line isHighestBy reports as highest — including a null "weight" line resolved via fallbackField', () => {
    // Three "T" lines ranked by weight: W1 and W3 carry a real weight; W2
    // carries none (the 702-rated-codes-with-no-weight case §4.2 calls
    // out) and must be ranked via fallbackField "rateMils" instead of
    // being silently skipped. W2's rateMils (400000) makes it rank above
    // W1 and W3's weight values (2.0, 1.0) — this is exactly the path
    // where two independent copies of the ranking logic could most
    // plausibly diverge.
    const lines = [
      line({ lineId: 'W1', code: 'A1', resolvedSI: 'T', weight: 2.0, rateMils: 100000 }),
      line({ lineId: 'W2', code: 'A2', resolvedSI: 'T', weight: null, rateMils: 400000 }),
      line({ lineId: 'W3', code: 'A3', resolvedSI: 'T', weight: 1.0, rateMils: 50000 }),
      line({ lineId: 'Q1', code: 'A4', resolvedSI: 'Q4', rateMils: null }),
    ];
    const among = siIn(['T']);

    const bundleRule = rule({
      id: 'PKG.BUNDLE',
      band: 4000,
      subBand: 'a',
      order: 4100,
      epoch: 'E2',
      scope: siIn(['Q4']),
      then: [setStatus('BUNDLED'), bundleUnder('weight', among, 'codeAsc', 'rateMils')],
    });
    // Same field/among/tiebreak/fallbackField as PKG.BUNDLE's `bundleUnder`
    // above — evaluated per T line as a line-local `when` condition, so it
    // can be compared against PKG.BUNDLE's resolved target independently.
    const highestRule = rule({
      id: 'RANK.CHECK',
      band: 4000,
      subBand: 'a',
      order: 4050,
      epoch: 'E2',
      scope: siIn(['T']),
      when: isHighestBy('weight', among, 'codeAsc', 'rateMils'),
      then: [flagEffect('IS_HIGHEST')],
    });

    const result = evaluate({ lines, options: {}, rules: [bundleRule, highestRule] });

    const q1 = detOf(result, 'Q1');
    expect(q1.bundledUnder).toBe('W2');

    const highestFlagged = result.determinations.filter((d) => d.flags.some((f) => f.message === 'flag IS_HIGHEST')).map((d) => d.lineId);
    expect(highestFlagged).toEqual(['W2']);

    // The actual invariant: whichever line bundleUnder picked is exactly
    // the line isHighestBy reports as rank 1 — the two must never diverge.
    expect(highestFlagged[0]).toBe(q1.bundledUnder);
  });
});

// ===========================================================================
// U9b — the dangling-ref fix (§2.5, §5.4). On-demand `rank` facts
// (isHighestBy/isNotHighestBy/ordinalIs/ordinalAtLeast) used to be computed
// and cited in `examined.factRefs` without ever being registered into the
// epoch's emitted fact set — `E3b:rank:weight#0` cited but absent from
// `Result.facts`, confirmed via `node tools/adjudicate.mjs --json 59025
// 84112` (OPPS.DISP.T.MPPR_RANK, band 5000, epoch E3b). This section is the
// general invariant, table-driven, plus a fixture reproducing that exact
// case and a fixture pinning down the ranked-order/memoization contract
// §5.4 requires of the fact itself.
// ===========================================================================

function collectAllFactRefs(result: EvaluateResult): readonly string[] {
  const refs: string[] = [];
  for (const det of result.determinations) {
    for (const ev of det.trace) refs.push(...ev.examined.factRefs);
  }
  for (const ev of result.trace) refs.push(...ev.examined.factRefs);
  return refs;
}

function allFactIds(result: EvaluateResult): ReadonlySet<string> {
  const ids = new Set<string>();
  const epochs: readonly Epoch[] = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'E4'];
  for (const epoch of epochs) {
    for (const f of result.facts[epoch]) ids.add(f.factId);
  }
  return ids;
}

interface FactRefFixture {
  readonly name: string;
  readonly build: () => EvaluateResult;
}

const FACT_REF_FIXTURES: readonly FactRefFixture[] = [
  {
    name: 'band 4000 two-epoch bundleUnder scenario plus a claim-relational read (no rank operator involved)',
    build: () => {
      const lines = [
        line({ lineId: 'L1', code: 'A1', resolvedSI: 'J1', rateMils: 6000 }),
        line({ lineId: 'L2', code: 'A2', resolvedSI: 'S', rateMils: 9000 }),
        line({ lineId: 'L3', code: 'A3', resolvedSI: 'T', rateMils: 4000 }),
        line({ lineId: 'L4', code: 'A4', resolvedSI: 'Q4', rateMils: null }),
      ];
      const ruleA = rule({
        id: 'PKG.A',
        band: 4000,
        subBand: 'a',
        order: 4100,
        epoch: 'E2',
        scope: siIn(['S']),
        then: [setStatus('BUNDLED'), bundleUnder('rateMils', siIn(['J1']), 'codeAsc')],
      });
      const ruleB = rule({
        id: 'PKG.B',
        band: 4000,
        subBand: 'b',
        order: 4200,
        epoch: 'E3a',
        scope: siIn(['Q4']),
        then: [setStatus('BUNDLED'), bundleUnder('rateMils', allOf([siIn(['J1', 'S', 'T']), notNode(statusIn(['BUNDLED']))]), 'codeAsc')],
      });
      const readRule = rule({
        id: 'READ.CENSUS',
        band: 5000,
        order: 5000,
        epoch: 'E3b', // band 5000's ceiling — E4 is produced only after band 5000 runs
        scope: ALWAYS,
        when: { op: 'claimContainsAny', args: { si: ['Q4'] } },
        then: [flagEffect('SAW_Q4_E4')],
      });
      return evaluate({ lines, options: {}, rules: [ruleA, ruleB, readRule] });
    },
  },
  {
    name: 'isExempt factRef',
    build: () => {
      const lines = [line({ lineId: 'L1', resolvedSI: 'N' })];
      const exemptRule = rule({ id: 'R.EXEMPT', band: 1000, order: 1000, epoch: 'E0', scope: ALWAYS, then: [{ op: 'exempt', args: {} }] });
      // `isExempt` in `when` (not `scope`) — a scope selector never emits an
      // Evaluation at all (see the dedicated isExempt test above), so it
      // would contribute zero factRefs and this fixture would pass
      // vacuously.
      const readRule = rule({
        id: 'R.READ',
        band: 2000,
        order: 2000,
        epoch: 'E1',
        scope: ALWAYS,
        when: { op: 'isExempt', args: {} },
        then: [flagEffect('IS_EXEMPT')],
      });
      return evaluate({ lines, options: {}, rules: [exemptRule, readRule] });
    },
  },
  {
    name: 'isHighestBy rank fact',
    build: () => {
      const lines = [
        line({ lineId: 'W1', code: 'A1', resolvedSI: 'T', weight: 2.0, rateMils: 100000 }),
        line({ lineId: 'W2', code: 'A2', resolvedSI: 'T', weight: null, rateMils: 400000 }),
        line({ lineId: 'W3', code: 'A3', resolvedSI: 'T', weight: 1.0, rateMils: 50000 }),
      ];
      const among = siIn(['T']);
      const r = rule({
        id: 'RANK.HIGHEST',
        band: 4000,
        subBand: 'a',
        order: 4100,
        epoch: 'E2',
        scope: siIn(['T']),
        when: isHighestBy('weight', among, 'codeAsc', 'rateMils'),
        then: [flagEffect('HIGHEST')],
      });
      return evaluate({ lines, options: {}, rules: [r] });
    },
  },
  {
    name: 'isNotHighestBy rank fact',
    build: () => {
      const lines = [line({ lineId: 'W1', code: 'A1', resolvedSI: 'T', weight: 2.0 }), line({ lineId: 'W2', code: 'A2', resolvedSI: 'T', weight: 1.0 })];
      const among = siIn(['T']);
      const r = rule({
        id: 'RANK.NOT_HIGHEST',
        band: 4000,
        subBand: 'a',
        order: 4100,
        epoch: 'E2',
        scope: siIn(['T']),
        when: isNotHighestBy('weight', among, 'codeAsc'),
        then: [flagEffect('NOT_HIGHEST')],
      });
      return evaluate({ lines, options: {}, rules: [r] });
    },
  },
  {
    name: 'ordinalIs rank fact',
    build: () => {
      const lines = [
        line({ lineId: 'W1', code: 'A1', resolvedSI: 'T', rateMils: 3000 }),
        line({ lineId: 'W2', code: 'A2', resolvedSI: 'T', rateMils: 5000 }),
        line({ lineId: 'W3', code: 'A3', resolvedSI: 'T', rateMils: 1000 }),
      ];
      const among = siIn(['T']);
      const r = rule({
        id: 'RANK.ORDINAL_IS',
        band: 5000,
        order: 5000,
        epoch: 'E3b', // band 5000's ceiling — E4 is produced only after band 5000 runs
        scope: siIn(['T']),
        when: ordinalIs('rateMils', among, 'codeAsc', 2),
        then: [flagEffect('SECOND_RANKED')],
      });
      return evaluate({ lines, options: {}, rules: [r] });
    },
  },
  {
    name: 'ordinalAtLeast rank fact (mirrors the shipped OPPS.DISP.T.MPPR_RANK shape)',
    build: () => {
      const lines = [
        line({ lineId: 'T1', code: 'A1', resolvedSI: 'T', weight: 2.5, rateMils: 60000 }),
        line({ lineId: 'T2', code: 'A2', resolvedSI: 'T', weight: null, rateMils: 90000 }),
        line({ lineId: 'T3', code: 'A3', resolvedSI: 'T', weight: 1.1, rateMils: 40000 }),
      ];
      const among = allOf([siIn(['T']), notNode(statusIn(['BUNDLED']))]);
      const r = rule({
        id: 'RANK.ORDINAL_AT_LEAST',
        band: 5000,
        order: 5100,
        epoch: 'E3b', // band 5000's ceiling — E4 is produced only after band 5000 runs
        scope: siIn(['T']),
        when: ordinalAtLeast('weight', among, 'codeAsc', 2, 'rateMils'),
        then: [flagEffect('MPPR_RANK')],
      });
      return evaluate({ lines, options: {}, rules: [r] });
    },
  },
  {
    name: 'two independent rank facts at the same epoch (rank#0 and rank#1 both registered, not just the first)',
    build: () => {
      const lines = [
        line({ lineId: 'T1', code: 'A1', resolvedSI: 'T', weight: 2.0, rateMils: 5000 }),
        line({ lineId: 'T2', code: 'A2', resolvedSI: 'T', weight: 1.0, rateMils: 9000 }),
      ];
      const amongT = siIn(['T']);
      const rWeight = rule({
        id: 'RANK.WEIGHT',
        band: 5000,
        order: 5000,
        epoch: 'E3b', // band 5000's ceiling — E4 is produced only after band 5000 runs
        scope: siIn(['T']),
        when: isHighestBy('weight', amongT, 'codeAsc'),
        then: [flagEffect('HIGHEST_WEIGHT')],
      });
      const rRate = rule({
        id: 'RANK.RATE',
        band: 5000,
        order: 5100,
        epoch: 'E3b',
        scope: siIn(['T']),
        when: isHighestBy('rateMils', amongT, 'codeAsc'),
        then: [flagEffect('HIGHEST_RATE')],
      });
      return evaluate({ lines, options: {}, rules: [rWeight, rRate] });
    },
  },
];

describe('repo-wide invariant — every factRef resolves in Result.facts (§2.5, §5.4)', () => {
  it.each(FACT_REF_FIXTURES)('$name', ({ build }) => {
    const result = build();
    const known = allFactIds(result);
    const refs = collectAllFactRefs(result);
    // Every fixture here is chosen specifically because it exercises at
    // least one claim-relational read — a fixture with zero factRefs would
    // pass vacuously and catch nothing.
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(known.has(ref)).toBe(true);
    }
  });

  it('reproduces the confirmed defect directly: an ordinalAtLeast rule shaped like the shipped MPPR rank rule no longer cites a dangling fact', () => {
    // Same shape as the real OPPS.DISP.T.MPPR_RANK (band 5000, epoch E3b,
    // field "weight", fallbackField "rateMils") that produced the dangling
    // "E3b:rank:weight#0" ref against 59025+84112 before this fix.
    const lines = [
      line({ lineId: 'T1', code: '59025', resolvedSI: 'T', weight: 2.2595, rateMils: 60000 }),
      line({ lineId: 'Q4', code: '84112', resolvedSI: 'Q4', rateMils: null }),
    ];
    const among = allOf([siIn(['T']), notNode(statusIn(['BUNDLED']))]);
    const r = rule({
      id: 'OPPS.T.MPPR_NOT_PRICED.FIXTURE',
      band: 5000,
      order: 5100,
      epoch: 'E3b',
      scope: siIn(['T']),
      when: ordinalAtLeast('weight', among, 'codeAsc', 2, 'rateMils'),
      then: [flagEffect('MPPR')],
    });
    const result = evaluate({ lines, options: {}, rules: [r] });
    const det = detOf(result, 'T1');
    const ev = det.trace.find((e) => e.ruleId === 'OPPS.T.MPPR_NOT_PRICED.FIXTURE');
    expect(ev).toBeDefined();
    const refs = ev?.examined.factRefs ?? [];
    expect(refs.length).toBe(1);
    const [factId] = refs;
    expect(factId).toBeDefined();
    const fact = factId === undefined ? undefined : factByEpoch(result.facts, 'E3b', factId);
    expect(fact).toBeDefined();
    expect(fact?.kind).toBe('rank');
    expect(fact?.dimension).toBe('weight');
    expect(fact?.lineIds).toEqual(['T1']);
  });

  it("a rank fact's lineIds (and values) reflect the actual ranked order, and is shared across lines asking the identical (field, among) question", () => {
    const lines = [
      line({ lineId: 'T1', code: 'A1', resolvedSI: 'T', weight: 2.5, rateMils: 60000 }),
      line({ lineId: 'T2', code: 'A2', resolvedSI: 'T', weight: null, rateMils: 90000 }),
      line({ lineId: 'T3', code: 'A3', resolvedSI: 'T', weight: 1.1, rateMils: 40000 }),
    ];
    const among = allOf([siIn(['T']), notNode(statusIn(['BUNDLED']))]);
    const r = rule({
      id: 'RANK.ORDER',
      band: 5000,
      order: 5100,
      epoch: 'E3b', // band 5000's ceiling — E4 is produced only after band 5000 runs
      scope: siIn(['T']),
      when: ordinalAtLeast('weight', among, 'codeAsc', 1, 'rateMils'),
      then: [flagEffect('RANKED')],
    });
    const result = evaluate({ lines, options: {}, rules: [r] });

    const rankFacts = result.facts.E3b.filter((f) => f.kind === 'rank');
    expect(rankFacts.length).toBe(1);
    const [fact] = rankFacts;
    expect(fact?.dimension).toBe('weight');
    // T2's weight is null, so it resolves via fallbackField "rateMils"
    // (90000) — which outranks T1/T3's real weight values (2.5, 1.1).
    // Descending order: T2, T1, T3.
    expect(fact?.lineIds).toEqual(['T2', 'T1', 'T3']);
    expect(fact?.values).toEqual([90000, 2.5, 1.1]);

    // All three T lines ask the identical (field, among) question — one
    // fact, not one per line (the memo's whole point).
    for (const lineId of ['T1', 'T2', 'T3']) {
      const det = detOf(result, lineId);
      const ev = det.trace.find((e) => e.ruleId === 'RANK.ORDER');
      expect(ev?.examined.factRefs).toEqual([fact?.factId]);
    }
  });
});
