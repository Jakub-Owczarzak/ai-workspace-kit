// Turns installed options on and off after the first install (`config on` / `config off`).
//
// The approach is reconciliation, not bookkeeping per option: the manifest says what the kit put in the project, a dry
// run of `apply` with the new choices says what a project with those choices keeps, and whatever the manifest holds
// beyond that is removed. Shared files fall out of this by themselves (a file goes only when no remaining option wants
// it) and it works on installs made before this existed. The same rules as `uninstall` protect your work: a file is
// removed only while it still has the content the kit wrote, a marked block is cut out of a file you own, and a file
// the kit created goes only when nothing of yours is left in it.
//
// What this covers: kit files, the rules block, the .gitignore block, the git hook blocks (a hook whose content only
// changes is refreshed by the real apply), the Claude Code settings keys the kit added, and the check:config script. A
// settings file that is not strict JSON refuses the whole change, with nothing touched, because the kit cannot edit it
// without losing comments and a hook there would point at a script that is about to go.
import { existsSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { apply, expandRequires } from './apply.mjs';
import { hasBlock, removeBlock } from './blocks.mjs';
import { TARGET } from './init.mjs';
import { fingerprint, loadManifest, posix, removeRecordedPackageScript, saveManifest } from './manifest.mjs';
import { removeKitSettingsText } from './settings.mjs';

/** Blocks this step knows how to remove. A hook block whose content only changes is refreshed by the real apply. */
const REMOVABLE_BLOCKS = ['rules', 'agents-import', 'gitignore', 'ignore', 'pre-commit', 'pre-push'];
/** The keys the kit adds to .claude/settings.json, as recorded in the manifest. */
const SETTING_FLAGS = ['defaultMode', 'guardHook', 'reviewerGuard'];

const blockKey = (block) => `${block.file}#${block.id}`;

/** A script that imports the profile resolver (statically or with import()). */
const READS_RESOLVER = /(?:from\s*|import\s*\(\s*)['"]\.\/workflow-config\.mjs['"]/;

/** True when nothing of the user's is left in a file once the kit's block is gone (a hook keeps only its shebang). */
function isEffectivelyEmpty(text, style) {
  let rest = text.replace(/\r\n/g, '\n');
  if (style === 'hash') rest = rest.replace(/^#!.*\n?/, '');
  return rest.trim() === '';
}

const pathsOf = (report) => new Set([...report.created, ...report.updated, ...report.unchanged, ...report.skipped.map((item) => item.path)].map(posix));

/**
 * Turns options on and off. Returns the plan: what was (or, with `dryRun`, would be) turned on and off, removed, kept
 * and added. Throws, changing nothing, when an id is unknown or a control, when another enabled option needs one that
 * is being turned off (unless `cascade`), or when the change would also alter a git hook or a settings key.
 */
export function setOptions({ dir, on = [], off = [], cascade = false, prune = false, dryRun = false }) {
  const kitDir = join(dir, TARGET);
  const catalogPath = join(kitDir, 'catalog', 'options.json');
  if (!existsSync(catalogPath)) throw new Error(`no kit folder found at ${kitDir}; run "ai-workspace-kit init" and the setup first`);
  const { options } = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const byId = new Map(options.map((option) => [option.id, option]));

  let record;
  try {
    record = JSON.parse(readFileSync(join(kitDir, 'choices.json'), 'utf8'));
  } catch {
    throw new Error(`there is no choices.json record in ${kitDir}, so there is nothing to change yet: run the setup first`);
  }
  const manifest = loadManifest(dir);
  if (!manifest) throw new Error(`there is no manifest.json in ${kitDir}, so what was installed is not recorded; nothing was changed`);

  for (const id of [...on, ...off]) {
    const option = byId.get(id);
    if (!option) throw new Error(`unknown option "${id}". Run "config list" to see the ids`);
    if (option.kind === 'control') throw new Error(`"${id}" is a control (a value, not a switch): use "config set" for it`);
  }
  const both = on.filter((id) => off.includes(id));
  if (both.length) throw new Error(`${both.join(', ')} cannot be turned on and off in the same change`);

  const current = new Set(record.enabled ?? []);
  const turnedOn = on.filter((id) => !current.has(id));
  const turnedOff = off.filter((id) => current.has(id));

  // Whatever needs an option that is being turned off: refused, or turned off with it.
  const removing = new Set(turnedOff);
  const cascaded = [];
  const needers = new Map();
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of current) {
      if (removing.has(id)) continue;
      const needed = (byId.get(id)?.requires ?? []).filter((required) => removing.has(required));
      if (!needed.length) continue;
      needers.set(id, needed);
      removing.add(id);
      cascaded.push(id);
      grew = true;
    }
  }
  if (cascaded.length && !cascade) {
    const lines = cascaded.map((id) => `${id} (needs ${needers.get(id).join(', ')})`);
    throw new Error(`cannot turn off ${turnedOff.join(', ')}: needed by ${lines.join('; ')}. Turn those off as well with --cascade`);
  }

  // Kept in catalog order, so the rules block reads the same however the options were switched before.
  const order = new Map(options.map((option, index) => [option.id, index]));

  // What nothing that stays on needs any more: the options the removed ones required, directly or not. They stay on
  // (the user may use them for something else) unless `prune` turns them off too.
  const unneeded = [];
  if (removing.size) {
    const candidates = new Set();
    const queue = [...removing];
    while (queue.length) {
      for (const required of byId.get(queue.pop())?.requires ?? []) {
        if (current.has(required) && !removing.has(required) && !candidates.has(required)) {
          candidates.add(required);
          queue.push(required);
        }
      }
    }
    // A candidate that something staying needs stays; and then so does everything that candidate needs.
    for (let changed = true; changed; ) {
      changed = false;
      for (const id of [...candidates]) {
        const stays = [...current].some((other) => other !== id && !removing.has(other) && !candidates.has(other) && (byId.get(other)?.requires ?? []).includes(id));
        if (stays) {
          candidates.delete(id);
          changed = true;
        }
      }
    }
    unneeded.push(...[...candidates].sort((a, b) => order.get(a) - order.get(b)));
  }
  const pruned = prune ? unneeded : [];
  for (const id of pruned) removing.add(id);

  const next = new Set([...current].filter((id) => !removing.has(id)));
  for (const id of turnedOn) next.add(id);
  const expanded = expandRequires(options, [...next]);
  const enabled = expanded.enabled.sort((a, b) => order.get(a) - order.get(b));
  const added = expanded.added;
  const plan = {
    changed: turnedOn.length > 0 || removing.size > 0,
    dryRun,
    turnedOn,
    turnedOff,
    cascaded,
    unneeded: prune ? [] : unneeded,
    pruned,
    addedRequirements: added,
    removedFiles: [],
    keptFiles: [],
    removedBlocks: [],
    removedSettings: null,
    packageScript: false,
    removedDirs: [],
    manual: [],
    warnings: [],
    apply: null,
  };
  if (!plan.changed) return plan;

  const choices = { profile: record.profile, tools: record.tools, enabled, overrides: record.overrides ?? {}, project: record.project ?? {} };
  const wanted = apply({ dir, choices, dryRun: true, noteReEnabled: false });

  // Settings keys the kit added that no remaining option wants. Worked out before anything is touched: a settings file
  // that cannot be edited safely refuses the whole change, instead of leaving a hook that points at a deleted script.
  const owned = manifest.settings;
  const dropped = Object.fromEntries(SETTING_FLAGS.map((flag) => [flag, Boolean(owned?.[flag]) && !wanted.wanted.settings[flag]]));
  const settingsDropped = Object.values(dropped).some(Boolean);
  let settingsChange = null;
  if (owned && settingsDropped && existsSync(join(dir, owned.file))) {
    const result = removeKitSettingsText(readFileSync(join(dir, owned.file), 'utf8'), dropped);
    if (result.error) throw new Error(`cannot change ${owned.file}: ${result.error}. Nothing was changed`);
    settingsChange = { result, fileDeleted: Boolean(owned.createdFile && result.removed.length && result.empty) };
  }

  const wantedFiles = pathsOf(wanted);
  const wantedBlocks = new Set(wanted.wanted.blocks.map(blockKey));
  const deleted = new Set();

  // 0. The settings keys, before the scripts they point at.
  if (owned && settingsDropped) {
    const abs = join(dir, owned.file);
    const removed = settingsChange?.result.removed ?? [];
    if (removed.length) {
      plan.removedSettings = { file: owned.file, removed, fileDeleted: settingsChange.fileDeleted };
      if (settingsChange.fileDeleted) {
        deleted.add(abs);
        if (!dryRun) unlinkSync(abs);
      } else if (!dryRun) writeFileSync(abs, settingsChange.result.text);
    }
    if (dropped.defaultMode && settingsChange && !removed.includes('permissions.defaultMode')) {
      plan.keptFiles.push({ path: owned.file, reason: 'permissions.defaultMode was changed since the kit added it, so it is yours now' });
    }
    for (const flag of SETTING_FLAGS) if (dropped[flag]) owned[flag] = false;
    if (!SETTING_FLAGS.some((flag) => owned[flag])) manifest.settings = null;
  }

  // 1. Files the kit created that no remaining option wants: removed while they are still what the kit wrote.
  for (const [rel, hash] of Object.entries(manifest.files)) {
    if (wantedFiles.has(rel)) continue;
    const abs = join(dir, rel);
    if (!existsSync(abs)) {
      delete manifest.files[rel];
      continue;
    }
    if (fingerprint(readFileSync(abs)) !== hash) {
      // Kept, and still tracked: an uninstall then deals with it by its own rules (an edited wk- skill file goes, any
      // other edited file is listed as kept) instead of never hearing about it.
      plan.keptFiles.push({ path: rel, reason: 'you changed it since the kit wrote it, so it is yours now' });
      continue;
    }
    delete manifest.files[rel];
    plan.removedFiles.push(rel);
    deleted.add(abs);
    if (!dryRun) unlinkSync(abs);
  }

  // Several kit scripts read the profile through workflow-config.mjs and carry on without it (the review gate then allows
  // every push). The catalog does not tie those scripts to the file, so say it when the file goes.
  if (plan.removedFiles.some((path) => /(^|\/)workflow-config\.mjs$/.test(path))) {
    const readers = [...wantedFiles].filter((path) => /^scripts\/[^/]+\.mjs$/.test(path) && existsSync(join(dir, path)) && READS_RESOLVER.test(readFileSync(join(dir, path), 'utf8')));
    if (readers.length) {
      plan.warnings.push(
        `${readers.join(', ')} read${readers.length === 1 ? 's' : ''} the profile through scripts/workflow-config.mjs, which was removed. Without it the script does nothing ` +
          '(a check that depends on it allows everything). Turn check.static back on, or keep a copy of workflow-config.mjs, if you rely on it'
      );
    }
  }

  // 2. Marked blocks nobody wants any more, cut out of the files you own.
  const byFile = new Map();
  for (const block of manifest.blocks) {
    if (!REMOVABLE_BLOCKS.includes(block.id) || wantedBlocks.has(blockKey(block))) continue;
    byFile.set(block.file, [...(byFile.get(block.file) ?? []), block]);
  }
  for (const [rel, blocks] of byFile) {
    const abs = join(dir, rel);
    const ids = [];
    if (existsSync(abs)) {
      let text = readFileSync(abs, 'utf8');
      for (const block of blocks) {
        try {
          if (!hasBlock(text, block.id, block.style)) continue;
          text = removeBlock(text, block.id, block.style);
          ids.push(block.id);
        } catch (error) {
          plan.manual.push({ path: rel, reason: error.message });
        }
      }
      if (ids.length) {
        const fileDeleted = blocks.some((block) => block.createdFile) && isEffectivelyEmpty(text, blocks[0].style);
        plan.removedBlocks.push({ file: rel, ids, fileDeleted });
        if (fileDeleted) {
          deleted.add(abs);
          if (!dryRun) unlinkSync(abs);
        } else if (!dryRun) writeFileSync(abs, text);
      }
    }
    manifest.blocks = manifest.blocks.filter((block) => !(block.file === rel && blocks.includes(block)));
  }

  // 3. The check:config script, once no remaining option wants it.
  if (manifest.packageScript && !wanted.wanted.packageScript) {
    const abs = join(dir, 'package.json');
    const { name } = manifest.packageScript;
    if (existsSync(abs)) {
      const result = removeRecordedPackageScript(readFileSync(abs, 'utf8'), manifest.packageScript);
      if (result.status === 'removed') {
        plan.packageScript = true;
        if (!dryRun) writeFileSync(abs, result.text);
      } else if (result.status === 'changed') {
        plan.keptFiles.push({ path: 'package.json', reason: `the "${name}" script was changed since the kit added it, so it is yours now` });
      }
    }
    manifest.packageScript = null;
  }

  // 4. Folders the removal left empty (never inside .git, never the kit folder).
  const kitAbs = join(dir, TARGET);
  const candidates = new Set();
  for (const abs of deleted) {
    for (let folder = dirname(abs); folder !== dir && !relative(dir, folder).startsWith('..'); folder = dirname(folder)) candidates.add(folder);
  }
  const gone = new Set(deleted);
  for (const folder of [...candidates].sort((a, b) => b.length - a.length)) {
    if (folder === kitAbs || folder.startsWith(kitAbs) || relative(dir, folder).split(/[\\/]/)[0] === '.git' || !existsSync(folder)) continue;
    if (readdirSync(folder).every((name) => gone.has(join(folder, name)))) {
      gone.add(folder);
      plan.removedDirs.push(posix(relative(dir, folder)));
      if (!dryRun) rmdirSync(folder);
    }
  }

  if (dryRun) {
    plan.apply = wanted;
    return plan;
  }
  saveManifest(dir, manifest);
  plan.apply = apply({ dir, choices, dryRun: false, noteReEnabled: false });
  return plan;
}

/** The options left on that nothing needs any more, without the controls (a control owns no files, so it is not worth a line). */
export const shownUnneeded = (plan) => (plan?.unneeded ?? []).filter((id) => !id.startsWith('control.'));

/** The plan as text for the terminal. */
export function formatPlan(plan) {
  if (!plan.changed) return 'Nothing to change: the options are already in that state.';
  const would = plan.dryRun;
  const lines = [would ? '[dry run] nothing was changed. This is what would happen:' : 'Done.'];
  if (plan.turnedOff.length) lines.push(`${would ? 'Would turn off' : 'Turned off'}: ${plan.turnedOff.join(', ')}`);
  if (plan.cascaded.length) lines.push(`${would ? 'Would also turn off' : 'Also turned off'} (they need it): ${plan.cascaded.join(', ')}`);
  if (plan.pruned?.length) lines.push(`${would ? 'Would also turn off' : 'Also turned off'} (nothing that is on needed them any more): ${plan.pruned.join(', ')}`);
  if (plan.turnedOn.length) lines.push(`${would ? 'Would turn on' : 'Turned on'}: ${plan.turnedOn.join(', ')}`);
  if (plan.addedRequirements.length) lines.push(`${would ? 'Would add' : 'Added'} because they are needed: ${plan.addedRequirements.join(', ')}`);
  if (plan.removedFiles.length) {
    lines.push(`${would ? 'Would remove' : 'Removed'} ${plan.removedFiles.length} file(s):`, ...plan.removedFiles.map((path) => `  ${path}`));
  }
  for (const block of plan.removedBlocks) {
    lines.push(`${would ? 'Would cut' : 'Cut'} block ${block.ids.join(', ')} from ${block.file}${block.fileDeleted ? ' (the kit created this file, so it goes too)' : ''}`);
  }
  if (plan.removedSettings) {
    const { file, removed, fileDeleted } = plan.removedSettings;
    lines.push(`${would ? 'Would remove' : 'Removed'} from ${file}: ${removed.join(', ')}${fileDeleted ? ' (the kit created this file, so it goes too)' : ''}`);
  }
  if (plan.packageScript) lines.push(`${would ? 'Would remove' : 'Removed'} the check:config script from package.json`);
  for (const folder of plan.removedDirs) lines.push(`${would ? 'Would remove' : 'Removed'} empty folder ${folder}`);
  for (const item of plan.keptFiles) lines.push(`KEPT    ${item.path}: ${item.reason}`);
  for (const warning of plan.warnings) lines.push(`WARNING ${warning}`);
  const left = shownUnneeded(plan);
  if (left.length) {
    lines.push(`NOTE    Still on, although nothing that is on needs them now: ${left.join(', ')}. Turn them off with: config off ${left.join(' ')} --cascade (or add --prune to the command that turned the other one off).`);
  }
  for (const item of plan.manual) lines.push(`MANUAL  ${item.path}: ${item.reason}`);
  const installed = plan.apply ? [...plan.apply.created, ...plan.apply.updated] : [];
  if (installed.length) lines.push(`${would ? 'Would install or update' : 'Installed or updated'} ${installed.length} file(s)`);
  for (const item of plan.apply?.skipped ?? []) lines.push(`SKIPPED ${posix(item.path)}: ${item.reason}`);
  // Notes and manual steps belong to what was turned on; for a plain "off" they would only repeat the install's.
  if (plan.turnedOn.length) {
    for (const note of plan.apply?.notices ?? []) lines.push(`NOTE    ${note}`);
    for (const item of plan.apply?.manual ?? []) lines.push(`MANUAL  ${item.path}: ${item.reason}`);
  }
  return lines.join('\n');
}
