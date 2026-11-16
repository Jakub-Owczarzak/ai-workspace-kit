// Run: node --test lib/cli-output.test.mjs
// `console.log(<large text>)` followed at once by `process.exit()` can cut the output when stdout is a pipe: the part of
// the write that is still queued is dropped. The manager prints 10 to 30 KB of JSON (`config feature list --json`,
// `config list --json`) and the manage-workspace skill parses it, so the CLI must wait for stdout before it leaves.
// This failed on macOS with Node 18 ("Unexpected end of JSON input") in the CI of the pull request that added the manager.
// It does not happen on Windows, so on Windows this test passes with or without the fix: only macOS CI shows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from './apply.mjs';
import { init } from './init.mjs';

const CLI = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-output-'));
  init({ dir });
  apply({ dir, choices: { profile: 'team', tools: ['claude-code'], enabled: ['rule.verification'], overrides: {} } });
  return dir;
};

// Runs the CLI with stdout as a pipe (spawnSync does the same) and returns everything it printed.
function run(args, { script = false } = {}) {
  return new Promise((resolve, reject) => {
    // The kit's CLI by default; with `script` the first argument is the script to run.
    const child = spawn(process.execPath, script ? args : [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, text: Buffer.concat(chunks).toString('utf8') }));
  });
}

for (const args of [['config', 'list', '--json'], ['config', 'feature', 'list', '--json'], ['config', 'feature', 'factory', '--json']]) {
  test(`${args.join(' ')} prints all of its JSON to a pipe`, async () => {
    const { code, text } = await run([...args, '--dir', project()]);
    assert.equal(code, 0);
    assert.doesNotThrow(() => JSON.parse(text), 'the output is complete JSON');
    assert.ok(text.length > 500, `${text.length} characters`);
  });
}

test('factory-guard plan-excerpt prints a large plan to its last line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-output-plan-'));
  const filler = Array.from({ length: 1500 }, (_, index) => `- Step ${index + 1}: write the thing and check it carefully.`).join('\n');
  writeFileSync(join(dir, 'PLAN.md'), `# Plan\n\n## Intent Anchor\n\n**Goal:** Ship it.\n\n## Bucket map\n\n| # | Bucket | Output | Status |\n|---|---|---|---|\n| 1 | Big | x | pending |\n\n**Bucket 1: Big**\n\nGoal: big.\n\nSteps:\n${filler}\n\nDone when:\n- the last line is printed (END-OF-PLAN)\n\n- TDD: yes\n- E2E: no\n`);
  const guard = fileURLToPath(new URL('../templates/scripts/factory-guard.mjs', import.meta.url));
  const { code, text } = await run([guard, 'plan-excerpt', '--root', dir], { script: true });
  assert.equal(code, 0);
  assert.ok(text.length > 60000, `${text.length} characters`);
  assert.match(text, /END-OF-PLAN/);
});

test('a change with --json prints its whole plan before the process leaves', async () => {
  const { code, text } = await run(['config', 'feature', 'factory', 'on', 'pr', '--dry-run', '--json', '--dir', project()]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(text).dryRun, true);
});
