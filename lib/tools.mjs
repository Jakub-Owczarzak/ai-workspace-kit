// Where each AI tool reads skills and always-on instructions. Bucket 4 extends this with the details
// that need per-tool handling (Cursor .mdc rule files, Cline, hooks, settings).
export const TOOLS = {
  'claude-code': { label: 'Claude Code', skillsDir: '.claude/skills', rulesFile: 'CLAUDE.md' },
  cursor: { label: 'Cursor', skillsDir: '.agents/skills', rulesFile: 'AGENTS.md' },
  codex: { label: 'Codex', skillsDir: '.agents/skills', rulesFile: 'AGENTS.md' },
  opencode: { label: 'OpenCode', skillsDir: '.agents/skills', rulesFile: 'AGENTS.md' },
};

export const TOOL_IDS = Object.keys(TOOLS);

/** The distinct skill folders and instruction files for a list of tools (tools often share them). */
export function targetsFor(toolIds) {
  const unknown = toolIds.filter((id) => !TOOLS[id]);
  if (unknown.length) throw new Error(`unknown tool(s): ${unknown.join(', ')}; known: ${TOOL_IDS.join(', ')}`);
  const picked = toolIds.map((id) => TOOLS[id]);
  return {
    skillsDirs: [...new Set(picked.map((tool) => tool.skillsDir))],
    rulesFiles: [...new Set(picked.map((tool) => tool.rulesFile))],
  };
}
