// Run: node --test workflow-config.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  CONTROL_SPECS,
  PROFILES,
  PROFILE_NAMES,
  explainResolved,
  loadWorkflowConfig,
  normalizeValue,
  parseConfigText,
  resolveControls,
} from './workflow-config.mjs';

describe('profile tables', () => {
  it('give every profile a value for every control, and nothing extra', () => {
    for (const profile of PROFILE_NAMES) {
      assert.deepEqual(Object.keys(PROFILES[profile]).sort(), Object.keys(CONTROL_SPECS).sort(), profile);
    }
  });

  it('only use values the control accepts', () => {
    for (const profile of PROFILE_NAMES) {
      for (const [name, value] of Object.entries(PROFILES[profile])) {
        assert.equal(normalizeValue(CONTROL_SPECS[name], value).ok, true, `${profile} ${name}`);
      }
    }
  });

  it('keep solo as the relaxed baseline and org as the strictest', () => {
    assert.equal(PROFILES.solo['docs.check'], 'warn');
    assert.equal(PROFILES.solo['tests.guard'], 'off');
    assert.equal(PROFILES.org['docs.check'], 'strict');
    assert.equal(PROFILES.org['tests.guard'], 'on');
    assert.equal(PROFILES.org['review.mode'], 'required');
  });

  it('make bug fixes test-first in every profile and all new logic test-first from team up', () => {
    assert.equal(PROFILES.solo['tests.tdd'], 'bugs');
    assert.equal(PROFILES.team['tests.tdd'], 'on');
    assert.equal(PROFILES.org['tests.tdd'], 'on');
    assert.equal(resolveControls({}, { TEST_TDD: 'off' }).controls['tests.tdd'].value, 'off');
  });

  it('run the reviewer as advice in solo and team and require it in org', () => {
    assert.equal(PROFILES.solo['review.mode'], 'advisory');
    assert.equal(PROFILES.team['review.mode'], 'advisory');
    assert.equal(PROFILES.org['review.mode'], 'required');
  });

  it('gather intent before non-trivial work in every profile, and add success measurements in org', () => {
    assert.equal(PROFILES.solo['planning.gates'], 'anchor');
    assert.equal(PROFILES.team['planning.gates'], 'anchor');
    assert.equal(PROFILES.org['planning.gates'], 'full');
    assert.equal(resolveControls({}, {}).controls['planning.gates'].value, 'anchor');
    assert.equal(resolveControls({ overrides: { 'planning.gates': 'off' } }, {}).controls['planning.gates'].value, 'off');
  });

  it('have no GitHub branch-protection control (the pre-push hook is the gate)', () => {
    assert.equal('branchProtection.check' in CONTROL_SPECS, false);
  });

  it('never turn on Claude-run checks by default, in any profile', () => {
    for (const profile of PROFILE_NAMES) assert.equal(PROFILES[profile]['claude.runChecks'], false);
  });
});

