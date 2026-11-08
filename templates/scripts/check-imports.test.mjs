// Run: node --test check-imports.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  checkImports,
  collectImports,
  findClaudeFiles,
  findImports,
  formatImportsReport,
  resolveImport,
} from './check-imports.mjs';

describe('findImports', () => {
  it('finds file imports with paths and extensions', () => {
    const text = 'See\n@AGENTS.md\nand @.claude/workspace-kit/rules/a.md, also (@docs/b.md).';
    assert.deepEqual(findImports(text), ['AGENTS.md', '.claude/workspace-kit/rules/a.md', 'docs/b.md']);
  });

  it('ignores emails, mentions, scoped packages and text without a file extension', () => {
    const text = 'mail me@example.com or ask @claude, install @types/node, see @someone';
    assert.deepEqual(findImports(text), []);
  });

  it('ignores imports inside code spans and fenced blocks', () => {
    const text = 'Use `@ignored.md` here\n```\n@also-ignored.md\n```\n@kept.md';
    assert.deepEqual(findImports(text), ['kept.md']);
  });

  it('accepts ./ ../ and ~/ paths without an extension, strips trailing punctuation, and drops duplicates', () => {
    assert.deepEqual(findImports('@./a @../b @~/c. @x.md @x.md'), ['./a', '../b', '~/c', 'x.md']);
  });
});

describe('resolveImport', () => {
  it('resolves relative to the importing file and expands ~/', () => {
    const base = join(tmpdir(), 'p', 'CLAUDE.md');
    assert.equal(resolveImport(base, 'docs/a.md', '/home/x'), join(tmpdir(), 'p', 'docs', 'a.md'));
    assert.equal(resolveImport(base, '../b.md', '/home/x'), join(tmpdir(), 'b.md'));
    assert.equal(resolveImport(base, '~/rules.md', '/home/x'), join('/home/x', 'rules.md'));
  });
});

describe('collectImports and checkImports on a real folder', () => {
  function withProject(files, callback) {
    const root = mkdtempSync(join(tmpdir(), 'imports-'));
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

  it('reports nothing to check without a CLAUDE.md', () => {
    withProject({ 'README.md': 'x' }, (root) => {
      const report = checkImports(root);
      assert.equal(report.entries.length, 0);
      assert.deepEqual(formatImportsReport(report), ['No CLAUDE.md found: nothing to check.']);
    });
  });

  it('follows imports, including nested ones, and finds no problems', () => {
    withProject(
      { 'CLAUDE.md': '@AGENTS.md\n@.claude/rules/a.md', 'AGENTS.md': 'See @docs/b.md', 'docs/b.md': 'b', '.claude/rules/a.md': 'a' },
      (root) => {
        const report = checkImports(root);
        assert.equal(report.errors, 0);
        assert.deepEqual(report.files.map((file) => file.depth), [0, 1, 2, 1]);
        assert.match(formatImportsReport(report).at(-1), /4 files reached from 1 CLAUDE\.md/);
      },
    );
  });

  it('reports an import whose file does not exist', () => {
    withProject({ 'CLAUDE.md': '@AGENTS.md\n@missing/rule.md' }, (root) => {
      const report = checkImports(root);
      assert.equal(report.errors, 2);
      assert.match(formatImportsReport(report).join('\n'), /ERROR import not found: @missing\/rule\.md/);
    });
  });

  it('survives an import cycle', () => {
    withProject({ 'CLAUDE.md': '@a.md', 'a.md': '@b.md', 'b.md': '@a.md' }, (root) => {
      const report = checkImports(root);
      assert.equal(report.errors, 0);
      assert.equal(report.files.length, 3);
    });
  });

  it('stops following at the depth limit and says so', () => {
    const exists = () => true;
    const read = (path) => {
      const level = Number(/level(\d+)/.exec(path)?.[1] ?? 0);
      return `@level${level + 1}.md`;
    };
    const result = collectImports(['/p/level0.md'], { exists, read, maxDepth: 3, home: '/h' });
    assert.equal(result.files.length, 4);
    assert.equal(result.tooDeep.length, 1);
  });

  it('finds CLAUDE.md at the root and in .claude/', () => {
    const present = new Set([join('/p', 'CLAUDE.md'), join('/p', '.claude', 'CLAUDE.md')]);
    assert.equal(findClaudeFiles('/p', (path) => present.has(path)).length, 2);
  });
});
