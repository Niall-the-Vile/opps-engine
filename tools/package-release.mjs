#!/usr/bin/env node
// tools/package-release.mjs — packages the browser interface as ONE
// double-clickable HTML file: dist/opps-adjudicator-<version>.html
//
// Why a single file rather than a zip of web/ + dist/:
//
//   The audience is bill-processing staff, not developers, and the delivery
//   path is email or a shared drive. A zip has to be extracted BEFORE it is
//   opened — and Windows will happily let you double-click index.html from
//   *inside* the compressed-folder preview, where the sibling css/, js/ and
//   ../dist/ paths do not resolve. The page then loads with no styling and
//   no engine, which reads as "the tool is broken" rather than "you skipped
//   a step". One file has no such failure mode: there are no relative paths
//   left to break.
//
// Everything is inlined — the engine bundle, the front-end script, the
// stylesheet, and the logo as a data: URI. The result needs no server, no
// network, no Node and no install on the machine that opens it, which is the
// same constraint the engine itself is built to (spec §2.1).
//
// Run `npm run build:bundle` first; this script refuses to guess.

import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SOURCES = {
  html: path.join(ROOT, 'web', 'index.html'),
  css: path.join(ROOT, 'web', 'css', 'app.css'),
  app: path.join(ROOT, 'web', 'js', 'app.js'),
  engine: path.join(ROOT, 'dist', 'engine.bundle.js'),
  logo: path.join(ROOT, 'web', 'assets', 'AB_Logo.png'),
};

/**
 * Neutralises the only two byte sequences that can end an inline <script> or
 * <style> element early: the element's own end tag, and the legacy HTML
 * comment opener (which puts the HTML tokenizer into script-escaped state).
 *
 * Both replacements are value-preserving in every JS and CSS context these
 * sequences can legally occur in — string literals, regex literals and
 * comments — because a backslash before `/` or `!` is an identity escape in
 * all three. They would be a syntax error in plain code, but `</script` and
 * `<!--` cannot appear as plain code.
 *
 * Correctness is not left to that argument: verifyPackaged() below re-derives
 * the escape from the original bytes and demands a byte-exact match, and the
 * engine block is additionally executed and adjudicated against.
 */
