// Kit development only (not shipped). Keeps the workflow diagrams honest: the committed SVG files are exactly what
// the generator produces, the README embeds all of them, and no text is long enough to run into its neighbours.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DIAGRAMS, layoutFor, renderAll, wrap } from './make-flow-diagrams.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const PROFILES = ['solo', 'team', 'org'];

describe('workflow diagrams', () => {
  it('the committed SVG files are exactly what the generator produces (run: node scripts/make-flow-diagrams.mjs)', () => {
    for (const [file, svg] of Object.entries(renderAll())) {
      const path = join(ROOT, 'docs', 'diagrams', file);
      assert.ok(existsSync(path), `${file} is missing; run node scripts/make-flow-diagrams.mjs`);
      assert.equal(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), svg, `${file} is out of date; run node scripts/make-flow-diagrams.mjs`);
    }
  });

  it('every SVG is a complete document with a title for screen readers', () => {
    for (const svg of Object.values(renderAll())) {
      assert.match(svg, /^<svg [^>]*viewBox="0 0 1200 \d+"/);
      assert.match(svg, /<title>[^<]+<\/title>/);
      assert.ok(svg.trimEnd().endsWith('</svg>'));
      assert.equal((svg.match(/<svg /g) ?? []).length, 1);
    }
  });

  it('the README embeds each diagram, with alt text, and links to the section', () => {
    for (const name of Object.keys(DIAGRAMS)) {
      assert.match(readme, new RegExp(`!\\[[^\\]]{20,}\\]\\(docs/diagrams/flow-${name}\\.svg\\)`), `README does not embed flow-${name}.svg`);
    }
    assert.match(readme, /\(#the-flow-in-each-profile-what-is-automated-what-needs-you\)/);
  });

  it('the three profile diagrams have the same eight stages in the same order, and the test comes before the build', () => {
    const titles = PROFILES.map((name) => DIAGRAMS[name].stages.map((stage) => stage.title));
    for (const list of titles) assert.equal(list.length, 8);
    assert.deepEqual(titles[0], titles[1]);
    assert.deepEqual(titles[1], titles[2]);
    assert.ok(titles[0].indexOf('Test first') < titles[0].indexOf('Build'), 'a failing test is written before the code');
    assert.ok(titles[0].indexOf('Build') < titles[0].indexOf('Verify'));
  });

  it('the test-first path starts with a failing test, locks, then changes only the code', () => {
    const titles = DIAGRAMS.tdd.stages.map((stage) => stage.title);
    assert.deepEqual(titles, ['Reproduce', 'Show it failing', 'Lock', 'Change the code', 'Show it passing', 'Stop fix mode']);
    assert.ok(DIAGRAMS.tdd.loops.some((loop) => /YOU decide/.test(loop.label)), 'a test that looks wrong goes back to a person');
  });

  it('turning test-first off removes the Test first stage, not the tests: Verify stays after Build in every profile', () => {
    for (const name of PROFILES) {
      const titles = DIAGRAMS[name].stages.map((stage) => stage.title);
      assert.ok(titles.includes('Verify') && titles.indexOf('Verify') > titles.indexOf('Build'), `${name}: tests must still run after Build`);
    }
    const off = DIAGRAMS.tdd.panel.rows.find((row) => row.label === 'OFF');
    assert.ok(off, 'the test-first diagram says what tests.tdd = off does');
    assert.match(off.text, /Test first stage is skipped/);
    assert.match(off.text, /still runs the whole suite in Verify/);
    assert.match(off.text, /pre-commit hook runs the tests/);
  });

  it('no note, subtitle or loop label is long enough to collide with a neighbour', () => {
    for (const [name, spec] of Object.entries(DIAGRAMS)) {
      const lay = layoutFor(spec.stages.length);
      for (const stage of spec.stages) {
        assert.ok(wrap(stage.note, lay.noteChars).length <= 5, `${name}/${stage.title}: the note is more than 5 lines; shorten it`);
        assert.ok(wrap(stage.sub, lay.subChars).length <= 2, `${name}/${stage.title}: the subtitle is more than 2 lines`);
      }
      for (const loop of spec.loops) assert.ok(loop.label.length <= 110, `${name}: loop label too long`);
    }
  });

  it('what blocks matches the profile table: solo only the hooks; team and org add plan mode and the guard', () => {
    const hardTitles = (name) => DIAGRAMS[name].stages.filter((stage) => stage.hard).map((stage) => stage.title);
    assert.deepEqual(hardTitles('solo'), ['Commit', 'Push']);
    assert.deepEqual(hardTitles('team'), ['Plan', 'Test first', 'Build', 'Commit', 'Push']);
    assert.deepEqual(hardTitles('org'), ['Plan', 'Test first', 'Build', 'Commit', 'Push']);
  });

  it('in solo the test-first step is conditional (bug fixes and TDD buckets); in team and org it always happens', () => {
    const testFirst = (name) => DIAGRAMS[name].stages.find((stage) => stage.title === 'Test first');
    assert.equal(testFirst('solo').conditional, true);
    assert.notEqual(testFirst('team').conditional, true);
    assert.notEqual(testFirst('org').conditional, true);
  });
});
