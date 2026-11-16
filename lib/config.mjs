// Read-only view of an installed setup, for `config list` and `config get`: every catalog option and control, grouped,
// with its state. Nothing here writes. The state of a switch comes from the record `apply` keeps (choices.json), a
// control's value from the same resolver the kit's scripts use (templates/scripts/workflow-config.mjs), with
// environment variables left out so the answer is the configured one, not the one of a single command.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGET } from './init.mjs';
import { loadWorkflowConfig } from '../templates/scripts/workflow-config.mjs';

/** The groups, in the order they are listed. A user looks for "tests" or "factory", not for an option kind. */
export const GROUPS = ['factory', 'planning', 'tests', 'review', 'commits', 'docs', 'checks', 'rules', 'skills', 'release', 'design', 'templates', 'stack', 'other'];

const GROUP_OF = {
  'control.planning.gates': 'planning',
  'skill.goal-first-planner': 'planning',
  'setting.plan-mode-default': 'planning',
  'control.docs.check': 'docs',
  'control.docs.sizeWarnChars': 'docs',
  'rule.docs-fresh': 'docs',
  'skill.write-project-overview': 'docs',
  'control.tests.guard': 'tests',
  'control.tests.tdd': 'tests',
  'control.tests.e2e': 'tests',
  'rule.test-discipline': 'tests',
  'check.test-edit-guard': 'tests',
  'check.e2e-shots': 'tests',
  'skill.e2e-tests': 'tests',
  'control.review.mode': 'review',
  'review-gate': 'review',
  'check.reviewer-guard': 'review',
  'rule.commit-gate': 'commits',
  'hook.pre-commit': 'commits',
  'hook.pre-push': 'commits',
  'skill.pr-description': 'commits',
  'control.claude.runChecks': 'checks',
  'control.static.checks': 'checks',
  'check.static': 'checks',
  'check.claude': 'checks',
  'factory-core': 'factory',
  'skill.run-factory': 'factory',
  'skill.changelog-bump': 'release',
  'workflow.release-bump': 'release',
  'skill.figma-sync': 'design',
  'rule.ui-change-flagging': 'design',
  'stack.expo-react-native': 'stack',
  'rule.expo-docs-first': 'stack',
};
const GROUP_OF_KIND = { rule: 'rules', skill: 'skills', template: 'templates' };

export function groupOf(option) {
  if (GROUP_OF[option.id]) return GROUP_OF[option.id];
  if (option.id.startsWith('control.factory.')) return 'factory';
  return GROUP_OF_KIND[option.kind] ?? 'other';
}

