import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('options that others need are added and reported; hooks are left as manual', () => {
  const dir = projectWithKit();
  const report = apply({ dir, choices: { profile: 'org', tools: ['claude-code'], enabled: ['control.docs.check'] } });
  assert.ok(report.addedRequirements.includes('hook.pre-commit'));
  assert.ok(report.manual.some((item) => item.path === 'templates/hooks/pre-commit'));
  assert.ok(existsSync(join(dir, 'scripts', 'check-docs-fresh.mjs')));
  assert.ok(!existsSync(join(dir, '.git')), 'apply must not touch git');
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
