// Where each AI tool reads skills and always-on instructions. Locations were checked against each tool's
// official documentation on 2026-11-10:
//   Claude Code  skills .claude/skills                      rules CLAUDE.md
//   Codex        skills .agents/skills                       rules AGENTS.md
//   OpenCode     skills .opencode/skills, .claude/skills,    rules AGENTS.md (CLAUDE.md only if there is no
//                       .agents/skills                              AGENTS.md: the first match wins)
//   Cursor       skills .agents/skills, .cursor/skills       rules AGENTS.md (it does not read CLAUDE.md;
//                                                                  .cursor/rules files must be .mdc)
//   Cline        skills .cline/skills, .clinerules/skills,   rules AGENTS.md (also .clinerules/)
//                       .claude/skills   (NOT .agents/skills)
// `reads` lists the project skill folders a tool loads by default; `skillsDir` is where we install for it.
export const TOOLS = {
  'claude-code': { label: 'Claude Code', skillsDir: '.claude/skills', reads: ['.claude/skills'] },
  codex: { label: 'Codex', skillsDir: '.agents/skills', reads: ['.agents/skills'] },
  opencode: {
    label: 'OpenCode',
    skillsDir: '.agents/skills',
    reads: ['.opencode/skills', '.claude/skills', '.agents/skills'],
  },
  cursor: { label: 'Cursor', skillsDir: '.agents/skills', reads: ['.agents/skills', '.cursor/skills'] },
  cline: {
    label: 'Cline',
    skillsDir: '.cline/skills',
    reads: ['.cline/skills', '.clinerules/skills', '.claude/skills'],
  },
};

export const TOOL_IDS = Object.keys(TOOLS);

/**
 * What to write for a list of tools.
 * - `skillsDirs`: the distinct folders; a tool adds none when an earlier tool's folder is one it already reads.
 * - `rulesFile`: the one file that holds the kit's rules (AGENTS.md as soon as a tool other than Claude Code
 *   is used, since only Claude Code reads CLAUDE.md and the others read AGENTS.md).
 * - `claudeImportsAgents`: Claude Code then gets a one-line `@AGENTS.md` import in CLAUDE.md, so the rules
 *   live in one place and cannot drift apart.
 */
export function targetsFor(toolIds) {
  const unknown = toolIds.filter((id) => !TOOLS[id]);
  if (unknown.length) throw new Error(`unknown tool(s): ${unknown.join(', ')}; known: ${TOOL_IDS.join(', ')}`);
  const ordered = TOOL_IDS.filter((id) => toolIds.includes(id));
  const skillsDirs = [];
  for (const id of ordered) {
    const tool = TOOLS[id];
    if (skillsDirs.some((dir) => tool.reads.includes(dir))) continue;
    skillsDirs.push(tool.skillsDir);
  }
  const hasOtherTools = ordered.some((id) => id !== 'claude-code');
  return {
    skillsDirs,
    rulesFile: hasOtherTools ? 'AGENTS.md' : 'CLAUDE.md',
    claudeImportsAgents: ordered.includes('claude-code') && hasOtherTools,
  };
}
