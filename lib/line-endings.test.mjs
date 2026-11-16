// Run: node --test lib/line-endings.test.mjs
// A file you own that uses Windows line endings (CRLF, common with git's autocrlf) must come back from a kit edit with
// CRLF everywhere, not converted to LF (a whole-file diff) and not half and half.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from './apply.mjs';
import { setControl } from './controls.mjs';
import { matchLineEndings, usesCrlf } from './line-endings.mjs';
import { init } from './init.mjs';
import { packageScriptText, removePackageScriptText } from './project-files.mjs';
import { mergeSettingsText, removeKitSettingsText } from './settings.mjs';

const CRLF = (text) => text.replace(/\n/g, '\r\n');
const bareLineFeeds = (text) => (text.match(/(?<!\r)\n/g) ?? []).length;

test('usesCrlf looks at the first line break; matchLineEndings follows the original', () => {
  assert.equal(usesCrlf('a\r\nb\r\n'), true);
  assert.equal(usesCrlf('a\nb\n'), false);
  assert.equal(usesCrlf(''), false);
  assert.equal(usesCrlf(null), false);
  assert.equal(matchLineEndings('x\ny\n', 'a\r\nb\r\n'), 'x\r\ny\r\n');
  assert.equal(matchLineEndings('x\ny\n', 'a\nb\n'), 'x\ny\n');
  assert.equal(matchLineEndings('x\r\ny\n', 'a\r\nb\r\n'), 'x\r\ny\r\n', 'no double carriage returns');
  assert.equal(matchLineEndings('x\ny\n', null), 'x\ny\n');
});

test('config set keeps a CRLF workflow.json in CRLF', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-eol-'));
  init({ dir });
  apply({ dir, choices: { profile: 'team', tools: ['claude-code'], enabled: ['rule.verification'], overrides: { 'factory.mode': 'local' } } });
  const path = join(dir, '.claude/workflow.json');
  writeFileSync(path, CRLF(readFileSync(path, 'utf8')));

  setControl({ dir, name: 'docs.check', value: 'strict' });

  const after = readFileSync(path, 'utf8');
  assert.match(after, /"docs\.check": "strict"/);
  assert.equal(bareLineFeeds(after), 0, 'every line break is still CRLF');
  assert.ok(after.includes('\r\n'));
});

test('config set leaves an LF workflow.json in LF', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-eol-'));
  init({ dir });
  apply({ dir, choices: { profile: 'team', tools: ['claude-code'], enabled: ['rule.verification'], overrides: {} } });
  setControl({ dir, name: 'docs.check', value: 'strict' });
  assert.ok(!readFileSync(join(dir, '.claude/workflow.json'), 'utf8').includes('\r'));
});

test('settings.json keeps CRLF when the kit adds and removes its keys', () => {
  const original = CRLF('{\n  "env": {\n    "A": "1"\n  }\n}\n');
  const added = mergeSettingsText(original, { guardHook: true });
  assert.ok(added.text.includes('test-edit-guard'));
  assert.equal(bareLineFeeds(added.text), 0);
  const removed = removeKitSettingsText(added.text, { guardHook: true });
  assert.equal(bareLineFeeds(removed.text), 0);
  assert.equal(removed.text, original, 'the original comes back byte for byte');
});

test('package.json keeps CRLF when the kit adds and removes a script', () => {
  const original = CRLF('{\n  "name": "x",\n  "scripts": {\n    "test": "node --test"\n  }\n}\n');
  const added = packageScriptText(original, 'check:config', 'node scripts/check-config.mjs');
  assert.equal(added.status, 'added');
  assert.equal(bareLineFeeds(added.text), 0);
  const removed = removePackageScriptText(added.text, 'check:config', 'node scripts/check-config.mjs');
  assert.equal(removed.text, original);
});
