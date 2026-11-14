// Changes control values and the workflow profile after the first install (`config set`, `config unset`, `config profile`).
//
// Both live in .claude/workflow.json, a file that belongs to the project: `profile` (solo, team, org) and `overrides`
// (a control name -> value, for the controls that should differ from the profile). Values are checked by the kit's own
// resolver (templates/scripts/workflow-config.mjs), the code the scripts use, so what is accepted here is what is read
// there. Only the keys involved are edited; other keys and the indentation of the file stay. A file that is not valid
// JSON is refused with nothing written.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROL_SPECS, PROFILES, PROFILE_NAMES, normalizeValue, resolveControls } from '../templates/scripts/workflow-config.mjs';
import { closest } from './config.mjs';
import { TARGET } from './init.mjs';
import { fingerprint, loadManifest, saveManifest } from './manifest.mjs';
import { setOptions } from './reconcile.mjs';

const WORKFLOW_FILE = '.claude/workflow.json';
const isIdleValue = (value) => value === 'off' || value === false || value === 0;

function readKit(dir) {
  const kitDir = join(dir, TARGET);
  const catalogPath = join(kitDir, 'catalog', 'options.json');
  if (!existsSync(catalogPath)) throw new Error(`no kit folder found at ${kitDir}; run "ai-workspace-kit init" and the setup first`);
  const { options } = JSON.parse(readFileSync(catalogPath, 'utf8'));
  let record;
  try {
    record = JSON.parse(readFileSync(join(kitDir, 'choices.json'), 'utf8'));
  } catch {
    throw new Error(`there is no choices.json record in ${kitDir}, so there is nothing to change yet: run the setup first`);
  }
  return { kitDir, options, record };
}

/** The workflow file as an object, with the indentation it uses. A missing file is a new one from the recorded profile. */
function loadWorkflow(dir, record) {
  const path = join(dir, WORKFLOW_FILE);
  if (!existsSync(path)) return { object: { profile: record.profile ?? 'solo', overrides: {} }, indent: 2, existed: false, text: null };
  const text = readFileSync(path, 'utf8');
  let object;
  try {
    object = JSON.parse(text);
  } catch (error) {
    throw new Error(`${WORKFLOW_FILE} is not valid JSON (${error.message}); fix it by hand first. Nothing was changed`);
  }
  if (object === null || typeof object !== 'object' || Array.isArray(object)) throw new Error(`${WORKFLOW_FILE} must hold a JSON object; fix it by hand first. Nothing was changed`);
  if (object.overrides !== undefined && (object.overrides === null || typeof object.overrides !== 'object' || Array.isArray(object.overrides))) {
    throw new Error(`"overrides" in ${WORKFLOW_FILE} must be an object; fix it by hand first. Nothing was changed`);
  }
  object.overrides = object.overrides ?? {};
  return { object, indent: text.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? 2, existed: true, text };
}

function saveWorkflow(dir, { object, indent, existed, text }) {
  const content = JSON.stringify(object, null, indent) + '\n';
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, WORKFLOW_FILE), content);
  const manifest = loadManifest(dir);
  if (!manifest) return;
  // A file the kit now created is recorded like one apply writes. A file the kit wrote and nobody edited by hand stays
  // the kit's after the kit's own edit, so an uninstall removes it; one you edited yourself stays yours.
  const recorded = manifest.files[WORKFLOW_FILE];
  if (!existed || (recorded !== undefined && recorded === fingerprint(text))) {
    manifest.files[WORKFLOW_FILE] = fingerprint(content);
    saveManifest(dir, manifest);
  }
}

/** Keeps choices.json in step with the workflow file, from what is on disk now. */
function syncRecord(dir, change) {
  const path = join(dir, TARGET, 'choices.json');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...record, ...change }, null, 2) + '\n');
}

export const allowedText = (spec) => (spec.type === 'choice' ? spec.allowed.join(', ') : spec.type === 'boolean' ? 'on, off' : 'a number, 0 or more');

function envWarnings(env, names) {
  return names.filter((name) => env[name] !== undefined && env[name] !== '').map((name) => `${name} is set in this shell and wins over the file for commands run from it`);
}

