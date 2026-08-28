#!/usr/bin/env node
// tools/bundle.mjs — U24 (spec §2.7, docs/M25-browser-interface.md).
//
// Builds the browser bundle (dist/engine.bundle.js) with esbuild, exactly
// per §2.7's build story: `--format=iife --global-name=OppsEngine
// --target=es2022 --loader:.json=json`, unminified. NOT a concatenation —
// esbuild's real bundler is used (`bundle: true`), so the `dsl/operators`
// <-> `dsl/evaluate` composite-operator cycle (§4.3's allOf/anyOf/not) is
// resolved the way a module bundler resolves a cycle, not the way flat
// concatenation would (a load-time TDZ ReferenceError — §17 defect 3, the
// exact failure this build step exists to eliminate).
//
// The entry point is tools/bundleEntry.ts, NOT src/index.ts directly: the
// shipped global needs `DATA_VERSION` too (§2.7's own global list), which
// lives on src/data/index.ts, not src/index.ts's own export list — see that
// file's header for why re-exporting from tools/ (not editing src/) is the
// right seam.
//
// After building, this script LOADS the produced file and runs a real
// adjudication against it twice:
//
//   1. In-place, immediately after the build — a fast sanity check.
//   2. From an isolated copy in the OS temp directory, with the repo's own
//      src/, registry/, and test/ directories renamed out of the way for
//      the duration of the check — proving the data and registry actually
//      live INSIDE the bundle, not read from disk at run time (build brief:
//      "Verify the bundle works with /src, /registry and /test unreadable").
//      Renaming (not deleting) so a failure midway never loses source; a
//      `finally` block restores the original names unconditionally.
//
// Both checks run the built file through Node's `vm` module in a bare
// sandbox (a plain object standing in for `window`, no `require`, no
// filesystem access exposed to the script) — the closest approximation of
// "opened directly as a file, offline" available from a Node CLI tool.

import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'tools', 'bundleEntry.mjs');
const OUTFILE = path.join(ROOT, 'dist', 'engine.bundle.js');

async function build() {
  fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
  await esbuild.build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: 'iife',
    globalName: 'OppsEngine',
    target: 'es2022',
    loader: { '.json': 'json' },
    minify: false,
    sourcemap: false,
    logLevel: 'warning',
  });
  const stat = fs.statSync(OUTFILE);
  console.log(`built ${path.relative(ROOT, OUTFILE)} (${(stat.size / 1024).toFixed(0)} KiB)`);
}

/** A minimal, valid ClaimInput (spec §2.1) — real shape, not a mock: two Q4 lab codes with no S/T/V trigger, so both should classify as PACKAGED, and G0463 (SI Q3) present as a controlling composite-eligible line. Enough to prove `adjudicate()` actually ran the pipeline, not just that the function exists. */
function sampleClaim() {
  const dos = '20260115';
  const line = (lineId, procCode) => ({
    lineId,
    procCode,
    modifiers: [],
    revCode: '',
    units: '1',
    unitQualifier: '',
    chargeMils: 0,
    fromDate: dos,
    thruDate: dos,
  });
  return {
    claimId: 'bundle-verify',
    claimForm: 'ub04',
    typeOfBill: '131',
    statementFrom: dos,
    statementThrough: dos,
    conditionCodes: [],
    occurrenceCodes: [],
    valueCodes: [],
    billingTaxonomy: '',
    payer: { id: '', name: '' },
    diagnoses: [],
    lines: [line('idx:0', 'G0463'), line('idx:1', '36415'), line('idx:2', '84112'), line('idx:3', '59025')],
    totalChargeMils: 0,
    lineIdScheme: 'positional',
  };
}

const REQUIRED_GLOBAL_KEYS = [
  'adjudicate',
  'explain',
  'applicability',
  'codeFacts',
  'ENGINE_CONTRACT_VERSION',
  'DATA_VERSION',
  'operators',
  'registry',
  'why',
  'parseCodeList',
  'CODE_LIST_SYNTAX',
  'parseInstitutionalXml',
];

