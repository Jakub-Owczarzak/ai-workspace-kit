import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { apply } from './apply.mjs';
import { init, TARGET } from './init.mjs';
import { loadManifest } from './manifest.mjs';
import { uninstall } from './uninstall.mjs';

// ---- helpers ----------------------------------------------------------------------------------------------------

const created = [];
const tempProject = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-uninstall-'));
  created.push(dir);
  return dir;
};
test.after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

const write = (dir, relativePath, content) => {
  mkdirSync(dirname(join(dir, relativePath)), { recursive: true });
  writeFileSync(join(dir, relativePath), content);
};
const read = (dir, relativePath) => readFileSync(join(dir, relativePath), 'utf8');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

/** Every file (with its content) and every folder under a project, except what git keeps in .git. */
function snapshot(dir) {
  const files = {};
  const dirs = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const rel = relative(dir, full).split('\\').join('/');
      if (rel === '.git') continue;
      if (entry.isDirectory()) {
        dirs.push(rel);
        walk(full);
      } else files[rel] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return { files, dirs: dirs.sort() };
}

/** A project with plenty of its own things, a git repository and husky. */
function messyProject() {
  const dir = tempProject();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  write(dir, 'CLAUDE.md', '# Mine\n\nAlways answer in Polish.\n');
  write(dir, 'AGENTS.md', '# Overview\n\nA demo project.\n');
  write(dir, '.gitignore', 'node_modules/\n.env\n');
  write(dir, 'package.json', json({ name: 'demo', version: '1.0.0', scripts: { test: 'vitest' } }));
  write(dir, '.claude/settings.json', json({ permissions: { allow: ['Bash(npm test)'] }, env: { A: '1' } }));
  write(dir, '.husky/pre-commit', 'npx lint-staged\n');
  write(dir, '.claude/skills/pr-description/SKILL.md', 'MY OWN pr-description SKILL');
  write(dir, 'scripts/my-own.mjs', 'console.log("mine");\n');
  return dir;
}

const EVERYTHING = {
  profile: 'team',
  tools: ['claude-code', 'cursor'],
  enabled: [
    'rule.verification', 'rule.readable-code', 'skill.pr-description', 'skill.changelog-bump', 'skill.workspace-router',
    'hook.pre-commit', 'hook.pre-push', 'review-gate', 'check.static', 'check.test-edit-guard', 'factory-core', 'check.e2e-shots', 'skill.e2e-tests', 'skill.run-factory',
    'setting.plan-mode-default', 'template.plan-file', 'template.backlog', 'workflow.release-bump',
  ],
  project: {
    commands: { lint: 'npm run lint', test: 'npm test' },
    protectedBranch: 'main',
    versionFiles: ['package.json:version'],
  },
};

const install = (dir, choices = EVERYTHING) => {
  init({ dir });
  return apply({ dir, choices });
};

// ---- the round trip ---------------------------------------------------------------------------------------------

test('install everything, uninstall: the project is exactly as it was before the kit', () => {
  const dir = messyProject();
  const before = snapshot(dir);
  install(dir);
  assert.notDeepEqual(snapshot(dir), before, 'the install must have changed something');

  const report = uninstall({ dir, yes: true });
  const after = snapshot(dir);
  assert.deepEqual(after.files, before.files, 'every file is back to its original content, and no file is left over');
  assert.deepEqual(after.dirs, before.dirs, 'no empty folder is left behind');
  assert.equal(report.kitFolder, 'removed');
  assert.deepEqual(report.keptFiles, []);
});

test('the same, on a project that has no files of its own at all', () => {
  const dir = tempProject();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const before = snapshot(dir);
  install(dir, { ...EVERYTHING, tools: ['claude-code'] });
  uninstall({ dir, yes: true });
  assert.deepEqual(snapshot(dir), before);
});

test('your own skill with the plain name, and your own scripts, are never touched', () => {
  const dir = messyProject();
  install(dir);
  uninstall({ dir, yes: true });
  assert.equal(read(dir, '.claude/skills/pr-description/SKILL.md'), 'MY OWN pr-description SKILL');
  assert.equal(read(dir, 'scripts/my-own.mjs'), 'console.log("mine");\n');
});

// ---- nothing is changed without --yes ---------------------------------------------------------------------------