/**
 * Sets one control. `value` is checked against the control's allowed values; "default" removes the override so the
 * profile decides. A value equal to the profile's own default is not stored as an override. Turning a control on also
 * turns on the options it needs; turning it off removes nothing. Returns the plan (before and after, requirements).
 */
export function setControl({ dir, name: rawName, value, dryRun = false, env = process.env }) {
  const { options, record } = readKit(dir);
  const name = String(rawName).replace(/^control\./, '');
  const spec = CONTROL_SPECS[name];
  if (!spec) {
    const close = closest(Object.keys(CONTROL_SPECS), name);
    throw new Error(`unknown control "${rawName}"${close.length ? `. Did you mean: ${close.join(', ')}?` : '. Run "config list" to see the controls'}`);
  }
  const resetting = String(value).trim().toLowerCase() === 'default';
  let checked;
  if (!resetting) {
    checked = normalizeValue(spec, value);
    if (!checked.ok) throw new Error(`"${value}" is not a valid value for ${name} (allowed: ${allowedText(spec)})`);
  }

  const workflow = loadWorkflow(dir, record);
  const overridesBefore = workflow.object.overrides;
  const before = resolveControls(workflow.object, {});
  const overrides = { ...overridesBefore };
  if (resetting || checked.value === PROFILES[before.profile][name]) delete overrides[name];
  else overrides[name] = checked.value;
  const after = resolveControls({ ...workflow.object, overrides }, {});

  const plan = {
    changed: JSON.stringify(overrides) !== JSON.stringify(overridesBefore),
    dryRun,
    control: name,
    before: before.controls[name],
    after: after.controls[name],
    overrideRemoved: name in overridesBefore && !(name in overrides),
    profile: before.profile,
    addedRequirements: [],
    requirements: null,
    warnings: envWarnings(env, [spec.env]),
  };
  if (!plan.changed) return plan;

  // A control that is turned on needs the options its catalog entry lists (a rule, a hook): turn those on as well.
  const needs = options.find((option) => option.id === `control.${name}`)?.requires ?? [];
  const missing = needs.filter((id) => !(record.enabled ?? []).includes(id));
  if (missing.length && !isIdleValue(plan.after.value)) {
    plan.requirements = setOptions({ dir, on: missing, dryRun });
    plan.addedRequirements = [...plan.requirements.turnedOn, ...plan.requirements.addedRequirements];
  }
  if (dryRun) return plan;

  workflow.object.overrides = overrides;
  saveWorkflow(dir, workflow);
  syncRecord(dir, { overrides });
  return plan;
}

/**
 * Changes the profile and nothing else: every override stays. The plan lists the controls whose value moves, the ones
 * the user's overrides pin, and the options that are on by default for the new profile and not installed (they are
 * installed only with `installDefaults`; nothing is ever turned off).
 */
export function setProfile({ dir, profile, installDefaults = false, dryRun = false, env = process.env }) {
  const { options, record } = readKit(dir);
  if (!PROFILE_NAMES.includes(profile)) throw new Error(`unknown profile "${profile}". Profiles: ${PROFILE_NAMES.join(', ')}`);
  const workflow = loadWorkflow(dir, record);
  const before = resolveControls(workflow.object, {});
  const plan = { changed: false, dryRun, from: before.profile, to: profile, changes: [], overridden: [], missingDefaults: [], idlePieces: [], installed: null, warnings: envWarnings(env, ['WORKFLOW_PROFILE']) };
  const same = before.profile === profile && workflow.object.profile === profile;
  if (same && !installDefaults) return plan;
  // Already on this profile with --install-defaults: install what it adds over the base profile (solo).
  const baseProfile = same ? 'solo' : before.profile;
  plan.changed = !same;

  const after = resolveControls({ ...workflow.object, profile }, {});
  if (!same) {
    for (const [control, now] of Object.entries(after.controls)) {
      if (now.value !== before.controls[control].value) plan.changes.push({ control, before: before.controls[control].value, after: now.value, source: now.source });
    }
    for (const [control, now] of Object.entries(after.controls)) {
      if (now.source === 'overrides') plan.overridden.push({ control, value: now.value });
    }
    // Pieces that are installed for a control this switch turns off keep sitting in the project, doing nothing.
    const turnedOffControls = new Set(plan.changes.filter((change) => isIdleValue(change.after) && !isIdleValue(change.before)).map((change) => `control.${change.control}`));
    plan.idlePieces = options
      .filter((option) => option.kind !== 'control' && (record.enabled ?? []).includes(option.id) && (option.requires ?? []).some((id) => turnedOffControls.has(id)))
      .map((option) => ({ id: option.id, title: option.title }));
  }
  const defaultOn = (option, name) => option.default === true || option.default?.[name] === true;
  const enabled = record.enabled ?? [];
  plan.missingDefaults = options
    .filter((option) => option.kind !== 'control' && !option.appliesWhen && defaultOn(option, profile) && !defaultOn(option, baseProfile) && !enabled.includes(option.id))
    .map((option) => ({ id: option.id, title: option.title }));
  plan.changed = plan.changed || plan.missingDefaults.length > 0;
  if (!plan.changed) return plan;
  if (dryRun) {
    if (installDefaults && plan.missingDefaults.length) plan.installed = setOptions({ dir, on: plan.missingDefaults.map((item) => item.id), dryRun: true });
    return plan;
  }

  if (!same) {
    workflow.object.profile = profile;
    saveWorkflow(dir, workflow);
    syncRecord(dir, { profile, overrides: workflow.object.overrides });
  }
  if (installDefaults && plan.missingDefaults.length) plan.installed = setOptions({ dir, on: plan.missingDefaults.map((item) => item.id) });
  return plan;
}

