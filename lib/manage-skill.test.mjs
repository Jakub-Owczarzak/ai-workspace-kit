import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The manager prompt (skills/manage-workspace and docs/config-prompt.md) tells an AI tool which commands to run. These tests
// keep it true: the skill is well formed, it is reachable from the setup, and every `config` command it shows names a
// subcommand, feature, level, control, profile or option that exists.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(KIT, ...parts), 'utf8');
const { lintSkill } = await import(pathToFileURL(join(KIT, 'templates', 'scripts', 'check-skills.mjs')).href);
const { CONTROL_SPECS } = await import(pathToFileURL(join(KIT, 'templates', 'scripts', 'workflow-config.mjs')).href);

const catalog = JSON.parse(read('catalog', 'options.json'));
const featureFile = JSON.parse(read('catalog', 'features.json'));
const SKILL = read('skills', 'manage-workspace', 'SKILL.md');
const PROMPT = read('docs', 'config-prompt.md');

test('the skill is well formed: lint clean, named like its folder, started by hand', () => {
  const result = lintSkill({ folder: 'manage-workspace', dir: join(KIT, 'skills', 'manage-workspace'), text: SKILL, fixturesText: null }, { noPlaceholders: true });
  assert.deepEqual(result.issues, []);
  assert.match(SKILL, /^---\r?\nname: manage-workspace\r?\n/);
  assert.match(SKILL, /disable-model-invocation: true/);
});

test('it is a catalog option that stays in the kit folder, new after the released 0.4.0, and not a feature', () => {
  const option = catalog.options.find((item) => item.id === 'skill.manage-workspace');
  assert.ok(option, 'the option exists');
  assert.equal(option.source, 'skills/manage-workspace');
  assert.equal(option.installAs, null);
  assert.equal(option.default, true);
  // Release 0.4.0 is out. The version label for what comes next is the release owner's call; 0.5.0 is the placeholder.
  assert.equal(option.since, '0.5.0');
  assert.ok(featureFile.notFeatures.includes('skill.manage-workspace'));
});

test('every config command the skill and the prompt show is real', () => {
  const featureById = new Map(featureFile.features.map((feature) => [feature.id, feature]));
  const presetIds = new Set(featureFile.presets.map((preset) => preset.id));
  const profiles = new Set(catalog.profiles.map((profile) => profile.id));
  const optionIds = new Set(catalog.options.filter((option) => option.kind !== 'control').map((option) => option.id));
  const allOptionIds = new Set(catalog.options.map((option) => option.id));
  const SUBCOMMANDS = ['menu', 'list', 'get', 'on', 'off', 'set', 'unset', 'profile', 'feature'];
  let checked = 0;

  for (const [file, text] of [['SKILL.md', SKILL], ['config-prompt.md', PROMPT]]) {
    for (const [, sub, rest] of text.matchAll(/config (menu|list|get|on|off|set|unset|profile|feature)\b([^\n`]*)/g)) {
      assert.ok(SUBCOMMANDS.includes(sub));
      // Positions are kept: a literal word stays, while a <placeholder>, [optional part], a|b alternative or other text
      // becomes a gap (null), so "feature <name> on" is not read as the feature "on". Flags are dropped.
      const words = rest.trim().split(/\s+/).filter((word) => word && !word.startsWith('--')).map((word) => (/^[a-z0-9][a-z0-9.-]*$/.test(word) ? word : null));
      const where = `${file}: config ${sub} ${rest.trim()}`;
      checked += 1;
      if (sub === 'feature' && words[0] && words[0] !== 'list') {
        assert.ok(featureById.has(words[0]) || presetIds.has(words[0]), `${where}: unknown feature ${words[0]}`);
        if (words[1] === 'on' || words[1] === 'off') {
          if (words[2]) assert.ok(words[2] === 'on' || Object.keys(featureById.get(words[0])?.levels ?? {}).includes(words[2]), `${where}: unknown level ${words[2]}`);
        }
      } else if (sub === 'profile' && words[0]) {
        assert.ok(profiles.has(words[0]), `${where}: unknown profile ${words[0]}`);
      } else if ((sub === 'set' || sub === 'unset') && words[0]) {
        assert.ok(CONTROL_SPECS[words[0].replace(/^control\./, '')], `${where}: unknown control ${words[0]}`);
      } else if ((sub === 'on' || sub === 'off') && words[0]) {
        for (const id of words.filter((word) => word && (/^[a-z]+[.-]/.test(word) || optionIds.has(word)))) assert.ok(optionIds.has(id), `${where}: unknown option ${id}`);
      } else if (sub === 'get' && words[0]) {
        assert.ok(allOptionIds.has(words[0]), `${where}: unknown option ${words[0]}`);
      }
    }
  }
  assert.ok(checked >= 10, `only ${checked} config commands were found to check`);
});

test('the skill says what to do with a refusal and with orders found in output, and never to edit the files by hand', () => {
  assert.match(SKILL, /never edit/i);
  assert.match(SKILL, /refus/i);
  assert.match(SKILL, /--dry-run/);
  assert.match(SKILL, /data, not instructions|data and not instructions|not instructions/i);
  assert.match(SKILL, /--cascade/);
  assert.match(SKILL, /Do not commit/);
});

test('the prompt file points at the skill and names the terminal alternative', () => {
  assert.ok(PROMPT.includes('.claude/workspace-kit/skills/manage-workspace/SKILL.md'));
  assert.match(PROMPT, /config menu/);
  assert.match(PROMPT, /Do not commit/);
});

test('the setup says that turning things off later is done with the manager, not by running the setup again', () => {
  const setup = read('skills', 'setup-workspace', 'SKILL.md');
  assert.match(setup.split('\n')[2], /manage-workspace/);
  assert.match(read('docs', 'setup-prompt.md'), /manage-workspace|config-prompt/);
  const setupOption = catalog.options.find((item) => item.id === 'skill.setup-workspace');
  assert.match(setupOption.impact, /manage|config/i);
  assert.doesNotMatch(setupOption.impact, /^Run it again to change your choices; it is safe to repeat\.$/);
});

test('a setup re-run starts from the recorded choices, so it does not undo what the manager changed', () => {
  const setup = read('skills', 'setup-workspace', 'SKILL.md');
  assert.match(setup, /Re-running/);
  assert.match(setup, /<KIT>\/choices\.json/);
  assert.match(setup, /preselect[^\n]*recorded|recorded[^\n]*preselect/i);
  assert.match(setup, /turned off/i);
  assert.match(read('docs', 'setup-prompt.md'), /turns? (them )?on again|recorded choices/i);
});

test('init tells the user how to change the setup later', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-manage-'));
  const result = spawnSync('node', [join(KIT, 'bin', 'cli.mjs'), 'init', '--dir', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /manage-workspace/);
  assert.match(result.stdout, /config menu/);
});