describe('factory and e2e controls', () => {
  it('leave the factory and e2e off in every profile, so nothing changes until a project opts in', () => {
    for (const profile of PROFILE_NAMES) {
      assert.equal(PROFILES[profile]['factory.mode'], 'off', `${profile} factory.mode`);
      assert.equal(PROFILES[profile]['tests.e2e'], 'off', `${profile} tests.e2e`);
    }
  });

  it('give solo and team the same factory preset and make org ask before a push with fewer CI retries', () => {
    for (const profile of ['solo', 'team']) {
      assert.equal(PROFILES[profile]['factory.prLayout'], 'stack');
      assert.equal(PROFILES[profile]['factory.ciFixAttempts'], 3);
      assert.equal(PROFILES[profile]['factory.pushConfirm'], 'auto');
    }
    assert.equal(PROFILES.org['factory.prLayout'], 'stack');
    assert.equal(PROFILES.org['factory.ciFixAttempts'], 2);
    assert.equal(PROFILES.org['factory.pushConfirm'], 'ask');
    for (const profile of PROFILE_NAMES) assert.equal(PROFILES[profile]['factory.host'], 'auto');
  });

  it('stop the builder on an order found in text it reads in team and org, and only note it in solo', () => {
    assert.equal(PROFILES.solo['factory.untrustedText'], 'note');
    assert.equal(PROFILES.team['factory.untrustedText'], 'stop');
    assert.equal(PROFILES.org['factory.untrustedText'], 'stop');
    const spec = CONTROL_SPECS['factory.untrustedText'];
    assert.deepEqual(normalizeValue(spec, 'NOTE'), { ok: true, value: 'note' });
    assert.deepEqual(normalizeValue(spec, 'stop'), { ok: true, value: 'stop' });
    assert.equal(normalizeValue(spec, 'ignore').ok, false, 'there is no value that follows the text');
    const fromEnvironment = resolveControls({ profile: 'solo' }, { FACTORY_UNTRUSTED_TEXT: 'stop' });
    assert.deepEqual(fromEnvironment.controls['factory.untrustedText'], { value: 'stop', source: 'env:FACTORY_UNTRUSTED_TEXT' });
    assert.deepEqual(resolveControls({ profile: 'org' }, {}).controls['factory.untrustedText'], { value: 'stop', source: 'profile:org' });
  });

  it('accept the documented values and reject others with a warning, falling back to the profile', () => {
    assert.deepEqual(normalizeValue(CONTROL_SPECS['factory.mode'], 'LOCAL'), { ok: true, value: 'local' });
    assert.deepEqual(normalizeValue(CONTROL_SPECS['factory.mode'], 'pr'), { ok: true, value: 'pr' });
    assert.equal(normalizeValue(CONTROL_SPECS['factory.mode'], 'merge').ok, false);
    assert.deepEqual(normalizeValue(CONTROL_SPECS['tests.e2e'], 'native'), { ok: true, value: 'native' });
    assert.equal(normalizeValue(CONTROL_SPECS['tests.e2e'], 'device').ok, false);
    assert.equal(normalizeValue(CONTROL_SPECS['factory.host'], 'bitbucket').ok, false);
    const resolved = resolveControls({ overrides: { 'factory.mode': 'merge' } }, {});
    assert.equal(resolved.controls['factory.mode'].value, 'off');
    assert.equal(resolved.warnings.length, 1);
  });

  it('read zero CI fix attempts as "report only" and reject negative or non-numeric values', () => {
    const spec = CONTROL_SPECS['factory.ciFixAttempts'];
    assert.deepEqual(normalizeValue(spec, 0), { ok: true, value: 0 });
    assert.equal(normalizeValue(spec, -1).ok, false);
    assert.equal(normalizeValue(spec, 'three').ok, false);
  });

  it('take a profile preset, an override and an environment variable in that order of strength', () => {
    const org = resolveControls({ profile: 'org' }, {});
    assert.deepEqual(org.controls['factory.pushConfirm'], { value: 'ask', source: 'profile:org' });
    const overridden = resolveControls({ profile: 'org', overrides: { 'factory.pushConfirm': 'auto' } }, {});
    assert.deepEqual(overridden.controls['factory.pushConfirm'], { value: 'auto', source: 'overrides' });
    const fromEnvironment = resolveControls(
      { profile: 'solo', overrides: { 'factory.mode': 'local' } },
      { FACTORY_MODE: 'pr', FACTORY_CI_FIX_ATTEMPTS: '5', TEST_E2E: 'browser' },
    );
    assert.deepEqual(fromEnvironment.controls['factory.mode'], { value: 'pr', source: 'env:FACTORY_MODE' });
    assert.deepEqual(fromEnvironment.controls['factory.ciFixAttempts'], { value: 5, source: 'env:FACTORY_CI_FIX_ATTEMPTS' });
    assert.deepEqual(fromEnvironment.controls['tests.e2e'], { value: 'browser', source: 'env:TEST_E2E' });
  });

  it('have no control that merges or deploys: a person merges', () => {
    const names = Object.keys(CONTROL_SPECS);
    assert.deepEqual(names.filter((name) => /merge|deploy|release/i.test(name)), []);
    assert.deepEqual(CONTROL_SPECS['factory.mode'].allowed, ['off', 'local', 'pr']);
  });
});

