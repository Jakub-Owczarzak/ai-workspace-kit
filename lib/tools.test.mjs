import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_IDS, targetsFor } from './tools.mjs';

test('Claude Code alone: .claude/skills and CLAUDE.md, nothing imported', () => {
  assert.deepEqual(targetsFor(['claude-code']), { skillsDirs: ['.claude/skills'], rulesFile: 'CLAUDE.md', claudeImportsAgents: false });
});

test('tools that read .agents/skills share one folder and AGENTS.md', () => {
  const result = targetsFor(['cursor', 'codex', 'opencode']);
  assert.deepEqual(result.skillsDirs, ['.agents/skills']);
  assert.equal(result.rulesFile, 'AGENTS.md');
  assert.equal(result.claudeImportsAgents, false);
});

test('Claude Code plus another tool: rules live once in AGENTS.md and CLAUDE.md imports them', () => {
  const result = targetsFor(['codex', 'claude-code']);
  assert.equal(result.rulesFile, 'AGENTS.md');
  assert.equal(result.claudeImportsAgents, true);
  assert.deepEqual(result.skillsDirs, ['.claude/skills', '.agents/skills']);
});

test('Cline does not read .agents/skills, so it gets its own folder', () => {
  assert.deepEqual(targetsFor(['cline']).skillsDirs, ['.cline/skills']);
  assert.deepEqual(targetsFor(['codex', 'cline']).skillsDirs, ['.agents/skills', '.cline/skills']);
});

test('a tool adds no folder when another selected tool already uses one it reads', () => {
  assert.deepEqual(targetsFor(['claude-code', 'opencode']).skillsDirs, ['.claude/skills']);
  assert.deepEqual(targetsFor(['claude-code', 'cline']).skillsDirs, ['.claude/skills']);
});

test('Cursor is not assumed to read .claude/skills by default, so it gets .agents/skills', () => {
  assert.deepEqual(targetsFor(['claude-code', 'cursor']).skillsDirs, ['.claude/skills', '.agents/skills']);
});

test('the result does not depend on the order the tools are listed in', () => {
  assert.deepEqual(targetsFor(['cline', 'codex', 'claude-code']), targetsFor(['claude-code', 'cline', 'codex']));
});

test('unknown tools are refused and the known ones are named', () => {
  assert.throws(() => targetsFor(['emacs']), /unknown tool.*emacs.*claude-code/);
  assert.ok(TOOL_IDS.includes('cline'));
});
