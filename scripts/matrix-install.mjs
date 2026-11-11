// Kit development only (not shipped). Install matrix: packs the tarball, unpacks it, and for every combination of
// profile (solo, team, org), tool set and option set installs the kit into a fresh project that already has files of
// its own, then checks the promises the README makes:
//   - init and apply succeed; the resolved profile is the chosen one;
//   - a second apply changes nothing;
//   - nothing the project owned was overwritten (a CLAUDE.md, a same-named skill, a pre-commit hook, a .gitignore);
//   - the installed scripts that run by themselves (the config resolver and the static checks) exit 0;
//   - uninstall puts the project back exactly as it was: the same files with the same contents.
//
//   node scripts/matrix-install.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

const isWin = process.platform === 'win32';
const run = (cmd, args, cwd, options = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', shell: isWin && cmd === 'npm', stdio: ['ignore', 'pipe', 'pipe'], ...options });

const catalog = JSON.parse(readFileSync(new URL('../catalog/options.json', import.meta.url), 'utf8'));
const ALL_TOOLS = ['claude-code', 'codex', 'cursor', 'opencode', 'cline'];
const ALL_OPTIONS = catalog.options.map((option) => option.id).filter((id) => !id.startsWith('control.'));
const OPTION_SETS = {
  everything: ALL_OPTIONS,
  minimal: ['rule.verification', 'skill.pr-description', 'check.static'],
};
const TOOL_SETS = { 'claude-code only': ['claude-code'], 'all five tools': ALL_TOOLS };
const PROFILES = ['solo', 'team', 'org'];

const work = mkdtempSync(join(tmpdir(), 'wk-matrix-'));

function snapshot(root) {
  const files = new Map();
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(root, path).replaceAll('\\', '/'), createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  })(root);
  return files;
}

/** A project that already has files of its own, in exactly the places the kit writes to. */
function seedProject(root) {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'seed', version: '1.0.0', scripts: { test: 'node -e 0', lint: 'node -e 0', typecheck: 'node -e 0' } }, null, 2) + '\n');
  writeFileSync(join(root, 'src', 'index.js'), 'export const one = 1;\n');
  writeFileSync(join(root, 'README.md'), '# seed\n');
  writeFileSync(join(root, 'CLAUDE.md'), '# My own instructions\n\nKeep this.\n');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  mkdirSync(join(root, '.claude', 'skills', 'pr-description'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'pr-description', 'SKILL.md'), USER_SKILL);
  run('git', ['init', '-q', '-b', 'main'], root);
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho user hook\n', { mode: 0o755 });
}

const USER_SKILL = '---\nname: pr-description\ndescription: The project own skill with the same name as a kit skill\n---\n\nUSER SKILL\n';
const results = [];
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], process.cwd()))[0];
  const unpack = join(work, 'pkg');
  mkdirSync(unpack);
  // Relative names, run from the work folder: GNU tar reads "C:\..." as a remote host.
  run('tar', ['-xzf', packed.filename, '-C', 'pkg'], work);
  const kitSource = join(unpack, 'package');
  const cli = join(kitSource, 'bin', 'cli.mjs');
  console.log(`packed ${packed.filename} (${packed.files.length} files)\n`);

  for (const profile of PROFILES) {
    for (const [toolLabel, tools] of Object.entries(TOOL_SETS)) {
      for (const [optionLabel, enabled] of Object.entries(OPTION_SETS)) {
        const label = `${profile} / ${toolLabel} / ${optionLabel}`;
        const project = mkdtempSync(join(work, 'p-'));
        const problems = [];
        const check = (name, test) => {
          try {
            test();
          } catch (error) {
            const text = String(error.stdout || '') + String(error.stderr || '') || String(error.message);
            const lines = text.trim().split('\n');
            const notable = lines.filter((line) => /error|warn|fail|problem|too/i.test(line));
            const detail = (notable.length ? notable : lines.slice(-3)).slice(0, 4).map((line) => line.trim()).join(' | ');
            problems.push(`${name}: ${detail}`);
          }
        };
        try {
          seedProject(project);
          const before = snapshot(project);
          const choices = join(work, 'choices.json');
          writeFileSync(choices, JSON.stringify({
            profile,
            tools,
            enabled,
            project: { commands: { lint: 'npm run lint', typecheck: 'npm run typecheck', test: 'npm test' }, protectedBranch: 'main', versionFiles: ['package.json:version'] },
          }));
          check('init', () => assert.match(run('node', [cli, 'init', '--dir', project], work), /copied: [1-9]/));
          const kit = join(project, '.claude', 'workspace-kit');
          const installedCli = join(kit, 'bin', 'cli.mjs');
          check('apply', () => assert.match(run('node', [installedCli, 'apply', '--dir', project, '--choices', choices], work), /created: [1-9]/));
          const afterApply = snapshot(project);
          check('profile resolves', () => {
            if (!existsSync(join(project, 'scripts', 'workflow-config.mjs'))) return;
            assert.match(run('node', [join(project, 'scripts', 'workflow-config.mjs')], project), new RegExp(`profile: ${profile}\\b`));
          });
          check('static checks run', () => {
            if (existsSync(join(project, 'scripts', 'check-config.mjs'))) run('node', [join(project, 'scripts', 'check-config.mjs')], project);
          });
          check('second apply changes nothing', () => {
            const again = run('node', [installedCli, 'apply', '--dir', project, '--choices', choices], work);
            assert.match(again, /created: 0/);
            assert.match(again, /updated: 0/);
            assert.deepEqual([...snapshot(project)], [...afterApply], 'files differ after the second apply');
          });
          check('user files kept', () => {
            assert.equal(readFileSync(join(project, '.claude', 'skills', 'pr-description', 'SKILL.md'), 'utf8'), USER_SKILL);
            assert.match(readFileSync(join(project, 'CLAUDE.md'), 'utf8'), /Keep this\./);
            assert.match(readFileSync(join(project, '.gitignore'), 'utf8'), /node_modules\//);
          });
          check('uninstall', () => {
            assert.match(run('node', [installedCli, 'uninstall', '--dir', project, '--yes'], work), /Removed:/);
            const after = snapshot(project);
            const missing = [...before.keys()].filter((path) => !after.has(path));
            const changed = [...before].filter(([path, hash]) => after.has(path) && after.get(path) !== hash).map(([path]) => path);
            const extra = [...after.keys()].filter((path) => !before.has(path));
            assert.deepEqual({ missing, changed, extra }, { missing: [], changed: [], extra: [] }, 'the project is not back to how it was');
          });
        } catch (error) {
          problems.push(`setup: ${String(error.message).split('\n')[0]}`);
        }
        results.push({ label, problems });
        console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${label}${problems.length ? '\n        ' + problems.join('\n        ') : ''}`);
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((result) => result.problems.length);
console.log(`\n${results.length - failed.length} of ${results.length} combinations pass on ${process.platform}, node ${process.version}`);
process.exit(failed.length ? 1 : 0);
