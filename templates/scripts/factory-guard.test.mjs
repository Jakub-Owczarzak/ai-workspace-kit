// Run: node --test factory-guard.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  bucketE2e,
  bucketPlanProblems,
  buildReport,
  ciDecision,
  cleanCiLog,
  detectHost,
  e2eCommand,
  handoffPath,
  handoffProblems,
  isProtectedBranch,
  parseBucketMap,
  planExcerpt,
  planProblems,
  preflight,
  readState,
  recordAttempt,
  remoteHostname,
  resetState,
  statePath,
  writeReport,
} from './factory-guard.mjs';

const GUARD = fileURLToPath(new URL('./factory-guard.mjs', import.meta.url));

const FILLED_PLAN = `# Plan: a thing

## Intent Anchor

**Goal:** Ship the thing.

**Success criteria**
- It works.

## Bucket map

| # | Bucket | Output | Status |
|---|---|---|---|
| 1 | Spike | A note | done: all proven |
| 2 | Controls | Controls and tests | todo |
| 3a | Guard | A script | in progress |
| 3b | Skill | A skill | planned, awaiting approval |

## Current bucket

**Bucket 2: Controls**
- Goal: g
- Done when: the controls resolve.

### Bucket 3a: Guard
- Done when: the guard passes its tests.

**Bucket 3b: Skill**
- Done when: the skill runs once for real.
`;

function withProject(callback, { plan = FILLED_PLAN, config, files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'factory-guard-'));
  try {
    if (plan !== null) writeFileSync(join(root, 'PLAN.md'), plan);
    for (const [relative, text] of Object.entries(files)) {
      mkdirSync(join(root, relative, '..'), { recursive: true });
      writeFileSync(join(root, relative), text);
    }
    if (config) {
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(join(root, '.claude', 'workflow.json'), JSON.stringify(config));
    }
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A fake command runner: `answers` maps "command arg arg" to { status, stdout }; anything else exits 1. */
function fakeRun(answers) {
  return (command, args) => {
    const key = [command, ...args].join(' ');
    return answers[key] ?? { status: 1, stdout: '' };
  };
}

const GOOD_GIT = {
  'git rev-parse --is-inside-work-tree': { status: 0, stdout: 'true\n' },
  'git branch --show-current': { status: 0, stdout: 'main\n' },
  'git status --porcelain': { status: 0, stdout: '' },
  'git remote get-url origin': { status: 0, stdout: 'https://github.com/acme/app.git\n' },
  'git symbolic-ref --short refs/remotes/origin/HEAD': { status: 0, stdout: 'origin/main\n' },
};
const GOOD_GH = {
  'gh auth status': { status: 0, stdout: 'Logged in\n' },
  'gh extension list': { status: 0, stdout: 'gh stack\tgithub/gh-stack\tv0.3.0\n' },
};

describe('parseBucketMap', () => {
  it('reads the rows of the bucket map and marks done buckets as not pending', () => {
    const buckets = parseBucketMap(FILLED_PLAN);
    assert.deepEqual(
      buckets.map((bucket) => [bucket.id, bucket.name, bucket.pending]),
      [['1', 'Spike', false], ['2', 'Controls', true], ['3a', 'Guard', true], ['3b', 'Skill', true]],
    );
    assert.equal(buckets[1].output, 'Controls and tests');
    assert.equal(buckets[0].status, 'done: all proven');
  });

  it('skips the template placeholder row and returns nothing when there is no table', () => {
    const template = '## Bucket map\n\n| # | Bucket | Output | Status |\n|---|---|---|---|\n| 1 | <name> | <what you can see> | todo |\n';
    assert.deepEqual(parseBucketMap(template), []);
    assert.deepEqual(parseBucketMap('# Plan\n\nno table'), []);
    assert.deepEqual(parseBucketMap(''), []);
  });

  it('stops at the next heading', () => {
    const text = '## Bucket map\n\n| # | Bucket | Output | Status |\n|---|---|---|---|\n| 1 | A | x | todo |\n\n## Decision log\n\n| # | Decision |\n|---|---|\n| 9 | Not a bucket |\n';
    assert.deepEqual(parseBucketMap(text).map((bucket) => bucket.id), ['1']);
  });
});

describe('planProblems', () => {
  it('accepts a filled plan with a bucket left to build', () => {
    assert.deepEqual(planProblems(FILLED_PLAN), []);
  });

  it('reports a missing Intent Anchor and a placeholder goal', () => {
    assert.match(planProblems('# Plan\n')[0], /no Intent Anchor/);
    const placeholder = FILLED_PLAN.replace('Ship the thing.', '<one or two sentences>');
    assert.ok(planProblems(placeholder).some((problem) => /goal/i.test(problem)));
  });

  it('reports a plan with no buckets, and one whose buckets are all done', () => {
    assert.ok(planProblems('## Intent Anchor\n\n**Goal:** x\n').some((problem) => /no buckets/.test(problem)));
    const allDone = FILLED_PLAN.replaceAll('todo', 'done').replace('in progress', 'done').replace('planned, awaiting approval', 'done');
    assert.ok(planProblems(allDone).some((problem) => /nothing left to build/.test(problem)));
  });
});

describe('bucketPlanProblems', () => {
  it('accepts pending buckets that each have a block with a "Done when" line, in either heading style', () => {
    assert.deepEqual(bucketPlanProblems(FILLED_PLAN), []);
  });

  it('names a pending bucket that has no plan at all', () => {
    const withoutThree = FILLED_PLAN.replace(/### Bucket 3a: Guard\n- Done when: .*\n\n/, '');
    const problems = bucketPlanProblems(withoutThree);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Bucket 3a \(Guard\) has no plan/);
  });

  it('names a pending bucket whose plan has no "Done when"', () => {
    const problems = bucketPlanProblems(FILLED_PLAN.replace('- Done when: the controls resolve.', '- Verify by: looking'));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Bucket 2 \(Controls\).*Done when/);
  });

  it('does not take a "Done when" from the next bucket, and does not confuse 3 with 3a', () => {
    const plan = '## Bucket map\n\n| # | Bucket | Output | Status |\n|---|---|---|---|\n| 3 | Three | x | todo |\n| 3a | Three A | x | todo |\n\n## Current bucket\n\n**Bucket 3a: Three A**\n- Done when: a\n\n**Bucket 3: Three**\n- Goal: only a goal\n';
    const problems = bucketPlanProblems(plan);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Bucket 3 \(Three\)/);
  });

  it('ignores buckets that are done: bucket 1 has no plan block and raises nothing', () => {
    assert.equal(parseBucketMap(FILLED_PLAN)[0].pending, false);
    assert.doesNotMatch(FILLED_PLAN, /Bucket 1:/);
    assert.deepEqual(bucketPlanProblems(FILLED_PLAN), []);
  });
});

