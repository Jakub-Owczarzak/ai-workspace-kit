// The record of what `apply` did to a project, so `uninstall` can undo exactly that and nothing else. It lives in the
// kit folder (.claude/workspace-kit/manifest.json) and only ever grows or refreshes across runs of `apply`:
//
//   files        files the kit CREATED, with a fingerprint of the content it wrote. An uninstall deletes such a file
//                only while it still has that content; a file you edited since is yours and is kept.
//   blocks       marked blocks the kit added to a file (instruction files, git hooks, .gitignore), and whether the
//                kit created that file (then it goes too, once nothing but the kit's text was in it).
//   settings     which keys the kit added to .claude/settings.json.
//   packageScript the script the kit added to package.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGET } from './init.mjs';
import { removePackageScriptText } from './project-files.mjs';

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_VERSION = 1;

export const manifestPath = (dir) => join(dir, TARGET, MANIFEST_FILE);

/**
 * A fingerprint of file content. Text is compared with LF line endings, so a Windows checkout that turned LF into
 * CRLF (git autocrlf) does not look like an edit. Binary content (it has a NUL byte) is hashed as it is.
 */
export function fingerprint(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const isText = !buffer.includes(0);
  const normalized = isText ? Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n')) : buffer;
  return createHash('sha256').update(normalized).digest('hex');
}

export const emptyManifest = () => ({ version: MANIFEST_VERSION, files: {}, blocks: [], settings: null, packageScript: null });

export function loadManifest(dir) {
  const path = manifestPath(dir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return { ...emptyManifest(), ...parsed };
  } catch {
    return null;
  }
}

export function saveManifest(dir, manifest) {
  mkdirSync(join(dir, TARGET), { recursive: true });
  // Files and blocks are kept in a fixed order, so turning an option off and on again writes the same manifest.
  const sorted = {
    ...manifest,
    files: Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))),
    blocks: [...manifest.blocks].sort((a, b) => `${a.file}#${a.id}`.localeCompare(`${b.file}#${b.id}`)),
  };
  writeFileSync(manifestPath(dir), JSON.stringify(sorted, null, 2) + '\n');
}

/**
 * Takes the script the kit added out of package.json text. `entry` is manifest.packageScript. While the file is still
 * exactly what the kit wrote (`written`), the text from before the kit touched it (`before`) is put back verbatim, so
 * a compact or tab-indented package.json is not left re-indented. Once somebody edited it, only the kit's script is
 * removed and their edits stay (the key-level removal of removePackageScriptText). A manifest from before these two
 * fields existed takes the second path. Returns { text, status } like removePackageScriptText.
 */
export function removeRecordedPackageScript(text, entry, force = false) {
  if (typeof entry.before === 'string' && entry.written && fingerprint(text) === entry.written) return { text: entry.before, status: 'removed' };
  return removePackageScriptText(text, entry.name, entry.command, entry.createdScripts, force);
}

/** The paths in a manifest use forward slashes on every OS. */
export const posix = (path) => path.split('\\').join('/');

/** Adds a block entry, keeping `createdFile` from the first run (a later run sees the file as already existing). */
export function rememberBlock(manifest, { file, id, style, createdFile }) {
  const key = posix(file);
  const existing = manifest.blocks.find((block) => block.file === key && block.id === id);
  if (existing) return;
  manifest.blocks.push({ file: key, id, style, createdFile: Boolean(createdFile) });
}
