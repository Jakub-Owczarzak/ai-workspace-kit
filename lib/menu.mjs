// `config menu`: a numbered terminal menu over the same engines the `config` commands use. It reads answers line by line
// (a number, or the name shown next to it), so it works in any terminal, over a pipe and in a test, with no dependency.
// There are no arrow keys or checkboxes: that needs raw terminal handling, which is fragile on Windows and in IDE terminals.
//
// Nothing is applied on selection. Every change shows the plan a dry run produced and asks "Apply this? [y/N]"; only a
// yes applies it, and an empty answer, a no or a closed input changes nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { CONTROL_SPECS } from '../templates/scripts/workflow-config.mjs';
import { GROUPS, formatGet, formatList, readSetup } from './config.mjs';
import { allowedText, formatControlPlan, formatProfilePlan, setControl, setProfile } from './controls.mjs';
import { formatFeature, formatFeaturePlan, leftoverOptions, readFeatures, setFeature, stateText } from './features.mjs';
import { TARGET } from './init.mjs';
import { formatPlan, setOptions, shownUnneeded } from './reconcile.mjs';

const QUIT = Symbol('quit');
const BACK = Symbol('back');
const GIT_HINT = 'Review the changes with "git status" and "git diff".';

/** Runs the menu until the user quits or the input ends. Throws at once when the project has no kit folder. */
export async function runMenu({ dir, input = process.stdin, output = process.stdout }) {
  readSetup(dir);
  const rl = createInterface({ input, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const say = (text = '') => output.write(`${text}\n`);

  /** One answer, trimmed; null when the input has ended. */
  const ask = async (prompt) => {
    output.write(prompt);
    const next = await lines.next();
    if (next.done) {
      output.write('\n');
      return null;
    }
    // In a terminal the typed answer and its Enter are already on screen; a piped answer is echoed so the log reads like a session.
    if (!input.isTTY) output.write(`${next.value}\n`);
    return next.value.trim();
  };
  const isYes = (answer) => answer !== null && /^y(es)?$/i.test(answer);
  const confirm = async () => isYes(await ask('Apply this? [y/N] '));

  /** Choose from numbered items by number or by name. Returns the item, BACK or QUIT; asks again on anything else. */
  const pick = async (items, { prompt = 'Choose', back = true } = {}) => {
    for (;;) {
      const answer = await ask(`${prompt} (number or name${back ? ', b = back' : ''}, q = quit): `);
      if (answer === null || /^q(uit)?$/i.test(answer)) return QUIT;
      if (back && /^b(ack)?$/i.test(answer)) return BACK;
      const found = (/^\d+$/.test(answer) ? items[Number(answer) - 1] : undefined) ?? items.find((item) => item.key.toLowerCase() === answer.toLowerCase());
      if (found) return found;
      say(`"${answer}" is not a choice here.`);
    }
  };
  const list = (items) => {
    const width = String(items.length).length;
    items.forEach((item, index) => say(`  ${String(index + 1).padStart(width)}. ${item.label}`));
  };

  /** Runs `preview(cascade)`; when it is refused only because other options need the ones named, offers --cascade. */
  const previewOrExplain = async (preview) => {
    let cascade = false;
    for (;;) {
      try {
        return { plan: preview(cascade), cascade };
      } catch (error) {
        say(`Cannot do that: ${error.message}`);
        if (!cascade && /--cascade/.test(error.message) && isYes(await ask('Turn those off as well? [y/N] '))) {
          cascade = true;
          continue;
        }
        say('Nothing was changed.');
        return null;
      }
    }
  };

  /** Shows a previewed plan, asks, applies with `run`, shows the result. */
  const reviewAndApply = async (plan, format, run) => {
    say();
    say(format(plan));
    if (!plan.changed) return;
    if (!(await confirm())) {
      say('Nothing was changed.');
      return;
    }
    const done = run();
    say();
    say(format(done));
    say(GIT_HINT);
  };

  const featureScreen = async () => {
    const data = readFeatures(dir);
    const items = [];
    say();
    say('Features (on, off or partial)');
    const width = Math.max(...[...data.features, ...data.presets].map((item) => item.id.length));
    for (const group of data.groups) {
      const members = data.features.filter((item) => item.group === group);
      if (!members.length) continue;
      say(`[${group}]`);
      for (const item of members) {
        items.push({ key: item.id, item });
        say(`  ${String(items.length).padStart(2)}. ${item.id.padEnd(width)}  ${stateText(item).padEnd(14)} ${item.title}`);
      }
    }
    if (data.presets.length) say('[presets]');
    for (const item of data.presets) {
      items.push({ key: item.id, item });
      say(`  ${String(items.length).padStart(2)}. ${item.id.padEnd(width)}  ${stateText(item).padEnd(14)} ${item.title} (${item.features.join(' + ')})`);
    }
    const chosen = await pick(items, { prompt: 'Which feature' });
    if (chosen === QUIT || chosen === BACK) return chosen;

    const { item } = chosen;
    say();
    say(formatFeature(item));
    const actions = [{ key: 'on', label: 'Turn on' }, { key: 'off', label: 'Turn off' }];
    list(actions);
    const action = await pick(actions, { prompt: 'Action' });
    if (action === QUIT || action === BACK) return action;

    let level;
    if (action.key === 'on' && item.kind === 'feature' && item.levels.length > 1) {
      say();
      say(`Ways to turn on ${item.id}:`);
      const levels = item.levels.map((name) => {
        const set = name === 'on' ? null : Object.entries(item.levelDefinitions[name].controls ?? {}).map(([control, value]) => `${control}=${value}`).join(', ');
        return { key: name, label: name === 'on' ? 'on (the basic way)' : `${name}${set ? ` (sets ${set})` : ''}` };
      });
      list(levels);
      const way = await pick(levels, { prompt: 'Which way' });
      if (way === QUIT || way === BACK) return way;
      level = way.key;
    }
    let prune = false;
    let previewed = await previewOrExplain((cascade) => setFeature({ dir, name: item.id, state: action.key, level, cascade, prune, dryRun: true }));
    // An off can leave options on that nothing needs any more (the plan says so): offer to turn those off as well.
    const left = previewed && action.key === 'off' ? leftoverOptions(previewed.plan) : [];
    if (left.length) {
      say();
      say(formatFeaturePlan(previewed.plan));
      if (isYes(await ask(`Also turn off those (${left.join(', ')})? [y/N] `))) {
        prune = true;
        previewed = await previewOrExplain((cascade) => setFeature({ dir, name: item.id, state: 'off', cascade, prune, dryRun: true }));
      }
    }
    if (previewed) await reviewAndApply(previewed.plan, formatFeaturePlan, () => setFeature({ dir, name: item.id, state: action.key, level, cascade: previewed.cascade, prune }));
    return undefined;
  };

  const profileScreen = async () => {
    const catalog = JSON.parse(readFileSync(join(dir, TARGET, 'catalog', 'options.json'), 'utf8'));
    const current = readSetup(dir).profile;
    say();
    say(`Profile (now: ${current})`);
    const items = catalog.profiles.map((profile) => ({ key: profile.id, label: `${profile.id}: ${profile.forWho}`, profile }));
    list(items);
    for (const { profile } of items) say(`     ${profile.id}: ${profile.summary}`);
    const chosen = await pick(items, { prompt: 'Which profile' });
    if (chosen === QUIT || chosen === BACK) return chosen;

    const first = setProfile({ dir, profile: chosen.key, dryRun: true });
    let installDefaults = false;
    if (first.missingDefaults.length) {
      say();
      say(`${chosen.key} turns on by default: ${first.missingDefaults.map((item) => `${item.id} (${item.title})`).join('; ')}.`);
      installDefaults = isYes(await ask('Also install those now? [y/N] '));
    }
    const plan = setProfile({ dir, profile: chosen.key, installDefaults, dryRun: true });
    await reviewAndApply(plan, formatProfilePlan, () => setProfile({ dir, profile: chosen.key, installDefaults }));
    return undefined;
  };

  const controlScreen = async () => {
    const controls = readSetup(dir).options.filter((option) => option.kind === 'control');
    say();
    say('Controls (fine-tuning)');
    const width = Math.max(...controls.map((option) => option.control.length));
    const items = controls.map((option) => ({ key: option.control, option, label: `${option.control.padEnd(width)}  ${option.state.padEnd(9)} ${option.title}` }));
    list(items);
    const chosen = await pick(items, { prompt: 'Which control' });
    if (chosen === QUIT || chosen === BACK) return chosen;

    say();
    say(formatGet(chosen.option));
    say(`Allowed: ${allowedText(CONTROL_SPECS[chosen.key])}`);
    for (;;) {
      const value = await ask("New value (Enter to cancel, 'default' to clear your override): ");
      if (value === null) return QUIT;
      if (value === '') return undefined;
      let plan;
      try {
        plan = setControl({ dir, name: chosen.key, value, dryRun: true });
      } catch (error) {
        say(`Cannot do that: ${error.message}`);
        continue;
      }
      await reviewAndApply(plan, formatControlPlan, () => setControl({ dir, name: chosen.key, value }));
      return undefined;
    }
  };

  const piecesScreen = async () => {
    const setup = readSetup(dir);
    const pieces = setup.options.filter((option) => option.kind !== 'control');
    say();
    say('Single pieces (advanced). Most people use Features instead.');
    const groups = GROUPS.map((group) => ({ key: group, members: pieces.filter((option) => option.group === group) })).filter((entry) => entry.members.length);
    const groupItems = groups.map((entry) => ({ ...entry, label: `${entry.key} (${entry.members.length} pieces)` }));
    list(groupItems);
    const group = await pick(groupItems, { prompt: 'Which group' });
    if (group === QUIT || group === BACK) return group;

    const width = Math.max(...group.members.map((option) => option.id.length));
    const items = group.members.map((option) => ({ key: option.id, option, label: `${option.id.padEnd(width)}  ${option.state.padEnd(7)} ${option.title}` }));
    say();
    list(items);
    const chosen = await pick(items, { prompt: 'Which piece' });
    if (chosen === QUIT || chosen === BACK) return chosen;

    const { option } = chosen;
    if (option.state === 'unknown') {
      say('There is no record of what is installed, so this cannot be changed from here.');
      return undefined;
    }
    const verb = option.state === 'on' ? 'off' : 'on';
    say();
    say(formatGet(option));
    if (!isYes(await ask(`Turn ${option.id} ${verb}? [y/N] `))) {
      say('Nothing was changed.');
      return undefined;
    }
    let prune = false;
    let previewed = await previewOrExplain((cascade) => setOptions({ dir, [verb]: [option.id], cascade, prune, dryRun: true }));
    const left = previewed && verb === 'off' ? shownUnneeded(previewed.plan) : [];
    if (left.length) {
      say();
      say(formatPlan(previewed.plan));
      if (isYes(await ask(`Also turn off those (${left.join(', ')})? [y/N] `))) {
        prune = true;
        previewed = await previewOrExplain((cascade) => setOptions({ dir, off: [option.id], cascade, prune, dryRun: true }));
      }
    }
    if (previewed) await reviewAndApply(previewed.plan, formatPlan, () => setOptions({ dir, [verb]: [option.id], cascade: previewed.cascade, prune }));
    return undefined;
  };

  const main = [
    { key: 'features', label: 'Features: turn a capability on or off (TDD, factory, commit and PR protection, ...)', run: featureScreen },
    { key: 'profile', label: 'Profile: solo, team or org', run: profileScreen },
    { key: 'controls', label: 'Controls: fine-tune a single setting', run: controlScreen },
    { key: 'pieces', label: 'Single pieces (advanced): rules, skills, hooks, checks one by one', run: piecesScreen },
    { key: 'everything', label: 'Show everything', run: async () => { say(); say(formatList(readSetup(dir))); } },
  ];

  try {
    for (;;) {
      const setup = readSetup(dir);
      say();
      say(`Workspace kit manager (profile: ${setup.profile})`);
      list(main);
      const chosen = await pick(main, { prompt: 'What do you want to change', back: false });
      if (chosen === QUIT) return;
      try {
        if ((await chosen.run()) === QUIT) return;
      } catch (error) {
        say(`Something went wrong: ${error.message}`);
      }
    }
  } finally {
    rl.close();
  }
}