test('without --yes it only previews: not a single byte changes', () => {
  const dir = messyProject();
  install(dir);
  const before = snapshot(dir);
  const preview = uninstall({ dir });
  assert.equal(preview.applied, false);
  assert.ok(preview.removedFiles.length > 10, 'the preview lists what it would remove');
  assert.equal(preview.kitFolder, 'would be removed');
  assert.deepEqual(snapshot(dir), before);
});

test('the preview and the real run agree on what is removed', () => {
  const dir = messyProject();
  install(dir);
  const preview = uninstall({ dir });
  const real = uninstall({ dir, yes: true });
  assert.deepEqual(real.removedFiles, preview.removedFiles);
  assert.deepEqual(real.blocks, preview.blocks);
  assert.deepEqual(real.removedDirs, preview.removedDirs);
});

test('a second uninstall finds nothing to do', () => {
  const dir = messyProject();
  install(dir);
  uninstall({ dir, yes: true });
  assert.equal(uninstall({ dir, yes: true }).nothingToDo, true);
});

// ---- what you changed is yours ----------------------------------------------------------------------------------

test('a file the kit created but you edited since is kept, and said so', () => {
  const dir = messyProject();
  install(dir);
  write(dir, 'PLAN.md', '# My real plan\n\nThis is mine now.\n');
  const report = uninstall({ dir, yes: true });
  assert.equal(read(dir, 'PLAN.md'), '# My real plan\n\nThis is mine now.\n');
  assert.ok(report.keptFiles.some((item) => item.path === 'PLAN.md' && /yours now/.test(item.reason)));
});

test('an installed wk- skill is removed even when it was filled in or edited, and the report says it was edited', () => {
  // The setup fills project facts into some skills (the router's tables), so after setup they never match what the kit
  // wrote. The wk- prefix marks a skill as kit-managed (apply --force overwrites edits to it too).
  const dir = messyProject();
  install(dir);
  write(dir, '.claude/skills/wk-pr-description/SKILL.md', 'edited by me');
  const report = uninstall({ dir, yes: true });
  assert.ok(!existsSync(join(dir, '.claude/skills/wk-pr-description')), 'the whole skill folder is gone');
  assert.ok(!existsSync(join(dir, '.claude/skills/wk-changelog-bump')));
  assert.ok(report.removedEdited.some((item) => item.path.endsWith('wk-pr-description/SKILL.md') && /wk-/.test(item.reason)));
  assert.ok(!report.keptFiles.some((item) => item.path.includes('wk-pr-description')));
  assert.equal(read(dir, '.claude/skills/pr-description/SKILL.md'), 'MY OWN pr-description SKILL', 'a skill without the wk- prefix is yours');
});

test('a file converted to Windows line endings after the install still counts as unchanged', () => {
  const dir = messyProject();
  install(dir);
  writeFileSync(join(dir, 'REVIEW.md'), readFileSync(join(dir, 'REVIEW.md'), 'utf8').replace(/\n/g, '\r\n'));
  const report = uninstall({ dir, yes: true });
  assert.ok(!existsSync(join(dir, 'REVIEW.md')), 'CRLF is not an edit');
  assert.ok(!report.keptFiles.some((item) => item.path === 'REVIEW.md'));
});

test('an instruction file the kit created is deleted; one you added text to keeps your text', () => {
  const dir = tempProject();
  const choices = { profile: 'solo', tools: ['claude-code'], enabled: ['rule.verification'] };
  install(dir, choices);
  assert.ok(existsSync(join(dir, 'CLAUDE.md')));
  uninstall({ dir, yes: true });
  assert.ok(!existsSync(join(dir, 'CLAUDE.md')), 'nothing but the kit block was in it');

  const other = tempProject();
  install(other, choices);
  writeFileSync(join(other, 'CLAUDE.md'), read(other, 'CLAUDE.md') + '\nMy note\n');
  uninstall({ dir: other, yes: true });
  assert.equal(read(other, 'CLAUDE.md'), 'My note\n');
});

test('a block you already removed by hand is not an error, and the rest of the file is left alone', () => {
  const dir = messyProject();
  install(dir);
  writeFileSync(join(dir, 'AGENTS.md'), '# Overview\n\nRewritten by me, no kit block.\n');
  assert.doesNotThrow(() => uninstall({ dir, yes: true }));
  assert.equal(read(dir, 'AGENTS.md'), '# Overview\n\nRewritten by me, no kit block.\n');
});

