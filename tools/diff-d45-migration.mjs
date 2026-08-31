#!/usr/bin/env node
// tools/diff-d45-migration.mjs — D45 migration behaviour-neutrality proof
// (docs/BUILD_LOG.md D45; spec §4.3's "this costs nothing behaviourally").
//
// D45 moves claim-relational predicates (statusIn, isExempt, isHighestBy,
// ...) out of 21 rules' `scope` and into `when`. The spec asserts that move
// is behaviourally inert — `when` is read against the identical frozen
// epoch snapshot `scope` is (dsl/evaluate.ts's `scopeCtx`), so a predicate
// that gated firing from one position gates it identically from the other.
// This tool is how that assertion gets checked empirically rather than
// trusted: run the corpus (tools/lib/d45-corpus.mjs) BEFORE the migration,
// save it; run it again AFTER; diff. Any difference in `status`,
// `disposition`, `bundledUnder`, `basis`, `effectiveSI`, or a line's flag
// codes is a real behaviour change, not a refactor, and this tool reports it
// as such rather than silently accepting it.
//
// USAGE
//   node tools/diff-d45-migration.mjs --save baseline.json     # capture current adjudication output
//   node tools/diff-d45-migration.mjs --diff baseline.json     # re-run and diff against a saved capture
//
// Mirrors tools/adjudicate.mjs's/tools/lint-registry.mjs's own vite-node
// relaunch (see either file's header for the full explanation of why a
// plain `node` cannot load this repo's `.js`-importing-`.ts` source tree).
// ---------------------------------------------------------------------------

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

if (process.env.OPPS_CLI_VIA_VITE_NODE !== '1') {
  const viteNodeEntry = path.join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
  if (!existsSync(viteNodeEntry)) {
    console.error('error: node_modules/vite-node not found. Run `npm install` first.');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [viteNodeEntry, __filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, OPPS_CLI_VIA_VITE_NODE: '1' },
  });
  process.exit(result.status === null ? 1 : result.status);
}

// ===========================================================================
// From here on, running inside vite-node: `.ts` specifiers resolve.
// ===========================================================================

const { adjudicate } = await import('../src/index.ts');
const { parseCodeList } = await import('../src/adapters/codeList.ts');
const { parseInstitutionalXml } = await import('../src/adapters/instXml.ts');
const { fullCorpus } = await import('./lib/d45-corpus.mjs');

// ---------------------------------------------------------------------------
// Build every corpus claim into a runnable `{claimLabel, claim}` list.
// ---------------------------------------------------------------------------

