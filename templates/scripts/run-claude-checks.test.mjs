// Run: node --test run-claude-checks.test.mjs
// No test here calls Claude: the model call is replaced by a fake `exec`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildImportsPrompt,
  buildTriggerCases,
  buildTriggerPrompt,
  gateRun,
  parseSkillAnswer,
  readSkillFixtures,
  runClaudeChecks,
  scoreCase,
  scoreImportsAnswer,
} from './run-claude-checks.mjs';

describe('parseSkillAnswer', () => {
  const names = ['pr-description', 'changelog-bump', 'goal-first-planner'];

  it('reads an exact name, with formatting characters', () => {
    assert.equal(parseSkillAnswer('pr-description', names), 'pr-description');
    assert.equal(parseSkillAnswer('`Changelog-Bump`\n', names), 'changelog-bump');
    assert.equal(parseSkillAnswer('"goal-first-planner".', names), 'goal-first-planner');
  });

  it('reads NONE in any case', () => {
    assert.equal(parseSkillAnswer('NONE', names), 'NONE');
    assert.equal(parseSkillAnswer('none.', names), 'NONE');
  });

  it('finds a name inside a longer answer, preferring the longest match', () => {
    assert.equal(parseSkillAnswer('I would load the pr-description skill first.', names), 'pr-description');
    assert.equal(parseSkillAnswer('x', ['bump', 'changelog-bump']), null);
    assert.equal(parseSkillAnswer('changelog-bump', ['bump', 'changelog-bump']), 'changelog-bump');
  });

  it('returns null for an empty or unrelated answer', () => {
    assert.equal(parseSkillAnswer('', names), null);
    assert.equal(parseSkillAnswer(undefined, names), null);
    assert.equal(parseSkillAnswer('I am not sure about this', names), null);
  });
});

describe('scoreCase', () => {
  const should = { skill: 'a', phrase: 'p', kind: 'should' };
  const shouldNot = { skill: 'a', phrase: 'p', kind: 'shouldNot' };

  it('passes a should case only when the skill is named', () => {
    assert.equal(scoreCase(should, 'a').result, 'pass');
    assert.equal(scoreCase(should, 'b').result, 'fail');
    assert.equal(scoreCase(should, 'NONE').result, 'fail');
  });

  it('passes a shouldNot case when anything else is named, and fails when the skill is', () => {
    assert.equal(scoreCase(shouldNot, 'NONE').result, 'pass');
    assert.equal(scoreCase(shouldNot, 'b').result, 'pass');
    assert.equal(scoreCase(shouldNot, 'a').result, 'fail');
  });

  it('calls an answer that names no known skill unclear', () => {
    assert.equal(scoreCase(should, null).result, 'unclear');
    assert.equal(scoreCase(shouldNot, null).result, 'unclear');
  });
});

describe('scoreImportsAnswer', () => {
  it('finds expected files by name, case-insensitively', () => {
    const { found, missing } = scoreImportsAnswer('CLAUDE.md\n@agents.md', ['/p/CLAUDE.md', '/p/AGENTS.md', '/p/rules/a.md']);
    assert.deepEqual(found, ['/p/CLAUDE.md', '/p/AGENTS.md']);
    assert.deepEqual(missing, ['/p/rules/a.md']);
  });
});

describe('gateRun', () => {
  it('does nothing while the control is off', () => {
    assert.equal(gateRun({ enabled: false, yes: true, dryRun: false, callCount: 5 }).action, 'skip-off');
  });

  it('asks for --yes, and treats --dry-run as a preview, even with --yes', () => {
    assert.equal(gateRun({ enabled: true, yes: false, dryRun: false, callCount: 5 }).action, 'confirm');
    const dry = gateRun({ enabled: true, yes: true, dryRun: true, callCount: 5 });
    assert.equal(dry.action, 'confirm');
    assert.match(dry.message, /5 call/);
  });

  it('runs only when enabled and confirmed', () => {
    assert.equal(gateRun({ enabled: true, yes: true, dryRun: false, callCount: 1 }).action, 'run');
  });
});

describe('prompts and cases', () => {
  it('put the phrase in the trigger prompt and forbid tools', () => {
    const prompt = buildTriggerPrompt('write the PR text');
    assert.match(prompt, /write the PR text/);
    assert.match(prompt, /Do not call any tool/);
    assert.match(buildImportsPrompt(), /CLAUDE\.md/);
  });

  it('build one case per phrase and skip skills started by hand or without fixtures', () => {
    const cases = buildTriggerCases([
      { name: 'a', startedByHand: false, fixtures: { should: ['s1', 's2'], shouldNot: ['n1'] } },
      { name: 'b', startedByHand: true, fixtures: { should: ['x'] } },
      { name: 'c', startedByHand: false, fixtures: null },
    ]);
    assert.deepEqual(cases.map((testCase) => `${testCase.skill}:${testCase.kind}`), ['a:should', 'a:should', 'a:shouldNot']);
  });
});