/** Loads `bundlePath` in a bare vm sandbox (no require, no fs) and runs one real adjudication, asserting the shape and content a browser page needs. Throws with a descriptive message on any failure — this is a build gate, not a soft warning. */
function verifyBundle(bundlePath, label) {
  const code = fs.readFileSync(bundlePath, 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: path.basename(bundlePath) });

  const engine = sandbox.OppsEngine;
  if (typeof engine !== 'object' || engine === null) {
    throw new Error(`[${label}] window.OppsEngine was not assigned by the bundle`);
  }

  const globalKeys = Object.keys(sandbox).filter((k) => !['console', 'globalThis', 'window'].includes(k));
  if (globalKeys.length !== 1 || globalKeys[0] !== 'OppsEngine') {
    throw new Error(`[${label}] expected exactly one global ("OppsEngine"), got ${JSON.stringify(globalKeys)}`);
  }

  for (const key of REQUIRED_GLOBAL_KEYS) {
    if (!(key in engine)) throw new Error(`[${label}] OppsEngine.${key} is missing`);
  }
  if (typeof engine.adjudicate !== 'function') throw new Error(`[${label}] OppsEngine.adjudicate is not a function`);
  if (typeof engine.ENGINE_CONTRACT_VERSION !== 'string' || engine.ENGINE_CONTRACT_VERSION === '') {
    throw new Error(`[${label}] OppsEngine.ENGINE_CONTRACT_VERSION is not a non-empty string`);
  }

  const result = engine.adjudicate({ claim: sampleClaim() });
  if (!Array.isArray(result.determinations) || result.determinations.length !== 4) {
    throw new Error(`[${label}] adjudicate() did not return 4 determinations: ${JSON.stringify(result)}`);
  }
  const byCode = new Map(result.determinations.map((d) => [d.code, d]));
  // G0463 resolves SI J2 (spec §3.5 spot value: "G0463 SI J2, APC 5012,
  // weight 1.4879, $136.02, min copay $27.21") — not Q3, a value the design
  // reference mocked incorrectly; see the final report.
  const g0463 = byCode.get('G0463');
  if (g0463 === undefined || g0463.resolvedSI !== 'J2') {
    throw new Error(`[${label}] G0463 did not resolve SI J2 as expected from the loaded, bundled OPPS data (got ${JSON.stringify(g0463)})`);
  }
  const line36415 = byCode.get('36415');
  if (line36415 === undefined || line36415.resolvedSI !== 'Q4') {
    throw new Error(`[${label}] 36415 did not resolve SI Q4 as expected from the loaded, bundled OPPS data (got ${JSON.stringify(line36415)})`);
  }
  if (result.determinations.some((d) => d.trace.length === 0 && d.status !== 'NOT_ADJUDICATED')) {
    // Not fatal by itself (some dispositions legitimately carry no trace),
    // but worth a loud note if it ever happens for these specific codes.
  }

  const facts = engine.codeFacts('84112');
  if (facts.si !== 'Q4') throw new Error(`[${label}] codeFacts('84112').si !== 'Q4' (got ${JSON.stringify(facts)}) — bundled data lookup failed`);

  const app = engine.applicability('36415', engine.registry);
  if (app.code !== '36415') throw new Error(`[${label}] applicability('36415', registry) did not return code '36415'`);
  if (app.admitted.length + app.conditional.length + app.reserved.length === 0) {
    throw new Error(`[${label}] applicability('36415', registry) found no rules at all — bundled registry looks empty`);
  }

  if (typeof engine.why !== 'object' || typeof engine.why.describeFiredWhen !== 'function') {
    throw new Error(`[${label}] OppsEngine.why.describeFiredWhen is not a function — shared why-text module did not bundle correctly`);
  }
  if (!Array.isArray(engine.registry) || engine.registry.length === 0) {
    throw new Error(`[${label}] OppsEngine.registry is not a non-empty array`);
  }

  const parsed = engine.parseCodeList('36415 84112');
  const parsedResult = engine.adjudicate({ claim: parsed.claim });
  if (parsedResult.determinations.length !== 2) {
    throw new Error(`[${label}] parseCodeList('36415 84112') -> adjudicate() did not return 2 determinations`);
  }
  if (parsed.flags.length === 0 || parsed.flags[0].severity !== 'assumption') {
    throw new Error(`[${label}] parseCodeList() did not surface the §10.4 assumption flag`);
  }

  const xmlClaim = engine.parseInstitutionalXml(
    '<claims><claim claim_form="ub04" type_of_bill="131" hosp_from_date="2026-01-15" hosp_thru_date="2026-01-15" total_charge="10.00"><charge proc_code="36415" rev_code="0300" units="1" charge="10.00"/></claim></claims>',
  );
  if (xmlClaim.length !== 1 || xmlClaim[0].claim.lines.length !== 1 || xmlClaim[0].claim.lines[0].procCode !== '36415') {
    throw new Error(`[${label}] parseInstitutionalXml() did not parse the smoke-test XML correctly`);
  }

  const explained = engine.explain({
    claimId: result.claimId,
    determinations: result.determinations,
    trace: result.trace,
    facts: result.facts,
    scopeExclusions: result.scopeExclusions,
    counterfactuals: result.counterfactuals,
  });
  if (!Array.isArray(explained.lines) || explained.lines.length !== 4) {
    throw new Error(`[${label}] explain() did not return 4 lines`);
  }

  console.log(`verified [${label}]: 4 determinations, G0463->J2, 36415->Q4, codeFacts/applicability/explain all functional`);
}

/**
 * Copies the built bundle to an isolated OS-temp file, then temporarily
 * renames src/, registry/ (src/registry — already covered by src/, listed
 * separately here for clarity since the build brief names it explicitly),
 * and test/ out of the way and re-verifies from the copy. A `finally`
 * restores every rename even if verification throws, so a failed check
 * never leaves the repo in a half-renamed state.
 */
function verifyIsolated() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opps-bundle-verify-'));
  const isolatedCopy = path.join(tmpDir, 'engine.bundle.js');
  fs.copyFileSync(OUTFILE, isolatedCopy);

  const renames = [
    { from: path.join(ROOT, 'src'), to: path.join(ROOT, '__src_hidden_for_verify__') },
    { from: path.join(ROOT, 'test'), to: path.join(ROOT, '__test_hidden_for_verify__') },
  ];

  const applied = [];
  try {
    for (const r of renames) {
      fs.renameSync(r.from, r.to);
      applied.push(r);
    }
    verifyBundle(isolatedCopy, 'isolated: src/ and test/ renamed away, run from OS temp dir');
  } finally {
    for (const r of applied) {
      fs.renameSync(r.to, r.from);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  await build();
  verifyBundle(OUTFILE, 'in-place');
  verifyIsolated();
  console.log('build:bundle OK — dist/engine.bundle.js is self-contained and adjudicates correctly.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
