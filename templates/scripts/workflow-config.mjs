#!/usr/bin/env node
// Workflow profile resolver. One small file per project, `.claude/workflow.json`, says how strict the
// workflow is: a profile (`solo`, `team`, `org`) plus optional per-control overrides. Hook scripts and
// check scripts import this module so every control reads the same answer; skills are told to read the
// file. Nothing here throws: a missing or broken file means the default profile, with a warning.
//
// Precedence for each control, highest first:
//   1. an environment variable, for one command (names in CONTROL_SPECS, plus WORKFLOW_PROFILE)
//   2. `overrides` in .claude/workflow.json
//   3. the profile's default
//
// Run `node workflow-config.mjs` in a project to print the resolved controls and where each came from.
// Add `--json` for machine-readable output and `--root <dir>` to look at another project.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROFILE_NAMES = ['solo', 'team', 'org'];
export const DEFAULT_PROFILE = 'solo';

/**
 * Every control: what it may be set to, the environment variable that overrides it for one command, and
 * a one-line meaning. `type: 'choice'` takes one of `allowed`; `boolean` takes true/false (also on/off,
 * yes/no, 1/0); `number` takes a number of zero or more (0 usually means "off").
 */
export const CONTROL_SPECS = {
  'planning.gates': {
    type: 'choice',
    allowed: ['off', 'anchor', 'full'],
    env: 'PLANNING_GATES',
    description:
      'off = the planner is used only on request; anchor = no code for non-trivial work before the Intent Anchor is approved (the default in every profile); full = anchor plus success measurements',
  },
  'docs.check': {
    type: 'choice',
    allowed: ['off', 'warn', 'strict'],
    env: 'DOCS_CHECK',
    description:
      'commit hook: source changed but the overview did not (off = silent, warn = message, strict = block)',
  },
  'docs.sizeWarnChars': {
    type: 'number',
    env: 'DOCS_SIZE_WARN_CHARS',
    description: 'warn when the always-loaded instruction files exceed this many characters (0 = no warning)',
  },
  'tests.guard': {
    type: 'choice',
    allowed: ['off', 'on'],
    env: 'TEST_GUARD',
    description: 'block edits to existing test files while a bug fix is in progress (fix mode)',
  },
  'tests.tdd': {
    type: 'choice',
    allowed: ['off', 'bugs', 'on'],
    env: 'TEST_TDD',
    description:
      'test-first policy (off = no rule, bugs = a bug fix starts with a failing test, on = new logic too); a bucket marked "TDD: yes" in the plan opts in even when this says bugs',
  },
  'tests.e2e': {
    type: 'choice',
    allowed: ['off', 'browser', 'native'],
    env: 'TEST_E2E',
    description:
      'end-to-end UI tests and screenshots (off = none, browser = Playwright in a headless browser, native = experimental, Maestro against a platform the user supplies and runs: Expo, Android Studio, Xcode or a device)',
  },
  'review.mode': {
    type: 'choice',
    allowed: ['off', 'advisory', 'required'],
    env: 'REVIEW_MODE',
    description:
      'independent review by the reviewer subagent against REVIEW.md before a commit (off = only on request, advisory = run it and remind at push, required = the pre-push hook blocks a push whose content has no clean review record)',
  },
  'factory.mode': {
    type: 'choice',
    allowed: ['off', 'local', 'pr'],
    env: 'FACTORY_MODE',
    description:
      'after the plan is approved, agents carry the work through without further prompts (off = you drive each step, local = build, test, review, commit and write the PR text, then stop before any push, pr = also push, open the PR or stack and watch CI; nothing is ever merged or deployed)',
  },
  'factory.prLayout': {
    type: 'choice',
    allowed: ['single', 'stack'],
    env: 'FACTORY_PR_LAYOUT',
    description:
      'how a multi-bucket plan becomes pull requests (single = one PR for the whole plan, stack = one layer per bucket: `gh stack` on GitHub, chained merge requests on GitLab, one PR per bucket where stacking is unavailable)',
  },
  'factory.ciFixAttempts': {
    type: 'number',
    env: 'FACTORY_CI_FIX_ATTEMPTS',
    description:
      'how many times the factory may fix a red CI run and push again before it stops and reports (0 = watch and report only)',
  },
  'factory.host': {
    type: 'choice',
    allowed: ['auto', 'github', 'gitlab'],
    env: 'FACTORY_HOST',
    description: 'which code host the factory talks to (auto = read it from the git remote)',
  },
  'factory.pushConfirm': {
    type: 'choice',
    allowed: ['auto', 'ask'],
    env: 'FACTORY_PUSH_CONFIRM',
    description:
      'whether the factory pushes by itself (auto) or stops for your yes before each push (ask); only used when factory.mode is pr',
  },
  'factory.fastFix': {
    type: 'choice',
    allowed: ['off', 'docs'],
    env: 'FACTORY_FAST_FIX',
    description:
      'whether the factory may fix a tiny documentation-only problem itself with a self-check (docs) or must always use a builder and an independent re-review (off); only used when factory.mode is on',
  },
  'factory.untrustedText': {
    type: 'choice',
    allowed: ['stop', 'note'],
    env: 'FACTORY_UNTRUSTED_TEXT',
    description:
      'what the builder does when text it reads (a file, a log, PR or issue text) gives it an order: stop the run and ask (stop) or never follow it, record it in its handoff and carry on (note); the reviewer reports it as blocking (stop) or as a nit (note); only used when factory.mode is on',
  },
  'claude.runChecks': {
    type: 'boolean',
    env: 'CLAUDE_RUN_CHECKS',
    description:
      'allow checks that run `claude -p` locally (import check, trigger runner); they use Claude usage and are never run by hooks or CI',
  },
  'static.checks': {
    type: 'boolean',
    env: 'STATIC_CHECKS',
    description: 'cheap checks that need no Claude (skill lint, `@` import resolver)',
  },
};

