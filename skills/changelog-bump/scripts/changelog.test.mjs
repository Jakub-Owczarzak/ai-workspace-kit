// Runs the CLI against throwaway git repos. Run: node --test .claude/skills/changelog-bump/scripts/changelog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'changelog.mjs');

function makeRepo({ version = '2.1.0', expo = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'changelog-bump-'));
  spawnSync('git', ['init', '-q', '-b', 'feat/PS-5-test'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', version }, null, 2) + '\n');
  if (expo !== null) {
    writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { name: 'app', version: expo } }, null, 2) + '\n');
  }
  return dir;
}

function commitAll(dir, message = 'init') {
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', message, '--allow-empty'], { cwd: dir });
}

function run(cwd, args, env = {}) {
  // stdin is a pipe, so the script must not prompt.
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    input: '',
    env: { ...process.env, CHANGELOG_BUMP: '', CHANGELOG_ENTRY: '', CHANGELOG_SKIP: '', ...env },
  });
}

function changelog(dir) {
  return readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('add creates CHANGELOG.md with an Unreleased entry carrying its bump tag, staged', () => {
  const dir = makeRepo();
  const result = run(dir, ['add'], { CHANGELOG_BUMP: 'minor', CHANGELOG_ENTRY: 'Add PDF export' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    changelog(dir),
    /^# Changelog\n\n## Unreleased\n\n- Add PDF export \(feat\/PS-5-test, \d{4}-\d{2}-\d{2}\) <!-- bump: minor -->\n$/,
  );
  const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).stdout;
  assert.match(staged, /CHANGELOG\.md/);
});

test('a second add appends below the first entry in the same Unreleased section', () => {
  const dir = makeRepo();
  run(dir, ['add'], { CHANGELOG_BUMP: 'patch', CHANGELOG_ENTRY: 'Fix tumbler price' });
  run(dir, ['add'], { CHANGELOG_BUMP: 'minor', CHANGELOG_ENTRY: 'Add print sizes' });
  const text = changelog(dir);
  assert.equal(text.match(/^## Unreleased$/gm).length, 1);
  assert.ok(text.indexOf('Fix tumbler price') < text.indexOf('Add print sizes'));
});

test('add puts Unreleased above existing version sections', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 2.1.0 - 2026-10-01\n\n- Old entry\n');
  run(dir, ['add'], { CHANGELOG_BUMP: 'patch', CHANGELOG_ENTRY: 'New entry' });
  const text = changelog(dir);
  assert.ok(text.indexOf('## Unreleased') < text.indexOf('## 2.1.0'));
  assert.ok(text.indexOf('New entry') < text.indexOf('## 2.1.0'));
});

test('add without env vars and without a terminal fails clearly', () => {
  const dir = makeRepo();
  const result = run(dir, ['add']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHANGELOG_BUMP and CHANGELOG_ENTRY must be set/);
  assert.equal(existsSync(join(dir, 'CHANGELOG.md')), false);
});

test('add rejects an unknown bump type', () => {
  const dir = makeRepo();
  const result = run(dir, ['add', '--bump', 'huge', '--message', 'x']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /bump must be one of/);
});

test('add rejects a multi-line entry', () => {
  const dir = makeRepo();
  const result = run(dir, ['add', '--bump', 'patch', '--message', 'line one\nline two']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /single line/);
});

test('release with no entries still bumps patch and writes a maintenance line', () => {
  const dir = makeRepo();
  const result = run(dir, ['release']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(join(dir, 'package.json')).version, '2.1.1');
  assert.match(
    changelog(dir),
    /^# Changelog\n\n## Unreleased\n\n## 2\.1\.1 - \d{4}-\d{2}-\d{2}\n\n- Maintenance release/,
  );
});

test('release takes the highest bump, strips the tags and resets Unreleased', () => {
  const dir = makeRepo();
  run(dir, ['add'], { CHANGELOG_BUMP: 'patch', CHANGELOG_ENTRY: 'Fix tumbler price' });
  run(dir, ['add'], { CHANGELOG_BUMP: 'minor', CHANGELOG_ENTRY: 'Add print sizes' });
  const result = run(dir, ['release']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(join(dir, 'package.json')).version, '2.2.0');
  const text = changelog(dir);
  assert.match(text, /^# Changelog\n\n## Unreleased\n\n## 2\.2\.0 - \d{4}-\d{2}-\d{2}\n\n- Fix tumbler price \(feat\/PS-5-test, \d{4}-\d{2}-\d{2}\)\n- Add print sizes \(feat\/PS-5-test, \d{4}-\d{2}-\d{2}\)\n/);
  assert.equal(text.includes('<!-- bump'), false);
});

test('release keeps older version sections below the new one', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 2.1.0 - 2026-10-01\n\n- Old entry\n');
  run(dir, ['add'], { CHANGELOG_BUMP: 'patch', CHANGELOG_ENTRY: 'New entry' });
  run(dir, ['release']);
  const text = changelog(dir);
  assert.ok(text.indexOf('## 2.1.1') < text.indexOf('## 2.1.0'));
  assert.ok(text.indexOf('## Unreleased') < text.indexOf('## 2.1.1'));
});

test('major bump resets minor and patch', () => {
  const dir = makeRepo({ version: '2.1.7' });
  run(dir, ['add'], { CHANGELOG_BUMP: 'major', CHANGELOG_ENTRY: 'Drop old API' });
  run(dir, ['release']);
  assert.equal(readJson(join(dir, 'package.json')).version, '3.0.0');
});

test('release keeps several version files in sync, including a dotted key', () => {
  const dir = makeRepo({ version: '1.0.0', expo: '1.0.0' });
  const result = run(dir, [
    'release',
    '--version-file', 'package.json:version',
    '--version-file', 'app.json:expo.version',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(join(dir, 'package.json')).version, '1.0.1');
  assert.equal(readJson(join(dir, 'app.json')).expo.version, '1.0.1');
});

test('release keeps CRLF line endings in version files', () => {
  const dir = makeRepo();
  const pkgPath = join(dir, 'package.json');
  writeFileSync(pkgPath, readFileSync(pkgPath, 'utf8').replace(/\n/g, '\r\n'));
  const result = run(dir, ['release']);
  assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(pkgPath, 'utf8');
  assert.equal(readJson(pkgPath).version, '2.1.1');
  assert.equal(text, text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
  assert.ok(text.endsWith('\r\n'));
});

test('release --dry-run changes nothing', () => {
  const dir = makeRepo();
  run(dir, ['add'], { CHANGELOG_BUMP: 'minor', CHANGELOG_ENTRY: 'Something' });
  const before = changelog(dir);
  const result = run(dir, ['release', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split('\n').at(-1), '2.2.0');
  assert.equal(readJson(join(dir, 'package.json')).version, '2.1.0');
  assert.equal(changelog(dir), before);
});

test('add strips terminal arrow-key escape sequences from the entry', () => {
  const dir = makeRepo();
  const typed = 'add-unstaged\x1b[D\x1b[D\x1b[C-files\x1b[ ';
  const result = run(dir, ['add'], { CHANGELOG_BUMP: 'patch', CHANGELOG_ENTRY: typed });
  assert.equal(result.status, 0, result.stderr);
  assert.match(changelog(dir), /- add-unstaged-files \(feat\/PS-5-test, /);
  assert.equal(changelog(dir).includes('\x1b'), false);
});

test('add rejects an entry already in Unreleased', () => {
  const dir = makeRepo();
  run(dir, ['add'], { CHANGELOG_BUMP: 'minor', CHANGELOG_ENTRY: 'Add print sizes' });
  const again = run(dir, ['add'], { CHANGELOG_BUMP: 'patch', CHANGELOG_ENTRY: 'Add print sizes' });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already in Unreleased/);
  assert.equal(changelog(dir).match(/Add print sizes/g).length, 1);
});

test('add rejects an entry that is only escape sequences', () => {
  const dir = makeRepo();
  const result = run(dir, ['add'], { CHANGELOG_BUMP: 'patch', CHANGELOG_ENTRY: '\x1b[D\x1b[C' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /entry is empty/);
});

test('should-skip exits 0 for a deletion-only commit', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'old.txt'), 'x\n');
  commitAll(dir);
  spawnSync('git', ['rm', '-q', 'old.txt'], { cwd: dir });
  assert.equal(run(dir, ['should-skip']).status, 0);
});

test('should-skip exits 0 for a CHANGELOG.md or lockfile-only commit', () => {
  const dir = makeRepo();
  commitAll(dir);
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
  writeFileSync(join(dir, 'package-lock.json'), '{}\n');
  spawnSync('git', ['add', 'CHANGELOG.md', 'package-lock.json'], { cwd: dir });
  assert.equal(run(dir, ['should-skip']).status, 0);
});

test('should-skip exits 0 while a merge is in progress', () => {
  const dir = makeRepo();
  commitAll(dir);
  writeFileSync(join(dir, 'feature.txt'), 'x\n');
  spawnSync('git', ['add', 'feature.txt'], { cwd: dir });
  writeFileSync(join(dir, '.git', 'MERGE_HEAD'), 'b1e0c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9\n');
  assert.equal(run(dir, ['should-skip']).status, 0);
  rmSync(join(dir, '.git', 'MERGE_HEAD'));
});

test('should-skip exits 0 when CHANGELOG_SKIP=1', () => {
  const dir = makeRepo();
  commitAll(dir);
  writeFileSync(join(dir, 'feature.txt'), 'x\n');
  spawnSync('git', ['add', 'feature.txt'], { cwd: dir });
  assert.equal(run(dir, ['should-skip'], { CHANGELOG_SKIP: '1' }).status, 0);
});

test('should-skip exits 1 for a real source change', () => {
  const dir = makeRepo();
  commitAll(dir);
  writeFileSync(join(dir, 'feature.txt'), 'x\n');
  spawnSync('git', ['add', 'feature.txt'], { cwd: dir });
  assert.equal(run(dir, ['should-skip']).status, 1);
});

test('unknown command exits 1 with usage', () => {
  const dir = makeRepo();
  const result = run(dir, ['nope']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage:/);
});
