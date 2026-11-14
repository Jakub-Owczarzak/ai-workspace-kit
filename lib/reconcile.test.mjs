import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from './apply.mjs';
import { init } from './init.mjs';
import { formatPlan, setOptions } from './reconcile.mjs';
import { targetsFor } from './tools.mjs';
import { uninstall } from './uninstall.mjs';

const CLI = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const KIT = '.claude/workspace-kit';
const { rulesFile } = targetsFor(['claude-code']);

const project = (choices, { git = false, files = {}, gitConfig = null } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-reconcile-'));
  if (git || gitConfig) execFileSync('git', ['init', '-q'], { cwd: dir });
  if (gitConfig) execFileSync('git', ['config', ...gitConfig], { cwd: dir });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  init({ dir });
  apply({ dir, choices: { profile: 'solo', tools: ['claude-code'], ...choices } });
  return dir;
};
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const exists = (dir, path) => existsSync(join(dir, path));
const record = (dir) => JSON.parse(read(dir, `${KIT}/choices.json`));
const manifest = (dir) => JSON.parse(read(dir, `${KIT}/manifest.json`));

/** Every file outside .git and the kit folder, with its content: what a user would see in the project. */
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
const snapshot = (dir) => ({ tree: tree(dir), manifest: manifest(dir), enabled: [...record(dir).enabled].sort() });

test('apply reports what it would keep: blocks, settings flags and the package script', () => {
  const dir = project({ enabled: ['rule.verification', 'check.static', 'check.test-edit-guard'] }, { files: { 'package.json': '{"name":"x","scripts":{}}\n' } });
  const { wanted } = apply({ dir, choices: { profile: 'solo', tools: ['claude-code'], enabled: ['rule.verification', 'check.static', 'check.test-edit-guard'] }, dryRun: true });
  assert.ok(wanted.blocks.some((block) => block.file === rulesFile && block.id === 'rules'));
  assert.ok(wanted.blocks.some((block) => block.id === 'gitignore'));
  assert.equal(wanted.settings.guardHook, true);
  assert.equal(wanted.settings.reviewerGuard, false);
  assert.equal(wanted.packageScript, true);
});

test('off removes a skill and its manifest entries; on puts it back exactly', () => {
  const dir = project({ enabled: ['skill.pr-description', 'skill.readable-fix-plan', 'rule.verification'] });
  const before = snapshot(dir);
  assert.ok(exists(dir, '.claude/skills/wk-pr-description/SKILL.md'));

  const off = setOptions({ dir, off: ['skill.pr-description'] });
  assert.deepEqual(off.turnedOff, ['skill.pr-description']);
  assert.ok(!exists(dir, '.claude/skills/wk-pr-description/SKILL.md'));
  assert.ok(exists(dir, '.claude/skills/wk-readable-fix-plan/SKILL.md'), 'another skill is untouched');
  assert.ok(!record(dir).enabled.includes('skill.pr-description'));
  assert.ok(!Object.keys(manifest(dir).files).some((path) => path.includes('wk-pr-description')));

  setOptions({ dir, on: ['skill.pr-description'] });
  assert.deepEqual(snapshot(dir), before);
});

test('the enabled list is kept in catalog order, so a second off and on changes nothing at all', () => {
  const dir = project({ enabled: ['rule.verification', 'rule.readable-code', 'skill.pr-description'] });
  setOptions({ dir, off: ['skill.pr-description'] });
  setOptions({ dir, on: ['skill.pr-description'] });
  const settled = snapshot(dir);
  const block = read(dir, rulesFile);
  assert.ok(block.indexOf('readable, self-documenting code') < block.indexOf('verify, and report honestly'), 'catalog order');

  setOptions({ dir, off: ['skill.pr-description'] });
  setOptions({ dir, on: ['skill.pr-description'] });
  assert.deepEqual(snapshot(dir), settled);
});

test('a file two options install stays while the other one is on', () => {
  const dir = project({ enabled: ['check.static', 'hook.pre-commit'] }, { git: true });
  assert.ok(exists(dir, 'scripts/workflow-config.mjs'));
  assert.ok(exists(dir, 'scripts/check-config.mjs'));

  const plan = setOptions({ dir, off: ['check.static'] });
  assert.ok(!exists(dir, 'scripts/check-config.mjs'), 'only check.static installs it');
  assert.ok(exists(dir, 'scripts/workflow-config.mjs'), 'hook.pre-commit installs it too');
  assert.deepEqual(plan.warnings, []);
});

