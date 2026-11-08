#!/usr/bin/env node
// One command for the cheap, Claude-free checks on how the project's assistant is configured:
//   1. skill lint (check-skills.mjs)        errors fail the run
//   2. `@` imports (check-imports.mjs)      a missing import fails the run
//   3. doc-size report (doc-size.mjs)       information and a soft warning only
//
// It respects the workflow profile (.claude/workflow.json): with `static.checks` off it prints that it
// skipped. It never calls Claude; for that, see run-claude-checks.mjs (opt-in, uses Claude usage).
//
// Usage: node check-config.mjs [--root <dir>] [--skills-dir <dir> ...] [--strict] [--no-placeholders]
//   --skills-dir   where skills live (repeatable; default <root>/.claude/skills)
//   --strict       warnings from the skill lint fail the run too
//   --no-placeholders   also report leftover <...> placeholders (for a project's installed skills)

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkImports, formatImportsReport } from './check-imports.mjs';
import { checkSkills, exitCodeFor, formatReport } from './check-skills.mjs';
import { formatSizeReport, measureProject } from './doc-size.mjs';

/** The two controls these checks read, from the workflow profile, or the defaults without the resolver. */
async function readControls(root, env) {
  try {
    const { loadWorkflowConfig } = await import('./workflow-config.mjs');
    const resolved = loadWorkflowConfig(root, env);
    return {
      staticChecks: resolved.controls['static.checks'].value,
      sizeWarnChars: resolved.controls['docs.sizeWarnChars'].value,
      warnings: resolved.warnings,
    };
  } catch {
    return { staticChecks: true, sizeWarnChars: 40000, warnings: [] };
  }
}

/**
 * Runs the checks. Returns `{ sections, exitCode }`, where each section is `{ title, lines }`.
 * Options: `root`, `skillsDirs` (default `<root>/.claude/skills`), `strict`, `noPlaceholders`, `env`.
 */
export async function runConfigChecks(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const skillsDirs = (options.skillsDirs?.length ? options.skillsDirs : [`${root}/.claude/skills`]).map((dir) => resolve(root, dir));
  const controls = await readControls(root, options.env ?? process.env);
  const sections = [];
  let exitCode = 0;

  if (controls.warnings.length > 0) {
    sections.push({ title: 'Workflow profile', lines: controls.warnings.map((warning) => `warning: ${warning}`) });
  }

  if (!controls.staticChecks) {
    sections.push({ title: 'Config checks', lines: ['skipped: the workflow control static.checks is off for this project.'] });
    return { sections, exitCode };
  }

  const skillsReport = checkSkills(skillsDirs, { noPlaceholders: options.noPlaceholders });
  sections.push({ title: 'Skills', lines: formatReport(skillsReport) });
  if (exitCodeFor(skillsReport, options.strict) !== 0) exitCode = 1;

  const importsReport = checkImports(root);
  sections.push({ title: '@ imports', lines: formatImportsReport(importsReport) });
  if (importsReport.errors > 0) exitCode = 1;

  sections.push({ title: 'Doc size', lines: formatSizeReport(measureProject(root), controls.sizeWarnChars).lines });

  return { sections, exitCode };
}

/** The sections as text, with a header line for each. */
export function formatSections(sections) {
  return sections.map((section) => `== ${section.title} ==\n${section.lines.join('\n')}`).join('\n\n');
}

function parseArguments(argv) {
  const options = { skillsDirs: [], strict: false, noPlaceholders: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root' && argv[index + 1]) options.root = argv[(index += 1)];
    else if (argv[index] === '--skills-dir' && argv[index + 1]) options.skillsDirs.push(argv[(index += 1)]);
    else if (argv[index] === '--strict') options.strict = true;
    else if (argv[index] === '--no-placeholders') options.noPlaceholders = true;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { sections, exitCode } = await runConfigChecks(parseArguments(process.argv.slice(2)));
  console.log(formatSections(sections));
  process.exit(exitCode);
}
