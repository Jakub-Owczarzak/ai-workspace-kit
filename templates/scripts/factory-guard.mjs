#!/usr/bin/env node
// Factory guard. The checks and counters behind the `factory` skill, kept in a script so they behave the same
// in every session and can be tested without an assistant.
//
//   node scripts/factory-guard.mjs preflight [--json]     Is a factory run allowed here, and what is left to build?
//   node scripts/factory-guard.mjs baseline               Run the project's lint, type check, test and build commands once
//                                                         at the start and record which already fail (.claude/factory/baseline.json)
//   node scripts/factory-guard.mjs fast-check             May the change in the working tree be made without a builder
//                                                         (factory.fastFix docs, documentation files only, 10 lines at most)? 0/1
//   node scripts/factory-guard.mjs plan-excerpt [--bucket <id>]   The Intent Anchor and the pending buckets' plans (or one
//                                                         bucket's), so a run does not read the whole PLAN.md
//   node scripts/factory-guard.mjs handoff-check --bucket <id>   Is .claude/factory/handoff/<id>.md complete and done? 0/1
//   node scripts/factory-guard.mjs attempt --key <layer>  Count one CI fix attempt; exit 0 = fix it, 1 = stop
//   node scripts/factory-guard.mjs push-check --branch <b> [--default-branch <d>]   Exit 1 for a protected branch
//   node scripts/factory-guard.mjs report --reason <text> [--details-file <file>]   Write .claude/factory/report.md
//   node scripts/factory-guard.mjs reset                  Forget the attempt counts
//   node scripts/factory-guard.mjs clean-log [--lines 40] Read a CI log on stdin; print it without color codes, markers
//                                                         and timestamps, last lines only (GitHub and GitLab logs)
//
// Add `--root <dir>` to look at another project. The script reads the profile through workflow-config.mjs
// (`factory.mode`, `factory.prLayout`, `factory.ciFixAttempts`, `factory.host`, `factory.pushConfirm`, `tests.e2e`).
//
// Limits, on purpose: preflight checks that the plan is filled in, not that the user approved it; starting the
// factory by hand is the approval. Nothing here merges, deploys or creates a repository, and nothing throws: a
// command that cannot run is reported as a problem.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkflowConfig } from './workflow-config.mjs';

const FACTORY_DIR = join('.claude', 'factory');

// ---- The plan -------------------------------------------------------------------------------------------------

/**
 * The rows of the "Bucket map" table in PLAN.md: `{ id, name, output, status, pending }`. A row whose name is a
 * `<placeholder>` (the template's example row) is skipped. A bucket is pending until its status starts with "done".
 */
export function parseBucketMap(planText) {
  const lines = String(planText ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Bucket map\s*$/i.test(line.trim()));
  if (start === -1) return [];
  const buckets = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^#{1,6}\s/.test(line)) break;
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const [id, name] = cells;
    if (id === '#' || /^:?-+:?$/.test(id) || name.startsWith('<')) continue;
    const status = cells[cells.length - 1];
    buckets.push({ id, name, output: cells.slice(2, -1).join(' | '), status, pending: !/^done\b/i.test(status) });
  }
  return buckets;
}

