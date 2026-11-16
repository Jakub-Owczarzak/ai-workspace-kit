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
skipped. Run it again at any time to add pieces or change tools and stack packs; it is safe to repeat. A re-run starts
from your recorded choices (`.claude/workspace-kit/choices.json`), not from the defaults, so it keeps what you turned off.
It never turns anything off itself, and it turns on again whatever the answers include, saying so in a NOTE. To switch
features on or off later, change the profile or a control, use the manager prompt in [config-prompt.md](config-prompt.md)
(skill `manage-workspace`) or `config menu` in a terminal.

To undo everything the setup installed, run `node .claude/workspace-kit/bin/cli.mjs uninstall` (a preview; add
`--yes` to remove). It removes only what the setup recorded, keeps any file you edited since (and prints a prompt to
clean those up with your AI tool, or use `--purge` to remove them too), and never touches your own skills, scripts or
hooks.
