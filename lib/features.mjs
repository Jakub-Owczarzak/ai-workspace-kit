// Named features for `config feature`: a short name over the options (installed pieces) and control values that belong
// together, defined in catalog/features.json. This is the layer a menu or a prompt talks to; underneath it only calls
// the same engines as `config on|off` (reconcile.mjs) and `config set` (controls.mjs).
//
// "On" sets explicit values (a feature's `on` values, or a named level's); "off" removes only the feature's own options
// and sets its controls to their off value. Options a feature merely pulled in (the review gate for the factory) stay.
// Everything is checked with dry runs first, so a refusal (an option something else needs) changes nothing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closest, readSetup } from './config.mjs';
import { setControl } from './controls.mjs';
import { TARGET } from './init.mjs';
import { formatPlan, setOptions, shownUnneeded } from './reconcile.mjs';

function loadFeatureFile(dir) {
  const path = join(dir, TARGET, 'catalog', 'features.json');
  if (!existsSync(path)) throw new Error(`this kit folder has no catalog/features.json (an older copy of the kit): run "ai-workspace-kit init --force" to update it`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The options and control values a feature has at a level: the base ("on"), or the base changed by the named level. */
export function resolveLevel(definition, level = 'on') {
  const base = { options: definition.options ?? [], controls: Object.fromEntries(Object.entries(definition.controls ?? {}).map(([name, values]) => [name, values.on])) };
  if (level === 'on') return base;
  const extra = definition.levels[level];
  return { options: [...base.options, ...(extra.options ?? [])], controls: { ...base.controls, ...(extra.controls ?? {}) } };
}

/** Every feature and preset with its state (on, off, partial, unknown), its level when on, and what is missing when partial. */
export function readFeatures(dir) {
  const file = loadFeatureFile(dir);
  const setup = readSetup(dir);
  const known = !setup.options.some((option) => option.kind !== 'control' && option.state === 'unknown');
  const enabled = new Set(setup.options.filter((option) => option.kind !== 'control' && option.state === 'on').map((option) => option.id));
  const control = (name) => setup.options.find((option) => option.control === name);
  const matches = (name, wanted) => {
    const current = control(name);
    if (!current) return false;
    return wanted === 'default' ? String(current.source).startsWith('profile:') : String(wanted) === current.state;
  };

  const features = file.features.map((definition) => {
    const levels = definition.levels ?? {};
    const allOptions = [...(definition.options ?? []), ...Object.values(levels).flatMap((level) => level.options ?? [])];
    const offValues = Object.entries(definition.controls ?? {}).map(([name, values]) => [name, values.off]);
    const optionsOn = (definition.options ?? []).every((id) => enabled.has(id));
    const controlsOn = offValues.every(([name, off]) => !matches(name, off));
    const isOn = optionsOn && controlsOn;
    // Off means the pieces are not installed. A control resting at its profile default does nothing without them, so it
    // only decides for a feature that has no pieces (tdd, planning-gate).
    const isOff = allOptions.length ? allOptions.every((id) => !enabled.has(id)) : offValues.every(([name, off]) => matches(name, off));
    const state = !known ? 'unknown' : isOn ? 'on' : isOff ? 'off' : 'partial';

    let level = null;
    if (state === 'on') {
      const fits = (name) => {
        const resolved = resolveLevel(definition, name);
        return resolved.options.every((id) => enabled.has(id)) && Object.entries(resolved.controls).every(([control_, value]) => matches(control_, value));
      };
      level = [...Object.keys(levels), 'on'].find(fits) ?? 'custom';
    }
    const missing = [];
    if (state === 'partial') {
      for (const id of definition.options ?? []) if (!enabled.has(id)) missing.push(`${id} is off`);
      for (const [name, off] of offValues) if (matches(name, off)) missing.push(`${name} is ${off}`);
    }
    return { kind: 'feature', id: definition.id, group: definition.group, title: definition.title, what: definition.what, impact: definition.impact, note: definition.note, state, level, missing, levels: ['on', ...Object.keys(levels)], options: definition.options ?? [], controls: definition.controls ?? {}, levelDefinitions: levels };
  });

  const presets = file.presets.map((preset) => {
    const members = preset.features.map((id) => features.find((item) => item.id === id));
    const state = members.every((item) => item.state === 'on') ? 'on' : members.every((item) => item.state === 'off') ? 'off' : members.some((item) => item.state === 'unknown') ? 'unknown' : 'partial';
    return { kind: 'preset', id: preset.id, title: preset.title, what: preset.what, state, level: null, features: preset.features, missing: members.filter((item) => item.state !== state && state === 'partial').map((item) => `${item.id} is ${item.state}`) };
  });
  return { groups: file.groups, features, presets, warnings: setup.warnings };
}

/** One feature or preset by name. An unknown name gets the closest names as a hint. */
export function getFeature(data, name) {
  const found = [...data.features, ...data.presets].find((item) => item.id === name);
  if (found) return found;
  const close = closest([...data.features, ...data.presets].map((item) => item.id), name);
  throw new Error(`unknown feature "${name}"${close.length ? `. Did you mean: ${close.join(', ')}?` : '. Run "config feature list" to see them'}`);
}

const enabledNow = (dir) => new Set(readSetup(dir).options.filter((option) => option.kind !== 'control' && option.state === 'on').map((option) => option.id));

/**
 * Turns a feature (or a preset) on or off. `level` picks a named way to be on ("on" is the base). Returns the plan, with
 * the notes to read when something outward-facing or experimental was turned on. Everything is validated with dry runs
 * before anything is written.
 */
export function setFeature({ dir, name, state, level, cascade = false, prune = false, dryRun = false }) {
  const file = loadFeatureFile(dir);
  const definition = file.features.find((item) => item.id === name);
  const preset = file.presets.find((item) => item.id === name);
  if (!definition && !preset) getFeature(readFeatures(dir), name);
  if (state !== 'on' && state !== 'off') throw new Error('a feature is turned "on" or "off"');

  if (preset) {
    if (level !== undefined) throw new Error(`${name} is a preset and has no levels`);
    const order = state === 'on' ? preset.features : [...preset.features].reverse();
    for (const id of order) setFeature({ dir, name: id, state, cascade, prune, dryRun: true });
    const steps = order.map((id) => setFeature({ dir, name: id, state, cascade, prune, dryRun }));
    return { preset: true, feature: name, title: preset.title, state, level: null, dryRun, changed: steps.some((step) => step.changed), steps, notes: steps.flatMap((step) => step.notes), warnings: steps.flatMap((step) => step.warnings) };
  }

  const levels = definition.levels ?? {};
  if (level !== undefined && level !== 'on' && !levels[level]) {
    if (!Object.keys(levels).length) throw new Error(`${name} has no levels`);
    throw new Error(`unknown level "${level}" for ${name}. Levels: on, ${Object.keys(levels).join(', ')}`);
  }
  const levelName = level ?? 'on';
  const plan = { preset: false, feature: name, title: definition.title, state, level: state === 'on' ? levelName : null, dryRun, changed: false, optionsPlan: null, controlPlans: [], notes: [], warnings: [] };
  const enabled = enabledNow(dir);

  if (state === 'on') {
    const wanted = resolveLevel(definition, levelName);
    const missing = wanted.options.filter((id) => !enabled.has(id));
    const controls = Object.entries(wanted.controls);
    // Validate first: nothing is written if one of these refuses.
    const optionsCheck = missing.length ? setOptions({ dir, on: missing, dryRun: true }) : null;
    const controlChecks = controls.map(([control, value]) => setControl({ dir, name: control, value, dryRun: true }));
    if (dryRun) {
      plan.optionsPlan = optionsCheck;
      plan.controlPlans = controlChecks;
    } else {
      plan.optionsPlan = missing.length ? setOptions({ dir, on: missing }) : null;
      plan.controlPlans = controls.map(([control, value]) => setControl({ dir, name: control, value }));
    }
    if (definition.note) plan.notes.push(definition.note);
    if (levelName !== 'on' && levels[levelName].note) plan.notes.push(levels[levelName].note);
  } else {
    const own = [...(definition.options ?? []), ...Object.values(levels).flatMap((item) => item.options ?? [])].filter((id) => enabled.has(id));
    const controls = Object.entries(definition.controls ?? {}).map(([control, values]) => [control, values.off]);
    const optionsCheck = own.length ? setOptions({ dir, off: own, cascade, prune, dryRun: true }) : null;
    const controlChecks = controls.map(([control, value]) => setControl({ dir, name: control, value, dryRun: true }));
    if (dryRun) {
      plan.optionsPlan = optionsCheck;
      plan.controlPlans = controlChecks;
    } else {
      // The control goes off first, then the pieces it served.
      plan.controlPlans = controls.map(([control, value]) => setControl({ dir, name: control, value }));
      plan.optionsPlan = own.length ? setOptions({ dir, off: own, cascade, prune }) : null;
    }
  }
  plan.changed = plan.controlPlans.some((item) => item.changed) || Boolean(plan.optionsPlan?.changed);
  plan.warnings = [...plan.controlPlans.flatMap((item) => item.warnings), ...(plan.optionsPlan?.warnings ?? [])];
  if (!dryRun) {
    const after = getFeature(readFeatures(dir), name);
    plan.state = after.state;
    plan.level = after.level;
  }
  return plan;
}

/** The options a feature plan left on that nothing needs any more (controls left out), for the menu to offer to turn off. */
export const leftoverOptions = (plan) => [...new Set(plan.preset ? plan.steps.flatMap(leftoverOptions) : shownUnneeded(plan.optionsPlan))];

export const stateText = (item) => (item.level && item.level !== 'on' ? `${item.state} (${item.level})` : item.state);

/** The list of features by group, then the presets, with the state of each. */
export function formatFeatureList(data) {
  const lines = ['Features (on, off or partial). Turn one on or off with: config feature <name> on|off'];
  const width = Math.max(...[...data.features, ...data.presets].map((item) => item.id.length));
  for (const group of data.groups) {
    const members = data.features.filter((item) => item.group === group);
    if (!members.length) continue;
    lines.push('', `[${group}]`, ...members.map((item) => `  ${item.id.padEnd(width)}  ${stateText(item).padEnd(14)} ${item.title}`));
  }
  if (data.presets.length) {
    lines.push('', '[presets]', ...data.presets.map((item) => `  ${item.id.padEnd(width)}  ${stateText(item).padEnd(14)} ${item.title} (${item.features.join(' + ')})`));
  }
  const partial = [...data.features, ...data.presets].filter((item) => item.state === 'partial');
  if (partial.length) lines.push('', 'Partial (only part of it is in place):', ...partial.map((item) => `  ${item.id}: ${item.missing.join('; ')}`));
  for (const warning of data.warnings) lines.push(`warning: ${warning}`);
  return lines.join('\n');
}

/** The detail view of one feature or preset. */
export function formatFeature(item) {
  const lines = [`${item.id}: ${item.title}`, `  state:   ${stateText(item)}`];
  if (item.group) lines.push(`  group:   ${item.group}`);
  lines.push(`  what:    ${item.what}`);
  if (item.impact) lines.push(`  impact:  ${item.impact}`);
  if (item.kind === 'preset') lines.push(`  turns on: ${item.features.join(' + ')}`);
  else {
    if (item.options.length) lines.push(`  pieces:  ${item.options.join(', ')}`);
    for (const [name, values] of Object.entries(item.controls)) lines.push(`  control: ${name} = ${values.on} when on, ${values.off} when off`);
    if (item.levels.length > 1) lines.push(`  levels:  ${item.levels.join(', ')}  (config feature ${item.id} on <level>)`);
  }
  if (item.missing.length) lines.push(`  missing: ${item.missing.join('; ')}`);
  if (item.note) lines.push(`  note:    ${item.note}`);
  return lines.join('\n');
}

/** The plan as text for the terminal. */
export function formatFeaturePlan(plan) {
  const would = plan.dryRun;
  if (plan.preset) {
    const lines = [would ? '[dry run] nothing was changed. This is what would happen (each feature is shown on its own):' : 'Done.', `${plan.feature} -> ${plan.state}`];
    for (const step of plan.steps) lines.push('', ...formatFeaturePlan(step).split('\n').slice(1));
    return lines.join('\n');
  }
  const target = plan.state === 'on' && plan.level && plan.level !== 'on' ? `on (${plan.level})` : plan.state;
  if (!plan.changed) return `Nothing to change: ${plan.feature} is already ${target}.`;
  const lines = [would ? '[dry run] nothing was changed. This is what would happen:' : 'Done.', `${plan.feature} -> ${target}`];
  for (const item of plan.controlPlans.filter((control) => control.changed)) lines.push(`${item.control}: ${item.before.value} -> ${item.after.value}`);
  if (plan.optionsPlan?.changed) lines.push(...formatPlan(plan.optionsPlan).split('\n').slice(1));
  // An override that differs from the profile's default is how "off" is kept; say so, and how to go back to the default.
  if (plan.state === 'off') {
    for (const item of plan.controlPlans.filter((control) => control.changed && control.after.source === 'overrides')) {
      lines.push(`Override kept: ${item.control}=${item.after.value} in .claude/workflow.json (it keeps the setting off). "config unset ${item.control}" returns to the ${item.profile} profile's default.`);
    }
  }
  for (const note of plan.notes) lines.push(`NOTE    ${note}`);
  for (const warning of plan.warnings) lines.push(`WARNING ${warning}`);
  return lines.join('\n');
}