describe('normalizeValue', () => {
  it('accepts a choice case-insensitively and rejects others', () => {
    const spec = CONTROL_SPECS['docs.check'];
    assert.deepEqual(normalizeValue(spec, ' STRICT '), { ok: true, value: 'strict' });
    assert.equal(normalizeValue(spec, 'loud').ok, false);
  });

  it('reads booleans from words and real booleans', () => {
    const spec = CONTROL_SPECS['claude.runChecks'];
    assert.deepEqual(normalizeValue(spec, 'On'), { ok: true, value: true });
    assert.deepEqual(normalizeValue(spec, '0'), { ok: true, value: false });
    assert.deepEqual(normalizeValue(spec, true), { ok: true, value: true });
    assert.equal(normalizeValue(spec, 'maybe').ok, false);
  });

  it('reads numbers of zero or more and rejects the rest', () => {
    const spec = CONTROL_SPECS['docs.sizeWarnChars'];
    assert.deepEqual(normalizeValue(spec, '25000'), { ok: true, value: 25000 });
    assert.deepEqual(normalizeValue(spec, 0), { ok: true, value: 0 });
    assert.equal(normalizeValue(spec, -1).ok, false);
    assert.equal(normalizeValue(spec, 'many').ok, false);
    assert.equal(normalizeValue(spec, '').ok, false);
    assert.equal(normalizeValue(spec, false).ok, false);
  });
});

describe('parseConfigText', () => {
  it('treats missing or blank text as "no file" without a warning', () => {
    assert.deepEqual(parseConfigText(undefined), { config: {}, warnings: [] });
    assert.deepEqual(parseConfigText('  \n'), { config: {}, warnings: [] });
  });

  it('warns on broken JSON and on a root that is not an object', () => {
    assert.equal(parseConfigText('{oops').warnings.length, 1);
    assert.equal(parseConfigText('[1,2]').warnings.length, 1);
    assert.deepEqual(parseConfigText('{oops').config, {});
  });

  it('returns a valid object as is', () => {
    assert.deepEqual(parseConfigText('{"profile":"org"}').config, { profile: 'org' });
  });
});

