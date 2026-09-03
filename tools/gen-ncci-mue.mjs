#!/usr/bin/env node
// tools/gen-ncci-mue.mjs — U30 (data layer only — see MUE.LIMIT's registry
// note for why the rule itself stays reserved): NCCI MUE table ->
// src/data/ncciMue.<vintage>.ts
//
// Reads the CMS facility Outpatient Hospital MUE table
// (`MCR_MUE_OutpatientHospitalServices_Eff_10-01-2026.csv`) and emits a
// generated data module: 15,162 rows, small enough to ship as a plain
// array-of-tuples (unlike PTP's packed format — see gen-ncci-ptp.mjs).
//
// SOURCE LOCATION overridable the same way as gen-ncci-ptp.mjs: argv[2] or
// NCCI_MUE_DIR, defaulting to a sibling `_ncci_staging` folder outside
// this repo.
//
// The file's header is a genuinely multi-line CSV cell ("HCPCS/\nCPT
// Code" spans two physical lines inside one quoted field), so this reads
// it with the same RFC-4180 parser `gen-data.mjs` already uses
// (tools/lib/csv.mjs) rather than a naive line split — a naive split
// would cut the header in half and misalign every column after it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'src', 'data');

const NCCI_MUE_DIR =
  process.argv[2] ??
  process.env.NCCI_MUE_DIR ??
  path.resolve(REPO_ROOT, '..', '_ncci_staging');

const MUE_FILE = path.join(
  NCCI_MUE_DIR,
  'facilityoutpatienthospitalservicesmuetable-effective-10-01-2026',
  'MCR_MUE_OutpatientHospitalServices_Eff_10-01-2026.csv',
);

const VERSION_TAG = 'ncci-mue-facility-oph-eff-2026-10-01';

let hardFailures = 0;

