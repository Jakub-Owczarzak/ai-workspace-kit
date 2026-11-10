import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitignoreWithKit, packageScriptText, releaseWorkflowText } from './project-files.mjs';

const TEMPLATE = readFileSync(join(import.meta.dirname, '..', 'templates', 'workflows', 'release_bump.yaml'), 'utf8');
const FACTS = {
  protectedBranch: 'main',
  changelogScript: '.claude/skills/wk-changelog-bump/scripts/changelog.mjs',
  versionFiles: ['package.json:version', 'app.json:expo.version'],
};

test('gitignore: the user lines survive, the block is added once', () => {
  const mine = 'node_modules/\n.env\n';
  const once = gitignoreWithKit(mine, ['.claude/state/']);
  assert.ok(once.startsWith(mine));
  assert.equal(gitignoreWithKit(once, ['.claude/state/']), once);
  assert.match(gitignoreWithKit(once, ['.claude/state/', '.claude/reviews/']), /\.claude\/reviews\//);
});

test('package script: added when free, kept when the user has one', () => {
  const text = '{\n    "name": "x",\n    "scripts": {\n        "test": "vitest"\n    }\n}\n';
  const added = packageScriptText(text, 'check:config', 'node scripts/check-config.mjs');
  assert.equal(added.status, 'added');
  assert.equal(JSON.parse(added.text).scripts.test, 'vitest');
  assert.match(added.text, /\n {8}"check:config"/, 'four-space indentation is kept');
  assert.equal(packageScriptText(added.text, 'check:config', 'node scripts/check-config.mjs').status, 'unchanged');
  assert.equal(packageScriptText(text.replace('"test"', '"check:config": "mine", "test"'), 'check:config', 'x').status, 'exists');
});

test('package script: a package.json without scripts gets a scripts section; broken JSON is left alone', () => {
  assert.equal(packageScriptText('{"name":"x"}', 'a', 'b').status, 'added');
  assert.equal(packageScriptText('{oops', 'a', 'b').status, 'no-scripts');
});

test('release workflow: every placeholder is filled from the project facts', () => {
  const { text, missing } = releaseWorkflowText(TEMPLATE, FACTS);
  assert.equal(missing, undefined);
  assert.match(text, /branches: \[main\]/);
  assert.match(text, /--version-file package\.json:version/);
  assert.match(text, /--version-file app\.json:expo\.version/);
  assert.match(text, /git add package\.json app\.json CHANGELOG\.md/);
  assert.match(text, /\.claude\/skills\/wk-changelog-bump\/scripts\/changelog\.mjs/);
  assert.doesNotMatch(text, /<[A-Z][A-Z ]+>/);
});

test('release workflow: missing facts mean nothing is written, and the answers needed are named', () => {
  assert.deepEqual(releaseWorkflowText(TEMPLATE, { ...FACTS, protectedBranch: undefined }).missing, ['protectedBranch']);
  assert.deepEqual(releaseWorkflowText(TEMPLATE, { ...FACTS, versionFiles: [] }).missing, ['versionFiles']);
});