test('the review gate keeps the profile resolver it reads when check.static goes', () => {
  const dir = project({ enabled: ['check.static', 'review-gate'] });
  const plan = setOptions({ dir, off: ['check.static'] });
  assert.ok(exists(dir, 'scripts/workflow-config.mjs'));
  assert.deepEqual(plan.warnings, []);
});

test('with an older kit copy that does not tie the review gate to the resolver, removing it warns', () => {
  const dir = project({ enabled: ['check.static', 'review-gate'] });
  const catalogPath = join(dir, KIT, 'catalog/options.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const gate = catalog.options.find((option) => option.id === 'review-gate');
  gate.installs = gate.installs.filter((file) => !file.endsWith('workflow-config.mjs'));
  writeFileSync(catalogPath, JSON.stringify(catalog));

  const plan = setOptions({ dir, off: ['check.static'] });
  assert.ok(!exists(dir, 'scripts/workflow-config.mjs'));
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /check-review-gate\.mjs/);
  assert.match(plan.warnings[0], /workflow-config\.mjs/);
});

test('package.json comes back byte for byte when nobody touched it after the kit; your edits are kept when somebody did', () => {
  const odd = '{"name":"x","version":"1.0.0","scripts":{"test":"echo ok"}}\n'; // compact, not the kit's indentation
  for (const how of ['config', 'uninstall']) {
    const dir = project({ enabled: ['check.static'] }, { files: { 'package.json': odd } });
    assert.notEqual(read(dir, 'package.json'), odd, 'the kit added check:config and re-indented');
    assert.ok(JSON.parse(read(dir, 'package.json')).scripts['check:config']);
    if (how === 'config') setOptions({ dir, off: ['check.static'] });
    else uninstall({ dir, yes: true });
    assert.equal(read(dir, 'package.json'), odd, `after ${how}`);
  }

  const edited = project({ enabled: ['check.static'] }, { files: { 'package.json': odd } });
  const data = JSON.parse(read(edited, 'package.json'));
  data.dependencies = { left: '1.0.0' };
  writeFileSync(join(edited, 'package.json'), JSON.stringify(data, null, 2) + '\n');
  setOptions({ dir: edited, off: ['check.static'] });
  const after = JSON.parse(read(edited, 'package.json'));
  assert.deepEqual(after.dependencies, { left: '1.0.0' }, 'your own edit is kept');
  assert.equal(after.scripts['check:config'], undefined);
  assert.equal(after.scripts.test, 'echo ok');
});

