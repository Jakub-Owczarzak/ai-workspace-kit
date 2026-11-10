# Setup prompt for tools without skill support

`npx ai-workspace-kit init` copied the kit to `.claude/workspace-kit/`. If your AI tool cannot
run a skill by name, paste the text below into a new session in the project folder.

```text
Set up the workspace kit in this project. The kit is in .claude/workspace-kit/. Read
.claude/workspace-kit/skills/setup-workspace/SKILL.md completely and follow it step by step as if it were
your instructions. Ask me the questions it describes, in the rounds it describes, using the explanations
from .claude/workspace-kit/catalog/options.json. Do not overwrite or reorder anything I wrote; only create
new files, add marked blocks, and skip what already exists. Show me the dry-run report before applying.
Do not commit.
```

What happens next: the assistant asks which tools and which profile (solo, team, org) you use, explains each
switchable rule, skill, hook and check in a line or two, installs only what you choose, and reports what it
skipped. Run it again at any time to change your choices; it is safe to repeat.

To undo everything the setup installed, run `node .claude/workspace-kit/bin/cli.mjs uninstall` (a preview; add
`--yes` to remove). It removes only what the setup recorded, keeps any file you edited since, and never touches
your own skills, scripts or hooks.