/** What is wrong with a plan for a factory run, as readable sentences. An empty list means the plan is usable. */
export function planProblems(planText) {
  const text = String(planText ?? '');
  const problems = [];
  if (!/^##\s+Intent Anchor\s*$/im.test(text)) {
    problems.push('PLAN.md has no Intent Anchor section. Agree one first with the goal-first-planner skill.');
  } else {
    const goal = text.match(/\*\*Goal:\*\*[ \t]*(.*)/);
    const goalText = goal ? goal[1].trim() : '';
    if (!goalText || /^<.*>$/.test(goalText)) problems.push('The Intent Anchor has no goal: it is empty or still a placeholder.');
  }
  const buckets = parseBucketMap(text);
  if (buckets.length === 0) problems.push('PLAN.md has no buckets in its bucket map.');
  else if (!buckets.some((bucket) => bucket.pending)) problems.push('Every bucket is done: there is nothing left to build.');
  return problems;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One sentence for each pending bucket that has no written plan with a "Done when" line. A bucket's plan is a block
 * that starts with `**Bucket <id>: ...**` or a `##`-to-`####` heading `Bucket <id>: ...` and runs to the next such
 * block or `##` heading. The factory never invents acceptance criteria, so a bucket without one is not built.
 */
export function bucketPlanProblems(planText, buckets = parseBucketMap(planText).filter((bucket) => bucket.pending)) {
  const lines = String(planText ?? '').split(/\r?\n/);
  const problems = [];
  for (const bucket of buckets) {
    const block = findBucketBlock(lines, bucket.id);
    const label = `Bucket ${bucket.id} (${bucket.name})`;
    if (!block) {
      problems.push(`${label} has no plan in PLAN.md. Write its goal, steps and "Done when" (and get them approved) before a factory run.`);
    } else if (!/done when/i.test(lines.slice(block.start, block.end).join('\n'))) {
      problems.push(`${label} has a plan in PLAN.md but no "Done when" line. Add the acceptance criteria before a factory run.`);
    }
  }
  return problems;
}

/** The line range `{ start, end }` of one bucket's plan block (end is exclusive), or null when it has none. */
function findBucketBlock(lines, id) {
  const isBlockStart = (line) => /^(?:#{2,4}\s+|\*\*)Bucket\s+\S/i.test(line);
  const header = new RegExp(`^(?:#{2,4}\\s+|\\*\\*)Bucket\\s+${escapeRegExp(id)}(?![\\w])`, 'i');
  const start = lines.findIndex((line) => header.test(line.trim()));
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (isBlockStart(line) || /^##\s/.test(line)) {
      end = index;
      break;
    }
  }
  return { start, end };
}

/** True when the bucket's own plan block has an `E2E: yes` line. No block and no line both mean no. */
export function bucketE2e(planText, id) {
  const lines = String(planText ?? '').split(/\r?\n/);
  const block = findBucketBlock(lines, id);
  return block ? /^\s*-\s*E2E:\s*yes\b/im.test(lines.slice(block.start, block.end).join('\n')) : false;
}

/**
 * The project's end-to-end command from AGENTS.md: a line inside a fenced code block that ends with a comment
 * starting `# e2e` or `# end-to-end`, for example `npx playwright test   # e2e`. An unfilled `<placeholder>` line
 * and prose outside a code block are ignored. Null when there is none.
 */
export function e2eCommand(agentsText) {
  let inFence = false;
  for (const line of String(agentsText ?? '').split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    const match = line.match(/^\s*(\S.*?)\s+#\s*(?:e2e|end-to-end)\b/i);
    if (match && !match[1].startsWith('<')) return match[1];
  }
  return null;
}

const COMMAND_LABELS = [
  ['lint', /^lint\b/i],
  ['typecheck', /^(?:type[ -]?check|types?)\b/i],
  ['test', /^tests?\b/i],
  ['build', /^build\b/i],
];

/**
 * The project's lint, type check, test and build commands from the Commands block of AGENTS.md: lines inside a fenced
 * code block that end with a comment naming the command (`npm run lint   # lint`). Unfilled `<placeholder>` lines are
 * skipped. Returns `{ lint, typecheck, test, build }` with only the ones found.
 */
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
    // The comment names the command (`npm run lint   # lint`); without a helpful comment the script name does
    // (`npm run typecheck`, `npm test`), which is how most projects write the block.
    const byLabel = COMMAND_LABELS.find(([, pattern]) => pattern.test(label));
    const script = command.match(/^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(lint|type-?check|test|build)\b/i);
    const name = byLabel ? byLabel[0] : script ? script[1].toLowerCase().replace('-', '') : null;
    if (name && !found[name]) found[name] = command;
  }
  return found;
}

/**
 * Run the project's commands once, before anything is built, and write what happened to
 * `.claude/factory/baseline.json`: `{ commands: { <name>: { command, exit, tail } } }`. A check that already fails at the
 * start is "pre-existing": it is named in every PR and is not this run's to fix unless the plan says so; a check that
 * passes at the start must pass at the end. `run` is replaceable for tests. Never throws.
 */