// ---- settings.json and package.json -----------------------------------------------------------------------------

test('settings.json: only the keys the kit added are removed; a value you changed since is kept', () => {
  const dir = messyProject();
  install(dir);
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  settings.permissions.defaultMode = 'acceptEdits'; // you changed it after the install
  write(dir, '.claude/settings.json', json(settings));
  uninstall({ dir, yes: true });
  const after = JSON.parse(read(dir, '.claude/settings.json'));
  assert.equal(after.permissions.defaultMode, 'acceptEdits');
  assert.deepEqual(after.permissions.allow, ['Bash(npm test)']);
  assert.equal(after.env.A, '1');
  assert.equal(after.hooks, undefined, 'the guard hook the kit added is gone');
});

test('settings.json you had set yourself before the install is never touched', () => {
  const dir = tempProject();
  const mine = {
    permissions: { defaultMode: 'acceptEdits' },
    hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node scripts/test-edit-guard.mjs' }] }] },
  };
  write(dir, '.claude/settings.json', json(mine));
  install(dir, { profile: 'team', tools: ['claude-code'], enabled: ['setting.plan-mode-default', 'check.test-edit-guard'] });
  uninstall({ dir, yes: true });
  assert.equal(read(dir, '.claude/settings.json'), json(mine));
});

test('settings.json with comments is reported for you to edit, and nothing else stops', () => {
  const dir = tempProject();
  install(dir, { profile: 'team', tools: ['claude-code'], enabled: ['setting.plan-mode-default', 'rule.verification'] });
  // the file did not exist, so the kit created strict JSON; you then added a comment to it
  write(dir, '.claude/settings.json', '{\n  // my note\n  "permissions": { "defaultMode": "plan" }\n}\n');
  const report = uninstall({ dir, yes: true });
  assert.ok(report.manual.some((item) => item.path.endsWith('settings.json') && /strict JSON/.test(item.reason)));
  assert.match(read(dir, '.claude/settings.json'), /my note/);
  assert.ok(!existsSync(join(dir, 'CLAUDE.md')), 'the rest was still removed');
});

test('package.json: the script the kit added is removed, one you changed is kept', () => {
  const dir = messyProject();
  install(dir);
  // the install used Claude Code and Cursor, so the shortcut names both skills folders
  assert.equal(JSON.parse(read(dir, 'package.json')).scripts['check:config'], 'node scripts/check-config.mjs --skills-dir .claude/skills --skills-dir .agents/skills');
  uninstall({ dir, yes: true });
  assert.equal(read(dir, 'package.json'), json({ name: 'demo', version: '1.0.0', scripts: { test: 'vitest' } }));

  const other = messyProject();
  install(other);
  const edited = JSON.parse(read(other, 'package.json'));
  edited.scripts['check:config'] = 'node scripts/check-config.mjs --strict';
  write(other, 'package.json', json(edited));
  const report = uninstall({ dir: other, yes: true });
  assert.equal(JSON.parse(read(other, 'package.json')).scripts['check:config'], 'node scripts/check-config.mjs --strict');
  assert.ok(report.keptFiles.some((item) => item.path === 'package.json'));
});

// ---- hooks and git ----------------------------------------------------------------------------------------------

test('a hook file the kit created is deleted but the .git/hooks folder stays; a hook of yours keeps its lines', () => {
  const dir = tempProject();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  install(dir, { profile: 'team', tools: ['claude-code'], enabled: ['hook.pre-commit'], project: { commands: { test: 'npm test' } } });
  assert.ok(existsSync(join(dir, '.git/hooks/pre-commit')));
  uninstall({ dir, yes: true });
  assert.ok(!existsSync(join(dir, '.git/hooks/pre-commit')));
  assert.ok(existsSync(join(dir, '.git/hooks')), 'nothing inside .git is ever pruned');

  const husky = messyProject();
  install(husky);
  uninstall({ dir: husky, yes: true });
  assert.equal(read(husky, '.husky/pre-commit'), 'npx lint-staged\n');
  assert.ok(!existsSync(join(husky, '.husky/pre-push')), 'the pre-push hook the kit created is gone');
});

// ---- the kit folder, and what the kit does not track ------------------------------------------------------------

