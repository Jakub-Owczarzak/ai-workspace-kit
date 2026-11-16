import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from './apply.mjs';
import { GROUPS, formatGet, formatList, getOption, readSetup } from './config.mjs';
import { init } from './init.mjs';

const CLI = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const CATALOG = JSON.parse(readFileSync(fileURLToPath(new URL('../catalog/options.json', import.meta.url)), 'utf8'));

const installed = (choices) => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-config-'));
  init({ dir });
  apply({ dir, choices: { tools: ['claude-code'], ...choices } });
  return dir;
};
const byId = (setup, id) => setup.options.find((option) => option.id === id);

test('a folder without the kit is reported clearly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-config-empty-'));
  assert.throws(() => readSetup(dir), /kit folder/);
});

test('every catalog option appears exactly once and sits in a known group', () => {
  const setup = readSetup(installed({ profile: 'solo', enabled: ['rule.verification'] }));
  assert.deepEqual(setup.options.map((option) => option.id).sort(), CATALOG.options.map((option) => option.id).sort());
  for (const option of setup.options) assert.ok(GROUPS.includes(option.group), `${option.id} has group ${option.group}`);
});

test('options chosen are on, the others off, and a required option says who needs it', () => {
  const setup = readSetup(installed({ profile: 'solo', enabled: ['skill.run-factory'] }));
  assert.equal(byId(setup, 'skill.run-factory').state, 'on');
  assert.equal(byId(setup, 'rule.skill-routing').state, 'off');
  const core = byId(setup, 'factory-core');
  assert.equal(core.state, 'on', 'added because skill.run-factory needs it');
  assert.ok(core.requiredBy.includes('skill.run-factory'));
});

test('a control shows the value the scripts use and where it comes from', () => {
  const solo = readSetup(installed({ profile: 'solo', enabled: ['control.docs.check'], overrides: { 'docs.check': 'strict' } }));
  assert.equal(byId(solo, 'control.docs.check').state, 'strict');
  assert.equal(byId(solo, 'control.docs.check').source, 'overrides');
  assert.equal(solo.profile, 'solo');

  const team = readSetup(installed({ profile: 'team', enabled: ['control.docs.check'] }));
  assert.equal(team.profile, 'team');
  assert.match(byId(team, 'control.docs.check').source, /^profile:team$/);
  const controls = (setup) => setup.options.filter((option) => option.kind === 'control').map((option) => option.state);
  assert.notDeepEqual(controls(solo), controls(team), 'profiles differ in at least one control');
});

test('an option whose requirement is off lists what is missing', () => {
  const dir = installed({ profile: 'solo', enabled: ['control.tests.tdd'] });
  const recordPath = join(dir, '.claude/workspace-kit/choices.json');
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  record.enabled = record.enabled.filter((id) => id !== 'rule.test-discipline');
  writeFileSync(recordPath, JSON.stringify(record));
  assert.deepEqual(byId(readSetup(dir), 'control.tests.tdd').missing, ['rule.test-discipline']);
});

