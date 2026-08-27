import { describe, expect, it } from 'vitest';
import type { EngineError } from '../src/types.js';
import {
  DEFAULT_VALIDATE_MODE,
  isValidateMode,
  validateClaimInput,
  validateOptions,
  validateRegistryShape,
} from '../src/dsl/validate.js';

function isEngineError(e: unknown): e is EngineError {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'EngineError';
}

function validClaim(): Record<string, unknown> {
  return {
    claimId: 'C1',
    claimForm: 'ub92',
    typeOfBill: '131',
    statementFrom: '20260101',
    statementThrough: '20260101',
    conditionCodes: [],
    occurrenceCodes: [],
    valueCodes: [],
    billingTaxonomy: '282NC0060X',
    payer: { id: 'P1', name: 'HUMANA' },
    diagnoses: [],
    lines: [
      {
        lineId: 'L1',
        procCode: 'G0378',
        modifiers: [],
        revCode: '0510',
        units: '4',
        unitQualifier: 'UN',
        chargeMils: 200000,
        fromDate: '20260101',
        thruDate: '20260101',
      },
    ],
    totalChargeMils: 200000,
    lineIdScheme: 'feed',
  };
}

describe('ValidateMode', () => {
  it('has the closed vocabulary and a boundaries default', () => {
    expect(DEFAULT_VALIDATE_MODE).toBe('boundaries');
    expect(isValidateMode('inputs')).toBe(true);
    expect(isValidateMode('boundaries')).toBe(true);
    expect(isValidateMode('off')).toBe(true);
    expect(isValidateMode('bogus')).toBe(false);
  });
});

describe('validateClaimInput', () => {
  it('accepts a well-formed claim and passes it through structurally', () => {
    const claim = validateClaimInput(validClaim());
    expect(claim.claimId).toBe('C1');
    expect(claim.lines).toHaveLength(1);
    expect(claim.lines[0]?.chargeMils).toBe(200000);
  });

  it('throws CLAIM_SCHEMA_INVALID with a path on a type violation, never coercing', () => {
    const bad = { ...validClaim(), totalChargeMils: '200000' };
    try {
      validateClaimInput(bad);
      expect.unreachable('expected a throw');
    } catch (e) {
      expect(isEngineError(e)).toBe(true);
      if (!isEngineError(e)) return;
      expect(e.code).toBe('CLAIM_SCHEMA_INVALID');
      expect(e.path).toBe('claim.totalChargeMils');
      expect(e.claimId).toBe('C1');
    }
  });

  it('rejects a non-integer money value (mils are integers, no floats)', () => {
    const bad = { ...validClaim(), totalChargeMils: 200000.5 };
    expect(() => validateClaimInput(bad)).toThrow();
  });

  it('rejects a claim with zero lines', () => {
    const bad = { ...validClaim(), lines: [] };
    expect(() => validateClaimInput(bad)).toThrow();
  });

  it('throws LINE_ID_NOT_UNIQUE on a duplicate lineId (§19.14)', () => {
    const claim = validClaim();
    const firstLine = {
      lineId: 'L1',
      procCode: 'G0378',
      modifiers: [],
      revCode: '0510',
      units: '4',
      unitQualifier: 'UN',
      chargeMils: 200000,
      fromDate: '20260101',
      thruDate: '20260101',
    };
    const dup = { ...claim, lines: [firstLine, { ...firstLine }] };
    try {
      validateClaimInput(dup);
      expect.unreachable('expected a throw');
    } catch (e) {
      expect(isEngineError(e)).toBe(true);
      if (!isEngineError(e)) return;
      expect(e.code).toBe('LINE_ID_NOT_UNIQUE');
    }
  });

  it('rejects a malformed date instead of guessing', () => {
    const bad = { ...validClaim(), statementFrom: '2026-01-01' };
    expect(() => validateClaimInput(bad)).toThrow();
  });

  it('rejects a non-object claim', () => {
    expect(() => validateClaimInput('not a claim')).toThrow();
    expect(() => validateClaimInput(null)).toThrow();
    expect(() => validateClaimInput(undefined)).toThrow();
  });
});

describe('validateOptions', () => {
  it('defaults when options are omitted', () => {
    const opts = validateOptions(undefined);
    expect(opts.validate).toBe('boundaries');
    expect(opts.traceLevel).toBe('standard');
    expect(opts.values).toEqual({});
  });

  it('accepts a well-formed options object', () => {
    const opts = validateOptions({ validate: 'inputs', traceLevel: 'full', values: { g0378Units: 8 } });
    expect(opts.validate).toBe('inputs');
    expect(opts.traceLevel).toBe('full');
    expect(opts.values['g0378Units']).toBe(8);
  });

  it('throws OPTIONS_SCHEMA_INVALID on an unknown traceLevel', () => {
    try {
      validateOptions({ traceLevel: 'verbose' });
      expect.unreachable('expected a throw');
    } catch (e) {
      expect(isEngineError(e)).toBe(true);
      if (!isEngineError(e)) return;
      expect(e.code).toBe('OPTIONS_SCHEMA_INVALID');
    }
  });

  it('rejects a non-JSON-safe value in the options row', () => {
    expect(() => validateOptions({ values: { fn: () => 1 } })).toThrow();
  });
});