/** The default value of every control for each profile. `solo` matches how the kit worked before profiles. */
export const PROFILES = {
  solo: {
    'planning.gates': 'anchor',
    'docs.check': 'warn',
    'docs.sizeWarnChars': 40000,
    'tests.guard': 'off',
    'tests.tdd': 'bugs',
    'tests.e2e': 'off',
    'review.mode': 'advisory',
    'factory.mode': 'off',
    'factory.prLayout': 'stack',
    'factory.ciFixAttempts': 3,
    'factory.host': 'auto',
    'factory.pushConfirm': 'auto',
    'factory.fastFix': 'docs',
    'factory.untrustedText': 'note',
    'claude.runChecks': false,
    'static.checks': true,
  },
  team: {
    'planning.gates': 'anchor',
    'docs.check': 'warn',
    'docs.sizeWarnChars': 40000,
    'tests.guard': 'on',
    'tests.tdd': 'on',
    'tests.e2e': 'off',
    'review.mode': 'advisory',
    'factory.mode': 'off',
    'factory.prLayout': 'stack',
    'factory.ciFixAttempts': 3,
    'factory.host': 'auto',
    'factory.pushConfirm': 'auto',
    'factory.fastFix': 'docs',
    'factory.untrustedText': 'stop',
    'claude.runChecks': false,
    'static.checks': true,
  },
  org: {
    'planning.gates': 'full',
    'docs.check': 'strict',
    'docs.sizeWarnChars': 40000,
    'tests.guard': 'on',
    'tests.tdd': 'on',
    'tests.e2e': 'off',
    'review.mode': 'required',
    'factory.mode': 'off',
    'factory.prLayout': 'stack',
    'factory.ciFixAttempts': 2,
    'factory.host': 'auto',
    'factory.pushConfirm': 'ask',
    'factory.fastFix': 'off',
    'factory.untrustedText': 'stop',
    'claude.runChecks': false,
    'static.checks': true,
  },
};

const TRUE_WORDS = ['true', 'on', 'yes', '1'];
const FALSE_WORDS = ['false', 'off', 'no', '0'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks one raw value against a control's spec. Returns `{ ok: true, value }` or `{ ok: false }`. */
export function normalizeValue(spec, raw) {
  if (spec.type === 'choice') {
    const text = String(raw).trim().toLowerCase();
    return spec.allowed.includes(text) ? { ok: true, value: text } : { ok: false };
  }
  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    const text = String(raw).trim().toLowerCase();
    if (TRUE_WORDS.includes(text)) return { ok: true, value: true };
    if (FALSE_WORDS.includes(text)) return { ok: true, value: false };
    return { ok: false };
  }
  if (spec.type === 'number') {
    if (typeof raw === 'boolean' || raw === null || String(raw).trim() === '') return { ok: false };
    const number = Number(raw);
    return Number.isFinite(number) && number >= 0 ? { ok: true, value: number } : { ok: false };
  }
  return { ok: false };
}

/**
 * Turns the text of `.claude/workflow.json` into a config object. Missing or empty text is a normal
 * "no file" case (no warning); text that is not valid JSON, or not an object, gives an empty config and a warning.
 */
export function parseConfigText(text) {
  if (text === undefined || text === null || String(text).trim() === '') {
    return { config: {}, warnings: [] };
  }
  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      return { config: {}, warnings: ['workflow.json must hold a JSON object; using the default profile.'] };
    }
    return { config: parsed, warnings: [] };
  } catch {
    return { config: {}, warnings: ['workflow.json is not valid JSON; using the default profile.'] };
  }
}

