// Run: node --test test-edit-guard.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TTL_HOURS, buildBlockMessage, decide, isFresh, isTestPath, parseHookInput, toRelative } from './test-edit-guard.mjs';

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const FRESH = { startedAt: new Date(NOW - HOUR).toISOString(), reason: 'fix', protected: [] };
const tracked = (...paths) => (path) => paths.includes(path);

describe('isTestPath', () => {
  it('recognises JS/TS, Python and Go test files and test folders', () => {
    for (const path of ['src/a.test.ts', 'src/a.spec.tsx', 'x/a.test.mjs', 'src/__tests__/a.ts', 'tests/a.js', 'test/helpers.js', 'pkg/test_a.py', 'pkg/a_test.go', 'src\\a.test.ts']) {
      assert.equal(isTestPath(path), true, path);
    }
  });

  it('does not treat ordinary source files as tests', () => {
    for (const path of ['src/a.ts', 'src/latest.ts', 'src/contest/a.ts', 'README.md', 'src/testing-notes.md']) {
      assert.equal(isTestPath(path), false, path);
    }
  });
});

describe('isFresh', () => {
  it('is true inside the time limit and false after it', () => {
    assert.equal(isFresh({ startedAt: new Date(NOW - 3 * HOUR).toISOString() }, NOW), true);
    assert.equal(isFresh({ startedAt: new Date(NOW - 5 * HOUR).toISOString() }, NOW), false);
    assert.equal(isFresh({ startedAt: new Date(NOW - 5 * HOUR).toISOString() }, NOW, 8), true);
    assert.equal(DEFAULT_TTL_HOURS, 4);
  });

  it('is false for a marker without a valid date', () => {
    assert.equal(isFresh({ startedAt: 'not a date' }, NOW), false);
    assert.equal(isFresh(null, NOW), false);
  });
});

describe('decide: the five cases from the plan, plus the rest', () => {
  const base = { now: NOW, env: {}, guardControl: 'on', isTracked: tracked('src/a.test.ts') };

  it('1. allows everything when fix mode is not on', () => {
    assert.deepEqual(decide({ ...base, relativePath: 'src/a.test.ts', marker: null }), { action: 'allow', code: 'no-fix-mode' });
  });

  it('2. blocks an edit to an existing (tracked) test in fix mode', () => {
    assert.deepEqual(decide({ ...base, relativePath: 'src/a.test.ts', marker: FRESH }), { action: 'block', code: 'existing-test' });
  });

  it('3. allows a NEW test file in fix mode (the failing test first)', () => {
    assert.deepEqual(decide({ ...base, relativePath: 'src/new.test.ts', marker: FRESH }), { action: 'allow', code: 'new-test' });
  });

  it('4. ignores an expired fix mode', () => {
    const expired = { ...FRESH, startedAt: new Date(NOW - 5 * HOUR).toISOString() };
    assert.deepEqual(decide({ ...base, relativePath: 'src/a.test.ts', marker: expired }), { action: 'allow', code: 'expired' });
  });

  it('5. lets ALLOW_TEST_EDITS=1 allow one edit', () => {
    assert.deepEqual(decide({ ...base, env: { ALLOW_TEST_EDITS: '1' }, relativePath: 'src/a.test.ts', marker: FRESH }), { action: 'allow', code: 'override' });
  });

  it('blocks a locked new test even though it is not tracked', () => {
    const locked = { ...FRESH, protected: ['src/new.test.ts'] };
    assert.deepEqual(decide({ ...base, relativePath: 'src/new.test.ts', marker: locked }), { action: 'block', code: 'locked' });
  });

  it('allows everything when the workflow control tests.guard is off', () => {
    assert.deepEqual(decide({ ...base, guardControl: 'off', relativePath: 'src/a.test.ts', marker: FRESH }), { action: 'allow', code: 'control-off' });
  });

  it('allows edits to files that are not tests', () => {
    assert.deepEqual(decide({ ...base, relativePath: 'src/a.ts', marker: FRESH }), { action: 'allow', code: 'not-a-test' });
  });
});

describe('parseHookInput and toRelative', () => {
  it('reads the file path and working folder from the hook JSON', () => {
    const parsed = parseHookInput(JSON.stringify({ tool_name: 'Edit', cwd: '/p', tool_input: { file_path: '/p/src/a.ts' } }));
    assert.deepEqual(parsed, { toolName: 'Edit', filePaths: ['/p/src/a.ts'], cwd: '/p' });
  });

  it('returns no paths for broken or unrelated input', () => {
    assert.deepEqual(parseHookInput('{oops').filePaths, []);
    assert.deepEqual(parseHookInput(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })).filePaths, []);
  });

  it('turns absolute and relative paths into forward-slash paths relative to the root', () => {
    const root = join(tmpdir(), 'proj');
    assert.equal(toRelative(root, join(root, 'src', 'a.test.ts')), 'src/a.test.ts');
    assert.equal(toRelative(root, 'src/a.test.ts'), 'src/a.test.ts');
  });

  it('builds a message that names the file and the way forward', () => {
    const message = buildBlockMessage('src/a.test.ts', 'existing-test');
    assert.match(message, /src\/a\.test\.ts/);
    assert.match(message, /ALLOW_TEST_EDITS=1/);
    assert.match(message, /new test file/);
    assert.match(buildBlockMessage('x.test.ts', 'locked'), /locked as the proof/);
  });
});