function fail(message) {
  hardFailures += 1;
  console.error(`FAIL: ${message}`);
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, got ${actual} (diff ${actual - expected})`);
  } else {
    console.log(`ok   ${label} = ${actual}`);
  }
}

function readLatin1(p) {
  return readFileSync(p, 'latin1');
}

// Census baselines, measured directly against the real file (differs
// slightly from docs/NCCI_INTEGRATION.md's D92 figures, which appear to
// count physical lines rather than logical CSV rows — the header's
// embedded newline makes those two counts differ by exactly one row; see
// the final report).
const EXPECTED_DATA_ROWS = 15162;
const EXPECTED_MAI = { 1: 42, 2: 6148, 3: 8972 };
const EXPECTED_ZERO_MUE = 1392;

function findHeaderIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cell0 = (rows[i][0] ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (cell0.startsWith('HCPCS')) return i;
  }
  throw new Error('MUE file: could not find the HCPCS header row');
}

function genNcciMue() {
  console.log('\n=== U30 (data layer): NCCI MUE (facility OPH) -> ncciMue.ncci2026oct.ts ===');
  console.log(`source file: ${MUE_FILE}`);

  const text = readLatin1(MUE_FILE);
  const rows = parseCsv(text);
  const headerIdx = findHeaderIndex(rows);
  const dataRows = rows.slice(headerIdx + 1).filter((r) => (r[0] ?? '').trim() !== '');
  console.log(`data rows read: ${dataRows.length}`);

  const rationaleTable = [];
  const rationaleIndex = new Map();
  function rationaleIdxFor(text) {
    let idx = rationaleIndex.get(text);
    if (idx === undefined) {
      idx = rationaleTable.length;
      rationaleTable.push(text);
      rationaleIndex.set(text, idx);
    }
    return idx;
  }

  const codeSet = new Set();
  const outRows = [];
  const maiDist = { 1: 0, 2: 0, 3: 0 };
  let zeroMue = 0;
  let duplicateCodes = 0;

  for (const r of dataRows) {
    const code = (r[0] ?? '').trim().toUpperCase();
    const valueRaw = (r[1] ?? '').trim();
    const maiRaw = (r[2] ?? '').trim();
    const rationaleRaw = (r[3] ?? '').trim();

    if (codeSet.has(code)) {
      duplicateCodes += 1;
      fail(`duplicate MUE code: ${code}`);
    }
    codeSet.add(code);

    if (!/^\d+$/.test(valueRaw)) {
      fail(`code ${code}: MUE value "${valueRaw}" is not a plain non-negative integer`);
      continue;
    }
    const value = Number(valueRaw);
    if (value === 0) zeroMue += 1;

    const maiMatch = /^([123])\b/.exec(maiRaw);
    if (maiMatch === null) {
      fail(`code ${code}: MAI column "${maiRaw}" does not start with 1, 2, or 3`);
      continue;
    }
    const mai = Number(maiMatch[1]);
    maiDist[mai] += 1;

    const rationaleIdx = rationaleIdxFor(rationaleRaw);
    outRows.push([code, value, mai, rationaleIdx]);
  }

  console.log(`distinct codes: ${codeSet.size}`);
  console.log('MAI distribution:', maiDist);
  console.log(`MUE value 0 ("not payable," §4.4) count: ${zeroMue}`);
  console.log(`distinct rationale categories: ${rationaleTable.length}`);

  // --- Census self-check ---
  assertEqual('MUE data rows', outRows.length, EXPECTED_DATA_ROWS);
  assertEqual('MUE distinct codes', codeSet.size, EXPECTED_DATA_ROWS);
  assertEqual('duplicate MUE codes', duplicateCodes, 0);
  for (const k of [1, 2, 3]) {
    assertEqual(`MAI ${k} rows`, maiDist[k], EXPECTED_MAI[k]);
  }
  assertEqual('MUE value 0 rows', zeroMue, EXPECTED_ZERO_MUE);

  return { outRows, rationaleTable };
}

function writeNcciMueModule(outRows, rationaleTable) {
  const lines = [];
  lines.push('// GENERATED FILE — do not edit by hand.');
  lines.push('// Produced by tools/gen-ncci-mue.mjs from the CMS NCCI facility Outpatient');
  lines.push('// Hospital MUE table, effective 2026-10-01. Regenerate with `npm run gen:ncci`.');
  lines.push('//');
  lines.push('// VINTAGE NOTE (D93): this source is a full quarter ahead of every other');
  lines.push('// loaded schedule (opps/clfs/mpfs/dmepos are all January 2026). See');
  lines.push('// DATA_VERSION below and docs/NCCI_INTEGRATION.md §3.');
  lines.push('//');
  lines.push('// `mueRationale` categories are short CMS-authored labels (e.g. "Nature of');
  lines.push('// Analyte"), stored once in NCCI_MUE_RATIONALE and referenced by index —');
  lines.push('// not CPT descriptor text.');
  lines.push('//');
  lines.push('// NOTE (see MUE.LIMIT in src/registry/opps.dispositions.json): this data');
  lines.push('// module exists and is fully queryable via lookupNcciMue(), but the');
  lines.push('// MUE.LIMIT registry rule itself stays reserved (NOT_EVALUATED) — comparing');
  lines.push('// a claim line\'s actual reported units against this value correctly is');
  lines.push('// blocked on spec §19.2 (unit semantics), still open per D89.');
  lines.push('');
  lines.push("export const NCCI_MUE_FIELDS = ['code', 'mueValue', 'mai', 'rationaleIdx'] as const;");
  lines.push('');
  lines.push('export type NcciMueRow = readonly [code: string, mueValue: number, mai: 1 | 2 | 3, rationaleIdx: number];');
  lines.push('');
  lines.push(`export const DATA_VERSION = ${JSON.stringify(VERSION_TAG)};`);
  lines.push('');
  lines.push('export const NCCI_MUE_RATIONALE: readonly string[] = ' + JSON.stringify(rationaleTable) + ';');
  lines.push('');
  lines.push('export const NCCI_MUE_ROWS: readonly NcciMueRow[] = [');
  for (const row of outRows) {
    lines.push(`  ${JSON.stringify(row)},`);
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const { outRows, rationaleTable } = genNcciMue();

  if (hardFailures > 0) {
    console.error(`\n${hardFailures} hard failure(s). Refusing to write src/data/ncciMue.ncci2026oct.ts.`);
    process.exit(1);
  }

  writeFileSync(path.join(OUT_DIR, 'ncciMue.ncci2026oct.ts'), writeNcciMueModule(outRows, rationaleTable));

  console.log(`\nWrote ${path.join(OUT_DIR, 'ncciMue.ncci2026oct.ts')}`);
  console.log(`ncciMue.ncci2026oct.ts rows: ${outRows.length}`);
}

main();
