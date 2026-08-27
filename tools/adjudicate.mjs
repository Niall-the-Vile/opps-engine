#!/usr/bin/env node
// tools/adjudicate.mjs — U19a CLI runner (spec §13.1, §13.2).
//
// A human types codes (or points at an XML feed file) and reads an
// adjudication. This is the first unit whose output a non-programmer looks
// at, so legibility of the printed result is a functional requirement, not
// polish (see the OUTPUT FORMATTING section below for the ASCII-only call).
//
// USAGE
//   node tools/adjudicate.mjs 36415 84112
//   node tools/adjudicate.mjs "G0378x8 99284"
//   node tools/adjudicate.mjs --file test/fixtures/inst-xml-inpatient-cah-revonly.xml
//   node tools/adjudicate.mjs --dos 20260115 G0463 84112
//   node tools/adjudicate.mjs --why 36415 84112          # full trace per line
//   node tools/adjudicate.mjs --why=84112 36415 84112    # trace for one code
//   node tools/adjudicate.mjs --json 36415               # raw Result, for piping
//   node tools/adjudicate.mjs --help
//
// CODE-LIST SYNTAX — see src/adapters/codeList.ts's CODE_LIST_SYNTAX
// constant, printed verbatim by --help below so the two never drift apart.
//
// ---------------------------------------------------------------------------
// THE TYPESCRIPT LOADER PROBLEM, AND WHAT WAS TRIED
//
// This engine's source (src/**/*.ts) is written throughout with `.js`
// import specifiers pointing at sibling `.ts` files — e.g.
// `import ... from './types.js'` where only `types.ts` exists on disk. That
// is a normal, deliberate TypeScript convention (moduleResolution:
// "Bundler" in tsconfig.json) but it means no plain Node loader can resolve
// the module graph as-is:
//
//   - `node --experimental-strip-types` DOES strip TS syntax from a single
//     file, but its module resolution is plain Node resolution: it will
//     NOT remap a `./x.js` specifier to a sibling `x.ts` file. Tried first
//     (see the final report); fails immediately with "Cannot find module
//     '.../dsl/validate.js'" trying to load src/index.ts.
//   - Adding a new dependency (tsx, ts-node, etc.) is explicitly out of
//     scope for this unit ("do not add a runtime dependency").
//
// What IS already installed, as a dependency of `vitest` (devDependency,
// package.json) rather than a new addition: `vite-node`
// (node_modules/vite-node), the same TS/ESM runtime `npx vitest run`
// already uses under the hood to execute every `test/*.test.ts` file
// against this exact `.js`-importing-`.ts` source tree. Its bin entry
// (node_modules/vite-node/vite-node.mjs) is a plain Node script — no shell
// wrapper, no OS-specific `.cmd` shim to resolve — so this file re-execs
// itself through it via `spawnSync`, once, and only when NOT already
// running inside that vite-node process (the OPPS_CLI_VIA_VITE_NODE env
// var marks that). The relaunch happens *before* any `import` of engine
// source: ESM `import` declarations are hoisted and resolved before a
// module's body runs, so a plain top-level `import '../src/index.js'`
// would fail under plain `node` before the relaunch logic ever got a
// chance to run. The engine imports below are therefore dynamic
// (`await import(...)`), which — unlike static imports — execute in
// program order, after the relaunch gate, and they use the real `.ts`
// extension directly (`../src/index.ts`, not `.js`): that sidesteps
// needing Vite's own `.js`-import-resolves-to-`.ts` behavior (which,
// tested directly against this repo's plain `vite-node` CLI with no
// vite.config.*, does NOT fire — only vitest's fuller config makes that
// resolution work) and is available with zero extra configuration, exactly
// as verified against this checkout during development.
// ---------------------------------------------------------------------------

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

if (process.env.OPPS_CLI_VIA_VITE_NODE !== '1') {
  const viteNodeEntry = path.join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
  if (!existsSync(viteNodeEntry)) {
    console.error(
      'error: node_modules/vite-node not found (it ships as a dependency of the vitest devDependency).\n' +
        'Run `npm install` first. See this file\'s header for why a TS loader is needed at all.',
    );
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [viteNodeEntry, __filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, OPPS_CLI_VIA_VITE_NODE: '1' },
  });
  process.exit(result.status === null ? 1 : result.status);
}

// ===========================================================================
// From here on, we are running inside vite-node: `.ts` specifiers resolve.
// ===========================================================================

