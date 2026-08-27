import { describe, expect, it } from 'vitest';
import {
  assertFieldCoverage,
  getLine,
  getScopeExclusions,
  MONETARY_FIELDS,
  resolveCounterfactual,
  serializeEvaluation,
  serializeTrace,
  STRUCTURAL_FIELDS,
  TraceJournal,
  type AssembledEvaluation,
} from '../src/trace.js';
import type { Evaluation } from '../src/types.js';
import { evaluate, type AdmittedLine, type Rule } from '../src/dsl/evaluate.js';

// ---------------------------------------------------------------------------
// A hand-built `Evaluation` fixture — trace.ts must work from the `types.ts`
// shape alone, with no dependency on `dsl/evaluate.ts` (§2.6's layering
// rule), so these tests build `Evaluation` values directly rather than only
// ever going through the interpreter.
// ---------------------------------------------------------------------------

function ev(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    ruleId: 'R1',
    ruleVersion: '2026.1',
    phase: 'ADJUDICATE',
    band: 2000,
    order: 2000,
    epoch: 'E1',
    citation: 'test fixture',
    scopeTarget: 'line',
    examined: { subjectLineId: 'L1', ordinal: null, subjectInAmong: null, factRefs: [], detail: {} },
    predicate: { op: 'siIn', args: { si: ['J1'] } },
    outcome: 'NOT_FIRED',
    effect: null,
    supersededBy: null,
    counterfactual: 'would fire if status indicator is J1',
    ...overrides,
  };
}

describe('TraceJournal — append-only, write-once assembly', () => {
  it('assembles per-line and claim entries recorded via recordLine/recordClaim', () => {
    const j = new TraceJournal();
    j.recordLine('L1', ev({ ruleId: 'R1', examined: { subjectLineId: 'L1', ordinal: null, subjectInAmong: null, factRefs: [], detail: {} } }));
    j.recordLine('L1', ev({ ruleId: 'R2', outcome: 'FIRED', counterfactual: null }));
    j.recordClaim(ev({ ruleId: 'CLAIM.R', scopeTarget: 'claim', outcome: 'FIRED', counterfactual: null }));

    const trace = j.assemble({ traceLevel: 'full' });
    expect(getLine(trace, 'L1').map((e) => e.ruleId)).toEqual(['R1', 'R2']);
    expect(getLine(trace, 'NOPE')).toEqual([]);
    expect(trace.claim.map((e) => e.ruleId)).toEqual(['CLAIM.R']);
  });

  it('assemble() is callable exactly once — a second call throws', () => {
    const j = new TraceJournal();
    j.recordLine('L1', ev());
    j.assemble({ traceLevel: 'standard' });
    expect(() => j.assemble({ traceLevel: 'standard' })).toThrow(/assemble\(\) has already run/);
  });

  it('a record* call after assemble() throws — the journal is not read-and-written interleaved', () => {
    const j = new TraceJournal();
    j.assemble({ traceLevel: 'standard' });
    expect(() => j.recordLine('L1', ev())).toThrow(/assemble\(\) has already run/);
    expect(() => j.recordClaim(ev())).toThrow(/assemble\(\) has already run/);
  });
});

describe('trace levels (§5.3a)', () => {
  it('fired: only FIRED entries survive, and their counterfactual/counterfactualRef are both null', () => {
    const j = new TraceJournal();
    j.recordLine('L1', ev({ ruleId: 'R1', outcome: 'NOT_FIRED' }));
    j.recordLine('L1', ev({ ruleId: 'R2', outcome: 'FIRED', counterfactual: null }));
    j.recordLine('L1', ev({ ruleId: 'R3', outcome: 'SKIPPED', counterfactual: null }));
    const trace = j.assemble({ traceLevel: 'fired' });
    const line = getLine(trace, 'L1');
    expect(line.map((e) => e.ruleId)).toEqual(['R2']);
    expect(line[0]?.counterfactual).toBeNull();
    expect(line[0]?.counterfactualRef).toBeNull();
  });

  it('standard: all outcomes kept; counterfactual is replaced by counterfactualRef', () => {
    const j = new TraceJournal();
    j.recordLine('L1', ev({ ruleId: 'R1', outcome: 'NOT_FIRED', counterfactual: 'would fire if X' }));
    j.recordLine('L1', ev({ ruleId: 'R2', outcome: 'FIRED', counterfactual: null }));
    const trace = j.assemble({ traceLevel: 'standard' });
    const line = getLine(trace, 'L1');
    expect(line.map((e) => e.ruleId)).toEqual(['R1', 'R2']);

    const r1 = line.find((e) => e.ruleId === 'R1');
    expect(r1?.counterfactual).toBeNull();
    expect(r1?.counterfactualRef).toBe('R1');
    expect(trace.counterfactuals['R1']).toBe('would fire if X');

    const r2 = line.find((e) => e.ruleId === 'R2');
    expect(r2?.counterfactual).toBeNull();
    expect(r2?.counterfactualRef).toBeNull(); // FIRED never had one to ref
  });

  it('full: counterfactuals inline (not ref\'d), and scope exclusions appear per line', () => {
    const j = new TraceJournal();
    j.recordLine('L1', ev({ ruleId: 'R1', outcome: 'NOT_FIRED', counterfactual: 'would fire if X' }));
    const trace = j.assemble({
      traceLevel: 'full',
      scopeExclusions: [{ ruleId: 'R.SCOPE', excludedLineIds: ['L1', 'L2'] }],
    });
    const r1 = getLine(trace, 'L1').find((e) => e.ruleId === 'R1');
    expect(r1?.counterfactual).toBe('would fire if X');
    expect(r1?.counterfactualRef).toBeNull();

    expect(getScopeExclusions(trace, 'L1')).toEqual(['R.SCOPE']);
    expect(getScopeExclusions(trace, 'L2')).toEqual(['R.SCOPE']);
    expect(getScopeExclusions(trace, 'L3')).toEqual([]);
  });

  it('scopeExclusionsByLine is empty at standard/fired even when scopeExclusions is passed', () => {
    const j = new TraceJournal();
    j.recordLine('L1', ev());
    const trace = j.assemble({ traceLevel: 'standard', scopeExclusions: [{ ruleId: 'R.SCOPE', excludedLineIds: ['L1'] }] });
    expect(getScopeExclusions(trace, 'L1')).toEqual([]);
  });
});

