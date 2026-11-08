#!/usr/bin/env node
// OPT-IN checks that run `claude -p` locally. Two things cannot be proven without asking Claude:
//   - that the `@` imports of CLAUDE.md were actually loaded (we ask which files it can see), and
//   - that a skill is chosen for the requests it should handle (we give it each phrase from the skill's
//     triggers.json and ask which skill it would load first).
// Both answers come from the model, so they are evidence, not proof: a pass is a good sign and a failure
// is a prompt to look (open /memory, or reword the skill's description).
//
// It uses your Claude usage, one small call per phrase, so it is OFF by default and is never run by a hook
// or CI. To use it: set `claude.runChecks` to true in .claude/workflow.json (overrides), or set
// CLAUDE_RUN_CHECKS=1 for one command; then run with --yes (without --yes it only prints how many calls it
// would make).
//
// Usage: node run-claude-checks.mjs [--root <dir>] [--skills-dir <dir> ...] [--imports] [--triggers]
//                                   [--yes] [--dry-run] [--model <name>]
//   With neither --imports nor --triggers, both run. --model picks a cheaper model, for example haiku.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkImports } from './check-imports.mjs';
import { parseFrontmatter } from './check-skills.mjs';

/** Reads every skill's name, fixtures and whether it is started by hand, from the given skills folders. */
export function readSkillFixtures(skillsDirs) {
  const skills = [];
  for (const dir of skillsDirs) {
    if (!existsSync(dir)) continue;
    for (const folder of readdirSync(dir).sort()) {
      const skillFile = join(dir, folder, 'SKILL.md');
      const fixturesFile = join(dir, folder, 'triggers.json');
      if (!existsSync(skillFile)) continue;
      const { data } = parseFrontmatter(readFileSync(skillFile, 'utf8'));
      if (!data) continue;
      let fixtures = null;
      if (existsSync(fixturesFile)) {
        try {
          fixtures = JSON.parse(readFileSync(fixturesFile, 'utf8'));
        } catch {
          fixtures = null;
        }
      }
      skills.push({
        name: data.name || folder,
        startedByHand: String(data['disable-model-invocation']).toLowerCase() === 'true',
        fixtures,
      });
    }
  }
  return skills;
}

/** One case per fixture phrase: `{ skill, phrase, kind: 'should' | 'shouldNot' }`. Skills started by hand are skipped. */
export function buildTriggerCases(skills) {
  const cases = [];
  for (const skill of skills) {
    if (skill.startedByHand || !skill.fixtures) continue;
    for (const phrase of skill.fixtures.should ?? []) cases.push({ skill: skill.name, phrase, kind: 'should' });
    for (const phrase of skill.fixtures.shouldNot ?? []) cases.push({ skill: skill.name, phrase, kind: 'shouldNot' });
  }
  return cases;
}

export function buildTriggerPrompt(phrase) {
  return [
    'The skills available to you are listed in your context.',
    `A user sends this request: "${phrase}"`,
    'Reply with ONLY the name of the single skill you would load first, or the word NONE if no skill applies.',
    'Do not call any tool and do not explain.',
  ].join('\n');
}

export function buildImportsPrompt() {
  return [
    'List the file paths of every instruction file whose contents were loaded into your context for this project at the start of the session:',
    'the CLAUDE.md file(s) and every file they import with @.',
    'Reply with one path per line and nothing else.',
  ].join('\n');
}

/** The skill name in a model answer, `NONE`, or null when the answer names no known skill. */
export function parseSkillAnswer(output, knownNames) {
  const text = String(output ?? '').trim().toLowerCase();
  if (text === '') return null;
  const lines = text.split('\n').map((line) => line.replace(/[`*"'.:]/g, '').trim()).filter(Boolean);
  for (const line of lines) {
    if (line === 'none') return 'NONE';
    const exact = knownNames.find((name) => name.toLowerCase() === line);
    if (exact) return exact;
  }
  const contained = knownNames
    .filter((name) => new RegExp(`(^|[^a-z0-9-])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9-])`).test(text))
    .sort((first, second) => second.length - first.length);
  if (contained.length > 0) return contained[0];
  return /\bnone\b/.test(text) ? 'NONE' : null;
}

/**
 * Scores one case. `should`: pass only if the model named the skill. `shouldNot`: pass if it named anything else.
 * An answer that names no known skill is `unclear` (neither pass nor fail).
 */
export function scoreCase(testCase, answer) {
  if (answer === null) return { ...testCase, answer, result: 'unclear' };
  const named = answer === testCase.skill;
  const pass = testCase.kind === 'should' ? named : !named;
  return { ...testCase, answer, result: pass ? 'pass' : 'fail' };
}

/** Which of the expected files the model said it can see (by file name, case-insensitive). */
export function scoreImportsAnswer(output, expectedPaths) {
  const text = String(output ?? '').toLowerCase();
  const found = [];
  const missing = [];
  for (const path of expectedPaths) (text.includes(basename(path).toLowerCase()) ? found : missing).push(path);
  return { found, missing };
}

/** Decides whether to run: `skip-off` (control off), `confirm` (needs --yes or is a dry run) or `run`. */
export function gateRun({ enabled, yes, dryRun, callCount }) {
  if (!enabled) {
    return { action: 'skip-off', message: 'claude.runChecks is off for this project, so no Claude calls were made. Turn it on in .claude/workflow.json (overrides: {"claude.runChecks": true}) or run with CLAUDE_RUN_CHECKS=1.' };
  }
  if (dryRun || !yes) {
    return { action: 'confirm', message: `This would make ${callCount} call(s) to \`claude -p\`, using your Claude usage. Re-run with --yes to start.` };
  }
  return { action: 'run', message: `Running ${callCount} call(s) to \`claude -p\`...` };
}

