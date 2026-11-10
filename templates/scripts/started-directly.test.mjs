// Run: node --test started-directly.test.mjs
// Every shipped script must run its main code when it is started through a symlink (macOS temp folders, linked
// project folders) or a Windows short path. A plain `import.meta.url === pathToFileURL(argv[1])` comparison fails
// there and the script silently does nothing: a hook that allows everything, a check that reports nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIPPED = readdirSync(HERE).filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));

// Scripts that print a report when started with no arguments, so silence means "main did not run".
const PRINTS_WITHOUT_ARGUMENTS = ['workflow-config.mjs', 'doc-size.mjs', 'check-skills.mjs', 'check-imports.mjs', 'check-config.mjs'];

describe('shipped scripts start correctly through a link', () => {
  it('none of them uses the fragile comparison any more', () => {
    for (const name of SHIPPED) {
      const text = readFileSync(join(HERE, name), 'utf8');
      assert.doesNotMatch(text, /import\.meta\.url\s*===\s*pathToFileURL/, `${name} still compares link and real paths`);
    }
  });

  it('every script that prints a report still prints it when started through a directory link', () => {
    const real = mkdtempSync(join(tmpdir(), 'started-real-'));
    const link = `${real}-link`;
    try {
      mkdirSync(join(real, 'scripts'));
      for (const name of SHIPPED) copyFileSync(join(HERE, name), join(real, 'scripts', name));
      symlinkSync(real, link, 'junction');
      for (const name of PRINTS_WITHOUT_ARGUMENTS) {
        const viaReal = spawnSync(process.execPath, [join(real, 'scripts', name)], { cwd: real, encoding: 'utf8' });
        const viaLink = spawnSync(process.execPath, [join(link, 'scripts', name)], { cwd: link, encoding: 'utf8' });
        assert.ok(viaReal.stdout.length > 0, `${name} prints nothing even by its real path (the probe is wrong)`);
        assert.ok(viaLink.stdout.length > 0, `${name} printed nothing when started through a link`);
      }
    } finally {
      rmSync(link, { recursive: true, force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });
});
