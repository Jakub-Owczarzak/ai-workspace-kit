#!/usr/bin/env node
// Test-edit guard. While a bug fix or a test-first piece of work is in progress ("fix mode"), the agent
// must not weaken the proof it is working against: this Claude Code hook blocks edits to test files that
// already exist, so the code has to change, not the test. It is a PreToolUse hook for Edit, Write and
// MultiEdit; it blocks by exiting with code 2 and a message that tells the agent how to proceed.
//
// It does nothing unless ALL of these hold:
//   1. the workflow control `tests.guard` is on (profile or override; see workflow-config.mjs),
//   2. fix mode is on: a marker file .claude/state/fix-mode.json exists and is younger than 4 hours,
//   3. the file being edited is a test file that is tracked in git, or was locked (see below),
//   4. ALLOW_TEST_EDITS=1 is not set.
// A NEW test file is allowed (that is the "write the failing test first" step) until you lock it.
//
// Commands (run in the project):
//   node scripts/test-edit-guard.mjs start [--reason "what is being fixed"]   turn fix mode on
//   node scripts/test-edit-guard.mjs lock                                    protect the new test files written so far
//   node scripts/test-edit-guard.mjs status                                  show fix mode and what is protected
//   node scripts/test-edit-guard.mjs stop                                    turn fix mode off
// With no command it runs as the hook: it reads the hook's JSON from standard input.
//
// It never blocks because of its own failure: any error, or a missing resolver, allows the edit with a
// warning. Limits: it sees Edit, Write and MultiEdit; a shell command that rewrites a test file (sed -i,
// a redirect) is not seen, so the rule in test-discipline.md still applies.
//
// Hook wiring for .claude/settings.json:
//   { "hooks": { "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit",
//       "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/test-edit-guard.mjs\"" } ] } ] } }

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TTL_HOURS = 4;

export function markerPath(root) {
  return join(root, '.claude', 'state', 'fix-mode.json');
}

function logPath(root) {
  return join(root, '.claude', 'state', 'test-guard.log');
}

/**
 * The real path of a file or folder, even when the file does not exist yet (a new test): the nearest
 * existing parent is resolved and the missing names are put back. Resolving matters because git reports
 * the project root by its real path, while an editor may reach the same file through a symlink (macOS temp
 * folders, linked project folders) or a Windows short name (RUNNER~1). Without it the file looks like it is
 * outside the project and the guard would allow the edit.
 */
export function canonicalPath(path) {
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonicalPath(parent), basename(path));
  }
}

/** A forward-slash path relative to the project root. */
export function toRelative(root, filePath) {
  const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  return relative(canonicalPath(root), canonicalPath(absolute)).split('\\').join('/');
}

/** True for a path that looks like a test file or sits in a test folder (JS/TS, Python, Go). */
export function isTestPath(path) {
  const normalized = String(path).split('\\').join('/');
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized) ||
    /(^|\/)(__tests__|tests?)\//.test(normalized) ||
    /(^|\/)test_[^/]+\.py$/.test(normalized) ||
    /_test\.(py|go)$/.test(normalized)
  );
}

/** Reads the fix-mode marker, or null when it is missing or unreadable. */
export function readMarker(root) {
  try {
    const marker = JSON.parse(readFileSync(markerPath(root), 'utf8'));
    return marker && typeof marker === 'object' && typeof marker.startedAt === 'string' ? marker : null;
  } catch {
    return null;
  }
}

/** Fix mode counts only while the marker is younger than the time limit. */
export function isFresh(marker, now = Date.now(), ttlHours = DEFAULT_TTL_HOURS) {
  const started = Date.parse(marker?.startedAt);
  return Number.isFinite(started) && now - started < ttlHours * 3600 * 1000;
}

