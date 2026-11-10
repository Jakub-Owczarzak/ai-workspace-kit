// Removes what `apply` installed, using the manifest it wrote (see manifest.mjs). Nothing is guessed:
//   * a file the kit created is deleted only while it still has the content the kit wrote; a file you edited is kept,
//   * a marked block is cut out of the file you own (and the file is deleted only if the kit created it and nothing
//     else is left in it),
//   * the settings keys and the package.json script the kit added are removed, yours are left,
//   * folders the removal leaves empty are removed (never anything inside .git).
// Without `yes` nothing is changed: the result is a preview of exactly what would happen.
import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { hasBlock, removeBlock } from './blocks.mjs';
import { TARGET } from './init.mjs';
import { emptyManifest, fingerprint, loadManifest, saveManifest } from './manifest.mjs';
import { removePackageScriptText } from './project-files.mjs';
import { removeKitSettingsText } from './settings.mjs';

const KIT_HTML_BLOCK = /<!-- workspace-kit:start [^>]*-->[\s\S]*?<!-- workspace-kit:end [^>]*-->\n?/g;

/** True when nothing of the user's is left in a file once the kit's block is gone (a hook keeps only its shebang). */
function isEffectivelyEmpty(text, style) {
  let rest = text.replace(/\r\n/g, '\n');
  if (style === 'hash') rest = rest.replace(/^#!.*\n?/, '');
  return rest.trim() === '';
}

const insideGit = (dir, abs) => relative(dir, abs).split(/[\\/]/)[0] === '.git';

export function uninstall({ dir, yes = false, keepKit = false }) {
  const kitDir = join(dir, TARGET);
  const report = {
    applied: yes,
    nothingToDo: false,
    removedFiles: [],
    keptFiles: [],
    blocks: [],
    settings: null,
    packageScript: null,
    removedDirs: [],
    kitFolder: 'absent',
    notices: [],
    manual: [],
  };

  if (!existsSync(kitDir)) {
    report.nothingToDo = true;
    return report;
  }
  let manifest = loadManifest(dir);
  // Only `init` was run (no `apply` yet): nothing but the kit folder was ever written, so there is nothing to track.
  if (!manifest && !existsSync(join(kitDir, 'choices.json'))) manifest = emptyManifest();
  if (!manifest) {
    throw new Error(
      `${TARGET.split('\\').join('/')} has no manifest.json, so there is no record of what was installed (it was installed ` +
        'by a version without one, or not through "apply"). Nothing was changed. Remove the wk-* skill folders and the ' +
        'text between the workspace-kit:start and workspace-kit:end markers by hand (README, "Undo").'
    );
  }

  const deleted = new Set(); // absolute paths of files that are removed (or would be)

  // 1. Files the kit created: removed only while they are still exactly what the kit wrote.
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const abs = join(dir, rel);
    if (!existsSync(abs)) continue;
    if (fingerprint(readFileSync(abs)) !== hash) {
      report.keptFiles.push({ path: rel, reason: 'you changed it since the kit wrote it, so it is yours now' });
      continue;
    }
    report.removedFiles.push(rel);
    deleted.add(abs);
    if (yes) unlinkSync(abs);
  }

  // 2. Marked blocks: cut out of the files you own.
  const byFile = new Map();
  for (const block of manifest.blocks) byFile.set(block.file, [...(byFile.get(block.file) ?? []), block]);
  for (const [rel, blocks] of byFile) {
    const abs = join(dir, rel);
    if (!existsSync(abs)) continue;
    let text = readFileSync(abs, 'utf8');
    const ids = [];
    for (const block of blocks) {
      try {
        if (!hasBlock(text, block.id, block.style)) continue;
        text = removeBlock(text, block.id, block.style);
        ids.push(block.id);
      } catch (error) {
        report.manual.push({ path: rel, reason: error.message });
      }
    }
    if (ids.length === 0) continue;
    const fileDeleted = blocks.some((block) => block.createdFile) && isEffectivelyEmpty(text, blocks[0].style);
    report.blocks.push({ file: rel, ids, fileDeleted });
    if (fileDeleted) {
      deleted.add(abs);
      if (yes) unlinkSync(abs);
    } else if (yes) writeFileSync(abs, text);
  }

  // 3. The keys the kit added to .claude/settings.json.
  if (manifest.settings) {
    const abs = join(dir, manifest.settings.file);
    if (existsSync(abs)) {
      const result = removeKitSettingsText(readFileSync(abs, 'utf8'), manifest.settings);
      if (result.error) report.manual.push({ path: manifest.settings.file, reason: result.error });
      else if (result.removed.length) {
        const fileDeleted = Boolean(manifest.settings.createdFile && result.empty);
        report.settings = { file: manifest.settings.file, removed: result.removed, fileDeleted };
        if (fileDeleted) {
          deleted.add(abs);
          if (yes) unlinkSync(abs);
        } else if (yes) writeFileSync(abs, result.text);
      }
    }
  }

  // 4. The package.json script the kit added.
  if (manifest.packageScript) {
    const abs = join(dir, 'package.json');
    if (existsSync(abs)) {
      const { name, command, createdScripts } = manifest.packageScript;
      const result = removePackageScriptText(readFileSync(abs, 'utf8'), name, command, createdScripts);
      if (result.status === 'removed') {
        report.packageScript = { name };
        if (yes) writeFileSync(abs, result.text);
      } else if (result.status === 'changed') {
        report.keptFiles.push({ path: 'package.json', reason: `the "${name}" script was changed since the kit added it, so it is yours now` });
      }
    }
  }

  // 5. The kit folder goes as a whole (first, so that a folder that only held it, like .claude, can be found empty),
  // then the folders the removal leaves empty. Never inside .git.
  const removingKit = !keepKit;
  if (yes && removingKit) rmSync(kitDir, { recursive: true, force: true });
  const removedDirs = new Set();
  const candidates = new Set();
  const addAncestors = (abs) => {
    for (let current = dirname(abs); current !== dir && relative(dir, current) && !relative(dir, current).startsWith('..'); current = dirname(current)) {
      if (!insideGit(dir, current)) candidates.add(current);
    }
  };
  for (const abs of deleted) addAncestors(abs);
  if (removingKit) addAncestors(kitDir + '/x');
  const wouldBeGone = (abs) => deleted.has(abs) || removedDirs.has(abs) || (removingKit && (abs === kitDir || abs.startsWith(kitDir)));
  for (const candidate of [...candidates].sort((a, b) => b.length - a.length)) {
    if (candidate === kitDir || candidate.startsWith(kitDir)) continue;
    if (!existsSync(candidate)) continue;
    const remaining = readdirSync(candidate).filter((name) => !wouldBeGone(join(candidate, name)));
    if (remaining.length === 0) {
      removedDirs.add(candidate);
      report.removedDirs.push(relative(dir, candidate).split('\\').join('/'));
      if (yes) rmdirSync(candidate);
    }
  }

  // 6. Things the kit does not track, and what to look at by hand.
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    const abs = join(dir, file);
    if (!existsSync(abs) || deleted.has(abs)) continue;
    const outsideBlocks = readFileSync(abs, 'utf8').replace(KIT_HTML_BLOCK, '');
    if (outsideBlocks.includes(`@${TARGET.split('\\').join('/')}/`)) {
      report.notices.push(`${file} still imports files from the kit folder (@${TARGET.split('\\').join('/')}/...); remove those lines, or they point at nothing.`);
    }
  }
  for (const leftover of ['.claude/reviews', '.claude/state']) {
    if (existsSync(join(dir, leftover))) {
      report.notices.push(`${leftover}/ was created while the kit's checks ran (review records or fix-mode state). It is not removed; delete it if you do not need it.`);
    }
  }

  // 7. What happened to the kit folder.
  if (removingKit) report.kitFolder = yes ? 'removed' : 'would be removed';
  else {
    report.kitFolder = 'kept';
    if (yes) saveManifest(dir, emptyManifest()); // what was installed is gone, so the record starts again
  }
  return report;
}
