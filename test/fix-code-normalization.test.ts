/**
 * Regression tests for the silent-data-alteration defect in
 * `normalizeProcCode()` (src/phases/classify.ts, ~line 279): a 7-character
 * procedure token with a valid 5-character prefix used to peel its trailing
 * 2 characters off as "the modifier" unconditionally, with nothing in the
 * output disclosing that the engine reinterpreted the submitted token.
 *
 * The fix has two parts, both exercised here:
 *
 *   1. `looksLikeModifierShape()` rejects a numeric trailing pair below 20
 *      (no CPT modifier has ever been "00"-"19"), which restores
 *      reachability of `malformedReason()`'s "more than 5 characters"
 *      branch for a 7-character token whose 5-character prefix is valid.
 *   2. Whenever a peel DOES happen, `classifyLine()` raises a new
 *      `OPPS.CLASSIFY.MODIFIER_PEELED` disclosure flag (severity
 *      'assumption') naming the raw token, the adjudicated code, and the
 *      peeled modifier, so the split can never again be invisible.
 */
import { describe, expect, it } from 'vitest';
import { classify } from '../src/phases/classify.js';
import type { ClaimInput, ClaimLineInput } from '../src/types.js';

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

/** Every ClassifiedLine kind except FAULTED carries a `flags` array. */
function flagsOf(l: { kind: string; flags?: readonly { code: string; message: string }[] }): readonly { code: string; message: string }[] {
  return l.flags ?? [];
}

describe('fix: normalizeProcCode() no longer silently alters submitted data', () => {
  it('9928401 no longer becomes a silent clean payable line with zero flags', () => {
    const result = classify(claim({}, [claimLine({ procCode: '9928401' })]));
    const [l] = result.lines;
    if (l === undefined) throw new Error('expected a classified line');

    // Before the fix this was PAID with SI J2 and an empty flags array —
    // the trailing "01" (not a real modifier: no CPT modifier is below 20)
    // was silently peeled off code "99284" and applied to adjudication
    // while the raw token echoed clean. That must no longer happen: this
    // shape is now MALFORMED (kind 'REJECTED', never 'ADMITTED'/'ROUTED'),
    // and either way it must carry at least one flag disclosing what
    // happened.
    expect(l.kind).not.toBe('ADMITTED');
    expect(l.kind).not.toBe('ROUTED');
    const flags = flagsOf(l);
    expect(flags.length).toBeGreaterThan(0);
  });

  it('9928401 is routed to MALFORMED, reaching malformedReason()\'s "more than 5 characters" branch', () => {
    const result = classify(claim({}, [claimLine({ procCode: '9928401' })]));
    const [l] = result.lines;
    if (l === undefined || l.kind !== 'REJECTED') throw new Error('expected a rejected line');
    expect(l.status).toBe('MALFORMED');
    expect(l.flags.some((f) => f.code === 'OPPS.CLASSIFY.MALFORMED' && /more than 5 characters after normalization/.test(f.message))).toBe(true);
  });

  it('9902559 still adjudicates as code 99025 (99025 + real modifier 59), and now carries the disclosure flag', () => {
    const result = classify(claim({}, [claimLine({ procCode: '9902559' })]));
    const [l] = result.lines;
    if (l === undefined) throw new Error('expected a classified line');

    // 99025 is a genuinely valid 5-char CPT shape and "59" (>= 20) passes
    // the modifier-shape floor, so this must still peel exactly as before
    // the fix — the behavior change here is disclosure, not reinterpretation.
    expect('code' in l ? l.code : undefined).toBe('99025');
    const flags = flagsOf(l);
    const disclosure = flags.find((f) => f.code === 'OPPS.CLASSIFY.MODIFIER_PEELED');
    expect(disclosure).toBeDefined();
    expect(disclosure?.message).toContain('9902559');
    expect(disclosure?.message).toContain('99025');
    expect(disclosure?.message).toContain('59');
  });

  it('a genuinely admitted peel (99284 + modifier 99) applies the modifier to adjudication AND discloses it', () => {
    // 99284 carries SI J2 in the loaded Addendum B data and is phase-2
    // eligible (ADMITTED), unlike 99025 above — this exercises the peeled
    // modifier actually reaching AdmittedLine.modifiers, not just the
    // MODIFIER_PEELED flag.
    const result = classify(claim({}, [claimLine({ procCode: '9928499' })]));
    const [l] = result.lines;
    if (l === undefined || l.kind !== 'ADMITTED') throw new Error('expected an admitted line');
    expect(l.admitted.code).toBe('99284');
    expect(l.admitted.modifiers).toContain('99');
    expect(l.flags.some((f) => f.code === 'OPPS.CLASSIFY.MODIFIER_PEELED')).toBe(true);
  });

  it('a plain 5-character code (84112) gains no new flag — disclosure fires only when a peel actually happened', () => {
    const result = classify(claim({}, [claimLine({ procCode: '84112' })]));
    const [l] = result.lines;
    if (l === undefined) throw new Error('expected a classified line');
    const flags = flagsOf(l);
    expect(flags.some((f) => f.code === 'OPPS.CLASSIFY.MODIFIER_PEELED')).toBe(false);
    expect(flags.length).toBe(0);
  });
});
