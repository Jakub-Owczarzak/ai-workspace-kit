// Kit development only (not shipped). Keeps catalog/options.json true to the kit's real files and to
// the profile resolver, so the setup questionnaire never describes something that is not there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'options.json'), 'utf8'));
const { PROFILES, CONTROL_SPECS, PROFILE_NAMES } = await import(
  pathToFileURL(join(root, 'templates', 'scripts', 'workflow-config.mjs')).href
);

const options = catalog.options;
const byId = new Map(options.map((option) => [option.id, option]));
const posix = (path) => path.split('\\').join('/');

const listFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)])
    : [];
const kitRelative = (file) => posix(file.slice(root.length + 1));

test('ids are unique and every option has the text the questionnaire shows', () => {
  assert.equal(byId.size, options.length, 'duplicate option id');
  for (const option of options) {
    for (const field of ['id', 'kind', 'title', 'what', 'impact']) {
      assert.ok(typeof option[field] === 'string' && option[field].length > 0, `${option.id}: missing ${field}`);
    }
    if (option.kind !== 'control') {
      const d = option.default;
      const valid =
        typeof d === 'boolean' || (d && PROFILE_NAMES.every((name) => typeof d[name] === 'boolean'));
      assert.ok(valid, `${option.id}: default must be true/false or {solo, team, org}`);
    }
  }
});

test('every requires points to an option that exists', () => {
  for (const option of options) {
    for (const required of option.requires ?? []) assert.ok(byId.has(required), `${option.id} requires unknown ${required}`);
  }
});

test('profiles match the resolver', () => {
  assert.deepEqual(catalog.profiles.map((profile) => profile.id), PROFILE_NAMES);
});

test('every rule file has an option, and every rule option has a file', () => {
  const ruleFiles = [
    ...listFiles(join(root, 'rules')),
    ...listFiles(join(root, 'stacks')).filter((file) => posix(file).includes('/rules/')),
  ].map(kitRelative);
  const optionSources = options.filter((option) => option.kind === 'rule').map((option) => option.source);
  assert.deepEqual([...optionSources].sort(), [...ruleFiles].sort());
});

test('every skill folder has an option, installed under the wk- prefix', () => {
  const skillDirs = readdirSync(join(root, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `skills/${entry.name}`);
  const skillOptions = options.filter((option) => option.kind === 'skill');
  assert.deepEqual(skillOptions.map((option) => option.source).sort(), skillDirs.sort());
  for (const option of skillOptions) {
    const name = option.source.split('/')[1];
    const expected = name === 'setup-workspace' ? null : `wk-${name}`;
    assert.equal(option.installAs, expected, `${option.id}: installAs`);
  }
});

test('controls agree with the resolver', () => {
  const controlOptions = options.filter((option) => option.kind === 'control');
  assert.deepEqual(controlOptions.map((option) => option.control).sort(), Object.keys(CONTROL_SPECS).sort());
  for (const option of controlOptions) {
    const spec = CONTROL_SPECS[option.control];
    if (spec.type === 'choice') assert.deepEqual(Object.keys(option.values), spec.allowed, option.id);
    else if (spec.type === 'boolean') assert.deepEqual(Object.keys(option.values), ['true', 'false'], option.id);
    else assert.ok(option.valueHint, `${option.id}: a number control needs valueHint`);
  }
});

test('control defaults in docs/workflow-profiles.md match the resolver', () => {
  const doc = readFileSync(join(root, 'docs', 'workflow-profiles.md'), 'utf8');
  for (const [control] of Object.entries(CONTROL_SPECS)) {
    const row = doc.split('\n').find((line) => line.startsWith(`| \`${control}\``));
    assert.ok(row, `docs table has no row for ${control}`);
    const cells = row.split('|').map((cell) => cell.trim());
    PROFILE_NAMES.forEach((name, index) =>
      assert.equal(cells[3 + index], String(PROFILES[name][control]), `${control} / ${name}`));
  }
});

test('every installs path exists, and every shippable template file is claimed by an option', () => {
  const claimed = new Set();
  for (const option of options) {
    for (const path of option.installs ?? []) {
      assert.ok(existsSync(join(root, path)), `${option.id}: ${path} does not exist`);
      claimed.add(path);
    }
  }
  const shippable = [
    ...listFiles(join(root, 'templates')).filter((file) => !file.endsWith('.test.mjs')),
  ].map(kitRelative);
  const unclaimed = shippable.filter((file) => !claimed.has(file));
  assert.deepEqual(unclaimed, [], 'template files no option installs');
});
