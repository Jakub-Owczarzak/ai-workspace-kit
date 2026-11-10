#!/usr/bin/env node
// Doc-size report: how much text Claude Code loads at the start of every session, so the cost of the
// instruction files is visible. It MEASURES and warns; it never blocks and never trims anything.
//
// Always loaded:  CLAUDE.md files, every file they import with `@path`, and the rules in .claude/rules/
//                 that have no `paths:` frontmatter.
// Loaded on demand: rules with `paths:` (only when a matching file is read), reported separately.
// Also counted:   the name and description of every skill (the skill list is part of every session).
//
// The warning threshold is the workflow control `docs.sizeWarnChars` (default 40000 characters; 0 = no
// warning; see workflow-config.mjs). Tokens are estimated as characters / 4, which is only a rough guide.
//
// Usage: node doc-size.mjs [--root <project folder>]     Always exits 0.

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './check-skills.mjs';
import { collectImports, findClaudeFiles } from './check-imports.mjs';

/** A rough token estimate (characters / 4). */
export function approxTokens(chars) {
  return Math.ceil(chars / 4);
}

/** True for a rule file that only loads when matching files are touched (it has `paths:` frontmatter). */
export function isPathScopedRule(text) {
  const { data } = parseFrontmatter(text);
  return Boolean(data && data.paths);
}

function measureText(text) {
  return { chars: text.length, lines: text === '' ? 0 : text.split('\n').length };
}

function listRuleFiles(rulesDir) {
  if (!existsSync(rulesDir)) return [];
  return readdirSync(rulesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(md|mdc)$/i.test(entry.name))
    .map((entry) => join(rulesDir, entry.name))
    .sort();
}

/**
 * Measures a project. Returns `{ alwaysLoaded, onDemand, skills, totalChars }`:
 * `alwaysLoaded` and `onDemand` = lists of `{ path, kind, chars, lines }` (path relative to the root);
 * `skills` = `{ count, chars }` for the names and descriptions in `.claude/skills/*`;
 * `totalChars` = the characters of the always-loaded instruction files (not the skill list).
 */
export function measureProject(root, options = {}) {
  const read = options.read ?? ((path) => readFileSync(path, 'utf8'));
  const alwaysLoaded = [];
  const onDemand = [];
  const shown = (path) => relative(root, path).split('\\').join('/');

  const entries = findClaudeFiles(root);
  const { files } = collectImports(entries, { home: options.home, read });
  const reachedPaths = new Set(files.map((file) => file.path));
  for (const file of files) {
    alwaysLoaded.push({ path: shown(file.path), kind: file.depth === 0 ? 'CLAUDE.md' : 'import', ...measureText(read(file.path)) });
  }

  for (const path of listRuleFiles(join(root, '.claude', 'rules'))) {
    if (reachedPaths.has(path)) continue;
    const text = read(path);
    const target = isPathScopedRule(text) ? onDemand : alwaysLoaded;
    target.push({ path: shown(path), kind: target === onDemand ? 'rule (paths)' : 'rule', ...measureText(text) });
  }

  let skillCount = 0;
  let skillChars = 0;
  const skillsDir = join(root, '.claude', 'skills');
  if (existsSync(skillsDir)) {
    for (const folder of readdirSync(skillsDir).sort()) {
      const skillFile = join(skillsDir, folder, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const { data } = parseFrontmatter(read(skillFile));
      if (!data) continue;
      skillCount += 1;
      skillChars += (data.name ?? folder).length + (data.description ?? '').length;
    }
  }

  const totalChars = alwaysLoaded.reduce((sum, file) => sum + file.chars, 0);
  return { alwaysLoaded, onDemand, skills: { count: skillCount, chars: skillChars }, totalChars };
}

/** Report lines, and whether the always-loaded total is over the threshold (0 = no warning). */
export function formatSizeReport(measure, warnAtChars) {
  const lines = ['Always loaded at the start of every session:'];
  const pad = Math.max(0, ...measure.alwaysLoaded.map((file) => file.path.length));
  for (const file of measure.alwaysLoaded) {
    lines.push(`  ${file.path.padEnd(pad)}  ${String(file.chars).padStart(7)} chars  ${String(file.lines).padStart(5)} lines  (${file.kind})`);
  }
  if (measure.alwaysLoaded.length === 0) lines.push('  (no instruction files found)');
  lines.push(`  total: ${measure.totalChars} characters, about ${approxTokens(measure.totalChars)} tokens`);
  if (measure.onDemand.length > 0) {
    lines.push('Loaded only when matching files are touched:');
    for (const file of measure.onDemand) lines.push(`  ${file.path}  ${file.chars} chars`);
  }
  lines.push(`Skill list (names and descriptions, in every session): ${measure.skills.count} skills, ${measure.skills.chars} characters, about ${approxTokens(measure.skills.chars)} tokens`);
  const over = warnAtChars > 0 && measure.totalChars > warnAtChars;
  if (over) {
    lines.push(
      `warning: the always-loaded instruction files are ${measure.totalChars} characters, over the ${warnAtChars} limit (docs.sizeWarnChars). This only reports; nothing is trimmed. Consider moving long reference sections into files that are read on demand.`,
    );
  }
  return { lines, over };
}

/** The threshold from the workflow profile, or the default when the resolver is not installed. */
async function readThreshold(root) {
  try {
    const { loadWorkflowConfig } = await import('./workflow-config.mjs');
    return loadWorkflowConfig(root).controls['docs.sizeWarnChars'].value;
  } catch {
    return 40000;
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
  const rootIndex = argv.indexOf('--root');
  const root = resolve(rootIndex >= 0 && argv[rootIndex + 1] ? argv[rootIndex + 1] : process.cwd());
  const measure = measureProject(root);
  console.log(formatSizeReport(measure, await readThreshold(root)).lines.join('\n'));
  process.exit(0);
}
