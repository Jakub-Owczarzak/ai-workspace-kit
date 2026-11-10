// Kit development only (not shipped). Proves a user can install the package the way they will:
// pack the tarball, run `npx` from it in an empty project, then run it again.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const isWin = process.platform === 'win32';
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', shell: isWin, stdio: ['ignore', 'pipe', 'inherit'] });

const work = mkdtempSync(join(tmpdir(), 'wk-smoke-'));
const project = join(work, 'project');
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], process.cwd()))[0];
  const bad = packed.files.filter((f) => f.path.endsWith('.test.mjs'));
  assert.deepEqual(bad, [], 'dev tests must not be in the tarball');
  console.log(`packed ${packed.filename}: ${packed.files.length} files`);

  mkdirSync(project);
  const tgz = join(work, packed.filename);
  const initCmd = ['exec', '--yes', `--package=${tgz}`, '--', 'ai-workspace-kit', 'init'];

  const first = run('npm', initCmd, project);
  assert.match(first, /copied: [1-9]\d*,/, 'first run copies files');
  const kit = join(project, '.claude', 'workspace-kit');
  assert.ok(existsSync(join(kit, 'skills', 'setup-workspace', 'SKILL.md')), 'setup skill installed');
  assert.ok(existsSync(join(kit, '.kit-version')), 'version file written');

  const second = run('npm', initCmd, project);
  assert.match(second, /copied: 0,/, 'second run changes nothing');

  // The setup prompt then runs the installed kit's own program: no network, no npx.
  const choicesFile = join(work, 'choices.json');
  writeFileSync(choicesFile, JSON.stringify({
    profile: 'team',
    tools: ['claude-code', 'codex'],
    enabled: ['skill.pr-description', 'rule.verification', 'check.static'],
  }));
  mkdirSync(join(project, '.claude', 'skills', 'pr-description'), { recursive: true });
  writeFileSync(join(project, '.claude', 'skills', 'pr-description', 'SKILL.md'), 'USER SKILL');
  const cliPath = join(kit, 'bin', 'cli.mjs');
  const applied = run('node', [cliPath, 'apply', '--choices', choicesFile], project);
  assert.match(applied, /created: [1-9]/, 'apply creates files');
  assert.ok(existsSync(join(project, '.claude', 'skills', 'wk-pr-description', 'SKILL.md')), 'wk- skill installed');
  assert.ok(existsSync(join(project, '.agents', 'skills', 'wk-pr-description', 'SKILL.md')), 'shared skills folder used');
  assert.equal(readFileSync(join(project, '.claude', 'skills', 'pr-description', 'SKILL.md'), 'utf8'), 'USER SKILL', 'user skill untouched');
  assert.match(readFileSync(join(project, 'AGENTS.md'), 'utf8'), /workspace-kit:start rules/);
  assert.match(readFileSync(join(project, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/, 'Claude Code imports the shared rules');
  const reapplied = run('node', [cliPath, 'apply', '--choices', choicesFile], project);
  assert.match(reapplied, /created: 0/);
  assert.match(reapplied, /updated: 0/);

  const stray = (function find(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? find(join(dir, e.name)) : e.name.endsWith('.test.mjs') ? [e.name] : []);
  })(project);
  assert.deepEqual(stray, [], 'no dev tests installed into the project');

  // Uninstall: a preview changes nothing; --yes removes what the kit installed and nothing else.
  const previewed = run('node', [cliPath, 'uninstall'], project);
  assert.match(previewed, /Would remove:/);
  assert.match(previewed, /Nothing was changed/);
  assert.ok(existsSync(join(project, '.claude', 'skills', 'wk-pr-description', 'SKILL.md')), 'the preview removed nothing');
  const removed = run('node', [cliPath, 'uninstall', '--yes'], project);
  assert.match(removed, /Removed:/);
  assert.ok(!existsSync(join(project, '.claude', 'skills', 'wk-pr-description')), 'kit skill removed');
  assert.ok(!existsSync(join(project, '.agents')), 'the folder only the kit used is removed');
  assert.ok(!existsSync(kit), 'the kit folder is removed');
  assert.ok(!existsSync(join(project, 'AGENTS.md')) && !existsSync(join(project, 'CLAUDE.md')), 'files only the kit created are removed');
  assert.equal(readFileSync(join(project, '.claude', 'skills', 'pr-description', 'SKILL.md'), 'utf8'), 'USER SKILL', 'user skill still untouched');
  console.log(`smoke ok on ${process.platform}, node ${process.version}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
