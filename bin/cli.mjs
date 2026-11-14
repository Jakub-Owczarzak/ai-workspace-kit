#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { init, TARGET } from '../lib/init.mjs';
import { apply } from '../lib/apply.mjs';
import { uninstall } from '../lib/uninstall.mjs';
import { formatGet, formatList, getOption, readSetup } from '../lib/config.mjs';
import { formatPlan, setOptions } from '../lib/reconcile.mjs';
import { formatControlPlan, formatProfilePlan, setControl, setProfile } from '../lib/controls.mjs';
import { formatFeature, formatFeatureList, formatFeaturePlan, getFeature, readFeatures, setFeature } from '../lib/features.mjs';
import { runMenu } from '../lib/menu.mjs';

const HELP = `workspace-kit: install the workspace kit into a project

Usage:
  npx ai-workspace-kit init  [--dir <path>] [--dry-run] [--force]
  node .claude/workspace-kit/bin/cli.mjs apply --choices <file> [--dir <path>] [--dry-run] [--force]
  node .claude/workspace-kit/bin/cli.mjs uninstall [--dir <path>] [--yes] [--keep-kit] [--purge]
  node .claude/workspace-kit/bin/cli.mjs config menu [--dir <path>]
  node .claude/workspace-kit/bin/cli.mjs config list [--group <name>] [--json] [--dir <path>]
  node .claude/workspace-kit/bin/cli.mjs config get <id> [--json] [--dir <path>]
  node .claude/workspace-kit/bin/cli.mjs config on|off <id>... [--cascade] [--prune] [--dry-run] [--dir <path>]
  node .claude/workspace-kit/bin/cli.mjs config set <control> <value> | unset <control> [--dry-run] [--dir <path>]
  node .claude/workspace-kit/bin/cli.mjs config profile solo|team|org [--install-defaults] [--dry-run] [--dir <path>]
  node .claude/workspace-kit/bin/cli.mjs config feature [list | <name> | <name> on [level] | <name> off] [--cascade] [--prune] [--dry-run] [--json]

Commands:
  init       copy the kit into <project>/.claude/workspace-kit/ (nothing else is touched)
  apply      install the pieces named in a choices file (written by the setup prompt)
  uninstall  remove everything apply installed, using the record it kept. Shows a preview; --yes does it
  config     show the installed setup (list, get <id>), turn pieces on and off (on, off), change a control (set, unset),
             the workflow profile (profile), or turn a whole capability on or off by name (feature)

Options:
  --dir <path>      project folder (default: current folder)
  --choices <file>  JSON: { "profile": "solo", "tools": ["claude-code"], "enabled": ["rule.verification", ...] }
  --dry-run         show what would change, write nothing
  --force           init: replace kit files that differ (older copy). apply: replace files that exist and differ
  --yes             uninstall: actually remove (without it, uninstall only previews)
  --keep-kit        uninstall: keep .claude/workspace-kit/ so you can run the setup again
  --group <name>    config list: only one group (factory, planning, tests, review, commits, docs, checks, ...)
  --json            config list/get/on/off: machine-readable output
  --cascade         config off: also turn off the options that need the ones you name
  --prune           config off / config feature off: also turn off the options nothing that stays on needs any more
  --install-defaults  config profile: also turn on the options the new profile enables by default (never turns any off)
  --purge           uninstall: also remove the kit-created files you changed (PLAN.md, REVIEW.md, ...), an instruction
                    file the kit created, and .claude/reviews, .claude/state, .claude/factory. Without it, what is
                    kept is listed in a prompt you can paste into your AI tool
  -h, --help        show this help`;

const args = process.argv.slice(2);
const command = args[0];
if (!command || command === '-h' || command === '--help') {
  console.log(HELP);
  process.exit(0);
}
if (command !== 'init' && command !== 'apply' && command !== 'uninstall' && command !== 'config') {
  console.error(`Unknown command: ${command}\n\n${HELP}`);
  process.exit(1);
}

const flag = (name) => args.includes(name);
const valueOf = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (!args[index + 1]) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  return args[index + 1];
};
const dir = resolve(valueOf('--dir') ?? '.');
const dryRun = flag('--dry-run');
const force = flag('--force');