describe('bucketE2e', () => {
  const planWith = (line3a) => FILLED_PLAN.replace('- Done when: the guard passes its tests.', `- Done when: the guard passes its tests.\n${line3a}`);

  it('is true only for a bucket whose own plan says "E2E: yes"', () => {
    assert.equal(bucketE2e(planWith('- E2E: yes'), '3a'), true);
    assert.equal(bucketE2e(planWith('- E2E: Yes (the page changes)'), '3a'), true);
    assert.equal(bucketE2e(planWith('- E2E: no'), '3a'), false);
    assert.equal(bucketE2e(FILLED_PLAN, '3a'), false, 'no line means no');
  });

  it('does not take the line from the bucket next to it, or from 3 when asked about 3a', () => {
    const plan = planWith('- E2E: yes');
    assert.equal(bucketE2e(plan, '2'), false);
    assert.equal(bucketE2e(plan, '3b'), false);
    assert.equal(bucketE2e(plan, '9'), false, 'a bucket with no block is false, not an error');
  });

  it('shows up on each pending bucket in the preflight result', () => {
    withProject((root) => {
      const result = preflight(root, { env: { FACTORY_MODE: 'local' }, run: fakeRun(GOOD_GIT) });
      assert.deepEqual(result.buckets.map((bucket) => [bucket.id, bucket.e2e]), [['2', false], ['3a', true], ['3b', false]]);
    }, { plan: planWith('- E2E: yes') });
  });
});

