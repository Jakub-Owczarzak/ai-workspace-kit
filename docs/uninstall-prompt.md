# Cleanup prompt after an uninstall

`node .claude/workspace-kit/bin/cli.mjs uninstall --yes` removes what the kit installed and keeps what you changed
since. When something is kept, the command ends by printing the prompt below with the list of what is left, because the
kit folder (and the record of what it installed) is gone once the uninstall finishes. Paste the prompt into your AI tool,
in the project folder, to go through the leftovers one by one.

To remove the leftovers without asking about each, run `uninstall --purge --yes` instead of `uninstall --yes`
(see [Uninstall](install-and-update.md#uninstall)).

```text
The workspace kit was uninstalled from this project. These items were installed or created by the kit and later changed
(or were left by the kit while it ran), so the uninstall kept them:

{{LEFTOVERS}}

Go through them one at a time. For each, show me what is in it (for a file: its first lines, and what looks like the
kit's own text), then ask me whether to delete it, keep it, or remove only the kit's text, and wait for my answer.
Touch only the items on this list: change nothing else, do not commit, and finish by saying what you removed and what
you kept.
```
