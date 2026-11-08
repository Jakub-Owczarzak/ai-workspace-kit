// Run: node --test check-skills.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  checkSkills,
  descriptionSimilarity,
  exitCodeFor,
  findOverlaps,
  findRelativeLinks,
  formatReport,
  hasTriggerCue,
  lintSkill,
  parseFrontmatter,
  stripCode,
  validateFixtures,
} from './check-skills.mjs';

const GOOD_DESCRIPTION =
  'Write a pull request description from the real diff. Use when asked to draft a PR body or PR summary.';

function skillText(fields = {}, body = '# Skill\n\nDoes a thing.\n') {
  const data = { name: 'demo', description: GOOD_DESCRIPTION, ...fields };
  const lines = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

const GOOD_FIXTURES = JSON.stringify({ should: ['a', 'b', 'c'], shouldNot: ['x', 'y'] });

function lint(overrides = {}, options = {}) {
  return lintSkill(
    { folder: 'demo', dir: tmpdir(), text: skillText(), fixturesText: GOOD_FIXTURES, ...overrides },
    options,
  );
}

const codes = (result) => result.issues.map((issue) => issue.code);

describe('parseFrontmatter', () => {
  it('reads simple fields and quoted values', () => {
    const { data, body } = parseFrontmatter('---\nname: demo\ndescription: "Use when asked."\n---\n\n# Body\n');
    assert.deepEqual(data, { name: 'demo', description: 'Use when asked.' });
    assert.match(body, /^# Body/);
  });

  it('reads folded blocks and Windows line endings', () => {
    const { data } = parseFrontmatter('---\r\nname: demo\r\ndescription: >\r\n  Use when\r\n  asked.\r\n---\r\nBody');
    assert.equal(data.description, 'Use when asked.');
  });

  it('returns no data without a frontmatter block', () => {
    assert.equal(parseFrontmatter('# Just a heading').data, null);
    assert.equal(parseFrontmatter('---\nname: x\n').data, null);
  });
});

describe('text helpers', () => {
  it('stripCode removes fenced and inline code', () => {
    assert.equal(stripCode('a `b` c\n```\n[x](y)\n```\nd').includes('[x](y)'), false);
    assert.equal(stripCode('a `[x](y)` c').includes('[x](y)'), false);
  });

  it('findRelativeLinks keeps local links only, without fragments, ignoring code', () => {
    const links = findRelativeLinks(
      '[a](references/a.md#top) [b](https://x.com) [c](#anchor) [d](mailto:a@b.c) `[e](e.md)`\n```\n[f](f.md)\n```',
    );
    assert.deepEqual(links, ['references/a.md']);
  });

  it('hasTriggerCue recognises usual trigger wording and rejects none', () => {
    assert.equal(hasTriggerCue('Do a thing. Use when the user asks for it.'), true);
    assert.equal(hasTriggerCue('Use before planning or changing code in this project.'), true);
    assert.equal(hasTriggerCue('Use once per project.'), true);
    assert.equal(hasTriggerCue('A tool that does a thing very well.'), false);
  });
});

describe('overlap detection', () => {
  it('scores identical descriptions as 1 and unrelated ones near 0', () => {
    assert.equal(descriptionSimilarity('write release notes quickly', 'write release notes quickly'), 1);
    assert.ok(descriptionSimilarity('write release notes quickly', 'deploy kubernetes cluster') < 0.1);
  });

  it('finds near-identical pairs only', () => {
    const skills = [
      { name: 'a', description: 'Write a pull request description from the real diff for reviewers' },
      { name: 'b', description: 'Write a pull request description from the real diff for reviewers today' },
      { name: 'c', description: 'Bump the version and update the changelog on release' },
    ];
    const overlaps = findOverlaps(skills);
    assert.equal(overlaps.length, 1);
    assert.deepEqual([overlaps[0].first, overlaps[0].second], ['a', 'b']);
  });
});

describe('validateFixtures', () => {
  it('accepts a good file and counts phrases', () => {
    assert.deepEqual(validateFixtures(GOOD_FIXTURES), { problems: [], shouldCount: 3, shouldNotCount: 2 });
  });

  it('reports broken JSON, wrong shapes and empty phrases', () => {
    assert.equal(validateFixtures('{oops').problems.length, 1);
    assert.equal(validateFixtures('[1]').problems.length, 1);
    assert.equal(validateFixtures('{"should":"x"}').problems.length, 1);
    assert.equal(validateFixtures('{"should":["a",""]}').problems.length, 1);
    assert.equal(validateFixtures('{"should":["a"],"shouldNot":"x"}').problems.length, 1);
  });
});

describe('lintSkill', () => {
  it('passes a well formed skill with no issues', () => {
    assert.deepEqual(lint().issues, []);
  });

  it('errors when there is no SKILL.md', () => {
    assert.deepEqual(codes(lint({ text: null })), ['missing-skill-file']);
  });

  it('errors on missing frontmatter, name or description', () => {
    assert.deepEqual(codes(lint({ text: '# no frontmatter' })), ['no-frontmatter']);
    assert.ok(codes(lint({ text: skillText({ name: undefined }) })).includes('missing-name'));
    assert.ok(codes(lint({ text: skillText({ description: undefined }) })).includes('missing-description'));
  });

  it('errors when the name differs from the folder', () => {
    assert.ok(codes(lint({ text: skillText({ name: 'other' }) })).includes('name-mismatch'));
  });

  it('errors on a description over 1024 characters', () => {
    const long = `Use when asked. ${'word '.repeat(220)}`;
    assert.ok(codes(lint({ text: skillText({ description: long }) })).includes('description-too-long'));
  });

  it('warns on a short description and on a missing trigger cue', () => {
    const result = lint({ text: skillText({ description: 'Does it.' }) });
    assert.ok(codes(result).includes('description-short'));
    assert.ok(codes(result).includes('no-trigger-cue'));
    assert.equal(result.issues.every((issue) => issue.level === 'warn'), true);
  });

  it('does not ask a hand-started skill for a trigger cue', () => {
    const text = skillText({ description: 'Bootstrap a project with the agent skills for it.', 'disable-model-invocation': 'true' });
    assert.deepEqual(codes(lint({ text, fixturesText: null })), []);
    assert.ok(codes(lint({ text: text.replace('disable-model-invocation: true\n', ''), fixturesText: null })).includes('no-trigger-cue'));
  });

  it('errors on a link to a file that does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-lint-'));
    try {
      writeFileSync(join(root, 'real.md'), 'x');
      const body = '[ok](real.md) and [bad](missing.md)';
      const result = lint({ dir: root, text: skillText({}, body) });
      assert.deepEqual(codes(result), ['broken-link']);
      assert.match(result.issues[0].message, /missing\.md/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags leftover placeholders only when asked', () => {
    const text = skillText({}, 'Fill <PROJECT NAME> and <...> here, but `<IN CODE>` is fine.');
    assert.deepEqual(codes(lint({ text })), []);
    assert.deepEqual(codes(lint({ text }, { noPlaceholders: true })), ['placeholder']);
  });

  it('warns when fixtures are missing, except for skills started by hand', () => {
    assert.deepEqual(codes(lint({ fixturesText: null })), ['no-fixtures']);
    assert.deepEqual(codes(lint({ fixturesText: null, text: skillText({ 'disable-model-invocation': 'true' }) })), []);
  });

  it('errors on invalid fixtures and warns on too few phrases', () => {
    assert.deepEqual(codes(lint({ fixturesText: '{oops' })), ['bad-fixtures']);
    assert.deepEqual(codes(lint({ fixturesText: JSON.stringify({ should: ['a'], shouldNot: [] }) })), ['few-fixtures']);
  });
});

describe('checkSkills on folders', () => {
  function withSkillsDir(callback) {
    const root = mkdtempSync(join(tmpdir(), 'skills-dir-'));
    try {
      return callback(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function writeSkill(root, folder, text, fixtures = GOOD_FIXTURES) {
    mkdirSync(join(root, folder), { recursive: true });
    if (text !== null) writeFileSync(join(root, folder, 'SKILL.md'), text);
    if (fixtures !== null) writeFileSync(join(root, folder, 'triggers.json'), fixtures);
  }

  it('is clean for good skills and exits 0', () => {
    withSkillsDir((root) => {
      writeSkill(root, 'demo', skillText({ name: 'demo' }));
      writeSkill(root, 'other', skillText({ name: 'other', description: 'Bump the version number and the changelog entry on release. Use when a release is cut.' }));
      const report = checkSkills([root]);
      assert.equal(report.errors, 0);
      assert.equal(report.warnings, 0);
      assert.equal(exitCodeFor(report), 0);
      assert.match(formatReport(report).at(-1), /2 skills checked: 0 errors, 0 warnings/);
    });
  });

  it('counts errors, exits 1, and lets --strict fail on warnings too', () => {
    withSkillsDir((root) => {
      writeSkill(root, 'broken', null, null);
      writeSkill(root, 'weak', skillText({ name: 'weak', description: 'Does it.' }));
      const report = checkSkills([root]);
      assert.equal(report.errors, 1);
      assert.equal(exitCodeFor(report), 1);
    });
    withSkillsDir((root) => {
      writeSkill(root, 'weak', skillText({ name: 'weak', description: 'Does it.' }));
      const report = checkSkills([root]);
      assert.equal(report.errors, 0);
      assert.equal(exitCodeFor(report), 0);
      assert.equal(exitCodeFor(report, true), 1);
    });
  });

  it('warns, without failing, about a skills folder that does not exist', () => {
    const report = checkSkills([join(tmpdir(), 'no-such-skills-folder-xyz')]);
    assert.equal(report.errors, 0);
    assert.equal(report.warnings, 1);
    assert.match(formatReport(report)[0], /skills folder not found/);
  });

  it('reports overlapping descriptions', () => {
    withSkillsDir((root) => {
      const twin = 'Write a pull request description from the real diff for reviewers. Use when asked for a PR body.';
      writeSkill(root, 'one', skillText({ name: 'one', description: twin }));
      writeSkill(root, 'two', skillText({ name: 'two', description: twin }));
      const report = checkSkills([root]);
      assert.equal(report.overlaps.length, 1);
      assert.match(formatReport(report).join('\n'), /overlap/);
    });
  });
});
