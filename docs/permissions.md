# Fewer approval pop-ups in Claude Code (optional, your responsibility)

By default Claude Code asks before it runs most shell commands. That is the safe setting, and the kit works with
it. If the constant "Allow this command?" prompts slow you down, you can pre-approve the commands you trust. This
page shows one way. **The kit never writes these settings for you**: they live in your own Claude Code settings
files, outside the files the kit installs.

> **Warning: you are choosing to give an AI agent this level of access, and the responsibility is yours.**
> Every rule below lets the assistant run that kind of command without asking you first. Broad rules such as
> `node *`, `python *` or `sed *` mean it can run any script or change any file those programs can reach, so a
> mistaken or manipulated instruction can do real damage. Allow only what you would be comfortable letting run
> unattended, keep your work in git, and do not do this on a machine or with credentials you cannot afford to
> have touched. Anthropic's own advice is to use the most permissive modes only inside a container or a virtual
> machine. The kit's guards (the pre-commit and pre-push hooks, the protected-branch refusal, "never merge") still
> apply, but they are not a substitute for your judgment.

## Why the prompts keep coming back

- A rule matches the **start** of a command. `Bash(npm run *)` does not match `npm --prefix my-app run test`.
- Each part of a chained command (`a && b | c`) must be allowed on its own.
- "Don't ask again" saves that **exact** command, so long one-off commands pile up and never match again.
- A `cd <folder> && ... >> file` always asks, because the tool cannot tell which folder the write lands in. No
  rule can fix this one.
- A session keeps the settings it started with. Restart it (or run *Developer: Reload Window* in VS Code) after
  a change, then run `/permissions` to see each rule and the file it comes from.

## The setup

Put the permissions in the **user** settings file, `~/.claude/settings.json` (on Windows
`C:\Users\<you>\.claude\settings.json`), so they apply to every project and you do not copy them 10 times. If the
file exists, merge these keys into it; do not overwrite it. A project's own `.claude/settings.json` adds to them.

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "Bash(npx tsc *)",
      "Bash(npx vitest *)",
      "Bash(npx jest *)",
      "Bash(npx eslint *)",
      "Bash(npx prettier *)",
      "Bash(npm run *)",
      "Bash(npm test *)",
      "Bash(npm install *)",
      "Bash(npm ls *)",

      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git show *)",
      "Bash(git branch *)",
      "Bash(git ls-files *)",
      "Bash(git add *)",
      "Bash(git mv *)",
      "Bash(git commit *)",
      "Bash(git stash *)"
    ],
    "ask": [
      "Bash(git push *)",
      "Bash(git reset --hard *)"
    ],
    "deny": [
      "Bash(rm -rf /*)",
      "Bash(rm -rf ~*)"
    ]
  }
}
```

- `"defaultMode": "acceptEdits"` lets file edits (and simple file commands such as `mkdir` and `mv` inside the
  project) go through without a prompt.
- The `allow` list is a starting point: build, test and everyday git. Add one rule per command family you use
  (for example `Bash(npx expo *)`), not one per exact command.
- `ask` keeps a prompt on the commands you always want to see. `deny` refuses them outright.
- For a project whose app lives in a subfolder, add the form Claude actually writes, for example
  `Bash(npm --prefix my-app run *)`, or open your editor on the app folder itself so no `--prefix` is needed.

Broader rules some people add, and what each one gives away: `Bash(node *)`, `Bash(python *)` (run any script),
`Bash(sed *)`, `Bash(cp *)`, `Bash(mv *)` (change or overwrite files), `Bash(printf *)`. They remove many prompts
and are the riskiest lines in a list like this. Leave them out unless you accept that.

## Shell habits that avoid prompts (the kit's own rule)

Add these to your user `~/.claude/CLAUDE.md` (the kit's rules already follow them):

```text
- Run commands from the project root; never prefix them with `cd` to the project folder.
- Change files (including docs and state notes) with the Edit/Write tools, not `printf`/`echo >>` in Bash.
- Prefer one command per Bash call instead of chaining with `&&` / `;`.
```

## With the factory

`/wk-run-factory` pushes feature branches when `factory.mode` is `pr`. With `git push *` under `ask`, you will be
asked for each push, which is a sensible brake. If you move it to `allow`, the factory pushes without asking you;
the kit's pre-push hook still refuses the protected branch, and nothing is ever merged by the factory. Decide this
on purpose, once, knowing that is what you chose.

## Auto mode and bypass modes

Claude Code also has an `auto` mode, where a background check reviews each action instead of asking you, and a
`bypassPermissions` mode that skips almost every check. The second is meant for a container or a virtual machine.
The kit does not configure either; if you use one, the warning above applies to it in full.

Source: Anthropic's Claude Code documentation, "Configure permissions".
