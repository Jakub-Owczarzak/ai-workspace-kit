#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { init, TARGET } from '../lib/init.mjs';
import { apply } from '../lib/apply.mjs';

const HELP = `workspace-kit: install the workspace kit into a project

Usage:
  npx @jakub-owczarzak/workspace-kit init  [--dir <path>] [--dry-run] [--force]
  node .claude/workspace-kit/bin/cli.mjs apply --choices <file> [--dir <path>] [--dry-run] [--force]

Commands:
  init    copy the kit into <project>/.claude/workspace-kit/ (nothing else is touched)
  apply   install the pieces named in a choices file (written by the setup prompt)

Options:
  --dir <path>      project folder (default: current folder)
  --choices <file>  JSON: { "profile": "solo", "tools": ["claude-code"], "enabled": ["rule.verification", ...] }
  --dry-run         show what would change, write nothing
  --force           replace files that already exist and differ
  -h, --help        show this help`;

const args = process.argv.slice(2);
const command = args[0];
if (!command || command === '-h' || command === '--help') {
  console.log(HELP);
  process.exit(0);
}
if (command !== 'init' && command !== 'apply') {
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
  console.log(
    `${verb}: ${result.created.length}, unchanged: ${result.unchanged.length}, ` +
      `skipped (differs, use --force): ${result.skipped.length}`
  );
  console.log(
    `\nNext: open your AI tool in this project and run the setup prompt:\n` +
      `  "Run the setup-workspace skill from ${kitPath}/skills/setup-workspace/SKILL.md"\n` +
      `No skill support in your tool? Paste the text in ${kitPath}/docs/setup-prompt.md instead.`
  );
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
    for (const item of report.manual) console.log(`MANUAL  ${item.path}: ${item.reason}`);
  } catch (error) {
    console.error(`apply failed: ${error.message}`);
    process.exit(1);
  }
}
