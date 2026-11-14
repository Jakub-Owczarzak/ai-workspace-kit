import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from './apply.mjs';
import { formatFeature, formatFeatureList, formatFeaturePlan, getFeature, readFeatures, setFeature } from './features.mjs';
import { init } from './init.mjs';

const CLI = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const KIT = '.claude/workspace-kit';

const project = ({ profile = 'solo', enabled = ['rule.verification'], git = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-features-'));
  if (git) execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ dir });
  apply({ dir, choices: { profile, tools: ['claude-code'], enabled } });
  return dir;
};
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const exists = (dir, path) => existsSync(join(dir, path));
const workflow = (dir) => JSON.parse(read(dir, '.claude/workflow.json'));
const record = (dir) => JSON.parse(read(dir, `${KIT}/choices.json`));
const feature = (dir, id) => getFeature(readFeatures(dir), id);
const tree = (dir, current = dir, out = {}) => {
  for (const name of readdirSync(current)) {
    const full = join(current, name);
    const rel = relative(dir, full).split('\\').join('/');
    if (rel === '.git' || rel === KIT) continue;
    if (statSync(full).isDirectory()) tree(dir, full, out);
    else out[rel] = readFileSync(full, 'utf8');
  }
  return out;
};
const hook = (dir, name) => (exists(dir, `.git/hooks/${name}`) ? read(dir, `.git/hooks/${name}`) : null);

test('the list has every feature in its group, a state for each, and the preset', () => {
  const data = readFeatures(project());
  const ids = data.features.map((item) => item.id);
  for (const id of ['tdd', 'test-guard', 'static-checks', 'claude-checks', 'e2e', 'commit-checks', 'pr-protection', 'changelog', 'factory', 'planning-gate', 'plan-mode', 'figma-sync']) assert.ok(ids.includes(id), id);
  for (const item of data.features) assert.ok(['on', 'off', 'partial'].includes(item.state), `${item.id}: ${item.state}`);
  assert.equal(getFeature(data, 'tdd').state, 'on');
  assert.equal(getFeature(data, 'tdd').level, 'bugs', 'solo default is the bugs level');
  assert.equal(getFeature(data, 'factory').state, 'off');
  assert.equal(getFeature(data, 'protection').state, 'off');
  const text = formatFeatureList(data);
  for (const id of ids) assert.ok(text.includes(id));
  assert.match(text, /\[quality\]/);
  assert.match(text, /protection/);
});

test('tdd: off, on and the bugs level move only the control', () => {
  const dir = project();
  setFeature({ dir, name: 'tdd', state: 'off' });
  assert.equal(workflow(dir).overrides['tests.tdd'], 'off');
  assert.equal(feature(dir, 'tdd').state, 'off');

  setFeature({ dir, name: 'tdd', state: 'on' });
  assert.equal(feature(dir, 'tdd').level, 'on');
  assert.equal(workflow(dir).overrides['tests.tdd'], 'on');

  setFeature({ dir, name: 'tdd', state: 'on', level: 'bugs' });
  assert.deepEqual(workflow(dir).overrides, {}, 'bugs is the solo default, so no override');
  assert.equal(feature(dir, 'tdd').level, 'bugs');
});

test('test-guard: on installs the script and the hook, off removes them and keeps the rule the guard pulled in', () => {
  const dir = project();
  const before = tree(dir);
  setFeature({ dir, name: 'test-guard', state: 'on' });
  assert.ok(exists(dir, 'scripts/test-edit-guard.mjs'));
  assert.equal(JSON.parse(read(dir, '.claude/settings.json')).hooks.PreToolUse.length, 1);
  assert.equal(feature(dir, 'test-guard').state, 'on');

  setFeature({ dir, name: 'test-guard', state: 'off' });
  const { 'CLAUDE.md': rulesAfter, ...restAfter } = tree(dir);
  const { 'CLAUDE.md': rulesBefore, ...restBefore } = before;
  assert.deepEqual(restAfter, restBefore, 'every file of the guard is gone, and workflow.json is as it was');
  assert.match(rulesAfter, /test discipline/i, 'the rule the guard needed stays (C25)');
  assert.doesNotMatch(rulesBefore, /test discipline/i);
  assert.equal(feature(dir, 'test-guard').state, 'off');
});

