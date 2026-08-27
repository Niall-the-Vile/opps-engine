// U19b regression coverage for tools/adjudicate.mjs's table rendering.
//
// The CLI is a subprocess script (it relaunches itself through vite-node —
// see that file's header), so it is exercised here via spawnSync rather
// than direct import, the same way a human would run it.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'tools', 'adjudicate.mjs');

function runCli(args: string[]): string {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`CLI exited ${String(result.status)}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result.stdout;
}

describe('adjudicate.mjs CLI — units column (§5.1, U19b)', () => {
  it('shows a UNITS column when at least one line carries units other than 1 (G0378x8)', () => {
    const stdout = runCli(['G0378x8']);
    const headerLine = stdout.split('\n').find((l) => l.startsWith('LINE'));
    expect(headerLine).toBeDefined();
    expect(headerLine).toMatch(/\bUNITS\b/);
    const dataLine = stdout.split('\n').find((l) => l.startsWith('1'));
    expect(dataLine).toBeDefined();
    expect(dataLine).toMatch(/\bG0378\b.*\b8\b/);
  });

  it('omits the UNITS column when every line has 1 unit (36415 84112)', () => {
    const stdout = runCli(['36415', '84112']);
    const headerLine = stdout.split('\n').find((l) => l.startsWith('LINE'));
    expect(headerLine).toBeDefined();
    expect(headerLine).not.toMatch(/\bUNITS\b/);
  });
});

describe('adjudicate.mjs CLI — --why human-readable explanation (U19c)', () => {
  it('names the firing rule in the WHY section for a bundled line (59025 84112)', () => {
    const stdout = runCli(['--why', '59025', '84112']);
    // LINE 2 (84112) bundles under LINE 1 (59025) via OPPS.PKG.Q4.COMPANION.
    const line2Idx = stdout.indexOf('LINE 2');
    expect(line2Idx).toBeGreaterThan(-1);
    const line2Block = stdout.slice(line2Idx, stdout.indexOf('LINE 2', line2Idx + 1) === -1 ? undefined : stdout.indexOf('NOT CHECKED', line2Idx));
    expect(line2Block).toMatch(/\bWHY\b/);
    expect(line2Block).toContain('OPPS.PKG.Q4.COMPANION');
    // The header states the decision and its cause up front.
    expect(line2Block).toMatch(/LINE 2.*BUNDLED under line 1 \(59025\)/);
  });

  it('prints the reserved/NOT_EVALUATED rules exactly once for the whole report, not once per line', () => {
    const stdout = runCli(['--why', '59025', '84112']);
    expect(stdout).toContain('NOT CHECKED ON ANY LINE');
    for (const ruleId of ['NCCI.PTP.PAIR', 'MUE.LIMIT', 'OPPS.CLASSIFY.DELETED']) {
      const occurrences = stdout.split(ruleId).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it('gives a line with an empty trace (phase-1/gate-decided status) a WHY block from its own flags, not an empty section', () => {
    const stdout = runCli(['--why', '99205']);
    const whyIdx = stdout.indexOf('WHY');
    expect(whyIdx).toBeGreaterThan(-1);
    const whyBlock = stdout.slice(whyIdx);
    expect(whyBlock).not.toContain('(no rule trace recorded for this line)');
    // OPPS.CLASSIFY.RECODE's flag message is the only source of "why" here.
    expect(whyBlock).toMatch(/recode/i);
  });

  it('compresses a NOT_FIRED rule to a short reason under --why, and still carries the full counterfactual under --why-verbose', () => {
    const plain = runCli(['--why', '59025', '84112']);
    expect(plain).toContain('no J1 line on this claim');
    expect(plain).not.toContain('would fire if the claim also contains a line with status indicator J1');

    const verbose = runCli(['--why-verbose', '59025', '84112']);
    expect(verbose).toContain('no J1 line on this claim');
    // Word-wrapped across lines in the printed output (§5.3a's full text is
    // long), so match on collapsed whitespace rather than a literal substring.
    const verboseFlat = verbose.replace(/\s+/g, ' ');
    expect(verboseFlat).toContain('would fire if the claim also contains a line with status indicator J1');
  });

  // Guards --json against accidental drift while the human-facing --why output
  // is reworked. The snapshot was regenerated once, deliberately, in U9b: the
  // original was frozen against buggy output that omitted a rank fact from
  // Result.facts, so it pinned the ABSENCE of that fact as ground truth. The
  // guarantee this test provides is unchanged — presentation work must not move
  // the machine surface — but a genuine data fix legitimately does.
  it('leaves --json output byte-identical to the snapshot (59025 84112, G0378x8 99284, 99205)', () => {
    // Captured from tools/adjudicate.mjs's --json output *before* this
    // unit's --why rewrite (verified via manual diff against that capture
    // while making the change); pinned here as a vitest snapshot so any
    // future edit to this file that touches --json's byte output — this
    // unit is presentation-only and must never do that — fails loudly.
    expect(runCli(['--json', '59025', '84112'])).toMatchSnapshot();
    expect(runCli(['--json', 'G0378x8', '99284'])).toMatchSnapshot();
    expect(runCli(['--json', '99205'])).toMatchSnapshot();
  });
});

describe('adjudicate.mjs CLI — WHY generates the reason instead of printing the rule note (U19d)', () => {
  /** Slices out just LINE 2's (84112) block from a `--why 59025 84112` run — same technique the U19c tests above already use. */
  function line2Block(stdout: string): string {
    const line2Idx = stdout.indexOf('LINE 2');
    expect(line2Idx).toBeGreaterThan(-1);
    const notCheckedIdx = stdout.indexOf('NOT CHECKED', line2Idx);
    return stdout.slice(line2Idx, notCheckedIdx === -1 ? undefined : notCheckedIdx);
  }

  it('states the actual firing condition (SI T) for the bundled line, not developer/DSL internals from the rule note', () => {
    const block = line2Block(runCli(['--why', '59025', '84112']));
    expect(block).toMatch(/\bWHY\b/);
    // The condition that actually fired — the claim carries a T line.
    expect(block).toMatch(/\bT\b/);
    // None of these ever belonged in front of a bill processor — they were
    // the old behavior's literal printing of OPPS.DISP.T's authored `note`
    // (see src/registry/opps.dispositions.json) and OPPS.PKG.Q4.COMPANION's
    // own note, which points at a different rule (Q1.COMPANION) instead of
    // stating why THIS line bundled.
    expect(block).not.toContain('dsl/operators.ts');
    expect(block).not.toContain('setAmount');
    expect(block).not.toContain('OPPS.PKG.Q1.COMPANION');
  });

  it('names the concrete bundling target line in the WHY block, not just the bundleUnder selector', () => {
    const block = line2Block(runCli(['--why', '59025', '84112']));
    // Old behavior printed bundleUnder's static selector prose only
    // ("bundles under the line with the highest rateMils among lines
    // where..."), never which line that resolved to. The WHY block itself
    // (not just the "LINE 2 ... -> BUNDLED under line 1" header above it)
    // must now name the concrete target.
    const whyIdx = block.indexOf('WHY');
    const whyOnward = block.slice(whyIdx);
    expect(whyOnward).toContain('line 1 (59025)');
  });

  it('keeps a fired rule\'s full authored note available under --why-verbose, labeled RULE RATIONALE', () => {
    const verbose = runCli(['--why-verbose', '59025', '84112']);
    expect(verbose).toContain('RULE RATIONALE');
    const verboseFlat = verbose.replace(/\s+/g, ' ');
    // OPPS.DISP.T's full note (the developer rationale this unit moved out
    // of the default --why path) is still on record, in full, in verbose.
    expect(verboseFlat).toContain('no setAmount/multiply in the operator set');
    expect(verboseFlat).toContain('see dsl/operators.ts');
    // OPPS.PKG.Q4.COMPANION's note (references OPPS.PKG.Q1.COMPANION) is
    // likewise still on record under RULE RATIONALE, just not in the
    // default reader path (covered by the previous test).
    expect(verboseFlat).toContain('OPPS.PKG.Q1.COMPANION');
  });

  it('compresses the NOT CHECKED ON ANY LINE footer to at most 2 lines per reserved rule by default', () => {
    const stdout = runCli(['--why', '59025', '84112']);
    const footerIdx = stdout.indexOf('NOT CHECKED ON ANY LINE');
    expect(footerIdx).toBeGreaterThan(-1);
    const footerLines = stdout
      .slice(footerIdx)
      .split('\n')
      .slice(1)
      .filter((l) => l.trim() !== '');
    const ruleIds = ['NCCI.PTP.PAIR', 'MUE.LIMIT', 'OPPS.CLASSIFY.DELETED'];
    const startIndices = ruleIds.map((id) => footerLines.findIndex((l) => l.includes(id)));
    for (const [i, start] of startIndices.entries()) {
      expect(start).toBeGreaterThan(-1);
      const next = startIndices[i + 1];
      const end = next !== undefined ? next : footerLines.length;
      expect(end - start).toBeLessThanOrEqual(2);
    }
    // The full multi-line reason + citation this footer used to always
    // print by default now live behind --why-verbose only.
    expect(stdout).not.toContain('NCCI Policy Manual, Chapter I');
    const verbose = runCli(['--why-verbose', '59025', '84112']);
    expect(verbose).toContain('NCCI Policy Manual, Chapter I');
  });
});
