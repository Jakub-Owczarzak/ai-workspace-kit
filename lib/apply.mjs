// Applies the user's answers (a choices object) to a project. Every write is one of three kinds:
//   * a NEW file or folder (skipped, never replaced, when something different is already there),
//   * a marked block inside a file the user owns (instruction files, git hooks, .gitignore), see blocks.mjs,
//   * a careful key-level merge (.claude/settings.json, one package.json script) that adds and never replaces,
// or nothing at all: anything that cannot be done safely is reported as "manual" with the reason.
// Kit skills are installed as wk-<name>. Running twice changes nothing. Nothing outside the project folder
// is touched, and nothing is downloaded.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { removeBlock, upsertBlock } from './blocks.mjs';
import { buildPreCommitBody, buildPrePushBody, installHookBlock, userHookText } from './hooks.mjs';
import { emptyManifest, fingerprint, loadManifest, posix, rememberBlock, saveManifest } from './manifest.mjs';
import { gitignoreWithKit, packageScriptText, releaseWorkflowText } from './project-files.mjs';
import { SKILL_PREFIX, isRewritableText, rewriteSkillNames } from './rename.mjs';
import { mergeSettingsText } from './settings.mjs';
import { TARGET, installedKitVersion } from './init.mjs';
import { targetsFor } from './tools.mjs';

/** LF line endings, so text from a Windows checkout (CRLF) is written as the same bytes as anywhere else. */
const toLf = (text) => text.replace(/\r\n/g, '\n');

/** Written into the rules block for every tool other than Claude Code; see "Rules" in apply(). */
const TRANSLATION_RULE = 'adapters/tool-translation.md';

const ROOT_TEMPLATES = {
  'templates/PLAN.md': 'PLAN.md',
  'templates/BACKLOG.md': 'BACKLOG.md',
  'templates/CHANGELOG.md': 'CHANGELOG.md',
  'templates/FIGMA-SYNC.md': 'FIGMA-SYNC.md',
  'templates/REVIEW.md': 'REVIEW.md',
};

/** Where a kit file goes in the project, or why this step leaves it to someone else. */
function projectTargetFor(kitPath, toolIds) {
  if (kitPath.startsWith('templates/scripts/')) return { path: join('scripts', basename(kitPath)) };
  // Once these exist they are the project's own data (its plan, its changelog); they are created, never replaced.
  if (ROOT_TEMPLATES[kitPath]) return { path: ROOT_TEMPLATES[kitPath], userOwned: true };
  if (/^templates\/agents\/[^/]+\.md$/.test(kitPath)) {
    const agent = basename(kitPath, '.md');
    return toolIds.includes('claude-code')
      ? { path: join('.claude', 'agents', `${agent}.md`) }
      : { manual: `the ${agent} subagent is a Claude Code feature; without it the assistant does that work itself as a separate pass (the wk-run-factory skill describes this under "Without subagents")` };
  }
  // These are written by dedicated steps below (hooks, release workflow, profile).
  if (kitPath === 'templates/workflow.json') return { handled: true };
  if (kitPath.startsWith('templates/hooks/') || kitPath.startsWith('templates/workflows/')) return { handled: true };
  if (kitPath === 'templates/AGENTS.md') return { manual: 'AGENTS.md does not exist yet: write it from the code with the wk-write-project-overview skill', onlyIfMissing: 'AGENTS.md' };
  if (kitPath === 'templates/CLAUDE.md') return { handled: true }; // the rules block creates or extends CLAUDE.md or AGENTS.md
  return { manual: 'applied by the setup prompt' };
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    // Kit development tests are never installed, even if an older kit copy left some in the kit folder.
    else if (!entry.name.endsWith('.test.mjs')) yield full;
  }
}

/** Adds the options that the chosen ones need, and reports which were added. */
export function expandRequires(options, enabledIds) {
  const byId = new Map(options.map((option) => [option.id, option]));
  const wanted = new Set(enabledIds);
  const added = [];
  const queue = [...wanted];
  while (queue.length) {
    const option = byId.get(queue.pop());
    for (const requiredId of option?.requires ?? []) {
      if (byId.has(requiredId) && !wanted.has(requiredId)) {
        wanted.add(requiredId);
        added.push(requiredId);
        queue.push(requiredId);
      }
    }
  }
  return { enabled: [...wanted], added };
}