test('factory: on is local; pr and pr-watch are levels; off removes the factory and keeps what it pulled in', () => {
  const dir = project();
  const plan = setFeature({ dir, name: 'factory', state: 'on' });
  for (const id of ['factory-core', 'skill.run-factory', 'review-gate', 'skill.pr-description', 'check.static']) assert.ok(record(dir).enabled.includes(id), id);
  assert.equal(workflow(dir).overrides['factory.mode'], 'local');
  assert.deepEqual([plan.state, plan.level], ['on', 'on']);
  assert.deepEqual(plan.notes, []);

  const pr = setFeature({ dir, name: 'factory', state: 'on', level: 'pr' });
  assert.equal(workflow(dir).overrides['factory.mode'], 'pr');
  assert.equal(workflow(dir).overrides['factory.ciFixAttempts'], undefined, 'the profile default');
  assert.equal(feature(dir, 'factory').level, 'pr');
  assert.match(pr.notes.join(' '), /pushes feature branches and opens pull requests/);

  setFeature({ dir, name: 'factory', state: 'on', level: 'pr-watch' });
  assert.equal(workflow(dir).overrides['factory.ciFixAttempts'], 0);
  assert.equal(feature(dir, 'factory').level, 'pr-watch');

  setFeature({ dir, name: 'factory', state: 'off' });
  assert.equal(workflow(dir).overrides['factory.mode'], undefined);
  assert.ok(!record(dir).enabled.includes('skill.run-factory'));
  assert.ok(!record(dir).enabled.includes('factory-core'));
  assert.ok(!exists(dir, '.claude/skills/wk-run-factory/SKILL.md'));
  for (const id of ['review-gate', 'skill.pr-description', 'check.static']) assert.ok(record(dir).enabled.includes(id), `${id} stays`);
  assert.equal(feature(dir, 'factory').state, 'off');
});

test('commit-checks: the hook and the docs check go together, with a strict level', () => {
  const dir = project({ git: true });
  setFeature({ dir, name: 'commit-checks', state: 'on' });
  assert.match(hook(dir, 'pre-commit'), /workspace-kit:start pre-commit/);
  assert.equal(feature(dir, 'commit-checks').state, 'on');

  setFeature({ dir, name: 'commit-checks', state: 'on', level: 'strict' });
  assert.equal(workflow(dir).overrides['docs.check'], 'strict');
  assert.equal(feature(dir, 'commit-checks').level, 'strict');

  setFeature({ dir, name: 'commit-checks', state: 'off' });
  assert.equal(hook(dir, 'pre-commit'), null);
  assert.equal(workflow(dir).overrides['docs.check'], 'off');
  assert.equal(feature(dir, 'commit-checks').state, 'off');
});

test('pr-protection: on installs the reviewer, its guard and the push hook; off is refused while the factory needs the gate', () => {
  const dir = project({ git: true });
  setFeature({ dir, name: 'pr-protection', state: 'on' });
  for (const id of ['review-gate', 'check.reviewer-guard', 'hook.pre-push']) assert.ok(record(dir).enabled.includes(id), id);
  assert.match(hook(dir, 'pre-push'), /workspace-kit:start pre-push/);
  assert.equal(feature(dir, 'pr-protection').state, 'on');

  setFeature({ dir, name: 'factory', state: 'on' });
  const before = tree(dir);
  assert.throws(() => setFeature({ dir, name: 'pr-protection', state: 'off' }), /needed by.*skill\.run-factory/s);
  assert.deepEqual(tree(dir), before, 'refused before anything changed');

  setFeature({ dir, name: 'pr-protection', state: 'off', cascade: true });
  assert.ok(!record(dir).enabled.includes('skill.run-factory'));
  assert.equal(hook(dir, 'pre-push'), null);
});

test('changelog: the release level also turns on the release workflow', () => {
  const dir = project();
  setFeature({ dir, name: 'changelog', state: 'on' });
  assert.equal(feature(dir, 'changelog').level, 'on');
  const plan = setFeature({ dir, name: 'changelog', state: 'on', level: 'release' });
  assert.ok(record(dir).enabled.includes('workflow.release-bump'));
  assert.match(plan.notes.join(' '), /protected branch/);
  setFeature({ dir, name: 'changelog', state: 'off' });
  assert.ok(!record(dir).enabled.includes('workflow.release-bump'));
  assert.ok(!record(dir).enabled.includes('skill.changelog-bump'));
});

test('the protection preset turns both of its features on and off', () => {
  const dir = project({ git: true });
  const on = setFeature({ dir, name: 'protection', state: 'on' });
  assert.equal(on.state, 'on');
  assert.equal(feature(dir, 'commit-checks').state, 'on');
  assert.equal(feature(dir, 'pr-protection').state, 'on');
  assert.equal(feature(dir, 'protection').state, 'on');

  setFeature({ dir, name: 'protection', state: 'off' });
  assert.equal(feature(dir, 'commit-checks').state, 'off');
  assert.equal(feature(dir, 'pr-protection').state, 'off');
  assert.equal(hook(dir, 'pre-commit'), null);
  assert.equal(hook(dir, 'pre-push'), null);
  assert.throws(() => setFeature({ dir, name: 'protection', state: 'on', level: 'strict' }), /no levels/);
});