test('the check:config script and the .gitignore block go with their options, and a file the kit created goes when it is empty', () => {
  const dir = project({ enabled: ['check.static', 'review-gate'] }, { files: { 'package.json': '{\n  "name": "x",\n  "scripts": { "test": "echo ok" }\n}\n' } });
  assert.ok(JSON.parse(read(dir, 'package.json')).scripts['check:config']);
  assert.match(read(dir, '.gitignore'), /\.claude\/reviews\//);

  const first = setOptions({ dir, off: ['check.static'] });
  assert.equal(first.packageScript, true);
  assert.deepEqual(JSON.parse(read(dir, 'package.json')).scripts, { test: 'echo ok' });

  setOptions({ dir, off: ['review-gate'] });
  assert.ok(!exists(dir, '.gitignore'), 'the kit created .gitignore and nothing else was in it');
});

test('the rules block shrinks, then disappears with the last rule; the user text stays', () => {
  const mine = '# Mine\n\nAlways answer in Polish.\n';
  const dir = project({ enabled: ['rule.verification', 'rule.readable-code'] }, { files: { [rulesFile]: mine } });
  assert.match(read(dir, rulesFile), /workspace-kit:start rules/);

  setOptions({ dir, off: ['rule.verification'] });
  const middle = read(dir, rulesFile);
  assert.match(middle, /workspace-kit:start rules/);
  assert.doesNotMatch(middle, /verify, and report honestly/i);
  assert.match(middle, /readable, self-documenting code/i);

  setOptions({ dir, off: ['rule.readable-code'] });
  assert.equal(read(dir, rulesFile), mine);
});

test('a file the kit created is deleted with its last block', () => {
  const dir = project({ enabled: ['rule.verification'] });
  assert.ok(exists(dir, rulesFile));
  setOptions({ dir, off: ['rule.verification'] });
  assert.ok(!exists(dir, rulesFile));
});

test('applying choices that turn on again what config turned off says so; config on itself does not', () => {
  const answers = { profile: 'solo', tools: ['claude-code'], enabled: ['rule.verification', 'skill.pr-description', 'skill.readable-fix-plan'] };
  const dir = project({ enabled: answers.enabled });
  const off = setOptions({ dir, off: ['skill.readable-fix-plan'] });
  assert.deepEqual(off.apply.notices.filter((note) => /turned on again/i.test(note)), []);

  const again = apply({ dir, choices: answers });
  const note = again.notices.find((item) => /turned on again/i.test(item));
  assert.ok(note, 'a notice names it');
  assert.match(note, /skill\.readable-fix-plan/);
  assert.doesNotMatch(note, /skill\.pr-description/, 'only what was off');

  assert.equal(apply({ dir, choices: answers }).notices.some((item) => /turned on again/i.test(item)), false, 'said once');

  setOptions({ dir, off: ['skill.readable-fix-plan'] });
  const on = setOptions({ dir, on: ['skill.readable-fix-plan'] });
  assert.equal(on.apply.notices.some((item) => /turned on again/i.test(item)), false, 'the user just asked for it');
});

test('off then on gives byte-identical manifest.json and settings.json, whatever order the pieces were switched in', () => {
  const mine = { permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const dir = project({ enabled: ['hook.pre-commit', 'hook.pre-push', 'check.test-edit-guard', 'check.reviewer-guard', 'rule.verification'] }, { git: true, files: { '.claude/settings.json': JSON.stringify(mine, null, 2) + '\n' } });
  const manifestBefore = read(dir, `${KIT}/manifest.json`);
  const settingsBefore = read(dir, '.claude/settings.json');

  for (const id of ['hook.pre-commit', 'hook.pre-push', 'check.test-edit-guard', 'check.reviewer-guard']) {
    setOptions({ dir, off: [id] });
    setOptions({ dir, on: [id] });
    assert.equal(read(dir, '.claude/settings.json'), settingsBefore, `settings.json after ${id} off+on`);
    assert.equal(read(dir, `${KIT}/manifest.json`), manifestBefore, `manifest.json after ${id} off+on`);
  }

  // Installed in the other order, the kit's entries still end up in the same order, after yours.
  const other = project({ enabled: ['rule.verification', 'check.reviewer-guard'] }, { files: { '.claude/settings.json': JSON.stringify(mine, null, 2) + '\n' } });
  setOptions({ dir: other, on: ['check.test-edit-guard'] });
  const commands = JSON.parse(read(other, '.claude/settings.json')).hooks.PreToolUse.map((entry) => entry.hooks[0].command);
  assert.deepEqual(commands.map((command) => command.match(/test-edit-guard|reviewer-bash-guard|mine/)?.[0]), ['mine', 'test-edit-guard', 'reviewer-bash-guard']);
});

test('off lists what nothing needs any more, and --prune turns those off too', () => {
  const dir = project({ enabled: ['rule.verification', 'check.test-edit-guard'] });
  assert.ok(record(dir).enabled.includes('control.tests.guard'));
  assert.ok(record(dir).enabled.includes('rule.test-discipline'));

  const plan = setOptions({ dir, off: ['check.test-edit-guard'], dryRun: true });
  assert.deepEqual([...plan.unneeded].sort(), ['control.tests.guard', 'rule.test-discipline']);
  const text = formatPlan(plan);
  assert.match(text, /nothing that is on needs them/i);
  assert.match(text, /config off control\.tests\.guard rule\.test-discipline|--prune/);

  const kept = setOptions({ dir, off: ['check.test-edit-guard'] });
  assert.ok(record(dir).enabled.includes('rule.test-discipline'), 'still on without --prune');
  assert.deepEqual([...kept.unneeded].sort(), ['control.tests.guard', 'rule.test-discipline']);

  setOptions({ dir, on: ['check.test-edit-guard'] });
  const pruned = setOptions({ dir, off: ['check.test-edit-guard'], prune: true });
  assert.deepEqual([...pruned.pruned].sort(), ['control.tests.guard', 'rule.test-discipline']);
  assert.ok(!record(dir).enabled.includes('rule.test-discipline'));
  assert.ok(!record(dir).enabled.includes('control.tests.guard'));
  assert.doesNotMatch(read(dir, rulesFile), /test discipline/i);
});

test('something that stays on and needs an option keeps it out of the unneeded list', () => {
  const dir = project({ enabled: ['rule.verification', 'control.tests.tdd', 'check.test-edit-guard'] });
  const plan = setOptions({ dir, off: ['check.test-edit-guard'], prune: true });
  assert.deepEqual(plan.pruned, ['control.tests.guard']);
  assert.ok(record(dir).enabled.includes('rule.test-discipline'), 'control.tests.tdd still needs the rule');
});

test('search-ignore: a marked .ignore block keeps the kit folder out of searches; your own lines stay; off and uninstall remove only the block', () => {
  const mine = '# my own ignore rules\nbuild-output/\n';
  const dir = project({ enabled: ['rule.verification', 'setting.search-ignore'] }, { files: { '.ignore': mine } });
  const text = read(dir, '.ignore');
  assert.ok(text.startsWith(mine), 'your lines come first');
  assert.match(text, /workspace-kit:start ignore/);
  assert.match(text, /^\.claude\/workspace-kit\/$/m);

  setOptions({ dir, off: ['setting.search-ignore'] });
  assert.equal(read(dir, '.ignore'), mine);
  setOptions({ dir, on: ['setting.search-ignore'] });
  assert.ok(read(dir, '.ignore').startsWith(mine));
  assert.match(read(dir, '.ignore'), /^\.claude\/workspace-kit\/$/m);

  uninstall({ dir, yes: true });
  assert.equal(read(dir, '.ignore'), mine);
});

test('search-ignore: a .ignore file the kit created goes with its block', () => {
  const dir = project({ enabled: ['rule.verification', 'setting.search-ignore'] });
  assert.ok(exists(dir, '.ignore'));
  setOptions({ dir, off: ['setting.search-ignore'] });
  assert.ok(!exists(dir, '.ignore'));
  setOptions({ dir, on: ['setting.search-ignore'] });
  assert.ok(exists(dir, '.ignore'));
  uninstall({ dir, yes: true });
  assert.ok(!exists(dir, '.ignore'));
});

test('a kit file you edited is kept and named, and stays tracked so that an uninstall still deals with it', () => {
  const dir = project({ enabled: ['skill.pr-description'] });
  const edited = '.claude/skills/wk-pr-description/SKILL.md';
  writeFileSync(join(dir, edited), read(dir, edited) + '\nMy own note.\n');

  const plan = setOptions({ dir, off: ['skill.pr-description'] });
  assert.ok(plan.keptFiles.some((item) => item.path === edited));
  assert.match(read(dir, edited), /My own note/);
  assert.ok(!exists(dir, '.claude/skills/wk-pr-description/triggers.json'), 'the unedited files went');
  assert.ok(manifest(dir).files[edited], 'still in the manifest');

  // Uninstall treats a wk- skill file as the kit's even when edited, and says so; it is not left behind in silence.
  const report = uninstall({ dir, yes: true });
  assert.ok(report.removedEdited.some((item) => item.path === edited));
  assert.ok(!exists(dir, edited));
});

test('a kept edited script that is not a skill file is listed by the uninstall as kept', () => {
  const dir = project({ enabled: ['check.static', 'hook.pre-commit'] }, { git: true });
  writeFileSync(join(dir, 'scripts/check-config.mjs'), read(dir, 'scripts/check-config.mjs') + '\n// my change\n');
  const plan = setOptions({ dir, off: ['check.static'] });
  assert.ok(plan.keptFiles.some((item) => item.path === 'scripts/check-config.mjs'));
  const report = uninstall({ dir, yes: true });
  assert.ok(report.keptFiles.some((item) => item.path === 'scripts/check-config.mjs'), 'named by the uninstall too');
  assert.match(read(dir, 'scripts/check-config.mjs'), /my change/);
});

test('off is refused while another enabled option needs it, and nothing changes', () => {
  const dir = project({ enabled: ['skill.run-factory'] });
  const before = snapshot(dir);
  assert.throws(() => setOptions({ dir, off: ['review-gate'] }), /needed by.*skill\.run-factory/s);
  assert.deepEqual(snapshot(dir), before);
});

test('--cascade turns the dependents off too', () => {
  const dir = project({ enabled: ['skill.run-factory'] });
  const plan = setOptions({ dir, off: ['factory-core'], cascade: true });
  assert.ok(plan.cascaded.includes('skill.run-factory'));
  assert.ok(!record(dir).enabled.includes('skill.run-factory'));
  assert.ok(!exists(dir, '.claude/skills/wk-run-factory/SKILL.md'));
});

test('on adds what the option needs and says so', () => {
  const dir = project({ enabled: ['rule.verification'] });
  const plan = setOptions({ dir, on: ['skill.run-factory'] });
  for (const id of ['factory-core', 'review-gate', 'skill.pr-description']) assert.ok(plan.addedRequirements.includes(id), id);
  assert.ok(exists(dir, '.claude/skills/wk-run-factory/SKILL.md'));
  assert.ok(record(dir).enabled.includes('factory-core'));
});

test('--dry-run changes nothing and shows the same plan as the real run', () => {
  const dir = project({ enabled: ['skill.pr-description', 'check.static', 'review-gate'] });
  const before = snapshot(dir);
  const preview = setOptions({ dir, off: ['skill.pr-description'], dryRun: true });
  assert.deepEqual(snapshot(dir), before);
  const real = setOptions({ dir, off: ['skill.pr-description'] });
  assert.deepEqual(preview.removedFiles, real.removedFiles);
  assert.ok(preview.removedFiles.length > 0);
});

test('turning off something already off does nothing', () => {
  const dir = project({ enabled: ['rule.verification'] });
  const before = snapshot(dir);
  const plan = setOptions({ dir, off: ['skill.figma-sync'] });
  assert.equal(plan.changed, false);
  assert.deepEqual(snapshot(dir), before);
});

test('a control is refused with a pointer to config set; an unknown id is refused', () => {
  const dir = project({ enabled: ['rule.verification'] });
  assert.throws(() => setOptions({ dir, off: ['control.docs.check'] }), /config set/);
  assert.throws(() => setOptions({ dir, on: ['skill.nope'] }), /unknown option "skill\.nope"/);
});

const hookText = (dir, name) => (exists(dir, `.git/hooks/${name}`) ? read(dir, `.git/hooks/${name}`) : null);

test('off cuts the kit block from a git hook, deletes a hook file the kit created, and on puts it back', () => {
  const dir = project({ enabled: ['hook.pre-commit'] }, { git: true });
  const installedHook = hookText(dir, 'pre-commit');
  assert.match(installedHook, /workspace-kit:start pre-commit/);

  setOptions({ dir, off: ['hook.pre-commit'] });
  assert.equal(hookText(dir, 'pre-commit'), null, 'the kit created that file and nothing else was in it');

  setOptions({ dir, on: ['hook.pre-commit'] });
  assert.equal(hookText(dir, 'pre-commit'), installedHook);
});

test("a hook's own lines are never touched by off or on", () => {
  const mine = '#!/bin/sh\necho "my own check"\n';
  const dir = project({ enabled: ['hook.pre-commit'] }, { git: true, files: { '.git/hooks/pre-commit': mine } });
  assert.ok(hookText(dir, 'pre-commit').startsWith(mine));

  setOptions({ dir, off: ['hook.pre-commit'] });
  assert.equal(hookText(dir, 'pre-commit'), mine);

  setOptions({ dir, on: ['hook.pre-commit'] });
  assert.ok(hookText(dir, 'pre-commit').startsWith(mine));
  assert.match(hookText(dir, 'pre-commit'), /workspace-kit:start pre-commit/);
});

test('turning off an option the hook block is built from refreshes the block instead of refusing', () => {
  const dir = project({ enabled: ['hook.pre-commit', 'skill.changelog-bump'] }, { git: true });
  assert.match(hookText(dir, 'pre-commit'), /CHANGELOG_SCRIPT/);

  setOptions({ dir, off: ['skill.changelog-bump'] });
  const after = hookText(dir, 'pre-commit');
  assert.match(after, /workspace-kit:start pre-commit/);
  assert.doesNotMatch(after, /CHANGELOG_SCRIPT/);

  setOptions({ dir, on: ['skill.changelog-bump'] });
  assert.match(hookText(dir, 'pre-commit'), /CHANGELOG_SCRIPT/);
});

test('Husky: the kit block goes into .husky/pre-commit, off and uninstall put the user hook back exactly, and a hook the kit created goes whole', () => {
  const husky = '#!/bin/sh\n. "$(dirname "$0")/_/husky.sh"\nnpm test\n';
  const dir = project({ enabled: ['hook.pre-commit', 'hook.pre-push'] }, { git: true, files: { '.husky/pre-commit': husky, '.husky/_/husky.sh': '# husky\n' } });
  assert.ok(read(dir, '.husky/pre-commit').startsWith(husky));
  assert.match(read(dir, '.husky/pre-commit'), /workspace-kit:start pre-commit/);
  assert.match(read(dir, '.husky/pre-push'), /workspace-kit:start pre-push/);
  assert.ok(!exists(dir, '.git/hooks/pre-push'), 'nothing was written into .git/hooks');

  setOptions({ dir, off: ['hook.pre-commit', 'hook.pre-push'] });
  assert.equal(read(dir, '.husky/pre-commit'), husky);
  assert.ok(!exists(dir, '.husky/pre-push'), 'the kit created that file');
  setOptions({ dir, on: ['hook.pre-commit', 'hook.pre-push'] });
  assert.match(read(dir, '.husky/pre-commit'), /workspace-kit:start pre-commit/);

  uninstall({ dir, yes: true });
  assert.equal(read(dir, '.husky/pre-commit'), husky);
  assert.ok(!exists(dir, '.husky/pre-push'));
});

test('core.hooksPath: the kit block goes into the configured folder, and off puts the user hook back', () => {
  const mine = '#!/bin/sh\necho "my own check"\n';
  const dir = project({ enabled: ['hook.pre-commit'] }, { gitConfig: ['core.hooksPath', '.githooks'], files: { '.githooks/pre-commit': mine } });
  assert.ok(read(dir, '.githooks/pre-commit').startsWith(mine));
  assert.match(read(dir, '.githooks/pre-commit'), /workspace-kit:start pre-commit/);
  assert.ok(!exists(dir, '.git/hooks/pre-commit'), 'the default folder was not used');

  setOptions({ dir, off: ['hook.pre-commit'] });
  assert.equal(read(dir, '.githooks/pre-commit'), mine);
  setOptions({ dir, on: ['hook.pre-commit'] });
  assert.ok(read(dir, '.githooks/pre-commit').startsWith(mine));
  uninstall({ dir, yes: true });
  assert.equal(read(dir, '.githooks/pre-commit'), mine);
});

test('the pre-push hook goes with its option; the review gate it needs is refused until --cascade', () => {
  const dir = project({ enabled: ['hook.pre-push'] }, { git: true });
  assert.match(hookText(dir, 'pre-push'), /workspace-kit:start pre-push/);
  assert.throws(() => setOptions({ dir, off: ['review-gate'] }), /needed by.*hook\.pre-push/s);

  setOptions({ dir, off: ['hook.pre-push'] });
  assert.equal(hookText(dir, 'pre-push'), null);
  assert.ok(record(dir).enabled.includes('review-gate'), 'the gate stays on');

  setOptions({ dir, on: ['hook.pre-push'] });
  setOptions({ dir, off: ['review-gate'], cascade: true });
  assert.equal(hookText(dir, 'pre-push'), null);
  assert.ok(!exists(dir, 'scripts/check-review-gate.mjs'));
});

const SETTINGS = '.claude/settings.json';
const settingsOf = (dir) => JSON.parse(read(dir, SETTINGS));

test('off removes the settings hook the kit added, deletes a settings file it created, and on puts it back', () => {
  const dir = project({ enabled: ['check.test-edit-guard'] });
  const before = snapshot(dir);
  assert.ok(settingsOf(dir).hooks.PreToolUse.length === 1);

  const plan = setOptions({ dir, off: ['check.test-edit-guard'] });
  assert.ok(plan.removedSettings.removed.length > 0);
  assert.ok(!exists(dir, SETTINGS), 'the kit created the file and nothing else was in it');
  assert.ok(!exists(dir, 'scripts/test-edit-guard.mjs'));

  setOptions({ dir, on: ['check.test-edit-guard'] });
  assert.deepEqual(snapshot(dir), before);
});

test("a settings file's own keys and hooks survive off and on; only the kit's entry goes", () => {
  const mine = { permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const dir = project({ enabled: ['check.test-edit-guard', 'check.reviewer-guard'] }, { files: { [SETTINGS]: JSON.stringify(mine, null, 2) + '\n' } });
  assert.equal(settingsOf(dir).hooks.PreToolUse.length, 3);

  setOptions({ dir, off: ['check.reviewer-guard'] });
  const afterReviewer = settingsOf(dir);
  assert.equal(afterReviewer.hooks.PreToolUse.length, 2, 'the test-edit guard and yours stay');
  assert.ok(afterReviewer.hooks.PreToolUse.some((entry) => entry.hooks[0].command === 'echo mine'));

  setOptions({ dir, off: ['check.test-edit-guard'] });
  assert.deepEqual(settingsOf(dir), mine);

  setOptions({ dir, on: ['check.test-edit-guard', 'check.reviewer-guard'] });
  assert.equal(settingsOf(dir).hooks.PreToolUse.length, 3);
  assert.deepEqual(settingsOf(dir).permissions, mine.permissions);
});

test('plan mode is removed only while it still says plan', () => {
  const dir = project({ enabled: ['setting.plan-mode-default', 'check.test-edit-guard'] });
  assert.equal(settingsOf(dir).permissions.defaultMode, 'plan');
  setOptions({ dir, off: ['setting.plan-mode-default'] });
  assert.equal(settingsOf(dir).permissions, undefined);

  setOptions({ dir, on: ['setting.plan-mode-default'] });
  const changed = settingsOf(dir);
  changed.permissions.defaultMode = 'acceptEdits';
  writeFileSync(join(dir, SETTINGS), JSON.stringify(changed, null, 2) + '\n');
  const plan = setOptions({ dir, off: ['setting.plan-mode-default'] });
  assert.equal(settingsOf(dir).permissions.defaultMode, 'acceptEdits', 'your value stays');
  assert.ok(plan.keptFiles.some((item) => item.path === SETTINGS));
});

test('a settings file that is not strict JSON refuses the whole change before anything is touched', () => {
  const dir = project({ enabled: ['check.test-edit-guard'] });
  writeFileSync(join(dir, SETTINGS), read(dir, SETTINGS) + '// my comment\n');
  const before = snapshot(dir);
  assert.throws(() => setOptions({ dir, off: ['check.test-edit-guard'] }), /not strict JSON/);
  assert.deepEqual(snapshot(dir), before);
  assert.ok(exists(dir, 'scripts/test-edit-guard.mjs'), 'the script the hook runs is still there');
});

test('--dry-run reports the settings change and writes nothing', () => {
  const dir = project({ enabled: ['check.test-edit-guard'] });
  const before = snapshot(dir);
  const plan = setOptions({ dir, off: ['check.test-edit-guard'], dryRun: true });
  assert.ok(plan.removedSettings.removed.length > 0);
  assert.deepEqual(snapshot(dir), before);
});

test('a project without a record cannot be changed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-reconcile-bare-'));
  init({ dir });
  assert.throws(() => setOptions({ dir, off: ['rule.verification'] }), /choices\.json/);
});

test('cli: config off --dry-run, config off, config on, and a refusal', () => {
  const dir = project({ enabled: ['skill.pr-description', 'rule.verification'] });
  const run = (...args) => spawnSync('node', [CLI, 'config', ...args, '--dir', dir], { encoding: 'utf8' });

  const preview = run('off', 'skill.pr-description', '--dry-run');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /would remove/i);
  assert.ok(exists(dir, '.claude/skills/wk-pr-description/SKILL.md'));

  const off = run('off', 'skill.pr-description');
  assert.equal(off.status, 0, off.stderr);
  assert.ok(!exists(dir, '.claude/skills/wk-pr-description/SKILL.md'));

  const on = run('on', 'skill.pr-description');
  assert.equal(on.status, 0, on.stderr);
  assert.ok(exists(dir, '.claude/skills/wk-pr-description/SKILL.md'));

  const bad = run('off', 'control.docs.check');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /config set/);
});
