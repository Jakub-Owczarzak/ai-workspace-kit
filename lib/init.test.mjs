import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from './apply.mjs';
import { init, installedKitVersion, TARGET } from './init.mjs';

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

test('an older kit copy blocks the install: nothing is written, the differing files are listed, no version file', () => {
  const dir = tmp();
  const oldSetup = join(dir, TARGET, 'skills', 'setup-workspace', 'SKILL.md');
  mkdirSync(join(dir, TARGET, 'skills', 'setup-workspace'), { recursive: true });
  writeFileSync(oldSetup, 'OLD SETUP SKILL');
  const result = init({ dir });
  assert.equal(result.blocked, true);
  assert.deepEqual(result.skipped, [join('skills', 'setup-workspace', 'SKILL.md')]);
  assert.equal(readFileSync(oldSetup, 'utf8'), 'OLD SETUP SKILL');
  assert.ok(!existsSync(join(dir, TARGET, 'catalog')), 'no half-upgraded kit');
  assert.ok(!existsSync(join(dir, TARGET, '.kit-version')));
  assert.equal(installedKitVersion(dir), null);
});

test('apply refuses to run on a kit folder that init did not complete', () => {
  const dir = tmp();
  mkdirSync(join(dir, TARGET, 'skills', 'setup-workspace'), { recursive: true });
  writeFileSync(join(dir, TARGET, 'skills', 'setup-workspace', 'SKILL.md'), 'OLD');
  init({ dir });
  assert.throws(() => apply({ dir, choices: { enabled: [] } }), /missing or incomplete/);
});

test('force upgrades an older copy completely', () => {
  const dir = tmp();
  mkdirSync(join(dir, TARGET, 'skills', 'setup-workspace'), { recursive: true });
  writeFileSync(join(dir, TARGET, 'skills', 'setup-workspace', 'SKILL.md'), 'OLD');
  const result = init({ dir, force: true });
  assert.equal(result.blocked, false);
  assert.notEqual(readFileSync(join(dir, TARGET, 'skills', 'setup-workspace', 'SKILL.md'), 'utf8'), 'OLD');
  assert.ok(existsSync(join(dir, TARGET, 'catalog', 'options.json')));
  assert.notEqual(installedKitVersion(dir), null);
});
