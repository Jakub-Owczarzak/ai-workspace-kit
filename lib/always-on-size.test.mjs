import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from './apply.mjs';
import { init } from './init.mjs';
import { selectSections } from './rule-sections.mjs';

// The rules block in AGENTS.md / CLAUDE.md is read at the start of every session and sits in context on every turn, and
// every fresh subagent loads it again. It is kept small: long procedures live in files read on demand, and passages about
// options that are not installed are not written at all. These tests keep the size down and the safety rules in.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(KIT, 'catalog', 'options.json'), 'utf8'));
const ids = new Set(catalog.options.map((option) => option.id));
const DEFAULTS = catalog.options.filter((o) => o.default === true && !o.appliesWhen && o.kind !== 'control').map((o) => o.id);
const PROJECT = { commands: { lint: 'npm run lint', test: 'npm test' }, protectedBranch: 'main', versionFiles: ['package.json:version'] };

function rulesBlock({ tools, enabled }) {
  const dir = mkdtempSync(join(tmpdir(), 'wk-size-'));
  try {
    init({ dir });
    apply({ dir, choices: { profile: 'team', tools, enabled, project: PROJECT } });
    const file = tools.length === 1 && tools[0] === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
    return readFileSync(join(dir, file), 'utf8').match(/<!-- workspace-kit:start rules -->[\s\S]*?<!-- workspace-kit:end rules -->/)[0];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const tokens = (text) => Math.round(text.length / 4); // the kit's own rough estimate (characters / 4)

// Sizes before this change, for the same selections: Claude Code about 2970 tokens, OpenCode about 3440. After it:
// about 2030 and 2450. The budget sits a little above, so a rule can grow a bit but not double.
const BUDGET = { 'claude-code': 2100, opencode: 2550 };

test('the rules block of a default install stays within its size budget (Claude Code)', () => {
  const size = tokens(rulesBlock({ tools: ['claude-code'], enabled: DEFAULTS }));
  assert.ok(size <= BUDGET['claude-code'], `${size} tokens, budget ${BUDGET['claude-code']}`);
});

test('the rules block of a default install stays within its size budget (OpenCode, with the translation rule)', () => {
  const size = tokens(rulesBlock({ tools: ['opencode'], enabled: DEFAULTS }));
  assert.ok(size <= BUDGET.opencode, `${size} tokens, budget ${BUDGET.opencode}`);
});

const SAFETY_LINES = [
  'Never commit with any of them failing',
  'Only a human pushes',
  'Never push to the protected branch',
  'Never merge a pull request or deploy',
  'Never bypass hooks',
  'A failing hook is a signal',
  'Do not edit the version by hand',
  'Never skip, delete, weaken or loosen a failing test',
  'show it',
  'Report with proof',
];

test('every safety rule is still in the always-on block, whatever else was trimmed', () => {
  const block = rulesBlock({ tools: ['claude-code'], enabled: DEFAULTS }).replace(/\s+/g, ' '); // a phrase may wrap
  for (const line of SAFETY_LINES) assert.ok(block.includes(line), `missing from the block: "${line}"`);
});

test('the block points at the details files, and those files exist with the full procedure', () => {
  const block = rulesBlock({ tools: ['claude-code'], enabled: DEFAULTS });
  for (const name of ['commit-gate-details.md', 'test-discipline-details.md']) {
    assert.ok(block.includes(`.claude/workspace-kit/rules/${name}`), `the block points at ${name}`);
    assert.ok(existsSync(join(KIT, 'rules', name)), `${name} exists in the kit`);
  }
  const commitDetails = readFileSync(join(KIT, 'rules', 'commit-gate-details.md'), 'utf8');
  assert.match(commitDetails, /check-review-gate\.mjs record --blocking/);
  assert.match(commitDetails, /--self-review/);
  assert.match(commitDetails, /factory-guard\.mjs push-check/);
  assert.match(readFileSync(join(KIT, 'rules', 'test-discipline-details.md'), 'utf8'), /test-edit-guard\.mjs start/);
});

test('a project with only the commit gate does not get text about options it has not installed', () => {
  const block = rulesBlock({ tools: ['claude-code'], enabled: ['rule.commit-gate'] });
  for (const word of ['check-review-gate', 'figma', 'factory', 'changelog', 'e2e', 'reviewer']) {
    assert.ok(!block.toLowerCase().includes(word), `"${word}" should not appear when that option is not installed`);
  }
  assert.ok(block.includes('Only a human pushes'));
});

test('with the factory installed, the always-on block names the factory exception to "only a human pushes"', () => {
  const block = rulesBlock({ tools: ['claude-code'], enabled: [...DEFAULTS, 'skill.run-factory'] });
  assert.match(block, /except a factory run the user started/);
});

test('no marker line reaches a project: the block contains no wk:if or wk:endif', () => {
  const block = rulesBlock({ tools: ['opencode'], enabled: [...DEFAULTS, 'skill.run-factory', 'skill.e2e-tests'] });
  assert.ok(!/wk:(if|endif)/.test(block));
});

test('the overview template does not repeat the changelog rule, and the overview skill says to describe the project, not the kit', () => {
  assert.ok(!/Changelog \(every commit\)/.test(readFileSync(join(KIT, 'templates', 'AGENTS.md'), 'utf8')));
  const skill = readFileSync(join(KIT, 'skills', 'write-project-overview', 'SKILL.md'), 'utf8');
  assert.match(skill, /The project, not the kit/);
  assert.match(skill, /Do not list the kit's own files/);
});

test('every option id used in a rule marker exists in the catalog (a typo would silently drop a section)', () => {
  const rulesDir = join(KIT, 'rules');
  const used = new Set();
  for (const name of readdirSync(rulesDir).filter((file) => file.endsWith('.md'))) {
    const text = readFileSync(join(rulesDir, name), 'utf8');
    for (const [, condition] of text.matchAll(/<!-- wk:if (\S+) -->/g)) {
      for (const term of condition.split('|')) used.add(term.replace(/^!/, ''));
    }
    assert.doesNotThrow(() => selectSections(text, () => true), `${name} has well-formed markers`);
  }
  assert.ok(used.size > 0);
  for (const id of used) assert.ok(ids.has(id), `${id} is not a catalog option id`);
});
