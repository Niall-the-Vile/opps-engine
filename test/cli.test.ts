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
