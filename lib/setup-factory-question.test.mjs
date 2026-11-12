import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from './apply.mjs';
import { init } from './init.mjs';

// The setup asks about the factory layer right after the profile ("Round 1b"), and a yes installs the whole layer.
// These tests keep the question, the catalog ids it names and what `apply` does with the answer in step.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const setupSkill = readFileSync(join(KIT, 'skills', 'setup-workspace', 'SKILL.md'), 'utf8');
const catalog = JSON.parse(readFileSync(join(KIT, 'catalog', 'options.json'), 'utf8'));
const ids = new Set(catalog.options.map((option) => option.id));
const controls = new Set(catalog.options.filter((option) => option.control).map((option) => option.control));

/** The text of Round 1b: from its heading to the start of Round 2. */
const round1b = setupSkill.match(/\*\*Round 1b[\s\S]*?(?=\n\d\. \*\*Round 2)/)?.[0];

test('the setup skill has a Round 1b about the factory, between the profile (Round 1) and the strictness (Round 2)', () => {
  assert.ok(round1b, 'a "Round 1b" section sits before "Round 2"');
  assert.match(round1b, /factory/i);
  assert.ok(setupSkill.indexOf('Round 1b') > setupSkill.indexOf('Round 1:') && setupSkill.indexOf('Round 1b') < setupSkill.indexOf('Round 2:'));
});

test('Round 1b offers no, local and pr; the default is no; a yes turns on skill.run-factory and sets factory.mode', () => {
  assert.match(round1b, /\bNo\b[^\n]*recommended/i);
  assert.match(round1b, /`local`/);
  assert.match(round1b, /`pr`/);
  assert.match(round1b, /skill\.run-factory/);
  assert.match(round1b, /factory\.mode/);
});

test('Round 1b says what the chosen tools get: subagents in Claude Code, one agent and SELF-REVIEW elsewhere', () => {
  assert.match(round1b, /subagent/i);
  assert.match(round1b, /SELF-REVIEW/);
});

test('every catalog id and control that Round 1b names exists in the catalog', () => {
  const named = [...round1b.matchAll(/`((?:skill|check|control|hook|rule|template|setting|workflow)\.[\w.-]+|factory-core|review-gate)`/g)].map((match) => match[1]);
  const controlNames = [...round1b.matchAll(/`(factory\.[A-Za-z]+)`/g)].map((match) => match[1]);
  assert.ok(named.length > 0 && controlNames.length > 0);
  for (const id of named) assert.ok(ids.has(id), `${id} is not in the catalog`);
  for (const control of controlNames) assert.ok(controls.has(control), `${control} is not a catalog control`);
});

test('the pieces that skill.run-factory needs are added automatically, so the question can name just that one id', () => {
  const byId = Object.fromEntries(catalog.options.map((option) => [option.id, option]));
  assert.deepEqual([...byId['skill.run-factory'].requires].sort(), ['factory-core', 'review-gate', 'skill.pr-description']);
  assert.ok(byId['factory-core'].requires.includes('check.static'));
});

test('the answer "yes, local" for OpenCode installs the factory skill, the guard script and the setting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-factory-q-'));
  try {
    init({ dir });
    apply({ dir, choices: { profile: 'solo', tools: ['opencode'], enabled: ['skill.run-factory'], overrides: { 'factory.mode': 'local' } } });
    assert.ok(existsSync(join(dir, '.agents', 'skills', 'wk-run-factory', 'SKILL.md')));
    assert.ok(existsSync(join(dir, 'scripts', 'factory-guard.mjs')), 'factory-core came with it');
    assert.ok(existsSync(join(dir, '.agents', 'skills', 'wk-pr-description', 'SKILL.md')), 'pr-description came with it');
    assert.equal(JSON.parse(readFileSync(join(dir, '.claude', 'workflow.json'), 'utf8')).overrides['factory.mode'], 'local');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the answer "no" installs no factory piece', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-factory-q-'));
  try {
    init({ dir });
    apply({ dir, choices: { profile: 'solo', tools: ['opencode'], enabled: ['skill.pr-description'] } });
    assert.ok(!existsSync(join(dir, '.agents', 'skills', 'wk-run-factory')));
    assert.ok(!existsSync(join(dir, 'scripts', 'factory-guard.mjs')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the README says the setup asks about the factory, and docs/factory.md says how to add it later', () => {
  const readme = readFileSync(join(KIT, 'README.md'), 'utf8');
  assert.match(readme, /setup[^.\n]*asks about it right after the profile/i);
  assert.match(readFileSync(join(KIT, 'docs', 'factory.md'), 'utf8'), /setup asks|asks about the factory|Round 1b|run the setup again/i);
});
