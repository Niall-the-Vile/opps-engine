#!/usr/bin/env node
// tools/gen-ncci-ptp.mjs — U28: NCCI PTP edit tables -> src/data/ncciPtp.<vintage>.ts
//
// Reads the four CMS NCCI facility-outpatient-hospital PTP files
// (`ccioph-v323r0-f1..f4.txt`, version 32.3) and emits a generated data
// module, following the same discipline as `tools/gen-data.mjs`: read raw
// as latin1, index columns in exactly one place, run a census self-check
// that refuses to write output on unexpected drift, and print row counts
// plus the CCMI distribution on every run.
//
// SOURCE LOCATION. These files live outside this repo (they are separate
// CMS quarterly downloads, not part of the CY2026 "data files in format"
// tree `gen-data.mjs` reads). The path is overridable — pass it as argv[2]
// or set NCCI_PTP_DIR — because it will not exist at this default location
// on another machine or in CI.
//
// SCALE. ~1.87M total edit rows across the 4 files. Only the currently
// *active* edits (deletion date `*`) are shipped in the generated module —
// see the "why not the full historical set" note above `writePtpModule`.
// The active set (~1.4M rows) is still large, so it is NOT emitted as a
// JSON array-of-arrays literal (that measured ~34 MB of source text with
// per-row quote/comma/bracket overhead). Instead it is packed into one
// delimiter-separated string, grouped by Column 1 code (which repeats
// heavily — avg fan-out ~140 Column 2 codes per Column 1 code in the
// active set), and parsed into a `Map<string, Map<string, Ccmi>>` once, at
// load time, in `src/data/index.ts`. HCPCS/CPT codes are `[A-Z0-9]` only,
// so `\t` (group separator), `,` (entry separator) and `:` (code/CCMI
// separator) can never collide with real code text.
//
// PTP rationale text (the free-text 7th column) is NOT carried into the
// generated module. It is not decision-bearing (the CCMI value is what
// every rule keys on — see docs/NCCI_INTEGRATION.md §6.2, which lists only
// CCMI/modifier-set/MAI/zero-MUE as the facts a rule needs) and dropping
// it removes ~2 bytes/row of size for no loss of anything a rule reads.
// The 12 distinct rationale strings observed are themselves short
// CMS-authored edit-category labels ("Mutually exclusive procedures",
// "Standards of medical/surgical practice", etc.), not CPT descriptors —
// see the final report for the copyright reasoning — but excluding them
// anyway is the more conservative choice given they carry no rule weight.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'src', 'data');

const NCCI_PTP_DIR =
  process.argv[2] ??
  process.env.NCCI_PTP_DIR ??
  path.resolve(REPO_ROOT, '..', '_ncci_staging');

const PTP_FILES = [1, 2, 3, 4].map((n) =>
  path.join(NCCI_PTP_DIR, `ccioph-v323r0-f${n}`, `ccioph-v323r0-f${n}.txt`),
);

const VERSION_TAG = 'ncci-ptp-facility-oph-v32.3-eff-2026-10-01';

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

// ---------------------------------------------------------------------------
// Column layout (see docs/NCCI_INTEGRATION.md §3 for the source table):
//   0 Column 1 code | 1 Column 2 code | 2 pre-1996 flag | 3 effective date
//   4 deletion date ('*' = still active) | 5 CCMI (0/1/9) | 6 rationale
//
// The header is a *multi-row* block: row N has "Column 1" in cell 0, and
// the following rows are continuation rows (blank cell 0) until real data
// starts. Detected by content, not a fixed line count, per the same
// instruction `gen-data.mjs`'s PPRRVU reader already follows — a fixed
// index broke once before (this file's own header spans a different
// number of rows than the MUE CSV's).
// ---------------------------------------------------------------------------

