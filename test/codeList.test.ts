import { describe, expect, it } from 'vitest';
import { parseCodeList, DATA_VINTAGE_EFFECTIVE_DATE } from '../src/adapters/codeList.js';
import { adjudicate } from '../src/index.js';
import type { ClaimInput, EngineError } from '../src/types.js';

function isEngineError(e: unknown): e is EngineError {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'EngineError';
}

describe('parseCodeList — token parsing', () => {
  it('parses a two-code space-separated list into two positional lines', () => {
    const { claim } = parseCodeList('36415 84112');
    expect(claim.lines).toHaveLength(2);
    expect(claim.lines[0]?.procCode).toBe('36415');
    expect(claim.lines[1]?.procCode).toBe('84112');
    expect(claim.lineIdScheme).toBe('positional');
    expect(claim.lines[0]?.lineId).toBe('idx:0');
    expect(claim.lines[1]?.lineId).toBe('idx:1');
  });

  it('G0378x8 -> units "8", no modifiers', () => {
    const { claim } = parseCodeList('G0378x8');
    expect(claim.lines).toHaveLength(1);
    expect(claim.lines[0]?.procCode).toBe('G0378');
    expect(claim.lines[0]?.units).toBe('8');
    expect(claim.lines[0]?.modifiers).toEqual([]);
  });

  it('59025x2:73 -> units "2", modifiers ["73"]', () => {
    const { claim } = parseCodeList('59025x2:73');
    expect(claim.lines).toHaveLength(1);
    expect(claim.lines[0]?.procCode).toBe('59025');
    expect(claim.lines[0]?.units).toBe('2');
    expect(claim.lines[0]?.modifiers).toEqual(['73']);
  });

  it('a bare code with no x/: defaults to 1 unit, no modifiers', () => {
    const { claim } = parseCodeList('36415');
    expect(claim.lines[0]?.units).toBe('1');
    expect(claim.lines[0]?.modifiers).toEqual([]);
  });

  it('accepts a code with a modifier and no explicit units', () => {
    const { claim } = parseCodeList('99284:25');
    expect(claim.lines[0]?.procCode).toBe('99284');
    expect(claim.lines[0]?.units).toBe('1');
    expect(claim.lines[0]?.modifiers).toEqual(['25']);
  });

  it('accepts multiple modifiers', () => {
    const { claim } = parseCodeList('99284:25:LT');
    expect(claim.lines[0]?.modifiers).toEqual(['25', 'LT']);
  });

  it('lowercases in code/modifiers are normalized to uppercase', () => {
    const { claim } = parseCodeList('g0378x8:lt');
    expect(claim.lines[0]?.procCode).toBe('G0378');
    expect(claim.lines[0]?.modifiers).toEqual(['LT']);
  });
});

describe('parseCodeList — separators', () => {
  it('comma-separated tokens parse', () => {
    const { claim } = parseCodeList('36415,84112,81001');
    expect(claim.lines.map((l) => l.procCode)).toEqual(['36415', '84112', '81001']);
  });

  it('comma-with-space-separated tokens parse', () => {
    const { claim } = parseCodeList('36415, 84112, 81001');
    expect(claim.lines.map((l) => l.procCode)).toEqual(['36415', '84112', '81001']);
  });

  it('newline-separated tokens parse', () => {
    const { claim } = parseCodeList('36415\n84112\n81001');
    expect(claim.lines.map((l) => l.procCode)).toEqual(['36415', '84112', '81001']);
  });

  it('mixed whitespace/comma/newline separators all parse together', () => {
    const { claim } = parseCodeList('36415,\n  84112   81001,\t59025');
    expect(claim.lines.map((l) => l.procCode)).toEqual(['36415', '84112', '81001', '59025']);
  });
});

describe('parseCodeList — synthesized claim shape and the §8.0 gate', () => {
  it('synthesizes an institutional 13X outpatient claim', () => {
    const { claim } = parseCodeList('36415');
    expect(claim.claimForm).toBe('ub04');
    expect(claim.typeOfBill.slice(0, 2)).toBe('13');
  });

  it('defaults date of service to the data vintage effective date when not supplied', () => {
    const { claim } = parseCodeList('36415');
    expect(claim.lines[0]?.fromDate).toBe(DATA_VINTAGE_EFFECTIVE_DATE);
    expect(claim.statementFrom).toBe(DATA_VINTAGE_EFFECTIVE_DATE);
  });

  it('accepts an explicit date of service and uses it instead of the default', () => {
    const { claim } = parseCodeList('36415', { dos: '20260315' });
    expect(claim.lines[0]?.fromDate).toBe('20260315');
    expect(claim.statementFrom).toBe('20260315');
  });

  it('the synthesized claim clears the §8.0 gate (adjudicate() returns applicability: null)', () => {
    const { claim } = parseCodeList('36415 84112');
    const result = adjudicate({ claim });
    expect(result.applicability).toBeNull();
    expect(result.determinations).toHaveLength(2);
  });

  it('emits exactly one assumption flag naming the bill type and the date of service', () => {
    const { flags } = parseCodeList('36415');
    const assumption = flags.find((f) => f.severity === 'assumption');
    expect(assumption).toBeDefined();
    expect(assumption?.message).toContain('131');
    expect(assumption?.message).toContain(DATA_VINTAGE_EFFECTIVE_DATE);
  });

  it('the assumption flag names the explicit date when one is supplied', () => {
    const { flags } = parseCodeList('36415', { dos: '20260901' });
    const assumption = flags.find((f) => f.severity === 'assumption');
    expect(assumption?.message).toContain('20260901');
  });
});

