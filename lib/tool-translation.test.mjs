import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The kit's skills are written for Claude Code. adapters/tool-translation.md tells every other tool what to do
// instead. These tests keep the two in step: a skill that starts naming a Claude Code feature the rule does not
// cover fails here, so no tool is left with an instruction it cannot follow.

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULE = readFileSync(join(KIT, 'adapters', 'tool-translation.md'), 'utf8');

/** Markdown files the assistant is told to follow: skills (with references), subagent definitions, rules, the template. */
function instructionFiles() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.md')) files.push(path);
    }
  };
  walk(join(KIT, 'skills'));
  walk(join(KIT, 'rules'));
  walk(join(KIT, 'templates', 'agents'));
  files.push(join(KIT, 'templates', 'CLAUDE.md'));
  return files;
}

const TOOL_NAMES = 'Read|Edit|Write|Bash|Grep|Glob';

/**
 * One row per Claude Code feature. `usedPattern` finds it in the kit's instructions; `rulePattern` must find its
 * stand-in in the translation rule. `usedInKit: false` marks a stand-in kept on purpose although no kit file names
 * the feature today (a tool's own plan mode can still take over a session).
 */
const FEATURES = [
  { name: 'AskUserQuestion', usedPattern: /AskUserQuestion/, rulePattern: /AskUserQuestion/ },
  { name: 'plan mode', usedPattern: /plan mode|ExitPlanMode/i, rulePattern: /Plan mode/, usedInKit: false },
  { name: 'subagents', usedPattern: /subagent|\.claude\/agents/i, rulePattern: /Subagents[^\n]*factory-builder[^\n]*reviewer/ },
  { name: 'slash commands', usedPattern: /\/wk-[a-z]/, rulePattern: /Slash commands/ },
  {
    name: 'tool names',
    usedPattern: new RegExp(`\`(${TOOL_NAMES})\`|^tools:.*\\b(${TOOL_NAMES})\\b|(${TOOL_NAMES}) and (${TOOL_NAMES}) tools`, 'm'),
    rulePattern: /Tool names/,
  },
  { name: 'the CLAUDE.md file', usedPattern: /CLAUDE\.md/, rulePattern: /`CLAUDE\.md`[\s\S]{0,200}`AGENTS\.md`/ },
  { name: '.claude/ data paths', usedPattern: /\.claude\/(workflow\.json|factory|settings\.json)/, rulePattern: /Paths starting with `\.claude\/`/ },
];

const filesWith = (pattern) =>
  instructionFiles()
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(KIT, file).replaceAll('\\', '/'));

for (const feature of FEATURES) {
  test(`the translation rule has a stand-in for ${feature.name}`, () => {
    assert.match(
      RULE,
      feature.rulePattern,
      `a kit instruction names ${feature.name} (${filesWith(feature.usedPattern).slice(0, 3).join(', ') || 'none today'}) ` +
        'but adapters/tool-translation.md has no stand-in for it'
    );
  });

  if (feature.usedInKit === false) continue;
  test(`${feature.name} is still named by a kit instruction (no dead stand-in)`, () => {
    assert.ok(filesWith(feature.usedPattern).length > 0, `no kit instruction names ${feature.name} any more: drop its stand-in`);
  });
}

test('a Claude Code feature missing from the rule would be caught (the check is not vacuous)', () => {
  const withoutAsk = RULE.replace(/AskUserQuestion/g, 'the question tool');
  const feature = FEATURES.find((f) => f.name === 'AskUserQuestion');
  assert.doesNotMatch(withoutAsk, feature.rulePattern);
  assert.ok(filesWith(feature.usedPattern).length > 0, 'AskUserQuestion is named by a skill, so dropping its stand-in must fail');
});