/** The message shown to the agent when an edit is blocked. */
export function buildBlockMessage(relativePath, code) {
  const why =
    code === 'locked'
      ? 'it was locked as the proof for this work'
      : 'it is an existing test and fix mode is on';
  return [
    `test-edit-guard: edit blocked. ${relativePath} is a test file and ${why}.`,
    'A fix must change the code, not the test that proves it. What you can do:',
    '  - change the code so the existing test passes;',
    '  - if the test itself is wrong, say so to the user and ask: they can end fix mode (node scripts/test-edit-guard.mjs stop) or allow one edit (ALLOW_TEST_EDITS=1);',
    '  - to add a new test, create a new test file (new files are allowed until locked).',
  ].join('\n');
}

/**
 * Decides one edit. Returns `{ action: 'allow' | 'block', code }`.
 * Inputs: `relativePath`, `marker` (or null), `now`, `ttlHours`, `env`, `guardControl` ('on' | 'off'),
 * `isTracked(relativePath) -> boolean`.
 */
export function decide({ relativePath, marker, now = Date.now(), ttlHours = DEFAULT_TTL_HOURS, env = {}, guardControl = 'on', isTracked }) {
  if (env.ALLOW_TEST_EDITS === '1') return { action: 'allow', code: 'override' };
  if (guardControl === 'off') return { action: 'allow', code: 'control-off' };
  if (!marker) return { action: 'allow', code: 'no-fix-mode' };
  if (!isFresh(marker, now, ttlHours)) return { action: 'allow', code: 'expired' };
  if (!isTestPath(relativePath)) return { action: 'allow', code: 'not-a-test' };
  if (Array.isArray(marker.protected) && marker.protected.includes(relativePath)) return { action: 'block', code: 'locked' };
  if (isTracked(relativePath)) return { action: 'block', code: 'existing-test' };
  return { action: 'allow', code: 'new-test' };
}

