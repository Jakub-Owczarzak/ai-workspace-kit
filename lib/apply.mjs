// Applies the user's answers (a choices object) to a project. Every write is one of three kinds:
//   * a NEW file or folder (skipped, never replaced, when something different is already there),
//   * a marked block inside an instruction file the user owns (see blocks.mjs),
//   * nothing at all (reported as "manual" for the setup prompt to finish).
// Kit skills are installed as wk-<name>. Running twice changes nothing. Nothing outside the project
// folder is touched, and nothing is downloaded.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { upsertBlock } from './blocks.mjs';
import { SKILL_PREFIX, isRewritableText, rewriteSkillNames } from './rename.mjs';
import { TARGET } from './init.mjs';
import { targetsFor } from './tools.mjs';

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
  if (kitPath === 'templates/workflow.json') return { handled: true };
  if (kitPath.startsWith('templates/hooks/')) return { manual: 'git hooks are chained into the existing hook system' };
  if (kitPath.startsWith('templates/workflows/')) return { manual: 'CI workflow is adapted to the repository and shown first' };
  if (kitPath === 'templates/AGENTS.md') return { manual: 'written from the code by the write-project-overview skill' };
  if (kitPath === 'templates/CLAUDE.md') return { manual: 'the rules block below creates or extends CLAUDE.md' };
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
  const { skillsDirs, rulesFiles } = targetsFor(toolIds);
  const unknownIds = (choices.enabled ?? []).filter((id) => !optionsById.has(id));
  if (unknownIds.length) throw new Error(`unknown option id(s): ${unknownIds.join(', ')}`);

  const { enabled, added } = expandRequires(options, choices.enabled ?? []);
  const enabledOptions = enabled.map((id) => optionsById.get(id));
  const skillNames = options.filter((o) => o.kind === 'skill' && o.installAs).map((o) => o.source.split('/')[1]);
  const rewrite = (text) => rewriteSkillNames(text, skillNames);

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

  const copyFromKit = (kitRelative, projectRelative) => {
    const from = join(kitDir, kitRelative);
    const raw = readFileSync(from);
    const content = isRewritableText(basename(from)) ? Buffer.from(rewrite(raw.toString('utf8'))) : raw;
    writeNew(projectRelative, content);
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

  // 2. Rules, as one marked block in each tool's instruction file.
  const ruleOptions = enabledOptions.filter((o) => o.kind === 'rule');
  if (ruleOptions.length) {
    const body = ruleOptions
      .map((o) => rewrite(readFileSync(join(kitDir, o.source), 'utf8')).trim())
      .join('\n\n');
    for (const rulesFile of rulesFiles) {
      const target = join(dir, rulesFile);
      const existed = existsSync(target);
      const before = existed ? readFileSync(target, 'utf8') : '';
      const after = upsertBlock(before, 'rules', body);
      if (after === before) report.unchanged.push(rulesFile);
      else {
        (existed ? report.updated : report.created).push(rulesFile);
        if (!dryRun) writeFileSync(target, after);
      }
    }
  }

  // 3. The workflow profile. An existing file is never rewritten.
  const profilePath = join('.claude', 'workflow.json');
  const wantsProfile = enabledOptions.some((o) => o.id === 'check.static' || o.kind === 'control');
  if (wantsProfile || choices.profile) {
    const content = Buffer.from(
      JSON.stringify({ profile, overrides: choices.overrides ?? {} }, null, 2) + '\n'
    );
    writeNew(profilePath, content);
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

  if (!dryRun) {
    const record = { profile, tools: toolIds, enabled, overrides: choices.overrides ?? {} };
    mkdirSync(kitDir, { recursive: true });
    writeFileSync(join(kitDir, 'choices.json'), JSON.stringify(record, null, 2) + '\n');
  }
  return report;
}

export { SKILL_PREFIX };