export function recordBaseline(root, { run = defaultRun, timeoutMs = 600000 } = {}) {
  let agents = '';
  try {
    agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  } catch {
    // No AGENTS.md: nothing to run.
  }
  const commands = {};
  for (const [name, command] of Object.entries(projectCommands(agents))) {
    const result = run(command, { cwd: root, timeoutMs });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd().split(/\r?\n/).slice(-3).join('\n');
    commands[name] = { command, exit: result.status ?? 1, tail: output.slice(-400) };
  }
  const state = { recordedAt: new Date().toISOString(), commands };
  try {
    mkdirSync(join(root, FACTORY_DIR), { recursive: true });
    writeFileSync(join(root, FACTORY_DIR, 'baseline.json'), `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // Not writable: the result is still printed.
  }
  return state;
}

function defaultRun(command, { cwd, timeoutMs }) {
  return spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * The part of PLAN.md a factory run needs, so the orchestrator does not read the whole file: the Intent Anchor
 * section, then the written plan of each wanted bucket (`only` = one bucket id; otherwise every pending bucket).
 * A bucket with no plan block is named at the end, not skipped silently.
 */
export function planExcerpt(planText, only = null) {
  const lines = String(planText ?? '').split(/\r?\n/);
  const parts = [];
  const anchor = lines.findIndex((line) => /^##\s+Intent Anchor\s*$/i.test(line.trim()));
  if (anchor !== -1 && only === null) {
    let end = lines.length;
    for (let index = anchor + 1; index < lines.length; index += 1) {
      if (/^##\s/.test(lines[index].trim())) {
        end = index;
        break;
      }
    }
    parts.push(lines.slice(anchor, end).join('\n').trimEnd());
  }
  const wanted = only === null ? parseBucketMap(planText).filter((bucket) => bucket.pending) : [{ id: only }];
  const missing = [];
  for (const bucket of wanted) {
    const block = findBucketBlock(lines, bucket.id);
    if (block) parts.push(lines.slice(block.start, block.end).join('\n').trimEnd());
    else missing.push(bucket.id);
  }
  if (missing.length) parts.push(`(no written plan for bucket ${missing.join(', ')})`);
  return parts.join('\n\n');
}

// ---- The handoff file -----------------------------------------------------------------------------------------
// A builder writes `.claude/factory/handoff/<bucket>.md` when it finishes. The orchestrator reads one status line and
// the path; the reviewer and any later builder read the file. It is state for a fresh session too.

/** Where the handoff file of a bucket lives (the id is reduced to safe characters). */
export function handoffPath(root, id) {
  return join(root, FACTORY_DIR, 'handoff', `${String(id).replace(/[^\w.-]+/g, '-')}.md`);
}

/** What is wrong with a handoff text, as sentences; an empty list means it is complete and says `Status: done`. */
export function handoffProblems(text) {
  const body = String(text ?? '');
  const problems = [];
  for (const label of ['Changed', 'Ran', 'Done when']) {
    if (!new RegExp(`^${label}:`, 'm').test(body)) problems.push(`The handoff has no "${label}:" section.`);
  }
  const status = body.match(/^Status:\s*(.*)$/m);
  if (!status) problems.push('The handoff has no "Status:" line.');
  else if (!/^done\b/i.test(status[1].trim())) problems.push(`The handoff says "Status: ${status[1].trim()}", not done.`);
  return problems;
}

// ---- The fast fix ---------------------------------------------------------------------------------------------
// `factory.fastFix: docs` lets the orchestrator make a tiny documentation-only fix itself. The limit is enforced here, not
// left to judgment: only documentation files, and at most FAST_FIX_MAX_LINES changed lines in all.

export const FAST_FIX_MAX_LINES = 10;
const DOC_FILE = /(^|\/)(README|CHANGELOG)[^/]*$|\.(md|markdown)$|^docs\//i;

/**
 * `{ ok, reason }` for a change given as `[{ path, lines }]` (lines = added plus deleted) and the `factory.fastFix` value.
 * The reason always says why, so the caller can show it.
 */
export function fastFixVerdict(files, fastFix) {
  if (fastFix !== 'docs') return { ok: false, reason: `factory.fastFix is ${fastFix}: use a builder and an independent re-review` };
  if (!files.length) return { ok: false, reason: 'there is no change to check' };
  const other = files.filter((file) => !DOC_FILE.test(file.path.replaceAll('\\', '/')));
  if (other.length) return { ok: false, reason: `not documentation only (${other.slice(0, 3).map((file) => file.path).join(', ')}): use a builder` };
  const lines = files.reduce((total, file) => total + file.lines, 0);
  if (lines > FAST_FIX_MAX_LINES) return { ok: false, reason: `${lines} changed lines is more than ${FAST_FIX_MAX_LINES}: use a builder` };
  return { ok: true, reason: `${lines} changed lines in ${files.length} documentation file${files.length === 1 ? '' : 's'}` };
}

/** The files changed against HEAD (staged, unstaged and new files) with their changed-line counts. Never throws. */
export function changedFiles(root, run = realRunner(root)) {
  const ask = (command, args) => {
    try {
      const result = run(command, args);
      return { status: result?.status ?? 1, stdout: String(result?.stdout ?? '') };
    } catch {
      return { status: 1, stdout: '' };
    }
  };
  const counts = new Map();
  for (const line of ask('git', ['diff', 'HEAD', '--numstat']).stdout.split(/\r?\n/).filter(Boolean)) {
    const [added, deleted, ...rest] = line.split('\t');
    const path = rest.join('\t');
    counts.set(path, (Number(added) || 0) + (Number(deleted) || 0) || 1);
  }
  for (const line of ask('git', ['status', '--porcelain']).stdout.split(/\r?\n/).filter(Boolean)) {
    const path = line.slice(3).trim();
    if (counts.has(path) || path.replaceAll('\\', '/').startsWith('.claude/factory/')) continue;
    let size = 1;
    try {
      size = readFileSync(join(root, path), 'utf8').split('\n').length;
    } catch {
      // A folder or an unreadable file: count it as one line, the file-type check still applies.
    }
    counts.set(path, size);
  }
  return [...counts].map(([path, lines]) => ({ path, lines }));
}

// ---- The host and the branch ----------------------------------------------------------------------------------

/**
 * `github`, `gitlab` or null. An explicit `factory.host` wins; in `auto` mode the host is read from the remote URL,
 * and a self-hosted address cannot be told apart, so it needs `factory.host`.
 */
export function detectHost(remoteUrl, control = 'auto') {
  if (control === 'github' || control === 'gitlab') return control;
  const match = String(remoteUrl ?? '').trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/]/i);
  const host = match ? match[1].toLowerCase() : '';
  if (host === 'github.com') return 'github';
  if (host === 'gitlab.com') return 'gitlab';
  return null;
}

/** The lower-case host name of a git remote URL (https or ssh, credentials ignored), or null if it is not one. */
export function remoteHostname(remoteUrl) {
  const match = String(remoteUrl ?? '').trim().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)[:/]/i);
  return match ? match[1].toLowerCase() : null;
}

/** True for main, master, the remote's default branch, and for no branch at all (a detached head is never pushed). */
export function isProtectedBranch(branch, defaultBranch) {
  if (!branch) return true;
  return branch === 'main' || branch === 'master' || (Boolean(defaultBranch) && branch === defaultBranch);
}

// ---- CI logs --------------------------------------------------------------------------------------------------

/**
 * A CI log made readable and short: terminal color codes (raw and in caret form), GitLab section markers, timestamps,
 * GitLab's stream prefix, `gh run view --log-failed`'s job and step columns, `##[group]` lines, blank lines and
 * carriage returns are removed, and only the last `lines` lines are kept (0 or less keeps all). Never throws.
 */
export function cleanCiLog(text, { lines = 40 } = {}) {
  const input = text === undefined || text === null ? '' : String(text);
  const kept = [];
  for (const raw of input.split('\n')) {
    const line = raw
      .replace(/\r/g, '')
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\^\[\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/^[^\t]*\t[^\t]*\t(?=﻿?\d{4}-\d{2}-\d{2}T)/, '')
      .replace(/^﻿/, '')
      .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(?:\d{2}[OE][+ ])?/, '')
      .trim();
    if (!line) continue;
    if (/^section_(?:start|end):\d+:\S+$/.test(line)) continue;
    if (/^##\[(?:group|endgroup)\]/.test(line)) continue;
    kept.push(line);
  }
  return (lines > 0 ? kept.slice(-lines) : kept).join('\n');
}

// ---- CI fix attempts ------------------------------------------------------------------------------------------

/** `fix` while attempts remain, `stop` at the cap. A cap of 0 means "watch and report only", so it always stops. */
export function ciDecision(attemptsUsed, cap) {
  const used = Number(attemptsUsed) || 0;
  const limit = Number(cap) || 0;
  return limit > 0 && used < limit ? 'fix' : 'stop';
}

export function statePath(root) {
  return join(root, FACTORY_DIR, 'state.json');
}

/** The saved counts. A missing or broken file means no attempts used. */
export function readState(root) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(root), 'utf8'));
    const attempts = parsed && typeof parsed.attempts === 'object' && parsed.attempts !== null && !Array.isArray(parsed.attempts) ? parsed.attempts : {};
    return { attempts };
  } catch {
    return { attempts: {} };
  }
}

