import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { apply } from './apply.mjs';
import { setFeature } from './features.mjs';
import { init } from './init.mjs';
import { runMenu } from './menu.mjs';

const CLI = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const KIT = '.claude/workspace-kit';

const project = ({ profile = 'solo', enabled = ['rule.verification', 'rule.readable-code'], git = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-menu-'));
  if (git) execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ dir });
  apply({ dir, choices: { profile, tools: ['claude-code'], enabled } });
  return dir;
};
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const workflow = (dir) => JSON.parse(read(dir, '.claude/workflow.json'));
const record = (dir) => JSON.parse(read(dir, `${KIT}/choices.json`));

/** Runs the menu with the answers typed one per line, and returns everything it printed. */
async function drive(dir, answers) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => (text += chunk));
  input.end(answers.length ? answers.join('\n') + '\n' : '');
  await runMenu({ dir, input, output });
  return text;
}

test('quit, a wrong choice, and a closed input all end cleanly', async () => {
  const dir = project();
  assert.match(await drive(dir, ['q']), /Workspace kit manager/);
  assert.match(await drive(dir, ['9', 'q']), /not a choice/i);
  await drive(dir, ['1']); // the input ends inside a screen
  await drive(dir, []);
});

test('answers that were piped in are echoed on their own line, so a log reads like a session', async () => {
  const text = await drive(project(), ['1', 'tdd', 'off', 'n', 'q']);
  assert.match(text, /Apply this\? \[y\/N\] n\n/);
  assert.match(text, /Which feature \(number or name, b = back, q = quit\): tdd\n/);
  assert.doesNotMatch(text, /\[y\/N\] Nothing was changed/);
});

test('in a terminal the typed answer is already on screen, so it is not echoed a second time', async () => {
  const input = new PassThrough();
  input.isTTY = true; // what process.stdin reports in a terminal
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => (text += chunk));
  input.end('1\ntdd\noff\nn\nq\n');
  await runMenu({ dir: project(), input, output });
  assert.match(text, /Apply this\? \[y\/N\] /);
  assert.doesNotMatch(text, /\[y\/N\] n\n/);
  assert.doesNotMatch(text, /Which feature \(number or name, b = back, q = quit\): tdd\n/);
  assert.match(text, /nothing was changed/i, 'it still behaves the same');
});

test('show everything prints the grouped list', async () => {
  const text = await drive(project(), ['5', 'q']);
  assert.match(text, /Profile: solo/);
  assert.match(text, /\[tests\]/);
});

test('features: turn the factory on at a level, see the plan and the note, confirm, and it is applied', async () => {
  const dir = project();
  const text = await drive(dir, ['1', 'factory', 'on', 'pr', 'y', 'q']);
  assert.match(text, /\[factory\]/);
  assert.match(text, /pushes feature branches and opens pull requests/);
  assert.match(text, /Apply this\?/);
  assert.equal(workflow(dir).overrides['factory.mode'], 'pr');
  assert.ok(existsSync(join(dir, '.claude/skills/wk-run-factory/SKILL.md')));
  assert.match(text, /git diff/);
});

test('declining the plan changes nothing, and so does an empty answer', async () => {
  const dir = project();
  const before = read(dir, `${KIT}/choices.json`);
  const text = await drive(dir, ['1', 'factory', 'on', 'on', 'n', '1', 'factory', 'on', 'on', '', 'q']);
  assert.match(text, /nothing was changed/i);
  assert.equal(read(dir, `${KIT}/choices.json`), before);
  assert.ok(!existsSync(join(dir, '.claude/skills/wk-run-factory/SKILL.md')));
});

