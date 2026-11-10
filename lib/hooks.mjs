// Chains the kit's checks into the project's EXISTING git hook system as one marked block. The user's own
// hook lines are never replaced or reordered; removing the block (between the workspace-kit markers) removes
// the kit. When the project's hook system cannot be edited safely, the result says why and nothing is written.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { upsertBlock } from './blocks.mjs';

const git = (dir, args) => {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

const HOOK_MANAGER_FILES = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.pre-commit-config.yaml'];

/** Where this project's hooks live: { dir, system } or { manual: reason }. */
export function findHookDir(dir) {
  if (existsSync(join(dir, '.husky'))) return { dir: join(dir, '.husky'), system: 'husky' };
  const manager = HOOK_MANAGER_FILES.find((name) => existsSync(join(dir, name)));
  if (manager) return { manual: `${manager} manages the hooks here; add the kit commands to it by hand` };
  const configured = git(dir, ['config', '--get', 'core.hooksPath']);
  if (configured) return { dir: isAbsolute(configured) ? configured : join(dir, configured), system: 'core.hooksPath' };
  const hooksPath = git(dir, ['rev-parse', '--git-path', 'hooks']);
  if (hooksPath) return { dir: isAbsolute(hooksPath) ? hooksPath : join(dir, hooksPath), system: 'git' };
  return { manual: 'this folder is not a git repository, so there is no hook to chain into' };
}

const KIT_BLOCK = /# workspace-kit:start [\s\S]*?# workspace-kit:end [^\n]*\n?/g;

/** The text of hook `name` without the kit's own block, or '' when there is no such hook. */
export function userHookText(dir, name) {
  const target = findHookDir(dir);
  if (target.manual) return '';
  const file = join(target.dir, name);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(KIT_BLOCK, '');
}

/**
 * Body of the pre-commit block: the project's own checks, then the kit's. Returns null when there is nothing
 * to add (everything is already in the project's hook). `changelogTemplate` comes from the kit's template.
 */
export function buildPreCommitBody({ commands = {}, scriptsDir = 'scripts', docsFresh, changelogScript, changelogTemplate }) {
  const lines = ['# Kit checks. A failing check blocks the commit. Remove this whole block to remove the kit hook.'];
  for (const command of [commands.lint, commands.typecheck, commands.test]) {
    if (command) lines.push(`${command} || exit 1`);
  }
  if (docsFresh) {
    lines.push(`if [ -f ${scriptsDir}/check-docs-fresh.mjs ]; then node ${scriptsDir}/check-docs-fresh.mjs || exit 1; fi`);
  }
  if (changelogScript && changelogTemplate) {
    const start = changelogTemplate.indexOf('CHANGELOG_SCRIPT=');
    if (start === -1) throw new Error('pre-commit template has no changelog section');
    const section = changelogTemplate
      .slice(start)
      .replace(/^CHANGELOG_SCRIPT=.*$/m, `CHANGELOG_SCRIPT=${changelogScript}`)
      .replace('node "$CHANGELOG_SCRIPT" add --changelog CHANGELOG.md', 'node "$CHANGELOG_SCRIPT" add --changelog CHANGELOG.md || exit 1');
    lines.push('', section.trimEnd());
  }
  return lines.length === 1 ? null : lines.join('\n');
}

/** Body of the pre-push block: optional protected-branch stop, then the review gate. */
export function buildPrePushBody({ protectedBranch, reviewGate = true }) {
  const lines = [
    '# Kit checks. Remove this whole block to remove the kit hook.',
    'kit_pushed_commits=""',
    'while read -r kit_local_ref kit_local_sha kit_remote_ref kit_remote_sha; do',
  ];
  if (protectedBranch) {
    lines.push(
      `  if [ "$kit_remote_ref" = "refs/heads/${protectedBranch}" ]; then`,
      `    echo "Pushing to ${protectedBranch} is blocked. Push a branch and open a pull request."`,
      '    exit 1',
      '  fi'
    );
  }
  lines.push(
    '  # A branch deletion sends an all-zero commit id; there is nothing to review in it.',
    '  case "$kit_local_sha" in',
    '    *[!0]*) kit_pushed_commits="$kit_pushed_commits $kit_local_sha" ;;',
    '  esac',
    'done'
  );
  if (reviewGate) {
    lines.push(
      '',
      'if [ -f scripts/check-review-gate.mjs ]; then',
      '  if command -v node >/dev/null 2>&1; then',
      '    for kit_commit in $kit_pushed_commits; do',
      '      node scripts/check-review-gate.mjs --commit "$kit_commit" || exit 1',
      '    done',
      '  else',
      '    echo "review-gate: node was not found on the PATH, so the review gate was skipped."',
      '  fi',
      'fi'
    );
  }
  return lines.join('\n');
}

/** A pre-push hook that reads the pushed refs from stdin (git-lfs does) and the kit's loop would starve each other. */
const READS_PUSH_INPUT = /\bgit[ -]lfs\b|^\s*while\s+read\b/m;

/**
 * Adds or refreshes the kit's block in hook `name`. Returns { status, path, reason }, where status is
 * created, updated, unchanged or manual.
 */
export function installHookBlock({ dir, name, body, dryRun = false }) {
  const target = findHookDir(dir);
  if (target.manual) return { status: 'manual', path: `hook ${name}`, reason: target.manual, snippet: body };
  const file = join(target.dir, name);
  const existed = existsSync(file);
  const existing = existed ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
  const label = `${target.system === 'git' ? '.git/hooks' : target.dir.slice(dir.length + 1) || target.dir}/${name}`;

  if (existed) {
    const firstLine = existing.split('\n', 1)[0];
    if (firstLine.startsWith('#!') && !/\b(ba|da|z|k)?sh\b/.test(firstLine)) {
      return { status: 'manual', path: label, reason: `the existing hook is not a shell script (${firstLine})`, snippet: body };
    }
    const outsideBlock = existing.replace(KIT_BLOCK, '');
    if (name === 'pre-push' && READS_PUSH_INPUT.test(outsideBlock)) {
      return { status: 'manual', path: label, reason: 'the existing pre-push hook reads the pushed refs from stdin (for example git-lfs); two readers would starve each other, so chain the kit commands by hand', snippet: body };
    }
  }
  const before = existed ? existing : '#!/bin/sh\n';
  const after = upsertBlock(before, name, body, 'hash');
  if (existed && after === before) return { status: 'unchanged', path: label };
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, after);
    try {
      chmodSync(file, 0o755);
    } catch {
      // Windows has no executable bit; git runs hooks through sh regardless.
    }
  }
  return { status: existed ? 'updated' : 'created', path: label };
}
