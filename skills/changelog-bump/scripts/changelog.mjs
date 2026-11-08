#!/usr/bin/env node
// One CHANGELOG.md with an "## Unreleased" section. Entries are added on commit and
// released (version bump + heading) on merge. No dependencies; needs Node 18+ and git.
//
//   node changelog.mjs should-skip                                            (exit 0 = skip this commit)
//   node changelog.mjs add     [--bump patch|minor|major] [--message "..."]   (add an entry to Unreleased)
//   node changelog.mjs release [--dry-run]                                    (turn Unreleased into a version)
//
// Shared options:
//   --changelog <path>      changelog file             (default: CHANGELOG.md)
//   --version-file <f:key>  JSON file and dotted key   (repeatable; default: package.json:version)
//
// `add` env fallbacks for non-interactive commits: CHANGELOG_BUMP, CHANGELOG_ENTRY.
// `should-skip` honours CHANGELOG_SKIP=1 to skip a commit by hand.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const BUMPS = ['patch', 'minor', 'major'];
const UNRELEASED = '## Unreleased';
const BUMP_TAG = /\s*<!-- bump: (patch|minor|major) -->\s*$/;

function fail(message) {
  console.error(`changelog: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { versionFile: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = () => rest[++i];
    if (arg === '--changelog') opts.changelog = value();
    else if (arg === '--version-file') opts.versionFile.push(value());
    else if (arg === '--bump') opts.bump = value();
    else if (arg === '--message') opts.message = value();
    else if (arg === '--dry-run') opts.dryRun = true;
    else fail(`unknown option ${arg}`);
  }
  if (opts.versionFile.length === 0) opts.versionFile = ['package.json:version'];
  opts.changelog ??= 'CHANGELOG.md';
  return { command, opts };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// Arrow keys typed at the prompt arrive as escape sequences (ESC [ D, ESC [ C, ...).
// Drop them so they never reach CHANGELOG.md.
export function cleanMessage(text) {
  return text.replace(/\x1b\[?[0-9;]*[A-Za-z ]?/g, '').trim();
}

function currentBranch() {
  // symbolic-ref also works before the first commit; rev-parse does not.
  return gitOrNull(['symbolic-ref', '--short', 'HEAD']) ?? 'detached';
}

// Commits that do not change behaviour are skipped so the changelog stays clean.
// Returns a reason string to skip, or null to record the commit.
export function skipReason(stagedFiles, mergeInProgress, env = process.env) {
  if (env.CHANGELOG_SKIP === '1') return 'CHANGELOG_SKIP=1';
  if (mergeInProgress) return 'merge of another branch';
  if (stagedFiles.length === 0) return 'nothing added or changed (deletions only)';
  const onlyBookkeeping = stagedFiles.every(
    (f) => /(^|\/)CHANGELOG\.md$/.test(f) || /(^|\/)package-lock\.json$/.test(f),
  );
  if (onlyBookkeeping) return 'only CHANGELOG.md or lockfile files';
  return null;
}

function shouldSkip() {
  const staged = (gitOrNull(['diff', '--cached', '--name-only', '--diff-filter=ACMR']) ?? '')
    .split('\n')
    .filter(Boolean);
  const merging = gitOrNull(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null;
  const reason = skipReason(staged, merging);
  if (reason) {
    console.log(`changelog: skipped (${reason})`);
    process.exit(0);
  }
  process.exit(1);
}

// Line range of the Unreleased section: heading index, and index of the next "## " heading (or end).
function unreleasedRange(lines) {
  const start = lines.findIndex((l) => l.trim() === UNRELEASED);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function titleEnd(lines) {
  // Insert after the "# " title line and any blank lines after it; start of file if none.
  const title = lines.findIndex((l) => l.startsWith('# '));
  if (title < 0) return 0;
  let i = title + 1;
  while (i < lines.length && lines[i].trim() === '') i++;
  return i;
}

async function add(opts) {
  let bump = opts.bump ?? process.env.CHANGELOG_BUMP;
  let message = opts.message ?? process.env.CHANGELOG_ENTRY;

  if (!bump || !message) {
    if (!process.stdin.isTTY) {
      fail('CHANGELOG_BUMP and CHANGELOG_ENTRY must be set when there is no terminal to ask.');
    }
    while (!BUMPS.includes(bump)) {
      const answer = await ask('Bump type (patch/minor/major) [patch]: ');
      bump = answer === '' ? 'patch' : answer;
    }
    while (!message) message = await ask('Changelog entry (one line): ');
  }

  if (!BUMPS.includes(bump)) fail(`bump must be one of ${BUMPS.join(', ')}, got "${bump}"`);
  message = cleanMessage(message);
  if (!message) fail('the changelog entry is empty');
  if (/[\r\n]/.test(message)) fail('the changelog entry must be a single line');

  const branch = currentBranch();
  const date = new Date().toISOString().slice(0, 10);
  const entry = `- ${message} (${branch}, ${date}) <!-- bump: ${bump} -->`;

  const existing = existsSync(opts.changelog) ? readFileSync(opts.changelog, 'utf8') : '';
  const lines = existing === '' ? ['# Changelog', ''] : existing.split(/\r?\n/);
  const range = unreleasedRange(lines);

  if (range) {
    // The same line twice on one branch is a typo or a repeat, not a new change.
    const duplicate = lines
      .slice(range.start + 1, range.end)
      .some((l) => l.startsWith(`- ${message} (`));
    if (duplicate) fail(`an entry with this text is already in Unreleased: "${message}"`);
    // Add after the last bullet in the section, or right under the heading.
    let at = range.start + 1;
    for (let i = range.start + 1; i < range.end; i++) if (lines[i].startsWith('- ')) at = i + 1;
    lines.splice(at, 0, entry);
    // Keep a blank line between the entry and the next "## " heading.
    if (lines[at + 1] !== undefined && lines[at + 1].startsWith('## ')) lines.splice(at + 1, 0, '');
  } else {
    const at = titleEnd(lines);
    lines.splice(at, 0, UNRELEASED, '', entry, '');
  }

  writeFileSync(opts.changelog, lines.join('\n'));
  git(['add', opts.changelog]);
  console.log(`changelog: added ${bump} entry to ${opts.changelog}`);
}

function bumpVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) fail(`current version "${version}" is not x.y.z`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function splitSpec(spec) {
  const at = spec.lastIndexOf(':');
  if (at < 0) fail(`--version-file must look like file.json:key.path, got "${spec}"`);
  return [spec.slice(0, at), spec.slice(at + 1)];
}

function readVersionFile(spec) {
  const [file, key] = splitSpec(spec);
  const raw = readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  const value = key.split('.').reduce((obj, part) => obj?.[part], data);
  // Keep the file's own line endings (CRLF on Windows checkouts) so the diff stays small.
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { file, key, data, value, eol };
}

function setDotted(obj, key, value) {
  const parts = key.split('.');
  const last = parts.pop();
  const parent = parts.reduce((o, part) => o[part], obj);
  parent[last] = value;
}

function release(opts) {
  const existing = existsSync(opts.changelog) ? readFileSync(opts.changelog, 'utf8') : '';
  const lines = existing === '' ? ['# Changelog', ''] : existing.split(/\r?\n/);
  const range = unreleasedRange(lines);

  const bullets = range
    ? lines.slice(range.start + 1, range.end).filter((l) => l.startsWith('- '))
    : [];
  const bumps = bullets.map((l) => BUMP_TAG.exec(l)?.[1] ?? 'patch');
  // Every release bumps at least patch, even with no entries (e.g. dependency-only PRs).
  const kind = bumps.reduce((best, b) => (BUMPS.indexOf(b) > BUMPS.indexOf(best) ? b : best), 'patch');

  const versionFiles = opts.versionFile.map(readVersionFile);
  const current = versionFiles[0].value;
  if (typeof current !== 'string') fail(`no version found at ${opts.versionFile[0]}`);
  const next = bumpVersion(current, kind);
  const date = new Date().toISOString().slice(0, 10);

  const entries = bullets.length
    ? bullets.map((l) => l.replace(BUMP_TAG, ''))
    : ['- Maintenance release, no changelog entries.'];
  const section = [`## ${next} - ${date}`, '', ...entries, ''];

  let updated;
  if (range) {
    // Heading becomes the version; a fresh empty Unreleased section goes above it.
    updated = [...lines.slice(0, range.start), UNRELEASED, '', ...section, ...lines.slice(range.end)];
  } else {
    const at = titleEnd(lines);
    updated = [...lines.slice(0, at), UNRELEASED, '', ...section, ...lines.slice(at)];
  }

  console.log(`changelog: ${current} -> ${next} (${kind}), ${entries.length} entry(ies)`);
  if (opts.dryRun) {
    console.log(next);
    return;
  }

  for (const vf of versionFiles) {
    setDotted(vf.data, vf.key, next);
    writeFileSync(vf.file, (JSON.stringify(vf.data, null, 2) + '\n').replace(/\n/g, vf.eol));
  }
  writeFileSync(opts.changelog, updated.join('\n'));
  console.log(next);
}

const usage = `usage:
  changelog.mjs should-skip
  changelog.mjs add     [--bump patch|minor|major] [--message "..."]
  changelog.mjs release [--dry-run]
  shared: --changelog <path> --version-file <file.json:key.path>`;

const { command, opts } = parseArgs(process.argv.slice(2));
try {
  if (command === 'should-skip') shouldSkip();
  else if (command === 'add') await add(opts);
  else if (command === 'release') release(opts);
  else fail(`unknown command "${command ?? ''}"\n${usage}`);
} catch (error) {
  fail(error.message);
}