function writeState(root, state) {
  mkdirSync(join(root, FACTORY_DIR), { recursive: true });
  writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Asks for one more fix attempt on `key` (a branch or layer name). Returns `{ decision, used, cap }`. A `fix` is
 * counted and saved; a `stop` is not counted again, so asking twice at the cap does not change the number.
 */
export function recordAttempt(root, key, cap) {
  const state = readState(root);
  let used = Number(state.attempts[key]) || 0;
  const decision = ciDecision(used, cap);
  if (decision === 'fix') {
    used += 1;
    state.attempts[key] = used;
    writeState(root, state);
  }
  return { decision, used, cap: Number(cap) || 0 };
}

export function resetState(root) {
  rmSync(statePath(root), { force: true });
}

// ---- The stop report ------------------------------------------------------------------------------------------

/** Markdown for the user when the factory stops: why, what was tried, and the last real output. */
export function buildReport({ reason, state = { attempts: {} }, details = '', now = new Date() }) {
  const lines = ['# Factory stopped', '', `Time: ${now.toISOString()}`, `Reason: ${reason}`, ''];
  lines.push('## CI fix attempts used');
  const keys = Object.keys(state.attempts ?? {});
  if (keys.length === 0) lines.push('- none');
  for (const key of keys) lines.push(`- ${key}: ${state.attempts[key]}`);
  if (String(details).trim()) lines.push('', '## Details', '', '```', String(details).trimEnd(), '```');
  lines.push('', 'Nothing was merged or deployed. The branches and commits made so far are still there.', '');
  return lines.join('\n');
}

/** Writes the report to `.claude/factory/report.md` and returns its path. */
export function writeReport(root, { reason, details = '' }) {
  const path = join(root, FACTORY_DIR, 'report.md');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildReport({ reason, state: readState(root), details }));
  return path;
}