/**
 * Resolves every control for a config object and an environment (pass `process.env`, or `{}` in tests).
 * Returns `{ profile, profileSource, controls, warnings }`, where `controls[name] = { value, source }` and
 * `source` is `profile:<name>`, `overrides` or `env:<VARIABLE>`. Invalid values are ignored with a warning
 * and the next lower precedence is used.
 */
export function resolveControls(config = {}, env = {}) {
  const warnings = [];
  const safeConfig = isPlainObject(config) ? config : {};

  const environmentProfile = env.WORKFLOW_PROFILE;
  const requestedProfile = environmentProfile || safeConfig.profile || DEFAULT_PROFILE;
  let profile = String(requestedProfile).trim().toLowerCase();
  let profileSource = environmentProfile ? 'env:WORKFLOW_PROFILE' : safeConfig.profile ? 'file' : 'default';
  if (!PROFILE_NAMES.includes(profile)) {
    warnings.push(`Unknown profile "${requestedProfile}"; using ${DEFAULT_PROFILE}.`);
    profile = DEFAULT_PROFILE;
    profileSource = 'default';
  }

  let overrides = {};
  if (safeConfig.overrides !== undefined) {
    if (isPlainObject(safeConfig.overrides)) {
      overrides = safeConfig.overrides;
    } else {
      warnings.push('"overrides" must be an object; ignoring it.');
    }
  }
  for (const key of Object.keys(overrides)) {
    if (!(key in CONTROL_SPECS)) warnings.push(`Unknown control "${key}" in overrides; ignoring it.`);
  }

  const controls = {};
  for (const [name, spec] of Object.entries(CONTROL_SPECS)) {
    controls[name] = { value: PROFILES[profile][name], source: `profile:${profile}` };

    if (name in overrides) {
      const checked = normalizeValue(spec, overrides[name]);
      if (checked.ok) {
        controls[name] = { value: checked.value, source: 'overrides' };
      } else {
        warnings.push(`Invalid value ${JSON.stringify(overrides[name])} for "${name}" in overrides; ignoring it.`);
      }
    }

    const fromEnvironment = env[spec.env];
    if (fromEnvironment !== undefined && fromEnvironment !== '') {
      const checked = normalizeValue(spec, fromEnvironment);
      if (checked.ok) {
        controls[name] = { value: checked.value, source: `env:${spec.env}` };
      } else {
        warnings.push(`Invalid value "${fromEnvironment}" for ${spec.env}; ignoring it.`);
      }
    }
  }

  return { profile, profileSource, controls, warnings };
}

/** Where a project keeps its profile. */
export function configPath(projectRoot) {
  return join(projectRoot, '.claude', 'workflow.json');
}

/**
 * Reads `.claude/workflow.json` under `projectRoot` (a missing file means the default profile) and resolves
 * the controls. Never throws: a read error becomes a warning.
 */
export function loadWorkflowConfig(projectRoot, env = process.env) {
  const path = configPath(projectRoot);
  let text;
  const readWarnings = [];
  if (existsSync(path)) {
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      readWarnings.push(`Could not read ${path}; using the default profile.`);
    }
  }
  const { config, warnings } = parseConfigText(text);
  const resolved = resolveControls(config, env);
  return { ...resolved, file: text === undefined ? null : path, warnings: [...readWarnings, ...warnings, ...resolved.warnings] };
}

/** A readable report of the resolved controls, one line each. */
export function explainResolved(resolved) {
  const lines = [`Workflow profile: ${resolved.profile} (${resolved.profileSource})`];
  lines.push(`Config file: ${resolved.file ?? 'none (default profile)'}`);
  const width = Math.max(...Object.keys(resolved.controls).map((name) => name.length));
  for (const [name, { value, source }] of Object.entries(resolved.controls)) {
    lines.push(`  ${name.padEnd(width)}  ${String(value).padEnd(9)} ${source}`);
  }
  for (const warning of resolved.warnings) lines.push(`warning: ${warning}`);
  return lines.join('\n');
}

function parseArguments(argv) {
  const options = { root: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--json') options.json = true;
    else if (argv[index] === '--root' && argv[index + 1]) options.root = argv[(index += 1)];
  }
  return options;
}

function main(argv) {
  const options = parseArguments(argv);
  const resolved = loadWorkflowConfig(options.root);
  console.log(options.json ? JSON.stringify(resolved, null, 2) : explainResolved(resolved));
  return 0;
}

/**
 * True when this file was started directly (`node scripts/<name>.mjs`). Both sides are resolved to real
 * paths: Node reports the real path in import.meta.url, but argv[1] keeps a symlink or a Windows short name,
 * and a plain comparison would then make the script silently do nothing.
 */
function startedDirectly() {
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && startedDirectly()) {
  process.exit(main(process.argv.slice(2)));
}
