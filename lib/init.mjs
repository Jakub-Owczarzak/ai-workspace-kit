// Copies the kit pieces into <project>/.claude/workspace-kit/. All or nothing: when any kit file already there
// differs from this version (an older copy of the kit, or edits made by hand), NOTHING is written and the
// differing files are listed, so the kit folder is never left half old and half new. `force` replaces them.
// The `.kit-version` file is written last and only when the copy is complete; `apply` refuses without it.
// Kit development tests (*.test.mjs) are never copied.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT_DIRS = ['skills', 'rules', 'templates', 'adapters', 'stacks', 'docs', 'catalog', 'bin', 'lib'];
export const TARGET = join('.claude', 'workspace-kit');
export const VERSION_FILE = '.kit-version';
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const isDevTest = (name) => name.endsWith('.test.mjs');

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (!isDevTest(entry.name)) yield full;
  }
}

/** The version of the kit folder in a project, or null when there is none (or it is incomplete). */
export function installedKitVersion(dir) {
  const file = join(dir, TARGET, VERSION_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

export function init({ dir, dryRun = false, force = false, sourceRoot = PACKAGE_ROOT }) {
  const dest = join(dir, TARGET);
  const result = { created: [], unchanged: [], skipped: [], dest, blocked: false };

  const copies = [];
  for (const kitDir of KIT_DIRS) {
    const from = join(sourceRoot, kitDir);
    if (!existsSync(from)) continue;
    for (const file of walk(from)) {
      const rel = relative(sourceRoot, file);
      const to = join(dest, rel);
      if (!existsSync(to)) {
        copies.push({ file, to });
        result.created.push(rel);
      } else if (readFileSync(file).equals(readFileSync(to))) {
        result.unchanged.push(rel);
      } else if (force) {
        copies.push({ file, to });
        result.created.push(rel);
      } else {
        result.skipped.push(rel);
      }
    }
  }

  // Differing files and no --force: write nothing at all.
  if (result.skipped.length > 0) {
    result.blocked = true;
    result.created = [];
    return result;
  }
  if (dryRun) return result;

  for (const { file, to } of copies) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(file, to);
  }
  const version = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8')).version;
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, VERSION_FILE), version + '\n');
  return result;
}