describe('e2eCommand', () => {
  const overview = (commands) => `# App\n\n**Commands**\n\`\`\`\n${commands}\n\`\`\`\nRun tests first.\n`;

  it('reads the command from the line in the Commands block that ends with an e2e comment', () => {
    const text = overview('npm install     # install\nnpm test        # tests\nnpx playwright test   # e2e tests');
    assert.equal(e2eCommand(text), 'npx playwright test');
    assert.equal(e2eCommand(overview('maestro test e2e/flows   # end-to-end, native')), 'maestro test e2e/flows');
    assert.equal(e2eCommand(overview('npm run e2e # E2E')), 'npm run e2e');
  });

  it('is null when there is no such line, for an unfilled placeholder, and for no text at all', () => {
    assert.equal(e2eCommand(overview('npm test   # tests')), null);
    assert.equal(e2eCommand(overview('<e2e>   # e2e')), null);
    assert.equal(e2eCommand(''), null);
    assert.equal(e2eCommand(undefined), null);
  });

  it('does not take a command from prose or a line that only mentions e2e in passing', () => {
    assert.equal(e2eCommand('We run e2e tests on CI.\nnpm test   # tests, not e2e-free'), null);
  });
});

describe('planExcerpt, handoffPath and handoffProblems', () => {
  it('planExcerpt names a pending bucket that has no written plan', () => {
    const plan = FILLED_PLAN.replace('**Bucket 3b: Skill**\n- Done when: the skill runs once for real.\n', '');
    assert.match(planExcerpt(plan), /no written plan for bucket 3b/);
  });

  it('handoffPath keeps the id to safe characters inside the factory folder', () => {
    const path = handoffPath('/p', '../x y').replaceAll('\\', '/');
    assert.match(path, /\/\.claude\/factory\/handoff\/[^/]+\.md$/);
    assert.ok(!path.includes('/../'));
  });

  it('handoffProblems lists each missing part', () => {
    assert.deepEqual(handoffProblems('Changed: a\nRan: b\nDone when:\n- c: done\nStatus: done\n'), []);
    assert.equal(handoffProblems('').length, 4);
    assert.match(handoffProblems('Changed: a\nRan: b\nDone when:\n').join(' '), /no "Status:" line/);
  });
});

describe('remoteHostname', () => {
  it('reads the host name from https and ssh remotes without credentials', () => {
    assert.equal(remoteHostname('https://gitlab.com/a/b.git'), 'gitlab.com');
    assert.equal(remoteHostname('git@git.example.com:a/b.git'), 'git.example.com');
    assert.equal(remoteHostname('https://user:secret@Git.Example.com/a/b'), 'git.example.com');
    assert.equal(remoteHostname(''), null);
    assert.equal(remoteHostname('not a url'), null);
  });
});

describe('cleanCiLog', () => {
  const ESC = '\u001b';

  it('strips terminal color codes, in raw and in caret form', () => {
    assert.equal(cleanCiLog(`${ESC}[36;1mnode check.mjs${ESC}[0m`), 'node check.mjs');
    assert.equal(cleanCiLog('^[[36;1mnode check.mjs^[[0m'), 'node check.mjs');
    assert.equal(cleanCiLog(`${ESC}[0K${ESC}[31;1mERROR: Job failed: exit code 1${ESC}[0;m`), 'ERROR: Job failed: exit code 1');
  });

  it('drops GitLab section markers and the timestamp and stream prefix of each line', () => {
    const trace = [
      '2026-11-11T11:17:00.851686Z 00O section_end:1794395820:step_script',
      '2026-11-11T11:17:00.852364Z 00O+section_start:1794395820:cleanup_file_variables',
      '2026-11-11T11:17:00.204100Z 01E README.md does not mention: greet (src/greet.js)',
      '2026-11-11T11:17:01.234139Z 00O ERROR: Job failed: exit code 1',
    ].join('\n');
    assert.equal(cleanCiLog(trace), 'README.md does not mention: greet (src/greet.js)\nERROR: Job failed: exit code 1');
  });

  it('drops the GitHub job and step columns, timestamps and group markers but keeps the error line', () => {
    const log = [
      'check\tRun node check.mjs\t﻿2026-11-11T12:01:21.6110189Z ##[group]Run node check.mjs',
      'check\tRun node check.mjs\t2026-11-11T12:01:21.6134120Z shell: /usr/bin/bash -e {0}',
      'check\tRun node check.mjs\t2026-11-11T12:01:21.6135357Z ##[endgroup]',
      'check\tRun node check.mjs\t2026-11-11T12:01:21.6467129Z README.md does not mention: greet (src/greet.js)',
      'check\tRun node check.mjs\t2026-11-11T12:01:21.6516888Z ##[error]Process completed with exit code 1.',
    ].join('\n');
    assert.equal(
      cleanCiLog(log),
      'shell: /usr/bin/bash -e {0}\nREADME.md does not mention: greet (src/greet.js)\n##[error]Process completed with exit code 1.',
    );
  });

  it('removes blank lines and carriage returns, and keeps only the last lines asked for', () => {
    const text = ['one', '', 'two\r', '   ', 'three', 'four'].join('\n');
    assert.equal(cleanCiLog(text), 'one\ntwo\nthree\nfour');
    assert.equal(cleanCiLog(text, { lines: 2 }), 'three\nfour');
  });

  it('gives an empty string for nothing, and never throws on odd input', () => {
    assert.equal(cleanCiLog(''), '');
    assert.equal(cleanCiLog(undefined), '');
    assert.equal(cleanCiLog(null), '');
    assert.equal(cleanCiLog(12345), '12345');
  });
});

