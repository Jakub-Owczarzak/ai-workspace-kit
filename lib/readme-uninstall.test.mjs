import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The README says how to install and set up the kit, and also how to take it out again.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(KIT, 'README.md'), 'utf8');
const section = readme.match(/^## Uninstall\n([\s\S]*?)(?=^## )/m)?.[1];

test('the README has an Uninstall section', () => {
  assert.ok(section, 'a "## Uninstall" section exists');
});

test('the Uninstall section gives the preview command and the real one', () => {
  assert.match(section, /node \.claude\/workspace-kit\/bin\/cli\.mjs uninstall\s/);
  assert.match(section, /node \.claude\/workspace-kit\/bin\/cli\.mjs uninstall --yes/);
});

test('the Uninstall section explains what is kept, the cleanup prompt and --purge', () => {
  assert.match(section, /changed since|you (have )?changed|edited/i);
  assert.match(section, /prompt/i);
  assert.match(section, /--purge/);
});

test('the Uninstall section links to the full description', () => {
  assert.match(section, /\(docs\/install-and-update\.md#uninstall\)/);
});

test('the README stays a landing page: under 150 lines', () => {
  assert.ok(readme.split('\n').length < 150, `${readme.split('\n').length} lines`);
});
