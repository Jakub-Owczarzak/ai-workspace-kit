// Run: node --test overview-check.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkOverview,
  describingRegion,
  extractInlineCode,
  findMatchingEntries,
  formatOverviewReport,
  isIgnoredPath,
  listProjectEntries,
  looksLikePath,
  normalizePathText,
  readIgnoredNames,
} from './overview-check.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'overview-check.mjs');

function withProject(files, callback) {
  const root = mkdtempSync(join(tmpdir(), 'overview-check-'));
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

const kindsOf = (findings) => findings.map((finding) => finding.kind);

describe('looksLikePath', () => {
  it('accepts files and folders', () => {
    for (const code of ['src/app/', 'README.md', '.husky/pre-commit', '(tabs)/_layout.tsx', '@/components/Button', 'en.json']) {
      assert.equal(looksLikePath(code), true, code);
    }
  });

  it('rejects commands, placeholders, patterns, calls, urls and plain words', () => {
    for (const code of ['npm run lint', 'feat/<short-name>', 'tabs.*', 'useTheme()', 'DOCS_CHECK=strict', 'https://x.dev/a', 'typedRoutes', 'main', 'haptic.tap/selection/success/error']) {
      assert.equal(looksLikePath(code), false, code);
    }
  });
});

describe('path helpers', () => {
  it('normalizes the source alias, a leading dot-slash and a trailing slash', () => {
    assert.equal(normalizePathText('@/theme/'), 'src/theme');
    assert.equal(normalizePathText('./scripts/a.mjs'), 'scripts/a.mjs');
  });

  it('matches a path written as the end of a longer one', () => {
    const entries = ['src', 'src/components', 'src/components/icons', 'docs/icons'];
    assert.deepEqual(findMatchingEntries(entries, 'components/icons/'), ['src/components/icons']);
    assert.deepEqual(findMatchingEntries(entries, 'icons'), ['src/components/icons', 'docs/icons']);
    assert.deepEqual(findMatchingEntries(entries, 'cons'), []);
  });

  it('treats a path inside an ignored folder as ignored', () => {
    const ignored = readIgnoredNames('# comment\n/dist/\n.expo/types\n*.log\n!keep\n');
    assert.equal(isIgnoredPath('dist/app.js', ignored), true);
    assert.equal(isIgnoredPath('.expo/types/router.d.ts', ignored), true);
    assert.equal(isIgnoredPath('src/app.js', ignored), false);
  });
});

describe('extractInlineCode', () => {
  it('returns each span with its line number', () => {
    assert.deepEqual(extractInlineCode(['no code', 'see `a/b.ts` and `c`']), [
      { line: 2, code: 'a/b.ts' },
      { line: 2, code: 'c' },
    ]);
  });
});

describe('describingRegion', () => {
  it('takes the item line and the lines indented under it, and stops at the next sibling or a blank line', () => {
    const lines = ['- `a/`: one', '  more of a', '  - nested', '- `b/`: two', '', 'after'];
    assert.equal(describingRegion(lines, 1), '- `a/`: one\n  more of a\n  - nested');
  });
});

describe('checkOverview', () => {
  const baseEntries = ['src', 'src/app', 'src/app/index.tsx', 'README.md', 'package.json'];

  it('reports a path that is not in the project, and accepts one that is', () => {
    const findings = checkOverview({ text: '`src/app/index.tsx` and `src/gone/file.ts`', entries: baseEntries });
    assert.deepEqual(kindsOf(findings), ['missing-path']);
    assert.match(findings[0].message, /src\/gone\/file\.ts/);
  });

  it('does not report a missing path that git ignores, or a dependency import path', () => {
    const findings = checkOverview({
      text: '`.expo/types/router.d.ts` and `expo-router/js-tabs`',
      entries: baseEntries,
      packageJson: { dependencies: { 'expo-router': '~58.0.0' } },
      gitignoreText: '.expo/\n',
    });
    assert.deepEqual(findings, []);
  });

  it('reports an npm script that package.json does not define', () => {
    const findings = checkOverview({
      text: '```\nnpm run lint\nnpm run gone\nnpm test\n```',
      entries: baseEntries,
      packageJson: { scripts: { lint: 'eslint .' } },
    });
    assert.deepEqual(findings.map((finding) => [finding.line, finding.kind]), [[3, 'missing-script'], [4, 'missing-script']]);
    assert.match(findings[1].message, /"test"/);
  });

  it('compares written versions with package.json, accepting a shorter written version', () => {
    const packageJson = { dependencies: { expo: '~58.0.23', react: '19.3.0', 'react-native': '0.88.1', 'expo-router': '~58.0.30' } };
    const matching = checkOverview({ text: 'Expo SDK 58 · React Native 0.88 · React 19.3 · expo-router ~58', entries: [], packageJson });
    assert.deepEqual(matching, []);

    const stale = checkOverview({ text: 'Expo SDK 57 · React 19.2', entries: [], packageJson });
    assert.deepEqual(kindsOf(stale), ['version', 'version']);
    assert.match(stale[0].message, /Expo SDK 57 written, package.json has ~58\.0\.23/);
  });

  it('does not read "React Native 0.88" as a version of React', () => {
    const packageJson = { dependencies: { react: '19.3.0', 'react-native': '0.88.1' } };
    assert.deepEqual(checkOverview({ text: 'React Native 0.88', entries: [], packageJson }), []);
  });

  it('reports a child the overview forgot when it lists the other children, using the category suffix', () => {
    const entries = [
      'src', 'src/components', 'src/components/icons',
      'src/components/icons/CheckIcon', 'src/components/icons/MoonIcon', 'src/components/icons/HomeIcon',
    ];
    const text = ['- `icons/`: Check, Moon.', '- The Home tab is a demo.'].join('\n');
    const findings = checkOverview({ text, entries });
    assert.deepEqual(kindsOf(findings), ['undocumented']);
    assert.match(findings[0].message, /HomeIcon/);
  });

  it('does not report a child that is named by its own path elsewhere', () => {
    const entries = ['svc', 'svc/alpha', 'svc/beta', 'svc/gamma'];
    const text = ['- `svc/`: alpha, beta.', '- `svc/gamma/`: the third one.'].join('\n');
    assert.deepEqual(checkOverview({ text, entries }), []);
  });

  it('does not judge a folder whose content the overview does not list', () => {
    const entries = ['svc', 'svc/alpha', 'svc/beta', 'svc/gamma'];
    assert.deepEqual(checkOverview({ text: '- `svc/`: services live here.', entries }), []);
  });

  it('ignores tests, barrel files, hidden files and README or LICENSE files when looking for forgotten children', () => {
    const entries = ['svc', 'svc/alpha.ts', 'svc/beta.ts', 'svc/index.ts', 'svc/alpha.test.ts', 'svc/.keep', 'svc/README.md', 'svc/LICENSE'];
    assert.deepEqual(checkOverview({ text: '- `svc/`: alpha, beta.', entries }), []);
  });

  it('reports planning labels', () => {
    const findings = checkOverview({ text: 'Built so far (bucket 5a) and (Bucket 3).', entries: [] });
    assert.deepEqual(kindsOf(findings), ['label', 'label']);
  });

  it('returns findings in line order', () => {
    const findings = checkOverview({ text: '(bucket 1)\n`gone/a.ts`', entries: [] });
    assert.deepEqual(findings.map((finding) => finding.line), [1, 2]);
  });
});

describe('formatOverviewReport', () => {
  it('says so when everything checkable matches', () => {
    assert.match(formatOverviewReport([], 'AGENTS.md')[0], /every checkable statement matches/);
  });

  it('prints one line per finding and a count', () => {
    const lines = formatOverviewReport([{ line: 4, kind: 'label', message: 'x' }], 'AGENTS.md');
    assert.equal(lines[0], 'AGENTS.md:4  [label]  x');
    assert.match(lines[1], /^1 finding\(s\)/);
  });
});

describe('command line', () => {
  const files = {
    'AGENTS.md': '# Demo\n- `src/gone.ts` and `src/real.ts`\nRun `npm run lint`.\n',
    'src/real.ts': '',
    'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }),
  };

  it('lists a stale path from a real project folder and still exits 0', () => {
    withProject(files, (root) => {
      const run = spawnSync(process.execPath, [scriptPath, '--root', root], { encoding: 'utf8' });
      assert.equal(run.status, 0);
      assert.match(run.stdout, /AGENTS\.md:2  \[missing-path\]  `src\/gone\.ts`/);
      assert.doesNotMatch(run.stdout, /real\.ts/);
    });
  });

  it('exits 1 with --strict when something is found', () => {
    withProject(files, (root) => {
      assert.equal(spawnSync(process.execPath, [scriptPath, '--root', root, '--strict']).status, 1);
    });
  });

  it('says there is nothing to check when the overview file is missing', () => {
    withProject({ 'package.json': '{}' }, (root) => {
      const run = spawnSync(process.execPath, [scriptPath, '--root', root], { encoding: 'utf8' });
      assert.equal(run.status, 0);
      assert.match(run.stdout, /nothing to check/);
    });
  });

  it('lists project entries without dependency or generated folders', () => {
    withProject({ 'a/b.txt': '', 'node_modules/x/y.js': '', '.expo/z.json': '' }, (root) => {
      assert.deepEqual(listProjectEntries(root).sort(), ['a', 'a/b.txt']);
    });
  });
});
