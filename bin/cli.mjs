#!/usr/bin/env node
import { resolve } from 'node:path';
import { init, TARGET } from '../lib/init.mjs';

const HELP = `workspace-kit: install the workspace kit into a project

Usage:
  npx @jakub-owczarzak/workspace-kit init [--dir <path>] [--dry-run] [--force]

Options:
  --dir <path>  project folder (default: current folder)
  --dry-run     show what would change, write nothing
  --force       overwrite kit files that differ
  -h, --help    show this help`;

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || cmd === '-h' || cmd === '--help') {
  console.log(HELP);
  process.exit(0);
}
if (cmd !== 'init') {
  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  process.exit(1);
}

const flag = (name) => args.includes(name);
const dirIndex = args.indexOf('--dir');
if (dirIndex !== -1 && !args[dirIndex + 1]) {
  console.error('--dir needs a path');
  process.exit(1);
}
const dir = resolve(dirIndex !== -1 ? args[dirIndex + 1] : '.');

const result = init({ dir, dryRun: flag('--dry-run'), force: flag('--force') });
const verb = flag('--dry-run') ? 'would copy' : 'copied';
const kitPath = TARGET.split('\\').join('/');
console.log(`Kit folder: ${result.dest}`);
console.log(
  `${verb}: ${result.created.length}, unchanged: ${result.unchanged.length}, ` +
    `skipped (differs, use --force): ${result.skipped.length}`
);
console.log(
  `\nNext: open your AI tool in this project and run the setup prompt:\n` +
    `  "Run the setup-workspace skill from ${kitPath}/skills/setup-workspace/SKILL.md"`
);