test('--keep-kit leaves the kit folder, with a fresh record, so the setup can be run again', () => {
  const dir = messyProject();
  const before = snapshot(dir);
  install(dir);
  const report = uninstall({ dir, yes: true, keepKit: true });
  assert.equal(report.kitFolder, 'kept');
  assert.ok(existsSync(join(dir, TARGET, 'catalog', 'options.json')));
  assert.deepEqual(loadManifest(dir).files, {});
  // everything outside the kit folder is back to the original
  const after = snapshot(dir);
  for (const path of Object.keys(after.files)) {
    if (!path.startsWith('.claude/workspace-kit/')) assert.equal(after.files[path], before.files[path], path);
  }
  // and it can be installed and removed again
  apply({ dir, choices: EVERYTHING });
  uninstall({ dir, yes: true });
  assert.deepEqual(snapshot(dir), before);
});

test('only init was run: the kit folder is removed and nothing else is touched', () => {
  const dir = messyProject();
  const before = snapshot(dir);
  init({ dir });
  uninstall({ dir, yes: true });
  assert.deepEqual(snapshot(dir), before);
});

test('a kit folder with answers but no manifest (installed by a version without one) stops with a clear message', () => {
  const dir = messyProject();
  install(dir);
  rmSync(join(dir, TARGET, 'manifest.json'));
  const before = snapshot(dir);
  assert.throws(() => uninstall({ dir, yes: true }), /no manifest\.json.*Nothing was changed/s);
  assert.deepEqual(snapshot(dir), before);
});

test('it says so when an instruction file still imports from the kit folder, and mentions leftover state', () => {
  const dir = messyProject();
  install(dir);
  write(dir, 'CLAUDE.md', read(dir, 'CLAUDE.md') + '\n@.claude/workspace-kit/rules/verification.md\n');
  mkdirSync(join(dir, '.claude', 'reviews'), { recursive: true });
  const report = uninstall({ dir, yes: true });
  assert.ok(report.notices.some((note) => /CLAUDE\.md still imports files from the kit folder/.test(note)));
  assert.ok(report.notices.some((note) => /\.claude\/reviews\//.test(note)));
  assert.ok(existsSync(join(dir, '.claude/reviews')), 'review records are not deleted');
});

test('a project that never had the kit: nothing to uninstall', () => {
  const dir = messyProject();
  const before = snapshot(dir);
  assert.equal(uninstall({ dir, yes: true }).nothingToDo, true);
  assert.deepEqual(snapshot(dir), before);
});

// ---- apply keeps an accurate record -----------------------------------------------------------------------------

test('the manifest lists what the kit created, not what was already there', () => {
  const dir = messyProject();
  install(dir);
  const manifest = loadManifest(dir);
  assert.ok(manifest.files['.claude/skills/wk-pr-description/SKILL.md']);
  assert.equal(manifest.files['.claude/skills/pr-description/SKILL.md'], undefined, 'your skill is not recorded');
  assert.equal(manifest.files['scripts/my-own.mjs'], undefined, 'your script is not recorded');
  assert.equal(manifest.files['CLAUDE.md'], undefined, 'a file you already had is not recorded as created');
  assert.ok(manifest.blocks.some((block) => block.file === 'AGENTS.md' && block.id === 'rules' && block.createdFile === false));
});

test('running apply again does not change the record', () => {
  const dir = messyProject();
  install(dir);
  const first = readFileSync(join(dir, TARGET, 'manifest.json'), 'utf8');
  apply({ dir, choices: EVERYTHING });
  assert.equal(readFileSync(join(dir, TARGET, 'manifest.json'), 'utf8'), first);
});

test('a dry run of apply does not touch the record', () => {
  const dir = messyProject();
  init({ dir });
  apply({ dir, choices: EVERYTHING, dryRun: true });
  assert.equal(existsSync(join(dir, TARGET, 'manifest.json')), false);
});

// ---- leftovers: the cleanup prompt and --purge ------------------------------------------------------------------

const commitAll = (dir) => {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '--no-verify', '-m', 'snapshot'], { cwd: dir });
};

