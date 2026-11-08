// Run: node --test doc-size.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { approxTokens, formatSizeReport, isPathScopedRule, measureProject } from './doc-size.mjs';

function withProject(files, callback) {
  const root = mkdtempSync(join(tmpdir(), 'doc-size-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('approxTokens', () => {
  it('estimates characters / 4, rounded up', () => {
    assert.equal(approxTokens(0), 0);
    assert.equal(approxTokens(4), 1);
    assert.equal(approxTokens(5), 2);
  });
});

describe('isPathScopedRule', () => {
  it('is true only for a rule with paths in its frontmatter', () => {
    assert.equal(isPathScopedRule('---\npaths:\n  - "src/**"\n---\n# Rule'), true);
    assert.equal(isPathScopedRule('---\ndescription: x\n---\n# Rule'), false);
    assert.equal(isPathScopedRule('# Rule with no frontmatter'), false);
  });
});

describe('measureProject', () => {
  it('counts CLAUDE.md, its imports and unscoped rules as always loaded, and scoped rules on demand', () => {
    withProject(
      {
        'CLAUDE.md': '@AGENTS.md\n@.claude/rules/a.md\nhello',
        'AGENTS.md': 'overview text',
        '.claude/rules/a.md': 'rule a',
        '.claude/rules/b.md': 'rule b not imported but always on',
        '.claude/rules/scoped.md': '---\npaths:\n  - "src/**"\n---\nscoped',
      },
      (root) => {
        const measure = measureProject(root);
        const paths = measure.alwaysLoaded.map((file) => file.path);
        assert.deepEqual(paths, ['CLAUDE.md', 'AGENTS.md', '.claude/rules/a.md', '.claude/rules/b.md']);
        assert.deepEqual(measure.onDemand.map((file) => file.path), ['.claude/rules/scoped.md']);
        assert.equal(measure.totalChars, measure.alwaysLoaded.reduce((sum, file) => sum + file.chars, 0));
      },
    );
  });

  it('does not count a rule twice when CLAUDE.md already imports it', () => {
    withProject({ 'CLAUDE.md': '@.claude/rules/a.md', '.claude/rules/a.md': 'rule a' }, (root) => {
      assert.equal(measureProject(root).alwaysLoaded.length, 2);
    });
  });

  it('counts the skill names and descriptions', () => {
    withProject(
      {
        'CLAUDE.md': 'x',
        '.claude/skills/one/SKILL.md': '---\nname: one\ndescription: Use when asked.\n---\nbody',
        '.claude/skills/two/SKILL.md': '---\nname: two\ndescription: Another one.\n---\nbody',
      },
      (root) => {
        const { skills } = measureProject(root);
        assert.equal(skills.count, 2);
        assert.equal(skills.chars, 'one'.length + 'Use when asked.'.length + 'two'.length + 'Another one.'.length);
      },
    );
  });

  it('handles a project with no instruction files', () => {
    withProject({ 'README.md': 'x' }, (root) => {
      const measure = measureProject(root);
      assert.equal(measure.totalChars, 0);
      assert.match(formatSizeReport(measure, 40000).lines.join('\n'), /no instruction files found/);
    });
  });
});

describe('formatSizeReport', () => {
  const measure = {
    alwaysLoaded: [{ path: 'AGENTS.md', kind: 'import', chars: 50000, lines: 200 }],
    onDemand: [],
    skills: { count: 3, chars: 800 },
    totalChars: 50000,
  };

  it('warns above the threshold but only reports', () => {
    const { lines, over } = formatSizeReport(measure, 40000);
    assert.equal(over, true);
    assert.match(lines.join('\n'), /warning: .*50000 characters, over the 40000 limit/);
    assert.match(lines.join('\n'), /nothing is trimmed/);
  });

  it('does not warn at or below the threshold, or when the threshold is 0', () => {
    assert.equal(formatSizeReport(measure, 50000).over, false);
    assert.equal(formatSizeReport(measure, 0).over, false);
  });

  it('shows the total with a token estimate and the skill list', () => {
    const text = formatSizeReport(measure, 0).lines.join('\n');
    assert.match(text, /total: 50000 characters, about 12500 tokens/);
    assert.match(text, /3 skills, 800 characters/);
  });
});