// ---- Preflight ------------------------------------------------------------------------------------------------

function realRunner(root) {
  return (command, args) => {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: result.error ? 1 : (result.status ?? 1), stdout: result.stdout ?? '' };
  };
}

/**
 * What the e2e settings mean for this run. A bucket marked `E2E: yes` needs `tests.e2e` on and an e2e command in
 * AGENTS.md; otherwise it is a problem (tests.e2e on) or a note that nothing will run (tests.e2e off).
 */
function checkE2e(root, result) {
  const { problems, notes } = result;
  let agentsText = '';
  try {
    agentsText = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  } catch {
    // No AGENTS.md: there is no e2e command, which is reported below only when it is needed.
  }
  result.e2eCommand = e2eCommand(agentsText);
  const wanted = result.buckets.filter((bucket) => bucket.e2e);
  const names = wanted.map((bucket) => bucket.id).join(', ');
  const subject = `${wanted.length === 1 ? 'Bucket' : 'Buckets'} ${names} ${wanted.length === 1 ? 'is' : 'are'}`;
  if (result.e2e === 'off') {
    if (wanted.length) notes.push(`${subject} marked E2E: yes, but tests.e2e is off, so no e2e tests will run and no screenshots will be taken.`);
  } else if (wanted.length === 0) {
    notes.push(`tests.e2e is ${result.e2e}, but no bucket is marked E2E: yes, so no e2e tests will run.`);
  } else if (!result.e2eCommand) {
    problems.push(`${subject} marked E2E: yes and tests.e2e is ${result.e2e}, but AGENTS.md has no e2e command. Add a line ending "# e2e" to its Commands block (the e2e-tests skill sets this up).`);
  } else {
    notes.push(`E2E will run for ${wanted.length === 1 ? 'bucket' : 'buckets'} ${names} with: ${result.e2eCommand}`);
    if (!existsSync(join(root, 'scripts', 'e2e-shots.mjs'))) {
      notes.push('scripts/e2e-shots.mjs is not installed: screenshots stay local in e2e-out/ and are not added to the pull request.');
    }
  }
}

