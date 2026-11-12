import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The first lines of the README carry three badges (CI, npm version, license). Each must name this repository and this
// package, so a rename or a typo cannot leave a dead badge on the front page.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(KIT, 'package.json'), 'utf8'));
const repo = pkg.repository.url.match(/github\.com\/([^/]+\/[^/.]+)/)[1];
const top = readFileSync(join(KIT, 'README.md'), 'utf8').split('\n').slice(0, 8).join('\n');

test('the README top has a CI badge for this repository that links to its workflow', () => {
  assert.ok(top.includes(`https://github.com/${repo}/actions/workflows/ci.yml/badge.svg`));
  assert.ok(top.includes(`(https://github.com/${repo}/actions/workflows/ci.yml)`));
});

test('the README top has an npm version badge for this package that links to npm', () => {
  assert.ok(top.includes(`https://img.shields.io/npm/v/${pkg.name}`));
  assert.ok(top.includes(`(https://www.npmjs.com/package/${pkg.name})`));
});

test('the README top has a license badge that matches package.json', () => {
  assert.ok(top.includes(`https://img.shields.io/npm/l/${pkg.name}`));
  assert.equal(pkg.license, 'MIT');
});

test('there are exactly three badges in the README top and each has alt text', () => {
  const badges = [...top.matchAll(/!\[([^\]]*)\]\(https:\/\/[^)]+\)/g)];
  assert.equal(badges.length, 3);
  for (const [, alt] of badges) assert.ok(alt.trim().length > 0);
});

test('the CI workflow the badge points at exists and is named ci', () => {
  assert.match(readFileSync(join(KIT, '.github', 'workflows', 'ci.yml'), 'utf8'), /^name: ci$/m);
});