function buildClaims() {
  const out = [];
  for (const entry of fullCorpus()) {
    if (entry.xmlFixture !== undefined) {
      const xmlPath = path.join(ROOT, 'test', 'fixtures', entry.xmlFixture);
      const xml = readFileSync(xmlPath, 'utf8');
      const parsed = parseInstitutionalXml(xml);
      parsed.forEach((p, i) => {
        out.push({ claimLabel: parsed.length > 1 ? `${entry.id}#${i}` : entry.id, claim: p.claim });
      });
      continue;
    }
    const options = entry.dos !== undefined ? { dos: entry.dos } : {};
    const parsed = parseCodeList(entry.codes, options);
    out.push({ claimLabel: entry.id, claim: parsed.claim });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reduced comparison view — exactly the fields the task's behaviour-
// neutrality proof is about (status/disposition/bundledUnder/basis/
// effectiveSI/flag codes), kept separate from a full trace digest so a
// legitimate trace-shape shift (ordering, epoch labels — §4.3's own
// disclosed side effect of moving a predicate's evaluation point) never
// gets confused with an outcome change.
// ---------------------------------------------------------------------------

function reduceResult(result) {
  if (result.applicability !== null) {
    return {
      applicability: {
        gate: result.applicability.gate,
        likelySystem: result.applicability.likelySystem,
        confidence: result.applicability.confidence,
      },
    };
  }
  return {
    engineStatus: result.engineStatus,
    claimFlagCodes: [...result.disclosures.map((f) => f.code)].sort(),
    lines: result.determinations.map((d) => ({
      lineId: d.lineId,
      code: d.code,
      resolvedSI: d.resolvedSI,
      effectiveSI: d.effectiveSI,
      status: d.status,
      disposition: d.disposition,
      bundledUnder: d.bundledUnder,
      basis: d.basis,
      flagCodes: [...d.flags.map((f) => f.code)].sort(),
    })),
  };
}

/** A coarse trace-shape signature — outcome counts and fired-rule-id sets per line — kept only to REPORT shifts as informational, never to fail the comparison (epoch/order/trace-row-count movement is expected and disclosed, spec §4.3). */
function traceSignature(result) {
  if (result.applicability !== null) return null;
  return result.determinations.map((d) => ({
    lineId: d.lineId,
    outcomeCounts: countBy(d.trace, (ev) => ev.outcome),
    firedRuleIds: [...d.trace.filter((ev) => ev.outcome === 'FIRED').map((ev) => ev.ruleId)].sort(),
  }));
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const k = keyFn(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function runCorpus() {
  const claims = buildClaims();
  const digest = {};
  const traceDigest = {};
  for (const { claimLabel, claim } of claims) {
    const result = adjudicate({ claim });
    digest[claimLabel] = reduceResult(result);
    traceDigest[claimLabel] = traceSignature(result);
  }
  return { digest, traceDigest, claimCount: claims.length };
}

// ---------------------------------------------------------------------------
// Diff.
// ---------------------------------------------------------------------------

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffDigests(before, after) {
  const outcomeDiffs = [];
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of [...ids].sort()) {
    const b = before[id];
    const a = after[id];
    if (b === undefined || a === undefined) {
      outcomeDiffs.push({ claim: id, kind: 'CLAIM_SET_CHANGED', before: b, after: a });
      continue;
    }
    if (!deepEqual(b, a)) {
      outcomeDiffs.push({ claim: id, kind: 'OUTCOME_DIFF', before: b, after: a });
    }
  }
  return outcomeDiffs;
}

function diffTraceSignatures(before, after) {
  const shifts = [];
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of [...ids].sort()) {
    const b = before[id];
    const a = after[id];
    if (b === undefined || a === undefined) continue;
    if (!deepEqual(b, a)) shifts.push({ claim: id, before: b, after: a });
  }
  return shifts;
}

function main() {
  const args = process.argv.slice(2);
  const saveIdx = args.indexOf('--save');
  const diffIdx = args.indexOf('--diff');

  if (saveIdx !== -1) {
    const outPath = args[saveIdx + 1];
    if (outPath === undefined) {
      console.error('error: --save requires a file path');
      process.exit(1);
    }
    const { digest, traceDigest, claimCount } = runCorpus();
    writeFileSync(outPath, JSON.stringify({ claimCount, digest, traceDigest }, null, 2));
    console.log(`saved ${claimCount} claim(s) to ${outPath}`);
    return;
  }

  if (diffIdx !== -1) {
    const basePath = args[diffIdx + 1];
    if (basePath === undefined) {
      console.error('error: --diff requires a file path');
      process.exit(1);
    }
    const baseline = JSON.parse(readFileSync(basePath, 'utf8'));
    const current = runCorpus();

    console.log(`comparing ${baseline.claimCount} baseline claim(s) against ${current.claimCount} current claim(s)`);

    const outcomeDiffs = diffDigests(baseline.digest, current.digest);
    const traceShifts = diffTraceSignatures(baseline.traceDigest, current.traceDigest);

    console.log('');
    console.log(`OUTCOME DIFFERENCES (status/disposition/bundledUnder/basis/effectiveSI/flags): ${outcomeDiffs.length}`);
    for (const d of outcomeDiffs) {
      console.log(`  [${d.kind}] ${d.claim}`);
      console.log(`    before: ${JSON.stringify(d.before)}`);
      console.log(`    after:  ${JSON.stringify(d.after)}`);
    }

    console.log('');
    console.log(`TRACE-SHAPE SHIFTS (outcome counts / fired-rule-ids per line — informational, not a failure): ${traceShifts.length}`);
    for (const s of traceShifts) {
      console.log(`  ${s.claim}`);
      console.log(`    before: ${JSON.stringify(s.before)}`);
      console.log(`    after:  ${JSON.stringify(s.after)}`);
    }

    if (outcomeDiffs.length > 0) {
      console.log('');
      console.log(`FAIL: ${outcomeDiffs.length} outcome difference(s) found — see above. Investigate each one.`);
      process.exit(1);
    }
    console.log('');
    console.log(`PASS: 0 outcome differences across ${current.claimCount} claims.`);
    return;
  }

  console.error('usage: node tools/diff-d45-migration.mjs --save <file> | --diff <file>');
  process.exit(1);
}

main();
