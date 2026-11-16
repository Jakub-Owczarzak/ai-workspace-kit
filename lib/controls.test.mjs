import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from './apply.mjs';
import { readSetup } from './config.mjs';
import { formatProfilePlan, setControl, setProfile } from './controls.mjs';
import { init } from './init.mjs';
import { uninstall } from './uninstall.mjs';

const CLI = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const KIT = '.claude/workspace-kit';
const CATALOG = JSON.parse(readFileSync(fileURLToPath(new URL('../catalog/options.json', import.meta.url)), 'utf8'));

const project = ({ profile = 'solo', enabled = ['rule.verification'], overrides = {} } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-controls-'));
  init({ dir });
  apply({ dir, choices: { profile, tools: ['claude-code'], enabled, overrides } });
  return dir;
};
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const workflow = (dir) => JSON.parse(read(dir, '.claude/workflow.json'));
const record = (dir) => JSON.parse(read(dir, `${KIT}/choices.json`));
const state = (dir, id) => readSetup(dir).options.find((option) => option.id === id);

test('set writes an override, keeps the other keys and the indentation, and keeps choices.json in step', () => {
  const dir = project();
  const file = '.claude/workflow.json';
  writeFileSync(join(dir, file), JSON.stringify({ _comment: 'mine', ...workflow(dir) }, null, 2) + '\n');

  const plan = setControl({ dir, name: 'tests.tdd', value: 'on' });
  assert.equal(plan.before.value, 'bugs');
  assert.equal(plan.after.value, 'on');
  assert.equal(workflow(dir).overrides['tests.tdd'], 'on');
  assert.match(read(dir, file), /_comment/);
  assert.match(read(dir, file), /\n {2}"profile"/, 'two-space indentation kept');
  assert.equal(record(dir).overrides['tests.tdd'], 'on');
  assert.equal(state(dir, 'control.tests.tdd').state, 'on');
  assert.equal(state(dir, 'control.tests.tdd').source, 'overrides');
});

test('a workflow file the kit wrote and only config changed is still the kit\'s: an uninstall removes it', () => {
  const dir = project();
  setControl({ dir, name: 'docs.check', value: 'strict' });
  setProfile({ dir, profile: 'team' });
  const report = uninstall({ dir, yes: true });
  assert.ok(report.removedFiles.includes('.claude/workflow.json'));
  assert.ok(!existsSync(join(dir, '.claude/workflow.json')));
});

test('a workflow file you edited by hand stays yours, even after config changed it too', () => {
  const dir = project();
  const path = join(dir, '.claude/workflow.json');
  writeFileSync(path, JSON.stringify({ _comment: 'mine', ...workflow(dir) }, null, 2) + '\n');
  setControl({ dir, name: 'docs.check', value: 'strict' });
  const report = uninstall({ dir, yes: true });
  assert.ok(report.keptFiles.some((item) => item.path === '.claude/workflow.json'));
  assert.ok(existsSync(path));
});

test('running the setup again with its old answers does not make the record disagree with workflow.json', () => {
  const dir = project({ profile: 'solo' });
  setProfile({ dir, profile: 'team' });
  setControl({ dir, name: 'docs.check', value: 'strict' });
  const fileBefore = read(dir, '.claude/workflow.json');

  // The old answers: profile solo, no overrides. The workflow file is the project's and is left alone...
  apply({ dir, choices: { profile: 'solo', tools: ['claude-code'], enabled: ['rule.verification'], overrides: {} } });
  assert.equal(read(dir, '.claude/workflow.json'), fileBefore);
  // ...and the record follows the file, because that is what the scripts read.
  assert.equal(record(dir).profile, 'team');
  assert.deepEqual(record(dir).overrides, { 'docs.check': 'strict' });
});

test('a record is written from the answers when there is no usable workflow file', () => {
  const dir = project({ profile: 'solo' });
  rmSync(join(dir, '.claude/workflow.json'));
  apply({ dir, choices: { profile: 'org', tools: ['claude-code'], enabled: ['rule.verification'], overrides: { 'docs.check': 'off' } } });
  assert.equal(record(dir).profile, 'org');
  assert.deepEqual(record(dir).overrides, { 'docs.check': 'off' });

  writeFileSync(join(dir, '.claude/workflow.json'), '{ not json');
  apply({ dir, choices: { profile: 'team', tools: ['claude-code'], enabled: ['rule.verification'], overrides: {} }, force: false });
  assert.equal(record(dir).profile, 'team', 'a broken file cannot be mirrored');
});

test('a catalog id works as well as the short name, and numbers and booleans keep their type', () => {
  const dir = project();
  setControl({ dir, name: 'control.factory.ciFixAttempts', value: '5' });
  setControl({ dir, name: 'static.checks', value: 'off' });
  assert.equal(workflow(dir).overrides['factory.ciFixAttempts'], 5);
  assert.equal(workflow(dir).overrides['static.checks'], false);
});

