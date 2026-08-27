#!/usr/bin/env node
// tools/gen-data.mjs — U3/U4/U5/U6 data layer generator.
//
// Regenerates every file under src/data/*.ts (gitignored, generated) from
// the CY2026 source files named in spec §3/§7. Run with `npm run gen:data`.
//
// All raw row indexing for Addendum B lives in this file and nowhere else
// (spec §7.3). The same applies, by extension, to CLFS, the HCPCS
// termination file, and the DMEPOS/PPRRVU membership sources: this is the
// one place that knows column layouts. Everything downstream (src/data/
// index.ts, src/routing.ts) only ever reads the typed, pre-parsed output.
//
// Critical: every source file here is read as latin1, never utf8.
// Addendum B is not valid UTF-8 — two HCPCS cells carry a trailing 0xFF
// byte, and reading as utf8 corrupts them into replacement characters
// that never sanitize back to the real code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..'); // opps-engine/
const DATA_ROOT = path.resolve(REPO_ROOT, '..', 'data files in format');
const OUT_DIR = path.join(REPO_ROOT, 'src', 'data');

const SOURCES = {
  addendumB: path.join(
    DATA_ROOT,
    'ASC - Ambulatory Surgical Center',
    '508 Version 2026 January Web Addendum B',
    '2026 January Web Addendum B.12.29.25.csv',
  ),
  clfs: path.join(
    DATA_ROOT,
    'CLFS - Clinical Lab Fee Schedule',
    'clfs-cy2026-q2v1',
    'PUF_CLFS_CY2026_Q2V1.csv',
  ),
  hcpcsTerm: path.join(
    DATA_ROOT,
    'HCPCS',
    'hcpc2026_jan_anweb_01122026',
    'HCPC2026_JAN_ANWEB_01122026.txt',
  ),
  rvu: path.join(DATA_ROOT, 'RVU - Relative Value Units', 'PPRRVU2026_Jan_nonQPP.csv'),
  dmepos: path.join(DATA_ROOT, 'DME - Durable Medical Equipment', 'DMEPOS26_JAN.csv'),
};

let hardFailures = 0;

function readLatin1(p) {
  return readFileSync(p, 'latin1');
}

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

// ---------------------------------------------------------------------------
// Money / percentage tokenization (spec §7.1)
// ---------------------------------------------------------------------------

/**
 * Strip `$` and thousands `,`, treat a lone `.` as "absent" (distinct from
 * `0.00`, which is a real value), and convert to integer mils (1/1000
 * dollar) without ever going through a floating-point multiply — the
 * string is split on the decimal point and the fractional part is padded
 * to exactly 3 digits, so 648 three-decimal Addendum B rates never
 * truncate. A token that is present but not a valid money token throws;
 * it must never silently become `null` (that would be exactly the
 * "3,881 rated codes silently degrade to no rate" failure §7.1 warns
 * about).
 *
 * @param {string} raw
 * @returns {number | null}
 */
function parseMoneyMils(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed === '.') return null; // explicit "none" placeholder
  const stripped = trimmed.replace(/^\$/, '').replace(/,/g, '');
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(stripped);
  if (m === null) {
    throw new Error(`unparseable money token: ${JSON.stringify(raw)}`);
  }
  const sign = m[1];
  const intPart = m[2];
  const fracPart = (m[3] ?? '').padEnd(3, '0');
  const mils = Number(intPart) * 1000 + Number(fracPart);
  if (Number.isNaN(mils)) {
    throw new Error(`money token parsed to NaN: ${JSON.stringify(raw)}`);
  }
  return sign === '-' ? -mils : mils;
}

/**
 * Strip `%`, treat a lone `.` as absent. Returns the raw percentage
 * number (e.g. `20` for `"20%"`), not a fraction.
 *
 * @param {string} raw
 * @returns {number | null}
 */
function parsePercent(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed === '.') return null;
  const stripped = trimmed.replace(/%$/, '');
  const n = Number(stripped);
  if (Number.isNaN(n)) {
    throw new Error(`unparseable percent token: ${JSON.stringify(raw)}`);
  }
  return n;
}