describe('detectHost', () => {
  it('reads github and gitlab from https and ssh remotes', () => {
    assert.equal(detectHost('https://github.com/acme/app.git', 'auto'), 'github');
    assert.equal(detectHost('git@github.com:acme/app.git', 'auto'), 'github');
    assert.equal(detectHost('https://gitlab.com/acme/app.git', 'auto'), 'gitlab');
    assert.equal(detectHost('git@gitlab.com:acme/app.git', 'auto'), 'gitlab');
  });

  it('cannot tell a self-hosted or unknown host in auto mode, and obeys an explicit choice', () => {
    assert.equal(detectHost('https://git.example.com/acme/app.git', 'auto'), null);
    assert.equal(detectHost('https://git.example.com/acme/app.git', 'gitlab'), 'gitlab');
    assert.equal(detectHost('https://gitlab.com/acme/app.git', 'github'), 'github');
    assert.equal(detectHost('', 'auto'), null);
    assert.equal(detectHost(undefined, 'auto'), null);
  });
});

describe('isProtectedBranch', () => {
  it('protects main, master and the remote default branch, and nothing else', () => {
    assert.equal(isProtectedBranch('main', 'main'), true);
    assert.equal(isProtectedBranch('master', 'main'), true);
    assert.equal(isProtectedBranch('develop', 'develop'), true);
    assert.equal(isProtectedBranch('factory/thing-1', 'main'), false);
    assert.equal(isProtectedBranch('feature/main-menu', 'main'), false);
    assert.equal(isProtectedBranch('', 'main'), true, 'an empty branch name (detached head) is never pushed');
  });
});

describe('ciDecision', () => {
  it('allows a fix while attempts remain and stops at the cap', () => {
    assert.equal(ciDecision(0, 3), 'fix');
    assert.equal(ciDecision(2, 3), 'fix');
    assert.equal(ciDecision(3, 3), 'stop');
    assert.equal(ciDecision(5, 3), 'stop');
  });

  it('reads a cap of 0 as watch and report only', () => {
    assert.equal(ciDecision(0, 0), 'stop');
  });

  it('treats a missing count as none used', () => {
    assert.equal(ciDecision(undefined, 2), 'fix');
  });
});

describe('attempt state', () => {
  it('counts attempts per key, persists them, and stops at the cap without counting the refusal', () => {
    withProject((root) => {
      assert.deepEqual(recordAttempt(root, 'layer-1', 2), { decision: 'fix', used: 1, cap: 2 });
      assert.deepEqual(recordAttempt(root, 'layer-1', 2), { decision: 'fix', used: 2, cap: 2 });
      assert.deepEqual(recordAttempt(root, 'layer-1', 2), { decision: 'stop', used: 2, cap: 2 });
      assert.deepEqual(recordAttempt(root, 'layer-2', 2), { decision: 'fix', used: 1, cap: 2 });
      assert.equal(readState(root).attempts['layer-1'], 2);
      assert.ok(existsSync(statePath(root)));
    });
  });

  it('survives a broken or missing state file and can be reset', () => {
    withProject((root) => {
      assert.deepEqual(readState(root), { attempts: {} });
      mkdirSync(join(root, '.claude', 'factory'), { recursive: true });
      writeFileSync(statePath(root), '{ not json');
      assert.deepEqual(readState(root), { attempts: {} });
      recordAttempt(root, 'a', 3);
      resetState(root);
      assert.deepEqual(readState(root), { attempts: {} });
      resetState(root);
    });
  });
});

