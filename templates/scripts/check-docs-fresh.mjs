#!/usr/bin/env node
// Commit-hook check for the "keep the docs fresh" rule: when source code is part of the commit but the
// overview document (AGENTS.md) is not, say so. It cannot know whether the document NEEDS a change, so
// by default it only warns; strict mode blocks the commit instead.
//
// The mode comes from the workflow profile: control `docs.check` in .claude/workflow.json (solo = warn,
// team = warn, org = strict; see workflow-config.mjs). It needs workflow-config.mjs next to this script;
// without it the mode comes from DOCS_CHECK alone. If the check itself crashes it allows the commit.
//
// Environment:
//   DOCS_CHECK=warn | strict | off   overrides the profile for one command (default without a profile: warn)
//   DOCS_SKIP=1            skip this one commit
//   DOCS_SOURCE_DIRS=src/,app/   comma-separated folders that count as source (default: src/)
//   DOCS_FILES=AGENTS.md         comma-separated documents that count as "docs touched" (default: AGENTS.md)
//
// Merge commits are skipped. Pure functions are exported for the tests.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_SOURCE_DIRS = ['src/'];
const DEFAULT_DOC_FILES = ['AGENTS.md'];

/** True for test files, which never need the overview to change. */
export function isTestFile(path) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/** The mode from the environment value: anything unknown counts as the default, `warn`. */
export function parseMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  return mode === 'strict' || mode === 'off' ? mode : 'warn';
}

/** Splits a comma-separated list, dropping empty parts; falls back to `fallback` when empty. */
export function parseList(value, fallback) {
  const parts = String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

/**
 * Looks at the staged file paths (slash separated, relative to the repository root). The docs look
 * stale when a non-test source file is staged and none of the documents is.
 */
export function docsLookStale(
  stagedFiles,
  { sourceDirs = DEFAULT_SOURCE_DIRS, docFiles = DEFAULT_DOC_FILES } = {},
) {
  const sourceChanged = stagedFiles.filter(
    (file) => sourceDirs.some((directory) => file.startsWith(directory)) && !isTestFile(file),
  );
  if (sourceChanged.length === 0) return { stale: false, sourceChanged };
  const docsTouched = docFiles.some((docFile) => stagedFiles.includes(docFile));
  return { stale: !docsTouched, sourceChanged };
}

/** The text shown to the person committing. */
export function buildMessage({ sourceChanged, docFiles, mode }) {
  const shown = sourceChanged.slice(0, 5).join(', ');
  const more = sourceChanged.length > 5 ? ` and ${sourceChanged.length - 5} more` : '';
  const lines = [
    `docs-fresh: ${sourceChanged.length} source file(s) changed (${shown}${more}) but ${docFiles.join(' / ')} is not part of this commit.`,
    'If the change affects features, state, routes, structure or known quirks, update the overview and bump its "Last updated" line.',
    mode === 'strict'
      ? 'Commit blocked (DOCS_CHECK=strict). Update the document, or run with DOCS_SKIP=1 if nothing in it is affected.'
      : 'Commit allowed (warning only). Set DOCS_CHECK=strict to block, DOCS_SKIP=1 to silence one commit.',
  ];
  return lines.join('\n');
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function isMergeInProgress() {
  try {
    git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * The mode for this commit: from the workflow profile (`.claude/workflow.json`, control `docs.check`, with
 * the DOCS_CHECK environment variable still winning), or, when the resolver file is not next to this
 * script or fails, from DOCS_CHECK alone as before.
 */
async function resolveMode() {
  try {
    const { loadWorkflowConfig } = await import('./workflow-config.mjs');
    const projectRoot = git(['rev-parse', '--show-toplevel']).trim();
    const resolved = loadWorkflowConfig(projectRoot, process.env);
    for (const warning of resolved.warnings) console.error(`workflow: ${warning}`);
    return resolved.controls['docs.check'].value;
  } catch {
    return parseMode(process.env.DOCS_CHECK);
  }
}

async function main() {
  const mode = await resolveMode();
  if (mode === 'off' || process.env.DOCS_SKIP === '1' || isMergeInProgress()) return 0;

  const sourceDirs = parseList(process.env.DOCS_SOURCE_DIRS, DEFAULT_SOURCE_DIRS);
  const docFiles = parseList(process.env.DOCS_FILES, DEFAULT_DOC_FILES);
  // Added, copied, modified, renamed and deleted files: removing code can outdate the docs too.
  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMRD'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const { stale, sourceChanged } = docsLookStale(staged, { sourceDirs, docFiles });
  if (!stale) return 0;

  console.error(buildMessage({ sourceChanged, docFiles, mode }));
  return mode === 'strict' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A broken check must never block a commit: any unexpected error allows it, with a message.
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`docs-fresh: the check could not run (${error.message}); allowing the commit.`);
      process.exit(0);
    },
  );
}