const { adjudicate } = await import('../src/index.ts');
const { parseCodeList, CODE_LIST_SYNTAX } = await import('../src/adapters/codeList.ts');
const { parseInstitutionalXml } = await import('../src/adapters/instXml.ts');

// ---------------------------------------------------------------------------
// CLI argument parsing.
// ---------------------------------------------------------------------------

class CliUsageError extends Error {}

function parseArgs(argv) {
  const out = { help: false, json: false, why: false, whyFilter: null, file: null, dos: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    if (a === '--json') {
      out.json = true;
      continue;
    }
    if (a === '--why') {
      out.why = true;
      continue;
    }
    if (a.startsWith('--why=')) {
      out.why = true;
      out.whyFilter = a.slice('--why='.length);
      continue;
    }
    if (a === '--file') {
      const v = argv[i + 1];
      if (v === undefined) throw new CliUsageError('--file requires a path argument');
      out.file = v;
      i++;
      continue;
    }
    if (a.startsWith('--file=')) {
      out.file = a.slice('--file='.length);
      continue;
    }
    if (a === '--dos') {
      const v = argv[i + 1];
      if (v === undefined) throw new CliUsageError('--dos requires a YYYYMMDD argument');
      out.dos = v;
      i++;
      continue;
    }
    if (a.startsWith('--dos=')) {
      out.dos = a.slice('--dos='.length);
      continue;
    }
    if (a.startsWith('--')) throw new CliUsageError(`unrecognized option ${JSON.stringify(a)} (see --help)`);
    out.positional.push(a);
  }
  return out;
}

const HELP = `opps-engine adjudicate CLI (U19a)

USAGE
  node tools/adjudicate.mjs [CODE ...]
  node tools/adjudicate.mjs "CODE CODE ..."
  node tools/adjudicate.mjs --file <path.xml>
  node tools/adjudicate.mjs --dos YYYYMMDD [CODE ...]
  node tools/adjudicate.mjs --why [CODE ...]
  node tools/adjudicate.mjs --why=CODE [CODE ...]
  node tools/adjudicate.mjs --json [CODE ...]
  node tools/adjudicate.mjs --help

CODE-LIST SYNTAX
  ${CODE_LIST_SYNTAX.split('\n').join('\n  ')}

  A bare code list carries no form type, no bill type, no dates — the
  engine's §8.0 gate would reject every paste as NOT_OPPS without them, so
  this CLI SYNTHESIZES a minimal in-scope claim (institutional, bill type
  131, one line per token) and prints exactly what it assumed, above the
  results, every time. That line is not part of your input — read it.

OPTIONS
  --file <path>     Read an institutional XML claim feed instead of parsing
                     a code list (src/adapters/instXml.ts). Ignores --dos —
                     dates come from the feed.
  --dos YYYYMMDD    Date of service for a code-list claim. Default: the
                     loaded data vintage's effective date (never the clock —
                     the engine has no clock access, §2.4).
  --why             Print the full rule trace for every line: each rule's
                     id, outcome, and citation, plus the resolved
                     counterfactual for every NOT_FIRED rule.
  --why=CODE        Same, restricted to lines whose code matches CODE.
  --json            Print the engine's raw Result as JSON, for piping.
                     Suppresses all other output.
  -h, --help        Print this message.

EXAMPLES
  node tools/adjudicate.mjs 36415 84112
  node tools/adjudicate.mjs "G0378x8 99284"
  node tools/adjudicate.mjs --file test/fixtures/inst-xml-inpatient-cah-revonly.xml
  node tools/adjudicate.mjs --dos 20260115 G0463 84112
  node tools/adjudicate.mjs --why 36415 84112
  node tools/adjudicate.mjs --why=84112 36415 84112
  node tools/adjudicate.mjs --json 36415
`;

// ---------------------------------------------------------------------------
// Small formatting helpers. Plain ASCII throughout, no colour codes — this
// output gets pasted into email (spec's own instruction). The spec's
// illustrative example uses "—" (em dash) and "·" (middle dot); those are
// not ASCII, so this CLI substitutes "-" and "|" respectively, keeping the
// same information layout. Noted here, and in the final report, as a
// deliberate reading of "Plain ASCII" as literal.
// ---------------------------------------------------------------------------

const DASH = '-';

function cell(v) {
  return v === null || v === undefined || v === '' ? DASH : String(v);
}

