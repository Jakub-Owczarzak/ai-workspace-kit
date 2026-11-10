import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { apply, expandRequires } from './apply.mjs';
import { init } from './init.mjs';

const projectWithKit = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-apply-'));
  init({ dir });
  return dir;
};
const write = (dir, relative, content) => {
  mkdirSync(dirname(join(dir, relative)), { recursive: true });
  writeFileSync(join(dir, relative), content);
};
const read = (dir, relative) => readFileSync(join(dir, relative), 'utf8');

const CHOICES = {
  profile: 'team',
  tools: ['claude-code'],
  enabled: ['skill.pr-description', 'skill.changelog-bump', 'skill.workspace-router', 'rule.verification', 'rule.readable-code'],
};

test('installs skills under the wk- prefix and rewrites the references between them', () => {
  const dir = projectWithKit();
  apply({ dir, choices: CHOICES });
  assert.ok(existsSync(join(dir, '.claude/skills/wk-pr-description/SKILL.md')));
  assert.ok(!existsSync(join(dir, '.claude/skills/pr-description')));
  assert.match(read(dir, '.claude/skills/wk-pr-description/SKILL.md'), /^---\r?\nname: wk-pr-description/);
  assert.match(read(dir, '.claude/skills/wk-workspace-router/SKILL.md'), /wk-changelog-bump/);
});

test('a project skill with the same name as a kit skill is never touched', () => {
  const dir = projectWithKit();
  write(dir, '.claude/skills/pr-description/SKILL.md', 'MY OWN SKILL');
  apply({ dir, choices: CHOICES });
  assert.equal(read(dir, '.claude/skills/pr-description/SKILL.md'), 'MY OWN SKILL');
  assert.ok(existsSync(join(dir, '.claude/skills/wk-pr-description/SKILL.md')));
});

test('rules go into a marked block and the user text in CLAUDE.md survives', () => {
  const dir = projectWithKit();
  const mine = '# My CLAUDE.md\n\nAlways answer in Polish.\n';
  write(dir, 'CLAUDE.md', mine);
  apply({ dir, choices: CHOICES });
  const result = read(dir, 'CLAUDE.md');
  assert.ok(result.startsWith(mine));
  assert.match(result, /workspace-kit:start rules/);
  assert.match(result, /Rule: verify/i);
});

test('a second run changes nothing', () => {
  const dir = projectWithKit();
  apply({ dir, choices: CHOICES });
  const second = apply({ dir, choices: CHOICES });
  assert.deepEqual([second.created, second.updated, second.skipped], [[], [], []]);
});

test('an existing, different workflow.json is left alone and reported', () => {
  const dir = projectWithKit();
  write(dir, '.claude/workflow.json', '{"profile":"org","overrides":{}}\n');
  const report = apply({ dir, choices: { ...CHOICES, profile: 'solo' } });
  assert.equal(read(dir, '.claude/workflow.json'), '{"profile":"org","overrides":{}}\n');
  assert.ok(report.skipped.some((item) => item.path.endsWith('workflow.json')));
});

test('a user-edited installed skill is skipped on the next run, replaced only with force', () => {
  const dir = projectWithKit();
  apply({ dir, choices: CHOICES });
  const file = '.claude/skills/wk-pr-description/SKILL.md';
  writeFileSync(join(dir, file), 'edited by me');
  assert.ok(apply({ dir, choices: CHOICES }).skipped.some((item) => item.path.endsWith('SKILL.md')));
  assert.equal(read(dir, file), 'edited by me');
  apply({ dir, choices: CHOICES, force: true });
  assert.notEqual(read(dir, file), 'edited by me');
});

test('dry run writes nothing', () => {
  const dir = projectWithKit();
  const report = apply({ dir, choices: CHOICES, dryRun: true });
  assert.ok(report.created.length > 0);
  assert.ok(!existsSync(join(dir, '.claude/skills')));
  assert.ok(!existsSync(join(dir, 'CLAUDE.md')));
});

test('tools that share folders get AGENTS.md and .agents/skills, once', () => {
  const dir = projectWithKit();
  apply({ dir, choices: { ...CHOICES, tools: ['cursor', 'codex', 'opencode'] } });
  assert.ok(existsSync(join(dir, '.agents/skills/wk-pr-description/SKILL.md')));
  assert.ok(existsSync(join(dir, 'AGENTS.md')));
  assert.ok(!existsSync(join(dir, 'CLAUDE.md')));
});