if (command === 'init') {
  const result = init({ dir, dryRun, force });
  const verb = dryRun ? 'would copy' : 'copied';
  const kitPath = TARGET.split('\\').join('/');
  console.log(`Kit folder: ${result.dest}`);
  if (result.blocked) {
    console.log(`\nNothing was written. ${result.skipped.length} file(s) in the kit folder differ from this version of the kit:`);
    for (const path of result.skipped) console.log(`  ${path.split('\\').join('/')}`);
    console.log(
      `\nThis is an older copy of the kit, or files you edited by hand. The kit folder is the kit's own, so it is\n` +
        `safe to replace, but it may be tracked in git: run again with --force, then review "git diff ${kitPath}".\n` +
        `Your own skills, hooks and instruction files are not touched by this command either way.`
    );
    process.exit(2);
  }
  console.log(`${verb}: ${result.created.length}, unchanged: ${result.unchanged.length}`);
  console.log(
    `\nNext: open your AI tool in this project and run the setup prompt:\n` +
      `  "Run the setup-workspace skill from ${kitPath}/skills/setup-workspace/SKILL.md"\n` +
      `No skill support in your tool? Paste the text in ${kitPath}/docs/setup-prompt.md instead.\n` +
      `\nLater, to switch features on or off or change the profile: run the manage-workspace skill from\n` +
      `${kitPath}/skills/manage-workspace/SKILL.md (or paste ${kitPath}/docs/config-prompt.md), or in a terminal:\n` +
      `  node ${kitPath}/bin/cli.mjs config menu`
  );
} else if (command === 'config') {
  const sub = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
  // The option ids after the subcommand: everything that is not a flag or a flag's value.
  const ids = [];
  for (let index = 2; index < args.length; index += 1) {
    if (['--dir', '--group', '--choices'].includes(args[index])) index += 1;
    else if (!args[index].startsWith('--')) ids.push(args[index]);
  }
  const id = ids[0];
  try {
    if (!sub) {
      console.log(
        'config: change the installed setup.\n' +
          '  config menu                    a numbered menu for everything below (asks before it changes anything)\n' +
          '  config feature list            the named capabilities and their state (then: config feature <name> on|off)\n' +
          '  config list                    every option and control, grouped\n' +
          '  config profile solo|team|org   change the profile\n' +
          '  config set|unset <control> ... change one control; config on|off <id>... one piece\n' +
          'Add --dry-run to any change to see it first. Full usage: --help'
      );
      process.exit(0);
    }
    if (sub === 'menu') {
      await runMenu({ dir, input: process.stdin, output: process.stdout });
      process.exit(0);
    }
    if (!['list', 'get', 'on', 'off', 'set', 'unset', 'profile', 'feature'].includes(sub)) {
      throw new Error('config needs "menu", "list", "get <id>", "on <id>...", "off <id>...", "set <control> <value>", "unset <control>", "profile <name>" or "feature ..."');
    }
    // A change prints its plan, then a reminder that these commands edit tracked files. The big nested reports are left out of --json.
    const finish = (plan, text) => {
      console.log(flag('--json') ? JSON.stringify(plan, (key, value) => (key === 'apply' || key === 'requirements' ? undefined : value), 2) : text);
      if (plan.changed && !plan.dryRun && !flag('--json')) console.log('\nReview the changes with "git status" and "git diff".');
      process.exit(0);
    };
    if (sub === 'get' && !id) throw new Error('config get needs an option id');
    if ((sub === 'on' || sub === 'off') && !ids.length) throw new Error(`config ${sub} needs at least one option id`);
    if (sub === 'set' || sub === 'unset') {
      if (!id || (sub === 'set' && ids[1] === undefined)) throw new Error(sub === 'set' ? 'config set needs a control and a value: config set docs.check strict' : 'config unset needs a control');
      const plan = setControl({ dir, name: id, value: sub === 'set' ? ids[1] : 'default', dryRun });
      finish(plan, formatControlPlan(plan));
    }
    if (sub === 'profile') {
      if (!id) throw new Error('config profile needs a name: solo, team or org');
      const plan = setProfile({ dir, profile: id, installDefaults: flag('--install-defaults'), dryRun });
      finish(plan, formatProfilePlan(plan));
    }
    if (sub === 'on' || sub === 'off') {
      const plan = setOptions({ dir, [sub]: ids, cascade: flag('--cascade'), prune: flag('--prune'), dryRun });
      finish(plan, formatPlan(plan));
    }
    if (sub === 'feature') {
      const data = readFeatures(dir);
      if (!id || id === 'list') {
        console.log(flag('--json') ? JSON.stringify(data, null, 2) : formatFeatureList(data));
        process.exit(0);
      }
      const item = getFeature(data, id);
      if (!ids[1]) {
        console.log(flag('--json') ? JSON.stringify(item, null, 2) : formatFeature(item));
        process.exit(0);
      }
      if (ids[1] !== 'on' && ids[1] !== 'off') throw new Error(`config feature ${id} needs "on" or "off"`);
      const plan = setFeature({ dir, name: id, state: ids[1], level: ids[2], cascade: flag('--cascade'), prune: flag('--prune'), dryRun });
      finish(plan, formatFeaturePlan(plan));
    }
    const setup = readSetup(dir);
    if (sub === 'list') {
      const group = valueOf('--group');
      const text = formatList(setup, { group });
      console.log(flag('--json') ? JSON.stringify({ ...setup, options: group ? setup.options.filter((o) => o.group === group) : setup.options }, null, 2) : text);
    } else {
      const option = getOption(setup, id);
      console.log(flag('--json') ? JSON.stringify(option, null, 2) : formatGet(option));
    }
  } catch (error) {
    console.error(`config failed: ${error.message}`);
    process.exit(1);
  }
} else if (command === 'uninstall') {
  try {
    const yes = flag('--yes');
    const report = uninstall({ dir, yes, keepKit: flag('--keep-kit'), purge: flag('--purge') });
    if (report.nothingToDo) {
      console.log(`Nothing to uninstall: ${TARGET.split('\\').join('/')} was not found in ${dir}.`);
      process.exit(0);
    }
    const tag = yes ? '' : '[preview] ';
    console.log(`${tag}${yes ? 'Removed' : 'Would remove'}:`);
    for (const path of report.removedFiles) console.log(`  file    ${path}`);
    for (const block of report.blocks) {
      console.log(`  block   ${block.file}: ${block.ids.join(', ')}${block.fileDeleted ? '  (the kit created this file, so the file goes too)' : ''}`);
    }
    if (report.settings) console.log(`  keys    ${report.settings.file}: ${report.settings.removed.join(', ')}${report.settings.fileDeleted ? '  (file removed)' : ''}`);
    if (report.packageScript) console.log(`  script  package.json: ${report.packageScript.name}`);
    for (const path of report.removedDirs) console.log(`  folder  ${path}  (empty)`);
    for (const path of report.purgedDirs) console.log(`  folder  ${path}/  (the kit's data, --purge)`);
    console.log(`  kit     ${TARGET.split('\\').join('/')}: ${report.kitFolder}`);
    for (const item of report.removedEdited) console.log(`EDITED  ${item.path}: removed anyway (${item.reason})`);
    for (const item of report.purged) {
      console.log(`PURGED  ${item.path}: you changed it, removed because of --purge${item.recoverable ? ' (git has this content: git restore brings it back)' : ' (NOT RECOVERABLE: git does not have this content)'}`);
    }
    for (const item of report.keptFiles) console.log(`KEPT    ${item.path}: ${item.reason}`);
    for (const item of report.manual) console.log(`MANUAL  ${item.path}: ${item.reason}`);
    for (const note of report.notices) console.log(`NOTE    ${note}`);
    if (!yes) console.log('\nNothing was changed. Run again with --yes to remove the above. Review the result with "git status" and "git diff".');
    else console.log('\nDone. Review the result with "git status" and "git diff".');
    if (report.cleanupPrompt) {
      console.log(
        `\nSome things were kept (listed above). To clean them with your AI tool, ${yes ? 'paste' : 'after the uninstall paste'} this into a new session in the project folder:\n` +
          report.cleanupPrompt.split('\n').map((line) => `  | ${line}`).join('\n') +
          (yes
            ? '\n\nThe kit folder and its record are gone, so this list exists only in this output: copy the prompt now.'
            : '\n\nOr remove them all without asking about each one: run it again with --purge --yes instead of --yes.')
      );
    }
  } catch (error) {
    console.error(`uninstall failed: ${error.message}`);
    process.exit(1);
  }
} else {
  const choicesPath = valueOf('--choices');
  if (!choicesPath) {
    console.error('apply needs --choices <file>');
    process.exit(1);
  }
  let choices;
  try {
    choices = JSON.parse(readFileSync(resolve(choicesPath), 'utf8'));
  } catch (error) {
    console.error(`cannot read choices file: ${error.message}`);
    process.exit(1);
  }
  try {
    const report = apply({ dir, choices, dryRun, force });
    const tag = dryRun ? '[dry run] ' : '';
    for (const [label, list] of [['created', report.created], ['updated', report.updated], ['unchanged', report.unchanged]]) {
      console.log(`${tag}${label}: ${list.length}`);
      for (const path of list) if (label !== 'unchanged') console.log(`  ${path}`);
    }
    if (report.addedRequirements.length) console.log(`added because chosen options need them: ${report.addedRequirements.join(', ')}`);
    for (const item of report.skipped) console.log(`SKIPPED ${item.path}: ${item.reason}`);
    for (const warning of report.warnings) console.log(`WARNING ${warning}`);
    for (const note of report.notices) console.log(`NOTE    ${note}`);
    for (const item of report.manual) {
      console.log(`MANUAL  ${item.path}: ${item.reason}`);
      if (item.snippet) console.log(item.snippet.split('\n').map((line) => `    | ${line}`).join('\n'));
    }
  } catch (error) {
    console.error(`apply failed: ${error.message}`);
    process.exit(1);
  }
}
