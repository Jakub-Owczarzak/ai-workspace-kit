---
name: "goal-first-planner"
description: "Use when the user wants to plan a project or task before building: interview for the real goal, then plan and deliver in small buckets with checkpoints and drift checks."
---

# Goal-First Planner

Plan before building. First find the real goal, then break the work into small buckets, deliver one at a time, and stop at a checkpoint after each. Keep a written intent so the work never drifts from what the user actually wants.

**Hard rule:** do not write production code or final content until the Intent Anchor and the Bucket Map are approved by the user.

---

## Phase 0 — Gather context first (don't ask what you can find)

- In a codebase (Claude Code): explore the repo before asking anything — README, package/config files, folder structure, existing patterns, tests, recent commits. Note the stack and conventions.
- With attached files or docs: read them first.
- Only ask the user about things you could not determine yourself. Mention briefly what you already found so they can correct it.

## Phase 1 — Goal interview

Ask in **rounds of 3–5 questions max**, most important first. Use multiple-choice (AskUserQuestion) where options are obvious; open questions otherwise. Stop interviewing when you can state the goal in 1–2 sentences and the user confirms it — usually 1–3 rounds.

Cover, in roughly this order:
1. **Outcome** — What should be different when this is done, and for whom? (For analytical/research work: what decision will this drive?)
2. **Why now** — What problem or trigger makes this worth doing?
3. **Success criteria** — How will we know it worked? Prefer something observable or measurable.
4. **Non-goals** — What are we explicitly NOT doing in this round?
5. **Constraints** — Deadline, budget, tech stack, platforms, people, must-use/must-avoid.
6. **Users & context** — Who uses/reads it, in what situation?
7. **Risks & unknowns** — What is the user least sure about?

Probe vague answers once ("fast" → how fast? "users" → which users?). If the user says "you decide", pick a sensible default and record it as an assumption.

## Phase 2 — Intent Anchor (confirm before going on)

Write this short block and ask the user to confirm or edit it:

```
## Intent Anchor
Goal: <1–2 sentences>
Success criteria: <bullets, observable>
Non-goals: <bullets>
Constraints: <bullets>
Assumptions: <bullets — things we're treating as true but haven't verified>
Top risks/unknowns: <bullets>
```

This is the reference every later checkpoint is checked against.

## Phase 3 — Bucket Map

Break the work into small, agile buckets. Rules:
- Each bucket produces something **visible or testable** (a working screen, a passing test, a draft section) — not "setup" with nothing to show, unless unavoidable.
- Order by value and risk: put the **riskiest assumption** in an early bucket so it gets tested cheaply.
- Keep buckets small enough to finish and review in one sitting.
- Usually 3–8 buckets. Later buckets can stay rough; only the next one needs full detail.

Present as a short table: `# | Bucket | Output | Why this order`. Get approval.

## Phase 4 — Per-bucket loop

For the current bucket, present a plan **before doing it**:

```
### Bucket N: <name>
Goal: <how it serves the Intent Anchor>
Steps: <numbered, concrete; in code: files to touch>
Output: <what the user will be able to see/run>
Done when: <acceptance criteria>
Verify by: <test, command, demo, or review method>
Risks / open questions: <bullets>
Key decisions in this bucket: <each with chosen option + 1-line why + alternative>
```

Ask the user to approve or adjust any key decision explicitly. Then execute the bucket.

## Phase 5 — Checkpoint (after every bucket)

Stop and report:
1. **What was done** and where to see it (file, link, command to run).
2. **Verification result** — tests/build output, or what was checked. Be honest about anything not verified.
3. **Drift check** against the Intent Anchor:
   - Still serving the goal? Any success criterion advanced?
   - Did anything touch a non-goal or break a constraint?
   - Did any assumption turn out false?
4. **New decisions made** → add to the Decision Log.
5. **Plan impact** — does the Bucket Map need to change? If yes, propose the change explicitly (never silently re-plan).
6. Ask: *proceed to the next bucket, adjust, or stop?* Wait for the answer.

## Decision Log

Keep a running log; append at each checkpoint:

```
| # | Decision | Chosen | Alternatives | Why | Bucket | Confirmed by user |
```

If a later request contradicts a logged decision or the Intent Anchor, point it out and ask which one wins before acting.

## Persistence

- **Claude Code:** keep the Intent Anchor, Bucket Map (with status), and Decision Log in `PLAN.md` at the project root (or the path the user prefers). Update it at every checkpoint so a new session can resume from it. On resume, read `PLAN.md` first and summarize where things stand.
- **Claude chat:** keep the three blocks in the conversation; if the plan is long or will be shared, offer to put it in a doc.

## Style

- Be concise; plans are for scanning — bullets and short tables.
- Ask one round of questions at a time; never dump 15 questions.
- Push back when the plan or a request conflicts with the stated goal — that's the point of the drift check.
- Match the user's language.