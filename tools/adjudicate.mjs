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

// U25 extraction — the same generated-text logic web/js/app.js uses (via the
// bundled `window.OppsEngine.why`), factored out to tools/lib/why.mjs so
// there is exactly one implementation, not two that could drift (see that
// file's header). `operators` is injected, not imported by why.mjs itself —
// same self-containment discipline as dsl/operators.ts.
const {
  joinOr,
  joinAnd,
  describeOp,
  shortReasonForEvaluation,
  underLinePhrase,
  lineRefText,
  buildFactsIndex,
  describeFiredWhen,
  describeEffects,
} = (await import('./lib/why.mjs')).createWhyText(operators);

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
