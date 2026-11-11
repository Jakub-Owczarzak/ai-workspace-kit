// Kit development only (not shipped). Prints token counts for Claude Code subagent transcripts, never their content.
//
//   node scripts/token-probe.mjs <subagents folder> <agent id> [<agent id> ...]
//
// The folder is `~/.claude/projects/<project>/<session id>/subagents/`; each subagent has `agent-<id>.jsonl`.
// For every transcript it prints the model turns, the summed tokens by kind (fresh input, cache write, cache read,
// output), the size of the first and last prompt, and a rough cost in "input-token equivalents" using ASSUMED price
// ratios (cache read 0.1, cache write 1.25, output 5 times a fresh input token): check current pricing before relying
// on the cost line. The `subagent_tokens` number a subagent reports is about its last prompt plus output, not the sum.
import { readFileSync } from 'node:fs';

const [folder, ...ids] = process.argv.slice(2);
if (!folder || ids.length === 0) {
  console.error('usage: node scripts/token-probe.mjs <subagents folder> <agent id> [<agent id> ...]');
  process.exit(2);
}

const RATIO = { fresh: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };

for (const id of ids) {
  let lines;
  try {
    lines = readFileSync(`${folder}/agent-${id}.jsonl`, 'utf8').split('\n').filter(Boolean);
  } catch (error) {
    console.log(`== ${id}: cannot read (${error.code ?? error.message})`);
    continue;
  }
  const turns = [];
  const seen = new Set();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.message?.usage ?? entry?.usage;
    if (!usage) continue;
    // One assistant message can be written on several lines (one per content block): count it once.
    const messageId = entry?.message?.id;
    if (messageId && seen.has(messageId)) continue;
    if (messageId) seen.add(messageId);
    turns.push({
      fresh: usage.input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
    });
  }
  console.log(`== ${id}: ${turns.length} model turns`);
  if (turns.length === 0) continue;
  const sum = (field) => turns.reduce((total, turn) => total + turn[field], 0);
  const prompt = (turn) => turn.fresh + turn.cacheWrite + turn.cacheRead;
  const total = sum('fresh') + sum('cacheWrite') + sum('cacheRead') + sum('output');
  const cost = Object.entries(RATIO).reduce((acc, [kind, ratio]) => acc + sum(kind) * ratio, 0);
  console.log(`   fresh ${sum('fresh')}, cache write ${sum('cacheWrite')}, cache read ${sum('cacheRead')}, output ${sum('output')}; total ${total}; about ${Math.round(cost)} input-token equivalents`);
  console.log(`   first prompt ${prompt(turns[0])}, last prompt ${prompt(turns[turns.length - 1])}; the work added ${prompt(turns[turns.length - 1]) - prompt(turns[0])} to the context`);
}