/** What working with the kit does to the files it created: the planner fills PLAN.md, a review is noted, the factory is switched on. */
const workWithTheKit = (dir) => {
  write(dir, 'PLAN.md', '# My real plan\n\nGoal: add farewell()\n');
  write(dir, 'REVIEW.md', read(dir, 'REVIEW.md') + '\n- Check the greeting text.\n');
  write(dir, '.claude/workflow.json', json({ profile: 'team', overrides: { 'factory.mode': 'local' } }));
  write(dir, '.claude/reviews/report.md', 'review notes');
  write(dir, '.claude/state/fix-mode.json', '{}');
  write(dir, '.claude/factory/state.json', '{}');
};

test('a normal uninstall prints a cleanup prompt that names every leftover, and the prompt text comes from docs/uninstall-prompt.md', () => {
  const dir = messyProject();
  install(dir);
  workWithTheKit(dir);
  const report = uninstall({ dir, yes: true });
  assert.equal(typeof report.cleanupPrompt, 'string');
  for (const leftover of ['PLAN.md', 'REVIEW.md', '.claude/workflow.json', '.claude/reviews/', '.claude/state/', '.claude/factory/']) {
    assert.ok(report.cleanupPrompt.includes(leftover), `the prompt lists ${leftover}`);
  }
  assert.match(report.cleanupPrompt, /Touch only the items on this list/);
  assert.ok(!report.cleanupPrompt.includes('{{LEFTOVERS}}'), 'the placeholder is filled in');
  assert.ok(readFileSync(new URL('../docs/uninstall-prompt.md', import.meta.url), 'utf8').includes('Touch only the items on this list'), 'one source for the wording');
});

