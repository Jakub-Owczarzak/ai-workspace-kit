import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The README links into docs/ and the docs link to each other. A moved section or a renamed heading must not leave a
// dead link behind: every relative link and every #anchor in the README and docs/*.md has to resolve.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['README.md', ...readdirSync(join(KIT, 'docs')).filter((n) => n.endsWith('.md')).map((n) => `docs/${n}`)];

const withoutCode = (text) => text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');

/** GitHub's heading anchors: lower case, formatting and punctuation dropped, spaces to hyphens, repeats numbered. */
function anchorsOf(text) {
  const seen = new Map();
  const anchors = new Set();
  for (const [, title] of withoutCodeFences(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = title
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  }
  return anchors;
}

const withoutCodeFences = (text) => text.replace(/^```[\s\S]*?^```/gm, '');

function problemsIn(file) {
  const path = join(KIT, file);
  const text = readFileSync(path, 'utf8');
  const problems = [];
  for (const [, target] of withoutCode(text).matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:
    const [file2, anchor] = target.split('#');
    const destination = file2 ? resolve(dirname(path), file2) : path;
    if (!existsSync(destination)) {
      problems.push(`${file}: ${target} (no such file: ${relative(KIT, destination).replaceAll('\\', '/')})`);
      continue;
    }
    if (anchor && destination.endsWith('.md') && !anchorsOf(readFileSync(destination, 'utf8')).has(decodeURIComponent(anchor))) {
      problems.push(`${file}: ${target} (no heading with that anchor)`);
    }
  }
  return problems;
}

for (const file of FILES) {
  test(`every relative link and anchor in ${file} resolves`, () => {
    assert.deepEqual(problemsIn(file), []);
  });
}

test('the anchor rule matches GitHub on the headings the README uses', () => {
  const anchors = anchorsOf('# Hello, World\n## 8. Install and use\n### The `x` flow: a (b)\n## Same\n## Same\n');
  assert.deepEqual([...anchors], ['hello-world', '8-install-and-use', 'the-x-flow-a-b', 'same', 'same-1']);
});
