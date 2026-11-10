import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init, TARGET } from './init.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'wk-'));

test('copies the kit and the version file, never the dev tests', () => {
  const dir = tmp();
  const r = init({ dir });
  assert.ok(r.created.length > 0);
  assert.ok(existsSync(join(dir, TARGET, 'skills', 'setup-workspace', 'SKILL.md')));
  assert.ok(existsSync(join(dir, TARGET, '.kit-version')));
  assert.ok(!r.created.some((f) => f.endsWith('.test.mjs')));
  assert.ok(!existsSync(join(dir, TARGET, 'templates', 'scripts', 'check-config.test.mjs')));
  assert.ok(existsSync(join(dir, TARGET, 'templates', 'scripts', 'check-config.mjs')));
});

test('a second run changes nothing', () => {
  const dir = tmp();
  init({ dir });
  const r = init({ dir });
  assert.equal(r.created.length, 0);
  assert.equal(r.skipped.length, 0);
});

test('dry run writes nothing', () => {
  const dir = tmp();
  const r = init({ dir, dryRun: true });
  assert.ok(r.created.length > 0);
  assert.ok(!existsSync(join(dir, TARGET)));
});

test('a modified file is skipped, and replaced only with force', () => {
  const dir = tmp();
  init({ dir });
  const f = join(dir, TARGET, 'rules', 'verification.md');
  writeFileSync(f, 'mine');
  assert.deepEqual(init({ dir }).skipped, [join('rules', 'verification.md')]);
  assert.equal(readFileSync(f, 'utf8'), 'mine');
  init({ dir, force: true });
  assert.notEqual(readFileSync(f, 'utf8'), 'mine');
});
