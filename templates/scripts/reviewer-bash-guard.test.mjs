import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideCommand, decideFromPayload, isReviewer, projectCommands } from './reviewer-bash-guard.mjs';
import { projectCommands as factoryProjectCommands } from './factory-guard.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'reviewer-bash-guard.mjs');
const COMMANDS = { lint: 'npm run lint', test: 'npm test', build: 'npm run build' };
const verdict = (command) => decideCommand(command, COMMANDS);

test('the guard only restricts the reviewer: another agent, the main session and other tools pass', () => {
  assert.equal(isReviewer({ agent_type: 'reviewer' }), true);
  for (const payload of [{}, { agent_type: 'factory-builder' }, { agent_type: 'reviewer-2' }, { agent_type: '' }]) {
    assert.equal(isReviewer(payload), false, JSON.stringify(payload));
  }
  const payload = (extra) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, ...extra });
  assert.equal(decideFromPayload(payload({}), COMMANDS).allow, true, 'main session');
  assert.equal(decideFromPayload(payload({ agent_type: 'factory-builder' }), COMMANDS).allow, true, 'builder');
  assert.equal(decideFromPayload(payload({ agent_type: 'reviewer', tool_name: 'Read' }), COMMANDS).allow, true, 'not a Bash call');
  assert.equal(decideFromPayload(payload({ agent_type: 'reviewer' }), COMMANDS).allow, false, 'reviewer running rm');
});

test('the reviewer may read git state', () => {
  for (const command of [
    'git status',
    'git status --short',
    'git diff',
    'git diff --cached',
    'git diff --cached --stat',
    'git diff main...HEAD',
    'git log --oneline -5',
    'git show HEAD~1',
    'git show abc1234:src/app.ts',
    'git status\r',
  ]) {
    assert.equal(verdict(command).allow, true, command);
  }
});

test('the reviewer may run the project lint, type check, test and build commands, with extra arguments', () => {
  for (const command of ['npm run lint', 'npm test', 'npm run build', 'npm test -- src/a.test.js', 'npm test -- -t "a name with spaces"', 'npm test -- src\\a.test.js']) {
    assert.equal(verdict(command).allow, true, command);
  }
});

test('the reviewer may also list files, resolve a revision, find a merge base and read the branch name', () => {
  for (const command of [
    'git ls-files',
    'git ls-files src',
    'git ls-files --others --exclude-standard',
    'git rev-parse HEAD',
    'git rev-parse --abbrev-ref HEAD',
    'git rev-parse --show-toplevel',
    'git merge-base main HEAD',
    'git branch --show-current',
  ]) {
    assert.equal(verdict(command).allow, true, command);
  }
});

test('the branch command is allowed only to read the current name: listing, creating, renaming and deleting stay refused', () => {
  for (const command of [
    'git branch',
    'git branch newbranch',
    'git branch -D old',
    'git branch -m old new',
    'git branch --show-current extra',
    'git branch --show-current --delete',
    'git ls-files --output=out.txt',
    'git rev-parse HEAD > out.txt',
    'git merge-base main HEAD; touch x',
    'git ls-files $(touch x)',
  ]) {
    assert.equal(verdict(command).allow, false, command);
  }
});

test('the reviewer may read the plan and a handoff through the factory script, the two subcommands that only read', () => {
  for (const command of [
    'node scripts/factory-guard.mjs plan-excerpt',
    'node scripts/factory-guard.mjs plan-excerpt --bucket 1',
    'node scripts/factory-guard.mjs plan-excerpt --bucket 2a',
    'node ./scripts/factory-guard.mjs plan-excerpt --bucket 1.2',
    'node scripts/factory-guard.mjs handoff-check --bucket 1',
  ]) {
    assert.equal(verdict(command).allow, true, command);
  }
});

test('every other factory script subcommand, and any extra argument or other script, is refused', () => {
  for (const command of [
    'node scripts/factory-guard.mjs report --reason x',
    'node scripts/factory-guard.mjs attempt --key main',
    'node scripts/factory-guard.mjs baseline',
    'node scripts/factory-guard.mjs reset',
    'node scripts/factory-guard.mjs preflight',
    'node scripts/factory-guard.mjs push-check --branch x',
    'node scripts/factory-guard.mjs plan-excerpt --bucket 1 --root /elsewhere',
    'node scripts/factory-guard.mjs plan-excerpt --root /elsewhere',
    'node scripts/factory-guard.mjs plan-excerpt --bucket 1; touch x',
    'node scripts/factory-guard.mjs plan-excerpt --bucket $(touch x)',
    'node scripts/factory-guard.mjs handoff-check',
    'node scripts/check-review-gate.mjs record --blocking 0',
    'node ../scripts/factory-guard.mjs plan-excerpt',
    'node /tmp/factory-guard.mjs plan-excerpt',
  ]) {
    assert.equal(verdict(command).allow, false, command);
  }
});