test('an instruction file the kit created and you added text to is listed in the prompt, because it is still there', () => {
  const dir = tempProject();
  install(dir, { profile: 'solo', tools: ['cursor'], enabled: ['rule.verification'] });
  write(dir, 'AGENTS.md', '# My project overview\n\nWritten by the overview skill.\n\n' + read(dir, 'AGENTS.md'));
  const report = uninstall({ dir, yes: true });
  assert.ok(existsSync(join(dir, 'AGENTS.md')), 'your text is kept');
  assert.ok(!read(dir, 'AGENTS.md').includes('workspace-kit:start'), 'the kit block is gone');
  assert.match(report.cleanupPrompt, /AGENTS\.md \(the kit created this file/);

  const existing = messyProject(); // an AGENTS.md you already had is yours: never listed
  install(existing);
  assert.equal(uninstall({ dir: existing, yes: true }).cleanupPrompt, null);
});

test('the files named in the prompt are still there after a normal uninstall; nothing else of the kit is', () => {
  const dir = messyProject();
  install(dir);
  workWithTheKit(dir);
  uninstall({ dir, yes: true });
  assert.equal(read(dir, 'PLAN.md'), '# My real plan\n\nGoal: add farewell()\n');
  assert.ok(existsSync(join(dir, '.claude/workflow.json')));
  assert.ok(!existsSync(join(dir, TARGET)));
  assert.ok(!existsSync(join(dir, 'scripts/check-config.mjs')));
});

test('with nothing left over there is no cleanup prompt', () => {
  const dir = messyProject();
  install(dir);
  assert.equal(uninstall({ dir, yes: true }).cleanupPrompt, null);
});

test('the preview carries the same prompt and the same list as the real run, and changes nothing', () => {
  const dir = messyProject();
  install(dir);
  workWithTheKit(dir);
  const before = snapshot(dir);
  const preview = uninstall({ dir });
  assert.deepEqual(snapshot(dir), before);
  assert.equal(preview.cleanupPrompt, uninstall({ dir, yes: true }).cleanupPrompt);
});

test('--purge removes the kit-created files you edited, and the kit data folders, and leaves the project as it was', () => {
  const dir = messyProject();
  const before = snapshot(dir);
  install(dir);
  workWithTheKit(dir);
  const report = uninstall({ dir, yes: true, purge: true });
  assert.deepEqual(snapshot(dir), before);
  assert.equal(report.cleanupPrompt, null, 'nothing is left to clean');
  assert.ok(report.purged.some((item) => item.path === 'PLAN.md'));
  assert.ok(report.purgedDirs.includes('.claude/factory'));
});

test('--purge never touches what the kit did not create: your files in .claude/ and the rest of the project stay', () => {
  const dir = messyProject();
  install(dir);
  workWithTheKit(dir);
  write(dir, '.claude/commands/mine.md', 'my command');
  write(dir, 'src/app.mjs', 'export const x = 1;\n');
  uninstall({ dir, yes: true, purge: true });
  assert.equal(read(dir, '.claude/commands/mine.md'), 'my command');
  assert.equal(read(dir, 'src/app.mjs'), 'export const x = 1;\n');
  assert.equal(read(dir, 'scripts/my-own.mjs'), 'console.log("mine");\n');
  assert.equal(read(dir, '.claude/skills/pr-description/SKILL.md'), 'MY OWN pr-description SKILL');
});

test('--purge deletes an instruction file the kit created even when you added text, but a file you already had only loses the block', () => {
  const created = tempProject();
  install(created, { profile: 'solo', tools: ['cursor'], enabled: ['rule.verification'] });
  write(created, 'AGENTS.md', '# My project overview\n\nWritten by the overview skill.\n\n' + read(created, 'AGENTS.md'));
  uninstall({ dir: created, yes: true, purge: true });
  assert.ok(!existsSync(join(created, 'AGENTS.md')));

  const existing = messyProject();
  install(existing);
  uninstall({ dir: existing, yes: true, purge: true });
  assert.equal(read(existing, 'AGENTS.md'), '# Overview\n\nA demo project.\n');
});

test('--purge removes a check:config script you changed, and keeps your other scripts', () => {
  const dir = messyProject();
  install(dir);
  const manifestScript = loadManifest(dir).packageScript.name;
  const parsed = JSON.parse(read(dir, 'package.json'));
  parsed.scripts[manifestScript] = 'node scripts/check-config.mjs --skills-dir somewhere/else';
  write(dir, 'package.json', json(parsed));

  const kept = uninstall({ dir });
  assert.ok(kept.keptFiles.some((item) => item.path === 'package.json'), 'without --purge it is kept and named');
  assert.ok(kept.cleanupPrompt.includes('check:config'));

  uninstall({ dir, yes: true, purge: true });
  assert.deepEqual(JSON.parse(read(dir, 'package.json')).scripts, { test: 'vitest' });
});

test('--purge without --yes is a preview: it says what would go and whether git can bring it back', () => {
  const dir = messyProject();
  install(dir);
  workWithTheKit(dir);
  commitAll(dir); // PLAN.md and REVIEW.md are now safe in git
  write(dir, '.claude/workflow.json', json({ profile: 'solo', overrides: {} })); // changed after the commit: not in git
  const before = snapshot(dir);
  const preview = uninstall({ dir, purge: true });
  assert.deepEqual(snapshot(dir), before, 'a preview changes nothing');
  const plan = preview.purged.find((item) => item.path === 'PLAN.md');
  const workflow = preview.purged.find((item) => item.path === '.claude/workflow.json');
  assert.equal(plan.recoverable, true);
  assert.equal(workflow.recoverable, false);
});

test('--purge reports a project with no git history as not recoverable', () => {
  const dir = tempProject(); // not a git repository
  install(dir, { profile: 'solo', tools: ['claude-code'], enabled: ['template.plan-file'] });
  write(dir, 'PLAN.md', '# mine\n');
  const preview = uninstall({ dir, purge: true });
  assert.equal(preview.purged.find((item) => item.path === 'PLAN.md').recoverable, false);
});

test('the reviewer guard hook the kit added is removed with its script; the project\'s own Bash hook stays', () => {
  const dir = tempProject();
  const mine = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  write(dir, '.claude/settings.json', json(mine));
  install(dir, { profile: 'team', tools: ['claude-code'], enabled: ['review-gate', 'check.reviewer-guard'] });
  assert.equal(JSON.parse(read(dir, '.claude/settings.json')).hooks.PreToolUse.length, 2);
  uninstall({ dir, yes: true });
  assert.equal(read(dir, '.claude/settings.json'), json(mine));
  assert.ok(!existsSync(join(dir, 'scripts', 'reviewer-bash-guard.mjs')));
});

test('a reviewer guard hook you wired yourself before the install is never removed', () => {
  const dir = tempProject();
  const mine = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/reviewer-bash-guard.mjs' }] }] } };
  write(dir, '.claude/settings.json', json(mine));
  install(dir, { profile: 'team', tools: ['claude-code'], enabled: ['review-gate', 'check.reviewer-guard'] });
  uninstall({ dir, yes: true });
  assert.equal(read(dir, '.claude/settings.json'), json(mine));
});
