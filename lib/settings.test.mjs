import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_COMMAND, mergeSettings, mergeSettingsText } from './settings.mjs';

const BOTH = { planMode: true, guardHook: true };

test('adds both keys to an empty file', () => {
  const result = mergeSettingsText(null, BOTH);
  const parsed = JSON.parse(result.text);
  assert.equal(parsed.permissions.defaultMode, 'plan');
  assert.equal(parsed.hooks.PreToolUse[0].hooks[0].command, GUARD_COMMAND);
  assert.equal(parsed.hooks.PreToolUse[0].matcher, 'Edit|Write|MultiEdit');
});

test("keeps everything the user already has, including their own hooks and permissions", () => {
  const mine = {
    permissions: { allow: ['Bash(npm test)'], deny: ['Read(.env)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [] }] },
    env: { A: '1' },
  };
  const result = mergeSettings(mine, BOTH).object;
  assert.deepEqual(result.permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(result.permissions.deny, ['Read(.env)']);
  assert.equal(result.env.A, '1');
  assert.deepEqual(result.hooks.Stop, [{ hooks: [] }]);
  assert.equal(result.hooks.PreToolUse[0].hooks[0].command, 'echo mine');
  assert.equal(result.hooks.PreToolUse.length, 2);
});

test('is idempotent: a second merge changes nothing', () => {
  const first = mergeSettingsText(null, BOTH).text;
  const second = mergeSettingsText(first, BOTH);
  assert.equal(second.changes.length, 0);
  assert.equal(second.text, first);
});

test('a guard hook the user wired themselves is recognised and not added twice', () => {
  const mine = { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node scripts/test-edit-guard.mjs' }] }] } };
  assert.equal(mergeSettings(mine, { guardHook: true }).changes.length, 0);
});

test('a defaultMode the user chose is never replaced, and is reported', () => {
  const result = mergeSettings({ permissions: { defaultMode: 'acceptEdits' } }, { planMode: true });
  assert.equal(result.object.permissions.defaultMode, 'acceptEdits');
  assert.match(result.skipped[0], /acceptEdits/);
});

test('the file keeps its indentation', () => {
  const four = '{\n    "env": { "A": "1" }\n}\n';
  assert.match(mergeSettingsText(four, { planMode: true }).text, /^\{\n {4}"env"/);
  const tabs = '{\n\t"env": {}\n}\n';
  assert.match(mergeSettingsText(tabs, { planMode: true }).text, /^\{\n\t"env"/);
});

test('a file with comments is never rewritten', () => {
  const result = mergeSettingsText('{\n  // my note\n  "env": {}\n}\n', BOTH);
  assert.match(result.error, /not strict JSON/);
  assert.equal(result.text, undefined);
});

test('a file whose top level is not an object is refused', () => {
  assert.match(mergeSettingsText('[]', BOTH).error, /object/);
});