describe('parseCodeList — never crashes', () => {
  it('empty input throws a clear EngineError, not a crash', () => {
    let caught: unknown;
    try {
      parseCodeList('');
    } catch (err) {
      caught = err;
    }
    expect(isEngineError(caught)).toBe(true);
    if (isEngineError(caught)) expect(caught.code).toBe('CLAIM_SCHEMA_INVALID');
  });

  it('whitespace-only input throws a clear EngineError, not a crash', () => {
    let caught: unknown;
    try {
      parseCodeList('   \n\t  ');
    } catch (err) {
      caught = err;
    }
    expect(isEngineError(caught)).toBe(true);
    if (isEngineError(caught)) expect(caught.code).toBe('CLAIM_SCHEMA_INVALID');
  });

  it('a malformed token (leading colon, no code) throws a clear EngineError, not a crash', () => {
    let caught: unknown;
    try {
      parseCodeList(':73');
    } catch (err) {
      caught = err;
    }
    expect(isEngineError(caught)).toBe(true);
    if (isEngineError(caught)) {
      expect(caught.code).toBe('CLAIM_SCHEMA_INVALID');
      expect(caught.detail).toContain(':73');
    }
  });

  it('a malformed options.dos throws a clear EngineError, not a crash', () => {
    let caught: unknown;
    try {
      parseCodeList('36415', { dos: 'not-a-date' });
    } catch (err) {
      caught = err;
    }
    expect(isEngineError(caught)).toBe(true);
  });

  it('a syntactically-fine but nonexistent code is NOT rejected by the adapter — it reaches classify() and is reported there', () => {
    const { claim } = parseCodeList('99999999');
    expect(claim.lines[0]?.procCode).toBe('99999999');
    const result = adjudicate({ claim });
    expect(result.applicability).toBeNull();
    expect(result.determinations[0]?.status).toBe('MALFORMED');
  });
});

describe('parseCodeList — equivalence with a hand-built ClaimInput', () => {
  it('a code-list claim and an equivalent hand-built ClaimInput adjudicate identically', () => {
    const { claim: codeListClaim } = parseCodeList('59025 84112 81001', { dos: '20260101' });

    const handBuilt: ClaimInput = {
      claimId: 'code-list',
      claimForm: 'ub04',
      typeOfBill: '131',
      statementFrom: '20260101',
      statementThrough: '20260101',
      conditionCodes: [],
      occurrenceCodes: [],
      valueCodes: [],
      billingTaxonomy: '',
      payer: { id: '', name: '' },
      diagnoses: [],
      lines: [
        {
          lineId: 'idx:0',
          procCode: '59025',
          modifiers: [],
          revCode: '',
          units: '1',
          unitQualifier: '',
          chargeMils: 0,
          fromDate: '20260101',
          thruDate: '20260101',
        },
        {
          lineId: 'idx:1',
          procCode: '84112',
          modifiers: [],
          revCode: '',
          units: '1',
          unitQualifier: '',
          chargeMils: 0,
          fromDate: '20260101',
          thruDate: '20260101',
        },
        {
          lineId: 'idx:2',
          procCode: '81001',
          modifiers: [],
          revCode: '',
          units: '1',
          unitQualifier: '',
          chargeMils: 0,
          fromDate: '20260101',
          thruDate: '20260101',
        },
      ],
      totalChargeMils: 0,
      lineIdScheme: 'positional',
    };

    expect(codeListClaim).toEqual(handBuilt);

    const fromAdapter = adjudicate({ claim: codeListClaim });
    const fromHandBuilt = adjudicate({ claim: handBuilt });

    const strip = (r: typeof fromAdapter) =>
      r.determinations.map((d) => ({ lineId: d.lineId, code: d.code, status: d.status, basis: d.basis, bundledUnder: d.bundledUnder }));

    expect(strip(fromAdapter)).toEqual(strip(fromHandBuilt));
  });
});
