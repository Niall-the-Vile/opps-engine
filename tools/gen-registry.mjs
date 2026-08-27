#!/usr/bin/env node
// tools/gen-registry.mjs — mirrors src/registry/*.json into src/registry/index.ts
// as typed .ts literals, the same pattern tools/gen-data.mjs already uses for
// src/data/*.cy2026.ts (spec §2.7, §12.1).
//
// WHY THIS EXISTS: src/index.ts used to `import ... from './registry/*.json'
// with { type: 'json' }`, which forced `resolveJsonModule: true` into
// tsconfig.json. That flag is repo-wide once 837-claim-viewer vendors the
// engine under its own tsconfig — §12.1 acceptance criterion 3 requires the
// consumer to typecheck the vendored engine with NO tsconfig change (no
// allowJs/checkJs/resolveJsonModule/include edit). A JSON-module import
// anywhere in the engine breaks that. §2.7 separately keeps registry
// *reading* outside `/engine` so the engine itself carries no
// module-resolution requirements.
//
// The JSON files remain the authored, reviewable source of truth (§2.7) — a
// human edits *.json, never index.ts. This generator is the only thing that
// reads the JSON for the engine's own import path; every other Node-side
// tool (tools/lint-registry.mjs, tools/diff-registry.mjs, this file) reads
// the JSON directly with `fs`, same as always.
//
// Run with `npm run gen:data` (wired in alongside tools/gen-data.mjs).
// Output is gitignored (see .gitignore), exactly like src/data/*.ts.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = path.resolve(__dirname, '..', 'src', 'registry');

// One export per source file, named to match what src/index.ts previously
// imported as its default JSON-module bindings (exemptRules, packagingRules,
// dispositionRules), just capitalized to this file's constant convention.
const SOURCES = [
  { file: 'opps.exempt.json', exportName: 'EXEMPT_RULES' },
  { file: 'opps.packaging.json', exportName: 'PACKAGING_RULES' },
  { file: 'opps.dispositions.json', exportName: 'DISPOSITION_RULES' },
];

function readJsonArray(file) {
  const abs = path.join(REGISTRY_DIR, file);
  const text = readFileSync(abs, 'utf8');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`${file}: expected a top-level JSON array of rules, got ${typeof parsed}`);
  }
  return parsed;
}

function main() {
  const lines = [];
  lines.push('// GENERATED FILE — do not edit by hand.');
  lines.push('// Produced by tools/gen-registry.mjs from src/registry/*.json.');
  lines.push('// Regenerate with `npm run gen:data`.');
  lines.push('//');
  lines.push('// The *.json files in this directory are the authored, reviewable source');
  lines.push('// of truth for the rule registry (spec §2.7) — edit those, never this file.');
  lines.push('// This mirror exists only so src/index.ts can import registry content as a');
  lines.push('// plain .ts literal instead of a JSON module, which is what let');
  lines.push('// `resolveJsonModule` come out of tsconfig.json entirely (spec §12.1).');
  lines.push('// Rule *shape* — including each operator payload — is still validated at');
  lines.push('// load time by dsl/validate.ts; this file does no validation of its own.');
  lines.push('');

  let total = 0;
  for (const { file, exportName } of SOURCES) {
    const rows = readJsonArray(file);
    total += rows.length;
    console.log(`  ${file} -> ${exportName} (${rows.length} rules)`);
    lines.push(`export const ${exportName}: readonly unknown[] = ${JSON.stringify(rows, null, 2)};`);
    lines.push('');
  }

  const outPath = path.join(REGISTRY_DIR, 'index.ts');
  writeFileSync(outPath, lines.join('\n'));
  console.log(`\nsrc/registry/index.ts written: ${total} rules across ${SOURCES.length} files.`);
}

main();