/**
 * Whether the builder and reviewer subagents are available. They are a Claude Code feature (`.claude/agents/`); when
 * the builder agent file is missing the run is a single-agent run: one agent does the build and the review as
 * separate passes. Under `review.mode` `required` that review is a self-review, so the run stops for the user
 * before any push. A note, never a problem: the preflight cannot tell which tool is running.
 */
function checkAgents(root, result) {
  result.singleAgent = !existsSync(join(root, '.claude', 'agents', 'factory-builder.md'));
  if (!result.singleAgent) return;
  result.notes.push('No .claude/agents/factory-builder.md: if your tool cannot start a separate agent with a fresh context, the factory runs in single-agent mode, with the builder and the reviewer as separate passes by one agent (see "Without subagents" in the run-factory skill).');
  if (result.reviewMode === 'required') {
    result.notes.push('review.mode is required, but without a reviewer subagent the review is a self-review: the factory records it as such and stops for your review or approval before any push.');
  }
}

/**
 * Is a factory run allowed here? Returns `{ ok, problems, notes, mode, host, prLayout, pushConfirm, ciFixAttempts,
 * e2e, branch, defaultBranch, buckets }`, where `buckets` are the ones still to build. `run(command, args)` returns
 * `{ status, stdout }`; tests pass a fake. Never throws.
 */
