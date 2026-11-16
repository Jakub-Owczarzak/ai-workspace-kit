// Run: node --test lib/factory-write.test.mjs
// Claude Code refuses a file-writing tool for paths under `.claude/` when nobody can answer the prompt (an unattended
// `claude -p` run), and allow rules did not change that in `acceptEdits` mode. The factory therefore writes its own
// files under `.claude/factory/` through `factory-guard.mjs`. These tests keep the kit's instructions from drifting
// back to a file-writing tool for those paths.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function markdownFiles(dir) {
  const found = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) found.push(...markdownFiles(path));
    else if (name.endsWith('.md')) found.push(path);
  }
  return found;
}

test('the builder is told to write its handoff through the guard script, with the reason', () => {
  const builder = read('templates/agents/factory-builder.md');
  assert.match(builder, /factory-guard\.mjs handoff-write --bucket/);
  assert.match(builder, /refuses that tool under `\.claude\/`/);
});

test('the factory skill is told to write the pull request text through the guard script', () => {
  assert.match(read('skills/run-factory/SKILL.md'), /factory-guard\.mjs pr-write --branch/);
});

test('the review findings are piped into the record, not saved under .claude/reviews/ first', () => {
  const details = read('rules/commit-gate-details.md');
  assert.match(details, /--findings-file -/);
  assert.doesNotMatch(details, /--findings-file \.claude\/reviews/);
  assert.match(read('skills/run-factory/SKILL.md'), /--findings-file -/);
});

test('no instruction tells an agent to use a file-writing tool for a path under .claude/factory/', () => {
  const files = [...markdownFiles('skills'), ...markdownFiles('templates/agents'), ...markdownFiles('rules')];
  const offences = [];
  for (const file of files) {
    for (const [index, line] of read(file).split('\n').entries()) {
      if (!line.includes('.claude/factory') && !/handoff file|handoff path/i.test(line)) continue;
      // A sentence that says not to use the tool, or that names the guard script, is the intended text.
      if (/\b(?:Write|Edit) tool\b|\b(?:with|using|use) the (?:Write|Edit)\b|\bWrite\/Edit\b/.test(line) && !/\bnot\b|refuses|handoff-write|pr-write/i.test(line)) {
        offences.push(`${relative(ROOT, join(ROOT, file))}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offences, []);
});
