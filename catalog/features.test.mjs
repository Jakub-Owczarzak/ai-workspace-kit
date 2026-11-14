// Kit development only (not shipped). Keeps catalog/features.json true to the option catalog and to the profile resolver,
// and makes sure no option or control is silently left out of every feature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'options.json'), 'utf8'));
const file = JSON.parse(readFileSync(join(root, 'catalog', 'features.json'), 'utf8'));
const { CONTROL_SPECS, normalizeValue } = await import(pathToFileURL(join(root, 'templates', 'scripts', 'workflow-config.mjs')).href);

const optionById = new Map(catalog.options.map((option) => [option.id, option]));
const { features, presets, groups, notFeatures } = file;

test('ids are unique, every feature has a group and the text a menu shows', () => {
  const ids = [...features, ...presets].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate feature or preset id');
  for (const feature of features) {
    assert.ok(groups.includes(feature.group), `${feature.id}: unknown group ${feature.group}`);
    for (const field of ['id', 'title', 'what', 'impact']) assert.ok(typeof feature[field] === 'string' && feature[field].length > 0, `${feature.id}: missing ${field}`);
  }
  for (const preset of presets) {
    for (const field of ['id', 'title', 'what']) assert.ok(typeof preset[field] === 'string' && preset[field].length > 0, `${preset.id}: missing ${field}`);
  }
});

test('every option a feature names is a real switch, every control is real and its values are allowed', () => {
  for (const feature of features) {
    const levels = Object.entries(feature.levels ?? {});
    for (const id of [...(feature.options ?? []), ...levels.flatMap(([, level]) => level.options ?? [])]) {
      assert.ok(optionById.has(id), `${feature.id}: unknown option ${id}`);
      assert.notEqual(optionById.get(id).kind, 'control', `${feature.id}: ${id} is a control, list it under controls`);
    }
    const checks = [
      ...Object.entries(feature.controls ?? {}).flatMap(([name, values]) => [[name, values.on, false], [name, values.off, false]]),
      ...levels.flatMap(([, level]) => Object.entries(level.controls ?? {}).map(([name, value]) => [name, value, true])),
    ];
    for (const [name, value, allowDefault] of checks) {
      assert.ok(CONTROL_SPECS[name], `${feature.id}: unknown control ${name}`);
      if (allowDefault && value === 'default') continue;
      assert.ok(normalizeValue(CONTROL_SPECS[name], value).ok, `${feature.id}: ${JSON.stringify(value)} is not allowed for ${name}`);
    }
    for (const [name] of levels) assert.ok(!['on', 'off'].includes(name), `${feature.id}: a level cannot be called ${name}`);
  }
});

test('presets name features that exist', () => {
  const ids = new Set(features.map((feature) => feature.id));
  for (const preset of presets) {
    assert.ok(preset.features.length > 1, `${preset.id}: a preset bundles at least two features`);
    for (const id of preset.features) assert.ok(ids.has(id), `${preset.id}: unknown feature ${id}`);
  }
});

test('every option and control is in exactly one feature, or in the explicit list of things that are not features', () => {
  const place = new Map();
  const claim = (id, where) => place.set(id, [...(place.get(id) ?? []), where]);
  for (const feature of features) {
    for (const id of feature.options ?? []) claim(id, feature.id);
    for (const level of Object.values(feature.levels ?? {})) for (const id of level.options ?? []) claim(id, feature.id);
    const controls = new Set([...Object.keys(feature.controls ?? {}), ...Object.values(feature.levels ?? {}).flatMap((level) => Object.keys(level.controls ?? {}))]);
    for (const name of controls) claim(`control.${name}`, feature.id);
  }
  for (const id of notFeatures) claim(id, 'notFeatures');

  const unplaced = catalog.options.map((option) => option.id).filter((id) => !place.has(id));
  assert.deepEqual(unplaced, [], 'in no feature and not listed as a non-feature');
  const twice = [...place].filter(([, where]) => new Set(where).size > 1).map(([id, where]) => `${id}: ${[...new Set(where)].join(', ')}`);
  assert.deepEqual(twice, [], 'in more than one place');
  const unknown = [...place.keys()].filter((id) => !optionById.has(id));
  assert.deepEqual(unknown, [], 'named but not in the option catalog');
});