test('a value outside the allowed list, and an unknown control, change nothing and say what is allowed', () => {
  const dir = project();
  const before = read(dir, '.claude/workflow.json');
  assert.throws(() => setControl({ dir, name: 'docs.check', value: 'loud' }), /allowed: off, warn, strict/);
  assert.throws(() => setControl({ dir, name: 'docs.chek', value: 'warn' }), /unknown control "docs\.chek".*docs\.check/s);
  assert.throws(() => setControl({ dir, name: 'factory.ciFixAttempts', value: '-1' }), /not a valid value/);
  assert.equal(read(dir, '.claude/workflow.json'), before);
});

test('a value equal to the profile default removes the override; unset and "default" do too', () => {
  const dir = project();
  setControl({ dir, name: 'docs.check', value: 'strict' });
  assert.equal(workflow(dir).overrides['docs.check'], 'strict');
  const back = setControl({ dir, name: 'docs.check', value: 'warn' });
  assert.equal(back.overrideRemoved, true);
  assert.deepEqual(workflow(dir).overrides, {});

  setControl({ dir, name: 'docs.check', value: 'off' });
  setControl({ dir, name: 'docs.check', value: 'default' });
  assert.deepEqual(workflow(dir).overrides, {});
  assert.deepEqual(record(dir).overrides, {});
});

test('a workflow file that is not valid JSON is refused and left alone', () => {
  const dir = project();
  writeFileSync(join(dir, '.claude/workflow.json'), '{ "profile": "solo", // mine\n}\n');
  const before = read(dir, '.claude/workflow.json');
  assert.throws(() => setControl({ dir, name: 'tests.tdd', value: 'on' }), /not valid JSON/);
  assert.equal(read(dir, '.claude/workflow.json'), before);
});

test('a missing workflow file is created from the recorded profile', () => {
  const dir = project({ profile: 'team' });
  rmSync(join(dir, '.claude/workflow.json'));
  setControl({ dir, name: 'docs.check', value: 'strict' });
  assert.deepEqual(workflow(dir), { profile: 'team', overrides: { 'docs.check': 'strict' } });
});

test('turning a control on also turns on what it needs, and says so; turning it off removes nothing', () => {
  const dir = project({ enabled: ['rule.verification'] });
  assert.ok(!record(dir).enabled.includes('rule.test-discipline'));
  const plan = setControl({ dir, name: 'tests.tdd', value: 'on' });
  assert.ok(plan.addedRequirements.includes('rule.test-discipline'));
  assert.ok(record(dir).enabled.includes('rule.test-discipline'));
  assert.match(read(dir, 'CLAUDE.md'), /test discipline/i);

  setControl({ dir, name: 'tests.tdd', value: 'off' });
  assert.ok(record(dir).enabled.includes('rule.test-discipline'), 'off does not remove the rule');
});

test('--dry-run shows the change and writes nothing', () => {
  const dir = project({ enabled: ['rule.verification'] });
  const workflowBefore = read(dir, '.claude/workflow.json');
  const recordBefore = read(dir, `${KIT}/choices.json`);
  const plan = setControl({ dir, name: 'tests.tdd', value: 'on', dryRun: true });
  assert.equal(plan.after.value, 'on');
  assert.ok(plan.addedRequirements.includes('rule.test-discipline'));
  assert.equal(read(dir, '.claude/workflow.json'), workflowBefore);
  assert.equal(read(dir, `${KIT}/choices.json`), recordBefore);
});

test('an environment variable that wins over the file is mentioned', () => {
  const dir = project();
  const plan = setControl({ dir, name: 'docs.check', value: 'strict', env: { DOCS_CHECK: 'off' } });
  assert.match(plan.warnings.join(' '), /DOCS_CHECK/);
});

test('profile: the profile changes, every override stays, and the plan lists what moves', () => {
  const dir = project({ profile: 'solo', overrides: { 'docs.check': 'strict' } });
  const plan = setProfile({ dir, profile: 'team' });
  assert.equal(plan.from, 'solo');
  assert.equal(plan.to, 'team');
  assert.equal(workflow(dir).profile, 'team');
  assert.equal(workflow(dir).overrides['docs.check'], 'strict');
  assert.equal(record(dir).profile, 'team');
  const guard = plan.changes.find((change) => change.control === 'tests.guard');
  assert.deepEqual([guard.before, guard.after], ['off', 'on']);
  assert.ok(!plan.changes.some((change) => change.control === 'docs.check'), 'overridden, so it does not move');
  assert.deepEqual(plan.overridden.map((item) => item.control), ['docs.check']);
});

test('profile: it lists the options that are newly on by default and not installed, and installs none unless asked', () => {
  const dir = project({ profile: 'solo' });
  const plan = setProfile({ dir, profile: 'team' });
  const expected = CATALOG.options
    .filter((option) => option.kind !== 'control' && !option.appliesWhen)
    .filter((option) => {
      const on = (profile) => option.default === true || option.default?.[profile] === true;
      return on('team') && !on('solo') && !record(dir).enabled.includes(option.id);
    })
    .map((option) => option.id);
  assert.ok(expected.includes('check.test-edit-guard'));
  assert.deepEqual(plan.missingDefaults.map((item) => item.id).sort(), expected.sort());
  assert.ok(!existsSync(join(dir, 'scripts/test-edit-guard.mjs')));
  assert.match(readSetup(dir).hints.map((hint) => hint.text).join(' '), /check\.test-edit-guard/);
});