describe('the real hook in a throw-away git repo', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));

  function git(root, ...args) {
    const result = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  }

  function makeRepo(workflowJson) {
    const root = mkdtempSync(join(tmpdir(), 'guard-'));
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 't@e.c');
    git(root, 'config', 'user.name', 't');
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'src', 'a.ts'), 'a\n');
    writeFileSync(join(root, 'src', 'a.test.ts'), 'test\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    copyFileSync(join(HERE, 'test-edit-guard.mjs'), join(root, 'scripts', 'test-edit-guard.mjs'));
    copyFileSync(join(HERE, 'workflow-config.mjs'), join(root, 'scripts', 'workflow-config.mjs'));
    if (workflowJson) {
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(join(root, '.claude', 'workflow.json'), workflowJson);
    }
    return root;
  }

  const script = (root, ...args) =>
    spawnSync('node', ['scripts/test-edit-guard.mjs', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ALLOW_TEST_EDITS: '', CLAUDE_PROJECT_DIR: '' } });

  const hook = (root, filePath, env = {}) =>
    spawnSync('node', ['scripts/test-edit-guard.mjs'], {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Edit', cwd: root, tool_input: { file_path: join(root, filePath) } }),
      env: { ...process.env, ALLOW_TEST_EDITS: '', CLAUDE_PROJECT_DIR: '', ...env },
    });

  function inRepo(workflowJson, callback) {
    const root = makeRepo(workflowJson);
    try {
      callback(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('allows every edit while fix mode is off', () => {
    inRepo('{"overrides":{"tests.guard":"on"}}', (root) => {
      assert.equal(hook(root, 'src/a.test.ts').status, 0);
    });
  });

  it('blocks an existing test in fix mode with exit code 2 and a message, and allows code and new tests', () => {
    inRepo('{"overrides":{"tests.guard":"on"}}', (root) => {
      assert.match(script(root, 'start', '--reason', 'fix the bug').stdout, /Fix mode is ON/);
      const blocked = hook(root, 'src/a.test.ts');
      assert.equal(blocked.status, 2);
      assert.match(blocked.stderr, /edit blocked/);
      assert.equal(hook(root, 'src/a.ts').status, 0);
      assert.equal(hook(root, 'src/new.test.ts').status, 0);
      assert.match(readFileSync(join(root, '.claude', 'state', 'test-guard.log'), 'utf8'), /blocked existing-test src\/a\.test\.ts/);
    });
  });

  it('locks a new test with `lock`, so it is protected too', () => {
    inRepo('{"overrides":{"tests.guard":"on"}}', (root) => {
      script(root, 'start');
      writeFileSync(join(root, 'src', 'new.test.ts'), 'failing test\n');
      assert.equal(hook(root, 'src/new.test.ts').status, 0);
      assert.match(script(root, 'lock').stdout, /Locked 1 new test file/);
      assert.equal(hook(root, 'src/new.test.ts').status, 2);
    });
  });

  it('allows everything after `stop`, and with ALLOW_TEST_EDITS=1', () => {
    inRepo('{"overrides":{"tests.guard":"on"}}', (root) => {
      script(root, 'start');
      assert.equal(hook(root, 'src/a.test.ts', { ALLOW_TEST_EDITS: '1' }).status, 0);
      script(root, 'stop');
      assert.equal(hook(root, 'src/a.test.ts').status, 0);
      assert.equal(existsSync(join(root, '.claude', 'state', 'fix-mode.json')), false);
    });
  });

  it('does not block in the default solo profile (tests.guard is off) and says so on start', () => {
    inRepo(undefined, (root) => {
      const started = script(root, 'start');
      assert.match(started.stdout, /tests\.guard is OFF/);
      assert.equal(hook(root, 'src/a.test.ts').status, 0);
    });
  });

  it('blocks in the team profile', () => {
    inRepo('{"profile":"team"}', (root) => {
      script(root, 'start');
      assert.equal(hook(root, 'src/a.test.ts').status, 2);
    });
  });

  it('fails open on broken input and when the resolver file is missing', () => {
    inRepo('{"overrides":{"tests.guard":"on"}}', (root) => {
      script(root, 'start');
      const broken = spawnSync('node', ['scripts/test-edit-guard.mjs'], { cwd: root, encoding: 'utf8', input: '{oops' });
      assert.equal(broken.status, 0);
      rmSync(join(root, 'scripts', 'workflow-config.mjs'));
      assert.equal(hook(root, 'src/a.test.ts').status, 2, 'no resolver: the marker alone turns the guard on');
    });
  });

  it('reports status', () => {
    inRepo('{"overrides":{"tests.guard":"on"}}', (root) => {
      assert.match(script(root, 'status').stdout, /Fix mode: off/);
      script(root, 'start', '--reason', 'bug 12');
      const status = script(root, 'status').stdout;
      assert.match(status, /Fix mode: ON/);
      assert.match(status, /bug 12/);
    });
  });
});