export function preflight(root, { env = process.env, run } = {}) {
  const runner = run ?? realRunner(root);
  const ask = (command, args) => {
    try {
      const result = runner(command, args);
      return { status: result?.status ?? 1, stdout: String(result?.stdout ?? '') };
    } catch {
      return { status: 1, stdout: '' };
    }
  };

  const resolved = loadWorkflowConfig(root, env);
  const control = (name) => resolved.controls[name].value;
  const result = {
    ok: false,
    problems: [],
    notes: resolved.warnings.map((warning) => `workflow.json: ${warning}`),
    mode: control('factory.mode'),
    host: null,
    prLayout: control('factory.prLayout'),
    pushConfirm: control('factory.pushConfirm'),
    ciFixAttempts: control('factory.ciFixAttempts'),
    e2e: control('tests.e2e'),
    e2eCommand: null,
    reviewMode: control('review.mode'),
    singleAgent: false,
    branch: '',
    defaultBranch: 'main',
    buckets: [],
    resume: null,
  };
  const { problems, notes } = result;
  const finish = () => {
    result.ok = problems.length === 0;
    return result;
  };

  if (result.mode === 'off') {
    problems.push('factory.mode is off. Set it to "local" or "pr" in .claude/workflow.json, or run once with FACTORY_MODE=pr.');
    return finish();
  }

  const planPath = join(root, 'PLAN.md');
  if (!existsSync(planPath)) {
    problems.push('PLAN.md not found. Agree a plan first with the goal-first-planner skill.');
  } else {
    let planText = '';
    try {
      planText = readFileSync(planPath, 'utf8');
    } catch {
      problems.push('PLAN.md could not be read.');
    }
    if (planText) {
      problems.push(...planProblems(planText));
      result.buckets = parseBucketMap(planText)
        .filter((bucket) => bucket.pending)
        .map((bucket) => ({ ...bucket, e2e: bucketE2e(planText, bucket.id) }));
      problems.push(...bucketPlanProblems(planText, result.buckets));
    }
  }

  const inside = ask('git', ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    problems.push('This folder is not inside a git repository.');
    return finish();
  }
  result.branch = ask('git', ['branch', '--show-current']).stdout.trim();
  const defaultBranch = ask('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).stdout.trim().replace(/^origin\//, '');
  if (defaultBranch) result.defaultBranch = defaultBranch;

  const changed = ask('git', ['status', '--porcelain']).stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
  const planChanged = changed.includes('PLAN.md');
  const foreign = changed.filter((path) => path !== 'PLAN.md' && !path.replaceAll('\\', '/').startsWith('.claude/factory/'));
  if (foreign.length) {
    const shown = foreign.slice(0, 5).join(', ') + (foreign.length > 5 ? `, and ${foreign.length - 5} more` : '');
    problems.push(`There are uncommitted changes outside PLAN.md: ${shown}. Commit or stash them first.`);
  }
  if (planChanged) notes.push('PLAN.md has uncommitted changes; they will be committed with the first bucket.');

  if (result.mode === 'pr') {
    const remote = ask('git', ['remote', 'get-url', 'origin']);
    const remoteUrl = remote.stdout.trim();
    if (remote.status !== 0 || !remoteUrl) {
      problems.push('There is no "origin" remote, so there is nowhere to push. Add one, or use factory.mode "local".');
    } else {
      result.host = detectHost(remoteUrl, control('factory.host'));
      if (!result.host) {
        problems.push(`Cannot tell which host "${remoteUrl}" is. Set factory.host to github or gitlab in .claude/workflow.json.`);
      } else if (result.host === 'gitlab') {
        const hostname = remoteHostname(remoteUrl) ?? 'gitlab.com';
        if (ask('glab', ['auth', 'status', '--hostname', hostname]).status !== 0) {
          problems.push(`The glab command is missing or not logged in to ${hostname}. Install the GitLab CLI and run: glab auth login --hostname ${hostname}`);
        } else if (result.prLayout === 'stack') {
          notes.push('GitLab has no stacks: a plan with several buckets will open chained merge requests, each targeting the branch below it.');
        }
      } else {
        if (ask('gh', ['auth', 'status']).status !== 0) {
          problems.push('The gh command is missing or not logged in. Install the GitHub CLI and run: gh auth login');
        } else if (result.prLayout === 'stack' && !/stack/.test(ask('gh', ['extension', 'list']).stdout)) {
          notes.push('gh stack is not installed (gh extension install github/gh-stack): a plan with several buckets will open one PR per bucket, each targeting the branch below it.');
        }
      }
    }
    if (result.pushConfirm === 'ask') notes.push('factory.pushConfirm is ask: the factory stops for your yes before each push.');

    // Every bucket is done but pull requests of an earlier run are open: this is a resume at the CI step, not an error.
    const allDone = problems.some((problem) => problem.startsWith('Every bucket is done'));
    if (allDone && result.host === 'github' && problems.length === 1) {
      const listed = ask('gh', ['pr', 'list', '--state', 'open', '--json', 'number,headRefName,baseRefName', '--limit', '50']);
      let open = [];
      try {
        open = JSON.parse(listed.stdout || '[]').filter((pr) => String(pr.headRefName).startsWith('factory/'));
      } catch {
        open = [];
      }
      if (open.length) {
        problems.length = 0;
        result.resume = { prs: open.map((pr) => ({ number: pr.number, branch: pr.headRefName, base: pr.baseRefName })) };
        notes.push(`Every bucket is built and ${open.length} factory pull request${open.length === 1 ? ' is' : 's are'} open: resume at the CI step (section 3 of the skill), bottom layer first. Nothing is built again.`);
      }
    }
  }

  checkE2e(root, result);
  checkAgents(root, result);
  return finish();
}

// ---- Command line ---------------------------------------------------------------------------------------------

function parseArguments(argv) {
  const options = { command: argv[0], root: process.cwd(), json: false };
  for (let index = 1; index < argv.length; index += 1) {
    const next = argv[index + 1];
    if (argv[index] === '--json') options.json = true;
    else if (argv[index] === '--root' && next) options.root = argv[(index += 1)];
    else if (argv[index] === '--key' && next) options.key = argv[(index += 1)];
    else if (argv[index] === '--reason' && next) options.reason = argv[(index += 1)];
    else if (argv[index] === '--details-file' && next) options.detailsFile = argv[(index += 1)];
    else if (argv[index] === '--branch' && next) options.branch = argv[(index += 1)];
    else if (argv[index] === '--default-branch' && next) options.defaultBranch = argv[(index += 1)];
    else if (argv[index] === '--lines' && next) options.lines = Number(argv[(index += 1)]);
    else if (argv[index] === '--bucket' && next) options.bucket = argv[(index += 1)];
  }
  return options;
}

function explainPreflight(result) {
  const lines = [`factory preflight: ${result.ok ? 'ok' : 'not ready'}`];
  lines.push(`  mode ${result.mode}, layout ${result.prLayout}, host ${result.host ?? 'n/a'}, push ${result.pushConfirm}, CI fix attempts ${result.ciFixAttempts}`);
  if (result.branch) lines.push(`  on branch ${result.branch} (default branch ${result.defaultBranch})`);
  if (result.buckets.length) lines.push(`  to build: ${result.buckets.map((bucket) => `${bucket.id} ${bucket.name}`).join('; ')}`);
  for (const problem of result.problems) lines.push(`problem: ${problem}`);
  for (const note of result.notes) lines.push(`note: ${note}`);
  return lines.join('\n');
}

function main(argv) {
  const options = parseArguments(argv);
  switch (options.command) {
    case 'preflight': {
      const result = preflight(options.root);
      console.log(options.json ? JSON.stringify(result, null, 2) : explainPreflight(result));
      return result.ok ? 0 : 1;
    }
    case 'attempt': {
      if (!options.key) {
        console.error('attempt needs --key <branch or layer name>');
        return 2;
      }
      const cap = loadWorkflowConfig(options.root).controls['factory.ciFixAttempts'].value;
      const outcome = recordAttempt(options.root, options.key, cap);
      console.log(outcome.decision === 'fix' ? `fix: attempt ${outcome.used} of ${outcome.cap}` : `stop: ${outcome.used} of ${outcome.cap} attempts used`);
      return outcome.decision === 'fix' ? 0 : 1;
    }
    case 'push-check': {
      const defaultBranch = options.defaultBranch ?? 'main';
      if (isProtectedBranch(options.branch ?? '', defaultBranch)) {
        console.log(`refused: "${options.branch ?? ''}" is protected. Push a factory branch and open a pull request.`);
        return 1;
      }
      console.log(`ok: ${options.branch} may be pushed`);
      return 0;
    }
    case 'report': {
      if (!options.reason) {
        console.error('report needs --reason <text>');
        return 2;
      }
      let details = '';
      if (options.detailsFile) {
        try {
          details = readFileSync(options.detailsFile, 'utf8');
        } catch {
          details = `(could not read ${options.detailsFile})`;
        }
      }
      console.log(writeReport(options.root, { reason: options.reason, details }));
      return 0;
    }
    case 'fast-check': {
      const fastFix = loadWorkflowConfig(options.root).controls['factory.fastFix'].value;
      const verdict = fastFixVerdict(changedFiles(options.root), fastFix);
      console.log(`${verdict.ok ? 'ok' : 'refused'}: ${verdict.reason}`);
      return verdict.ok ? 0 : 1;
    }
    case 'baseline': {
      const state = recordBaseline(options.root);
      const names = Object.keys(state.commands);
      if (names.length === 0) console.log('baseline: no lint, type check, test or build command found in AGENTS.md');
      for (const name of names) {
        const entry = state.commands[name];
        console.log(`${name}: ${entry.exit === 0 ? 'passes' : `FAILS (exit ${entry.exit})`} at the start  [${entry.command}]`);
      }
      return 0;
    }
    case 'plan-excerpt': {
      let plan = '';
      try {
        plan = readFileSync(join(options.root, 'PLAN.md'), 'utf8');
      } catch {
        console.error('cannot read PLAN.md');
        return 1;
      }
      console.log(planExcerpt(plan, options.bucket ?? null));
      return 0;
    }
    case 'handoff-check': {
      if (!options.bucket) {
        console.error('handoff-check needs --bucket <id>');
        return 2;
      }
      const path = handoffPath(options.root, options.bucket);
      let text;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        console.log(`missing: no handoff file for bucket ${options.bucket} (expected ${path})`);
        return 1;
      }
      const problems = handoffProblems(text);
      if (problems.length) {
        for (const problem of problems) console.log(`problem: ${problem}`);
        return 1;
      }
      console.log(`ok: handoff for bucket ${options.bucket} is complete (${path})`);
      return 0;
    }
    case 'reset':
      resetState(options.root);
      console.log('attempt counts cleared');
      return 0;
    case 'clean-log': {
      let input = '';
      try {
        input = readFileSync(0, 'utf8');
      } catch {
        // No standard input: an empty log.
      }
      const lines = Number.isFinite(options.lines) ? options.lines : 40;
      console.log(cleanCiLog(input, { lines }));
      return 0;
    }
    default:
      console.error('usage: factory-guard.mjs preflight | baseline | fast-check | plan-excerpt [--bucket <id>] | handoff-check --bucket <id> | attempt --key <name> | push-check --branch <name> | report --reason <text> | reset | clean-log [--lines <n>] < log  [--root <dir>]');
      return 2;
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
  process.exit(main(process.argv.slice(2)));
}