test('options that others need are added and reported; with no git repository the hook is manual', () => {
  const dir = projectWithKit();
  const report = apply({ dir, choices: { profile: 'org', tools: ['claude-code'], enabled: ['control.docs.check'] } });
  assert.ok(report.addedRequirements.includes('hook.pre-commit'));
  assert.ok(report.manual.some((item) => /not a git repository/.test(item.reason)));
  assert.ok(existsSync(join(dir, 'scripts', 'check-docs-fresh.mjs')));
  assert.ok(!existsSync(join(dir, '.git')), 'apply must not create a git repository');
});

// ---- Bucket 4: collisions with what the project already has -------------------------------------------------

const gitRepoWithKit = () => {
  const dir = projectWithKit();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};
const FULL = {
  profile: 'team',
  tools: ['claude-code'],
  enabled: ['hook.pre-commit', 'hook.pre-push', 'review-gate', 'check.static', 'check.test-edit-guard', 'setting.plan-mode-default', 'skill.changelog-bump'],
  project: { commands: { lint: 'npm run lint', test: 'npm test' }, protectedBranch: 'main' },
};

test("chains into the project's husky hook and keeps its lines", () => {
  const dir = gitRepoWithKit();
  write(dir, '.husky/pre-commit', 'npx lint-staged\n');
  apply({ dir, choices: FULL });
  const hook = read(dir, '.husky/pre-commit');
  assert.ok(hook.startsWith('npx lint-staged\n'));
  assert.match(hook, /npm run lint \|\| exit 1/);
  assert.match(hook, /wk-changelog-bump\/scripts\/changelog\.mjs/);
  assert.ok(!existsSync(join(dir, '.git', 'hooks', 'pre-commit')));
});

