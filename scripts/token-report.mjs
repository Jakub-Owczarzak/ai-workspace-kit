// Kit development only (not shipped). Prints a Markdown token report for one Claude Code session: the orchestrator and every
// subagent (by role), with the model turns, the first and last prompt size, what was processed in total and a rough cost in
// "input-token equivalents". It reads usage numbers only and never prints the content of a transcript.
//
//   node scripts/token-report.mjs <session folder or .jsonl> [--after "<text>"] [--label "<name>"]
//
// <session folder> is `~/.claude/projects/<project>/<session id>`; the orchestrator transcript is the `<session id>.jsonl`
// next to it and each subagent is `<session id>/subagents/agent-<id>.jsonl` with a `.meta.json` (agent type, description).
// `--after` counts the orchestrator only after the first line that contains the text (for example the message that started
// the run), so a planning interview in the same session is left out. The cost line uses ASSUMED price ratios (cache read 0.1,
// cache write 1.25, output 5 times a fresh input token): check current pricing before relying on it.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RATIO = { fresh: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };

/** The per-turn usage of one transcript (JSON lines). One assistant message written on several lines counts once. */
export function readTurns(text, after = null) {
  const turns = [];
  const seen = new Set();
  let started = after === null;
  for (const line of String(text).split('\n')) {
    if (!line) continue;
    if (!started) {
      if (line.includes(after)) started = true;
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.message?.usage ?? entry?.usage;
    if (!usage) continue;
    const id = entry?.message?.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    turns.push({
      fresh: usage.input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
    });
  }
  return turns;
}

/** Totals for a list of turns. */
export function summarize(turns) {
  const sum = (field) => turns.reduce((total, turn) => total + turn[field], 0);
  const prompt = (turn) => turn.fresh + turn.cacheWrite + turn.cacheRead;
  const totals = { fresh: sum('fresh'), cacheWrite: sum('cacheWrite'), cacheRead: sum('cacheRead'), output: sum('output') };
  return {
    turns: turns.length,
    first: turns.length ? prompt(turns[0]) : 0,
    last: turns.length ? prompt(turns[turns.length - 1]) : 0,
    processed: totals.fresh + totals.cacheWrite + totals.cacheRead + totals.output,
    cost: Math.round(Object.entries(RATIO).reduce((acc, [kind, ratio]) => acc + totals[kind] * ratio, 0)),
  };
}

const n = (value) => value.toLocaleString('en-US');

/** The report as Markdown, from rows `{ role, detail, turns, first, last, processed, cost }`. */
export function renderReport(rows, label = 'session') {
  const lines = [`## Token report: ${label}`, '', '| Role | What | Turns | First prompt | Last prompt | Processed | Cost (equiv.) |', '|---|---|---|---|---|---|---|'];
  for (const row of rows) lines.push(`| ${row.role} | ${row.detail} | ${row.turns} | ${n(row.first)} | ${n(row.last)} | ${n(row.processed)} | ${n(row.cost)} |`);
  const total = (field, filter = () => true) => rows.filter(filter).reduce((acc, row) => acc + row[field], 0);
  const orchestrator = total('cost', (row) => row.role === 'orchestrator');
  const subagents = total('cost', (row) => row.role !== 'orchestrator');
  lines.push('', `**Total about ${n(orchestrator + subagents)}** input-token equivalents: orchestrator ${n(orchestrator)} (${rows.filter((r) => r.role === 'orchestrator').reduce((a, r) => a + r.turns, 0)} turns), ` +
    `${rows.length - rows.filter((r) => r.role === 'orchestrator').length} subagents ${n(subagents)}.`);
  const byRole = new Map();
  for (const row of rows.filter((r) => r.role !== 'orchestrator')) byRole.set(row.role, (byRole.get(row.role) ?? 0) + row.cost);
  if (byRole.size) lines.push('', 'By subagent role: ' + [...byRole].map(([role, cost]) => `${role} ${n(cost)}`).join(', ') + '.');
  lines.push('', 'Cost uses assumed price ratios (cache read 0.1, cache write 1.25, output 5). One run is one sample.');
  return lines.join('\n');
}

/** Rows for a session: its orchestrator transcript and every subagent next to it. */
export function collectRows(target, after = null) {
  const folder = target.endsWith('.jsonl') ? target.slice(0, -'.jsonl'.length) : target;
  const orchestratorFile = `${folder}.jsonl`;
  const rows = [];
  if (existsSync(orchestratorFile)) {
    rows.push({ role: 'orchestrator', detail: after ? 'the run (planning left out)' : 'the session', ...summarize(readTurns(readFileSync(orchestratorFile, 'utf8'), after)) });
  }
  const subagents = join(folder, 'subagents');
  if (existsSync(subagents)) {
    for (const name of readdirSync(subagents).filter((file) => /^agent-.*\.jsonl$/.test(file)).sort()) {
      let meta = {};
      try {
        meta = JSON.parse(readFileSync(join(subagents, name.replace(/\.jsonl$/, '.meta.json')), 'utf8'));
      } catch {
        // No meta file: the role is unknown.
      }
      rows.push({ role: meta.agentType ?? 'subagent', detail: String(meta.description ?? basename(name, '.jsonl')).slice(0, 50), ...summarize(readTurns(readFileSync(join(subagents, name), 'utf8'))) });
    }
  }
  return rows;
}

function main(argv) {
  const args = [...argv];
  const take = (flag) => {
    const at = args.indexOf(flag);
    if (at === -1) return null;
    const [, value] = args.splice(at, 2);
    return value ?? null;
  };
  const after = take('--after');
  const label = take('--label');
  const [target] = args;
  if (!target) {
    console.error('usage: node scripts/token-report.mjs <session folder or .jsonl> [--after "<text>"] [--label "<name>"]');
    return 2;
  }
  const rows = collectRows(target, after);
  if (rows.length === 0) {
    console.error(`nothing found for ${target}`);
    return 1;
  }
  console.log(renderReport(rows, label ?? basename(target.replace(/\.jsonl$/, ''))));
  return 0;
}

/** True when started directly, also through a symlink or a short Windows path (see the shipped scripts). */
function startedDirectly() {
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && startedDirectly()) process.exit(main(process.argv.slice(2)));
