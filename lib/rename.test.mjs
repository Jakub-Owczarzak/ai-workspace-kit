import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteSkillNames } from './rename.mjs';

const NAMES = ['pr-description', 'goal-first-planner', 'changelog-bump', 'workspace-router'];

test('prefixes names in backticks, slash commands, quotes and paths', () => {
  const text = 'Use `goal-first-planner`, or /pr-description, or "workspace-router", see .claude/skills/changelog-bump/scripts/x.mjs';
  assert.equal(
    rewriteSkillNames(text, NAMES),
    'Use `wk-goal-first-planner`, or /wk-pr-description, or "wk-workspace-router", see .claude/skills/wk-changelog-bump/scripts/x.mjs'
  );
});

test('is idempotent and does not touch already prefixed names', () => {
  const once = rewriteSkillNames('run `pr-description`', NAMES);
  assert.equal(rewriteSkillNames(once, NAMES), once);
});

test('does not touch longer words that contain a skill name', () => {
  assert.equal(rewriteSkillNames('my-pr-description-x and pr-descriptions', NAMES), 'my-pr-description-x and pr-descriptions');
});

test('leaves paths into the kit folder alone', () => {
  const text = 'read .claude/workspace-kit/skills/changelog-bump/SKILL.md and <KIT>/skills/pr-description/';
  assert.equal(rewriteSkillNames(text, NAMES), text);
});
