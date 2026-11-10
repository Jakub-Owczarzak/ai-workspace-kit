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
import { buildPreCommitBody, buildPrePushBody, installHookBlock } from './hooks.mjs';
import { gitignoreWithKit, packageScriptText, releaseWorkflowText } from './project-files.mjs';
import { SKILL_PREFIX, isRewritableText, rewriteSkillNames } from './rename.mjs';
import { mergeSettingsText } from './settings.mjs';
import { TARGET } from './init.mjs';
import { targetsFor } from './tools.mjs';

/** LF line endings, so text from a Windows checkout (CRLF) is written as the same bytes as anywhere else. */
const toLf = (text) => text.replace(/\r\n/g, '\n');

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
  if (ROOT_TEMPLATES[kitPath]) return { path: ROOT_TEMPLATES[kitPath] };
  if (kitPath === 'templates/agents/reviewer.md') {
    return toolIds.includes('claude-code')
      ? { path: join('.claude', 'agents', 'reviewer.md') }
      : { manual: 'the reviewer subagent is a Claude Code feature' };
  }
  // These are written by dedicated steps below (hooks, release workflow, profile).
  if (kitPath === 'templates/workflow.json') return { handled: true };
  if (kitPath.startsWith('templates/hooks/') || kitPath.startsWith('templates/workflows/')) return { handled: true };
  if (kitPath === 'templates/AGENTS.md') return { manual: 'written from the code by the write-project-overview skill' };
  if (kitPath === 'templates/CLAUDE.md') return { manual: 'the rules block creates or extends CLAUDE.md or AGENTS.md' };
  return { manual: 'applied by the setup prompt' };
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
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
  if (!existsSync(catalogPath)) throw new Error(`kit not found at ${kitDir}; run "workspace-kit init" first`);
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

  const report = { created: [], updated: [], unchanged: [], skipped: [], manual: [], addedRequirements: added };

  /** Writes a new file. An existing file is left alone when it differs (unless force). */
  const writeNew = (relativePath, content) => {
    const target = join(dir, relativePath);
    if (existsSync(target)) {
      if (readFileSync(target).equals(content)) return report.unchanged.push(relativePath);
      if (!force) return report.skipped.push({ path: relativePath, reason: 'already exists and differs; left as it is' });
      report.updated.push(relativePath);
    } else report.created.push(relativePath);
    if (!dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  };

  /** Edits a text file the user may own. `transform(before | null)` returns the new text, or null to leave it. */
  const editText = (relativePath, transform) => {
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
    }
  };

  const copyFromKit = (kitRelative, projectRelative) => {
    const from = join(kitDir, kitRelative);
    const raw = readFileSync(from);
    const content = isRewritableText(basename(from)) ? Buffer.from(rewrite(toLf(raw.toString('utf8')))) : raw;
    writeNew(projectRelative, content);
  };

  const recordHook = (result) => {
    if (result.status === 'manual') report.manual.push({ path: result.path, reason: result.reason, snippet: result.snippet });
    else report[result.status === 'created' ? 'created' : result.status === 'updated' ? 'updated' : 'unchanged'].push(result.path);
  };

  // 1. Skills, namespaced, into every folder the chosen tools read.
  for (const option of enabledOptions.filter((o) => o.kind === 'skill' && o.installAs)) {
    for (const skillsDir of skillsDirs) {
      for (const file of walk(join(kitDir, option.source))) {
        const inside = file.slice(join(kitDir, option.source).length + 1);
        copyFromKit(join(option.source, inside), join(skillsDir, option.installAs, inside));
      }
    }
  }

  // 2. Rules: one marked block in one file. Claude Code imports AGENTS.md when other tools need it.
  const ruleOptions = enabledOptions.filter((o) => o.kind === 'rule');
  if (ruleOptions.length) {
    const body = ruleOptions.map((o) => rewrite(readKitText(o.source)).trim()).join('\n\n');
    editText(rulesFile, (before) => upsertBlock(before ?? '', 'rules', body));
    if (claudeImportsAgents) {
      editText('CLAUDE.md', (before) => {
        const userText = removeBlock(before ?? '', 'agents-import');
        if (/^@AGENTS\.md\s*$/m.test(userText)) return before;
        return upsertBlock(before ?? '', 'agents-import', '@AGENTS.md');
      });
    }
  }

  // 3. The workflow profile. An existing file is never rewritten.
  if (enabledOptions.some((o) => o.id === 'check.static' || o.kind === 'control') || choices.profile) {
    writeNew(
      join('.claude', 'workflow.json'),
      Buffer.from(JSON.stringify({ profile, overrides: choices.overrides ?? {} }, null, 2) + '\n')
    );
  }

  // 4. Other files the chosen options install (scripts, templates, reviewer agent).
  const seen = new Set();
  for (const option of enabledOptions) {
    for (const kitPath of option.installs ?? []) {
      if (seen.has(kitPath)) continue;
      seen.add(kitPath);
      const target = projectTargetFor(kitPath, toolIds);
      if (target.handled) continue;
      if (target.manual) report.manual.push({ path: kitPath, reason: target.manual });
      else copyFromKit(kitPath, target.path);
    }
  }

  // 5. Git hooks: chained into the project's own hook system as a marked block, never replaced.
  if (has('hook.pre-commit')) {
    const changelogScript = `${skillsDirs[0]}/wk-changelog-bump/scripts/changelog.mjs`;
    const wantsChangelog = has('skill.changelog-bump') && project.changelogHook !== false;
    const body = buildPreCommitBody({
      commands: project.commands,
      docsFresh: true,
      changelogScript: wantsChangelog ? changelogScript : null,
      changelogTemplate: wantsChangelog ? readKitText('templates', 'hooks', 'pre-commit') : null,
    });
    recordHook(installHookBlock({ dir, name: 'pre-commit', body, dryRun }));
  }
  if (has('hook.pre-push')) {
    const body = buildPrePushBody({ protectedBranch: project.protectedBranch, reviewGate: has('review-gate') });
    recordHook(installHookBlock({ dir, name: 'pre-push', body, dryRun }));
  }

  // 6. Claude Code settings: plan mode as the default, and the test-edit guard hook. Keys are added, never replaced.
  const wantsPlanMode = has('setting.plan-mode-default');
  const wantsGuardHook = has('check.test-edit-guard');
  if (wantsPlanMode || wantsGuardHook) {
    if (!toolIds.includes('claude-code')) {
      report.manual.push({ path: '.claude/settings.json', reason: 'plan mode and the test-edit guard hook are Claude Code settings; Claude Code was not selected' });
    } else {
      const settingsPath = join('.claude', 'settings.json');
      editText(settingsPath, (before) => {
        const merged = mergeSettingsText(before, { planMode: wantsPlanMode, guardHook: wantsGuardHook });
        if (merged.error) {
          report.manual.push({ path: settingsPath, reason: merged.error });
          return null;
        }
        for (const note of merged.skipped) report.skipped.push({ path: settingsPath, reason: note });
        return merged.changes.length ? merged.text : before;
      });
    }
  }

  // 7. .gitignore: the folders the kit's hooks write to.
  const ignoreLines = [];
  if (has('check.test-edit-guard')) ignoreLines.push('.claude/state/');
  if (has('review-gate')) ignoreLines.push('.claude/reviews/');
  if (ignoreLines.length) editText('.gitignore', (before) => gitignoreWithKit(before, ignoreLines));

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
      writeNew(join('.github', 'workflows', 'release_bump.yaml'), Buffer.from(result.text));
    }
  }

  // 9. A check:config shortcut in package.json, only when the script name is free.
  if (has('check.static') && project.packageScript !== false && existsSync(join(dir, 'package.json'))) {
    editText('package.json', (before) => {
      const result = packageScriptText(before, 'check:config', 'node scripts/check-config.mjs');
      if (result.status === 'exists') {
        report.skipped.push({ path: 'package.json', reason: 'a check:config script already exists; left as it is' });
        return null;
      }
      return result.status === 'added' ? result.text : before;
    });
  }

  if (!dryRun) {
    const record = { profile, tools: toolIds, enabled, overrides: choices.overrides ?? {}, project };
    mkdirSync(kitDir, { recursive: true });
    writeFileSync(join(kitDir, 'choices.json'), JSON.stringify(record, null, 2) + '\n');
  }
  return report;
}

export { SKILL_PREFIX };
