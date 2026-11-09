// Run: node --test check-config.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { formatSections, runConfigChecks } from './check-config.mjs';

const SKILL = `---
name: demo
description: Write a thing from the real data. Use when asked to write the thing.
---

# Demo
`;
const FIXTURES = JSON.stringify({ should: ['a', 'b', 'c'], shouldNot: ['x', 'y'] });

async function withProject(files, callback) {
  const root = mkdtempSync(join(tmpdir(), 'check-config-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    // Wait for the test body before deleting the folder.
    return await callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const GOOD = {
  'CLAUDE.md': '@AGENTS.md',
  'AGENTS.md': 'overview',
  '.claude/skills/demo/SKILL.md': SKILL,
  '.claude/skills/demo/triggers.json': FIXTURES,
};

describe('runConfigChecks', () => {
  it('passes a healthy project and prints all three sections', async () => {
    await withProject(GOOD, async (root) => {
      const { sections, exitCode } = await runConfigChecks({ root, env: {} });
      assert.equal(exitCode, 0);
      assert.deepEqual(sections.map((section) => section.title), ['Skills', '@ imports', 'Doc size']);
      assert.match(formatSections(sections), /== Skills ==[\s\S]*== @ imports ==[\s\S]*== Doc size ==/);
    });
  });

  it('fails when an @ import is missing', async () => {
    await withProject({ ...GOOD, 'CLAUDE.md': '@AGENTS.md\n@nope/missing.md' }, async (root) => {
      assert.equal((await runConfigChecks({ root, env: {} })).exitCode, 1);
    });
  });

  it('fails on a skill error and, with strict, on a skill warning', async () => {
    await withProject({ ...GOOD, '.claude/skills/demo/SKILL.md': SKILL.replace('name: demo', 'name: wrong') }, async (root) => {
      assert.equal((await runConfigChecks({ root, env: {} })).exitCode, 1);
    });
    const withoutFixtures = { ...GOOD };
    delete withoutFixtures['.claude/skills/demo/triggers.json'];
    await withProject(withoutFixtures, async (root) => {
      assert.equal((await runConfigChecks({ root, env: {} })).exitCode, 0);
      assert.equal((await runConfigChecks({ root, env: {}, strict: true })).exitCode, 1);
    });
  });

  it('skips everything when the profile turns static.checks off', async () => {
    await withProject(
      { ...GOOD, 'CLAUDE.md': '@nope/missing.md', '.claude/workflow.json': '{"overrides":{"static.checks":false}}' },
      async (root) => {
        const { sections, exitCode } = await runConfigChecks({ root, env: {} });
        assert.equal(exitCode, 0);
        assert.match(formatSections(sections), /skipped: the workflow control static\.checks is off/);
      },
    );
  });

  it('shows the doc-size warning from the profile threshold without failing', async () => {
    await withProject(
      { ...GOOD, 'AGENTS.md': 'x'.repeat(500), '.claude/workflow.json': '{"overrides":{"docs.sizeWarnChars":100}}' },
      async (root) => {
        const { sections, exitCode } = await runConfigChecks({ root, env: {} });
        assert.equal(exitCode, 0);
        assert.match(formatSections(sections), /warning: .*over the 100 limit/);
      },
    );
  });

  it('surfaces profile warnings without failing', async () => {
    await withProject({ ...GOOD, '.claude/workflow.json': '{ not json' }, async (root) => {
      const { sections, exitCode } = await runConfigChecks({ root, env: {} });
      assert.equal(exitCode, 0);
      assert.equal(sections[0].title, 'Workflow profile');
    });
  });
});
