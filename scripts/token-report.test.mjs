// Kit development only (not shipped). Checks the token report on made-up transcripts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectRows, readTurns, renderReport, summarize } from './token-report.mjs';

const SCRIPT = fileURLToPath(new URL('./token-report.mjs', import.meta.url));
const line = (id, usage, extra = {}) => JSON.stringify({ message: { id, usage }, ...extra });

describe('readTurns and summarize', () => {
  it('counts one assistant message once even when it is written on several lines', () => {
    const text = [line('m1', { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 10 }),
      line('m1', { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 10 }),
      line('m2', { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: 20 }),
      'not json'].join('\n');
    const turns = readTurns(text);
    assert.equal(turns.length, 2);
    const summary = summarize(turns);
    assert.equal(summary.turns, 2);
    assert.equal(summary.first, 102);
    assert.equal(summary.last, 102);
    assert.equal(summary.processed, 2 + 100 + 10 + 2 + 100 + 20);
    assert.equal(summary.cost, Math.round(4 * 1 + 100 * 1.25 + 100 * 0.1 + 30 * 5));
  });

  it('--after leaves out everything before the marker line', () => {
    const text = [line('a', { input_tokens: 5, output_tokens: 5 }), JSON.stringify({ text: 'START HERE' }), line('b', { input_tokens: 7, output_tokens: 1 })].join('\n');
    assert.equal(readTurns(text, 'START HERE').length, 1);
    assert.equal(readTurns(text, 'START HERE')[0].fresh, 7);
    assert.equal(readTurns(text).length, 2);
  });
});

describe('collectRows and renderReport', () => {
  it('reads the orchestrator and each subagent with its role, and prints a Markdown report', () => {
    const root = mkdtempSync(join(tmpdir(), 'token-report-'));
    try {
      const session = join(root, 'abc');
      mkdirSync(join(session, 'subagents'), { recursive: true });
      writeFileSync(`${session}.jsonl`, line('o1', { input_tokens: 1, cache_creation_input_tokens: 50, cache_read_input_tokens: 0, output_tokens: 5 }) + '\n');
      writeFileSync(join(session, 'subagents', 'agent-x1.jsonl'), line('s1', { input_tokens: 1, cache_creation_input_tokens: 20, cache_read_input_tokens: 0, output_tokens: 2 }) + '\n');
      writeFileSync(join(session, 'subagents', 'agent-x1.meta.json'), JSON.stringify({ agentType: 'factory-builder', description: 'Build bucket 1' }));
      const rows = collectRows(session);
      assert.deepEqual(rows.map((row) => row.role), ['orchestrator', 'factory-builder']);
      const report = renderReport(rows, 'test');
      assert.match(report, /\| factory-builder \| Build bucket 1 \| 1 \|/);
      assert.match(report, /By subagent role: factory-builder/);
      const printed = execFileSync(process.execPath, [SCRIPT, session, '--label', 'cli'], { encoding: 'utf8' });
      assert.match(printed, /## Token report: cli/);
      assert.match(printed, /Total about/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