describe('resolveControls', () => {
  it('uses solo and no warnings when nothing is configured', () => {
    const resolved = resolveControls({}, {});
    assert.equal(resolved.profile, 'solo');
    assert.equal(resolved.profileSource, 'default');
    assert.equal(resolved.controls['docs.check'].value, 'warn');
    assert.equal(resolved.controls['docs.check'].source, 'profile:solo');
    assert.deepEqual(resolved.warnings, []);
  });

  it('takes the profile from the file', () => {
    const resolved = resolveControls({ profile: 'org' }, {});
    assert.equal(resolved.profile, 'org');
    assert.equal(resolved.profileSource, 'file');
    assert.equal(resolved.controls['docs.check'].value, 'strict');
  });

  it('lets an override beat the profile', () => {
    const resolved = resolveControls({ profile: 'org', overrides: { 'docs.check': 'warn' } }, {});
    assert.deepEqual(resolved.controls['docs.check'], { value: 'warn', source: 'overrides' });
    assert.equal(resolved.controls['tests.guard'].value, 'on');
  });

  it('lets an environment variable beat an override', () => {
    const resolved = resolveControls(
      { profile: 'solo', overrides: { 'docs.check': 'off' } },
      { DOCS_CHECK: 'strict' },
    );
    assert.deepEqual(resolved.controls['docs.check'], { value: 'strict', source: 'env:DOCS_CHECK' });
  });

  it('lets WORKFLOW_PROFILE switch the whole profile for one command', () => {
    const resolved = resolveControls({ profile: 'solo' }, { WORKFLOW_PROFILE: 'ORG' });
    assert.equal(resolved.profile, 'org');
    assert.equal(resolved.profileSource, 'env:WORKFLOW_PROFILE');
    assert.equal(resolved.controls['review.mode'].value, 'required');
  });

  it('falls back to solo with a warning for an unknown profile', () => {
    const resolved = resolveControls({ profile: 'enterprise' }, {});
    assert.equal(resolved.profile, 'solo');
    assert.match(resolved.warnings[0], /Unknown profile "enterprise"/);
  });

  it('ignores an invalid override or env value with a warning and keeps the lower layer', () => {
    const resolved = resolveControls(
      { profile: 'team', overrides: { 'docs.check': 'loud' } },
      { TEST_GUARD: 'sometimes' },
    );
    assert.equal(resolved.controls['docs.check'].value, 'warn');
    assert.equal(resolved.controls['docs.check'].source, 'profile:team');
    assert.equal(resolved.controls['tests.guard'].value, 'on');
    assert.equal(resolved.warnings.length, 2);
  });

  it('warns about unknown controls and a malformed overrides block, and does not fail', () => {
    assert.match(resolveControls({ overrides: { 'nope.nope': 1 } }, {}).warnings[0], /Unknown control "nope\.nope"/);
    assert.match(resolveControls({ overrides: ['x'] }, {}).warnings[0], /must be an object/);
  });

  it('does not fail on a config that is not an object', () => {
    assert.equal(resolveControls(null, {}).profile, 'solo');
    assert.equal(resolveControls('text', {}).profile, 'solo');
  });

  it('ignores empty environment variables', () => {
    const resolved = resolveControls({}, { DOCS_CHECK: '' });
    assert.equal(resolved.controls['docs.check'].source, 'profile:solo');
  });
});

describe('loadWorkflowConfig', () => {
  function withTemporaryProject(callback) {
    const root = mkdtempSync(join(tmpdir(), 'workflow-config-'));
    try {
      return callback(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('uses solo when the file is missing', () => {
    withTemporaryProject((root) => {
      const resolved = loadWorkflowConfig(root, {});
      assert.equal(resolved.profile, 'solo');
      assert.equal(resolved.file, null);
      assert.deepEqual(resolved.warnings, []);
    });
  });

  it('reads .claude/workflow.json', () => {
    withTemporaryProject((root) => {
      mkdirSync(join(root, '.claude'));
      writeFileSync(join(root, '.claude', 'workflow.json'), '{"profile":"org","overrides":{"docs.sizeWarnChars":1000}}');
      const resolved = loadWorkflowConfig(root, {});
      assert.equal(resolved.profile, 'org');
      assert.equal(resolved.controls['docs.sizeWarnChars'].value, 1000);
      assert.ok(resolved.file.endsWith('workflow.json'));
    });
  });

  it('falls back to solo with a warning when the file is broken', () => {
    withTemporaryProject((root) => {
      mkdirSync(join(root, '.claude'));
      writeFileSync(join(root, '.claude', 'workflow.json'), '{ not json');
      const resolved = loadWorkflowConfig(root, {});
      assert.equal(resolved.profile, 'solo');
      assert.match(resolved.warnings[0], /not valid JSON/);
    });
  });
});

describe('explainResolved', () => {
  it('prints the profile, every control with its source, and warnings', () => {
    const text = explainResolved({
      ...resolveControls({ profile: 'bogus' }, {}),
      file: null,
    });
    assert.match(text, /Workflow profile: solo/);
    assert.match(text, /docs\.check\s+warn\s+profile:solo/);
    assert.match(text, /warning: Unknown profile "bogus"/);
  });
});