test("settings.json keeps the user's own hooks and permissions, and a second run changes nothing", () => {
  const dir = gitRepoWithKit();
  const mine = { permissions: { allow: ['Bash(npm test)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }] } };
  write(dir, '.claude/settings.json', JSON.stringify(mine, null, 2) + '\n');
  apply({ dir, choices: FULL });
  const merged = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(merged.permissions.allow, ['Bash(npm test)']);
  assert.equal(merged.permissions.defaultMode, 'plan');
  assert.deepEqual(merged.hooks.PostToolUse, mine.hooks.PostToolUse);
  assert.ok(merged.hooks.PreToolUse[0].hooks[0].command.includes('test-edit-guard.mjs'));
  const second = apply({ dir, choices: FULL });
  assert.deepEqual([second.created, second.updated, second.skipped], [[], [], []]);
});

test('settings.json with comments is never rewritten', () => {
  const dir = gitRepoWithKit();
  const commented = '{\n  // my note\n  "env": {}\n}\n';
  write(dir, '.claude/settings.json', commented);
  const report = apply({ dir, choices: FULL });
  assert.equal(read(dir, '.claude/settings.json'), commented);
  assert.ok(report.manual.some((item) => item.path.endsWith('settings.json') && /strict JSON/.test(item.reason)));
});

test('.gitignore keeps the user lines; package.json keeps its scripts and gets check:config once', () => {
  const dir = gitRepoWithKit();
  write(dir, '.gitignore', 'node_modules/\n');
  write(dir, 'package.json', '{\n  "name": "demo",\n  "scripts": { "test": "vitest" }\n}\n');
  apply({ dir, choices: FULL });
  assert.ok(read(dir, '.gitignore').startsWith('node_modules/\n'));
  assert.match(read(dir, '.gitignore'), /\.claude\/state\//);
  assert.match(read(dir, '.gitignore'), /\.claude\/reviews\//);
  const scripts = JSON.parse(read(dir, 'package.json')).scripts;
  assert.equal(scripts.test, 'vitest');
  assert.equal(scripts['check:config'], 'node scripts/check-config.mjs');
});

test('an existing check:config script is left alone and reported', () => {
  const dir = gitRepoWithKit();
  write(dir, 'package.json', '{"scripts":{"check:config":"mine"}}\n');
  const report = apply({ dir, choices: FULL });
  assert.equal(JSON.parse(read(dir, 'package.json')).scripts['check:config'], 'mine');
  assert.ok(report.skipped.some((item) => item.path === 'package.json'));
});

test("an existing release workflow of the user's is never touched; a missing answer writes nothing", () => {
  const dir = gitRepoWithKit();
  const choices = { ...FULL, enabled: [...FULL.enabled, 'workflow.release-bump'], project: { ...FULL.project, versionFiles: ['package.json:version'] } };
  write(dir, '.github/workflows/release_bump.yaml', 'name: mine\n');
  const first = apply({ dir, choices });
  assert.equal(read(dir, '.github/workflows/release_bump.yaml'), 'name: mine\n');
  assert.ok(first.skipped.some((item) => item.path.endsWith('release_bump.yaml')));

  const fresh = gitRepoWithKit();
  const missing = apply({ dir: fresh, choices: { ...choices, project: { protectedBranch: 'main' } } });
  assert.ok(!existsSync(join(fresh, '.github', 'workflows', 'release_bump.yaml')));
  assert.ok(missing.manual.some((item) => /versionFiles/.test(item.reason)));
});

test('the release workflow is written without a single placeholder left', () => {
  const dir = gitRepoWithKit();
  apply({ dir, choices: { ...FULL, enabled: [...FULL.enabled, 'workflow.release-bump'], project: { ...FULL.project, versionFiles: ['package.json:version'] } } });
  const workflow = read(dir, '.github/workflows/release_bump.yaml');
  assert.doesNotMatch(workflow, /<[A-Z][A-Z ]+>/);
  assert.match(workflow, /branches: \[main\]/);
});

test('Claude Code plus Codex: the rules are written once in AGENTS.md and CLAUDE.md imports them', () => {
  const dir = projectWithKit();
  apply({ dir, choices: { ...CHOICES, tools: ['claude-code', 'codex'] } });
  assert.match(read(dir, 'AGENTS.md'), /workspace-kit:start rules/);
  assert.doesNotMatch(read(dir, 'CLAUDE.md'), /workspace-kit:start rules/);
  assert.match(read(dir, 'CLAUDE.md'), /@AGENTS\.md/);
});

test('a CLAUDE.md that already imports AGENTS.md is not given a second import', () => {
  const dir = projectWithKit();
  write(dir, 'CLAUDE.md', '# Mine\n\n@AGENTS.md\n');
  apply({ dir, choices: { ...CHOICES, tools: ['claude-code', 'codex'] } });
  assert.equal(read(dir, 'CLAUDE.md'), '# Mine\n\n@AGENTS.md\n');
});

test('Cline gets its own skills folder and reads the rules from AGENTS.md', () => {
  const dir = projectWithKit();
  apply({ dir, choices: { ...CHOICES, tools: ['cline'] } });
  assert.ok(existsSync(join(dir, '.cline/skills/wk-pr-description/SKILL.md')));
  assert.ok(existsSync(join(dir, 'AGENTS.md')));
});

test('plan mode and the guard are reported as manual when Claude Code is not a selected tool', () => {
  const dir = gitRepoWithKit();
  const report = apply({ dir, choices: { ...FULL, tools: ['codex'] } });
  assert.ok(!existsSync(join(dir, '.claude', 'settings.json')));
  assert.ok(report.manual.some((item) => item.path.endsWith('settings.json') && /Claude Code/.test(item.reason)));
});

test('the kit skill lint accepts every installed wk- skill (folder name equals frontmatter name)', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = projectWithKit();
  const everySkill = ['skill.pr-description', 'skill.changelog-bump', 'skill.workspace-router', 'skill.goal-first-planner',
    'skill.readable-fix-plan', 'skill.write-project-overview', 'skill.figma-sync', 'skill.update-workspace-kit',
    'skill.ultra-code-quality-review', 'check.static'];
  apply({ dir, choices: { profile: 'solo', tools: ['claude-code'], enabled: everySkill } });
  const lint = spawnSync(process.execPath, [join(dir, 'scripts', 'check-skills.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  assert.doesNotMatch(lint.stdout, /ERROR/);
});

test('unknown ids, tools and profiles are refused with a clear message', () => {
  const dir = projectWithKit();
  assert.throws(() => apply({ dir, choices: { enabled: ['nope'] } }), /unknown option/);
  assert.throws(() => apply({ dir, choices: { tools: ['emacs'] } }), /unknown tool/);
  assert.throws(() => apply({ dir, choices: { profile: 'huge' } }), /unknown profile/);
});

test('refuses to run before init', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-empty-'));
  assert.throws(() => apply({ dir, choices: CHOICES }), /init/);
});

test('expandRequires follows chains of requirements', () => {
  const options = [
    { id: 'a', requires: ['b'] },
    { id: 'b', requires: ['c'] },
    { id: 'c' },
  ];
  const result = expandRequires(options, ['a']);
  assert.deepEqual(result.enabled.sort(), ['a', 'b', 'c']);
  assert.deepEqual(result.added.sort(), ['b', 'c']);
});