const show = (control) => `${control.value} (${control.source})`;

export function formatControlPlan(plan) {
  if (!plan.changed) return `Nothing to change: ${plan.control} is already ${show(plan.after)}.`;
  const would = plan.dryRun;
  const lines = [would ? '[dry run] nothing was changed. This is what would happen:' : 'Done.'];
  lines.push(`${plan.control}: ${show(plan.before)} -> ${show(plan.after)}`);
  if (plan.overrideRemoved) lines.push(`The override was removed; the ${plan.profile} profile decides now.`);
  if (plan.addedRequirements.length) lines.push(`${would ? 'Would also turn on' : 'Also turned on'} (the control needs them): ${plan.addedRequirements.join(', ')}`);
  for (const warning of plan.warnings) lines.push(`WARNING ${warning}`);
  return lines.join('\n');
}

export function formatProfilePlan(plan) {
  if (!plan.changed) return `Nothing to change: the profile is already ${plan.to}.`;
  const would = plan.dryRun;
  const lines = [would ? '[dry run] nothing was changed. This is what would happen:' : 'Done.', plan.from === plan.to ? `Profile: ${plan.to} (unchanged)` : `Profile: ${plan.from} -> ${plan.to}`];
  if (plan.changes.length) {
    const width = Math.max(...plan.changes.map((change) => change.control.length));
    lines.push(`${would ? 'Controls that would change' : 'Controls that changed'}:`, ...plan.changes.map((change) => `  ${change.control.padEnd(width)}  ${change.before} -> ${change.after}`));
  } else lines.push('No control changes value.');
  if (plan.overridden.length) lines.push(`Your overrides were kept: ${plan.overridden.map((item) => `${item.control}=${item.value}`).join(', ')}`);
  if (plan.idlePieces.length) {
    lines.push(
      `Installed but now idle (the control they serve is off): ${plan.idlePieces.map((item) => `${item.id} (${item.title})`).join('; ')}.`,
      `They do nothing now. Remove them with: config off ${plan.idlePieces.map((item) => item.id).join(' ')}.`
    );
  }
  if (plan.installed) {
    const ids = plan.installed.turnedOn;
    lines.push(`${would ? 'Would turn on' : 'Turned on'} what the ${plan.to} profile enables by default: ${ids.join(', ')}`);
    if (plan.installed.addedRequirements.length) lines.push(`${would ? 'Would add' : 'Added'} because they are needed: ${plan.installed.addedRequirements.join(', ')}`);
  } else if (plan.missingDefaults.length) {
    lines.push(
      `On by default for ${plan.to} but not installed (nothing was turned on): ${plan.missingDefaults.map((item) => `${item.id} (${item.title})`).join('; ')}.`,
      `Install them with: config profile ${plan.to} --install-defaults, or config on <id>.`
    );
  }
  for (const warning of plan.warnings) lines.push(`WARNING ${warning}`);
  return lines.join('\n');
}
