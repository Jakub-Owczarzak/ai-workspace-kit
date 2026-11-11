// Run: node --test check-review-gate.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRecordText, evaluateGate, parseRecord, recordPathFor } from './check-review-gate.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'check-review-gate.mjs');
const TREE = 'a'.repeat(40);

describe('record text', () => {
  it('round-trips the header through parseRecord', () => {
    const text = buildRecordText({ tree: TREE, blocking: 2, summary: 'two issues', findings: '- a\n- b', now: new Date('2026-11-09T10:00:00Z') });
    assert.deepEqual(parseRecord(text), { tree: TREE, reviewedAt: '2026-11-09T10:00:00.000Z', blocking: 2, summary: 'two issues', selfReview: false });
    assert.match(text, /\n\n- a\n- b\n$/);
  });

  it('marks a record written by the author, and a summary cannot forge or hide that mark', () => {
    const self = buildRecordText({ tree: TREE, blocking: 0, selfReview: true, summary: 'self-review: no fresh reader' });
    assert.match(self, /^Self-review: yes$/m);
    assert.equal(parseRecord(self).selfReview, true);
    const independent = buildRecordText({ tree: TREE, blocking: 0, summary: 'fine\nSelf-review: yes' });
    assert.equal(parseRecord(independent).selfReview, false, 'a newline in the summary cannot add the header');
    assert.equal(parseRecord(buildRecordText({ tree: TREE, blocking: 0 })).selfReview, false);
  });

  it('reads a missing or non-numeric Blocking field as null', () => {
    assert.equal(parseRecord(`Reviewed-tree: ${TREE}\n`).blocking, null);
    assert.equal(parseRecord(`Reviewed-tree: ${TREE}\nBlocking: some\n`).blocking, null);
  });

  it('keeps a summary on one line, so it cannot forge a header field', () => {
    const text = buildRecordText({ tree: TREE, blocking: 2, summary: 'fine\nBlocking: 0' });
    assert.equal(parseRecord(text).blocking, 2);
    assert.equal(parseRecord(text).summary, 'fine Blocking: 0');
  });

  it('puts the record in the reviews folder, named by the tree', () => {
    assert.equal(recordPathFor('proj', TREE), join('proj', '.claude', 'reviews', `${TREE}.md`));
  });
});

describe('evaluateGate', () => {
  const goodRecord = { tree: TREE, reviewedAt: 'earlier', blocking: 0, summary: null };

  it('says nothing and allows in off mode, whatever the record', () => {
    assert.deepEqual(evaluateGate({ mode: 'off', tree: TREE, record: null }), { status: 'off', message: '', exitCode: 0 });
  });

  it('is ok when the record names this tree and has no blocking findings, in both modes', () => {
    for (const mode of ['advisory', 'required']) {
      const result = evaluateGate({ mode, tree: TREE, record: goodRecord });
      assert.equal(result.status, 'ok', mode);
      assert.equal(result.exitCode, 0, mode);
    }
  });

  it('reminds in advisory mode and blocks in required mode when there is no record', () => {
    const advisory = evaluateGate({ mode: 'advisory', tree: TREE, record: null });
    assert.equal(advisory.exitCode, 0);
    assert.match(advisory.message, /advisory.*no review record.*Push allowed/s);
    const required = evaluateGate({ mode: 'required', tree: TREE, record: null });
    assert.equal(required.exitCode, 1);
    assert.match(required.message, /push blocked, no review record/);
    assert.match(required.message, /REVIEW_MODE=off git push/);
  });

  it('treats a record for another tree as no record', () => {
    const stale = { ...goodRecord, tree: 'b'.repeat(40) };
    assert.equal(evaluateGate({ mode: 'required', tree: TREE, record: stale }).exitCode, 1);
  });

  it('blocks required mode when the record shows blocking findings, and says how many', () => {
    const result = evaluateGate({ mode: 'required', tree: TREE, record: { ...goodRecord, blocking: 3 } });
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /3 unresolved blocking/);
  });

  it('blocks required mode when the record has no valid Blocking count', () => {
    const result = evaluateGate({ mode: 'required', tree: TREE, record: { ...goodRecord, blocking: null } });
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /no valid "Blocking:" count/);
  });

  it('does not accept a self-review as the second reader in required mode, and says what to do', () => {
    const result = evaluateGate({ mode: 'required', tree: TREE, record: { ...goodRecord, selfReview: true } });
    assert.equal(result.status, 'blocked');
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /self-review/i);
    assert.match(result.message, /independent/i);
    assert.match(result.message, /REVIEW_MODE=off git push/);
  });

  it('only reminds about a self-review in advisory mode, and stays silent in off mode', () => {
    const advisory = evaluateGate({ mode: 'advisory', tree: TREE, record: { ...goodRecord, selfReview: true } });
    assert.equal(advisory.status, 'reminder');
    assert.equal(advisory.exitCode, 0);
    assert.match(advisory.message, /self-review/i);
    assert.equal(evaluateGate({ mode: 'off', tree: TREE, record: { ...goodRecord, selfReview: true } }).status, 'off');
  });

  it('still reports blocking findings first when a self-review also has some', () => {
    const result = evaluateGate({ mode: 'required', tree: TREE, record: { ...goodRecord, blocking: 2, selfReview: true } });
    assert.match(result.message, /2 unresolved blocking/);
  });
});