describe('counterfactualRef dedup and the dangling-ref guard (§5.3a)', () => {
  it('dedups one counterfactual string per ruleId across many lines', () => {
    const j = new TraceJournal();
    for (const lineId of ['L1', 'L2', 'L3']) {
      j.recordLine(lineId, ev({ ruleId: 'R.SHARED', outcome: 'NOT_FIRED', counterfactual: 'would fire if shared condition' }));
    }
    const trace = j.assemble({ traceLevel: 'standard' });
    expect(Object.keys(trace.counterfactuals)).toEqual(['R.SHARED']);
    expect(trace.counterfactuals['R.SHARED']).toBe('would fire if shared condition');
    for (const lineId of ['L1', 'L2', 'L3']) {
      expect(getLine(trace, lineId)[0]?.counterfactualRef).toBe('R.SHARED');
    }
  });

  it('two different counterfactual strings recorded for the same ruleId is a hard error — a counterfactual must be a function of the rule, never the line', () => {
    const j = new TraceJournal();
    j.recordLine('L1', ev({ ruleId: 'R.BAD', outcome: 'NOT_FIRED', counterfactual: 'text A' }));
    j.recordLine('L2', ev({ ruleId: 'R.BAD', outcome: 'NOT_FIRED', counterfactual: 'text B' }));
    expect(() => j.assemble({ traceLevel: 'standard' })).toThrow(/two different counterfactual strings/);
  });

  it('resolveCounterfactual: null in, null out; a dangling (unresolvable) ref throws rather than returning an empty string', () => {
    expect(resolveCounterfactual({ R1: 'text' }, null)).toBeNull();
    expect(resolveCounterfactual({ R1: 'text' }, 'R1')).toBe('text');
    expect(() => resolveCounterfactual({ R1: 'text' }, 'R.MISSING')).toThrow(/dangling ref/);
  });
});