function parseWeight(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (Number.isNaN(n)) {
    throw new Error(`unparseable weight token: ${JSON.stringify(raw)}`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// U3 — Addendum B -> src/data/opps.cy2026.ts
// ---------------------------------------------------------------------------

const ADDENDUM_B_HEADER_INDEX = 5; // 0-based; data rows follow immediately
const EXPECTED_DATA_ROWS = 18986;

const SHAPE_PATTERNS = [
  { name: 'd5 (CPT I)', re: /^\d{5}$/, expected: 9802 },
  { name: 'AV (HCPCS II)', re: /^[A-V]\d{4}$/, expected: 7455 },
  { name: 'T (CPT III)', re: /^\d{4}T$/, expected: 607 },
  { name: 'F (CPT II)', re: /^\d{4}F$/, expected: 565 },
  { name: 'U (PLA)', re: /^\d{4}U$/, expected: 541 },
  { name: 'M (MAA)', re: /^\d{4}M$/, expected: 14 },
];

const EXPECTED_SI_HISTOGRAM = {
  J1: 3445, N: 2076, A: 2008, M: 1549, C: 1438, Q4: 1346, E1: 1334, T: 1052,
  B: 1017, Y: 778, Q1: 741, S: 674, K: 526, S1: 298, Q3: 183, Q2: 177,
  G: 117, L: 48, E2: 43, R: 41, V: 23, H: 19, U: 17, H1: 13, J2: 13,
  K1: 5, P: 4, F: 1,
};

function stripNonPrintable(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[^\x20-\x7E]/g, '');
}

function genOpps() {
  console.log('\n=== U3: Addendum B -> opps.cy2026.ts ===');
  const text = readLatin1(SOURCES.addendumB);
  const rows = parseCsv(text);
  const header = rows[ADDENDUM_B_HEADER_INDEX];
  if (header === undefined) {
    throw new Error('Addendum B: header row missing at expected index');
  }
  const dataRows = rows.slice(ADDENDUM_B_HEADER_INDEX + 1);
  console.log(`data rows read: ${dataRows.length}`);

  const sanitizedCodes = [];
  const outRows = [];
  const codeSet = new Set();
  let duplicateCodes = 0;
  let ratedCount = 0;
  const siHistogram = {};
  const shapeCounts = new Map(SHAPE_PATTERNS.map((p) => [p.name, 0]));
  const unmatchedShapes = [];

  for (const r of dataRows) {
    const rawCode = r[0] ?? '';
    const shortDescriptor = r[1] ?? '';
    const si = (r[2] ?? '').trim();
    const apcRaw = (r[3] ?? '').trim();
    const weightRaw = r[4] ?? '';
    const rateRaw = r[5] ?? '';
    void shortDescriptor;

    // Census shape-matching runs against the *unsanitized* code (trimmed,
    // uppercased, but non-printable bytes left in place) — §8.1's six
    // pattern counts are pre-sanitization; the 2 sanitized rows are a
    // separate "+2 recovered" line, not folded into a pattern bucket.
    const preSanitizeCode = rawCode.trim().toUpperCase();
    const sanitized = stripNonPrintable(rawCode).trim().toUpperCase();
    const wasSanitized = sanitized !== preSanitizeCode;
    if (wasSanitized) {
      sanitizedCodes.push({ raw: rawCode, sanitized });
      console.log(
        `sanitized HCPCS code: ${JSON.stringify(rawCode)} -> ${JSON.stringify(sanitized)} (SI ${si})`,
      );
    }
    const code = sanitized; // the reachable, lookup-able code

    if (codeSet.has(code)) {
      duplicateCodes += 1;
    }
    codeSet.add(code);

    const apc = apcRaw === '' ? null : apcRaw;
    const weight = parseWeight(weightRaw);
    const rateMils = parseMoneyMils(rateRaw);
    if (rateMils !== null) ratedCount += 1;

    siHistogram[si] = (siHistogram[si] ?? 0) + 1;

    let matched = false;
    for (const pat of SHAPE_PATTERNS) {
      if (pat.re.test(preSanitizeCode)) {
        shapeCounts.set(pat.name, (shapeCounts.get(pat.name) ?? 0) + 1);
        matched = true;
        break;
      }
    }
    if (!matched) unmatchedShapes.push({ code, wasSanitized });

    outRows.push([code, si, apc, weight, rateMils]);
  }

  // --- Census self-check (§8.1) ---
  let shapeSum = 0;
  for (const pat of SHAPE_PATTERNS) {
    const actual = shapeCounts.get(pat.name) ?? 0;
    shapeSum += actual;
    assertEqual(`shape ${pat.name}`, actual, pat.expected);
  }
  assertEqual('shape sum (6 patterns, pre-sanitization)', shapeSum, 18984);
  assertEqual('sanitized rows recovered', sanitizedCodes.length, 2);
  assertEqual('rows matching no shape pre-sanitization', unmatchedShapes.length, 2);
  const unrecoveredUnmatched = unmatchedShapes.filter((u) => !u.wasSanitized);
  if (unrecoveredUnmatched.length > 0) {
    fail(
      `${unrecoveredUnmatched.length} codes matched no valid shape and were not sanitization recoveries: ` +
        unrecoveredUnmatched.map((u) => u.code).join(', '),
    );
  }
  assertEqual('census total (6 shapes + 2 sanitization recoveries)', shapeSum + sanitizedCodes.length, EXPECTED_DATA_ROWS);
  assertEqual('data rows read', dataRows.length, EXPECTED_DATA_ROWS);
  assertEqual('duplicate HCPCS keys', duplicateCodes, 0);

  // --- Rated-row count ---
  assertEqual('rows carrying a payment rate', ratedCount, 7312);

  // --- SI histogram (§3.5) ---
  const expectedKeys = Object.keys(EXPECTED_SI_HISTOGRAM);
  const actualKeys = Object.keys(siHistogram);
  assertEqual('distinct SI count', actualKeys.length, expectedKeys.length);
  for (const si of expectedKeys) {
    assertEqual(`SI ${si} count`, siHistogram[si] ?? 0, EXPECTED_SI_HISTOGRAM[si]);
  }
  for (const si of actualKeys) {
    if (!(si in EXPECTED_SI_HISTOGRAM)) {
      fail(`unexpected SI in histogram: ${si} (count ${siHistogram[si]})`);
    }
  }

  return { outRows, sanitizedCodes };
}

function writeOppsModule(outRows) {
  const lines = [];
  lines.push('// GENERATED FILE — do not edit by hand.');
  lines.push('// Produced by tools/gen-data.mjs from CY2026 OPPS Addendum B');
  lines.push('// (January 2026 release, 12/29/25). Regenerate with `npm run gen:data`.');
  lines.push('//');
  lines.push('// Milestone-1 field subset only (spec §7.2): copay columns are tokenized');
  lines.push('// by the generator but deferred to milestone 2.');
  lines.push('');
  lines.push("export const OPPS_FIELDS = ['code', 'si', 'apc', 'weight', 'rateMils'] as const;");
  lines.push('');
  lines.push('export type OppsRow = readonly [');
  lines.push('  code: string,');
  lines.push('  si: string,');
  lines.push('  apc: string | null,');
  lines.push('  weight: number | null,');
  lines.push('  rateMils: number | null,');
  lines.push('];');
  lines.push('');
  lines.push(`export const DATA_VERSION = ${JSON.stringify('opps-cy2026-jan-addendum-b-2025-12-29')};`);
  lines.push('');
  lines.push('export const OPPS_ROWS: readonly OppsRow[] = [');
  for (const row of outRows) {
    lines.push(`  ${JSON.stringify(row)},`);
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// U4 — CLFS -> src/data/clfs.cy2026.ts
// ---------------------------------------------------------------------------

const CLFS_HEADER_INDEX = 4; // 0-based
const CLFS_EXPECTED_ROWS = 2179;

function genClfs() {
  console.log('\n=== U4: CLFS -> clfs.cy2026.ts ===');
  const text = readLatin1(SOURCES.clfs);
  const rows = parseCsv(text);
  const header = rows[CLFS_HEADER_INDEX];
  if (header === undefined) {
    throw new Error('CLFS: header row missing at expected index');
  }
  const dataRows = rows.slice(CLFS_HEADER_INDEX + 1).filter((r) => r.length >= 6 && (r[1] ?? '') !== '');
  console.log(`data rows read: ${dataRows.length}`);

  const outRows = [];
  const codeSet = new Set();
  let qwCount = 0;
  let zeroRateCount = 0;
  let zeroRateNonL = 0;
  let aprilCount = 0;
  let janCount = 0;
  const effDateHistogram = {};

  for (const r of dataRows) {
    const code = (r[1] ?? '').trim().toUpperCase();
    const modifier = (r[2] ?? '').trim().toUpperCase();
    const effDate = (r[3] ?? '').trim();
    const indicator = (r[4] ?? '').trim();
    const rateRaw = r[5] ?? '';

    codeSet.add(code);
    if (modifier === 'QW') qwCount += 1;

    effDateHistogram[effDate] = (effDateHistogram[effDate] ?? 0) + 1;
    if (effDate === '20260401') aprilCount += 1;
    if (effDate === '20260101') janCount += 1;

    // CLFS rates are plain decimals ("00720.00"), no `$`, but re-use the
    // same tokenizer for consistency and to catch a genuinely malformed
    // cell rather than silently coercing it.
    let rateMils = parseMoneyMils(rateRaw);
    const isZero = rateMils === 0;
    if (isZero) {
      zeroRateCount += 1;
      if (indicator !== 'L') zeroRateNonL += 1;
      // §3.1: a $0.00 CLFS row (INDICATOR = L) must never emit a rate —
      // that is a fabricated benchmark. Unprice it explicitly.
      rateMils = null;
    }

    outRows.push([code, modifier, effDate, indicator, rateMils]);
  }

  assertEqual('CLFS record count', dataRows.length, CLFS_EXPECTED_ROWS);
  assertEqual('CLFS distinct codes', codeSet.size, 2055);
  assertEqual('CLFS QW rows', qwCount, 124);
  assertEqual('CLFS zero-rate rows', zeroRateCount, 49);
  assertEqual('CLFS zero-rate rows not carrying INDICATOR=L', zeroRateNonL, 0);
  assertEqual('CLFS rows effective 20260401', aprilCount, 17);
  assertEqual('CLFS rows effective 20260101', janCount, 2162);

  return { outRows };
}

function writeClfsModule(outRows) {
  const lines = [];
  lines.push('// GENERATED FILE — do not edit by hand.');
  lines.push('// Produced by tools/gen-data.mjs from CY2026 CLFS (Q2 V1).');
  lines.push('// Regenerate with `npm run gen:data`.');
  lines.push('//');
  lines.push('// Keyed by (code, modifier) — 124 codes carry a second row under');
  lines.push('// modifier QW (CLIA-waived). A code-keyed map would drop one of each pair.');
  lines.push('// `rateMils` is `null` for the 49 INDICATOR=L, RATE=0.00 rows: a $0.00');
  lines.push('// CLFS benchmark is a fabricated value (spec §3.1), never emitted.');
  lines.push('');
  lines.push("export const CLFS_FIELDS = ['code', 'modifier', 'effFrom', 'indicator', 'rateMils'] as const;");
  lines.push('');
  lines.push('export type ClfsRow = readonly [');
  lines.push('  code: string,');
  lines.push('  modifier: string,');
  lines.push('  effFrom: string,');
  lines.push('  indicator: string,');
  lines.push('  rateMils: number | null,');
  lines.push('];');
  lines.push('');
  lines.push(`export const DATA_VERSION = ${JSON.stringify('clfs-cy2026-q2v1')};`);
  lines.push('');
  lines.push('export const CLFS_ROWS: readonly ClfsRow[] = [');
  for (const row of outRows) {
    lines.push(`  ${JSON.stringify(row)},`);
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// U5 — HCPCS termination file -> src/data/hcpcsTerm.cy2026.ts
// ---------------------------------------------------------------------------

// 1-indexed per spec: RIC at column 11, TERM_DT at columns 285-292.
const RIC_START = 10; // 0-based, slice[10:11]
const RIC_END = 11;
const TERM_DT_START = 284; // 0-based, slice[284:292]
const TERM_DT_END = 292;

function genHcpcsTerm() {
  console.log('\n=== U5: HCPCS termination file -> hcpcsTerm.cy2026.ts ===');
  const text = readLatin1(SOURCES.hcpcsTerm);
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  console.log(`lines read: ${lines.length}`);

  const codeTerm = new Map(); // code -> termDate ('' if seen but no term date yet)
  const procedureCodes = new Set();

  for (const line of lines) {
    if (line.length < TERM_DT_END) continue;
    const code = line.slice(0, 5).trim();
    const ric = line.slice(RIC_START, RIC_END);
    if (ric !== '3' && ric !== '4') continue;
    procedureCodes.add(code);
    const term = line.slice(TERM_DT_START, TERM_DT_END).trim();
    if (term !== '') {
      const existing = codeTerm.get(code);
      if (existing !== undefined && existing !== term) {
        fail(`code ${code} carries two different term dates: ${existing} vs ${term}`);
      }
      codeTerm.set(code, term);
    }
  }

  assertEqual('HCPCS procedure-record distinct codes (RIC 3/4)', procedureCodes.size, 8623);

  const termRows = [...codeTerm.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assertEqual('HCPCS codes carrying a term date', termRows.length, 1300);

  const futureOrCurrent = termRows.filter(([, d]) => d >= '20260101');
  assertEqual('HCPCS term dates in 2026 or later', futureOrCurrent.length, 0);

  return { termRows };
}

function writeHcpcsTermModule(termRows) {
  const lines = [];
  lines.push('// GENERATED FILE — do not edit by hand.');
  lines.push('// Produced by tools/gen-data.mjs from the HCPCS termination file');
  lines.push('// (hcpc2026_jan_anweb_01122026). Regenerate with `npm run gen:data`.');
  lines.push('//');
  lines.push('// Spec §7.5.1: this is a *historical validity index*, not a termination');
  lines.push('// index — every code here is already absent from CY2026 Addendum B, and');
  lines.push('// none carries a term date in 2026 or later. It answers "was this absent');
  lines.push('// code alive on this claim\'s date of service," the inverse of what a');
  lines.push('// forward-looking DELETED verdict would need.');
  lines.push('');
  lines.push("export const HCPCS_TERM_FIELDS = ['code', 'termDate'] as const;");
  lines.push('');
  lines.push('export type HcpcsTermRow = readonly [code: string, termDate: string];');
  lines.push('');
  lines.push(`export const DATA_VERSION = ${JSON.stringify('hcpcs-cy2026-jan-anweb-2026-01-12')};`);
  lines.push('');
  lines.push('export const HCPCS_TERM_ROWS: readonly HcpcsTermRow[] = [');
  for (const row of termRows) {
    lines.push(`  ${JSON.stringify(row)},`);
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// U6 — schedule-derivation membership sets
// ---------------------------------------------------------------------------

function genDmepos() {
  console.log('\n=== U6: DMEPOS26_JAN.csv -> dmepos.cy2026.ts ===');
  const text = readLatin1(SOURCES.dmepos);
  const rows = parseCsv(text);
  // 6 title rows (0-5), header at index 6, data from index 7.
  const headerIdx = 6;
  const header = rows[headerIdx];
  if (header === undefined || (header[0] ?? '').trim().toUpperCase() !== 'HCPCS') {
    throw new Error(`DMEPOS: expected header row at index ${headerIdx}, found ${JSON.stringify(header)}`);
  }
  const dataRows = rows.slice(headerIdx + 1);
  const codes = new Set();
  for (const r of dataRows) {
    const code = (r[0] ?? '').trim().toUpperCase();
    if (code !== '') codes.add(code);
  }
  console.log(`DMEPOS distinct codes: ${codes.size}`);
  return { codes: [...codes].sort() };
}

function genMpfs() {
  console.log('\n=== U6: PPRRVU2026_Jan_nonQPP.csv -> mpfs.cy2026.ts ===');
  const text = readLatin1(SOURCES.rvu);
  const rows = parseCsv(text);
  // Category header rows precede the field-name row; find it by content
  // rather than assuming a fixed index, per spec instruction.
  const headerIdx = rows.findIndex((r) => (r[0] ?? '').trim().toUpperCase() === 'HCPCS');
  if (headerIdx === -1) {
    throw new Error('PPRRVU: could not find HCPCS header row');
  }
  const dataRows = rows.slice(headerIdx + 1);
  const codes = new Set();
  for (const r of dataRows) {
    const code = (r[0] ?? '').trim().toUpperCase();
    if (code === '') continue;
    // Columns 11 (non-facility TOTAL) and 12 (facility TOTAL). "Non-zero
    // total RVU" is not disambiguated further by the spec; a code counts
    // as MPFS-priceable membership if *either* setting carries a
    // non-zero total, since some codes are populated in only one.
    const nonFacTotal = Number((r[11] ?? '0').trim());
    const facTotal = Number((r[12] ?? '0').trim());
    const nonFac = Number.isNaN(nonFacTotal) ? 0 : nonFacTotal;
    const fac = Number.isNaN(facTotal) ? 0 : facTotal;
    if (nonFac !== 0 || fac !== 0) codes.add(code);
  }
  console.log(`MPFS distinct codes with non-zero total RVU: ${codes.size}`);
  return { codes: [...codes].sort() };
}

function genAfs() {
  console.log('\n=== U6: Ambulance AFS — skipped (xlsx source) ===');
  console.log(
    'TODO: source is `ASC - Ambulatory Surgical Center/Copy_of_AFS2026_PUF_ext.xlsx`. ' +
      'Skipped per build instruction to avoid an xlsx dependency. Emitting an empty AFS set.',
  );
  return { codes: [] };
}

function writeCodeSetModule(name, versionTag, codes, headerComment) {
  const lines = [];
  lines.push('// GENERATED FILE — do not edit by hand.');
  lines.push(`// Produced by tools/gen-data.mjs. Regenerate with \`npm run gen:data\`.`);
  if (headerComment) {
    lines.push('//');
    for (const l of headerComment.split('\n')) lines.push(`// ${l}`);
  }
  lines.push('');
  lines.push(`export const DATA_VERSION = ${JSON.stringify(versionTag)};`);
  lines.push('');
  lines.push(`export const ${name}: readonly string[] = ${JSON.stringify(codes)};`);
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// U6 — §3.4 precedence self-check / build-log
// ---------------------------------------------------------------------------

const ROUTED_FREE_SIS = new Set(['A', 'B', 'C', 'E1', 'E2', 'M', 'Y']);

function paysOwnApc(si) {
  return !ROUTED_FREE_SIS.has(si);
}

function scheduleLog(oppsRows, clfsCodeSet, dmeposSet, afsSet, mpfsSet) {
  console.log('\n=== U6: §3.4 precedence self-check ===');

  function deriveSchedule(code, si, rateMils) {
    if (rateMils !== null && paysOwnApc(si)) return 'OPPS';
    if (clfsCodeSet.has(code)) return 'CLFS';
    if (dmeposSet.has(code)) return 'DMEPOS';
    if (afsSet.has(code)) return 'AFS';
    if (mpfsSet.has(code)) return 'MPFS';
    return null;
  }

  const buckets = { OPPS: 0, CLFS: 0, DMEPOS: 0, AFS: 0, MPFS: 0, null: 0 };
  const unmatchedA = [];
  const unmatchedY = [];
  let aInClfs = 0;
  let yInDmepos = 0;
  let siACount = 0;
  let siYCount = 0;

  for (const [code, si, , , rateMils] of oppsRows) {
    if (si !== 'A' && si !== 'Y') continue;
    const sched = deriveSchedule(code, si, rateMils);
    buckets[sched === null ? 'null' : sched] += 1;
    if (si === 'A') {
      siACount += 1;
      if (clfsCodeSet.has(code)) aInClfs += 1;
      if (sched === null) unmatchedA.push(code);
    } else {
      siYCount += 1;
      if (dmeposSet.has(code)) yInDmepos += 1;
      if (sched === null) unmatchedY.push(code);
    }
  }

  console.log('Per-bucket count (SI A/Y lines only):', buckets);
  console.log(`unmatched SI A codes (${unmatchedA.length}):`, unmatchedA.slice(0, 20));
  console.log(`unmatched SI Y codes (${unmatchedY.length}):`, unmatchedY.slice(0, 20));

  assertEqual('SI A codes total', siACount, 2008);
  assertEqual('SI A codes in CLFS', aInClfs, 672);
  assertEqual('SI Y codes total', siYCount, 778);
  assertEqual('SI Y codes in DMEPOS', yInDmepos, 662);

  // OPPS-first guard self-check (§3.4): codes with an OPPS rate whose own
  // SI pays its own APC, but which are *also* present in CLFS — precedence
  // must resolve these to OPPS, not CLFS. §3.4 names 10 such SI Q1 codes.
  let guardCases = 0;
  const guardSiHistogram = {};
  for (const [code, si, , , rateMils] of oppsRows) {
    if (rateMils === null) continue;
    if (!paysOwnApc(si)) continue;
    if (!clfsCodeSet.has(code)) continue;
    guardCases += 1;
    guardSiHistogram[si] = (guardSiHistogram[si] ?? 0) + 1;
  }
  console.log('OPPS-first guard cases (OPPS-rated, own-APC SI, also in CLFS):', guardSiHistogram);
  assertEqual('OPPS-first guard case count', guardCases, 10);
  assertEqual('OPPS-first guard cases with SI other than Q1', guardCases - (guardSiHistogram.Q1 ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const { outRows: oppsRows } = genOpps();
  const { outRows: clfsRows } = genClfs();
  const { termRows } = genHcpcsTerm();
  const { codes: dmeposCodes } = genDmepos();
  const { codes: mpfsCodes } = genMpfs();
  const { codes: afsCodes } = genAfs();

  const clfsCodeSet = new Set(clfsRows.map((r) => r[0]));
  scheduleLog(
    oppsRows,
    clfsCodeSet,
    new Set(dmeposCodes),
    new Set(afsCodes),
    new Set(mpfsCodes),
  );

  if (hardFailures > 0) {
    console.error(`\n${hardFailures} hard failure(s). Refusing to write src/data/*.ts.`);
    process.exit(1);
  }

  writeFileSync(path.join(OUT_DIR, 'opps.cy2026.ts'), writeOppsModule(oppsRows));
  writeFileSync(path.join(OUT_DIR, 'clfs.cy2026.ts'), writeClfsModule(clfsRows));
  writeFileSync(path.join(OUT_DIR, 'hcpcsTerm.cy2026.ts'), writeHcpcsTermModule(termRows));
  writeFileSync(
    path.join(OUT_DIR, 'dmepos.cy2026.ts'),
    writeCodeSetModule(
      'DMEPOS_CODES',
      'dmepos-cy2026-jan',
      dmeposCodes,
      'Set membership only (spec §3.2 Tier 2 — DMEPOS is never priced here,\nonly named). Source: DME - Durable Medical Equipment/DMEPOS26_JAN.csv.',
    ),
  );
  writeFileSync(
    path.join(OUT_DIR, 'mpfs.cy2026.ts'),
    writeCodeSetModule(
      'MPFS_CODES',
      'mpfs-cy2026-jan-nonqpp',
      mpfsCodes,
      'Set membership only. A code qualifies if either its non-facility or\nfacility total RVU (PPRRVU columns 11/12) is non-zero — the spec\nspecifies "non-zero total RVU" without disambiguating facility vs\nnon-facility, so this generator treats either as sufficient membership.\nSource: RVU - Relative Value Units/PPRRVU2026_Jan_nonQPP.csv.',
    ),
  );
  writeFileSync(
    path.join(OUT_DIR, 'afs.cy2026.ts'),
    writeCodeSetModule(
      'AFS_CODES',
      'afs-cy2026-unsourced',
      afsCodes,
      'TODO: Ambulance AFS source is `.xlsx`\n(ASC - Ambulatory Surgical Center/Copy_of_AFS2026_PUF_ext.xlsx).\nSkipped per build instruction, to avoid adding an xlsx dependency.\nEmpty set — the AFS precedence step in routing.ts is inert until sourced.',
    ),
  );

  console.log('\nAll data modules written to', OUT_DIR);
  console.log(`opps.cy2026.ts rows: ${oppsRows.length}`);
  console.log(`clfs.cy2026.ts rows: ${clfsRows.length}`);
  console.log(`hcpcsTerm.cy2026.ts rows: ${termRows.length}`);
  console.log(`dmepos.cy2026.ts codes: ${dmeposCodes.length}`);
  console.log(`mpfs.cy2026.ts codes: ${mpfsCodes.length}`);
  console.log(`afs.cy2026.ts codes: ${afsCodes.length}`);
}

main();
