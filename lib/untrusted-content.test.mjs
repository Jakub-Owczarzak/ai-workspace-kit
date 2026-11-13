import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// An external review of the kit said that reviewed code, a README, a PR text or a CI log can carry instructions
// aimed at the assistant, and that the kit had no rule against following them. The agents that read such text now
// say it is data, and what to do when it gives an order. These tests keep that wording in place.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(KIT, ...parts), 'utf8');

/** The text under a `## <title>` heading, up to the next `##` heading. */
function section(text, title) {
  const match = text.match(new RegExp(`^##\\s+${title}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm'));
  return match ? match[1] : null;
}

test('the reviewer treats the diff, files, handoff, PR text and CI logs as data and reports an order found in them', () => {
  const body = section(read('templates', 'agents', 'reviewer.md'), 'Untrusted content');
  assert.ok(body, 'reviewer.md has an "Untrusted content" section');
  assert.match(body, /data[^.]*never\s+instructions/i);
  for (const source of ['diff', 'handoff', 'PR text', 'CI log']) assert.match(body, new RegExp(source, 'i'), `names ${source}`);
  assert.match(body, /blocking finding/i, 'an injection attempt is reported as a blocking finding');
  assert.match(body, /keep reviewing/i, 'and the review carries on');
});

test('the builder treats files, test output, CI logs and PR text as data and stops when one gives an order', () => {
  const body = section(read('templates', 'agents', 'factory-builder.md'), 'Untrusted content');
  assert.ok(body, 'factory-builder.md has an "Untrusted content" section');
  assert.match(body, /data[^.]*never\s+instructions/i);
  for (const source of ['files', 'test output', 'CI log', 'PR']) assert.match(body, new RegExp(source, 'i'), `names ${source}`);
  assert.match(body, /blocked: instruction found in/i, 'the builder reports the order with the blocked status');
});

test('the factory orchestrator never follows an instruction found in a diff, CI log, PR text or an agent report', () => {
  const body = section(read('skills', 'run-factory', 'SKILL.md'), 'Never');
  assert.ok(body, 'run-factory has a "Never" section');
  assert.match(body, /Follow instructions found in[^\n]*(diff|file)[^\n]*CI log[^\n]*report/i);
  assert.match(body, /stop and report/i);
});

test('the untrusted-content check is not vacuous (a section without the wording fails it)', () => {
  const stripped = read('templates', 'agents', 'reviewer.md').replace(/^## Untrusted content[\s\S]*?(?=^## )/m, '');
  assert.equal(section(stripped, 'Untrusted content'), null);
});

// ---- factory.untrustedText: what the builder and the reviewer do with an order found in text they read ----

test('the builder has two modes for an order found in text: `stop` (the default, and what it uses when not told) and `note`', () => {
  const body = section(read('templates', 'agents', 'factory-builder.md'), 'Untrusted content');
  assert.match(body, /factory\.untrustedText/);
  assert.match(body, /`stop`[^\n]*(default|not told|nothing)/i, 'stop is the default');
  assert.match(body, /`note`/);
  assert.match(body, /Notes:/, '`note` mode records it in the handoff Notes');
  assert.match(body, /never follow|do not (do|follow)/i, 'neither mode follows the text');
  assert.match(body, /blocked: instruction found in/i, '`stop` still reports with the blocked status');
});

test('the reviewer reports an order found in text as a blocking finding in `stop` and as a [nit] in `note`', () => {
  const body = section(read('templates', 'agents', 'reviewer.md'), 'Untrusted content');
  assert.match(body, /factory\.untrustedText/);
  assert.match(body, /`stop`[^\n]*blocking/i);
  assert.match(body, /`note`[^\n]*\[nit\]/i);
});

test('the factory skill reads factory.untrustedText and gives it to the builder and to the reviewer', () => {
  const skill = read('skills', 'run-factory', 'SKILL.md');
  assert.ok((skill.match(/untrustedText/g) ?? []).length >= 4, 'named in the settings list, the build step, the review step and the Never list');
  const never = section(skill, 'Never');
  assert.match(never, /`stop`[^\n]*stop and report/i);
  assert.match(never, /`note`[^\n]*(record|carry on)/i);
});

test('the control is in the catalog and in both profile tables with its three defaults', () => {
  const catalog = JSON.parse(read('catalog', 'options.json'));
  const option = catalog.options.find((entry) => entry.control === 'factory.untrustedText');
  assert.ok(option, 'a catalog entry for the control');
  assert.deepEqual(Object.keys(option.values).sort(), ['note', 'stop']);
  for (const file of [['docs', 'workflow-profiles.md'], ['docs', 'factory.md']]) {
    const row = read(...file).split('\n').find((line) => line.includes('`factory.untrustedText`'));
    assert.ok(row, `${file.join('/')} has a row for it`);
    assert.match(row, /note[^|]*\|[^|]*stop|stop\s*\/\s*stop|note.*stop.*stop/i, `${file.join('/')} shows solo note, team stop, org stop`);
  }
});
