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

test('the factory guard installs with the resolver it imports, git-ignores its folder, and a second run changes nothing', () => {
  const dir = projectWithKit();
  const choices = { profile: 'team', tools: ['claude-code'], enabled: ['factory-core'] };
  const first = apply({ dir, choices });
  assert.ok(first.addedRequirements.includes('check.static'));
  assert.ok(existsSync(join(dir, 'scripts', 'factory-guard.mjs')));
  assert.ok(existsSync(join(dir, 'scripts', 'workflow-config.mjs')), 'factory-guard imports it');
  assert.match(read(dir, '.gitignore'), /\.claude\/factory\//);
  assert.ok(!existsSync(join(dir, 'scripts', 'factory-guard.test.mjs')), 'dev tests are never installed');
  const second = apply({ dir, choices });
  assert.deepEqual([second.created, second.updated, second.skipped], [[], [], []]);
});

test('the run-factory skill brings its guard, builder, reviewer and PR description, and reads as wk- names without mangling', () => {
  const dir = projectWithKit();
  const report = apply({ dir, choices: { profile: 'solo', tools: ['claude-code'], enabled: ['skill.run-factory'] } });
  for (const id of ['factory-core', 'review-gate', 'skill.pr-description', 'check.static']) {
    assert.ok(report.addedRequirements.includes(id), `${id} should be added`);
  }
  assert.ok(existsSync(join(dir, '.claude/skills/wk-run-factory/SKILL.md')));
  assert.ok(existsSync(join(dir, '.claude/agents/factory-builder.md')));
  assert.ok(existsSync(join(dir, '.claude/agents/reviewer.md')));
  assert.ok(existsSync(join(dir, 'scripts/factory-guard.mjs')));
  const skill = read(dir, '.claude/skills/wk-run-factory/SKILL.md');
  assert.match(skill, /^name: "wk-run-factory"$/m);
  assert.match(skill, /disable-model-invocation: true/);
  assert.match(skill, /`wk-pr-description` skill/);
  assert.doesNotMatch(skill, /wk-factory\b/, 'the plain word "factory" must not be rewritten');
  for (const host of ['github.md', 'gitlab.md']) {
    assert.ok(existsSync(join(dir, '.claude/skills/wk-run-factory/references', host)), `${host} is installed with the skill`);
  }
  assert.match(skill, /references\/github\.md/);
  assert.match(skill, /references\/gitlab\.md/);
  assert.match(skill, /factory\.mode/);
});

test('the e2e-tests skill brings its screenshot helper and both recipes, and tests.e2e is not rewritten', () => {
  const dir = projectWithKit();
  const report = apply({ dir, choices: { profile: 'solo', tools: ['claude-code'], enabled: ['skill.e2e-tests'] } });
  assert.ok(report.addedRequirements.includes('check.e2e-shots'));
  assert.ok(existsSync(join(dir, 'scripts', 'e2e-shots.mjs')));
  const skillDir = join('.claude', 'skills', 'wk-e2e-tests');
  const skill = read(dir, join(skillDir, 'SKILL.md'));
  assert.match(skill, /^name: "wk-e2e-tests"$/m);
  assert.match(skill, /tests\.e2e/);
  assert.doesNotMatch(skill, /wk-e2e(?!-tests)/, 'only the skill name is prefixed, not the word e2e');
  for (const reference of ['browser-playwright.md', 'native-maestro.md']) {
    assert.ok(existsSync(join(dir, skillDir, 'references', reference)), reference);
  }
  assert.match(read(dir, join(skillDir, 'references', 'native-maestro.md')), /NOT VERIFIED on a device/);
});

test('the screenshot helper installs alone, runs in the project, and a second run changes nothing', () => {
  const dir = projectWithKit();
  const choices = { profile: 'solo', tools: ['claude-code'], enabled: ['check.e2e-shots'] };
  apply({ dir, choices });
  assert.ok(existsSync(join(dir, 'scripts', 'e2e-shots.mjs')));
  assert.ok(!existsSync(join(dir, 'scripts', 'e2e-shots.test.mjs')), 'dev tests are never installed');
  const out = execFileSync(process.execPath, [join(dir, 'scripts', 'e2e-shots.mjs'), 'markdown', '--remote', 'https://github.com/a/b.git', '--ref', 'abc', '--files', 'x/s.png'], { encoding: 'utf8' });
  assert.match(out, /blob\/abc\/x\/s\.png\?raw=true/);
  const second = apply({ dir, choices });
  assert.deepEqual([second.created, second.updated, second.skipped], [[], [], []]);
});

test('the factory installs for Codex, OpenCode, Cursor and Cline without Claude Code: skills, references, rules, no agents folder', () => {
  const dir = projectWithKit();
  const report = apply({
    dir,
    choices: { profile: 'solo', tools: ['codex', 'opencode', 'cursor', 'cline'], enabled: ['skill.run-factory', 'skill.e2e-tests', 'rule.commit-gate'] },
  });
  for (const root of ['.agents/skills', '.cline/skills']) {
    assert.ok(existsSync(join(dir, root, 'wk-run-factory', 'SKILL.md')), `${root}: the skill`);
    assert.ok(existsSync(join(dir, root, 'wk-run-factory', 'references', 'github.md')), `${root}: github reference`);
    assert.ok(existsSync(join(dir, root, 'wk-run-factory', 'references', 'gitlab.md')), `${root}: gitlab reference`);
    assert.ok(existsSync(join(dir, root, 'wk-e2e-tests', 'references', 'browser-playwright.md')), `${root}: the e2e recipe`);
  }
  assert.match(read(dir, '.agents/skills/wk-run-factory/agents/openai.yaml'), /allow_implicit_invocation: false/);
  assert.ok(!existsSync(join(dir, '.claude')) || !existsSync(join(dir, '.claude', 'agents')), 'no .claude/agents without Claude Code');
  assert.ok(existsSync(join(dir, 'scripts', 'factory-guard.mjs')));
  for (const agent of ['factory-builder', 'reviewer']) {
    assert.ok(report.manual.some((item) => item.path.includes(agent) && /Without subagents/.test(item.reason)), `${agent}: a manual note that says what happens instead`);
    assert.ok(existsSync(join(dir, '.claude', 'workspace-kit', 'templates', 'agents', `${agent}.md`)), `${agent}: the role text the single agent reads`);
  }
  const skill = read(dir, '.agents/skills/wk-run-factory/SKILL.md');
  assert.match(skill, /## Without subagents \(single-agent mode\)/);
  assert.match(skill, /\.claude\/workspace-kit\/templates\/agents\/factory-builder\.md/);
  assert.match(skill, /did not ask you in this conversation to run the factory, do nothing/);
  const rules = read(dir, 'AGENTS.md');
  assert.match(rules, /workspace-kit:start rules/);
  assert.match(rules, /except a factory run the user started/i, 'the commit gate carries the factory push exception for every tool');
});

test('without Claude Code the builder subagent is a manual step, like the reviewer', () => {
  const dir = projectWithKit();
  const report = apply({ dir, choices: { profile: 'solo', tools: ['codex'], enabled: ['factory-core'] } });
  assert.ok(report.manual.some((item) => /factory-builder/.test(item.path) && /Claude Code feature/.test(item.reason)));
  assert.ok(!existsSync(join(dir, '.claude/agents/factory-builder.md')));
});

test('an installed factory guard runs in the project and refuses while the factory is off', () => {
  const dir = projectWithKit();
  apply({ dir, choices: { profile: 'solo', tools: ['claude-code'], enabled: ['factory-core'] } });
  let output = '';
  try {
    execFileSync(process.execPath, [join(dir, 'scripts', 'factory-guard.mjs'), 'preflight', '--root', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('preflight should exit 1 while factory.mode is off');
  } catch (error) {
    output = String(error.stdout ?? '');
    assert.equal(error.status, 1);
  }
  assert.match(output, /factory\.mode is off/);
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

test('another tool than Claude Code gets the translation rule in the rules block, with no option chosen', () => {
  const dir = projectWithKit();
  apply({ dir, choices: { ...CHOICES, tools: ['codex'] } });
  assert.match(read(dir, 'AGENTS.md'), /kit skills were written for Claude Code; translate them/);
});

test('the translation rule is added even when no other rule is chosen', () => {
  const dir = projectWithKit();
  apply({ dir, choices: { profile: 'solo', tools: ['cursor'], enabled: ['skill.pr-description'] } });
  assert.match(read(dir, 'AGENTS.md'), /AskUserQuestion/);
});

test('Claude Code alone does not get the translation rule', () => {
  const dir = projectWithKit();
  apply({ dir, choices: CHOICES });
  assert.doesNotMatch(read(dir, 'CLAUDE.md'), /translate them/);
});

test('the translation rule is written once, in AGENTS.md, when Claude Code is used with another tool', () => {
  const dir = projectWithKit();
  apply({ dir, choices: { ...CHOICES, tools: ['claude-code', 'codex'] } });
  assert.match(read(dir, 'AGENTS.md'), /translate them/);
  assert.doesNotMatch(read(dir, 'CLAUDE.md'), /translate them/);
});

test('running twice with another tool changes nothing', () => {
  const dir = projectWithKit();
  apply({ dir, choices: { ...CHOICES, tools: ['codex'] } });
  const first = read(dir, 'AGENTS.md');
  apply({ dir, choices: { ...CHOICES, tools: ['codex'] } });
  assert.equal(read(dir, 'AGENTS.md'), first);
});

const checkConfigScript = (dir) => JSON.parse(read(dir, 'package.json')).scripts['check:config'];
const withPackageJson = () => {
  const dir = projectWithKit();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }, null, 2) + '\n');
  return dir;
};

test('the check:config shortcut looks in the skills folder of the chosen tool, not only in .claude/skills', () => {
  const dir = withPackageJson();
  apply({ dir, choices: { profile: 'solo', tools: ['opencode'], enabled: ['check.static'] } });
  assert.equal(checkConfigScript(dir), 'node scripts/check-config.mjs --skills-dir .agents/skills');
});

test('the check:config shortcut for Claude Code alone keeps the plain command', () => {
  const dir = withPackageJson();
  apply({ dir, choices: { profile: 'solo', tools: ['claude-code'], enabled: ['check.static'] } });
  assert.equal(checkConfigScript(dir), 'node scripts/check-config.mjs');
});

test('the check:config shortcut names every skills folder when several tools are used', () => {
  const dir = withPackageJson();
  apply({ dir, choices: { profile: 'solo', tools: ['codex', 'cline'], enabled: ['check.static'] } });
  assert.equal(checkConfigScript(dir), 'node scripts/check-config.mjs --skills-dir .agents/skills --skills-dir .cline/skills');
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
    'skill.readable-fix-plan', 'skill.write-project-overview', 'skill.figma-sync',
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

// ---- A project that already has an older copy of the kit (the shape of the Expo starter project) -----------

const OLD_PRE_COMMIT = [
  'set -e',
  'npx lint-staged',
  'npm run typecheck',
  'npm run test',
  'node scripts/check-docs-fresh.mjs',
  'if node .claude/skills/changelog-bump/scripts/changelog.mjs should-skip; then',
  '  :',
  'else',
  '  node .claude/skills/changelog-bump/scripts/changelog.mjs add --changelog CHANGELOG.md',
  'fi',
  '',
].join('\n');

const projectWithOlderKit = () => {
  const dir = gitRepoWithKit();
  write(dir, '.husky/pre-commit', OLD_PRE_COMMIT);
  write(dir, '.claude/skills/pr-description/SKILL.md', 'OLD KIT SKILL');
  write(dir, 'CLAUDE.md', '# Workspace\n\n@AGENTS.md\n\n@.claude/workspace-kit/rules/verification.md\n@.claude/workspace-kit/rules/readable-code.md\n');
  write(dir, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/test-edit-guard.mjs"' }] }] } }, null, 2) + '\n');
  return dir;
};
const OLDER_KIT_CHOICES = {
  profile: 'team',
  tools: ['claude-code'],
  enabled: ['hook.pre-commit', 'skill.pr-description', 'skill.changelog-bump', 'rule.verification', 'rule.readable-code', 'rule.commit-gate', 'check.test-edit-guard'],
  project: { commands: { lint: 'npx lint-staged', typecheck: 'npm run typecheck', test: 'npm run test' } },
};

test('older kit install: nothing the hook already runs is added a second time, and the hook is left untouched', () => {
  const dir = projectWithOlderKit();
  const report = apply({ dir, choices: OLDER_KIT_CHOICES });
  assert.equal(read(dir, '.husky/pre-commit'), OLD_PRE_COMMIT);
  assert.ok(report.notices.some((note) => /already covers everything/.test(note)));
  assert.ok(report.notices.some((note) => /check-docs-fresh/.test(note)));
  assert.ok(report.notices.some((note) => /changelog/.test(note)));
  assert.ok(report.notices.some((note) => /npx lint-staged/.test(note)));
});

test('older kit install: a partly covered hook only gets the missing part', () => {
  const dir = projectWithOlderKit();
  write(dir, '.husky/pre-commit', 'npx lint-staged\n');
  apply({ dir, choices: OLDER_KIT_CHOICES });
  const hook = read(dir, '.husky/pre-commit');
  assert.equal(hook.match(/npx lint-staged/g).length, 1, 'lint-staged must run once');
  assert.equal(hook.match(/npm run typecheck/g).length, 1);
  assert.match(hook, /check-docs-fresh/);
});

test('older kit install: rules the instruction file already imports are not repeated, the others are added', () => {
  const dir = projectWithOlderKit();
  const report = apply({ dir, choices: OLDER_KIT_CHOICES });
  const claude = read(dir, 'CLAUDE.md');
  const block = claude.slice(claude.indexOf('workspace-kit:start rules'));
  assert.doesNotMatch(block, /Rule: verify/i, 'verification is imported already');
  assert.match(block, /commit gate/i, 'commit-gate was not imported, so it is added');
  assert.ok(report.notices.some((note) => /already imports these rules.*rules\/verification\.md/.test(note)));
});

test('older kit install: the flat skill is kept and reported, the guard hook is not wired twice', () => {
  const dir = projectWithOlderKit();
  const report = apply({ dir, choices: OLDER_KIT_CHOICES });
  assert.equal(read(dir, '.claude/skills/pr-description/SKILL.md'), 'OLD KIT SKILL');
  assert.ok(report.notices.some((note) => /already exist under their plain names.*skills\/pr-description/.test(note)));
  const entries = JSON.parse(read(dir, '.claude/settings.json')).hooks.PreToolUse;
  assert.equal(entries.length, 1);
});

test('older kit install: a second run changes nothing', () => {
  const dir = projectWithOlderKit();
  apply({ dir, choices: OLDER_KIT_CHOICES });
  const second = apply({ dir, choices: OLDER_KIT_CHOICES });
  assert.deepEqual([second.created, second.updated, second.skipped], [[], [], []]);
});

test('--force never replaces files that are the project\'s own data: PLAN.md, CHANGELOG.md, workflow.json', () => {
  const dir = gitRepoWithKit();
  write(dir, 'PLAN.md', 'MY REAL PLAN');
  write(dir, 'CHANGELOG.md', 'MY CHANGELOG');
  write(dir, '.claude/workflow.json', '{"profile":"org","overrides":{}}\n');
  const choices = { profile: 'solo', tools: ['claude-code'], enabled: ['template.plan-file', 'skill.changelog-bump', 'check.static'] };
  const report = apply({ dir, choices, force: true });
  assert.equal(read(dir, 'PLAN.md'), 'MY REAL PLAN');
  assert.equal(read(dir, 'CHANGELOG.md'), 'MY CHANGELOG');
  assert.equal(read(dir, '.claude/workflow.json'), '{"profile":"org","overrides":{}}\n');
  const workflowSkip = report.skipped.find((item) => item.path.endsWith('workflow.json'));
  assert.match(workflowSkip.reason, /org.*solo/, 'the reason names both profiles');
});

test('--force does replace an older kit script, which the kit owns', () => {
  const dir = gitRepoWithKit();
  write(dir, 'scripts/check-config.mjs', 'OLD SCRIPT');
  const choices = { profile: 'solo', tools: ['claude-code'], enabled: ['check.static'] };
  const withoutForce = apply({ dir, choices });
  assert.equal(read(dir, 'scripts/check-config.mjs'), 'OLD SCRIPT');
  assert.match(withoutForce.skipped.find((item) => item.path.endsWith('check-config.mjs')).reason, /older copy.*--force/);
  apply({ dir, choices, force: true });
  assert.notEqual(read(dir, 'scripts/check-config.mjs'), 'OLD SCRIPT');
});

test('a dev test left in the project\'s kit folder by an older install is never copied into a skill', () => {
  const dir = projectWithKit();
  write(dir, '.claude/workspace-kit/skills/changelog-bump/scripts/changelog.test.mjs', 'LEFTOVER');
  apply({ dir, choices: { profile: 'solo', tools: ['claude-code'], enabled: ['skill.changelog-bump'] } });
  assert.ok(existsSync(join(dir, '.claude/skills/wk-changelog-bump/scripts/changelog.mjs')));
  assert.ok(!existsSync(join(dir, '.claude/skills/wk-changelog-bump/scripts/changelog.test.mjs')));
});

test('the "write AGENTS.md" note appears only when there is no AGENTS.md', () => {
  const choices = { profile: 'solo', tools: ['claude-code'], enabled: ['skill.write-project-overview'] };
  const without = projectWithKit();
  assert.ok(apply({ dir: without, choices }).manual.some((item) => /AGENTS\.md/.test(item.reason)));
  const withFile = projectWithKit();
  write(withFile, 'AGENTS.md', '# mine\n');
  assert.ok(!apply({ dir: withFile, choices }).manual.some((item) => /AGENTS\.md/.test(item.reason)));
});

test('a protected-branch stop the project\'s pre-push hook already has is not repeated in the snippet', () => {
  const dir = gitRepoWithKit();
  write(dir, '.husky/pre-push', 'while read -r a b c d; do\n  if [ "$c" = "refs/heads/main" ]; then exit 1; fi\ndone\n');
  const report = apply({ dir, choices: { profile: 'team', tools: ['claude-code'], enabled: ['hook.pre-push', 'review-gate'], project: { protectedBranch: 'main' } } });
  const manual = report.manual.find((item) => item.path.includes('pre-push'));
  assert.ok(manual, 'a pre-push that reads stdin is handed over');
  assert.doesNotMatch(manual.snippet, /refs\/heads\/main/);
  assert.match(manual.snippet, /check-review-gate/);
});

test('older kit scripts that were skipped produce a loud warning, and the warning goes away after --force', () => {
  const dir = gitRepoWithKit();
  write(dir, 'scripts/workflow-config.mjs', 'OLD RESOLVER');
  const choices = { profile: 'team', tools: ['claude-code'], enabled: ['review-gate', 'check.static'] };
  const first = apply({ dir, choices });
  assert.equal(first.warnings.length, 1);
  assert.match(first.warnings[0], /workflow-config\.mjs.*silently do nothing.*--force/s);
  const forced = apply({ dir, choices, force: true });
  assert.equal(forced.warnings.length, 0);
  assert.notEqual(read(dir, 'scripts/workflow-config.mjs'), 'OLD RESOLVER');
});

test('no warning when nothing is stale', () => {
  const dir = gitRepoWithKit();
  const choices = { profile: 'team', tools: ['claude-code'], enabled: ['review-gate', 'check.static'] };
  assert.deepEqual(apply({ dir, choices }).warnings, []);
});