describe('validateRegistryShape', () => {
  function validRule(overrides: Record<string, unknown> = {}): unknown {
    return {
      id: 'OPPS.PKG.Q4.COMPANION',
      version: '2026.1',
      effectiveFrom: '20260101',
      effectiveTo: null,
      phase: 'ADJUDICATE',
      band: 4000,
      subBand: 'a',
      order: 4200,
      epoch: 'E2',
      scopeTarget: 'line',
      citation: 'Pub 100-04 Ch.4 §10.4',
      scope: { siIn: { si: ['Q4'] } },
      when: { claimContainsAny: { si: ['J1', 'J2', 'S', 'T', 'V', 'Q1', 'Q2', 'Q3'] } },
      then: [{ setStatus: { status: 'BUNDLED' } }],
      ...overrides,
    };
  }

  it('accepts the named-object rule shape the batch-2 registry is authored in', () => {
    const rules = validateRegistryShape([validRule()]);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe('OPPS.PKG.Q4.COMPANION');
  });

  it('rejects an unknown operator name in scope', () => {
    expect(() => validateRegistryShape([validRule({ scope: { notAnOperator: [] } })])).toThrow();
  });

  it('rejects an effect operator used as a scope selector, and vice versa', () => {
    expect(() => validateRegistryShape([validRule({ scope: { setStatus: { status: 'PAID' } } })])).toThrow();
    expect(() => validateRegistryShape([validRule({ then: [{ siIn: { si: ['J1'] } }] })])).toThrow();
  });

  // U12b: §4.3.1's "bare payload for single-dimension operators" shorthand
  // was never implemented and has been removed from the spec — every
  // operator's evaluate()/argSpec() requires the named-object form. The
  // validator now checks each scope/when/then node's payload against the
  // matching operator's own argSpec() (spec §4.4), which recurses through
  // allOf/anyOf/not's nested children and every `among` in one call — see
  // the comment on `requireSingleKeyOperatorNode` in src/dsl/validate.ts.
  it('accepts an allOf/not scope whose nested children are well-formed named-object nodes', () => {
    const withAllOf = validRule({
      scope: {
        allOf: { children: [{ op: 'siIn', args: { si: ['Q4'] } }, { op: 'isExempt', args: {} }] },
      },
    });
    expect(validateRegistryShape([withAllOf])).toHaveLength(1);
    const withNot = validRule({ scope: { not: { child: { op: 'siIn', args: { si: ['B', 'C'] } } } } });
    expect(validateRegistryShape([withNot])).toHaveLength(1);
  });

  it('rejects a bare-array payload for a single-dimension operator (§4.3.1 shorthand is not implemented)', () => {
    expect(() => validateRegistryShape([validRule({ scope: { siIn: ['Q4'] } })])).toThrow();
  });

  it('rejects a malformed payload nested inside allOf/not (the whole subtree is checked, not just the envelope)', () => {
    const badNestedChild = validRule({
      scope: { allOf: { children: [{ op: 'siIn', args: ['Q4'] }] } },
    });
    expect(() => validateRegistryShape([badNestedChild])).toThrow();
  });

  it('rejects a bare-string setStatus payload at load time, naming the rule id — the batch-2 defect this unit fixes', () => {
    const bad = validRule({ id: 'OPPS.BAD.BARE_SETSTATUS', then: [{ setStatus: 'BUNDLED' }] });
    try {
      validateRegistryShape([bad]);
      expect.unreachable('expected a throw');
    } catch (e) {
      expect(isEngineError(e)).toBe(true);
      if (!isEngineError(e)) return;
      expect(e.code).toBe('REGISTRY_SCHEMA_INVALID');
      expect(e.path).toContain('then[0]');
      expect(e.detail).toContain('OPPS.BAD.BARE_SETSTATUS');
    }
  });

  it('throws REGISTRY_INVARIANT_VIOLATION on a duplicate rule id', () => {
    try {
      validateRegistryShape([validRule(), validRule()]);
      expect.unreachable('expected a throw');
    } catch (e) {
      expect(isEngineError(e)).toBe(true);
      if (!isEngineError(e)) return;
      expect(e.code).toBe('REGISTRY_INVARIANT_VIOLATION');
    }
  });

  it('rejects a rule with no effects', () => {
    expect(() => validateRegistryShape([validRule({ then: [] })])).toThrow();
  });

  it('rejects an unknown phase', () => {
    expect(() => validateRegistryShape([validRule({ phase: 'BOGUS' })])).toThrow();
  });
});
