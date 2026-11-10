#!/usr/bin/env node
// Review gate: has the content that is about to be pushed been reviewed by the reviewer subagent?
//
// A review leaves a RECORD, a small file `.claude/reviews/<tree>.md` that names the git TREE it reviewed.
// A tree identifies the exact file contents, not the commit, so a review made on the staged changes still
// matches the commit made right after it, and any later edit makes the record stale. Records are local
// evidence (the folder is gitignored); nothing here talks to GitHub.
//
// The mode comes from the workflow profile: control `review.mode` in .claude/workflow.json
// (off = say nothing, advisory = remind, required = block the push; see workflow-config.mjs). Without
// workflow-config.mjs next to this script, or if anything crashes, the check allows the push.
//
// Usage:
//   node check-review-gate.mjs                 check the content of HEAD
//   node check-review-gate.mjs --commit <sha>  check the content of that commit; the pre-push hook runs this for the
//                                              tip of every ref being pushed (only the tip is checked, not each commit)
//   node check-review-gate.mjs --staged        check the staged content (what the next commit will contain)
//   node check-review-gate.mjs record --blocking <number> --summary "<one line>" [--findings-file <path>]
//                                              record a finished review of the staged content
// Environment: REVIEW_MODE=off|advisory|required overrides the profile for one command.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECORDS_FOLDER = join('.claude', 'reviews');

/** The record file for a tree, inside the project. */
export function recordPathFor(root, tree) {
  return join(root, RECORDS_FOLDER, `${tree}.md`);
}

/** The text of a record: three header lines, an optional summary line, then the reviewer's findings. */
export function buildRecordText({ tree, blocking, summary = '', findings = '', now = new Date() }) {
  const header = [`Reviewed-tree: ${tree}`, `Reviewed-at: ${now.toISOString()}`, `Blocking: ${blocking}`];
  // One line only: a newline in the summary could otherwise add a forged header field such as "Blocking: 0".
  if (summary !== '') header.push(`Summary: ${summary.replace(/\s*[\r\n]+\s*/g, ' ')}`);
  return `${header.join('\n')}\n\n${findings.trim()}\n`;
}

/** Reads the header of a record. A header field that is missing or not a number comes back as null. */
export function parseRecord(text) {
  const field = (name) => text.match(new RegExp(`^${name}:[ \\t]*(.+)$`, 'm'))?.[1].trim() ?? null;
  const blockingText = field('Blocking');
  return {
    tree: field('Reviewed-tree'),
    reviewedAt: field('Reviewed-at'),
    blocking: blockingText !== null && /^\d+$/.test(blockingText) ? Number(blockingText) : null,
    summary: field('Summary'),
  };
}

/** The first characters of a tree id, for messages. */
const shortId = (tree) => tree.slice(0, 7);

/**
 * Decides what the gate says. `record` is the parsed record found for the tree, or null.
 * Returns `{ status, message, exitCode }`; only `required` ever gives exit code 1.
 */
export function evaluateGate({ mode, tree, record }) {
  if (mode === 'off') return { status: 'off', message: '', exitCode: 0 };

  const recordCommand = 'node scripts/check-review-gate.mjs record --blocking <number> --summary "<one line>"';
  let problem = null;
  if (record === null || record.tree !== tree) {
    problem = `no review record for this content (tree ${shortId(tree)}). Run the reviewer subagent on the change, resolve its blocking findings, then record it: ${recordCommand}`;
  } else if (record.blocking === null) {
    problem = `the review record for tree ${shortId(tree)} has no valid "Blocking:" count. Record the review again: ${recordCommand}`;
  } else if (record.blocking > 0) {
    problem = `the review record for tree ${shortId(tree)} shows ${record.blocking} unresolved blocking finding(s). Fix them, review again and record it.`;
  }

  if (problem === null) {
    return { status: 'ok', message: `review-gate: ok (tree ${shortId(tree)} reviewed ${record.reviewedAt ?? 'earlier'}, 0 blocking).`, exitCode: 0 };
  }
  if (mode === 'required') {
    return { status: 'blocked', message: `review-gate (required): push blocked, ${problem}\nTo push anyway for this one command: REVIEW_MODE=off git push (a person decides this, not an assistant).`, exitCode: 1 };
  }
  return { status: 'reminder', message: `review-gate (advisory): ${problem}\nPush allowed.`, exitCode: 0 };
}