/** Reads the catalog, the record of what was chosen, and the workflow file. Throws when the kit folder is missing. */
export function readSetup(dir) {
  const kitDir = join(dir, TARGET);
  const catalogPath = join(kitDir, 'catalog', 'options.json');
  if (!existsSync(catalogPath)) {
    throw new Error(`no kit folder found at ${kitDir}; run "ai-workspace-kit init" and the setup first`);
  }
  const { options: catalog } = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const warnings = [];

  let record = null;
  try {
    record = JSON.parse(readFileSync(join(kitDir, 'choices.json'), 'utf8'));
  } catch {
    warnings.push('no choices.json record in the kit folder (setup has not run, or an older install): switch states are unknown');
  }
  const enabled = new Set(record?.enabled ?? []);

  const workflow = loadWorkflowConfig(dir, {});
  warnings.push(...workflow.warnings);

  const options = catalog.map((entry) => {
    const isControl = entry.kind === 'control';
    const requires = entry.requires ?? [];
    const option = {
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      group: groupOf(entry),
      what: entry.what,
      impact: entry.impact,
      requires,
      requiredBy: [],
      missing: record ? requires.filter((id) => !enabled.has(id)) : [],
    };
    if (isControl) {
      const resolved = workflow.controls[entry.control];
      option.control = entry.control;
      option.state = resolved ? String(resolved.value) : 'unknown';
      option.source = resolved?.source;
      option.allowed = Object.keys(entry.values ?? {});
    } else {
      option.state = record ? (enabled.has(entry.id) ? 'on' : 'off') : 'unknown';
    }
    return option;
  });
  for (const option of options) {
    if (option.state !== 'on' || option.kind === 'control') continue;
    for (const needed of option.requires) {
      options.find((other) => other.id === needed)?.requiredBy.push(option.id);
    }
  }
  // A control can be on (by the profile) while the piece that makes it work is not installed: the setting then does nothing.
  const hints = [];
  for (const control of options.filter((option) => option.kind === 'control' && !isIdle(option))) {
    for (const piece of options) {
      if (piece.kind === 'control' || piece.state !== 'off' || !piece.requires.includes(control.id)) continue;
      hints.push({
        control: control.control,
        value: control.state,
        option: piece.id,
        group: piece.group,
        text: `${control.control} is ${control.state}, but ${piece.id} (${piece.title}) is off, so that part is not installed. Install it with: config on ${piece.id}`,
      });
    }
  }
  return { profile: workflow.profile, profileSource: workflow.profileSource, tools: record?.tools ?? [], options, hints, warnings };
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** Up to three of `names` that are close to `wanted` (a typo), nearest first. */
export function closest(names, wanted) {
  return names
    .map((name) => ({ name, score: distance(wanted, name) }))
    .filter((entry) => entry.score <= 3)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((entry) => entry.name);
}

/** One option by id. An unknown id gets the closest ids as a hint. */
export function getOption(setup, id) {
  const found = setup.options.find((option) => option.id === id);
  if (found) return found;
  const close = closest(setup.options.map((option) => option.id), id);
  throw new Error(`unknown option "${id}"${close.length ? `. Did you mean: ${close.join(', ')}?` : '. Run "config list" to see the ids'}`);
}

/** An option that is off or unset costs nothing to turn on (its requirements come with it); one that is on without them is broken. */
const isIdle = (option) => ['off', '0', 'unknown'].includes(option.state);

function needsNote(option) {
  if (!option.missing.length) return '';
  const list = option.missing.join(', ');
  return isIdle(option) ? `   (turning on also adds ${list})` : `   (BROKEN: needs ${list}, which is off)`;
}

/** The grouped list, one line per option. `group` limits it to one group. */
export function formatList(setup, { group } = {}) {
  if (group !== undefined && !GROUPS.includes(group)) throw new Error(`unknown group "${group}". Groups: ${GROUPS.join(', ')}`);
  const lines = [`Profile: ${setup.profile} (${setup.profileSource})${setup.tools.length ? `   Tools: ${setup.tools.join(', ')}` : ''}`];
  const width = Math.max(...setup.options.map((option) => option.id.length));
  for (const name of group ? [group] : GROUPS) {
    const members = setup.options.filter((option) => option.group === name);
    if (!members.length) continue;
    lines.push('', `[${name}]`);
    for (const option of members) {
      lines.push(`  ${option.id.padEnd(width)}  ${option.state.padEnd(8)} ${option.title}${needsNote(option)}`);
    }
  }
  const hints = setup.hints.filter((hint) => !group || hint.group === group);
  if (hints.length) lines.push('', 'Hints:', ...hints.map((hint) => `  ${hint.text}`));
  for (const warning of setup.warnings) lines.push(`warning: ${warning}`);
  lines.push('', 'State: "on"/"off" for a switch, the current value for a control, "unknown" when no record exists. "config get <id>" explains one.');
  return lines.join('\n');
}

/** The detail view of one option. */
export function formatGet(option) {
  const lines = [`${option.id}: ${option.title}`, `  group:     ${option.group}`, `  state:     ${option.state}${option.source ? `  (${option.source})` : ''}`];
  if (option.allowed?.length) lines.push(`  values:    ${option.allowed.join(' | ')}`);
  lines.push(`  what:      ${option.what}`, `  impact:    ${option.impact}`);
  if (option.requires.length) lines.push(`  needs:     ${option.requires.join(', ')}`);
  if (option.missing.length) {
    const list = option.missing.join(', ');
    lines.push(isIdle(option) ? `  adds:      ${list} (off now; turning this on adds it)` : `  BROKEN:    needs ${list}, which is off`);
  }
  if (option.requiredBy.length) lines.push(`  needed by: ${option.requiredBy.join(', ')}`);
  return lines.join('\n');
}
