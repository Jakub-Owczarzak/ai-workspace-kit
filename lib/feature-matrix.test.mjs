import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_SPECS } from '../templates/scripts/workflow-config.mjs';
import {
  DOC_END,
  DOC_START,
  SUMMARY_END,
  SUMMARY_START,
  VARIANTS,
  buildVariantData,
  generateFeatureMatrix,
  generateSummary,
} from '../scripts/make-feature-matrix.mjs';

// What is on in every variant (a profile, with or without the factory): the full matrix is docs/features.md and a short
// summary is in the README. Both are generated from the catalog and the profile defaults, so these tests keep them from
// drifting: a new option, a changed default or a new control fails here until they are regenerated with
// `node scripts/make-feature-matrix.mjs --write`.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(KIT, 'catalog', 'options.json'), 'utf8'));
const data = buildVariantData();
const optionRow = (id) => data.options.find((row) => row.id === id);
const controlRow = (name) => data.controls.find((row) => row.name === name);
const readFile = (...parts) => readFileSync(join(KIT, ...parts), 'utf8').replaceAll('\r\n', '\n');

/** The text from `start` to `end`, markers included. */
function block(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  assert.ok(from !== -1 && to > from, `the markers are there: ${start.slice(0, 30)}`);
  return text.slice(from, to + end.length);
}

test('the six variants are the three profiles with and without the factory', () => {
  assert.deepEqual(VARIANTS.map((v) => v.key), ['solo', 'team', 'org', 'factorySolo', 'factoryTeam', 'factoryOrg']);
});

test('every installable option and every control of the kit is in the matrix, with no extras', () => {
  const optionIds = catalog.options.filter((o) => o.kind !== 'control').map((o) => o.id).sort();
  assert.deepEqual(data.options.map((row) => row.id).sort(), optionIds);
  assert.deepEqual(data.controls.map((row) => row.name).sort(), Object.keys(CONTROL_SPECS).sort());
});

test('options follow their catalog defaults per profile, and the factory turns on and locks what it needs', () => {
  assert.deepEqual(optionRow('skill.run-factory').cells, { solo: 'off', team: 'off', org: 'off', factorySolo: 'on', factoryTeam: 'on', factoryOrg: 'on' });
  assert.deepEqual(optionRow('factory-core').cells, { solo: 'off', team: 'off', org: 'off', factorySolo: 'locked', factoryTeam: 'locked', factoryOrg: 'locked' });
  assert.deepEqual(optionRow('review-gate').cells, { solo: 'on', team: 'on', org: 'on', factorySolo: 'locked', factoryTeam: 'locked', factoryOrg: 'locked' });
  assert.deepEqual(optionRow('check.test-edit-guard').cells, { solo: 'off', team: 'on', org: 'on', factorySolo: 'off', factoryTeam: 'on', factoryOrg: 'on' });
  assert.deepEqual(optionRow('rule.commit-gate').cells, { solo: 'on', team: 'on', org: 'on', factorySolo: 'on', factoryTeam: 'on', factoryOrg: 'on' });
  assert.equal(optionRow('skill.e2e-tests').cells.factoryTeam, 'off', 'e2e is opt-in even with the factory');
  assert.deepEqual(optionRow('check.reviewer-guard').needs, ['review-gate']);
});

test('controls show the profile value, and the factory controls only apply when the factory is on', () => {
  assert.deepEqual(controlRow('review.mode').cells, { solo: 'advisory', team: 'advisory', org: 'required', factorySolo: 'advisory', factoryTeam: 'advisory', factoryOrg: 'required' });
  assert.deepEqual(controlRow('tests.tdd').cells.solo, 'bugs');
  assert.deepEqual(controlRow('factory.pushConfirm').cells, { solo: '—', team: '—', org: '—', factorySolo: 'auto', factoryTeam: 'auto', factoryOrg: 'ask' });
  assert.deepEqual(controlRow('factory.untrustedText').cells, { solo: '—', team: '—', org: '—', factorySolo: 'note', factoryTeam: 'stop', factoryOrg: 'stop' });
  assert.deepEqual(controlRow('factory.mode').cells, { solo: 'off', team: 'off', org: 'off', factorySolo: 'local or pr', factoryTeam: 'local or pr', factoryOrg: 'local or pr' });
  assert.equal(controlRow('tests.e2e').cells.factoryOrg, 'off');
  assert.equal(controlRow('factory.ciFixAttempts').cells.factoryOrg, '2');
  assert.equal(controlRow('review.mode').env, 'REVIEW_MODE');
});

test('the full matrix explains the symbols and how to change an option or a control', () => {
  const text = generateFeatureMatrix();
  for (const symbol of ['✅', '⬜', '🔒']) assert.ok(text.includes(symbol), `legend and cells use ${symbol}`);
  assert.match(text, /choices\.json/);
  assert.match(text, /workflow\.json/);
  assert.match(text, /FACTORY_MODE/);
  assert.match(text, /Fixed safeguards/i);
  assert.match(text, /push-check/);
});

test('docs/features.md holds exactly the generated full matrix, between its markers', () => {
  const expected = `${DOC_START}\n${generateFeatureMatrix()}\n${DOC_END}`;
  assert.equal(block(readFile('docs', 'features.md'), DOC_START, DOC_END), expected, 'run: node scripts/make-feature-matrix.mjs --write');
});

test('the README holds exactly the generated summary and links to the full list', () => {
  const expected = `${SUMMARY_START}\n${generateSummary()}\n${SUMMARY_END}`;
  assert.equal(block(readFile('README.md'), SUMMARY_START, SUMMARY_END), expected, 'run: node scripts/make-feature-matrix.mjs --write');
  assert.match(generateSummary(), /\(docs\/features\.md\)/, 'the summary links to docs/features.md');
});

test('the summary is short, so the README stays a landing page, and names every variant and the settings that differ most', () => {
  const summary = generateSummary();
  assert.ok(summary.split('\n').length <= 20, 'at most 20 lines');
  for (const variant of VARIANTS) assert.ok(summary.includes(variant.label), variant.label);
  for (const name of ['planning.gates', 'tests.tdd', 'tests.guard', 'review.mode', 'factory.pushConfirm', 'factory.fastFix', 'factory.untrustedText']) {
    assert.ok(summary.includes(name), name);
  }
});