describe('canonical serialization (§2.4, §12.3)', () => {
  it('serializeEvaluation is independent of incidental key order in dynamic sub-objects (predicate.args, examined.detail)', () => {
    const a: AssembledEvaluation = {
      ruleId: 'R1',
      ruleVersion: '2026.1',
      phase: 'ADJUDICATE',
      band: 2000,
      order: 2000,
      epoch: 'E1',
      citation: 'c',
      scopeTarget: 'line',
      examined: { subjectLineId: 'L1', ordinal: null, subjectInAmong: null, factRefs: ['E1:siCensus:J1'], detail: { b: 2, a: 1 } },
      predicate: { op: 'allOf', args: { z: 1, children: [{ op: 'siIn', args: { si: ['J1'] } }] } },
      outcome: 'FIRED',
      effect: [{ op: 'setStatus', args: { status: 'PAID' } }],
      supersededBy: null,
      counterfactual: null,
      counterfactualRef: null,
    };
    const b: AssembledEvaluation = {
      ...a,
      examined: { ...a.examined, detail: { a: 1, b: 2 } }, // same content, keys authored in the opposite order
      predicate: { op: 'allOf', args: { children: [{ op: 'siIn', args: { si: ['J1'] } }], z: 1 } },
    };
    expect(serializeEvaluation(a)).toBe(serializeEvaluation(b));
  });

  it('serializeEvaluation emits keys in the declared STRUCTURAL_FIELDS order, not construction order', () => {
    const a: AssembledEvaluation = {
      counterfactualRef: null,
      counterfactual: null,
      supersededBy: null,
      effect: null,
      outcome: 'NOT_FIRED',
      predicate: null,
      examined: { subjectLineId: null, ordinal: null, subjectInAmong: null, factRefs: [], detail: {} },
      scopeTarget: 'claim',
      citation: 'c',
      epoch: 'E0',
      order: 1,
      band: 1000,
      phase: 'ADJUDICATE',
      ruleVersion: '1',
      ruleId: 'R1',
    };
    const json = serializeEvaluation(a);
    expect(json.indexOf('"ruleId"')).toBeLessThan(json.indexOf('"ruleVersion"'));
    expect(json.indexOf('"ruleVersion"')).toBeLessThan(json.indexOf('"phase"'));
    expect(json.indexOf('"examined"')).toBeLessThan(json.indexOf('"predicate"'));
    expect(json.indexOf('"counterfactual"')).toBeLessThan(json.indexOf('"counterfactualRef"'));
    expect(JSON.parse(json)).toEqual({
      ruleId: 'R1',
      ruleVersion: '1',
      phase: 'ADJUDICATE',
      band: 1000,
      order: 1,
      epoch: 'E0',
      citation: 'c',
      scopeTarget: 'claim',
      examined: { subjectLineId: null, ordinal: null, subjectInAmong: null, factRefs: [], detail: {} },
      predicate: null,
      outcome: 'NOT_FIRED',
      effect: null,
      supersededBy: null,
      counterfactual: null,
      counterfactualRef: null,
    });
  });

  it('serializeTrace over an evaluate.ts-produced trace is byte-identical across two independent runs of the same input', () => {
    const lines: AdmittedLine[] = [
      { lineId: 'L1', code: 'A1', resolvedSI: 'J1', apc: null, schedule: null, modifiers: [], unitCount: 1, rateMils: 5000, weight: null, chargeMils: 6000, dos: '20260101' },
      { lineId: 'L2', code: 'A2', resolvedSI: 'Q4', apc: null, schedule: null, modifiers: [], unitCount: 1, rateMils: null, weight: null, chargeMils: 3000, dos: '20260101' },
    ];
    const rules: Rule[] = [
      {
        id: 'R.BUNDLE',
        version: '2026.1',
        phase: 'ADJUDICATE',
        band: 4000,
        subBand: 'a',
        order: 4100,
        epoch: 'E2',
        scopeTarget: 'line',
        citation: 'c',
        scope: { op: 'siIn', args: { si: ['Q4'] } },
        then: [{ op: 'setStatus', args: { status: 'BUNDLED' } }, { op: 'bundleUnder', args: { highestBy: 'rateMils', among: { op: 'siIn', args: { si: ['J1'] } }, tiebreak: 'codeAsc' } }],
      },
    ];

    function runOnce(): string {
      const result = evaluate({ lines, options: {}, rules });
      const j = new TraceJournal();
      for (const det of result.determinations) for (const e of det.trace) j.recordLine(det.lineId, e);
      const trace = j.assemble({ traceLevel: 'full', scopeExclusions: result.scopeExclusions });
      return serializeTrace(trace);
    }

    expect(runOnce()).toBe(runOnce());
  });
});

describe('STRUCTURAL_FIELDS / MONETARY_FIELDS coverage (§12.3)', () => {
  it('their union covers every key serializeEvaluation actually emits', () => {
    const sample: AssembledEvaluation = {
      ruleId: 'R1',
      ruleVersion: '1',
      phase: 'ADJUDICATE',
      band: 1000,
      order: 1,
      epoch: 'E0',
      citation: 'c',
      scopeTarget: 'line',
      examined: { subjectLineId: 'L1', ordinal: 1, subjectInAmong: true, factRefs: ['x'], detail: { k: 'v' } },
      predicate: { op: 'always', args: {} },
      outcome: 'FIRED',
      effect: [{ op: 'flag', args: { code: 'X' } }],
      supersededBy: null,
      counterfactual: null,
      counterfactualRef: null,
    };
    expect(() => assertFieldCoverage(Object.keys(sample))).not.toThrow();
    expect(() => assertFieldCoverage(['subjectLineId', 'ordinal', 'subjectInAmong', 'factRefs', 'detail'])).not.toThrow();
    const union = new Set([...STRUCTURAL_FIELDS, ...MONETARY_FIELDS]);
    for (const key of Object.keys(sample)) expect(union.has(key)).toBe(true);
  });

  it('a field absent from both lists is a hard error — money can never leak into a structural golden by omission', () => {
    expect(() => assertFieldCoverage(['ruleId', 'aNewMoneyField'])).toThrow(/not declared in STRUCTURAL_FIELDS or MONETARY_FIELDS/);
  });

  it('serializeEvaluation itself runs the coverage check — a rogue extra key on the object throws rather than serializing silently', () => {
    const sample: AssembledEvaluation = {
      ruleId: 'R1',
      ruleVersion: '1',
      phase: 'ADJUDICATE',
      band: 1000,
      order: 1,
      epoch: 'E0',
      citation: 'c',
      scopeTarget: 'line',
      examined: { subjectLineId: null, ordinal: null, subjectInAmong: null, factRefs: [], detail: {} },
      predicate: null,
      outcome: 'FIRED',
      effect: null,
      supersededBy: null,
      counterfactual: null,
      counterfactualRef: null,
    };
    const corrupted = { ...sample, amountMils: 1000 } as unknown as AssembledEvaluation;
    expect(() => serializeEvaluation(corrupted)).toThrow(/not declared in STRUCTURAL_FIELDS or MONETARY_FIELDS/);
  });
});
