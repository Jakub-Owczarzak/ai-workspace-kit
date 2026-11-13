import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_COMMAND, REVIEWER_GUARD_COMMAND, mergeSettings, mergeSettingsText, removeKitSettings } from './settings.mjs';

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

// ---- The reviewer guard hook (a PreToolUse hook on Bash, in settings so it also runs in a folder Claude Code does not trust) ----

test('adds the reviewer guard as a Bash hook, after the project\'s own hooks and next to the test-edit guard', () => {
  const mine = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const result = mergeSettings(mine, { guardHook: true, reviewerGuard: true });
  const entries = result.object.hooks.PreToolUse;
  assert.equal(entries.length, 3);
  assert.equal(entries[0].hooks[0].command, 'echo mine', 'the project hook is first and untouched');
  assert.deepEqual(entries.at(-1), { matcher: 'Bash', hooks: [{ type: 'command', command: REVIEWER_GUARD_COMMAND }] });
  assert.match(REVIEWER_GUARD_COMMAND, /reviewer-bash-guard\.mjs/);
  assert.equal(result.added.reviewerGuard, true);
  assert.ok(result.changes.some((change) => /reviewer-guard/.test(change)));
});

test('the reviewer guard is added once, and a hook the project wired itself is recognised', () => {
  const first = mergeSettingsText(null, { reviewerGuard: true }).text;
  assert.equal(mergeSettingsText(first, { reviewerGuard: true }).changes.length, 0);
  const mine = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/reviewer-bash-guard.mjs' }] }] } };
  const result = mergeSettings(mine, { reviewerGuard: true });
  assert.equal(result.changes.length, 0);
  assert.equal(result.added.reviewerGuard, false, 'not the kit\'s, so an uninstall must not remove it');
});

test('it is only added when asked for', () => {
  assert.equal(mergeSettings({}, { guardHook: true }).object.hooks.PreToolUse.length, 1);
  assert.equal(mergeSettings({}, { planMode: true }).object.hooks, undefined);
});

test('removing the kit keys removes only the reviewer guard entry the kit added', () => {
  const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };
  const merged = mergeSettings({ hooks: { PreToolUse: [mine] } }, { guardHook: true, reviewerGuard: true }).object;
  const { object, removed } = removeKitSettings(merged, { reviewerGuard: true });
  assert.deepEqual(removed, ['hooks.PreToolUse: reviewer-guard']);
  assert.equal(object.hooks.PreToolUse.length, 2, 'the project hook and the test-edit guard stay');
  assert.deepEqual(object.hooks.PreToolUse[0], mine);
  const all = removeKitSettings(merged, { guardHook: true, reviewerGuard: true });
  assert.deepEqual(all.object.hooks.PreToolUse, [mine]);
});

test('an entry someone changed after the install is not removed, and an old record without the key removes nothing', () => {
  const merged = mergeSettings({}, { reviewerGuard: true }).object;
  merged.hooks.PreToolUse[0].hooks.push({ type: 'command', command: 'echo added later' });
  assert.deepEqual(removeKitSettings(merged, { reviewerGuard: true }).removed, []);
  const plain = mergeSettings({}, { reviewerGuard: true }).object;
  assert.deepEqual(removeKitSettings(plain, { defaultMode: true, guardHook: true }).removed, []);
});