function padRight(s, n) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printTable(rows, columns) {
  const widths = columns.map((c) => Math.max(c.header.length, ...rows.map((r) => String(r[c.key]).length)) + 2);
  const headerLine = columns.map((c, i) => padRight(c.header, widths[i])).join('').trimEnd();
  console.log(headerLine);
  for (const r of rows) {
    console.log(columns.map((c, i) => padRight(String(r[c.key]), widths[i])).join('').trimEnd());
  }
}

// ---------------------------------------------------------------------------
// EngineError formatting (§12.7).
// ---------------------------------------------------------------------------

function isEngineError(e) {
  return typeof e === 'object' && e !== null && e.name === 'EngineError';
}

function printEngineError(e) {
  console.error(`ENGINE ERROR [${e.code}] at ${e.path}${e.claimId !== null ? ` (claim ${e.claimId})` : ''}: ${e.detail}`);
}

// ---------------------------------------------------------------------------
// Applicability (§8.0, §8.0.2) — the out-of-scope path. Leads, never an
// empty table.
// ---------------------------------------------------------------------------

function printNotOpps(applicability, lineCount, claimId, showClaimHeader) {
  if (showClaimHeader) console.log(`=== claim ${claimId} ===`);
  console.log(`NOT AN OPPS CLAIM  ${DASH}  gate: ${applicability.gate}`);
  console.log(`  likely system: ${applicability.likelySystem} (${applicability.confidence})`);
  if (applicability.evidence.length > 0) {
    console.log('  evidence:');
    for (const e of applicability.evidence) console.log(`    - ${e}`);
  } else {
    console.log(`  reason: ${applicability.detail}`);
  }
  console.log(`  ${lineCount} line${lineCount === 1 ? '' : 's'} not adjudicated.`);
}

// ---------------------------------------------------------------------------
// In-scope path: table + summary + always-surfaced flags (§10.4, §5.3a).
// ---------------------------------------------------------------------------

function printInScope(result, claimId, showClaimHeader) {
  if (showClaimHeader) console.log(`=== claim ${claimId} ===`);

  const displayIndexByLineId = new Map(result.determinations.map((d, i) => [d.lineId, i + 1]));

  // §5.1's line echo (U19b) makes `d.line.units` available here for the
  // first time. Shown only when at least one line carries units other than
  // '1' — a column of 1s is noise, and a hidden x8 is a bug waiting to
  // happen (build brief).
  const showUnits = result.determinations.some((d) => d.line.units !== '1');

  const rows = result.determinations.map((d, i) => ({
    LINE: i + 1,
    CODE: cell(d.code),
    UNITS: cell(d.line.units),
    SI: cell(d.resolvedSI),
    STATUS: d.status,
    UNDER: d.bundledUnder === null ? DASH : cell(displayIndexByLineId.get(d.bundledUnder) ?? d.bundledUnder),
    BASIS: d.basis === 'NONE' ? DASH : d.basis,
  }));

  const columns = [
    { key: 'LINE', header: 'LINE' },
    { key: 'CODE', header: 'CODE' },
    ...(showUnits ? [{ key: 'UNITS', header: 'UNITS' }] : []),
    { key: 'SI', header: 'SI' },
    { key: 'STATUS', header: 'STATUS' },
    { key: 'UNDER', header: 'UNDER' },
    { key: 'BASIS', header: 'BASIS' },
  ];

  printTable(rows, columns);

  const statusCounts = new Map();
  for (const d of result.determinations) statusCounts.set(d.status, (statusCounts.get(d.status) ?? 0) + 1);
  const flaggedCount = result.determinations.filter((d) => d.flags.length > 0).length;
  const summaryParts = [...statusCounts.entries()].map(([status, n]) => `${n} ${status}`);
  summaryParts.push(`${flaggedCount} FLAGGED`);
  console.log('');
  console.log(summaryParts.join(' | '));

  if (result.engineStatus === 'PARTIAL') {
    console.log('NOTE: engine reported PARTIAL — at least one line faulted (see FLAGS below).');
  }

  printAlwaysFlags(result);
}

/**
 * Always print `OPPS.EXEMPT.UNVERIFIED_POLICY` and every `gap`-severity
 * flag, regardless of --why (spec: "the whole point of the trace... must
 * not be buried below the table"). Scans both per-line flags and
 * claim-level disclosures.
 */