function escapeInline(text, endTag) {
  const tagRe = new RegExp('<\\/(' + endTag + ')', 'gi');
  return text.replace(tagRe, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** Fails loudly if `text` already contains an escaped form, which would make the escape ambiguous and could silently corrupt the payload. */
function assertNotPreEscaped(text, label, endTag) {
  const already = new RegExp('<\\\\\\/' + endTag + '|<\\\\!--', 'i');
  if (already.test(text)) {
    throw new Error(
      label + ': already contains an escaped "<\\/' + endTag + '" or "<\\!--" sequence. ' +
        'The inline escape would not be unambiguous. Fix the source, or teach this script a distinguishing escape.',
    );
  }
}

function read(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(
      label + ' not found at ' + path.relative(ROOT, file) + ' — run `npm run build:bundle` first.',
    );
  }
  return fs.readFileSync(file);
}

/** Release identity: an explicit env var wins (CI passes the tag), then git, then a clearly-marked local build. Never silently invents a version number. */
function releaseIdentity() {
  const version = process.env.RELEASE_VERSION ?? 'local';
  const given = process.env.RELEASE_COMMIT ?? '';

  // "+local-changes" is a claim about THIS working tree, so it is only ever
  // attached to a commit read from THIS working tree. When the caller states
  // the commit (CI passes the tagged sha), that sha is what shipped and the
  // local tree has nothing to say about it.
  let commit;
  if (given !== '') {
    commit = given.slice(0, 8);
  } else {
    try {
      commit = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
      const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '';
      if (dirty) commit += '+local-changes';
    } catch {
      commit = 'unknown';
    }
  }

  const date = process.env.RELEASE_DATE ?? new Date().toISOString().slice(0, 10);
  return { version, commit, date };
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The visible provenance line. Milestone 1 answers a bundling question, and
 * bundling is governed by the OPPS vintage, so that is the schedule named on
 * the face of the page. The other five are real provenance too — they just
 * do not fit in a sidebar — so they ride along in the title attribute and,
 * greppable from the raw file, in the header comment written by main().
 */
function buildStamp(id, versions) {
  const rows = [
    ['build', id.version + ' · ' + id.commit],
    ['built', id.date],
    ['opps data', versions.dataVersion.opps ?? 'unknown'],
    ['engine', versions.contractVersion],
  ];
  const body = rows.map(([k, v]) => escHtml(k) + ' ' + escHtml(v)).join('<br>');
  const all = Object.entries(versions.dataVersion)
    .map(([k, v]) => k + ': ' + v)
    .join('\n');
  return '<div class="build-stamp" title="' + escHtml('All loaded schedules\n' + all).replace(/"/g, '&quot;') +
    '">' + body + '</div>';
}

/** Loads the engine bundle in a bare sandbox to read the versions that belong on the stamp, so they come from the shipped artifact rather than a parallel source of truth that can drift away from it. */
function versionsFromBundle(engineJs) {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(engineJs, sandbox, { filename: 'engine.bundle.js' });
  const engine = sandbox.OppsEngine;
  if (engine === undefined || engine === null) {
    throw new Error('engine bundle did not assign window.OppsEngine');
  }
  const data = engine.DATA_VERSION;
  if (typeof data !== 'object' || data === null) {
    throw new Error('engine bundle exposed DATA_VERSION as ' + typeof data + ', expected an object of schedule vintages');
  }
  return {
    dataVersion: data,
    contractVersion: String(engine.ENGINE_CONTRACT_VERSION ?? 'unknown'),
  };
}

/**
 * Proves the packaged file is a faithful, working copy of its inputs:
 *
 *   1. Each inlined region, re-derived from the ORIGINAL bytes, must appear
 *      in the packaged file byte for byte. That is a lossless-transform
 *      proof, not a spot check.
 *   2. The <script> and <style> elements must be balanced and exactly as
 *      many as expected, so no payload escaped its element.
 *   3. The engine block, extracted back out of the finished HTML, is executed
 *      and adjudicates a real claim — the same gate tools/bundle.mjs applies,
 *      re-applied after inlining, because inlining is exactly where a 1.2 MB
 *      script would get quietly corrupted.
 *   4. Nothing external is left referenced, or it would not work standalone.
 */
function verifyPackaged(html, sources) {
  const regions = [
    ['stylesheet', escapeInline(sources.css, 'style')],
    ['engine bundle', escapeInline(sources.engine, 'script')],
    ['front-end script', escapeInline(sources.app, 'script')],
  ];
  for (const [label, escaped] of regions) {
    if (!html.includes(escaped)) {
      throw new Error('verify: the packaged ' + label + ' is not a byte-exact escape of its source.');
    }
  }

  const scriptOpens = (html.match(/<script\b/gi) ?? []).length;
  const scriptCloses = (html.match(/<\/script\s*>/gi) ?? []).length;
  if (scriptOpens !== 2 || scriptCloses !== 2) {
    throw new Error(
      'verify: expected exactly 2 balanced <script> elements, found ' + scriptOpens + ' open / ' +
        scriptCloses + ' close — an inlined payload escaped its element.',
    );
  }
  const styleCloses = (html.match(/<\/style\s*>/gi) ?? []).length;
  if (styleCloses !== 1) {
    throw new Error('verify: expected exactly 1 </style>, found ' + styleCloses + '.');
  }

  const open = html.indexOf('<script>');
  const engineJs = html.slice(open + '<script>'.length, html.indexOf('</script>', open));
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(engineJs, sandbox, { filename: 'packaged-engine' });
  const engine = sandbox.OppsEngine;
  if (engine === undefined || typeof engine.adjudicate !== 'function') {
    throw new Error('verify: OppsEngine.adjudicate is not a function after inlining.');
  }
  const parsed = engine.parseCodeList('G0463 36415 84112');
  const result = engine.adjudicate({ claim: parsed.claim });
  if (result.determinations.length !== 3) {
    throw new Error(
      'verify: packaged engine returned ' + result.determinations.length + ' determinations, expected 3.',
    );
  }
  const g0463 = result.determinations.find((d) => d.code === 'G0463');
  if (g0463 === undefined || g0463.resolvedSI !== 'J2') {
    throw new Error(
      'verify: packaged engine resolved G0463 to ' + JSON.stringify(g0463?.resolvedSI) +
        ', expected J2 — the bundled OPPS data did not survive inlining.',
    );
  }

  // Scan the MARKUP only. The inlined payloads are full of text that looks
  // like markup but is not — app.css's own header comment explains why there
  // is no Google Fonts <link>, and a naive whole-document scan reads that
  // sentence as a surviving external stylesheet.
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '<style></style>');

  if (/<link\b/i.test(markup)) {
    throw new Error('verify: the packaged file still has a <link> element — it would not work standalone.');
  }
  const externalSrc = markup.match(/\bsrc\s*=\s*["'](?!data:)[^"']*["']/gi);
  if (externalSrc !== null) {
    throw new Error(
      'verify: the packaged file still references external resources (' + externalSrc.join(', ') +
        ') — it would not work standalone.',
    );
  }
  return result.determinations.length;
}

function main() {
  const id = releaseIdentity();

  const htmlSrc = read(SOURCES.html, 'web/index.html').toString('utf8');
  const css = read(SOURCES.css, 'stylesheet').toString('utf8');
  const app = read(SOURCES.app, 'front-end script').toString('utf8');
  const engine = read(SOURCES.engine, 'engine bundle').toString('utf8');
  const logo = read(SOURCES.logo, 'logo').toString('base64');

  assertNotPreEscaped(css, 'web/css/app.css', 'style');
  assertNotPreEscaped(app, 'web/js/app.js', 'script');
  assertNotPreEscaped(engine, 'dist/engine.bundle.js', 'script');

  const versions = versionsFromBundle(engine);

  const substitutions = [
    ['<link rel="stylesheet" href="css/app.css">', '<style>\n' + escapeInline(css, 'style') + '\n</style>'],
    ['<script src="../dist/engine.bundle.js"></script>', '<script>\n' + escapeInline(engine, 'script') + '\n</script>'],
    ['<script src="js/app.js"></script>', '<script>\n' + escapeInline(app, 'script') + '\n</script>'],
    ['src="assets/AB_Logo.png"', 'src="data:image/png;base64,' + logo + '"'],
    ['<!--BUILD_STAMP-->', buildStamp(id, versions)],
  ];

  // A provenance header on the raw file, so the artifact can be identified
  // from a text editor or a grep without opening a browser -- the case that
  // matters when someone forwards the file and asks "which build is this?".
  const headerLines = [
    '<!--',
    '  OPPS Adjudicator -- packaged single-file build. Anabaptist Brotherhood, internal.',
    '  build   ' + id.version + ' (' + id.commit + ')',
    '  built   ' + id.date,
    '  engine  ' + versions.contractVersion,
    ...Object.entries(versions.dataVersion).map(([k, v]) => '  data.' + k.padEnd(9) + ' ' + v),
    '-->',
    '',
  ];
  const header = headerLines.join('\n');

  let html = header + htmlSrc;
  for (const [needle, replacement] of substitutions) {
    const count = html.split(needle).length - 1;
    if (count !== 1) {
      throw new Error(
        'web/index.html: expected exactly one occurrence of ' + JSON.stringify(needle.slice(0, 60)) +
          ', found ' + count + '. The page changed shape; update tools/package-release.mjs to match ' +
          'rather than shipping a half-inlined file.',
      );
    }
    html = html.replace(needle, () => replacement);
  }

  const determinations = verifyPackaged(html, { css, app, engine });

  const outName = 'opps-adjudicator-' + id.version + '.html';
  const outFile = path.join(ROOT, 'dist', outName);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');

  const kib = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log('packaged dist/' + outName + ' (' + kib + ' KiB)');
  console.log('  build ' + id.version + ' · ' + id.commit + ' · ' + id.date);
  console.log('  engine ' + versions.contractVersion);
  for (const [schedule, vintage] of Object.entries(versions.dataVersion)) {
    console.log('  data.' + schedule + ' ' + vintage);
  }
  console.log(
    '  verified: self-contained, byte-exact inline, ' + determinations +
      ' determinations from the packaged engine',
  );

  // Hands the path back to the release workflow instead of making it
  // reconstruct a filename this script owns.
  if (process.env.GITHUB_OUTPUT !== undefined && process.env.GITHUB_OUTPUT !== '') {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'artifact=dist/' + outName + '\nname=' + outName + '\n');
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
}