function findDataStart(lines) {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const col0 = (lines[i].split('\t')[0] ?? '').trim();
    if (col0 === 'Column 1') {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error('PTP file: could not find "Column 1" header row');
  let dataStart = headerIdx + 1;
  while (dataStart < lines.length && (lines[dataStart].split('\t')[0] ?? '').trim() === '') {
    dataStart += 1;
  }
  return dataStart;
}

function parsePtpFile(filePath) {
  const text = readLatin1(filePath);
  const lines = text.split(/\r\n|\r|\n/);
  const dataStart = findDataStart(lines);
  const rows = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const cols = line.split('\t');
    if (cols.length < 7) {
      fail(`${filePath}:${i + 1}: expected >=7 tab-separated fields, got ${cols.length}: ${JSON.stringify(line)}`);
      continue;
    }
    const col1 = cols[0].trim();
    const col2 = cols[1].trim();
    const effDate = cols[3].trim();
    const delDate = cols[4].trim();
    const ccmi = cols[5].trim();
    if (col1 === '' || col2 === '') {
      fail(`${filePath}:${i + 1}: empty code in Column 1 or Column 2`);
      continue;
    }
    if (ccmi !== '0' && ccmi !== '1' && ccmi !== '9') {
      fail(`${filePath}:${i + 1}: CCMI "${ccmi}" is not one of {0,1,9}`);
      continue;
    }
    rows.push({ col1, col2, effDate, delDate, ccmi });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Census baselines — measured directly against the real 4-file source set
// (see the final report for the probe script and its output). These are
// the generator's own recorded truth, not the integration doc's rounded
// "~1.87M" figure; the two differ by a few dozen rows, which is exactly
// the kind of drift this self-check exists to catch on a future refresh.
// ---------------------------------------------------------------------------

const EXPECTED_TOTAL_ROWS = 1868882;
const EXPECTED_DISTINCT_CODES = 12668;
const EXPECTED_CCMI = { '0': 65663, '1': 1773217, '9': 30002 };
const EXPECTED_ACTIVE_ROWS = 1406699;

function genNcciPtp() {
  console.log('\n=== U28: NCCI PTP (facility OPH, v32.3) -> ncciPtp.ncci2026oct.ts ===');
  console.log(`source dir: ${NCCI_PTP_DIR}`);

  let allRows = [];
  for (const f of PTP_FILES) {
    const rows = parsePtpFile(f);
    console.log(`  ${path.basename(f)}: ${rows.length} data rows`);
    allRows = allRows.concat(rows);
  }
  console.log(`total data rows read: ${allRows.length}`);

  const distinctCodes = new Set();
  const ccmiDist = { '0': 0, '1': 0, '9': 0 };
  const activeByCol1 = new Map(); // col1 -> Map<col2, ccmi>
  let activeRows = 0;
  let duplicateActivePairs = 0;

  for (const r of allRows) {
    distinctCodes.add(r.col1);
    distinctCodes.add(r.col2);
    ccmiDist[r.ccmi] += 1;
    if (r.delDate === '*') {
      activeRows += 1;
      let group = activeByCol1.get(r.col1);
      if (group === undefined) {
        group = new Map();
        activeByCol1.set(r.col1, group);
      }
      if (group.has(r.col2)) {
        duplicateActivePairs += 1;
        fail(`duplicate active pair (${r.col1}, ${r.col2}) — a later row silently overwrote an earlier one`);
      }
      group.set(r.col2, r.ccmi);
    }
  }

  const droppedInactive = allRows.length - activeRows;

  console.log(`distinct codes (Column 1 union Column 2): ${distinctCodes.size}`);
  console.log('CCMI distribution:', ccmiDist);
  console.log(`active (deletion date '*') rows: ${activeRows}`);
  console.log(
    `inactive/historical rows DROPPED from the generated module (not silently — logged here): ${droppedInactive}`,
  );

  // --- Census self-check ---
  assertEqual('total PTP data rows', allRows.length, EXPECTED_TOTAL_ROWS);
  assertEqual('distinct PTP codes', distinctCodes.size, EXPECTED_DISTINCT_CODES);
  for (const k of ['0', '1', '9']) {
    assertEqual(`CCMI ${k} rows`, ccmiDist[k], EXPECTED_CCMI[k]);
  }
  assertEqual('active PTP rows', activeRows, EXPECTED_ACTIVE_ROWS);
  assertEqual('duplicate active (col1,col2) pairs', duplicateActivePairs, 0);

  return { activeByCol1, activeRows, droppedInactive, ccmiDist, distinctCodeCount: distinctCodes.size };
}

function packActiveTable(activeByCol1) {
  const col1Keys = [...activeByCol1.keys()].sort();
  const groupLines = [];
  for (const col1 of col1Keys) {
    const group = activeByCol1.get(col1);
    const col2Keys = [...group.keys()].sort();
    const entries = col2Keys.map((col2) => `${col2}:${group.get(col2)}`);
    groupLines.push(`${col1}\t${entries.join(',')}`);
  }
  return groupLines.join('\n');
}

function writeNcciPtpModule(packed, meta) {
  const lines = [];
  lines.push('// GENERATED FILE — do not edit by hand.');
  lines.push('// Produced by tools/gen-ncci-ptp.mjs from the CMS NCCI facility Outpatient');
  lines.push('// Hospital PTP files (ccioph-v323r0-f1..f4, version 32.3, effective through');
  lines.push('// 2026-10-01). Regenerate with `npm run gen:ncci`.');
  lines.push('//');
  lines.push('// VINTAGE NOTE (D93): this source is a full quarter ahead of every other');
  lines.push('// loaded schedule (opps/clfs/mpfs/dmepos are all January 2026). See');
  lines.push('// DATA_VERSION below and docs/NCCI_INTEGRATION.md §3.');
  lines.push('//');
  lines.push(`// Only currently-ACTIVE edits (deletion date '*') are included:`);
  lines.push(`// ${meta.activeRows} of ${meta.activeRows + meta.droppedInactive} total rows.`);
  lines.push(`// ${meta.droppedInactive} inactive/historical rows were read and counted (see`);
  lines.push('// this generator\'s own console output) but are NOT shipped in this module —');
  lines.push('// a deliberate size/relevance tradeoff (spec-adjacent judgment call, see the');
  lines.push('// final report), not silent data loss: the exact dropped count is logged on');
  lines.push('// every generator run and repeated here.');
  lines.push('//');
  lines.push('// FORMAT — packed, not a JSON array literal (spec §7.3\'s "sorted flat');
  lines.push('// array with a keyed lookup built at load," applied to a table too large');
  lines.push('// for a nested object literal to be reasonable). One line per distinct');
  lines.push('// Column-1 code: `<col1>\\t<col2>:<ccmi>,<col2>:<ccmi>,...`. Parsed into a');
  lines.push('// `Map<string, Map<string, Ccmi>>` once, lazily, in src/data/index.ts.');
  lines.push('// HCPCS/CPT codes are [A-Z0-9] only, so \\t/,/: never collide with a code.');
  lines.push('//');
  lines.push('// PTP rationale text is deliberately NOT included — see this generator\'s');
  lines.push('// own file header for why (not decision-bearing; also the more');
  lines.push('// conservative copyright choice even though it reads as a CMS category');
  lines.push('// label, not a CPT descriptor).');
  lines.push('');
  lines.push("export type Ccmi = '0' | '1' | '9';");
  lines.push('');
  lines.push(`export const DATA_VERSION = ${JSON.stringify(VERSION_TAG)};`);
  lines.push('');
  lines.push(`export const NCCI_PTP_ACTIVE_ROW_COUNT = ${meta.activeRows};`);
  lines.push(`export const NCCI_PTP_DROPPED_INACTIVE_ROW_COUNT = ${meta.droppedInactive};`);
  lines.push('');
  lines.push('// One row per distinct Column 1 code; see FORMAT above. Typed as plain');
  lines.push('// `string`, not inferred as a literal type — this constant is ~11 MB of');
  lines.push('// source text and TS narrows a `const` string to its literal type by');
  lines.push('// default, which made a later `=== \'\'` comparison in src/data/index.ts a');
  lines.push('// compile error ("no overlap") the first time this was wired up.');
  lines.push(`export const NCCI_PTP_PACKED: string = ${JSON.stringify(packed)};`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const { activeByCol1, activeRows, droppedInactive } = genNcciPtp();

  if (hardFailures > 0) {
    console.error(`\n${hardFailures} hard failure(s). Refusing to write src/data/ncciPtp.ncci2026oct.ts.`);
    process.exit(1);
  }

  const packed = packActiveTable(activeByCol1);
  writeFileSync(path.join(OUT_DIR, 'ncciPtp.ncci2026oct.ts'), writeNcciPtpModule(packed, { activeRows, droppedInactive }));

  console.log(`\nWrote ${path.join(OUT_DIR, 'ncciPtp.ncci2026oct.ts')}`);
  console.log(`packed table size: ${packed.length} chars (~${(packed.length / 1024 / 1024).toFixed(2)} MiB)`);
}

main();
