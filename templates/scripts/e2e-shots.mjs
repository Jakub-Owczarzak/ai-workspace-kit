#!/usr/bin/env node
// Screenshot helper for pull requests. An end-to-end run leaves PNG files in a folder; this script puts them on a
// branch of their own and builds the Markdown that shows them in a PR description, so the images never reach `main`
// or the feature branch.
//
//   node scripts/e2e-shots.mjs publish --dir <folder> --subdir <name> [--branch factory-screenshots] [--remote origin]
//        [--url-remote <url>] [--host github|gitlab] [--json] [--root <dir>]
//       Publishes the PNGs in <folder> and prints the Markdown for them (or JSON: { branch, sha, files }).
//   node scripts/e2e-shots.mjs markdown --remote <url> --ref <commit> --files <a.png,b.png> [--host github|gitlab]
//       Prints the Markdown for images that are already published.
//
// How publishing works: a temporary git worktree is made, the images are committed there on an orphan branch (or on
// top of the remote one), and that one branch is pushed. Your working tree, your branches and `main` are not touched,
// and the worktree is removed afterwards. Links are pinned to the commit, so they survive the branch being deleted.
//
// Notes: the push runs the repository's hooks (never --no-verify), but with REVIEW_MODE=off, because the branch holds
// generated images, not code to review; the protected-branch stop still applies. A GitHub link is checked in the
// rendered page's HTML, a GitLab link form is not tested on a real server yet.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BRANCH = 'factory-screenshots';
const PROTECTED = new Set(['main', 'master']);

// ---- Links and Markdown ---------------------------------------------------------------------------------------

/** `{ host, hostname, path }` from a git remote URL (https or ssh), without credentials or `.git`; null if it is not one. */
export function parseRemote(url) {
  const match = String(url ?? '').trim().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)[:/]([^\s]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  const hostname = match[1].toLowerCase();
  const host = hostname === 'github.com' ? 'github' : hostname === 'gitlab.com' ? 'gitlab' : null;
  return { host, hostname, path: match[2].replace(/^\/+/, '') };
}

/**
 * The URL of one published image, pinned to a commit. GitHub: `blob/<ref>/<file>?raw=true`. GitLab: `-/raw/<ref>/<file>`.
 * An unknown (self-hosted) server needs `host` to say which of the two it is.
 */
export function imageUrl({ remote, ref, file, host }) {
  const parsed = parseRemote(remote);
  if (!parsed) throw new Error('imageUrl needs the git remote URL, and the "remote" value is missing or is not a URL.');
  if (!ref) throw new Error('imageUrl needs a commit to pin the link to, and the "ref" value is empty.');
  const kind = host ?? parsed.host;
  if (!kind) throw new Error(`Cannot tell which host ${parsed.hostname} is. Pass the host: github or gitlab.`);
  const encoded = String(file).split('/').map(encodeURIComponent).join('/');
  if (kind === 'github') return `https://${parsed.hostname}/${parsed.path}/blob/${ref}/${encoded}?raw=true`;
  if (kind === 'gitlab') return `https://${parsed.hostname}/${parsed.path}/-/raw/${ref}/${encoded}`;
  throw new Error(`Unknown host "${kind}". Use github or gitlab.`);
}

/** Markdown for a PR description: a heading and one image per file. Empty when there are no files. */
export function screenshotMarkdown({ remote, ref, files, host }) {
  if (!files || files.length === 0) return '';
  const lines = ['### Screenshots', ''];
  for (const file of files) {
    const alt = basename(file).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    lines.push(`![${alt}](${imageUrl({ remote, ref, file, host })})`, '');
  }
  return lines.join('\n');
}

/** The PNG file names directly inside a folder, sorted. A missing folder gives an empty list. */
export function listPngs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

// ---- Publishing -----------------------------------------------------------------------------------------------

