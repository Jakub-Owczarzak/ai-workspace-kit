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
