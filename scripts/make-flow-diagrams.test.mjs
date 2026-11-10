// Kit development only (not shipped). Keeps the workflow diagrams honest: the committed SVG files are exactly what
// the generator produces, the README embeds all three, and no text is long enough to run into its neighbours.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DIAGRAMS, renderAll, wrap } from './make-flow-diagrams.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

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
      assert.match(svg, /^<svg [^>]*viewBox="0 0 1200 600"/);
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

  it('there are eight stages per profile, and the same stages in the same order', () => {
    const titles = Object.values(DIAGRAMS).map((spec) => spec.stages.map((stage) => stage.title).join(' > '));
    for (const spec of Object.values(DIAGRAMS)) assert.equal(spec.stages.length, 8);
    assert.equal(new Set(titles).size, 1, 'the profiles differ in what blocks, not in the stages');
  });

  it('no note or loop label is long enough to collide with a neighbour', () => {
    for (const [name, spec] of Object.entries(DIAGRAMS)) {
      for (const stage of spec.stages) {
        assert.ok(wrap(stage.note, 21).length <= 5, `${name}/${stage.title}: the note is more than 5 lines; shorten it`);
        assert.ok(wrap(stage.sub, 17).length <= 2, `${name}/${stage.title}: the subtitle is more than 2 lines`);
      }
      for (const loop of spec.loops) assert.ok(loop.label.length <= 70, `${name}: loop label too long`);
    }
  });

  it('what blocks matches the profile table: solo only the hooks, team adds plan mode and the guard', () => {
    const hardTitles = (name) => DIAGRAMS[name].stages.filter((stage) => stage.hard).map((stage) => stage.title);
    assert.deepEqual(hardTitles('solo'), ['Commit', 'Push']);
    assert.deepEqual(hardTitles('team'), ['Plan', 'Build', 'Commit', 'Push']);
    assert.deepEqual(hardTitles('org'), ['Plan', 'Build', 'Commit', 'Push']);
  });
});
