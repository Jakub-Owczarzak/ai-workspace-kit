// Run: node --test e2e-shots.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { imageUrl, listPngs, parseRemote, publish, screenshotMarkdown } from './e2e-shots.mjs';

const SCRIPT = fileURLToPath(new URL('./e2e-shots.mjs', import.meta.url));
// Not a real image: the tests only need bytes that can be told apart.
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02]);

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A work repository with one commit on main and a bare "origin" to push to, both in a temporary folder. */
function withRepos(callback) {
  const base = mkdtempSync(join(tmpdir(), 'e2e-shots-'));
  try {
    const origin = join(base, 'origin.git');
    const work = join(base, 'work');
    mkdirSync(origin);
    git(origin, 'init', '--bare', '-b', 'main', '-q');
    mkdirSync(work);
    git(work, 'init', '-b', 'main', '-q');
    git(work, 'config', 'user.email', 'test@example.com');
    git(work, 'config', 'user.name', 'Test');
    writeFileSync(join(work, 'app.txt'), 'app\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'first');
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', '-q', 'origin', 'main');
    return callback({ base, origin, work });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function writeShots(work, files) {
  const dir = join(work, 'e2e-out');
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  return dir;
}

const treeFiles = (origin, branch) => git(origin, 'ls-tree', '-r', '--name-only', branch).split('\n').filter(Boolean).sort();

describe('parseRemote', () => {
  it('reads github and gitlab from https and ssh remotes, without the credentials or the .git ending', () => {
    assert.deepEqual(parseRemote('https://github.com/acme/app.git'), { host: 'github', hostname: 'github.com', path: 'acme/app' });
    assert.deepEqual(parseRemote('git@github.com:acme/app.git'), { host: 'github', hostname: 'github.com', path: 'acme/app' });
    assert.deepEqual(parseRemote('https://gitlab.com/grp/sub/app.git'), { host: 'gitlab', hostname: 'gitlab.com', path: 'grp/sub/app' });
    assert.deepEqual(parseRemote('https://user:secret-token@github.com/acme/app'), { host: 'github', hostname: 'github.com', path: 'acme/app' });
  });

  it('keeps an unknown host but cannot name it, and gives null for nonsense', () => {
    assert.deepEqual(parseRemote('https://git.example.com/a/b.git'), { host: null, hostname: 'git.example.com', path: 'a/b' });
    assert.equal(parseRemote(''), null);
    assert.equal(parseRemote(undefined), null);
    assert.equal(parseRemote('not a url'), null);
  });
});

describe('imageUrl', () => {
  it('pins a github image to a commit and asks for the raw file', () => {
    assert.equal(
      imageUrl({ remote: 'https://github.com/acme/app.git', ref: 'abc123', file: 'feat/shot.png' }),
      'https://github.com/acme/app/blob/abc123/feat/shot.png?raw=true',
    );
  });

  it('pins a gitlab image to a commit with the raw path', () => {
    assert.equal(
      imageUrl({ remote: 'git@gitlab.com:grp/sub/app.git', ref: 'abc123', file: 'feat/shot.png' }),
      'https://gitlab.com/grp/sub/app/-/raw/abc123/feat/shot.png',
    );
  });

  it('encodes spaces in file names and lets an explicit host name a self-hosted server', () => {
    assert.match(imageUrl({ remote: 'https://github.com/a/b', ref: 'r', file: 'my shot.png' }), /my%20shot\.png/);
    assert.equal(
      imageUrl({ remote: 'https://git.example.com/a/b.git', ref: 'r', file: 's.png', host: 'gitlab' }),
      'https://git.example.com/a/b/-/raw/r/s.png',
    );
  });

  it('refuses an unknown host without an explicit one, and a missing ref', () => {
    assert.throws(() => imageUrl({ remote: 'https://git.example.com/a/b', ref: 'r', file: 's.png' }), /which host/i);
    assert.throws(() => imageUrl({ remote: 'https://github.com/a/b', ref: '', file: 's.png' }), /commit/i);
    assert.throws(() => imageUrl({ remote: '', ref: 'r', file: 's.png' }), /remote/i);
  });
});

describe('screenshotMarkdown', () => {
  it('lists each image under a heading, with a readable alt text', () => {
    const text = screenshotMarkdown({
      remote: 'https://github.com/acme/app.git',
      ref: 'abc123',
      files: ['feat/login-page.png', 'feat/error_state.png'],
    });
    assert.match(text, /^### Screenshots\n/);
    assert.match(text, /!\[login page\]\(https:\/\/github\.com\/acme\/app\/blob\/abc123\/feat\/login-page\.png\?raw=true\)/);
    assert.match(text, /!\[error state\]\(.*error_state\.png\?raw=true\)/);
  });

  it('is empty when there are no files', () => {
    assert.equal(screenshotMarkdown({ remote: 'https://github.com/a/b', ref: 'r', files: [] }), '');
  });
});

describe('listPngs', () => {
  it('lists PNG files sorted, ignores other files and a missing folder', () => {
    withRepos(({ work }) => {
      const dir = writeShots(work, { 'b.png': PNG_A, 'a.PNG': PNG_A, 'notes.txt': 'x', 'c.jpg': 'x' });
      assert.deepEqual(listPngs(dir), ['a.PNG', 'b.png']);
      assert.deepEqual(listPngs(join(work, 'nope')), []);
    });
  });
});

describe('publish', () => {
  it('creates an orphan factory-screenshots branch on the remote with only the images, and leaves main alone', () => {
    withRepos(({ origin, work }) => {
      const mainBefore = git(origin, 'rev-parse', 'main');
      const dir = writeShots(work, { 'login.png': PNG_A, 'home.png': PNG_B });
      const result = publish({ root: work, dir, subdir: 'feat-a' });
      assert.equal(result.branch, 'factory-screenshots');
      assert.deepEqual(result.files, ['feat-a/home.png', 'feat-a/login.png']);
      assert.deepEqual(treeFiles(origin, 'factory-screenshots'), ['feat-a/home.png', 'feat-a/login.png']);
      assert.equal(git(origin, 'rev-parse', 'factory-screenshots'), result.sha);
      assert.equal(git(origin, 'log', '-1', '--format=%P', 'factory-screenshots'), '', 'an orphan commit has no parent');
      assert.equal(git(origin, 'rev-parse', 'main'), mainBefore);
      assert.deepEqual(readFileSync(join(work, 'e2e-out', 'login.png')), PNG_A);
    });
  });

  it('leaves the working tree, the current branch, the branch list and the worktree list as they were', () => {
    withRepos(({ work }) => {
      const dir = writeShots(work, { 'a.png': PNG_A });
      const before = [git(work, 'status', '--porcelain'), git(work, 'branch', '--list'), git(work, 'worktree', 'list').split('\n').length, git(work, 'rev-parse', 'HEAD')];
      publish({ root: work, dir, subdir: 'feat-a' });
      const after = [git(work, 'status', '--porcelain'), git(work, 'branch', '--list'), git(work, 'worktree', 'list').split('\n').length, git(work, 'rev-parse', 'HEAD')];
      assert.deepEqual(after, before);
      assert.equal(git(work, 'branch', '--show-current'), 'main');
      assert.ok(existsSync(join(work, 'app.txt')));
    });
  });

  it('adds to the existing branch on a second publish and replaces the same folder', () => {
    withRepos(({ origin, work }) => {
      const first = publish({ root: work, dir: writeShots(work, { 'a.png': PNG_A }), subdir: 'feat-a' });
      const second = publish({ root: work, dir: writeShots(work, { 'b.png': PNG_B }), subdir: 'feat-b' });
      assert.notEqual(second.sha, first.sha);
      assert.equal(git(origin, 'log', '-1', '--format=%P', 'factory-screenshots'), first.sha, 'the second commit builds on the first');
      assert.ok(treeFiles(origin, 'factory-screenshots').includes('feat-a/a.png'));
      assert.ok(treeFiles(origin, 'factory-screenshots').includes('feat-b/b.png'));
      const again = publish({ root: work, dir: writeShots(work, { 'a.png': PNG_B }), subdir: 'feat-a' });
      assert.deepEqual(execFileSync('git', ['show', `${again.sha}:feat-a/a.png`], { cwd: origin }), PNG_B);
    });
  });

  it('refuses the protected branches, a folder with no PNG, and an unsafe subfolder, leaving nothing behind', () => {
    withRepos(({ origin, work }) => {
      const dir = writeShots(work, { 'a.png': PNG_A });
      assert.throws(() => publish({ root: work, dir, subdir: 's', branch: 'main' }), /protected/i);
      assert.throws(() => publish({ root: work, dir, subdir: 's', branch: 'master' }), /protected/i);
      assert.throws(() => publish({ root: work, dir: join(work, 'empty'), subdir: 's' }), /no PNG/i);
      for (const bad of ['', '..', '../x', '/abs', 'a/../b', 'a b;c']) {
        assert.throws(() => publish({ root: work, dir, subdir: bad }), /subfolder/i, `subdir ${JSON.stringify(bad)}`);
      }
      assert.equal(git(origin, 'branch', '--list', 'factory-screenshots'), '');
      assert.equal(git(work, 'worktree', 'list').split('\n').length, 1);
    });
  });

  it('reports a missing remote in words and cleans up the temporary worktree', () => {
    withRepos(({ work }) => {
      const dir = writeShots(work, { 'a.png': PNG_A });
      assert.throws(() => publish({ root: work, dir, subdir: 's', remote: 'nowhere' }), /nowhere/);
      assert.equal(git(work, 'worktree', 'list').split('\n').length, 1);
      assert.equal(git(work, 'branch', '--list'), '* main');
    });
  });

  it('runs the repository hooks (never --no-verify) and tells the pre-push hook this is not code to review', () => {
    withRepos(({ work }) => {
      // A hook that only lets the push through when REVIEW_MODE is off: the images are not code to review.
      const hook = join(work, '.git', 'hooks', 'pre-push');
      writeFileSync(hook, '#!/bin/sh\n[ "$REVIEW_MODE" = "off" ] || { echo "hook: review required" >&2; exit 1; }\nexit 0\n');
      chmodSync(hook, 0o755);
      const result = publish({ root: work, dir: writeShots(work, { 'a.png': PNG_A }), subdir: 'feat-a' });
      assert.ok(result.sha);
      // The same hook still refuses a normal push, so it really ran for the publish.
      writeFileSync(join(work, 'more.txt'), 'x');
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'more');
      assert.throws(() => git(work, 'push', 'origin', 'main'), /review required/);
    });
  });
});

describe('command line', () => {
  const run = (args) => {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (error) {
      return { status: error.status, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
    }
  };

  it('markdown prints the image block for the files given', () => {
    const out = run(['markdown', '--remote', 'https://github.com/acme/app.git', '--ref', 'abc', '--files', 'f/a.png,f/b.png']);
    assert.equal(out.status, 0);
    assert.match(out.stdout, /### Screenshots/);
    assert.match(out.stdout, /blob\/abc\/f\/b\.png\?raw=true/);
  });

  it('publish prints the Markdown for the published images, or JSON with --json', () => {
    withRepos(({ work }) => {
      git(work, 'remote', 'set-url', 'origin', join(work, '..', 'origin.git'));
      const dir = writeShots(work, { 'a.png': PNG_A });
      const markdown = run(['publish', '--root', work, '--dir', dir, '--subdir', 'feat-a', '--url-remote', 'https://github.com/acme/app.git']);
      assert.equal(markdown.status, 0, markdown.stderr);
      assert.match(markdown.stdout, /!\[a\]\(https:\/\/github\.com\/acme\/app\/blob\/[0-9a-f]{40}\/feat-a\/a\.png\?raw=true\)/);
      const json = run(['publish', '--root', work, '--dir', dir, '--subdir', 'feat-a', '--json']);
      assert.equal(json.status, 0, json.stderr);
      assert.deepEqual(Object.keys(JSON.parse(json.stdout)).sort(), ['branch', 'files', 'sha']);
    });
  });

  it('prints a plain message and exits 1 for a refusal, and 2 for an unknown command', () => {
    withRepos(({ work }) => {
      const dir = writeShots(work, { 'a.png': PNG_A });
      const refused = run(['publish', '--root', work, '--dir', dir, '--subdir', 's', '--branch', 'main']);
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /protected/i);
    });
    assert.equal(run(['nope']).status, 2);
  });
});
