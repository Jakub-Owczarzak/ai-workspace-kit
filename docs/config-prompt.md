# Manager prompt for tools without skill support

The setup already ran (`npx ai-workspace-kit init`, then the setup prompt), and you want to change something: turn a
feature on or off, switch the profile, fine-tune a control. If your AI tool cannot run a skill by name, paste the text
below into a new session in the project folder.

```text
Change the workspace kit setup in this project. The kit is in .claude/workspace-kit/. Read
.claude/workspace-kit/skills/manage-workspace/SKILL.md completely and follow it step by step as if it were
your instructions. Ask me what to change, in the rounds it describes. Use only the "config" commands it lists
(node .claude/workspace-kit/bin/cli.mjs config ...), always show me the --dry-run plan first and wait for my yes,
and never edit the settings, hooks or instruction files by hand. Do not commit.
```

What happens next: the assistant shows the features with their state (on, off or partial), asks what to change, shows
each change as a dry run, and applies it only after your yes. Turning a feature off removes only what the kit installed
for it; a file you edited since is kept and reported. Pieces the feature pulled in stay on, and the plan lists them: add
`--prune` (for example `config feature test-guard off --prune`) to turn those off as well.

**In a terminal, without an AI tool:** `node .claude/workspace-kit/bin/cli.mjs config menu` opens a numbered menu for the
same things. It shows the plan for every change and asks `Apply this? [y/N]`; an empty answer changes nothing. The
single commands are `config feature list`, `config feature factory on pr`, `config profile team --install-defaults`,
`config set docs.check strict` and `config unset docs.check`; add `--dry-run` to any change to see it first.

To add or remove an AI tool or a stack pack, run the setup again ([setup-prompt.md](setup-prompt.md)). To remove the
kit completely, see the uninstall section of [install-and-update.md](install-and-update.md).
