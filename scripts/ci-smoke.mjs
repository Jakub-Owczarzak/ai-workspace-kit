// Kit development only (not shipped). Proves a user can install the package the way they will:
// pack the tarball, run `npx` from it in an empty project, then run it again.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
  const initCmd = ['exec', '--yes', `--package=${tgz}`, '--', 'workspace-kit', 'init'];

  const first = run('npm', initCmd, project);
  assert.match(first, /copied: [1-9]\d*,/, 'first run copies files');
  const kit = join(project, '.claude', 'workspace-kit');
  assert.ok(existsSync(join(kit, 'skills', 'setup-workspace', 'SKILL.md')), 'setup skill installed');
  assert.ok(existsSync(join(kit, '.kit-version')), 'version file written');

  const second = run('npm', initCmd, project);
  assert.match(second, /copied: 0,/, 'second run changes nothing');

  const stray = (function find(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? find(join(dir, e.name)) : e.name.endsWith('.test.mjs') ? [e.name] : []);
  })(project);
  assert.deepEqual(stray, [], 'no dev tests installed into the project');
  console.log(`smoke ok on ${process.platform}, node ${process.version}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