function printAlwaysFlags(result) {
  const notable = [];
  for (const d of result.determinations) {
    for (const f of d.flags) {
      if (f.code === 'OPPS.EXEMPT.UNVERIFIED_POLICY' || f.severity === 'gap') {
        notable.push({ where: `line ${d.lineId} (${d.code || 'no code'})`, flag: f });
      }
    }
  }
  for (const f of result.disclosures) {
    if (f.code === 'OPPS.EXEMPT.UNVERIFIED_POLICY' || f.severity === 'gap') {
      notable.push({ where: 'claim', flag: f });
    }
  }
  if (notable.length === 0) return;
  console.log('');
  console.log('FLAGS:');
  for (const n of notable) {
    const cite = n.flag.citation !== null ? ` (${n.flag.citation})` : '';
    console.log(`  [${n.flag.severity}] ${n.where}: ${n.flag.message}${cite}`);
  }
}

// ---------------------------------------------------------------------------
// --why / --why=CODE: full trace per line (§5.2, §5.3a).
// ---------------------------------------------------------------------------

function resolveCounterfactualLoud(result, ev) {
  if (ev.counterfactualRef !== null) {
    const text = result.counterfactuals[ev.counterfactualRef];
    if (text !== undefined) return text;
    return `!! BUG: counterfactualRef "${ev.counterfactualRef}" has no entry in Result.counterfactuals !!`;
  }
  if (ev.counterfactual !== null) return ev.counterfactual;
  return '!! BUG: NOT_FIRED with no counterfactual recorded (see §5.3a) !!';
}

function printWhy(result, whyFilter) {
  const targets = whyFilter === null ? result.determinations : result.determinations.filter((d) => d.code === whyFilter);
  if (targets.length === 0) {
    console.log('');
    console.log(`(--why=${whyFilter}: no line on this claim carries that code)`);
    return;
  }
  const displayIndexByLineId = new Map(result.determinations.map((d, i) => [d.lineId, i + 1]));
  for (const d of targets) {
    console.log('');
    console.log(`LINE ${displayIndexByLineId.get(d.lineId)}  ${d.code || '(no code)'}  ${d.status}`);
    if (d.trace.length === 0) {
      console.log('  (no rule trace recorded for this line)');
      continue;
    }
    const trace = [...d.trace].sort((a, b) => a.band - b.band || a.order - b.order);
    for (const ev of trace) {
      console.log(`  ${ev.ruleId}  ${ev.outcome}  ${ev.citation}`);
      if (ev.outcome === 'NOT_FIRED') {
        console.log(`      counterfactual: ${resolveCounterfactualLoud(result, ev)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function readClaims(args) {
  if (args.file !== null) {
    if (args.dos !== null) {
      console.error('note: --dos is ignored with --file — dates come from the feed.');
    }
    const xml = readFileSync(args.file, 'utf8');
    const parsed = parseInstitutionalXml(xml);
    return parsed.map((p) => ({ claim: p.claim, flags: p.flags }));
  }
  const input = args.positional.join(' ');
  if (input.trim() === '') {
    throw new CliUsageError('no codes given (and no --file) — see --help');
  }
  const options = args.dos !== null ? { dos: args.dos } : {};
  const parsed = parseCodeList(input, options);
  return [parsed];
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  let claims;
  try {
    claims = readClaims(args);
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
    if (isEngineError(err)) {
      printEngineError(err);
      process.exit(1);
    }
    if (err instanceof Error && err.code === 'ENOENT') {
      console.error(`error: cannot read file ${JSON.stringify(args.file)}: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const jsonOut = [];
  const showClaimHeader = claims.length > 1;
  let sawError = false;

  for (const { claim, flags } of claims) {
    let result;
    try {
      result = adjudicate({ claim });
    } catch (err) {
      if (isEngineError(err)) {
        printEngineError(err);
        sawError = true;
        continue;
      }
      throw err;
    }

    if (args.json) {
      jsonOut.push(result);
      continue;
    }

    if (showClaimHeader && jsonOut.length === 0) console.log('');

    // §10.4 — every synthesized/assumed field, printed above the results.
    for (const f of flags) {
      if (f.severity === 'assumption') console.log(`ASSUMED: ${f.message}`);
    }
    for (const f of flags) {
      if (f.severity !== 'assumption') console.log(`NOTE [${f.severity}]: ${f.message}`);
    }

    if (result.applicability !== null) {
      printNotOpps(result.applicability, claim.lines.length, claim.claimId, showClaimHeader);
    } else {
      printInScope(result, claim.claimId, showClaimHeader);
      if (args.why) printWhy(result, args.whyFilter);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(jsonOut.length === 1 ? jsonOut[0] : jsonOut, null, 2));
  }

  process.exit(sawError ? 1 : 0);
}

main();
