// Run: node --test check-docs-fresh.integration.test.mjs
// Runs the real script in a throw-away git repository, to prove the workflow profile drives its mode.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function git(root, ...args) {
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result;
}

/** A repo with src/a.ts staged but AGENTS.md not, the scripts copied in, and an optional workflow.json. */
function makeRepo(workflowJson, { copyResolver = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-fresh-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'tester');
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'AGENTS.md'), 'a\n');
  writeFileSync(join(root, 'src', 'a.ts'), 'a\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  writeFileSync(join(root, 'src', 'a.ts'), 'a\nb\n');
  git(root, 'add', '-A');
  copyFileSync(join(HERE, 'check-docs-fresh.mjs'), join(root, 'scripts', 'check-docs-fresh.mjs'));
  if (copyResolver) copyFileSync(join(HERE, 'workflow-config.mjs'), join(root, 'scripts', 'workflow-config.mjs'));
  if (workflowJson !== undefined) {
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude', 'workflow.json'), workflowJson);
  }
  return root;
}

function runCheck(root, env = {}) {
  const cleanEnvironment = { ...process.env };
  for (const name of ['DOCS_CHECK', 'DOCS_SKIP', 'WORKFLOW_PROFILE']) delete cleanEnvironment[name];
  return spawnSync('node', ['scripts/check-docs-fresh.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...cleanEnvironment, ...env },
  });
}

function inRepo(workflowJson, options, callback) {
  const root = makeRepo(workflowJson, options);
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check-docs-fresh follows the workflow profile', () => {
  it('warns and allows the commit with no workflow.json (solo behaviour, as before)', () => {
    inRepo(undefined, {}, (root) => {
      const result = runCheck(root);
      assert.equal(result.status, 0);
      assert.match(result.stderr, /docs-fresh/);
      assert.match(result.stderr, /Commit allowed/);
    });
  });

  it('blocks in the org profile', () => {
    inRepo('{"profile":"org"}', {}, (root) => {
      const result = runCheck(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Commit blocked/);
    });
  });

  it('lets an override relax the org profile', () => {
    inRepo('{"profile":"org","overrides":{"docs.check":"warn"}}', {}, (root) => {
      assert.equal(runCheck(root).status, 0);
    });
  });

  it('lets DOCS_CHECK=strict beat a solo profile for one command', () => {
    inRepo('{"profile":"solo"}', {}, (root) => {
      assert.equal(runCheck(root, { DOCS_CHECK: 'strict' }).status, 1);
    });
  });

  it('lets WORKFLOW_PROFILE=org switch the profile for one command', () => {
    inRepo('{"profile":"solo"}', {}, (root) => {
      assert.equal(runCheck(root, { WORKFLOW_PROFILE: 'org' }).status, 1);
    });
  });

  it('is silent when the overview is part of the commit, even in org', () => {
    inRepo('{"profile":"org"}', {}, (root) => {
      writeFileSync(join(root, 'AGENTS.md'), 'a\nupdated\n');
      git(root, 'add', '-A');
      const result = runCheck(root);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
    });
  });

  it('never blocks because of a broken workflow.json: it warns and falls back to solo', () => {
    inRepo('{ not json', {}, (root) => {
      const result = runCheck(root);
      assert.equal(result.status, 0);
      assert.match(result.stderr, /workflow: workflow\.json is not valid JSON/);
    });
  });

  it('still works with DOCS_CHECK alone when the resolver file is not installed', () => {
    inRepo('{"profile":"org"}', { copyResolver: false }, (root) => {
      assert.equal(runCheck(root).status, 0, 'no resolver: the default mode is warn');
      assert.equal(runCheck(root, { DOCS_CHECK: 'strict' }).status, 1);
    });
  });
});