test('profile --install-defaults turns those on and turns nothing off', () => {
  const dir = project({ profile: 'solo', enabled: ['rule.verification', 'skill.pr-description'] });
  const before = new Set(record(dir).enabled);
  const plan = setProfile({ dir, profile: 'team', installDefaults: true });
  assert.ok(plan.installed.turnedOn.includes('check.test-edit-guard'));
  assert.ok(existsSync(join(dir, 'scripts/test-edit-guard.mjs')));
  for (const id of before) assert.ok(record(dir).enabled.includes(id), `${id} is still on`);
  assert.equal(readSetup(dir).hints.length, 0);
});

test('profile --install-defaults on the profile you already have installs what it adds over solo', () => {
  const dir = project({ profile: 'solo' });
  setProfile({ dir, profile: 'team' });
  assert.ok(!existsSync(join(dir, 'scripts/test-edit-guard.mjs')), 'switching alone installed nothing');

  const plan = setProfile({ dir, profile: 'team', installDefaults: true });
  assert.ok(plan.installed.turnedOn.includes('check.test-edit-guard'));
  assert.ok(existsSync(join(dir, 'scripts/test-edit-guard.mjs')));
  assert.equal(workflow(dir).profile, 'team');
  assert.equal(setProfile({ dir, profile: 'team', installDefaults: true }).changed, false, 'nothing left to install');
});

test('profile: a piece whose control the switch turns off is reported as installed but idle, with the command that removes it', () => {
  const dir = project({ profile: 'team', enabled: ['check.test-edit-guard'] });
  const plan = setProfile({ dir, profile: 'solo' });
  assert.deepEqual(plan.idlePieces.map((item) => item.id), ['check.test-edit-guard']);
  const text = formatProfilePlan(plan);
  assert.match(text, /installed but now idle/i);
  assert.match(text, /config off check\.test-edit-guard/);
  assert.ok(existsSync(join(dir, 'scripts/test-edit-guard.mjs')), 'nothing was removed');
});

test('profile: installing on the profile you already have does not print an arrow from team to team', () => {
  const dir = project({ profile: 'team' });
  const text = formatProfilePlan(setProfile({ dir, profile: 'team', installDefaults: true }));
  assert.match(text, /Profile: team \(unchanged\)/);
  assert.doesNotMatch(text, /team -> team/);
});

test('profile: going back leaves the file as it was; the same profile is a no-op; an unknown one is refused', () => {
  const dir = project({ profile: 'solo', overrides: { 'tests.tdd': 'on' } });
  const before = read(dir, '.claude/workflow.json');
  setProfile({ dir, profile: 'org' });
  assert.equal(workflow(dir).profile, 'org');
  setProfile({ dir, profile: 'solo' });
  assert.equal(read(dir, '.claude/workflow.json'), before);

  assert.equal(setProfile({ dir, profile: 'solo' }).changed, false);
  assert.throws(() => setProfile({ dir, profile: 'enterprise' }), /unknown profile "enterprise".*solo, team, org/);
});

test('profile --dry-run writes nothing', () => {
  const dir = project({ profile: 'solo' });
  const workflowBefore = read(dir, '.claude/workflow.json');
  const recordBefore = read(dir, `${KIT}/choices.json`);
  const plan = setProfile({ dir, profile: 'org', installDefaults: true, dryRun: true });
  assert.equal(plan.to, 'org');
  assert.equal(read(dir, '.claude/workflow.json'), workflowBefore);
  assert.equal(read(dir, `${KIT}/choices.json`), recordBefore);
  assert.ok(!existsSync(join(dir, 'scripts/test-edit-guard.mjs')));
});

test('cli: set, unset and profile, with a refusal', () => {
  const dir = project({ profile: 'solo' });
  const run = (...args) => spawnSync('node', [CLI, 'config', ...args, '--dir', dir], { encoding: 'utf8' });

  const set = run('set', 'docs.check', 'strict');
  assert.equal(set.status, 0, set.stderr);
  assert.match(set.stdout, /docs\.check/);
  assert.equal(workflow(dir).overrides['docs.check'], 'strict');

  const unset = run('unset', 'docs.check');
  assert.equal(unset.status, 0, unset.stderr);
  assert.deepEqual(workflow(dir).overrides, {});

  const preview = run('profile', 'org', '--dry-run');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /would/i);
  assert.equal(workflow(dir).profile, 'solo');

  const real = run('profile', 'team');
  assert.equal(real.status, 0, real.stderr);
  assert.equal(workflow(dir).profile, 'team');

  const bad = run('set', 'docs.check', 'loud');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /allowed/);
  assert.equal(run('set', 'docs.check').status, 1);
});
