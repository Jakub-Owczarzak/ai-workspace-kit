import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasBlock, removeBlock, upsertBlock } from './blocks.mjs';

const USER_TEXT = '# My project\n\nMy own rule: never use var.\n';

test('adds a block after the user text and keeps the user text byte for byte', () => {
  const result = upsertBlock(USER_TEXT, 'rules', 'Kit rule.');
  assert.ok(result.startsWith(USER_TEXT));
  assert.ok(hasBlock(result, 'rules'));
  assert.match(result, /Kit rule\./);
});

test('a second upsert with the same body changes nothing', () => {
  const once = upsertBlock(USER_TEXT, 'rules', 'Kit rule.');
  assert.equal(upsertBlock(once, 'rules', 'Kit rule.'), once);
});

test('a changed body replaces only the block', () => {
  const once = upsertBlock(USER_TEXT + '\nTail from the user.\n', 'rules', 'Old.');
  const twice = upsertBlock(once, 'rules', 'New.');
  assert.match(twice, /New\./);
  assert.doesNotMatch(twice, /Old\./);
  assert.ok(twice.includes('Tail from the user.'));
});

test('two blocks with different ids do not disturb each other', () => {
  const text = upsertBlock(upsertBlock('', 'a', 'AAA'), 'b', 'BBB');
  assert.match(upsertBlock(text, 'a', 'A2'), /BBB/);
});

test('remove restores the user text', () => {
  const withBlock = upsertBlock(USER_TEXT, 'rules', 'Kit rule.');
  assert.equal(removeBlock(withBlock, 'rules'), USER_TEXT);
});

test('removing a block that is followed by your text leaves exactly one newline at the end', () => {
  const text = upsertBlock('', 'rules', 'Kit rule.') + '\nMy note\n';
  assert.equal(removeBlock(text, 'rules'), 'My note\n');
  const between = 'Before.\n\n' + upsertBlock('', 'rules', 'Kit rule.') + '\nAfter.\n';
  assert.equal(removeBlock(between, 'rules'), 'Before.\n\nAfter.\n');
});

test('hash style works for hooks and yaml', () => {
  const result = upsertBlock('#!/bin/sh\necho mine\n', 'pre-commit', 'echo kit', 'hash');
  assert.match(result, /# workspace-kit:start pre-commit/);
  assert.equal(upsertBlock(result, 'pre-commit', 'echo kit', 'hash'), result);
});

test('a half-edited block is refused instead of being corrupted', () => {
  const broken = '<!-- workspace-kit:start rules -->\nno end marker\n';
  assert.throws(() => upsertBlock(broken, 'rules', 'x'), /both/);
});
