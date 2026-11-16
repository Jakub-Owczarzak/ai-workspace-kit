// Removes what `apply` installed, using the manifest it wrote (see manifest.mjs). Nothing is guessed:
//   * a file the kit created is deleted only while it still has the content the kit wrote; a file you edited is kept,
//   * a marked block is cut out of the file you own (and the file is deleted only if the kit created it and nothing
//     else is left in it),
//   * the settings keys and the package.json script the kit added are removed, yours are left,
//   * folders the removal leaves empty are removed (never anything inside .git).
//   * a skill folder named wk-* is the kit's own namespace: its files are removed even when the setup filled them in,
// With `purge` the files the kit created are removed even when you changed them, an instruction file the kit created
// goes whole, and the kit's data folders (.claude/reviews, .claude/state, .claude/factory) go too. Without it, what is
// kept is listed in a ready-to-paste prompt for an AI tool (docs/uninstall-prompt.md), because the kit folder and the
// record of what it installed are gone once the uninstall has finished.
// Without `yes` nothing is changed: the result is a preview of exactly what would happen.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { hasBlock, removeBlock } from './blocks.mjs';
import { TARGET } from './init.mjs';
import { emptyManifest, fingerprint, loadManifest, removeRecordedPackageScript, saveManifest } from './manifest.mjs';
import { removeKitSettingsText } from './settings.mjs';

const KIT_HTML_BLOCK = /<!-- workspace-kit:start [^>]*-->[\s\S]*?<!-- workspace-kit:end [^>]*-->\n?/g;

/** True when nothing of the user's is left in a file once the kit's block is gone (a hook keeps only its shebang). */
function isEffectivelyEmpty(text, style) {
  let rest = text.replace(/\r\n/g, '\n');
  if (style === 'hash') rest = rest.replace(/^#!.*\n?/, '');
  return rest.trim() === '';
}

const insideGit = (dir, abs) => relative(dir, abs).split(/[\\/]/)[0] === '.git';

/** A file in a skill folder named wk-*: the kit's namespace (setup fills project facts into some of these skills). */
const KIT_SKILL_FILE = /(^|\/)skills\/wk-[^/]+\//;

/** Folders the kit's own scripts create while they run. Not part of the project; removed by --purge. */
const DATA_FOLDERS = [
  { path: '.claude/reviews', what: "review records written while the kit's checks ran" },
  { path: '.claude/state', what: 'fix-mode state of the test-edit guard' },
  { path: '.claude/factory', what: 'factory run state, hand-off notes and pull request texts' },
];

/** True only when git has the file's current content, so a deletion can be undone with `git restore`. */
function recoverableFromGit(dir, rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', rel], { cwd: dir, stdio: 'ignore' });
    return true;
  } catch {
    return false; // not a repository, never committed, or changed since the last commit
  }
}

const FALLBACK_PROMPT =
  'The workspace kit was uninstalled from this project. These items were created by the kit and later changed, so the ' +
  'uninstall kept them:\n\n{{LEFTOVERS}}\n\nGo through them one at a time: show me what is in each, ask whether to delete it, ' +
  'keep it, or remove only the kit text, and wait for my answer. Touch only the items on this list, change nothing else and do not commit.';

/** The prompt text in docs/uninstall-prompt.md (its first ```text block), read before the kit folder is removed. */
function promptTemplate(kitDir) {
  try {
    const doc = readFileSync(join(kitDir, 'docs', 'uninstall-prompt.md'), 'utf8').replace(/\r\n/g, '\n');
    const block = doc.match(/```text\n([\s\S]*?)\n```/)?.[1];
    if (block?.includes('{{LEFTOVERS}}')) return block;
  } catch {
    // an older kit folder has no such file: use the built-in wording
  }
  return FALLBACK_PROMPT;
}