function git(cwd, args, { env } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.error) throw new Error(`Could not run git: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function checkSubdir(subdir) {
  const text = String(subdir ?? '');
  const segments = text.split('/');
  const safe = /^[A-Za-z0-9._/-]+$/.test(text) && !text.startsWith('/') && !text.includes('..') &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment.toLowerCase() !== '.git');
  if (!safe) throw new Error(`"${text}" is not a safe subfolder name: use letters, digits, dots, dashes, underscores and slashes, with no "..".`);
}

/**
 * Publishes the PNGs of `dir` under `<subdir>/` on the screenshots branch of `remote` and returns
 * `{ sha, branch, files }`, where `sha` is the commit that holds them and `files` are the paths inside that commit.
 * A second publish adds to the branch, and publishing the same `subdir` again replaces that folder. Throws an Error
 * with a readable message and leaves no worktree, local branch or temporary folder behind.
 */
export function publish({ root = process.cwd(), dir, subdir, branch = DEFAULT_BRANCH, remote = 'origin', message }) {
  if (PROTECTED.has(branch)) throw new Error(`"${branch}" is a protected branch. Screenshots go on a branch of their own.`);
  checkSubdir(subdir);
  const names = listPngs(dir);
  if (names.length === 0) throw new Error(`There are no PNG files in ${dir}.`);

  const temp = mkdtempSync(join(tmpdir(), 'wk-shots-'));
  const worktree = join(temp, 'worktree');
  const tempBranch = `wk-shots-${process.pid}-${Date.now()}`;
  let worktreeAdded = false;
  try {
    const onRemote = git(root, ['ls-remote', '--heads', remote, branch]) !== '';
    if (onRemote) {
      git(root, ['fetch', '--no-tags', '--quiet', remote, branch]);
      git(root, ['worktree', 'add', '--detach', '--quiet', worktree, 'FETCH_HEAD']);
      worktreeAdded = true;
    } else {
      git(root, ['worktree', 'add', '--no-checkout', '--detach', '--quiet', worktree, 'HEAD']);
      worktreeAdded = true;
      git(worktree, ['switch', '--quiet', '--orphan', tempBranch]);
    }

    const target = join(worktree, subdir);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const name of names) copyFileSync(join(dir, name), join(target, name));
    git(worktree, ['add', '--all', subdir]);
    if (git(worktree, ['status', '--porcelain']) !== '') {
      git(worktree, ['commit', '--quiet', '-m', message ?? `Screenshots for ${subdir}`]);
    }
    const sha = git(worktree, ['rev-parse', 'HEAD']);
    git(worktree, ['push', '--quiet', remote, `HEAD:refs/heads/${branch}`], { env: { REVIEW_MODE: 'off' } });
    return { sha, branch, files: names.map((name) => `${subdir}/${name}`) };
  } finally {
    if (worktreeAdded) {
      try {
        git(root, ['worktree', 'remove', '--force', worktree]);
      } catch {
        // The folder is removed below and `worktree prune` forgets it.
      }
    }
    try {
      git(root, ['branch', '-D', tempBranch]);
    } catch {
      // Only the orphan case made a local branch.
    }
    rmSync(temp, { recursive: true, force: true });
    try {
      git(root, ['worktree', 'prune']);
    } catch {
      // Nothing to prune, or git is not usable; the caller already has the error.
    }
  }
}

// ---- Command line ---------------------------------------------------------------------------------------------

function parseArguments(argv) {
  const options = { command: argv[0], root: process.cwd(), json: false };
  const valued = {
    '--root': 'root', '--dir': 'dir', '--subdir': 'subdir', '--branch': 'branch', '--remote': 'remote',
    '--url-remote': 'urlRemote', '--ref': 'ref', '--files': 'files', '--host': 'host',
  };
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--json') options.json = true;
    else if (valued[argv[index]] && argv[index + 1] !== undefined) options[valued[argv[index]]] = argv[(index += 1)];
  }
  return options;
}

function main(argv) {
  const options = parseArguments(argv);
  try {
    if (options.command === 'markdown') {
      if (!options.remote || !options.ref || !options.files) {
        console.error('markdown needs --remote <url> --ref <commit> --files <a.png,b.png>');
        return 2;
      }
      console.log(screenshotMarkdown({ remote: options.remote, ref: options.ref, files: options.files.split(',').filter(Boolean), host: options.host }));
      return 0;
    }
    if (options.command === 'publish') {
      if (!options.dir || !options.subdir) {
        console.error('publish needs --dir <folder with PNGs> --subdir <name>');
        return 2;
      }
      const result = publish({ root: options.root, dir: options.dir, subdir: options.subdir, branch: options.branch, remote: options.remote });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return 0;
      }
      const remoteUrl = options.urlRemote ?? git(options.root, ['remote', 'get-url', options.remote ?? 'origin']);
      console.log(screenshotMarkdown({ remote: remoteUrl, ref: result.sha, files: result.files, host: options.host }));
      return 0;
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 1;
  }
  console.error('usage: e2e-shots.mjs publish --dir <folder> --subdir <name> | markdown --remote <url> --ref <commit> --files <a.png,b.png>');
  return 2;
}

/**
 * True when this file was started directly (`node scripts/<name>.mjs`). Both sides are resolved to real
 * paths: Node reports the real path in import.meta.url, but argv[1] keeps a symlink or a Windows short name,
 * and a plain comparison would then make the script silently do nothing.
 */
function startedDirectly() {
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && startedDirectly()) {
  process.exit(main(process.argv.slice(2)));
}