/** The file paths and working folder in the hook's JSON input (Edit, Write and MultiEdit use `file_path`). */
export function parseHookInput(text) {
  try {
    const input = JSON.parse(text);
    const toolInput = input?.tool_input ?? {};
    const filePaths = [toolInput.file_path, toolInput.notebook_path].filter((value) => typeof value === 'string' && value !== '');
    return { toolName: input?.tool_name ?? '', filePaths, cwd: typeof input?.cwd === 'string' ? input.cwd : null };
  } catch {
    return { toolName: '', filePaths: [], cwd: null };
  }
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function isTrackedInGit(root, relativePath) {
  try {
    git(root, ['ls-files', '--error-unmatch', '--', relativePath]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The project root: the git top-level folder of `startFolder`. A start folder that does not exist (for
 * example a POSIX-style path from a shell that Node cannot use) falls back to the process's own folder.
 */
export function projectRoot(startFolder) {
  const folder = startFolder && existsSync(startFolder) ? startFolder : process.cwd();
  try {
    return git(folder, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return folder;
  }
}

/** The value of the `tests.guard` control; 'on' when the resolver is not installed (the marker shows intent). */
async function readGuardControl(root, env) {
  try {
    const { loadWorkflowConfig } = await import('./workflow-config.mjs');
    return loadWorkflowConfig(root, env).controls['tests.guard'].value;
  } catch {
    return 'on';
  }
}

function writeMarker(root, marker) {
  mkdirSync(dirname(markerPath(root)), { recursive: true });
  writeFileSync(markerPath(root), `${JSON.stringify(marker, null, 2)}\n`);
}

function logBlock(root, relativePath, code) {
  try {
    mkdirSync(dirname(logPath(root)), { recursive: true });
    appendFileSync(logPath(root), `${new Date().toISOString()} blocked ${code} ${relativePath}\n`);
  } catch {
    // The log is a convenience; never fail because of it.
  }
}

/** The hook: reads the JSON from standard input and returns the exit code (0 allow, 2 block). */
export async function runHook(inputText, env = process.env, now = Date.now()) {
  const { filePaths, cwd } = parseHookInput(inputText);
  if (filePaths.length === 0) return 0;
  const root = env.CLAUDE_PROJECT_DIR || projectRoot(cwd || process.cwd());
  const marker = readMarker(root);
  if (!marker) return 0;
  const guardControl = await readGuardControl(root, env);
  const ttlHours = Number(env.TEST_GUARD_HOURS) > 0 ? Number(env.TEST_GUARD_HOURS) : DEFAULT_TTL_HOURS;
  for (const filePath of filePaths) {
    const relativePath = toRelative(root, filePath);
    const result = decide({ relativePath, marker, now, ttlHours, env, guardControl, isTracked: (path) => isTrackedInGit(root, path) });
    if (result.action === 'block') {
      console.error(buildBlockMessage(relativePath, result.code));
      logBlock(root, relativePath, result.code);
      return 2;
    }
  }
  return 0;
}

/** New test files (untracked or just added) in the working tree, relative to the root. */
function newTestFiles(root) {
  const lines = git(root, ['status', '--porcelain', '--untracked-files=all']).split('\n');
  return lines
    .filter((line) => /^(\?\?|A |AM)/.test(line))
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .filter(isTestPath);
}

/** The commands start, lock, status and stop. Returns `{ code, lines }`. */
export async function runCommand(command, args, root, env = process.env, now = Date.now()) {
  if (command === 'start') {
    const reasonIndex = args.indexOf('--reason');
    const reason = reasonIndex >= 0 ? args[reasonIndex + 1] ?? '' : '';
    writeMarker(root, { startedAt: new Date(now).toISOString(), reason, protected: [] });
    const lines = ['Fix mode is ON. Existing test files are protected for the next 4 hours.'];
    if ((await readGuardControl(root, env)) === 'off') {
      lines.push('Note: the workflow control tests.guard is OFF in this project, so the hook will not block. Set overrides {"tests.guard": "on"} in .claude/workflow.json to enforce it.');
    }
    lines.push('Write the failing test as a NEW test file, run it and see it fail, then run: node scripts/test-edit-guard.mjs lock');
    return { code: 0, lines };
  }
  if (command === 'lock') {
    const marker = readMarker(root);
    if (!marker) return { code: 1, lines: ['Fix mode is not on. Run: node scripts/test-edit-guard.mjs start'] };
    const files = newTestFiles(root);
    writeMarker(root, { ...marker, protected: [...new Set([...(marker.protected ?? []), ...files])] });
    return { code: 0, lines: [files.length ? `Locked ${files.length} new test file(s):` : 'No new test files found to lock.', ...files.map((file) => `  ${file}`)] };
  }
  if (command === 'stop') {
    const existed = existsSync(markerPath(root));
    rmSync(markerPath(root), { force: true });
    return { code: 0, lines: [existed ? 'Fix mode is OFF.' : 'Fix mode was not on.'] };
  }
  if (command === 'status') {
    const marker = readMarker(root);
    if (!marker) return { code: 0, lines: ['Fix mode: off'] };
    const fresh = isFresh(marker, now);
    return {
      code: 0,
      lines: [
        `Fix mode: ${fresh ? 'ON' : 'expired (older than 4 hours, so ignored)'}`,
        `Started: ${marker.startedAt}${marker.reason ? ` (${marker.reason})` : ''}`,
        `Locked test files: ${(marker.protected ?? []).length ? (marker.protected ?? []).join(', ') : 'none'}`,
        `Control tests.guard: ${await readGuardControl(root, env)}`,
      ],
    };
  }
  return { code: 1, lines: ['Usage: test-edit-guard.mjs start [--reason "..."] | lock | status | stop   (no command = run as the hook)'] };
}

/**
 * True when this file was started directly (`node scripts/test-edit-guard.mjs`). Both sides are resolved to
 * real paths: Node reports the real path in import.meta.url, but argv[1] keeps a symlink or a Windows short
 * name, and a plain comparison would then make the hook silently do nothing (and so allow every edit).
 */
function startedDirectly() {
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && startedDirectly()) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command) {
      const { code, lines } = await runCommand(command, args, projectRoot(process.cwd()));
      console.log(lines.join('\n'));
      process.exit(code);
    }
    process.exit(await runHook(readFileSync(0, 'utf8')));
  } catch (error) {
    // Fail open: a broken guard must never block work.
    console.error(`test-edit-guard: could not run (${error.message}); allowing the edit.`);
    process.exit(0);
  }
}