test('git commands that change anything are refused', () => {
  for (const command of [
    'git add -A',
    'git commit -m x',
    'git push',
    'git checkout main',
    'git switch main',
    'git stash',
    'git reset --hard',
    'git restore .',
    'git clean -fd',
    'git merge main',
    'git rebase main',
    'git branch -D x',
    'git -c core.pager=evil status',
    'git config user.name x',
  ]) {
    assert.equal(verdict(command).allow, false, command);
  }
});

test('read-only git subcommands are refused when a flag makes them write or run a program', () => {
  for (const command of ['git diff --output=out.txt', 'git log --output out.txt', 'git show --ext-diff HEAD', 'git diff --textconv', 'git diff --no-index a b --output=c']) {
    assert.equal(verdict(command).allow, false, command);
  }
});

test('any other command is refused, including package installs and the network', () => {
  for (const command of ['rm x', 'touch x', 'rm -rf .', 'curl https://example.com', 'npm install', 'npm install left-pad', 'npm run deploy', 'node script.js', 'cat file', 'echo hi', 'sed -i s/a/b/ f', 'mv a b', 'cp a b']) {
    assert.equal(verdict(command).allow, false, command);
  }
});

test('chaining, redirects, pipes and substitution are refused even after an allowed command', () => {
  for (const command of [
    'git status; rm x',
    'git status && touch x',
    'git status || touch x',
    'git diff | tee f',
    'git diff > out.txt',
    'git log >> out.txt',
    'git show HEAD < in',
    'git log $(rm x)',
    'git log `rm x`',
    'git status\nrm x',
    'git status & rm x',
    'npm test; rm x',
    'npm run lint && npm run build',
    'npm test > out.txt',
    'npm test -- $(rm x)',
  ]) {
    assert.equal(verdict(command).allow, false, JSON.stringify(command));
  }
});

test('a project command the project does not list is refused, and without a project command list only git passes', () => {
  assert.equal(decideCommand('npm run e2e', COMMANDS).allow, false);
  assert.equal(decideCommand('npm test', {}).allow, false);
  assert.equal(decideCommand('git status', {}).allow, true);
});

test('a refusal says what the reviewer may run, so it can carry on with an allowed command', () => {
  const { reason } = verdict('git add -A');
  assert.match(reason, /git status/);
  assert.match(reason, /npm test/);
  assert.match(reason, /one command per call/i);
});

test('an empty command, or text that is not a hook payload, is let through: the guard fails open', () => {
  assert.equal(decideFromPayload('', COMMANDS).allow, true);
  assert.equal(decideFromPayload('not json', COMMANDS).allow, true);
  assert.equal(decideFromPayload('null', COMMANDS).allow, true);
  assert.equal(decideFromPayload(JSON.stringify({ agent_type: 'reviewer', tool_name: 'Bash', tool_input: {} }), COMMANDS).allow, true);
});

test('the guard stands alone but reads the Commands block exactly as factory-guard.mjs does', () => {
  const fixtures = [
    '```\nnpm run lint   # lint\nnpm test   # test\n```\n',
    '```\npnpm typecheck\npnpm test\nnpm run build   # build\n```\n',
    '```\n<lint command>   # lint\nyarn lint\nnpx tsc --noEmit   # type check\nnpx vitest run   # tests\n```\n',
    'npm run lint outside a fence\n```\nnpm run lint   # lint\nnpm run lint:fix   # lint\n```\r\n',
    '',
    'no commands at all',
  ];
  for (const text of fixtures) assert.deepEqual(projectCommands(text), factoryProjectCommands(text), JSON.stringify(text));
});

function runHook(dir, payload) {
  return spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ cwd: dir, tool_name: 'Bash', agent_type: 'reviewer', ...payload }), encoding: 'utf8' });
}

test('started as a hook it reads AGENTS.md of the project: exit 0 for an allowed command, exit 2 and a message on stderr for a refused one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-guard-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), '# Project\n\n## Commands\n\n```\nnpm run lint   # lint\nnpm test   # test\n```\n');
    const allowed = runHook(dir, { tool_input: { command: 'npm test' } });
    assert.equal(allowed.status, 0, allowed.stderr);
    const git = runHook(dir, { tool_input: { command: 'git diff --cached' } });
    assert.equal(git.status, 0, git.stderr);
    const refused = runHook(dir, { tool_input: { command: 'touch x' } });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /reviewer/i);
    assert.match(refused.stderr, /npm run lint/);
    const other = runHook(dir, { agent_type: undefined, tool_input: { command: 'touch x' } });
    assert.equal(other.status, 0, 'the main session is not restricted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('started as a hook in a folder with no AGENTS.md, only git commands pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-guard-'));
  try {
    assert.equal(runHook(dir, { tool_input: { command: 'git status' } }).status, 0);
    assert.equal(runHook(dir, { tool_input: { command: 'npm test' } }).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
