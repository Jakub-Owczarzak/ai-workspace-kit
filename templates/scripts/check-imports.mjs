#!/usr/bin/env node
// `@` import resolver. Claude Code loads the files a CLAUDE.md pulls in with `@path/to/file.md`
// (paths are relative to the file that contains the import; `~/` is the home folder; imports inside
// code spans and fenced code blocks are ignored; imported files may import others, up to 5 levels).
// A broken import fails silently at session start, so this check makes it loud: every `@path` that looks
// like a file import must exist. It proves the files are THERE, not that Claude loaded them: for that,
// run `/memory` in Claude Code, or the optional runner (run-claude-checks.mjs).
//
// Usage: node check-imports.mjs [--root <project folder>]     Exit 1 when an import is missing.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCode } from './check-skills.mjs';

const IMPORT_EXTENSIONS = /\.(md|markdown|mdc|txt|json|ya?ml)$/i;
export const MAX_IMPORT_DEPTH = 5;

/** True for something that is an import and not text like `@claude`, `@types/node` or an email. */
function looksLikeFileImport(reference) {
  return /^(\.{1,2}\/|~\/)/.test(reference) || IMPORT_EXTENSIONS.test(reference);
}

/** The `@path` imports in a markdown text, in order, without duplicates, ignoring code. */
export function findImports(text) {
  const references = [];
  const pattern = /(?:^|[\s(])@([^\s)\]}>,;"'`]+)/gm;
  for (const match of stripCode(text).matchAll(pattern)) {
    const reference = match[1].replace(/[.,:;!?]+$/, '');
    if (looksLikeFileImport(reference) && !references.includes(reference)) references.push(reference);
  }
  return references;
}

/** The absolute path an import points to, from the file that contains it. */
export function resolveImport(fromFile, reference, home = homedir()) {
  if (reference.startsWith('~/')) return join(home, reference.slice(2));
  if (isAbsolute(reference)) return reference;
  return resolve(dirname(fromFile), reference);
}

/** The CLAUDE.md files Claude Code reads at the project root. */
export function findClaudeFiles(root, exists = existsSync) {
  return [join(root, 'CLAUDE.md'), join(root, '.claude', 'CLAUDE.md'), join(root, 'CLAUDE.local.md')].filter(exists);
}

/**
 * Follows imports from the entry files. Returns `{ files, missing, tooDeep }`:
 * `files` = every file reached, `{ path, depth, importedBy }` (entries have depth 0 and importedBy null);
 * `missing` = imports whose file does not exist, `{ reference, from, resolved }`;
 * `tooDeep` = imports left unfollowed because they are deeper than the limit.
 */
export function collectImports(entryFiles, options = {}) {
  const { home = homedir(), maxDepth = MAX_IMPORT_DEPTH, exists = existsSync, read = (path) => readFileSync(path, 'utf8') } = options;
  const files = [];
  const missing = [];
  const tooDeep = [];
  const seen = new Set();

  function visit(path, depth, importedBy) {
    if (seen.has(path)) return;
    seen.add(path);
    files.push({ path, depth, importedBy });
    let text;
    try {
      text = read(path);
    } catch {
      return;
    }
    for (const reference of findImports(text)) {
      const resolved = resolveImport(path, reference, home);
      if (!exists(resolved)) {
        missing.push({ reference, from: path, resolved });
      } else if (depth + 1 > maxDepth) {
        tooDeep.push({ reference, from: path, resolved });
      } else {
        visit(resolved, depth + 1, path);
      }
    }
  }

  for (const entry of entryFiles) visit(entry, 0, null);
  return { files, missing, tooDeep };
}

/** Checks a project folder: finds its CLAUDE.md files and follows their imports. */
export function checkImports(root, options = {}) {
  const entries = findClaudeFiles(root, options.exists);
  const collected = collectImports(entries, options);
  return { root, entries, ...collected, errors: collected.missing.length };
}

/** Readable report lines for a `checkImports` result. */
export function formatImportsReport(report) {
  const lines = [];
  if (report.entries.length === 0) {
    lines.push('No CLAUDE.md found: nothing to check.');
    return lines;
  }
  for (const file of report.files) {
    lines.push(`${'  '.repeat(file.depth)}${file.depth === 0 ? '' : '@ '}${file.path.replace(report.root, '.')}`);
  }
  for (const item of report.missing) {
    lines.push(`ERROR import not found: @${item.reference} (in ${item.from.replace(report.root, '.')}) [missing-import]`);
  }
  for (const item of report.tooDeep) {
    lines.push(`warn  import not followed, deeper than ${MAX_IMPORT_DEPTH} levels: @${item.reference} [too-deep]`);
  }
  lines.push(`${report.files.length} files reached from ${report.entries.length} CLAUDE.md file(s): ${report.errors} missing imports. Files found, not proof that Claude loaded them (run /memory).`);
  return lines;
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
  const rootIndex = argv.indexOf('--root');
  const root = resolve(rootIndex >= 0 && argv[rootIndex + 1] ? argv[rootIndex + 1] : process.cwd());
  const report = checkImports(root);
  console.log(formatImportsReport(report).join('\n'));
  process.exit(report.errors > 0 ? 1 : 0);
}
