import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPreCommitBody, buildPrePushBody, findHookDir, installHookBlock } from './hooks.mjs';

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-hook-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};
const hookFile = (dir, name) => join(dir, '.git', 'hooks', name);
const BODY = 'echo kit-check || exit 1';

test('creates a hook with a shebang and the block in a plain git repository', () => {
  const dir = repo();
  const result = installHookBlock({ dir, name: 'pre-commit', body: BODY });
  assert.equal(result.status, 'created');
  const text = readFileSync(hookFile(dir, 'pre-commit'), 'utf8');
  assert.ok(text.startsWith('#!/bin/sh\n'));
  assert.match(text, /# workspace-kit:start pre-commit/);
});

test("an existing hook keeps the user's lines before and after the block, byte for byte", () => {
  const dir = repo();
  const mine = '#!/bin/sh\necho "my own check"\nnpx lint-staged\n';
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  writeFileSync(hookFile(dir, 'pre-commit'), mine);
  installHookBlock({ dir, name: 'pre-commit', body: BODY });
  assert.ok(readFileSync(hookFile(dir, 'pre-commit'), 'utf8').startsWith(mine));
});

test('a second install changes nothing', () => {
  const dir = repo();
  installHookBlock({ dir, name: 'pre-commit', body: BODY });
  assert.equal(installHookBlock({ dir, name: 'pre-commit', body: BODY }).status, 'unchanged');
});

test('a changed body replaces only the block', () => {
  const dir = repo();
  installHookBlock({ dir, name: 'pre-commit', body: 'echo old' });
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  writeFileSync(hookFile(dir, 'pre-commit'), readFileSync(hookFile(dir, 'pre-commit'), 'utf8') + 'echo after-me\n');
  assert.equal(installHookBlock({ dir, name: 'pre-commit', body: 'echo new' }).status, 'updated');
  const text = readFileSync(hookFile(dir, 'pre-commit'), 'utf8');
  assert.match(text, /echo new/);
  assert.doesNotMatch(text, /echo old/);
  assert.match(text, /echo after-me/);
});

test('husky: the block goes into .husky/<hook> and .git/hooks stays untouched', () => {
  const dir = repo();
  mkdirSync(join(dir, '.husky'));
  writeFileSync(join(dir, '.husky', 'pre-commit'), 'npx lint-staged\n');
  assert.equal(findHookDir(dir).system, 'husky');
  installHookBlock({ dir, name: 'pre-commit', body: BODY });
  const text = readFileSync(join(dir, '.husky', 'pre-commit'), 'utf8');
  assert.ok(text.startsWith('npx lint-staged\n'));
  assert.match(text, /kit-check/);
  assert.ok(!existsSync(hookFile(dir, 'pre-commit')));
});

test('core.hooksPath is honoured', () => {
  const dir = repo();
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
  installHookBlock({ dir, name: 'pre-commit', body: BODY });
  assert.ok(existsSync(join(dir, '.githooks', 'pre-commit')));
});

test('a hook manager the kit cannot edit safely is reported, and nothing is written', () => {
  const dir = repo();
  writeFileSync(join(dir, 'lefthook.yml'), 'pre-commit: {}\n');
  const result = installHookBlock({ dir, name: 'pre-commit', body: BODY });
  assert.equal(result.status, 'manual');
  assert.match(result.reason, /lefthook\.yml/);
  assert.match(result.snippet, /kit-check/, 'the lines to add by hand are handed over');
  assert.ok(!existsSync(hookFile(dir, 'pre-commit')));
});

test('a hook written in another language is not edited', () => {
  const dir = repo();
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  writeFileSync(hookFile(dir, 'pre-commit'), '#!/usr/bin/env python3\nprint("hi")\n');
  assert.match(installHookBlock({ dir, name: 'pre-commit', body: BODY }).reason, /not a shell script/);
});

test('a pre-push hook that reads stdin (git-lfs) is not edited, because two readers would starve each other', () => {
  const dir = repo();
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  writeFileSync(hookFile(dir, 'pre-push'), '#!/bin/sh\ncommand -v git-lfs >/dev/null 2>&1 || exit 2\ngit lfs pre-push "$@"\n');
  const result = installHookBlock({ dir, name: 'pre-push', body: BODY });
  assert.equal(result.status, 'manual');
  assert.match(result.reason, /stdin/);
});

test('outside a git repository there is nothing to chain into', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-nogit-'));
  assert.match(installHookBlock({ dir, name: 'pre-commit', body: BODY }).reason, /not a git repository/);
});

test('dry run writes nothing', () => {
  const dir = repo();
  assert.equal(installHookBlock({ dir, name: 'pre-commit', body: BODY, dryRun: true }).status, 'created');
  assert.ok(!existsSync(hookFile(dir, 'pre-commit')));
});

test('the generated blocks are valid shell', (t) => {
  if (spawnSync('sh', ['-c', 'true']).error) return t.skip('sh is not on the PATH here (Linux and macOS jobs cover it)');
  const template = readFileSync(join(import.meta.dirname, '..', 'templates', 'hooks', 'pre-commit'), 'utf8');
  const preCommit = buildPreCommitBody({
    commands: { lint: 'npm run lint', test: 'npm test' },
    docsFresh: true,
    changelogScript: '.claude/skills/wk-changelog-bump/scripts/changelog.mjs',
    changelogTemplate: template,
  });
  const prePush = buildPrePushBody({ protectedBranch: 'main', reviewGate: true });
  for (const body of [preCommit, prePush]) {
    const syntax = spawnSync('sh', ['-n'], { input: body, encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  assert.match(preCommit, /npm run lint \|\| exit 1/);
  assert.match(preCommit, /CHANGELOG_SCRIPT=\.claude\/skills\/wk-changelog-bump/);
  assert.doesNotMatch(preCommit, /<[A-Z ]+>/, 'no placeholder may be left in a written hook');
  assert.match(prePush, /refs\/heads\/main/);
});

test('without a protected branch the pre-push block does not stop pushes to any branch', () => {
  assert.doesNotMatch(buildPrePushBody({ reviewGate: true }), /is blocked/);
});
