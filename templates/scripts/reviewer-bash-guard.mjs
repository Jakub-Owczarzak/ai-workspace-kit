#!/usr/bin/env node
// Reviewer Bash guard. A Claude Code PreToolUse hook that keeps the `reviewer` subagent read-only: its Bash calls
// may only be `git status|diff|log|show` and the project's own lint, type check, test and build commands (the
// Commands block of AGENTS.md), one command per call. Every other agent, the main session and every other tool pass
// untouched, because the hook only acts when the payload says `agent_type: "reviewer"`.
//
// The setup program merges this into `.claude/settings.json` (the `check.reviewer-guard` option; your own hooks are
// kept, and a settings file that is not strict JSON is left alone and handed over as a manual step):
//   "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/reviewer-bash-guard.mjs\"" } ] } ] }
// It lives in settings, not in the agent's frontmatter, on purpose: Claude Code skips a project agent's frontmatter
// hooks, with only a debug-level message, when the folder is not trusted.
//
// Exit 0 = allowed. Exit 2 = refused; the message on stderr goes back to the reviewer. Limits, on purpose:
//   - It is not a sandbox. A project's own test or build command can still write files (snapshots, a dist folder),
//     and a package script can do anything. It stops the reviewer's own shell habits, not a determined attack.
//   - It fails open: a payload it cannot read, or a crash, lets the call through, because a guard that blocks
//     the whole session costs more than it protects.
//   - Only Claude Code runs this hook. In other tools the reviewer keeps the instruction-only limit.

import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The review gate can be installed without the factory, so this script stands alone: the command parser below is a
// copy of `projectCommands` in factory-guard.mjs, and a test keeps the two giving the same answers.
const COMMAND_LABELS = [
  ['lint', /^lint\b/i],
  ['typecheck', /^(?:type[ -]?check|types?)\b/i],
  ['test', /^tests?\b/i],
  ['build', /^build\b/i],
];

/** `{ lint, typecheck, test, build }` (only those found) from the fenced Commands block of AGENTS.md text. */
export function projectCommands(agentsText) {
  const found = {};
  let inFence = false;
  for (const line of String(agentsText ?? '').split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    const match = line.match(/^\s*(\S.*?)(?:\s+#\s*(.+?))?\s*$/);
    if (!match || match[1].startsWith('<')) continue;
    const [, command, label = ''] = match;
    const byLabel = COMMAND_LABELS.find(([, pattern]) => pattern.test(label));
    const script = command.match(/^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(lint|type-?check|test|build)\b/i);
    const name = byLabel ? byLabel[0] : script ? script[1].toLowerCase().replace('-', '') : null;
    if (name && !found[name]) found[name] = command;
  }
  return found;
}

const GIT_READ = /^git (?:status|diff|log|show)(?: |$)/;
// A read-only git command can still write or run a program through a flag.
const GIT_WRITING_FLAG = /(?:^|\s)--(?:output|ext-diff|textconv)(?:[=\s]|$)/;
// Anything that chains, redirects, pipes or substitutes: one command per call, nothing hidden inside it.
const SHELL_CONTROL = /[;&|<>`\r\n]|\$[({]/;

export function isReviewer(payload) {
  return Boolean(payload) && typeof payload === 'object' && payload.agent_type === 'reviewer';
}

/** `{ allow, reason }` for one shell command of the reviewer. `commands` is `projectCommands(AGENTS.md text)`. */
export function decideCommand(rawCommand, commands = {}) {
  const command = String(rawCommand ?? '').trim();
  if (!command) return { allow: true, reason: '' };
  const projectList = Object.values(commands);
  const refuse = (why) => ({
    allow: false,
    reason:
      `Blocked for the reviewer (${why}): ${command.length > 80 ? `${command.slice(0, 77)}...` : command}\n` +
      'The reviewer is read-only and runs one command per call: git status, git diff, git log, git show, ' +
      `${projectList.length ? `or a project command (${projectList.join(', ')})` : 'or a project command from the Commands block of AGENTS.md (none found)'}. ` +
      'Run each check as its own call, with no chaining, pipes, redirects or substitution. If a check needs more, say so in the report under "Not checked".',
  });

  if (SHELL_CONTROL.test(command)) return refuse('chaining, a pipe, a redirect or a substitution');
  if (GIT_READ.test(command)) {
    return GIT_WRITING_FLAG.test(command) ? refuse('a git flag that writes or runs a program') : { allow: true, reason: '' };
  }
  if (projectList.some((known) => command === known || command.startsWith(`${known} `))) return { allow: true, reason: '' };
  return refuse('not a git read command or a project command');
}

/** The verdict for a hook payload (JSON text). Anything that is not a reviewer's Bash call, or cannot be read, is allowed. */
export function decideFromPayload(text, commands = {}) {
  let payload;
  try {
    payload = JSON.parse(String(text ?? ''));
  } catch {
    return { allow: true, reason: '' };
  }
  if (!isReviewer(payload) || payload.tool_name !== 'Bash') return { allow: true, reason: '' };
  const command = payload.tool_input?.command;
  if (typeof command !== 'string') return { allow: true, reason: '' };
  return decideCommand(command, commands);
}

/** The project's commands from the first AGENTS.md found in the hook's folder or the project folder; none when there is no file. */
function commandsFor(payloadText) {
  let cwd = process.cwd();
  try {
    const parsed = JSON.parse(payloadText);
    if (typeof parsed?.cwd === 'string' && parsed.cwd) cwd = parsed.cwd;
  } catch {
    // Not JSON: the verdict allows it anyway.
  }
  for (const root of [cwd, process.env.CLAUDE_PROJECT_DIR].filter(Boolean)) {
    try {
      return projectCommands(readFileSync(join(root, 'AGENTS.md'), 'utf8'));
    } catch {
      // No AGENTS.md here: try the next folder.
    }
  }
  return {};
}

function main() {
  let text = '';
  try {
    text = readFileSync(0, 'utf8');
  } catch {
    return 0;
  }
  try {
    const verdict = decideFromPayload(text, commandsFor(text));
    if (verdict.allow) return 0;
    console.error(verdict.reason);
    return 2;
  } catch {
    return 0;
  }
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
  process.exit(main());
}