export function apply({ dir, choices, dryRun = false, force = false }) {
  const kitDir = join(dir, TARGET);
  const catalogPath = join(kitDir, 'catalog', 'options.json');
  if (!existsSync(catalogPath) || installedKitVersion(dir) === null) {
    throw new Error(
      `the kit folder ${kitDir} is missing or incomplete (an older copy, or an interrupted install); ` +
        'run "ai-workspace-kit init" first, with --force if it lists files that differ'
    );
  }
  const { options, profiles } = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const optionsById = new Map(options.map((option) => [option.id, option]));

  const profile = choices.profile ?? 'solo';
  if (!profiles.some((entry) => entry.id === profile)) throw new Error(`unknown profile "${profile}"`);
  const toolIds = choices.tools?.length ? choices.tools : ['claude-code'];
  const { skillsDirs, rulesFile, claudeImportsAgents } = targetsFor(toolIds);
  const unknownIds = (choices.enabled ?? []).filter((id) => !optionsById.has(id));
  if (unknownIds.length) throw new Error(`unknown option id(s): ${unknownIds.join(', ')}`);

  const { enabled, added } = expandRequires(options, choices.enabled ?? []);
  const has = (id) => enabled.includes(id);
  const enabledOptions = enabled.map((id) => optionsById.get(id));
  const skillNames = options.filter((o) => o.kind === 'skill' && o.installAs).map((o) => o.source.split('/')[1]);
  const rewrite = (text) => rewriteSkillNames(text, skillNames);
  /** Text read from the kit, with LF line endings, so a Windows checkout (CRLF) writes the same bytes as any other. */
  const readKitText = (...parts) => toLf(readFileSync(join(kitDir, ...parts), 'utf8'));
  const project = choices.project ?? {};

  const report = { created: [], updated: [], unchanged: [], skipped: [], manual: [], notices: [], warnings: [], addedRequirements: added };

  // The record of what this run (and earlier runs) did, for `uninstall`. Saved after every recorded action, so a run
  // that fails halfway still leaves an accurate record.
  const manifest = loadManifest(dir) ?? emptyManifest();
  const persist = () => {
    if (!dryRun) saveManifest(dir, manifest);
  };

  /**
   * Writes a new file. An existing file that differs is left alone. `--force` replaces only files the kit owns
   * (installed skills, scripts); a file that becomes the project's own data once it exists (PLAN.md, CHANGELOG.md,
   * REVIEW.md, workflow.json, the release workflow) is `userOwned` and is never replaced, force or not.
   * A file the kit CREATES is recorded with a fingerprint of what it wrote; a file that was already there is not.
   */
  const writeNew = (relativePath, content, { userOwned = false, note } = {}) => {
    const target = join(dir, relativePath);
    const existedBefore = existsSync(target);
    if (existedBefore) {
      if (readFileSync(target).equals(content)) return report.unchanged.push(relativePath);
      if (userOwned) return report.skipped.push({ path: relativePath, reason: note ?? 'already exists; yours is kept' });
      if (!force) {
        return report.skipped.push({
          path: relativePath,
          reason: "differs from the kit's version (an older copy, or your edits); --force replaces it",
        });
      }
      report.updated.push(relativePath);
    } else report.created.push(relativePath);
    if (!dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      const key = posix(relativePath);
      // Recorded when the kit created the file, or refreshed one it already owns (an upgrade with --force).
      if (!existedBefore || manifest.files[key] !== undefined) {
        manifest.files[key] = fingerprint(content);
        persist();
      }
    }
  };

  /**
   * Edits a text file the user may own. `transform(before | null)` returns the new text, or null to leave it.
   * `block` ({ id, style }) says the edit is a marked block, which is recorded so an uninstall can remove it.
   */
  const editText = (relativePath, transform, block) => {
    const target = join(dir, relativePath);
    const existed = existsSync(target);
    const before = existed ? readFileSync(target, 'utf8') : null;
    const after = transform(before);
    if (after === null) return;
    if (existed && after === before) return report.unchanged.push(relativePath);
    (existed ? report.updated : report.created).push(relativePath);
    if (!dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, after);
      if (block) {
        rememberBlock(manifest, { file: relativePath, id: block.id, style: block.style, createdFile: !existed });
        persist();
      }
    }
  };

  const copyFromKit = (kitRelative, projectRelative, options) => {
    const from = join(kitDir, kitRelative);
    const raw = readFileSync(from);
    const content = isRewritableText(basename(from)) ? Buffer.from(rewrite(toLf(raw.toString('utf8')))) : raw;
    writeNew(projectRelative, content, options);
  };

  const recordHook = (result, name) => {
    if (result.status === 'manual') report.manual.push({ path: result.path, reason: result.reason, snippet: result.snippet });
    else report[result.status === 'created' ? 'created' : result.status === 'updated' ? 'updated' : 'unchanged'].push(result.path);
    // A hook block the kit wrote is recorded, and whether the kit created the hook file itself.
    if (!dryRun && result.file && (result.status === 'created' || result.status === 'updated')) {
      rememberBlock(manifest, { file: result.file, id: name, style: 'hash', createdFile: result.status === 'created' });
      persist();
    }
  };

  // 1. Skills, namespaced, into every folder the chosen tools read.
  const besideExisting = [];
  for (const option of enabledOptions.filter((o) => o.kind === 'skill' && o.installAs)) {
    for (const skillsDir of skillsDirs) {
      const plainName = option.source.split('/')[1];
      if (existsSync(join(dir, skillsDir, plainName, 'SKILL.md'))) besideExisting.push(`${skillsDir}/${plainName}`);
      for (const file of walk(join(kitDir, option.source))) {
        const inside = file.slice(join(kitDir, option.source).length + 1);
        copyFromKit(join(option.source, inside), join(skillsDir, option.installAs, inside));
      }
    }
  }
  if (besideExisting.length) {
    report.notices.push(
      `These skills already exist under their plain names: ${besideExisting.join(', ')}. The kit's wk- copies are ` +
        'installed beside them, so the assistant sees both. Delete the old ones if they came from an earlier kit ' +
        'install; keep them if they are your own.'
    );
  }

  // 2. Rules: one marked block in one file. Claude Code imports AGENTS.md when other tools need it.
  // Rules the project's instruction file already imports from the kit folder (`@.claude/workspace-kit/rules/x.md`,
  // what older installs did) are not written a second time.
  const instructionText = existsSync(join(dir, rulesFile))
    ? removeBlock(readFileSync(join(dir, rulesFile), 'utf8'), 'rules')
    : '';
  const alreadyImported = (option) => instructionText.includes(`@${TARGET.split('\\').join('/')}/${option.source}`);
  const ruleOptions = enabledOptions.filter((o) => o.kind === 'rule' && !alreadyImported(o));
  const imported = enabledOptions.filter((o) => o.kind === 'rule' && alreadyImported(o));
  if (imported.length) {
    report.notices.push(
      `${rulesFile} already imports these rules from the kit folder, so they are not repeated in the kit's rules ` +
        `block: ${imported.map((o) => o.source).join(', ')}.`
    );
  }
  // Skills are written with Claude Code features in mind. Whenever another tool is chosen, the translation rule goes
  // into the same block, with no question asked, so the skills work there out of the box. It is a rule, not a choice:
  // a skill with no translation is the case this exists to avoid.
  const needsTranslation = toolIds.some((id) => id !== 'claude-code');
  const translationRule = needsTranslation && existsSync(join(kitDir, TRANSLATION_RULE)) ? [TRANSLATION_RULE] : [];
  if (ruleOptions.length || translationRule.length) {
    const sources = [...ruleOptions.map((o) => o.source), ...translationRule];
    const body = sources.map((source) => rewrite(readKitText(source)).trim()).join('\n\n');
    editText(rulesFile, (before) => upsertBlock(before ?? '', 'rules', body), { id: 'rules', style: 'html' });
    if (claudeImportsAgents) {
      editText(
        'CLAUDE.md',
        (before) => {
          const userText = removeBlock(before ?? '', 'agents-import');
          if (/^@AGENTS\.md\s*$/m.test(userText)) return before;
          return upsertBlock(before ?? '', 'agents-import', '@AGENTS.md');
        },
        { id: 'agents-import', style: 'html' }
      );
    }
  }

  // 3. The workflow profile. An existing file is never rewritten.
  if (enabledOptions.some((o) => o.id === 'check.static' || o.kind === 'control') || choices.profile) {
    const profilePath = join('.claude', 'workflow.json');
    let note;
    try {
      const current = JSON.parse(readFileSync(join(dir, profilePath), 'utf8')).profile;
      if (current && current !== profile) {
        note = `your file says profile "${current}" and you chose "${profile}"; it was left as it is. Edit the "profile" line to change it.`;
      }
    } catch {
      // No file, or not JSON: writeNew reports it the usual way.
    }
    writeNew(profilePath, Buffer.from(JSON.stringify({ profile, overrides: choices.overrides ?? {} }, null, 2) + '\n'), {
      userOwned: true,
      note,
    });
  }

  // 4. Other files the chosen options install (scripts, templates, reviewer agent).
  const seen = new Set();
  for (const option of enabledOptions) {
    for (const kitPath of option.installs ?? []) {
      if (seen.has(kitPath)) continue;
      seen.add(kitPath);
      const target = projectTargetFor(kitPath, toolIds);
      if (target.handled) continue;
      if (target.onlyIfMissing && existsSync(join(dir, target.onlyIfMissing))) continue;
      if (target.manual) report.manual.push({ path: kitPath, reason: target.manual });
      else copyFromKit(kitPath, target.path, { userOwned: Boolean(target.userOwned) });
    }
  }

  // Kit scripts depend on each other (the review gate reads the profile resolver). An older copy that was skipped
  // next to a newer script can make that script silently do nothing, so say so loudly instead of leaving it to
  // a SKIPPED line.
  const staleScripts = report.skipped.filter((item) => /^scripts[\\/]/.test(item.path) && /--force/.test(item.reason));
  if (staleScripts.length) {
    report.warnings.push(
      `${staleScripts.length} kit script(s) in scripts/ are older than this kit's (${staleScripts.map((item) => basename(item.path)).join(', ')}). ` +
        'Newer kit scripts depend on them and can silently do nothing until they are updated. Compare them with the ' +
        `kit's versions in ${TARGET.split('\\').join('/')}/templates/scripts/, then run apply again with --force. ` +
        'Only kit-owned files are replaced; PLAN.md, CHANGELOG.md, REVIEW.md and workflow.json never are.'
    );
  }

  // 5. Git hooks: chained into the project's own hook system as a marked block, never replaced.
  if (has('hook.pre-commit')) {
    const changelogScript = `${skillsDirs[0]}/wk-changelog-bump/scripts/changelog.mjs`;
    // Whatever the project's own hook already runs is left out of the kit block, so nothing runs twice
    // (older kit installs, for instance, wrote the docs-fresh and changelog lines straight into the hook).
    const theirs = userHookText(dir, 'pre-commit');
    const theirLines = new Set(theirs.split('\n').map((line) => line.trim()));
    const commands = {};
    const alreadyRuns = [];
    for (const [kind, command] of Object.entries(project.commands ?? {})) {
      if (command && theirLines.has(command.trim())) alreadyRuns.push(`"${command}"`);
      else commands[kind] = command;
    }
    const docsFresh = !/check-docs-fresh\.mjs/.test(theirs);
    if (!docsFresh) alreadyRuns.push('check-docs-fresh.mjs');
    let wantsChangelog = has('skill.changelog-bump') && project.changelogHook !== false;
    if (wantsChangelog && /changelog\.mjs/.test(theirs)) {
      wantsChangelog = false;
      alreadyRuns.push('the changelog script');
    }
    if (alreadyRuns.length) {
      report.notices.push(`The project's pre-commit hook already runs ${alreadyRuns.join(', ')}; the kit block does not repeat them.`);
    }
    const body = buildPreCommitBody({
      commands,
      docsFresh,
      changelogScript: wantsChangelog ? changelogScript : null,
      changelogTemplate: wantsChangelog ? readKitText('templates', 'hooks', 'pre-commit') : null,
    });
    if (body === null) report.notices.push('The project\'s pre-commit hook already covers everything the kit would add; it was not changed.');
    else recordHook(installHookBlock({ dir, name: 'pre-commit', body, dryRun }), 'pre-commit');
  }
  if (has('hook.pre-push')) {
    // A protected-branch stop the project's hook already has is not repeated.
    const alreadyProtects = project.protectedBranch && userHookText(dir, 'pre-push').includes(`refs/heads/${project.protectedBranch}`);
    const body = buildPrePushBody({
      protectedBranch: alreadyProtects ? undefined : project.protectedBranch,
      reviewGate: has('review-gate'),
    });
    recordHook(installHookBlock({ dir, name: 'pre-push', body, dryRun }), 'pre-push');
  }

  // 6. Claude Code settings: plan mode as the default, and the test-edit guard hook. Keys are added, never replaced.
  const wantsPlanMode = has('setting.plan-mode-default');
  const wantsGuardHook = has('check.test-edit-guard');
  if (wantsPlanMode || wantsGuardHook) {
    if (!toolIds.includes('claude-code')) {
      report.manual.push({ path: '.claude/settings.json', reason: 'plan mode and the test-edit guard hook are Claude Code settings; Claude Code was not selected' });
    } else {
      const settingsPath = join('.claude', 'settings.json');
      let settingsAdded = null;
      editText(settingsPath, (before) => {
        const merged = mergeSettingsText(before, { planMode: wantsPlanMode, guardHook: wantsGuardHook });
        if (merged.error) {
          report.manual.push({ path: settingsPath, reason: merged.error });
          return null;
        }
        for (const note of merged.skipped) report.skipped.push({ path: settingsPath, reason: note });
        if (merged.added.defaultMode || merged.added.guardHook) settingsAdded = { ...merged.added, createdFile: before === null };
        return merged.changes.length ? merged.text : before;
      });
      // Which keys the kit added, so an uninstall removes those and leaves yours.
      if (settingsAdded && !dryRun) {
        const previous = manifest.settings;
        manifest.settings = {
          file: posix(settingsPath),
          createdFile: previous?.createdFile ?? settingsAdded.createdFile,
          defaultMode: Boolean(previous?.defaultMode || settingsAdded.defaultMode),
          guardHook: Boolean(previous?.guardHook || settingsAdded.guardHook),
        };
        persist();
      }
    }
  }

  // 7. .gitignore: the folders the kit's hooks write to.
  const ignoreLines = [];
  if (has('check.test-edit-guard')) ignoreLines.push('.claude/state/');
  if (has('review-gate')) ignoreLines.push('.claude/reviews/');
  if (has('factory-core')) ignoreLines.push('.claude/factory/');
  if (ignoreLines.length) {
    editText('.gitignore', (before) => gitignoreWithKit(before, ignoreLines), { id: 'gitignore', style: 'hash' });
  }

  // 8. Release workflow: a new file only, filled from project facts, never written with a placeholder left.
  if (has('workflow.release-bump')) {
    const result = releaseWorkflowText(
      readKitText('templates', 'workflows', 'release_bump.yaml'),
      {
        protectedBranch: project.protectedBranch,
        changelogScript: `${skillsDirs[0]}/wk-changelog-bump/scripts/changelog.mjs`,
        versionFiles: project.versionFiles,
      }
    );
    if (result.missing) {
      report.manual.push({ path: '.github/workflows/release_bump.yaml', reason: `needs these answers first: ${result.missing.join(', ')}` });
    } else {
      writeNew(join('.github', 'workflows', 'release_bump.yaml'), Buffer.from(result.text), { userOwned: true });
    }
  }

  // 9. A check:config shortcut in package.json, only when the script name is free.
  if (has('check.static') && project.packageScript !== false && existsSync(join(dir, 'package.json'))) {
    const scriptName = 'check:config';
    const scriptCommand = 'node scripts/check-config.mjs';
    let scriptAdded = null;
    editText('package.json', (before) => {
      const result = packageScriptText(before, scriptName, scriptCommand);
      if (result.status === 'exists') {
        report.skipped.push({ path: 'package.json', reason: 'a check:config script already exists; left as it is' });
        return null;
      }
      if (result.status === 'added') scriptAdded = { name: scriptName, command: scriptCommand, createdScripts: result.createdScripts };
      return result.status === 'added' ? result.text : before;
    });
    // The script the kit added, so an uninstall removes it (only while it is still this command).
    if (scriptAdded && !dryRun) {
      manifest.packageScript = scriptAdded;
      persist();
    }
  }

  if (!dryRun) {
    const record = { profile, tools: toolIds, enabled, overrides: choices.overrides ?? {}, project };
    mkdirSync(kitDir, { recursive: true });
    writeFileSync(join(kitDir, 'choices.json'), JSON.stringify(record, null, 2) + '\n');
    persist();
  }
  return report;
}

export { SKILL_PREFIX };
