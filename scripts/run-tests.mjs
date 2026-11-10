// Kit development only (not shipped). Runs every *.test.mjs file by name, each in its own process with a time
// limit, so a test that hangs is named (with the output it produced) instead of freezing the whole run.
// A bare `node --test` also executes files named test-*.mjs, which includes the test-edit-guard hook script;
// that script waits on stdin and never ends.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const SKIP = new Set(['node_modules', '.git']);
const FILE_TIMEOUT_MS = Number(process.env.TEST_FILE_TIMEOUT_MS ?? 120000);

function* findTests(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* findTests(full);
    else if (entry.name.endsWith('.test.mjs')) yield full;
  }
}

const count = (output, label) => Number(output.match(new RegExp(`^# ${label} (\\d+)`, 'm'))?.[1] ?? 0);

const files = [...findTests(process.cwd())].sort();
if (files.length === 0) {
  console.error('no *.test.mjs files found');
  process.exit(1);
}

const totals = { tests: 0, pass: 0, fail: 0 };
const problems = [];
for (const file of files) {
  const name = relative(process.cwd(), file).split('\\').join('/');
  const started = Date.now();
  // stdin is closed on purpose: a test must never wait for input.
  const run = spawnSync(process.execPath, ['--test', file], {
    encoding: 'utf8',
    timeout: FILE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const timedOut = run.error?.code === 'ETIMEDOUT';
  totals.tests += count(output, 'tests');
  totals.pass += count(output, 'pass');
  totals.fail += count(output, 'fail');

  if (timedOut) {
    problems.push(name);
    console.log(`TIMED OUT after ${FILE_TIMEOUT_MS / 1000}s  ${name}`);
    console.log(output.split('\n').slice(-40).map((line) => `    | ${line}`).join('\n'));
  } else if (run.status !== 0) {
    problems.push(name);
    console.log(`FAILED  ${name}  (${seconds}s)`);
    console.log(output.split('\n').filter((line) => /not ok|error|expected|actual|Error/.test(line)).slice(0, 40).join('\n'));
  } else {
    console.log(`ok      ${name}  (${seconds}s)`);
  }
}

console.log(`\n# tests ${totals.tests}\n# pass ${totals.pass}\n# fail ${totals.fail}`);
if (problems.length) console.log(`# problem files: ${problems.join(', ')}`);
process.exit(problems.length ? 1 : 0);
