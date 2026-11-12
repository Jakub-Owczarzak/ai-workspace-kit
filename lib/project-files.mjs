// Small, careful edits to project files the kit does not own: .gitignore, package.json, and the release
// workflow (a NEW file, never an edit to an existing one).
import { upsertBlock } from './blocks.mjs';

/** `.gitignore` lines inside one marked block. Text returned, not written. */
export function gitignoreWithKit(existingText, lines) {
  return upsertBlock(existingText ?? '', 'gitignore', lines.join('\n'), 'hash');
}

/**
 * Adds scripts.<name> to package.json text only when it is absent. Never replaces a script the user has.
 * Returns { text, status } with status added, unchanged (already the same), exists (different, left alone),
 * or no-scripts (no package.json scripts section to add to).
 */
export function packageScriptText(packageJsonText, name, command) {
  let parsed;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return { text: packageJsonText, status: 'no-scripts' };
  }
  if (!parsed || typeof parsed !== 'object') return { text: packageJsonText, status: 'no-scripts' };
  const current = parsed.scripts?.[name];
  if (current === command) return { text: packageJsonText, status: 'unchanged' };
  if (current !== undefined) return { text: packageJsonText, status: 'exists' };
  const createdScripts = parsed.scripts === undefined;
  parsed.scripts = { ...(parsed.scripts ?? {}), [name]: command };
  const indent = packageJsonText.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? 2;
  const eol = packageJsonText.endsWith('\n') ? '\n' : '';
  return { text: JSON.stringify(parsed, null, indent) + eol, status: 'added', createdScripts };
}

/**
 * The reverse of packageScriptText. Removes scripts.<name> only while it still equals `command` (a script you
 * changed since is yours), and the whole `scripts` section only if the kit created it and it is now empty.
 * Returns { text, status } with status removed, absent (nothing to remove) or changed (left alone). With `force` (the
 * uninstall's --purge) a changed script is removed too.
 */
export function removePackageScriptText(packageJsonText, name, command, createdScripts = false, force = false) {
  let parsed;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return { text: packageJsonText, status: 'unreadable' };
  }
  const current = parsed?.scripts?.[name];
  if (current === undefined) return { text: packageJsonText, status: 'absent' };
  if (current !== command && !force) return { text: packageJsonText, status: 'changed' };
  delete parsed.scripts[name];
  if (createdScripts && Object.keys(parsed.scripts).length === 0) delete parsed.scripts;
  const indent = packageJsonText.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? 2;
  const eol = packageJsonText.endsWith('\n') ? '\n' : '';
  return { text: JSON.stringify(parsed, null, indent) + eol, status: 'removed' };
}

const PLACEHOLDER = /<[A-Z][A-Z ]+>/g;

/**
 * Fills the release workflow template. `versionFiles` are `file:key` strings. Returns { text } or
 * { missing } listing the placeholders the project facts could not fill (the file is then not written).
 */
export function releaseWorkflowText(template, { protectedBranch, changelogScript, versionFiles }) {
  if (!protectedBranch || !changelogScript || !versionFiles?.length) {
    const missing = [];
    if (!protectedBranch) missing.push('protectedBranch');
    if (!versionFiles?.length) missing.push('versionFiles');
    return { missing };
  }
  const versionFlags = versionFiles.map((file) => `--version-file ${file}`).join(' \\\n            ');
  const versionNames = versionFiles.map((file) => file.split(':')[0]).join(' ');
  let text = template
    .replace(/^\s*#[^\n]*<PROJECT DIR>[^\n]*\n/gm, '')
    .replace(/^\s*# One --version-file per file[^\n]*\n/gm, '')
    .replace('--version-file <FILE>:<KEY>', versionFlags)
    .replace('<VERSION FILES>', versionNames)
    .replace('<SKILLS DIR>/changelog-bump/scripts/changelog.mjs', changelogScript)
    .replaceAll('<PROTECTED BRANCH>', protectedBranch);
  const left = [...new Set(text.match(PLACEHOLDER) ?? [])];
  if (left.length) return { missing: left };
  return { text };
}
