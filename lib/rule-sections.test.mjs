import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSections } from './rule-sections.mjs';

const has = (...ids) => (id) => ids.includes(id);

test('text without markers is returned unchanged', () => {
  const text = '# Rule\n\n- one\n- two\n';
  assert.equal(selectSections(text, has()), text);
});

test('a section is kept, and its marker lines removed, when its option is installed', () => {
  const text = 'before\n<!-- wk:if skill.figma-sync -->\nfigma line\n<!-- wk:endif -->\nafter\n';
  assert.equal(selectSections(text, has('skill.figma-sync')), 'before\nfigma line\nafter\n');
});

test('a section is dropped when its option is not installed', () => {
  const text = 'before\n<!-- wk:if skill.figma-sync -->\nfigma line\n<!-- wk:endif -->\nafter\n';
  assert.equal(selectSections(text, has()), 'before\nafter\n');
});

test('"!id" keeps a section only when the option is NOT installed', () => {
  const text = '<!-- wk:if !review-gate -->\nreview when asked\n<!-- wk:endif -->\n';
  assert.equal(selectSections(text, has()), 'review when asked\n');
  assert.equal(selectSections(text, has('review-gate')), '');
});

test('"a|b" keeps a section when any of the options is installed', () => {
  const text = '<!-- wk:if skill.e2e-tests|check.e2e-shots -->\ne2e\n<!-- wk:endif -->\n';
  assert.equal(selectSections(text, has('check.e2e-shots')), 'e2e\n');
  assert.equal(selectSections(text, has('skill.run-factory')), '');
});

test('blank lines left behind by a dropped section are collapsed to one', () => {
  const text = 'one\n\n<!-- wk:if x -->\ntwo\n<!-- wk:endif -->\n\nthree\n';
  assert.equal(selectSections(text, has()), 'one\n\nthree\n');
});

test('Windows line endings are handled the same way', () => {
  const text = 'a\r\n<!-- wk:if x -->\r\nb\r\n<!-- wk:endif -->\r\nc\r\n';
  assert.equal(selectSections(text, has()), 'a\nc\n');
});

test('an unclosed, nested or stray marker is an error, never silently half-applied', () => {
  assert.throws(() => selectSections('<!-- wk:if x -->\nb\n', has()), /not closed/);
  assert.throws(() => selectSections('<!-- wk:if x -->\n<!-- wk:if y -->\n<!-- wk:endif -->\n<!-- wk:endif -->\n', has()), /nested/);
  assert.throws(() => selectSections('a\n<!-- wk:endif -->\n', has()), /without/);
});
