import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseInstitutionalXml } from '../src/adapters/instXml.js';
import type { EngineError } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

const inpatientCahXml = readFileSync(join(fixturesDir, 'inst-xml-inpatient-cah-revonly.xml'), 'utf8');
const outpatientHcpcsXml = readFileSync(join(fixturesDir, 'outpatient-13x-hcpcs.xml'), 'utf8');

function isEngineError(e: unknown): e is EngineError {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'EngineError';
}

describe('parseInstitutionalXml — inpatient CAH rev-only fixture (M1.1 test expectations)', () => {
  it('reads claim-level and line-level fields per the spec §2.1 mapping table', () => {
    const [result] = parseInstitutionalXml(inpatientCahXml);
    expect(result).toBeDefined();
    if (result === undefined) return;
    const { claim, flags } = result;

    expect(claim.claimForm).toBe('ub92');
    expect(claim.typeOfBill).toBe('81A');

    expect(claim.lines).toHaveLength(16);
    for (const line of claim.lines) {
      expect(line.procCode).toBe('');
      expect(line.revCode).not.toBe('');
    }

    expect(claim.lineIdScheme).toBe('feed');
    expect(claim.lines[0]?.lineId).toBe('129543');
    expect(claim.lines[15]?.lineId).toBe('129544');
    expect(new Set(claim.lines.map((l) => l.lineId)).size).toBe(16);

    expect(claim.lines[0]?.unitQualifier).toBe('DA');
    expect(claim.lines[0]?.units).toBe('6');
    expect(claim.lines[1]?.unitQualifier).toBe('UN');
    expect(claim.lines[1]?.units).toBe('746');

    for (const line of claim.lines) {
      expect(line.fromDate).toBe('20200825');
    }

    expect(claim.valueCodes).toContainEqual({ code: '80', amountMils: 6000 });

    expect(claim.totalChargeMils).toBe(9202070);
    const sum = claim.lines.reduce((s, l) => s + l.chargeMils, 0);
    expect(sum).toBe(claim.totalChargeMils);
    expect(flags.some((f) => f.code === 'INST_XML.TOTAL_CHARGE_MISMATCH')).toBe(false);

    expect(claim.billingTaxonomy).toBe('282NC0060X');
    expect(claim.payer.name).toBe('HUMANA');
  });
});

describe('parseInstitutionalXml — synthetic outpatient 13X HCPCS fixture', () => {
  it('carries real HCPCS codes per line as a positive case', () => {
    const [result] = parseInstitutionalXml(outpatientHcpcsXml);
    expect(result).toBeDefined();
    if (result === undefined) return;
    const { claim, flags } = result;

    expect(claim.typeOfBill).toBe('131');
    expect(claim.lines).toHaveLength(4);
    expect(claim.lines.map((l) => l.procCode)).toEqual(['G0463', '36415', '84112', '59025']);
    expect(claim.totalChargeMils).toBe(612400);
    expect(flags.some((f) => f.code === 'INST_XML.TOTAL_CHARGE_MISMATCH')).toBe(false);
  });
});