export function uninstall({ dir, yes = false, keepKit = false, purge = false }) {
  const kitDir = join(dir, TARGET);
  const report = {
    applied: yes,
    purge,
    nothingToDo: false,
    removedFiles: [],
    removedEdited: [], // wk- skill files removed although they had changed
    keptFiles: [],
    purged: [], // with --purge: what you had changed and is removed anyway, and whether git can bring it back
    purgedDirs: [],
    blocks: [],
    settings: null,
    packageScript: null,
    removedDirs: [],
    kitFolder: 'absent',
    cleanupPrompt: null,
    notices: [],
    manual: [],
  };

  if (!existsSync(kitDir)) {
    report.nothingToDo = true;
    return report;
  }
  const template = promptTemplate(kitDir); // before the kit folder goes
  let manifest = loadManifest(dir);
  // Only `init` was run (no `apply` yet): nothing but the kit folder was ever written, so there is nothing to track.
  if (!manifest && !existsSync(join(kitDir, 'choices.json'))) manifest = emptyManifest();
  if (!manifest) {
    throw new Error(
      `${TARGET.split('\\').join('/')} has no manifest.json, so there is no record of what was installed (it was installed ` +
        'by a version without one, or not through "apply"). Nothing was changed. Remove the wk-* skill folders and the ' +
        'text between the workspace-kit:start and workspace-kit:end markers by hand (docs/install-and-update.md, "Uninstall").'
    );
  }

  const deleted = new Set(); // absolute paths of files that are removed (or would be)

  // 1. Files the kit created: removed only while they are still exactly what the kit wrote.
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const abs = join(dir, rel);
    if (!existsSync(abs)) continue;
    if (fingerprint(readFileSync(abs)) !== hash) {
      if (KIT_SKILL_FILE.test(rel)) {
        report.removedEdited.push({ path: rel, reason: 'a wk- skill belongs to the kit; it was filled in or edited since the install' });
      } else if (purge) {
        report.purged.push({ path: rel, recoverable: recoverableFromGit(dir, rel) });
      } else {
        report.keptFiles.push({ path: rel, reason: 'you changed it since the kit wrote it, so it is yours now' });
        continue;
      }
    }
    report.removedFiles.push(rel);
    deleted.add(abs);
    if (yes) unlinkSync(abs);
  }

  // 2. Marked blocks: cut out of the files you own.
  const keptCreatedFiles = []; // files the kit created that stay because they now hold text of yours
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
    const kitCreated = blocks.some((block) => block.createdFile);
    const onlyKitText = isEffectivelyEmpty(text, blocks[0].style);
    const fileDeleted = kitCreated && (onlyKitText || purge);
    if (fileDeleted && !onlyKitText) report.purged.push({ path: rel, recoverable: recoverableFromGit(dir, rel) });
    if (kitCreated && !fileDeleted) keptCreatedFiles.push(rel);
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
        const fileDeleted = Boolean(manifest.settings.createdFile && (result.empty || purge));
        if (fileDeleted && !result.empty) report.purged.push({ path: manifest.settings.file, recoverable: recoverableFromGit(dir, manifest.settings.file) });
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
      const { name } = manifest.packageScript;
      const text = readFileSync(abs, 'utf8');
      const result = removeRecordedPackageScript(text, manifest.packageScript, purge);
      if (result.status === 'removed') {
        report.packageScript = { name };
        if (purge && removeRecordedPackageScript(text, manifest.packageScript).status === 'changed') {
          report.purged.push({ path: 'package.json', recoverable: recoverableFromGit(dir, 'package.json') });
        }
        if (yes) writeFileSync(abs, result.text);
      } else if (result.status === 'changed') {
        report.keptFiles.push({ path: 'package.json', reason: `the "${name}" script was changed since the kit added it, so it is yours now` });
      }
    }
  }

  // 4b. With --purge, the folders the kit's own scripts create while they run.
  if (purge) {
    for (const { path } of DATA_FOLDERS) {
      const abs = join(dir, path);
      if (!existsSync(abs)) continue;
      report.purgedDirs.push(path);
      deleted.add(abs);
      if (yes) rmSync(abs, { recursive: true, force: true });
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
  const leftovers = [];
  for (const { path, what } of DATA_FOLDERS) {
    if (!purge && existsSync(join(dir, path))) {
      report.notices.push(`${path}/ holds ${what}. It is not removed; delete it if you do not need it, or use --purge.`);
      leftovers.push(`- ${path}/ (${what})`);
    }
  }
  // What a normal uninstall kept, for the cleanup prompt (with --purge nothing is kept on purpose).
  for (const item of report.keptFiles) {
    leftovers.unshift(
      item.path === 'package.json'
        ? `- package.json: the "${manifest.packageScript?.name}" script (you changed it since the kit added it)`
        : `- ${item.path} (created by the kit, changed since)`
    );
  }
  for (const rel of keptCreatedFiles) {
    leftovers.unshift(`- ${rel} (the kit created this file; its kit block is removed, the rest was added later)`);
  }
  if (!purge && leftovers.length > 0) report.cleanupPrompt = template.replace('{{LEFTOVERS}}', leftovers.join('\n'));

  // 7. What happened to the kit folder.
  if (removingKit) report.kitFolder = yes ? 'removed' : 'would be removed';
  else {
    report.kitFolder = 'kept';
    if (yes) saveManifest(dir, emptyManifest()); // what was installed is gone, so the record starts again
  }
  return report;
}