function git(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** The project root: the top of the git repository containing `startFolder`, or `startFolder` itself outside git. */
export function findProjectRoot(startFolder) {
  try {
    return git(['rev-parse', '--show-toplevel'], startFolder);
  } catch {
    return startFolder;
  }
}

/** The tree id of the staged content (`staged`), of a named commit, or of HEAD. */
export function readTree(root, { staged = false, commit = null } = {}) {
  return staged ? git(['write-tree'], root) : git(['rev-parse', `${commit ?? 'HEAD'}^{tree}`], root);
}

/**
 * The review mode and the profile warnings. If the resolver cannot be loaded the mode is `off` (allow
 * everything). A broken workflow.json makes the resolver use the default profile, so its warnings are
 * returned to be shown: without them an org project would silently drop to advisory.
 */
async function readMode(root) {
  try {
    const { loadWorkflowConfig } = await import('./workflow-config.mjs');
    const resolved = loadWorkflowConfig(root, process.env);
    return { mode: resolved.controls['review.mode'].value, warnings: resolved.warnings };
  } catch {
    return { mode: 'off', warnings: [] };
  }
}

function readRecord(root, tree) {
  const path = recordPathFor(root, tree);
  return existsSync(path) ? parseRecord(readFileSync(path, 'utf8')) : null;
}

function valueOf(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** `record`: writes the record for the staged content. Returns the exit code. */
function runRecord(root, argv) {
  const blockingText = valueOf(argv, '--blocking');
  if (blockingText === undefined || !/^\d+$/.test(blockingText)) {
    console.error('review-gate: record needs --blocking <number of unresolved blocking findings, 0 or more>.');
    return 2;
  }
  const findingsFile = valueOf(argv, '--findings-file');
  const findings = findingsFile ? readFileSync(findingsFile, 'utf8') : '';
  const tree = readTree(root, { staged: true });
  const path = recordPathFor(root, tree);
  mkdirSync(join(root, RECORDS_FOLDER), { recursive: true });
  writeFileSync(path, buildRecordText({ tree, blocking: Number(blockingText), summary: valueOf(argv, '--summary') ?? '', findings }));
  console.log(`review-gate: recorded review of tree ${shortId(tree)} (${blockingText} blocking) in ${path}`);
  return 0;
}

/** The check: prints the message and returns the exit code. Any failure to check allows the push. */
async function runCheck(root, { staged, commit }) {
  try {
    const { mode, warnings } = await readMode(root);
    for (const warning of warnings) console.log(`review-gate: warning: ${warning}`);
    if (mode === 'off') return 0;
    const tree = readTree(root, { staged, commit });
    const result = evaluateGate({ mode, tree, record: readRecord(root, tree) });
    if (result.message !== '') console.log(result.message);
    return result.exitCode;
  } catch (error) {
    console.log(`review-gate: could not check (${String(error.message).split('\n')[0]}); allowing.`);
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
  const argv = process.argv.slice(2);
  const root = findProjectRoot(process.cwd());
  if (argv[0] === 'record') {
    try {
      process.exit(runRecord(root, argv.slice(1)));
    } catch (error) {
      console.error(`review-gate: could not record the review (${String(error.message).split('\n')[0]}).`);
      process.exit(1);
    }
  }
  const staged = argv.includes('--staged');
  const commit = valueOf(argv, '--commit');
  const commitProblem = !argv.includes('--commit')
    ? null
    : commit === undefined || commit.startsWith('-')
      ? '--commit needs a commit id.'
      : staged
        ? '--commit and --staged cannot be used together.'
        : null;
  if (commitProblem) {
    console.error(`review-gate: ${commitProblem}`);
    process.exit(2);
  }
  process.exit(await runCheck(root, { staged, commit }));
}