describe('stop report', () => {
  it('names the reason, the attempts used and the details', () => {
    const text = buildReport({
      reason: 'CI is still red after 3 attempts',
      state: { attempts: { 'layer-2': 3 } },
      details: 'FAIL marker present',
      now: new Date('2026-11-11T12:00:00Z'),
    });
    assert.match(text, /^# Factory stopped/m);
    assert.match(text, /2026-11-11T12:00:00/);
    assert.match(text, /CI is still red after 3 attempts/);
    assert.match(text, /layer-2: 3/);
    assert.match(text, /FAIL marker present/);
  });

  it('is written under .claude/factory/report.md', () => {
    withProject((root) => {
      const path = writeReport(root, { reason: 'blocked: needs a decision' });
      assert.ok(path.replaceAll('\\', '/').endsWith('.claude/factory/report.md'));
      assert.match(readFileSync(path, 'utf8'), /blocked: needs a decision/);
    });
  });
});

describe('preflight', () => {
  const pr = { FACTORY_MODE: 'pr' };

  it('refuses when the factory is off and says how to turn it on', () => {
    withProject((root) => {
      const result = preflight(root, { env: {}, run: fakeRun({ ...GOOD_GIT, ...GOOD_GH }) });
      assert.equal(result.ok, false);
      assert.equal(result.mode, 'off');
      assert.match(result.problems.join('\n'), /factory\.mode is off/);
      assert.match(result.problems.join('\n'), /FACTORY_MODE/);
    });
  });

  it('passes in pr mode on a clean github project and lists what is left to build', () => {
    withProject((root) => {
      const result = preflight(root, { env: pr, run: fakeRun({ ...GOOD_GIT, ...GOOD_GH }) });
      assert.deepEqual(result.problems, []);
      assert.equal(result.ok, true);
      assert.equal(result.mode, 'pr');
      assert.equal(result.host, 'github');
      assert.equal(result.prLayout, 'stack');
      assert.equal(result.pushConfirm, 'auto');
      assert.equal(result.ciFixAttempts, 3);
      assert.equal(result.defaultBranch, 'main');
      assert.deepEqual(result.buckets.map((bucket) => bucket.id), ['2', '3a', '3b']);
    });
  });

  it('takes its settings from the profile, so org asks before a push', () => {
    withProject((root) => {
      const result = preflight(root, { env: pr, run: fakeRun({ ...GOOD_GIT, ...GOOD_GH }) });
      assert.equal(result.pushConfirm, 'auto');
    }, { config: { profile: 'solo' } });
    withProject((root) => {
      const result = preflight(root, { env: pr, run: fakeRun({ ...GOOD_GIT, ...GOOD_GH }) });
      assert.equal(result.pushConfirm, 'ask');
      assert.equal(result.ciFixAttempts, 2);
    }, { config: { profile: 'org' } });
  });

  it('needs no remote or host tool in local mode', () => {
    withProject((root) => {
      const run = fakeRun({ ...GOOD_GIT, 'git remote get-url origin': { status: 1, stdout: '' } });
      const result = preflight(root, { env: { FACTORY_MODE: 'local' }, run });
      assert.deepEqual(result.problems, []);
      assert.equal(result.ok, true);
    });
  });

  it('refuses without a usable plan', () => {
    withProject((root) => {
      const result = preflight(root, { env: pr, run: fakeRun({ ...GOOD_GIT, ...GOOD_GH }) });
      assert.equal(result.ok, false);
      assert.match(result.problems.join('\n'), /PLAN\.md/);
    }, { plan: null });
    withProject((root) => {
      const result = preflight(root, { env: pr, run: fakeRun({ ...GOOD_GIT, ...GOOD_GH }) });
      assert.equal(result.ok, false);
    }, { plan: '# Plan\n\n## Intent Anchor\n\n**Goal:** <one or two sentences>\n' });
  });

  it('refuses a pending bucket that has no written "Done when", so the factory never invents acceptance criteria', () => {
    withProject((root) => {
      const result = preflight(root, { env: pr, run: fakeRun({ ...GOOD_GIT, ...GOOD_GH }) });
      assert.equal(result.ok, false);
      assert.match(result.problems.join('\n'), /Bucket 3b \(Skill\) has no plan/);
    }, { plan: FILLED_PLAN.replace(/\*\*Bucket 3b: Skill\*\*\n- Done when: .*\n/, '') });
  });

  it('refuses when gh is missing or not logged in', () => {
    withProject((root) => {
      const run = fakeRun({ ...GOOD_GIT, 'gh auth status': { status: 1, stdout: '' } });
      const result = preflight(root, { env: pr, run });
      assert.equal(result.ok, false);
      assert.match(result.problems.join('\n'), /gh auth login/);
    });
  });

  it('accepts gitlab when glab is logged in, says there is no stack, and needs neither gh nor gh stack', () => {
    withProject((root) => {
      const gitlab = { ...GOOD_GIT, 'git remote get-url origin': { status: 0, stdout: 'https://gitlab.com/a/b.git\n' } };
      const run = fakeRun({ ...gitlab, 'glab auth status --hostname gitlab.com': { status: 0, stdout: 'Logged in\n' } });
      const result = preflight(root, { env: pr, run });
      assert.deepEqual(result.problems, []);
      assert.equal(result.host, 'gitlab');
      assert.equal(result.ok, true);
      assert.ok(result.notes.some((note) => /GitLab has no stacks/.test(note) && /chained merge requests/.test(note)));
    });
  });

  it('refuses gitlab when glab is missing or not logged in, naming the host to log in to', () => {
    withProject((root) => {
      const run = fakeRun({ ...GOOD_GIT, 'git remote get-url origin': { status: 0, stdout: 'git@gitlab.com:a/b.git\n' } });
      const result = preflight(root, { env: pr, run });
      assert.equal(result.ok, false);
      assert.match(result.problems.join('\n'), /glab auth login --hostname gitlab\.com/);
    });
  });

  it('takes the host name for glab from the remote, so a self-managed server works with factory.host gitlab', () => {
    withProject((root) => {
      const run = fakeRun({
        ...GOOD_GIT,
        'git remote get-url origin': { status: 0, stdout: 'https://git.example.com/a/b.git\n' },
        'glab auth status --hostname git.example.com': { status: 0, stdout: 'Logged in\n' },
      });
      const result = preflight(root, { env: { ...pr, FACTORY_HOST: 'gitlab' }, run });
      assert.deepEqual(result.problems, []);
      assert.equal(result.host, 'gitlab');
    });
  });

  it('refuses an unknown host until factory.host says which', () => {
    withProject((root) => {
      const run = fakeRun({ ...GOOD_GIT, ...GOOD_GH, 'git remote get-url origin': { status: 0, stdout: 'https://gitlab.com/a/b.git\n' } });
      assert.equal(preflight(root, { env: pr, run }).ok, false, 'glab is not logged in here');
    });
    withProject((root) => {
      const run = fakeRun({ ...GOOD_GIT, ...GOOD_GH, 'git remote get-url origin': { status: 0, stdout: 'https://git.example.com/a/b.git\n' } });
      const result = preflight(root, { env: pr, run });
      assert.equal(result.ok, false);
      assert.match(result.problems.join('\n'), /factory\.host/);
    });
  });

  it('refuses uncommitted changes except PLAN.md and the factory folder, which it only notes', () => {
    withProject((root) => {
      const dirty = fakeRun({ ...GOOD_GIT, ...GOOD_GH, 'git status --porcelain': { status: 0, stdout: ' M src/app.js\n?? notes.txt\n' } });
      const result = preflight(root, { env: pr, run: dirty });
      assert.equal(result.ok, false);
      assert.match(result.problems.join('\n'), /src\/app\.js/);
      const planOnly = fakeRun({ ...GOOD_GIT, ...GOOD_GH, 'git status --porcelain': { status: 0, stdout: ' M PLAN.md\n?? .claude/factory/state.json\n' } });
      const fine = preflight(root, { env: pr, run: planOnly });
      assert.equal(fine.ok, true);
      assert.ok(fine.notes.some((note) => /PLAN\.md/.test(note)));
    });
  });

  it('refuses outside a git repository', () => {
    withProject((root) => {
      const result = preflight(root, { env: pr, run: fakeRun({}) });
      assert.equal(result.ok, false);
      assert.match(result.problems.join('\n'), /git repository/);
    });
  });

  it('only notes a missing gh stack, because the fallback is one PR per bucket', () => {
    withProject((root) => {
      const run = fakeRun({ ...GOOD_GIT, ...GOOD_GH, 'gh extension list': { status: 0, stdout: '' } });
      const result = preflight(root, { env: pr, run });
      assert.equal(result.ok, true);
      assert.ok(result.notes.some((note) => /gh stack/.test(note)));
    });
  });

  describe('subagents', () => {
    const AGENT_FILE = { '.claude/agents/factory-builder.md': '---\nname: factory-builder\n---\n' };
    const run = fakeRun({ ...GOOD_GIT, ...GOOD_GH });

    it('is not single-agent mode when the builder agent file is installed', () => {
      withProject((root) => {
        const result = preflight(root, { env: pr, run });
        assert.equal(result.singleAgent, false);
        assert.ok(!result.notes.some((note) => /single-agent/i.test(note)));
      }, { files: AGENT_FILE });
    });

    it('says single-agent mode when the builder agent file is missing, and that it is not a failure', () => {
      withProject((root) => {
        const result = preflight(root, { env: pr, run });
        assert.equal(result.singleAgent, true);
        assert.equal(result.ok, true);
        assert.ok(result.notes.some((note) => /single-agent mode/i.test(note) && /Without subagents/.test(note)));
      });
    });

    it('warns that required review becomes a self-review that stops for the user before any push', () => {
      withProject((root) => {
        const result = preflight(root, { env: { ...pr, REVIEW_MODE: 'required' }, run });
        assert.equal(result.ok, true);
        assert.equal(result.reviewMode, 'required');
        assert.ok(result.notes.some((note) => /self-review/i.test(note) && /stop/i.test(note) && /push/i.test(note)));
      });
    });

    it('has no self-review warning when a reviewer agent can run, or when review is not required', () => {
      withProject((root) => {
        const withAgent = preflight(root, { env: { ...pr, REVIEW_MODE: 'required' }, run });
        assert.ok(!withAgent.notes.some((note) => /self-review/i.test(note)));
      }, { files: AGENT_FILE });
      withProject((root) => {
        const advisory = preflight(root, { env: pr, run });
        assert.ok(!advisory.notes.some((note) => /self-review/i.test(note)));
      });
    });
  });

  describe('e2e', () => {
    const E2E_PLAN = FILLED_PLAN.replace('- Done when: the guard passes its tests.', '- Done when: the guard passes its tests.\n- E2E: yes');
    const AGENTS_WITH = '# App\n\n**Commands**\n```\nnpm test   # tests\nnpm run e2e   # e2e\n```\n';
    const AGENTS_WITHOUT = '# App\n\n**Commands**\n```\nnpm test   # tests\n```\n';
    const options = { env: { ...pr, TEST_E2E: 'browser' }, run: fakeRun({ ...GOOD_GIT, ...GOOD_GH }) };

    it('refuses an E2E: yes bucket when tests.e2e is on but AGENTS.md has no e2e command', () => {
      withProject((root) => {
        const result = preflight(root, options);
        assert.equal(result.ok, false);
        assert.match(result.problems.join('\n'), /Bucket 3a.*E2E: yes.*no e2e command/s);
        assert.match(result.problems.join('\n'), /# e2e/);
      }, { plan: E2E_PLAN, files: { 'AGENTS.md': AGENTS_WITHOUT } });
    });

    it('passes with the command and says what will run, and where the screenshots will go', () => {
      withProject((root) => {
        const result = preflight(root, options);
        assert.equal(result.ok, true);
        assert.equal(result.e2eCommand, 'npm run e2e');
        assert.ok(result.notes.some((note) => /npm run e2e/.test(note) && /3a/.test(note)));
        assert.ok(!result.notes.some((note) => /e2e-shots/.test(note)), 'the helper is installed, so no warning');
      }, { plan: E2E_PLAN, files: { 'AGENTS.md': AGENTS_WITH, 'scripts/e2e-shots.mjs': '// helper' } });
    });

    it('only notes that screenshots stay local when the screenshot helper is not installed', () => {
      withProject((root) => {
        const result = preflight(root, options);
        assert.equal(result.ok, true);
        assert.ok(result.notes.some((note) => /e2e-shots/.test(note) && /local/.test(note)));
      }, { plan: E2E_PLAN, files: { 'AGENTS.md': AGENTS_WITH } });
    });

    it('does not need an e2e command when no bucket is marked E2E: yes', () => {
      withProject((root) => {
        const result = preflight(root, options);
        assert.equal(result.ok, true);
        assert.ok(result.notes.some((note) => /no bucket is marked E2E: yes/.test(note)));
      }, { files: { 'AGENTS.md': AGENTS_WITHOUT } });
    });

    it('only notes an E2E: yes bucket when tests.e2e is off, because nothing will run', () => {
      withProject((root) => {
        const result = preflight(root, { env: pr, run: fakeRun({ ...GOOD_GIT, ...GOOD_GH }) });
        assert.equal(result.ok, true);
        assert.ok(result.notes.some((note) => /3a/.test(note) && /tests\.e2e is off/.test(note)));
      }, { plan: E2E_PLAN, files: { 'AGENTS.md': AGENTS_WITHOUT } });
    });
  });

  it('never throws when a command cannot be started', () => {
    withProject((root) => {
      const throwing = () => {
        throw new Error('spawn ENOENT');
      };
      const result = preflight(root, { env: pr, run: throwing });
      assert.equal(result.ok, false);
    });
  });
});

describe('command line', () => {
  const run = (args, root) => {
    try {
      const stdout = execFileSync(process.execPath, [GUARD, ...args, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: String(error.stdout ?? '') };
    }
  };

  it('attempt reads the cap from the profile, exits 0 for a fix and 1 for a stop', () => {
    withProject((root) => {
      assert.equal(run(['attempt', '--key', 'layer-1'], root).status, 0);
      const second = run(['attempt', '--key', 'layer-1'], root);
      assert.equal(second.status, 0);
      assert.match(second.stdout, /fix/);
      const third = run(['attempt', '--key', 'layer-1'], root);
      assert.equal(third.status, 1);
      assert.match(third.stdout, /stop/);
    }, { config: { profile: 'org' } });
  });

  it('report writes the file and reset clears the counts', () => {
    withProject((root) => {
      assert.equal(run(['report', '--reason', 'blocked: pick a database'], root).status, 0);
      assert.match(readFileSync(join(root, '.claude', 'factory', 'report.md'), 'utf8'), /pick a database/);
      run(['attempt', '--key', 'x'], root);
      assert.equal(run(['reset'], root).status, 0);
      assert.deepEqual(readState(root), { attempts: {} });
    });
  });

  it('push-check refuses the protected branch and allows a factory branch', () => {
    withProject((root) => {
      assert.equal(run(['push-check', '--branch', 'main', '--default-branch', 'main'], root).status, 1);
      assert.equal(run(['push-check', '--branch', 'factory/plan-1', '--default-branch', 'main'], root).status, 0);
    });
  });

  it('clean-log reads a CI log on stdin and prints the cleaned last lines', () => {
    const output = execFileSync(process.execPath, [GUARD, 'clean-log', '--lines', '1'], {
      input: 'first\n\u001b[31;1msecond\u001b[0m\n',
      encoding: 'utf8',
    });
    assert.equal(output.trim(), 'second');
  });

  it('plan-excerpt prints the anchor and the pending buckets only, or one bucket', () => {
    withProject((root) => {
      const all = run(['plan-excerpt'], root).stdout;
      assert.match(all, /Ship the thing/);
      assert.match(all, /Bucket 2: Controls/);
      assert.match(all, /Bucket 3b: Skill/);
      assert.doesNotMatch(all, /\| Bucket \| Output \|/, 'the bucket map table is not repeated');
      const one = run(['plan-excerpt', '--bucket', '3a'], root).stdout;
      assert.match(one, /guard passes its tests/);
      assert.doesNotMatch(one, /Ship the thing/);
      assert.doesNotMatch(one, /Bucket 2: Controls/);
    });
  });

  it('handoff-check passes only for a complete handoff that says Status: done', () => {
    withProject((root) => {
      assert.equal(run(['handoff-check', '--bucket', '2'], root).status, 1, 'no file yet');
      assert.equal(run(['handoff-check'], root).status, 2, 'needs --bucket');
      const dir = join(root, '.claude', 'factory', 'handoff');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '2.md'), 'Changed: a.js\nRan: npm test: 3 of 3\nDone when:\n- x: done\n\nStatus: blocked: which database?\n');
      assert.match(run(['handoff-check', '--bucket', '2'], root).stdout, /not done/);
      writeFileSync(join(dir, '2.md'), 'Changed: a.js\nRan: npm test: 3 of 3\nDone when:\n- x: done\n\nStatus: done\n');
      assert.equal(run(['handoff-check', '--bucket', '2'], root).status, 0);
    });
  });

  it('prints an error and exits 2 for an unknown command', () => {
    withProject((root) => {
      assert.equal(run(['nope'], root).status, 2);
    });
  });
});