/** The first line of a model answer, cut to 70 characters, for reports. */
export function shortAnswer(output) {
  const firstLine = String(output ?? '').trim().split('\n')[0] ?? '';
  return firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine;
}

/** The default way to ask Claude: `claude -p` with the prompt on stdin, in the project folder. */
export function defaultExec(root, model) {
  return (prompt) => {
    const args = ['-p', '--output-format', 'text', '--no-session-persistence', ...(model ? ['--model', model] : [])];
    const result = spawnSync('claude', args, {
      cwd: root,
      input: prompt,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 180000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || `claude exited with status ${result.status}`).trim().slice(0, 200));
    return result.stdout;
  };
}

/**
 * The whole run, with the model call injected as `exec(prompt) -> text` so tests make no real calls.
 * Returns `{ gate, lines, exitCode }`.
 */
export async function runClaudeChecks(options) {
  const { root, skillsDirs, imports = true, triggers = true, yes = false, dryRun = false, env = process.env, exec } = options;

  let enabled = false;
  try {
    const { loadWorkflowConfig } = await import('./workflow-config.mjs');
    enabled = loadWorkflowConfig(root, env).controls['claude.runChecks'].value === true;
  } catch {
    enabled = ['1', 'true', 'on', 'yes'].includes(String(env.CLAUDE_RUN_CHECKS ?? '').toLowerCase());
  }

  const skills = readSkillFixtures(skillsDirs);
  const cases = triggers ? buildTriggerCases(skills) : [];
  const importsReport = imports ? checkImports(root) : null;
  const callCount = cases.length + (imports && importsReport.entries.length > 0 ? 1 : 0);

  const gate = gateRun({ enabled, yes, dryRun, callCount });
  const lines = [gate.message];
  if (gate.action !== 'run') return { gate, lines, exitCode: 0 };

  let failures = 0;
  if (imports && importsReport.entries.length > 0) {
    const expected = importsReport.files.map((file) => file.path);
    try {
      const { found, missing } = scoreImportsAnswer(exec(buildImportsPrompt()), expected);
      lines.push(`imports (model-reported): ${found.length} of ${expected.length} files seen`);
      for (const path of missing) lines.push(`  not reported by the model: ${path.replace(root, '.')}`);
      if (missing.length > 0) failures += 1;
    } catch (error) {
      lines.push(`imports: the call failed (${error.message})`);
      failures += 1;
    }
  }

  const known = skills.map((skill) => skill.name);
  const counts = { pass: 0, fail: 0, unclear: 0, error: 0 };
  for (const testCase of cases) {
    let scored;
    try {
      const raw = exec(buildTriggerPrompt(testCase.phrase));
      scored = { ...scoreCase(testCase, parseSkillAnswer(raw, known)), raw: shortAnswer(raw) };
    } catch (error) {
      scored = { ...testCase, answer: null, result: 'error', detail: error.message };
    }
    counts[scored.result] += 1;
    if (scored.result !== 'pass') {
      const expectation = scored.kind === 'should' ? `should trigger ${scored.skill}` : `should not trigger ${scored.skill}`;
      const said = scored.answer ?? (scored.raw ? `"${scored.raw}" (not a skill of this project)` : scored.detail ?? 'nothing');
      lines.push(`  ${scored.result.toUpperCase()}: "${scored.phrase}" (${expectation}; model said ${said})`);
    }
  }
  if (cases.length > 0) {
    lines.push(`triggers (model-reported): ${counts.pass} pass, ${counts.fail} fail, ${counts.unclear} unclear, ${counts.error} errors, of ${cases.length}`);
  }
  failures += counts.fail + counts.error;
  lines.push('These answers come from the model: evidence, not proof. A failure means look at the skill description or /memory.');
  return { gate, lines, exitCode: failures > 0 ? 1 : 0 };
}

function parseArguments(argv) {
  const options = { skillsDirs: [], imports: false, triggers: false, yes: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root' && argv[index + 1]) options.root = argv[(index += 1)];
    else if (argv[index] === '--skills-dir' && argv[index + 1]) options.skillsDirs.push(argv[(index += 1)]);
    else if (argv[index] === '--model' && argv[index + 1]) options.model = argv[(index += 1)];
    else if (argv[index] === '--imports') options.imports = true;
    else if (argv[index] === '--triggers') options.triggers = true;
    else if (argv[index] === '--yes') options.yes = true;
    else if (argv[index] === '--dry-run') options.dryRun = true;
  }
  if (!options.imports && !options.triggers) {
    options.imports = true;
    options.triggers = true;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArguments(process.argv.slice(2));
  const root = resolve(options.root ?? process.cwd());
  const skillsDirs = (options.skillsDirs.length ? options.skillsDirs : ['.claude/skills']).map((dir) => resolve(root, dir));
  const { lines, exitCode } = await runClaudeChecks({ ...options, root, skillsDirs, exec: defaultExec(root, options.model) });
  console.log(lines.join('\n'));
  process.exit(exitCode);
}