describe('runClaudeChecks with a fake model', () => {
  async function withProject(workflow, callback) {
    const root = mkdtempSync(join(tmpdir(), 'claude-checks-'));
    try {
      const write = (path, text) => {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), text);
      };
      write('CLAUDE.md', '@AGENTS.md');
      write('AGENTS.md', 'x');
      write('.claude/skills/demo/SKILL.md', '---\nname: demo\ndescription: Use when asked to demo.\n---\n');
      write('.claude/skills/demo/triggers.json', JSON.stringify({ should: ['show the demo'], shouldNot: ['unrelated'] }));
      if (workflow) write('.claude/workflow.json', workflow);
      // Wait for the test body before deleting the folder.
      return await callback(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function fakeModel() {
    const calls = [];
    const exec = (prompt) => {
      calls.push(prompt);
      if (/instruction file/.test(prompt)) return 'CLAUDE.md\nAGENTS.md';
      return /show the demo/.test(prompt) ? 'demo' : 'NONE';
    };
    return { exec, calls };
  }

  const options = (root, extra) => ({ root, skillsDirs: [join(root, '.claude', 'skills')], env: {}, ...extra });

  it('makes no calls while claude.runChecks is off (the default)', async () => {
    await withProject(undefined, async (root) => {
      const { exec, calls } = fakeModel();
      const result = await runClaudeChecks({ ...options(root, { yes: true }), exec });
      assert.equal(result.gate.action, 'skip-off');
      assert.equal(calls.length, 0);
    });
  });

  it('makes no calls without --yes, and says how many it would make', async () => {
    await withProject('{"overrides":{"claude.runChecks":true}}', async (root) => {
      const { exec, calls } = fakeModel();
      const result = await runClaudeChecks({ ...options(root), exec });
      assert.equal(result.gate.action, 'confirm');
      assert.match(result.lines[0], /3 call/);
      assert.equal(calls.length, 0);
    });
  });

  it('can be enabled for one command with CLAUDE_RUN_CHECKS=1', async () => {
    await withProject(undefined, async (root) => {
      const { exec } = fakeModel();
      const result = await runClaudeChecks({ ...options(root, { yes: true, env: { CLAUDE_RUN_CHECKS: '1' } }), exec });
      assert.equal(result.gate.action, 'run');
    });
  });

  it('runs the imports call and one call per phrase, and passes when the model behaves', async () => {
    await withProject('{"overrides":{"claude.runChecks":true}}', async (root) => {
      const { exec, calls } = fakeModel();
      const result = await runClaudeChecks({ ...options(root, { yes: true }), exec });
      assert.equal(calls.length, 3);
      assert.equal(result.exitCode, 0);
      assert.match(result.lines.join('\n'), /imports \(model-reported\): 2 of 2 files seen/);
      assert.match(result.lines.join('\n'), /triggers \(model-reported\): 2 pass, 0 fail/);
    });
  });

  it('reports a failing trigger and a missing import with exit code 1', async () => {
    await withProject('{"overrides":{"claude.runChecks":true}}', async (root) => {
      const exec = (prompt) => (/instruction file/.test(prompt) ? 'CLAUDE.md' : 'NONE');
      const result = await runClaudeChecks({ ...options(root, { yes: true }), exec });
      assert.equal(result.exitCode, 1);
      const text = result.lines.join('\n');
      assert.match(text, /not reported by the model: .*AGENTS\.md/);
      assert.match(text, /FAIL: "show the demo" \(should trigger demo; model said NONE\)/);
    });
  });

  it('counts a failed call as an error, not a crash', async () => {
    await withProject('{"overrides":{"claude.runChecks":true}}', async (root) => {
      const exec = () => {
        throw new Error('claude not found');
      };
      const result = await runClaudeChecks({ ...options(root, { yes: true }), exec });
      assert.equal(result.exitCode, 1);
      assert.match(result.lines.join('\n'), /claude not found/);
    });
  });

  it('reads the fixtures from the skills folders', async () => {
    await withProject(undefined, (root) => {
      const skills = readSkillFixtures([join(root, '.claude', 'skills')]);
      assert.equal(skills.length, 1);
      assert.deepEqual(skills[0].fixtures.should, ['show the demo']);
    });
  });
});
