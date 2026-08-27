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

// U19c — --why's human-readable rewrite needs two things the engine's
// per-line trace does not itself carry: a rule's authored `note` (only
// `registry/*.json` has it — `Result`/`Determination` never do, by design;
// see src/inspect.ts's header on why `explain()` does not surface it
// either), and each condition operator's own `describe()`, used to build a
// short, mechanics-free reason for a NOT_FIRED rule instead of dumping its
// raw counterfactual string. Both are read-only imports of data the engine
// already loads for `adjudicate()` itself (`src/index.ts`'s own
// `BUNDLED_REGISTRY`, reconstructed here the same way since it is not
// exported) — nothing about adjudication changes; this is presentation
// reaching one layer deeper for material that already exists.
const { EXEMPT_RULES, PACKAGING_RULES, DISPOSITION_RULES } = await import('../src/registry/index.ts');
const { loadRegistry } = await import('../src/registry/loader.ts');
const { operators } = await import('../src/dsl/operators.ts');

const REGISTRY_RULES = loadRegistry([...EXEMPT_RULES, ...PACKAGING_RULES, ...DISPOSITION_RULES]);
const RULES_BY_ID = new Map(REGISTRY_RULES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// CLI argument parsing.
// ---------------------------------------------------------------------------

class CliUsageError extends Error {}

function parseArgs(argv) {
  const out = { help: false, json: false, why: false, whyVerbose: false, whyFilter: null, file: null, dos: null, positional: [] };
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
    if (a === '--why-verbose') {
      out.why = true;
      out.whyVerbose = true;
      continue;
    }
    if (a.startsWith('--why-verbose=')) {
      out.why = true;
      out.whyVerbose = true;
      out.whyFilter = a.slice('--why-verbose='.length);
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
  node tools/adjudicate.mjs --why-verbose [CODE ...]
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
  --why             Print, for every line, why it ended up where it did: the
                     rule that decided it (its note, or its condition when
                     it has none), and a short reason for every other rule
                     that was considered and did not apply. Rules no line's
                     data could ever satisfy (no source loaded for them) are
                     listed once at the end, not repeated per line.
  --why=CODE        Same, restricted to lines whose code matches CODE.
  --why-verbose     Same as --why, plus the full resolved counterfactual
                     text for every rule that did not apply — the auditable
                     long form, kept available but out of the way by default.
  --why-verbose=CODE  Same, restricted to lines whose code matches CODE.
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
// --why / --why=CODE / --why-verbose (U19c, spec §5.2, §5.3a).
//
// Restructured for a human reading the printed page (not a developer
// reading the trace journal): lead with the decision and the rule that
// caused it, in that rule's own `note` — the human sentence the registry
// already carries but the old flat trace dump never surfaced — demote the
// rule id/citation to a dim reference line under it, and compress every
// rule that was considered but did not fire to a short reason instead of
// its raw counterfactual (still available in full behind --why-verbose,
// so the auditable long form is never actually lost, just out of the way
// by default). The three reserved data-gap rules (NCCI PTP, MUE, DELETED)
// fire the identical NOT_EVALUATED trace entry on every line — see their
// own `scope: {always: {}}` in src/registry/opps.dispositions.json — so
// they are hoisted out of the per-line blocks and printed once, after all
// of them, instead of repeating verbatim on every LINE.
// ---------------------------------------------------------------------------

const WRAP_WIDTH = 76;

function resolveCounterfactualLoud(result, ev) {
  if (ev.counterfactualRef !== null) {
    const text = result.counterfactuals[ev.counterfactualRef];
    if (text !== undefined) return text;
    return `!! BUG: counterfactualRef "${ev.counterfactualRef}" has no entry in Result.counterfactuals !!`;
  }
  if (ev.counterfactual !== null) return ev.counterfactual;
  return '!! BUG: NOT_FIRED with no counterfactual recorded (see §5.3a) !!';
}

/** Plain word-wrap, indenting every line — the only formatting tool this ASCII, no-colour output has available (see file header). */
function wrapText(text, indent, width = WRAP_WIDTH) {
  const words = String(text).split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return indent;
  const lines = [];
  let cur = words[0];
  for (const w of words.slice(1)) {
    const candidate = `${cur} ${w}`;
    if (indent.length + candidate.length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  lines.push(cur);
  return lines.map((l) => `${indent}${l}`).join('\n');
}

function joinOr(items) {
  if (items.length === 0) return '(nothing)';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

/** describe() straight from the operator that owns `node.op` — never hand-written prose (§4.4), so a fallback string here is always grounded in the registry's own condition, not invented. */
function describeOp(node) {
  const op = operators[node.op];
  if (op === undefined) return `(unknown operator "${node.op}")`;
  try {
    return op.describe(node.args);
  } catch (err) {
    return `(could not describe "${node.op}": ${err instanceof Error ? err.message : String(err)})`;
  }
}

/**
 * An `isHighestBy`/`ordinalAtLeast`-family "among" predicate almost always
 * wraps a plain SI/code selector together with a `not(statusIn(BUNDLED))`
 * guard that exists purely so an already-bundled line can't rank as its own
 * bundling target (§4.3) — implementation mechanics, not a reason a reader
 * needs (build brief problem #5). Strips exactly that guard pattern and
 * nothing else; anything not recognized is left as `describeOp` would
 * render it, in full, rather than silently dropped.
 */
function isBundledGuard(node) {
  return (
    node.op === 'not' &&
    node.args !== null &&
    typeof node.args === 'object' &&
    node.args.child !== undefined &&
    node.args.child.op === 'statusIn' &&
    Array.isArray(node.args.child.args?.status) &&
    node.args.child.args.status.includes('BUNDLED')
  );
}

function rankGroupPhrase(among) {
  if (among.op === 'allOf' && Array.isArray(among.args?.children)) {
    const kept = among.args.children.filter((c) => !isBundledGuard(c));
    if (kept.length === 0) return 'this claim';
    return kept.map((c) => (c.op === 'siIn' ? joinOr(c.args.si) : describeOp(c))).join(' and ');
  }
  return among.op === 'siIn' ? joinOr(among.args.si) : describeOp(among);
}

/**
 * The short, reader-facing version of one leaf condition that evaluated
 * false — every phrase here is a direct restatement of that leaf's own
 * `op`/`args` (the same data `describe()` reads), just without the
 * templated "the claim also contains a line with..." scaffolding §4.4's
 * generated prose carries. An operator this table does not special-case
 * falls back to `describeOp` verbatim — still true, just not shortened.
 */
function shortLeaf(node) {
  const a = node.args ?? {};
  switch (node.op) {
    case 'claimContainsAny':
      return a.si !== undefined ? `no ${joinOr(a.si)} line on this claim` : a.code !== undefined ? `no ${joinOr(a.code)} on this claim` : describeOp(node);
    case 'claimContainsNone':
      return a.si !== undefined
        ? `this claim already has a ${joinOr(a.si)} line`
        : a.code !== undefined
          ? `this claim already has a ${joinOr(a.code)} line`
          : describeOp(node);
    case 'claimContainsCode':
      return `no ${a.code} on this claim`;
    case 'claimUnitsAtLeast':
      return `${a.code !== undefined ? a.code : joinOr(a.si ?? [])} units under ${a.units}`;
    case 'claimLineCountAtLeast':
      return `fewer than ${a.count} ${a.code !== undefined ? `lines coded ${a.code}` : a.si !== undefined ? `${joinOr(a.si)} lines` : 'lines'} on this claim`;
    case 'siIn':
      return `status indicator isn't ${joinOr(a.si)}`;
    case 'siIs':
      return `status indicator isn't ${a.si}`;
    case 'codeIn':
      return `code isn't ${joinOr(a.code)}`;
    case 'codePattern':
      return `code doesn't match "${a.pattern}"`;
    case 'apcIn':
      return `APC isn't ${joinOr(a.apc)}`;
    case 'inSchedule':
      return `not on the ${joinOr(a.schedule)} fee schedule`;
    case 'statusIn':
      return `line status isn't ${joinOr(a.status)}`;
    case 'isExempt':
      return `line isn't on the exempt set`;
    case 'hasModifier':
      return `missing modifier ${a.modifier}`;
    case 'unitsAtLeast':
      return `line has fewer than ${a.units} units`;
    case 'hasRate':
      return `line carries no rate`;
    case 'hasWeight':
      return `line carries no weight`;
    case 'optionIs':
      return `option "${a.option}" isn't ${JSON.stringify(a.equals)}`;
    case 'optionAtLeast':
      return `option "${a.option}" is under ${a.atLeast}`;
    case 'optionUnknown':
      return `option "${a.option}" was supplied`;
    case 'dosOnOrAfter':
      return `date of service is before ${a.date}`;
    case 'dosBefore':
      return `date of service is on or after ${a.date}`;
    case 'isHighestBy':
      return `not the top-ranked line by ${a.field} among ${rankGroupPhrase(a.among)}`;
    case 'isNotHighestBy':
      return `is the top-ranked line by ${a.field} among ${rankGroupPhrase(a.among)}`;
    case 'ordinalIs':
      return `rank by ${a.field} among ${rankGroupPhrase(a.among)} isn't ${a.equals}`;
    case 'ordinalAtLeast':
      return `rank by ${a.field} among ${rankGroupPhrase(a.among)} is under ${a.atLeast}`;
    case 'not': {
      // A `not(inner)` requirement evaluating false means `inner` is true —
      // the blocking fact is `inner` itself, stated plainly (no double
      // negative), still sourced from that inner node's own describe().
      const inner = a.child;
      if (inner === undefined) return describeOp(node);
      if (inner.op === 'statusIn') return `line status is already ${joinOr(inner.args.status)}`;
      if (inner.op === 'isExempt') return `line is on the exempt set`;
      return describeOp(inner);
    }
    default:
      return describeOp(node);
  }
}

/**
 * The short reason a NOT_FIRED rule's `when` did not hold. For a top-level
 * `allOf`/`anyOf`, uses `examined.detail.childResults` — the same
 * per-child true/false array `dsl/operators.ts`'s own `allOf`/`anyOf`
 * `evaluate()` already records (see that file) — to name only the
 * conjuncts that actually failed, rather than restating every condition
 * the rule checks regardless of which one blocked it. No re-evaluation
 * against the claim happens here; this reads data the engine already
 * produced.
 */
function shortReason(predicate, detail) {
  if ((predicate.op === 'allOf' || predicate.op === 'anyOf') && Array.isArray(detail?.childResults) && Array.isArray(predicate.args?.children)) {
    const children = predicate.args.children;
    const blocking = detail.childResults.map((fired, i) => (fired === false ? children[i] : null)).filter((c) => c !== null && c !== undefined);
    if (blocking.length > 0) return blocking.map(shortLeaf).join('; ');
  }
  return shortLeaf(predicate);
}

function shortReasonForEvaluation(ev) {
  if (ev.outcome === 'NOT_FIRED') return shortReason(ev.predicate, ev.examined.detail);
  if (ev.outcome === 'SKIPPED') return ev.counterfactual ?? '(skipped)';
  if (ev.outcome === 'ERRORED') return '(this rule faulted during evaluation -- see FLAGS above)';
  return '(no reason on record)';
}

function underLinePhrase(d, result, displayIndexByLineId) {
  if (d.bundledUnder === null) return '';
  return ` under ${lineRefText(d.bundledUnder, result, displayIndexByLineId)}`;
}

/** `line N (CODE)` for a lineId — the one concrete-line naming format used throughout `--why` output (line headers, bundle targets, fired-condition clauses). `?` only when the lineId names no determination on record (should not happen; defensive, not invented). */
function lineRefText(lineId, result, displayIndexByLineId) {
  const idx = displayIndexByLineId.get(lineId) ?? lineId;
  const det = result.determinations.find((x) => x.lineId === lineId);
  const code = det !== undefined ? det.code || '(no code)' : '?';
  return `line ${idx} (${code})`;
}

function joinAnd(items) {
  if (items.length === 0) return '(nothing)';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// U19d — generating the WHY sentence for a FIRED rule, instead of printing
// its authored `note` (developer rationale — see this file's header note on
// `note` for why it moves to --why-verbose's RULE RATIONALE instead). Every
// clause below is built from the same three sources the rest of --why
// already draws from: an operator's own `describe()`/`argSpec()`, the
// evaluation's own `examined` (its `factRefs`, resolved to the `Fact`s the
// interpreter already recorded, and its `ordinal` for rank operators), and
// the determination (`d.bundledUnder`, other lines' `result.determinations`
// entries). Nothing here is hand-authored prose about what a rule means —
// only mechanical assembly of data the engine already produced.
// ---------------------------------------------------------------------------

/** `{epoch -> {factId -> Fact}}`, built once per `--why` call — the same resolution `src/inspect.ts#explain()` does for its `factsRead`, reimplemented locally (this file already reads registry/operator internals directly rather than importing `inspect.ts`; see the U19c header comment above `RULES_BY_ID`). */
function buildFactsIndex(facts) {
  const out = new Map();
  for (const epoch of Object.keys(facts ?? {})) {
    out.set(epoch, new Map((facts[epoch] ?? []).map((f) => [f.factId, f])));
  }
  return out;
}

/**
 * `ev.examined.factRefs` resolved to the actual `Fact` objects, silently
 * dropping any ref with no matching entry rather than throwing (unlike
 * `inspect.ts#explain()`'s hard-error policy for the same lookup): a rank
 * operator's (`ordinalAtLeast`/`isHighestBy`/`isNotHighestBy`/`ordinalIs`)
 * factRefs were found, during this unit's work, to name a fact
 * (`<epoch>:rank:<field>#<n>`) that `Result.facts` never actually carries —
 * an engine/trace gap out of this presentation-only unit's file scope (see
 * final report). Concretizing those operators here instead reads
 * `examined.ordinal`, which IS populated correctly, so this function's
 * empty-array result for them is expected, not a symptom to chase.
 */
function resolveFactsRead(ev, factsIndex) {
  const byId = factsIndex.get(ev.epoch);
  if (byId === undefined) return [];
  const out = [];
  for (const ref of ev.examined?.factRefs ?? []) {
    const f = byId.get(ref);
    if (f !== undefined) out.push(f);
  }
  return out;
}

/** Registry field names as a reader would say them, not as the DSL spells them — a mechanical vocabulary substitution (never a new fact), same spirit as this file's DASH/`|` ASCII substitutions. */
function humanizeField(field) {
  switch (field) {
    case 'rateMils':
      return 'payment rate';
    case 'weight':
      return 'relative weight';
    case 'chargeMils':
      return 'charge amount';
    case 'unitCount':
      return 'unit count';
    default:
      return field;
  }
}

function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/** A rank-family leaf (`ordinalAtLeast`/`isHighestBy`/`isNotHighestBy`/`ordinalIs`) FIRED: `examined.ordinal` names the subject's actual rank (not available via `factRefs` — see `resolveFactsRead`'s header), `argSpec`'s own `field`/`among` name what it was ranked by and against (via `rankGroupPhrase`, the same "among" phrase `CONSIDERED, DID NOT APPLY` already uses). */
function firedRank(node) {
  return (ev) => {
    const a = node.args ?? {};
    const ordinal = ev.examined?.ordinal;
    if (typeof ordinal !== 'number') return describeOp(node);
    const field = typeof a.field === 'string' ? a.field : undefined;
    const humanField = field !== undefined ? humanizeField(field) : '(unnamed field)';
    const groupPhrase = a.among !== undefined ? rankGroupPhrase(a.among) : '(unnamed group)';
    const rankPhrase = `this line ranks ${ordinal}${ordinalSuffix(ordinal)} by ${humanField} among ${groupPhrase} lines`;
    if (node.op === 'isNotHighestBy') return `${rankPhrase}, not the top by ${humanField}`;
    if (node.op === 'isHighestBy') return `${rankPhrase}, the top by ${humanField}`;
    return rankPhrase;
  };
}

/** `claimContainsAny`/`claimContainsCode` FIRED: names which of the leaf's own si/code values were actually found (not the whole list it checks — see this leaf's `describe()` for that), and every concrete line a matching census fact names, via `Fact.lineIds`. Falls back to the leaf's own `describe()` — still true, just not concretized — when no matching fact was resolved (should not happen for a FIRED claimContainsAny; defensive). */
function firedClaimPresence(node, factsRead, result, displayIndexByLineId) {
  const a = node.args ?? {};
  const dim = a.si !== undefined ? 'si' : a.code !== undefined ? 'code' : null;
  const candidates = dim === 'si' ? a.si : dim === 'code' ? (Array.isArray(a.code) ? a.code : [a.code]) : [];
  if (dim === null) return describeOp(node);
  const matchingFacts = factsRead.filter(
    (f) => f.dimension === dim && (f.kind === 'siCensus' || f.kind === 'codeCensus') && f.values.some((v) => candidates.includes(v)),
  );
  if (matchingFacts.length === 0) return describeOp(node);
  const matchedValues = [...new Set(matchingFacts.flatMap((f) => f.values.filter((v) => candidates.includes(v))))];
  const lineIds = [...new Set(matchingFacts.flatMap((f) => f.lineIds))];
  const lineRefs = lineIds.map((id) => lineRefText(id, result, displayIndexByLineId));
  const noun = dim === 'si' ? 'status indicator' : 'code';
  return `the claim contains a line with ${noun} ${joinOr(matchedValues)} -- ${joinAnd(lineRefs)}`;
}

/** `claimUnitsAtLeast` FIRED: the actual summed unit count on record (`Fact.values[0]` of the resolved `unitTotal` fact), not just the threshold the rule checks. */
function firedUnitsAtLeast(node, factsRead) {
  const a = node.args ?? {};
  const fact = factsRead.find((f) => f.kind === 'unitTotal');
  const label = a.code !== undefined ? a.code : joinOr(a.si ?? []);
  if (fact !== undefined && typeof fact.values[0] === 'number') {
    return `${label} totals ${fact.values[0]} units on this claim (at least ${a.units} required)`;
  }
  return describeOp(node);
}

/** One leaf of a FIRED `when` tree, in the positive ("this held") register — the mirror image of `shortLeaf`'s NOT_FIRED register above, sourced the same way (never hand-authored prose about the rule itself, only these operators' own `describe()`/`args` plus resolved evaluation data). An operator this table does not special-case falls back to `describeOp` verbatim, exactly like `shortLeaf`. */
function firedLeaf(node, ev, factsRead, result, displayIndexByLineId) {
  switch (node.op) {
    case 'claimContainsAny':
    case 'claimContainsCode':
      return firedClaimPresence(node, factsRead, result, displayIndexByLineId);
    case 'claimContainsNone': {
      const a = node.args ?? {};
      const candidates = a.si ?? a.code ?? [];
      return `no ${joinOr(candidates)} line on this claim`;
    }
    case 'claimUnitsAtLeast':
      return firedUnitsAtLeast(node, factsRead);
    case 'ordinalAtLeast':
    case 'isHighestBy':
    case 'isNotHighestBy':
    case 'ordinalIs':
      return firedRank(node)(ev);
    default:
      return describeOp(node);
  }
}

/** Walks a FIRED `when` tree: `allOf` names every conjunct (all were true), `anyOf` names only the disjunct(s) `examined.detail.childResults` records as true (mirroring `shortReason`'s use of the same array for NOT_FIRED's blocking conjuncts) — never restates a child that did not actually contribute. */
function firedNode(node, ev, factsRead, result, displayIndexByLineId) {
  if (node.op === 'allOf' && Array.isArray(node.args?.children)) {
    const parts = node.args.children.map((c) => firedNode(c, ev, factsRead, result, displayIndexByLineId));
    return joinAnd(parts);
  }
  if (node.op === 'anyOf' && Array.isArray(node.args?.children)) {
    const children = node.args.children;
    const detail = ev.examined?.detail;
    const trueIdx = Array.isArray(detail?.childResults) ? detail.childResults.map((f, i) => (f === true ? i : null)).filter((i) => i !== null) : null;
    const chosen = trueIdx !== null && trueIdx.length > 0 ? trueIdx.map((i) => children[i]) : children;
    const parts = chosen.map((c) => firedNode(c, ev, factsRead, result, displayIndexByLineId));
    return joinOr(parts);
  }
  return firedLeaf(node, ev, factsRead, result, displayIndexByLineId);
}

/** Strips exactly the same "not already BUNDLED" scope guard `rankGroupPhrase` already strips (see `isBundledGuard`'s own header) — implementation mechanics, not something a reader needs told back to them as "and the line is not already bundled." */
function stripBundledGuard(scope) {
  if (scope.op === 'allOf' && Array.isArray(scope.args?.children)) {
    const kept = scope.args.children.filter((c) => !isBundledGuard(c));
    if (kept.length === 0) return { op: 'always', args: {} };
    if (kept.length === 1) return kept[0];
    return { op: 'allOf', args: { children: kept } };
  }
  return scope;
}

/** A rule with an empty `when` fires on `scope` alone — there is no condition to attribute the firing to, only a population it applies to (spec: never print "Fired because ." with a dangling clause). */
function describeApplyScope(scope) {
  const stripped = stripBundledGuard(scope);
  if (stripped.op === 'siIn') return `every SI ${joinOr(stripped.args.si)} line`;
  if (stripped.op === 'always') return 'every line in scope';
  return `every line where ${describeOp(stripped)}`;
}

/** The WHY condition sentence for one FIRED rule: "Fired because ..." from `when` (concretized via `firedNode`), or "Applies to ..." from `scope` when the rule has no `when` at all. */
function describeFiredWhen(rule, ev, result, factsIndex, displayIndexByLineId) {
  if (rule.when === undefined) {
    return terminate(`Applies to ${describeApplyScope(rule.scope)}`);
  }
  const factsRead = resolveFactsRead(ev, factsIndex);
  return terminate(`Fired because ${firedNode(rule.when, ev, factsRead, result, displayIndexByLineId)}`);
}

/** One `then[]` effect actually applied (from the trace's own `Evaluation.effect`, not the static rule definition — same data, but "what happened" rather than "what the rule says"), described via that effect operator's own `describe()`, with `bundleUnder` concretized to the line `d.bundledUnder` actually names (spec: "should name the line it chose, not restate the selector") and `setStatus`/`setBasis`/`convertSI` read directly off their own args (all three take a single named literal — no operator-supplied prose to fall back to or improve on). */
/** Appends a full stop, unless the text already ends in terminal punctuation (a `flag` effect's own message usually does under `--why-verbose`) — never a double "..". */
function terminate(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * `verbose` gates whether a `flag` effect's own full `message` prints —
 * default is code+severity only (`--why`'s reader path, same reasoning as
 * demoting `note`: a flag's authored message is a developer/compliance
 * disclosure — e.g. citing "the closed DSL operator set (spec §4.3)" — not
 * something a bill processor reads to understand why the LINE came out the
 * way it did; the line's own status/basis change already answers that). Two
 * flag codes are unaffected either way: `OPPS.EXEMPT.UNVERIFIED_POLICY` and
 * every `gap`-severity flag already print in full, always, in the FLAGS:
 * section above the table (`printAlwaysFlags`) — this only controls whether
 * an `assumption`/`info`-severity flag's message is *also* spelled out here.
 */
function describeEffectApp(eff, d, result, displayIndexByLineId, verbose) {
  const a = eff.args !== null && typeof eff.args === 'object' && !Array.isArray(eff.args) ? eff.args : {};
  switch (eff.op) {
    case 'setStatus':
      return `status set to ${a.status}`;
    case 'setBasis':
      return `basis set to ${a.value}`;
    case 'convertSI':
      return `status indicator converted to ${a.to}`;
    case 'route':
      return 'routed to the fee schedule resolved by the routing step';
    case 'exempt':
      return 'marked exempt from packaging';
    case 'stop':
      return 'halts further rule evaluation for this line';
    case 'flag': {
      // Not `operators['flag'].describe()` verbatim: that function's own
      // "raises a ${severity} flag" is grammatically wrong for a vowel-led
      // severity ("a assumption flag") — a describe() bug this
      // presentation-only unit may not fix at its source (dsl/operators.ts
      // is off limits). `a.severity`/`a.code`/`a.message` are the same
      // effect args describe() itself reads; only the article is fixed up.
      const article = /^[aeiou]/i.test(String(a.severity)) ? 'an' : 'a';
      const head = `raises ${article} ${a.severity} flag (${a.code})`;
      return verbose ? `${head}: ${a.message}` : head;
    }
    case 'bundleUnder': {
      const humanField = typeof a.highestBy === 'string' ? humanizeField(a.highestBy) : '(unnamed field)';
      const groupPhrase = a.among !== undefined ? rankGroupPhrase(a.among) : '(unnamed group)';
      const base = `bundled under the line with the highest ${humanField} among ${groupPhrase}`;
      return d.bundledUnder !== null ? `${base} -- ${lineRefText(d.bundledUnder, result, displayIndexByLineId)}` : base;
    }
    default: {
      const op = operators[eff.op];
      return op !== undefined ? op.describe(a) : `(unknown effect "${eff.op}")`;
    }
  }
}

/** The WHY effect sentence: every effect the trace recorded as actually applied, joined into one line. `null` when a FIRED evaluation somehow recorded no effect (§5.3a says that should not happen; defensive, not printed as an empty "Effect:"). */
function describeEffects(d, ev, result, displayIndexByLineId, verbose) {
  const effects = ev.effect ?? [];
  if (effects.length === 0) return null;
  return `Effect: ${terminate(effects.map((eff) => describeEffectApp(eff, d, result, displayIndexByLineId, verbose)).join('; '))}`;
}

/** The WHY block: whichever rule(s) actually FIRED for this line, each as a "Fired because .../Applies to ..." condition sentence plus an "Effect: ..." sentence (U19d — see the block comment above `buildFactsIndex`), never the rule's authored `note` (moved to `--why-verbose`'s RULE RATIONALE, since it is developer rationale, not a reader-facing explanation — see this file's header). */
function printWhyBlock(d, result, factsIndex, displayIndexByLineId, verbose) {
  console.log('  WHY');
  const fired = d.trace.filter((ev) => ev.outcome === 'FIRED');

  if (d.trace.length === 0) {
    // §8.0 gate / phase-1 determinations carry no rule trace at all — the
    // determination's own flags are the only source of "why" (build brief
    // "Also" note). Never printed as an empty section.
    if (d.flags.length > 0) {
      for (const f of d.flags) {
        console.log(wrapText(f.message, '    '));
        if (f.citation !== null) console.log(`      ${f.citation}`);
      }
    } else {
      console.log(wrapText("No rule trace or flag was recorded for this line -- its status was decided before any registry rule ran (the section 8.0 gate or phase 1 classification).", '    '));
    }
    return;
  }

  if (fired.length === 0) {
    console.log(wrapText(`No rule in the trace fired for this line -- it kept its default disposition (status: ${d.status}).`, '    '));
    return;
  }

  for (const ev of fired) {
    const rule = RULES_BY_ID.get(ev.ruleId);
    if (rule === undefined) {
      console.log(`    (no rule definition on record for ${ev.ruleId} -- registry gap)`);
      console.log(`      ${ev.ruleId} | ${ev.citation}`);
      continue;
    }
    console.log(wrapText(describeFiredWhen(rule, ev, result, factsIndex, displayIndexByLineId), '    '));
    const effectSentence = describeEffects(d, ev, result, displayIndexByLineId, verbose);
    if (effectSentence !== null) console.log(wrapText(effectSentence, '    '));
    console.log(`      ${ev.ruleId} | ${ev.citation}`);
    if (verbose && typeof rule.note === 'string' && rule.note.trim() !== '') {
      console.log('');
      console.log('    RULE RATIONALE');
      console.log(wrapText(rule.note, '      '));
    }
  }
}

/** The CONSIDERED, DID NOT APPLY block: every other rule the engine actually looked at for this line, one short reason each. */
function printConsideredBlock(d, result, verbose) {
  const entries = d.trace.filter((ev) => ev.outcome === 'NOT_FIRED' || ev.outcome === 'SKIPPED' || ev.outcome === 'ERRORED');
  if (entries.length === 0) return;
  console.log('');
  console.log('  CONSIDERED, DID NOT APPLY');
  const labelWidth = Math.max(...entries.map((ev) => ev.ruleId.length)) + 4;
  for (const ev of entries) {
    console.log(`    ${padRight(ev.ruleId, labelWidth)}${shortReasonForEvaluation(ev)}`);
    if (verbose) {
      const full = ev.outcome === 'NOT_FIRED' ? resolveCounterfactualLoud(result, ev) : (ev.counterfactual ?? '(no counterfactual recorded for this outcome)');
      console.log(wrapText(`full: ${full}`, `    ${' '.repeat(labelWidth)}`));
    }
  }
}

/** Mechanical truncation only — a literal prefix of the recorded reason text, never a rewrite (§ "Never invent"). Used solely to bound the default footer to one line per rule; `--why-verbose` always prints the reason in full instead of this. */
function compressReason(text, maxLen = 100) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}...`;
}

/** Rules whose data source doesn't exist at all (NOT_EVALUATED, §9.5's reserved-slot mechanism) fire identically on every line — printed once, for the whole set of lines shown, instead of repeating per line (build brief problem #4). U19d: compressed to one line per rule by default (id + short reason, no citation) — the full multi-line reason and citation this used to always print now live behind `--why-verbose` only. */
function printNotEvaluatedFooter(targets, verbose) {
  const byId = new Map();
  for (const d of targets) {
    for (const ev of d.trace) {
      if (ev.outcome === 'NOT_EVALUATED' && !byId.has(ev.ruleId)) byId.set(ev.ruleId, ev);
    }
  }
  if (byId.size === 0) return;
  const entries = [...byId.values()].sort((a, b) => (a.band !== b.band ? a.band - b.band : a.order - b.order));
  console.log('');
  console.log('NOT CHECKED ON ANY LINE');
  for (const ev of entries) {
    const reason = typeof ev.examined?.detail?.reason === 'string' ? ev.examined.detail.reason : describeOp(ev.predicate);
    if (verbose) {
      console.log(`  ${ev.ruleId}`);
      console.log(wrapText(reason, '    '));
      console.log(wrapText(ev.citation, '    '));
    } else {
      console.log(wrapText(`${ev.ruleId} -- ${compressReason(reason)}`, '  '));
    }
  }
}

function printWhy(result, whyFilter, verbose) {
  const targets = whyFilter === null ? result.determinations : result.determinations.filter((d) => d.code === whyFilter);
  if (targets.length === 0) {
    console.log('');
    console.log(`(--why=${whyFilter}: no line on this claim carries that code)`);
    return;
  }
  const displayIndexByLineId = new Map(result.determinations.map((d, i) => [d.lineId, i + 1]));
  const factsIndex = buildFactsIndex(result.facts);
  for (const d of targets) {
    console.log('');
    const si = d.resolvedSI !== null && d.resolvedSI !== undefined && d.resolvedSI !== '' ? d.resolvedSI : DASH;
    console.log(`LINE ${displayIndexByLineId.get(d.lineId)}   ${d.code || '(no code)'}   ${si}  ->  ${d.status}${underLinePhrase(d, result, displayIndexByLineId)}`);
    console.log('');
    printWhyBlock(d, result, factsIndex, displayIndexByLineId, verbose);
    printConsideredBlock(d, result, verbose);
  }
  printNotEvaluatedFooter(targets, verbose);
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
      if (args.why) printWhy(result, args.whyFilter, args.whyVerbose);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(jsonOut.length === 1 ? jsonOut[0] : jsonOut, null, 2));
  }

  process.exit(sawError ? 1 : 0);
}

main();
