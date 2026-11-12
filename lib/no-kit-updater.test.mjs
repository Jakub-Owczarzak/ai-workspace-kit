import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The kit has no skill that pushes changes to the kit's own repository or opens pull requests there. Upgrades go through
// npm (`npx ai-workspace-kit@latest init --force`); contributions are an ordinary GitHub issue or pull request from a fork.
// This keeps the skill, its catalog option and every mention of it from coming back by accident.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLD_NAME = 'update-workspace-kit';
const SHIPPED = ['skills', 'rules', 'templates', 'adapters', 'stacks', 'docs', 'catalog', 'lib', 'bin', 'README.md', 'RELEASING.md'];

function textFiles(path, out = []) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) textFiles(join(path, name), out);
  } else if (/\.(md|json|mjs|js|yml|yaml|txt|svg)$/.test(path)) {
    out.push(path);
  }
  return out;
}

test('the catalog does not offer a kit updater, and asks for no kit repository address', () => {
  const catalog = readFileSync(join(KIT, 'catalog', 'options.json'), 'utf8');
  assert.ok(!catalog.includes(OLD_NAME));
  assert.ok(!/kit repository address/i.test(catalog));
});

test('the update-workspace-kit skill folder is gone', () => {
  assert.equal(existsSync(join(KIT, 'skills', OLD_NAME)), false);
});

test('no shipped file mentions update-workspace-kit, except the install doc, which tells users to delete the old folder', () => {
  const here = fileURLToPath(import.meta.url);
  const hits = SHIPPED.map((p) => join(KIT, p))
    .filter((p) => existsSync(p))
    .flatMap((p) => textFiles(p))
    .filter((file) => file !== here && readFileSync(file, 'utf8').includes(OLD_NAME))
    .map((file) => relative(KIT, file).replaceAll('\\', '/'));
  assert.deepEqual(hits, ['docs/install-and-update.md']);
});

test('the setup skill does not ask for a kit repository address', () => {
  assert.ok(!/kit repository address/i.test(readFileSync(join(KIT, 'skills', 'setup-workspace', 'SKILL.md'), 'utf8')));
});

test('the install doc says how to upgrade and how to contribute', () => {
  const doc = readFileSync(join(KIT, 'docs', 'install-and-update.md'), 'utf8');
  assert.match(doc, /npx ai-workspace-kit@latest init --force/);
  assert.match(doc, /CONTRIBUTING\.md/);
});

test('CONTRIBUTING.md asks for an issue first and says what is closed', () => {
  const text = readFileSync(join(KIT, 'CONTRIBUTING.md'), 'utf8');
  assert.match(text, /issue/i);
  assert.match(text, /fork/i);
  assert.match(text, /closed/i);
});