test('an off option says what turning it on adds; a broken on option says it is broken', () => {
  const setup = readSetup(installed({ profile: 'solo', enabled: ['rule.verification'] }));
  const off = formatList(setup, { group: 'tests' }).split('\n').find((line) => line.includes('check.test-edit-guard'));
  assert.match(off, /turning on also adds/);
  assert.doesNotMatch(off, /BROKEN|\(needs/);

  const dir = installed({ profile: 'solo', enabled: ['control.tests.tdd'] });
  const recordPath = join(dir, '.claude/workspace-kit/choices.json');
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  record.enabled = record.enabled.filter((id) => id !== 'rule.test-discipline');
  writeFileSync(recordPath, JSON.stringify(record));
  const broken = formatList(readSetup(dir), { group: 'tests' }).split('\n').find((line) => line.includes('control.tests.tdd'));
  assert.match(broken, /BROKEN: needs rule\.test-discipline/);
});

test('a control that is on while the option that makes it work is off gets a hint, with the command that fixes it', () => {
  const team = readSetup(installed({ profile: 'team', enabled: ['rule.verification'] }));
  const hint = team.hints.find((entry) => entry.option === 'check.test-edit-guard');
  assert.ok(hint, 'tests.guard is on for team, the guard is not installed');
  assert.equal(hint.control, 'tests.guard');
  assert.match(hint.text, /config on check\.test-edit-guard/);
  assert.match(formatList(team), /Hints:[\s\S]*config on check\.test-edit-guard/);
  assert.doesNotMatch(formatList(team, { group: 'docs' }), /check\.test-edit-guard/, 'a group view shows only its own hints');

  const solo = readSetup(installed({ profile: 'solo', enabled: ['rule.verification'] }));
  assert.ok(!solo.hints.some((entry) => entry.option === 'check.test-edit-guard'), 'tests.guard is off for solo');

  const fixed = readSetup(installed({ profile: 'team', enabled: ['check.test-edit-guard'] }));
  assert.ok(!fixed.hints.some((entry) => entry.option === 'check.test-edit-guard'));
});

test('an install without a record says so instead of guessing', () => {
  const dir = installed({ profile: 'solo', enabled: ['rule.verification'] });
  rmSync(join(dir, '.claude/workspace-kit/choices.json'));
  const setup = readSetup(dir);
  assert.equal(byId(setup, 'rule.verification').state, 'unknown');
  assert.match(setup.warnings.join(' '), /choices\.json/);
});

test('getOption finds one option and rejects an unknown id with a hint', () => {
  const setup = readSetup(installed({ profile: 'solo', enabled: ['rule.verification'] }));
  assert.equal(getOption(setup, 'rule.verification').id, 'rule.verification');
  assert.throws(() => getOption(setup, 'rule.verifcation'), /unknown option "rule\.verifcation".*rule\.verification/s);
});

test('the list is grouped, can be limited to one group, and rejects an unknown group', () => {
  const setup = readSetup(installed({ profile: 'solo', enabled: ['rule.verification'] }));
  const text = formatList(setup);
  assert.match(text, /Profile: solo/);
  for (const option of setup.options) assert.ok(text.includes(option.id), `${option.id} listed`);
  const tests = formatList(setup, { group: 'tests' });
  assert.ok(tests.includes('control.tests.tdd'));
  assert.ok(!tests.includes('rule.verification'));
  assert.throws(() => formatList(setup, { group: 'nope' }), /unknown group "nope".*tests/s);
});

test('get prints what the option does, its state, and what it needs', () => {
  const setup = readSetup(installed({ profile: 'solo', enabled: ['skill.run-factory'] }));
  const text = formatGet(getOption(setup, 'skill.run-factory'));
  assert.match(text, /skill\.run-factory/);
  assert.match(text, /state:\s+on/);
  assert.match(text, /needs:.*factory-core/);
});

test('cli: config list --json and config get work on an installed project', () => {
  const dir = installed({ profile: 'team', enabled: ['rule.verification'] });
  const run = (...args) => spawnSync('node', [CLI, 'config', ...args, '--dir', dir], { encoding: 'utf8' });

  const list = run('list', '--json');
  assert.equal(list.status, 0, list.stderr);
  const parsed = JSON.parse(list.stdout);
  assert.equal(parsed.profile, 'team');
  assert.equal(parsed.options.length, CATALOG.options.length);

  const get = run('get', 'rule.verification');
  assert.equal(get.status, 0, get.stderr);
  assert.match(get.stdout, /state:\s+on/);

  const bad = run('get', 'rule.nope');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown option/);

  const none = spawnSync('node', [CLI, 'config', 'list', '--dir', mkdtempSync(join(tmpdir(), 'wk-config-none-'))], { encoding: 'utf8' });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /kit folder/);
});