describe('PHI boundary — allow-list, not deny-list (§2.1, §14)', () => {
  // Every field M1.1 lists as forbidden, matched by exact name or (for the
  // *_N indexed / *_x variants) prefix, so the check stays mechanical even
  // as the feed's own indexing scheme changes.
  const FORBIDDEN_MATCHERS: ((name: string) => boolean)[] = [
    (n) => n === 'pat_name_l' || n === 'pat_name_f' || n === 'pat_name_m',
    (n) => n === 'pat_dob',
    (n) => n === 'pat_sex',
    (n) => n.startsWith('pat_addr_'),
    (n) => n === 'pat_city' || n === 'pat_state' || n === 'pat_zip',
    (n) => n === 'ins_number',
    (n) => n.startsWith('ins_name_'),
    (n) => n.startsWith('ins_addr_'),
    (n) => n === 'ins_dob',
    (n) => n === 'mrn',
    (n) => n === 'pcn',
    (n) => n === 'pat_rel',
    (n) => n === 'bill_npi',
    (n) => n === 'bill_taxid',
    (n) => n.startsWith('prov_name_'),
    (n) => n === 'prov_npi',
    (n) => n === 'remote_fileid',
    (n) => n === 'remote_batchid',
  ];

  /** Scans raw feed XML for any attribute matching the forbidden list and returns its values. */
  function extractForbiddenValues(rawXml: string): string[] {
    const attrRe = /([a-zA-Z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
    const values: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(rawXml)) !== null) {
      const name = m[1];
      const value = m[2];
      if (name === undefined || value === undefined || value === '') continue;
      if (FORBIDDEN_MATCHERS.some((match) => match(name))) values.push(value);
    }
    return values;
  }

  it('the committed fixtures carry no forbidden-field values into the output (regression sentinel)', () => {
    for (const rawXml of [inpatientCahXml, outpatientHcpcsXml]) {
      const forbiddenValues = extractForbiddenValues(rawXml);
      const results = parseInstitutionalXml(rawXml);
      const serialized = JSON.stringify(results);
      for (const value of forbiddenValues) {
        expect(serialized.includes(value)).toBe(false);
      }
    }
  });

  it('mechanically excludes every forbidden field even when the feed supplies one', () => {
    // Synthetic claim carrying every forbidden field with a unique sentinel
    // value, plus the legitimate mapped fields, so the assertion proves the
    // allow-list actually filters rather than passing by fixture omission.
    const xml = `<claims>
      <claim claim_form="ub92" type_of_bill="81A" hosp_from_date="2026-01-01"
             total_charge="10.00" bill_taxonomy="282NC0060X"
             payerid="1" payer_name="HUMANA"
             pat_name_l="SENTINEL_LNAME" pat_name_f="SENTINEL_FNAME" pat_name_m="SENTINEL_MNAME"
             pat_dob="SENTINEL_DOB" pat_sex="SENTINEL_SEX"
             pat_addr_1="SENTINEL_ADDR1" pat_addr_2="SENTINEL_ADDR2"
             pat_city="SENTINEL_CITY" pat_state="SENTINEL_STATE" pat_zip="SENTINEL_ZIP"
             ins_number="SENTINEL_INSNUM" ins_name_l="SENTINEL_INSLNAME" ins_addr_1="SENTINEL_INSADDR"
             ins_dob="SENTINEL_INSDOB" mrn="SENTINEL_MRN" pcn="SENTINEL_PCN" pat_rel="SENTINEL_REL"
             bill_npi="SENTINEL_BILLNPI" bill_taxid="SENTINEL_BILLTAXID"
             prov_name_l="SENTINEL_PROVLNAME" prov_npi="SENTINEL_PROVNPI"
             remote_fileid="SENTINEL_FILEID" remote_batchid="SENTINEL_BATCHID">
        <charge remote_chgid="1" charge="10.00" units="1" rev_code="0250" charge_record_type="UN"/>
      </claim>
    </claims>`;

    const forbiddenValues = extractForbiddenValues(xml);
    expect(forbiddenValues.length).toBeGreaterThan(0);

    const results = parseInstitutionalXml(xml);
    const serialized = JSON.stringify(results);
    for (const value of forbiddenValues) {
      expect(serialized.includes(value)).toBe(false);
    }
  });
});

describe('lineId collision handling (§19.14, decision D1)', () => {
  it('falls back to positional ids when charges lack remote_chgid', () => {
    const xml = `<claims>
      <claim claim_form="ub92" type_of_bill="81A" hosp_from_date="2026-01-01" total_charge="20.00">
        <charge charge="10.00" units="1" rev_code="0250" charge_record_type="UN"/>
        <charge charge="10.00" units="1" rev_code="0250" charge_record_type="UN"/>
      </claim>
    </claims>`;

    const [result] = parseInstitutionalXml(xml);
    expect(result).toBeDefined();
    if (result === undefined) return;
    const { claim } = result;

    expect(claim.lineIdScheme).toBe('positional');
    expect(claim.lines[0]?.lineId).toBe('idx:0');
    expect(claim.lines[1]?.lineId).toBe('idx:1');
  });

  it('throws EngineError LINE_ID_NOT_UNIQUE when two charges share a non-empty remote_chgid', () => {
    const xml = `<claims>
      <claim claim_form="ub92" type_of_bill="81A" hosp_from_date="2026-01-01" total_charge="20.00">
        <charge remote_chgid="DUP" charge="10.00" units="1" rev_code="0250" charge_record_type="UN"/>
        <charge remote_chgid="DUP" charge="10.00" units="1" rev_code="0250" charge_record_type="UN"/>
      </claim>
    </claims>`;

    let thrown: unknown;
    try {
      parseInstitutionalXml(xml);
    } catch (e) {
      thrown = e;
    }
    expect(isEngineError(thrown)).toBe(true);
    if (isEngineError(thrown)) {
      expect(thrown.code).toBe('LINE_ID_NOT_UNIQUE');
    }
  });
});
