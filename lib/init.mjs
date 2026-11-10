// Copies the kit pieces into <project>/.claude/workspace-kit/. Idempotent; never overwrites a
// file that differs unless force is set. Kit development tests (*.test.mjs) are never copied.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT_DIRS = ['skills', 'rules', 'templates', 'adapters', 'stacks', 'docs'];
export const TARGET = join('.claude', 'workspace-kit');
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const isDevTest = (name) => name.endsWith('.test.mjs');

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (!isDevTest(entry.name)) yield full;
  }
}

export function init({ dir, dryRun = false, force = false, sourceRoot = PACKAGE_ROOT }) {
  const dest = join(dir, TARGET);
  const result = { created: [], unchanged: [], skipped: [], dest };

  for (const kitDir of KIT_DIRS) {
    const from = join(sourceRoot, kitDir);
    if (!existsSync(from)) continue;
    for (const file of walk(from)) {
      const rel = relative(sourceRoot, file);
      const to = join(dest, rel);
      if (existsSync(to)) {
        const same = readFileSync(file).equals(readFileSync(to));
        if (same) result.unchanged.push(rel);
        else if (force) {
          if (!dryRun) copyFileSync(file, to);
          result.created.push(rel);
        } else result.skipped.push(rel);
        continue;
      }
      if (!dryRun) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(file, to);
      }
      result.created.push(rel);
    }
  }

  const version = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8')).version;
  const versionFile = join(dest, '.kit-version');
  if (!dryRun && (force || !existsSync(versionFile))) {
    mkdirSync(dest, { recursive: true });
    writeFileSync(versionFile, version + '\n');
  }
  return result;
}