describe('real runs in a throw-away git repository', () => {
  function withRepository(callback) {
    const root = mkdtempSync(join(tmpdir(), 'review-gate-'));
    const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: root, encoding: 'utf8' });
    try {
      git('init', '-q');
      writeFileSync(join(root, 'code.txt'), 'one\n');
      git('add', '.');
      git('commit', '-q', '-m', 'first');
      return callback({ root, git });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function run(root, args, mode, folder = root) {
    const env = { ...process.env };
    delete env.REVIEW_MODE;
    if (mode) env.REVIEW_MODE = mode;
    return spawnSync(process.execPath, [scriptPath, ...args], { cwd: folder, env, encoding: 'utf8' });
  }

  it('checks the commit named by --commit (what a push sends), not whatever is checked out', () => {
    withRepository(({ root, git }) => {
      writeFileSync(join(root, 'code.txt'), 'two\n');
      git('add', '.');
      run(root, ['record', '--blocking', '0'], 'required');
      git('commit', '-q', '-m', 'reviewed');
      const reviewedCommit = git('rev-parse', 'HEAD').trim();
      writeFileSync(join(root, 'code.txt'), 'three\n');
      git('commit', '-q', '-am', 'not reviewed');
      assert.equal(run(root, ['--commit', reviewedCommit], 'required').status, 0);
      assert.equal(run(root, [], 'required').status, 1);
      assert.equal(run(root, ['--commit', git('rev-parse', 'HEAD').trim()], 'required').status, 1);
    });
  });

  it('runs from the pre-push hook for the pushed commit, ignores a deletion, and does not need a profile file', (testContext) => {
    if (spawnSync('sh', ['-c', 'exit 0']).status !== 0) return testContext.skip('no sh available');
    const hookTemplate = readFileSync(join(dirname(scriptPath), '..', 'hooks', 'pre-push'), 'utf8').replaceAll('<PROTECTED BRANCH>', 'main');
    withRepository(({ root, git }) => {
      mkdirSync(join(root, 'scripts'));
      for (const name of ['check-review-gate.mjs', 'workflow-config.mjs']) writeFileSync(join(root, 'scripts', name), readFileSync(join(dirname(scriptPath), name)));
      writeFileSync(join(root, 'pre-push.sh'), hookTemplate);
      const head = git('rev-parse', 'HEAD').trim();
      const push = (line) => spawnSync('sh', ['pre-push.sh'], { cwd: root, input: `${line}\n`, env: { ...process.env, REVIEW_MODE: 'required' }, encoding: 'utf8' });

      assert.equal(push(`refs/heads/topic ${head} refs/heads/topic ${'0'.repeat(40)}`).status, 1, 'unreviewed content is blocked');
      assert.equal(push(`(delete) ${'0'.repeat(40)} refs/heads/topic ${head}`).status, 0, 'a deletion is not reviewed');
      assert.equal(push(`(delete) ${'0'.repeat(64)} refs/heads/topic ${head}`).status, 0, 'a SHA-256 deletion is not reviewed');
      assert.equal(push(`refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}`).status, 1, 'the protected branch is still blocked first');
    });
  });

  it('rejects a --commit without a commit id, with an option as its value, or together with --staged', () => {
    withRepository(({ root }) => {
      for (const args of [['--commit'], ['--commit', '--staged'], ['--commit', 'HEAD', '--staged']]) {
        const result = run(root, args, 'required');
        assert.equal(result.status, 2, args.join(' '));
        assert.match(result.stderr, /review-gate: /, args.join(' '));
      }
    });
  });

  it('prints the profile warnings, so a broken workflow.json is not a silent downgrade', () => {
    withRepository(({ root }) => {
      execFileSync(process.execPath, ['-e', "require('fs').mkdirSync('.claude',{recursive:true});require('fs').writeFileSync('.claude/workflow.json','{ not json')"], { cwd: root });
      const result = run(root, []);
      assert.match(result.stdout, /review-gate: warning: workflow\.json is not valid JSON/);
    });
  });

  it('finds the project root from a subfolder, for the profile and for the record', () => {
    withRepository(({ root, git }) => {
      execFileSync(process.execPath, ['-e', "require('fs').mkdirSync('sub/deeper',{recursive:true});require('fs').mkdirSync('.claude',{recursive:true});require('fs').writeFileSync('.claude/workflow.json','{\"profile\":\"org\"}')"], { cwd: root });
      const subfolder = join(root, 'sub', 'deeper');
      assert.equal(run(root, [], undefined, subfolder).status, 1);
      run(root, ['record', '--blocking', '0'], undefined, subfolder);
      const tree = git('write-tree').trim();
      assert.equal(existsSync(recordPathFor(root, tree)), true);
      assert.equal(existsSync(join(subfolder, '.claude')), false);
    });
  });

  it('blocks a push in required mode when nothing was reviewed', () => {
    withRepository(({ root }) => {
      const result = run(root, [], 'required');
      assert.equal(result.status, 1);
      assert.match(result.stdout, /push blocked, no review record/);
    });
  });

  it('accepts the commit made after a review of the staged content (the record matches by tree)', () => {
    withRepository(({ root, git }) => {
      writeFileSync(join(root, 'code.txt'), 'two\n');
      git('add', '.');
      const recorded = run(root, ['record', '--blocking', '0', '--summary', 'looks fine'], 'required');
      assert.equal(recorded.status, 0, recorded.stderr);
      assert.equal(run(root, ['--staged'], 'required').status, 0);
      git('commit', '-q', '-m', 'second');
      const checked = run(root, [], 'required');
      assert.equal(checked.status, 0);
      assert.match(checked.stdout, /review-gate: ok/);
    });
  });

  it('records a self-review with --self-review: required mode blocks the push, advisory only reminds, an independent record passes', () => {
    withRepository(({ root, git }) => {
      writeFileSync(join(root, 'code.txt'), 'two\n');
      git('add', '.');
      const recorded = run(root, ['record', '--blocking', '0', '--summary', 'self-review: no fresh reader', '--self-review'], 'required');
      assert.equal(recorded.status, 0, recorded.stderr);

      const required = run(root, ['--staged'], 'required');
      assert.equal(required.status, 1);
      assert.match(required.stdout, /self-review/i);
      assert.match(required.stdout, /independent/i);

      const advisory = run(root, ['--staged'], 'advisory');
      assert.equal(advisory.status, 0);
      assert.match(advisory.stdout, /self-review/i);

      // An independent review of the same content, recorded without the flag, replaces it and passes.
      assert.equal(run(root, ['record', '--blocking', '0', '--summary', 'independent review'], 'required').status, 0);
      const independent = run(root, ['--staged'], 'required');
      assert.equal(independent.status, 0);
      assert.match(independent.stdout, /review-gate: ok/);
    });
  });

  it('treats the record as stale when the content changes after the review', () => {
    withRepository(({ root, git }) => {
      writeFileSync(join(root, 'code.txt'), 'two\n');
      git('add', '.');
      run(root, ['record', '--blocking', '0'], 'required');
      writeFileSync(join(root, 'code.txt'), 'three\n');
      git('add', '.');
      git('commit', '-q', '-m', 'second, changed after the review');
      assert.equal(run(root, [], 'required').status, 1);
    });
  });

  it('blocks required mode for a record with unresolved blocking findings, but not advisory mode', () => {
    withRepository(({ root, git }) => {
      writeFileSync(join(root, 'code.txt'), 'two\n');
      git('add', '.');
      run(root, ['record', '--blocking', '2'], 'required');
      git('commit', '-q', '-m', 'second');
      assert.equal(run(root, [], 'required').status, 1);
      assert.equal(run(root, [], 'advisory').status, 0);
    });
  });

  it('stores the findings file in the record', () => {
    withRepository(({ root, git }) => {
      writeFileSync(join(root, 'findings.md'), '- code.txt:1 something to fix\n');
      writeFileSync(join(root, 'code.txt'), 'two\n');
      git('add', 'code.txt');
      run(root, ['record', '--blocking', '1', '--findings-file', join(root, 'findings.md')]);
      const tree = git('write-tree').trim();
      assert.match(readFileSync(recordPathFor(root, tree), 'utf8'), /code\.txt:1 something to fix/);
    });
  });

  it('stays silent in off mode and reminds without a profile file (solo is advisory)', () => {
    withRepository(({ root }) => {
      const off = run(root, [], 'off');
      assert.equal(off.status, 0);
      assert.equal(off.stdout, '');
      const solo = run(root, []);
      assert.equal(solo.status, 0);
      assert.match(solo.stdout, /review-gate \(advisory\)/);
    });
  });

  it('reads the mode from .claude/workflow.json', () => {
    withRepository(({ root }) => {
      execFileSync(process.execPath, ['-e', "require('fs').mkdirSync('.claude',{recursive:true});require('fs').writeFileSync('.claude/workflow.json','{\"profile\":\"org\"}')"], { cwd: root });
      assert.equal(run(root, []).status, 1);
    });
  });

  it('refuses to record without a blocking count and writes nothing', () => {
    withRepository(({ root }) => {
      const result = run(root, ['record', '--summary', 'no count']);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /needs --blocking/);
      assert.equal(existsSync(join(root, '.claude', 'reviews')), false);
    });
  });

  it('allows the push, with a note, outside a git repository', () => {
    const folder = mkdtempSync(join(tmpdir(), 'review-gate-nogit-'));
    try {
      const result = run(folder, [], 'required');
      assert.equal(result.status, 0);
      assert.match(result.stdout, /could not check/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