test('features: an off that something else needs offers to turn those off too, and honours a no', async () => {
  const dir = project({ git: true });
  setFeature({ dir, name: 'pr-protection', state: 'on' });
  setFeature({ dir, name: 'factory', state: 'on' });

  const refused = await drive(dir, ['1', 'pr-protection', 'off', 'n', 'q']);
  assert.match(refused, /needed by/);
  assert.match(refused, /turn those off as well/i);
  assert.ok(record(dir).enabled.includes('skill.run-factory'));

  // cascade: yes; then the new question about what nothing needs any more: no; then apply: yes.
  const accepted = await drive(dir, ['1', 'pr-protection', 'off', 'y', 'n', 'y', 'q']);
  assert.match(accepted, /Also turn off those/);
  assert.match(accepted, /Apply this\?/);
  assert.ok(!record(dir).enabled.includes('skill.run-factory'));
  assert.ok(!record(dir).enabled.includes('review-gate'));
});

test('features: an off that leaves things nothing needs offers to turn those off as well', async () => {
  const dir = project();
  setFeature({ dir, name: 'test-guard', state: 'on' });
  const text = await drive(dir, ['1', 'test-guard', 'off', 'y', 'y', 'q']);
  assert.match(text, /nothing that is on needs them/i);
  assert.match(text, /Also turn off those/);
  assert.ok(!record(dir).enabled.includes('rule.test-discipline'));

  const other = project();
  setFeature({ dir: other, name: 'test-guard', state: 'on' });
  await drive(other, ['1', 'test-guard', 'off', 'n', 'y', 'q']);
  assert.ok(record(other).enabled.includes('rule.test-discipline'), 'a no leaves them on');
});

test('profile: switch, say yes to what the profile adds, see the plan, confirm', async () => {
  const dir = project();
  const text = await drive(dir, ['2', 'team', 'y', 'y', 'q']);
  assert.match(text, /One owner|A few developers/);
  assert.match(text, /Apply this\?/);
  assert.equal(workflow(dir).profile, 'team');
  assert.ok(existsSync(join(dir, 'scripts/test-edit-guard.mjs')));

  const other = project();
  await drive(other, ['2', 'team', 'n', 'y', 'q']);
  assert.equal(workflow(other).profile, 'team');
  assert.ok(!existsSync(join(other, 'scripts/test-edit-guard.mjs')), 'declining the extras installs nothing');
});

test('controls: a wrong value is explained and asked again; a right one is applied; default clears it', async () => {
  const dir = project();
  const text = await drive(dir, ['3', 'docs.check', 'loud', 'strict', 'y', 'q']);
  assert.match(text, /not a valid value for docs\.check/);
  assert.equal(workflow(dir).overrides['docs.check'], 'strict');

  await drive(dir, ['3', 'docs.check', 'default', 'y', 'q']);
  assert.equal(workflow(dir).overrides['docs.check'], undefined);
});

test('single pieces: pick a group and a piece and turn it off', async () => {
  const dir = project();
  assert.ok(record(dir).enabled.includes('rule.verification'));
  const text = await drive(dir, ['4', 'rules', 'rule.verification', 'y', 'y', 'q']);
  assert.match(text, /\[rules\]|rules/);
  assert.ok(!record(dir).enabled.includes('rule.verification'));
});

test('going back returns to the main menu', async () => {
  const text = await drive(project(), ['1', 'b', '2', 'b', 'q']);
  assert.equal((text.match(/Workspace kit manager/g) ?? []).length, 3);
});

test('a project without the kit is explained instead of crashing the menu', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-menu-empty-'));
  await assert.rejects(() => drive(dir, ['q']), /kit folder/);
});

test('cli: config menu works with piped answers, and bare config prints usage', () => {
  const dir = project();
  const menu = spawnSync('node', [CLI, 'config', 'menu', '--dir', dir], { encoding: 'utf8', input: '5\nq\n' });
  assert.equal(menu.status, 0, menu.stderr);
  assert.match(menu.stdout, /Profile: solo/);

  const bare = spawnSync('node', [CLI, 'config', '--dir', dir], { encoding: 'utf8' });
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /config menu/);
});
