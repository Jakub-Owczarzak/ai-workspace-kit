// Run: node --test check-docs-fresh.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMessage, docsLookStale, isTestFile, parseList, parseMode } from './check-docs-fresh.mjs';

describe('isTestFile', () => {
  it('recognises test and spec files', () => {
    assert.equal(isTestFile('src/a/b.test.ts'), true);
    assert.equal(isTestFile('src/a/b.spec.tsx'), true);
    assert.equal(isTestFile('src/a/b.test.mjs'), true);
  });
  it('does not treat normal files as tests', () => {
    assert.equal(isTestFile('src/a/latest.ts'), false);
    assert.equal(isTestFile('src/a/b.tsx'), false);
  });
});

describe('parseMode', () => {
  it('reads strict and off, case-insensitively', () => {
    assert.equal(parseMode('strict'), 'strict');
    assert.equal(parseMode(' OFF '), 'off');
  });
  it('defaults to warn for nothing or anything unknown', () => {
    assert.equal(parseMode(undefined), 'warn');
    assert.equal(parseMode(''), 'warn');
    assert.equal(parseMode('loud'), 'warn');
  });
});

describe('parseList', () => {
  it('splits, trims and drops empty parts', () => {
    assert.deepEqual(parseList(' src/ , app/ ,', ['x']), ['src/', 'app/']);
  });
  it('uses the fallback when empty', () => {
    assert.deepEqual(parseList('', ['src/']), ['src/']);
    assert.deepEqual(parseList(undefined, ['src/']), ['src/']);
  });
});

describe('docsLookStale', () => {
  it('is stale when source changed and AGENTS.md did not', () => {
    const result = docsLookStale(['src/app/index.tsx', 'package.json']);
    assert.equal(result.stale, true);
    assert.deepEqual(result.sourceChanged, ['src/app/index.tsx']);
  });
  it('is fresh when AGENTS.md is staged too', () => {
    assert.equal(docsLookStale(['src/app/index.tsx', 'AGENTS.md']).stale, false);
  });
  it('ignores commits with no source files', () => {
    assert.equal(docsLookStale(['README.md', 'package.json']).stale, false);
  });
  it('ignores test-only source changes', () => {
    assert.equal(docsLookStale(['src/a/b.test.ts']).stale, false);
  });
  it('counts deleted or renamed source like any other (paths are just staged names)', () => {
    assert.equal(docsLookStale(['src/old/Thing.tsx']).stale, true);
  });
  it('honours custom source folders and document names', () => {
    const options = { sourceDirs: ['app/'], docFiles: ['README.md'] };
    assert.equal(docsLookStale(['app/page.tsx'], options).stale, true);
    assert.equal(docsLookStale(['app/page.tsx', 'README.md'], options).stale, false);
    assert.equal(docsLookStale(['src/x.ts'], options).stale, false);
  });
});

describe('buildMessage', () => {
  it('names the files and says whether the commit is blocked', () => {
    const base = { sourceChanged: ['src/a.ts', 'src/b.ts'], docFiles: ['AGENTS.md'] };
    const warn = buildMessage({ ...base, mode: 'warn' });
    assert.match(warn, /src\/a\.ts, src\/b\.ts/);
    assert.match(warn, /Commit allowed/);
    assert.match(buildMessage({ ...base, mode: 'strict' }), /Commit blocked/);
  });
  it('shortens a long file list', () => {
    const many = Array.from({ length: 8 }, (_, index) => `src/f${index}.ts`);
    assert.match(buildMessage({ sourceChanged: many, docFiles: ['AGENTS.md'], mode: 'warn' }), /and 3 more/);
  });
});
