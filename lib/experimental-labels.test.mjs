import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Native e2e (Maestro) is written from the tool's documentation and not verified on a device. Everywhere a user meets
// the choice, it carries the word "experimental", so it cannot be picked without seeing that.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(KIT, ...parts), 'utf8');

test('the questionnaire option for native e2e says it is experimental', () => {
  const option = JSON.parse(read('catalog', 'options.json')).options.find((o) => o.control === 'tests.e2e');
  assert.ok(option, 'the tests.e2e option exists');
  assert.match(option.values.native, /experimental/i);
  assert.match(option.impact, /experimental/i);
});

test('the tests.e2e description in workflow-config says native is experimental', () => {
  assert.match(read('templates', 'scripts', 'workflow-config.mjs'), /native = [^']*experimental/i);
});

test('the e2e-tests skill says native is experimental', () => {
  assert.match(read('skills', 'e2e-tests', 'SKILL.md'), /`native`[^\n]*experimental/i);
});

test('the README says native e2e is experimental', () => {
  assert.match(read('README.md'), /native[^\n]*experimental|experimental[^\n]*native/i);
});
