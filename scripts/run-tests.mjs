// Kit development only (not shipped). Runs every *.test.mjs file by name.
// A bare `node --test` also executes files named test-*.mjs, which includes the
// test-edit-guard hook script; that script waits on stdin and never ends.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SKIP = new Set(['node_modules', '.git']);

function* findTests(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* findTests(full);
    else if (entry.name.endsWith('.test.mjs')) yield full;
  }
}

const files = [...findTests(process.cwd())].sort();
if (files.length === 0) {
  console.error('no *.test.mjs files found');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
