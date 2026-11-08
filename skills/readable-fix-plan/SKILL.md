---
name: readable-fix-plan
description: Turn review findings, a bug list, or several existing plans into one scannable, clickable fix plan with severity tags, verified file links, before/after fixes, and a verification checklist. Use when asked to "make a plan", "fix plan", "combine plans", or to plan fixes for review findings. Works in any project.
---

# Readable Fix Plan

Produce a fix plan a reader can scan in one minute and act on. Every claim is checked against the real
code first, and every file reference is a clickable link that opens the exact lines.

## When to use

- Planning fixes from a code review, an audit, or a bug list.
- Merging two or more existing plans and checking each claim against the code.

## Steps

### 1. Verify before writing

- For each item, read or grep the code it refers to. Do not copy line numbers from an old plan; they drift.
- Record each claim as **Confirmed**, **Corrected** (wrong place or wrong detail), or **New** (found while
  checking).
- Check whether an item is already fixed. Mark it "Already done" instead of repeating it.

### 2. Write the plan in this order

1. **Header**: one-line goal, scope counts (work items, files, tests, new dependencies), and a tip on how
   to open the links.
2. **At a glance**: table with `#`, item, type, severity, effort, status.
   Severity: 🔴 wrong data or behaviour the user can see · 🟠 user-visible polish or behaviour ·
   🟡 maintainability or docs. Effort: XS / S / M.
3. **Comparison**: only when merging plans: what each source said → what was found → result.
4. **Work-item cards**: one card per item (format below).
5. **Order of work**: numbered; say which items must go first.
6. **Verification checklist**: `- [ ]` items: type check, lint, tests, and manual checks with the exact
   expected result.
7. **Decisions I made**: every choice a reader might want to change.
8. **Deferred**: found but out of scope, with the reason.

### 3. Card format

```
### 🔴 N · Short title
**Where:** [file.ext:72](path/to/file.ext#L72), every reference is a link
**What's wrong:** one or two sentences, concrete (what the user sees).
**Why it matters:** the consequence in plain words.
**Root cause:** only when it is not obvious.
**Fix:** a before/after snippet, or a numbered list.
**Check:** how to confirm it is fixed.
```

## Link rules (required)

- Every file reference is a markdown link with a line anchor: `[name.ext:72](path#L72)`, or a range
  `#L62-L66`. Never use plain backticks for a file that a reader should open.
- A relative link resolves from **the folder of the file it is written in**. In a plan file stored in a
  plans folder, use a path relative to that folder. In a chat reply, use a path relative to the workspace
  root.
- Check that the target exists before you write the link.
- Tell the reader how to open links: Ctrl+Click in the editor; plain click in the rendered preview.

## Rules

- Plain language. Explain a term the first time it appears.
- Mark a guess as a guess ("inferred", "likely"). Do not present it as fact.
- Never claim a visual fix is verified unless the app was run. Say "to verify" instead.
- Keep each card self-contained: a reader should understand it without the others.
- If an item is out of scope, say so and name the file, rather than silently dropping it.