test('a feature with only part of it in place is partial and says what is missing', () => {
  const dir = project({ enabled: ['check.test-edit-guard'] });
  const item = feature(dir, 'test-guard');
  assert.equal(item.state, 'partial');
  assert.match(item.missing.join(' '), /tests\.guard/);
  assert.match(formatFeature(item), /partial/);
});

test('--dry-run shows what would happen and writes nothing', () => {
  const dir = project();
  const before = tree(dir);
  const recordBefore = read(dir, `${KIT}/choices.json`);
  const plan = setFeature({ dir, name: 'factory', state: 'on', level: 'pr', dryRun: true });
  assert.equal(plan.dryRun, true);
  assert.match(formatFeaturePlan(plan), /would/i);
  assert.deepEqual(tree(dir), before);
  assert.equal(read(dir, `${KIT}/choices.json`), recordBefore);
});

test('a feature off says which override it left in workflow.json and how to clear it; --prune also removes what nothing needs', () => {
  const dir = project({ git: true });
  setFeature({ dir, name: 'commit-checks', state: 'on' });
  const off = setFeature({ dir, name: 'commit-checks', state: 'off' });
  const text = formatFeaturePlan(off);
  assert.match(text, /Override kept: docs\.check=off/);
  assert.match(text, /config unset docs\.check/);

  const guard = project();
  setFeature({ dir: guard, name: 'test-guard', state: 'on' });
  const guardOff = setFeature({ dir: guard, name: 'test-guard', state: 'off' });
  assert.doesNotMatch(formatFeaturePlan(guardOff), /Override kept/, 'solo default is already off, so nothing is stored');
  assert.match(formatFeaturePlan(guardOff), /nothing that is on needs them/i);
  assert.ok(record(guard).enabled.includes('rule.test-discipline'));

  setFeature({ dir: guard, name: 'test-guard', state: 'on' });
  setFeature({ dir: guard, name: 'test-guard', state: 'off', prune: true });
  assert.ok(!record(guard).enabled.includes('rule.test-discipline'));
  assert.ok(!record(guard).enabled.includes('control.tests.guard'));
});

test('plan-mode says it is a Claude Code setting when it is turned on', () => {
  const plan = setFeature({ dir: project(), name: 'plan-mode', state: 'on' });
  assert.match(plan.notes.join(' '), /Claude Code setting/);
});

test('an unknown feature or level is refused with what exists', () => {
  const dir = project();
  assert.throws(() => setFeature({ dir, name: 'factry', state: 'on' }), /unknown feature "factry".*factory/s);
  assert.throws(() => setFeature({ dir, name: 'factory', state: 'on', level: 'turbo' }), /unknown level "turbo".*on, pr, pr-watch/s);
  assert.throws(() => setFeature({ dir, name: 'plan-mode', state: 'on', level: 'x' }), /no levels/);
});

test('cli: feature list, detail, on with a level, off, a refusal, and the git diff hint after a real change', () => {
  const dir = project();
  const run = (...args) => spawnSync('node', [CLI, 'config', 'feature', ...args, '--dir', dir], { encoding: 'utf8' });

  const list = run('list', '--json');
  assert.equal(list.status, 0, list.stderr);
  assert.ok(JSON.parse(list.stdout).features.some((item) => item.id === 'factory'));

  const detail = run('factory');
  assert.equal(detail.status, 0, detail.stderr);
  assert.match(detail.stdout, /pr-watch/);

  const preview = run('factory', 'on', 'pr', '--dry-run');
  assert.equal(preview.status, 0, preview.stderr);
  assert.doesNotMatch(preview.stdout, /git diff/);
  assert.ok(!exists(dir, '.claude/skills/wk-run-factory/SKILL.md'));

  const on = run('factory', 'on', 'pr');
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /pushes feature branches/);
  assert.match(on.stdout, /git diff/);
  assert.equal(workflow(dir).overrides['factory.mode'], 'pr');

  const off = run('factory', 'off');
  assert.equal(off.status, 0, off.stderr);
  assert.ok(!exists(dir, '.claude/skills/wk-run-factory/SKILL.md'));

  const bad = run('factry', 'on');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown feature/);
});
